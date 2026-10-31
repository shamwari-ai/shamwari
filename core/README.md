# Shamwari Core

The service that enforces Shamwari's two rules in front of its data. Runs on Nyuchi
infrastructure (Fly), not at the Cloudflare edge.

## Why this exists

Personal-layer data must never reach a third-party inference provider, and only
`open_weight` output may train Shamwari Mind. Something has to decide that before
any data is read or written, somewhere Cloudflare cannot see. That is Core.

**Core holds no database login.** Owner decision, 2026-10-27: only the Nyuchi API
talks to databases. Core calls the API's `/v1/shamwari` routes over Fly's private
network with one internal key (`nyuchi_api.py`), decides scope and provenance
_before_ each call, and checks what comes back. What exists, what is missing and the
route specs for the gaps: `docs/data-api-routes.md`.

## The scope rule

Shamwari's canonical architecture is three layers of intelligence:

| Layer       | Content                  | May reach Cloud? |
| ----------- | ------------------------ | ---------------- |
| `personal`  | the user's own pod data  | **No**           |
| `community` | anonymised platform data | Yes              |
| `platform`  | base Mukoko knowledge    | Yes              |

A personal-scope request bound for an external provider returns **409
`scope_requires_local_inference`**. It is not silently downgraded to platform
scope — that would leak by omission and produce a confidently wrong answer
with no signal that anything was withheld.

This is what makes "sovereign AI companion" a technical fact rather than a
marketing line. It also makes Shamwari Mind load-bearing: if Personal cannot
go to Cloud, and Personal is what makes a companion a companion, then Mind is
the product and Cloud is the general-knowledge fallback.

## Setup

```bash
pip install --require-hashes -r requirements.txt

export SHAMWARI_CORE_TOKEN="$(openssl rand -hex 32)"
export NYUCHI_API_INTERNAL_KEY="nyk_<id>.nys_<secret>"   # internal key: shamwari, shamwari:service, ai
export NYUCHI_API_URL="http://nyuchi-api.internal:8080"  # default; a Fly private address
export NYUCHI_API_HOST="api.nyuchi.com"                   # default; the API trusts this host name

uvicorn main:app --host 0.0.0.0 --port 8000
```

The ingest script has its own lock, `requirements-ingest.txt`, and its own credentials, set
in your own shell and never on the Fly app (see Ground ingestion below).

## Endpoints

| Method | Path             | Purpose                                                                                |
| ------ | ---------------- | -------------------------------------------------------------------------------------- |
| POST   | `/ground/search` | scope-enforced hybrid retrieval, through `POST /v1/shamwari/ground/search`             |
| GET    | `/guardrails`    | active rules for a surface, from `GET /v1/ai/guardrails`                               |
| POST   | `/sink/bulk`     | batched writes from the Worker's queue, allow-listed, through `POST /v1/shamwari/sink` |
| GET    | `/rollup`        | billing aggregate, through `GET /v1/shamwari/usage/rollup`                             |
| POST   | `/auth/verify`   | **501** `key_verification_moved`: Core cannot look keys up (G1)                        |
| GET    | `/health`        | readiness: Core is up and the API answers Core's key                                   |

All except `/health` require `Authorization: Bearer $SHAMWARI_CORE_TOKEN`, except the
operator routes below, which need a different secret.

| Method | Path              | What it does                              |
| ------ | ----------------- | ----------------------------------------- |
| POST   | `/replay/usage`   | **501** until the API has the routes (G4) |
| POST   | `/replay/requeue` | **501** (G4)                              |
| GET    | `/replay/stats`   | **501** (G4)                              |
| GET    | `/rollup/by-tier` | **501** until the API has the route (G3)  |

These four need `Authorization: Bearer $SHAMWARI_OPS_TOKEN`, not the Worker's
token, and answer 503 if it is unset. See `docs/usage-replay.md` and
`docs/security-roles.md`.

`/sink/bulk` is an allow-list, not a write proxy — a compromised edge worker
cannot write to arbitrary collections. It also rejects any `conversations` or
`messages` document without a valid `licenseClass`, rather than defaulting it
to something permissive.

## Ground ingestion

```bash
python ingest_ground.py --list     # sources and licence status
python ingest_ground.py --due      # what needs a refresh
python ingest_ground.py --dry-run --file ./constitution-2013.txt   # show the citations; no network

python ingest_ground.py \
  --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 \
  --effective-from 2013-05-22 \
  --dataset zw-law-v1
```

Writes to both stores. Postgres `documents` gets the audit record: source,
licence, authority, effective date. Mongo `shamwari.knowledgeBase` gets the
embedded chunks. `documents.mongodb_ground_id` bridges them. The credentials
(`SUPABASE_DB_URL`, `MONGODB_URI`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`) are for this
script in your own shell; the running service never reads them.

**The script refuses unapproved sources.** It exits rather than warning and
continuing. Of the 22 seeded corpus sources, five are marked `VERIFY` or
`COPYRIGHT` and will be rejected until you read their terms and flip
`is_approved` yourself. ZIMSEC is flagged DO NOT SCRAPE. It fetches nothing: you
supply the text file, so you have read the source's terms.

Chunking is section-aware: a chunk is a section, or a run of subsections of a long
one, and carries its chapter, section number, title and subsection range, so an
answer cites "s 56(1)-(3)" and not "chunk 47". It reads the Constitution's layout
(`56 Equality and non-discrimination`, `(1)`, `(2)`, schedules) as well as the older
`Section 56` and `56.` styles, drops the table of contents and PDF furniture, and
refuses to treat a wrapped line such as `22 May 2013` as a heading.

Embeddings use `@cf/baai/bge-m3` at 1024 dimensions, matching both the
`ground_vector_search` index and the existing `news.articles` embeddings. The
script hard-fails on a dimension mismatch, before writing anything, rather than
writing unqueryable vectors.

Where the text comes from, what to check, and how to score retrieval:
`docs/ground-ingest.md`. The citation evaluation (`eval_ground.py`) is the
regression gate for every change to the corpus.

## Start here

`Constitution of Zimbabwe Amendment (No. 20) Act 2013` is the only legal
source currently approved, ground-eligible and mind-eligible. It is the
correct first ingestion: public domain, foundational, and it makes the
citation demo work.
