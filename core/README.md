# Shamwari Core

The service that owns MongoDB. Runs on Nyuchi infrastructure, not at the
Cloudflare edge.

## Why this exists

MongoDB's Atlas Data API was removed in September 2025, and the native driver
is not production-hardened in Workers. So something has to sit in front of
Mongo. Given that, this service is also the right place to enforce the scope
rule — because it needs to live somewhere Cloudflare cannot see.

## The scope rule

Shamwari's canonical architecture is three layers of intelligence:

| Layer | Content | May reach Cloud? |
|---|---|---|
| `personal` | the user's own pod data | **No** |
| `community` | anonymised platform data | Yes |
| `platform` | base Mukoko knowledge | Yes |

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
pip install fastapi uvicorn motor asyncpg httpx pydantic

export MONGODB_URI="mongodb+srv://..."
export SUPABASE_DB_URL="postgresql://...@db.hxjblxsheosjbjqgmlhx.supabase.co:5432/postgres"
export SHAMWARI_CORE_TOKEN="$(openssl rand -hex 32)"
export CF_ACCOUNT_ID="..."
export CF_API_TOKEN="..."      # Workers AI read for embeddings

uvicorn main:app --host 0.0.0.0 --port 8000
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/verify` | `platform.apiKeys` lookup by `keyPrefix`, constant-time hash compare |
| POST | `/ground/search` | `$rankFusion` hybrid retrieval, scope-enforced |
| GET | `/guardrails` | active rules for a surface |
| POST | `/sink/bulk` | batched writes from the Worker's queue, allow-listed |
| GET | `/rollup` | billing aggregate on the `ownerEntityId + billingPeriod` index |

All except `/health` require `Authorization: Bearer $SHAMWARI_CORE_TOKEN`.

`/sink/bulk` is an allow-list, not a write proxy — a compromised edge worker
cannot write to arbitrary collections. It also rejects any `conversations` or
`messages` document without a valid `licenseClass`, rather than defaulting it
to something permissive.

## Ground ingestion

```bash
python ingest_ground.py --list     # sources and licence status
python ingest_ground.py --due      # what needs a refresh

python ingest_ground.py \
  --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 \
  --effective-from 2013-05-22 \
  --dataset zw-law-v1
```

Writes to both stores. Postgres `documents` gets the audit record — source,
licence, authority, effective date. Mongo `shamwari.knowledgeBase` gets the
embedded chunks. `documents.mongodb_ground_id` bridges them.

**The script refuses unapproved sources.** It exits rather than warning and
continuing. Of the 22 seeded corpus sources, five are marked `VERIFY` or
`COPYRIGHT` and will be rejected until you read their terms and flip
`is_approved` yourself. ZIMSEC is flagged DO NOT SCRAPE.

Chunking is heading-aware: it splits on `PART`, `CHAPTER`, `SCHEDULE`,
`Section`, `Article`, `Clause`. This matters because a citation should read
"Section 56" and not "chunk 47" — the whole product claim is that Shamwari
cites the actual provision.

Embeddings use `@cf/baai/bge-m3` at 1024 dimensions, matching both the
`ground_vector_search` index and the existing `news.articles` embeddings. The
script hard-fails on a dimension mismatch rather than writing unqueryable
vectors.

## Start here

`Constitution of Zimbabwe Amendment (No. 20) Act 2013` is the only legal
source currently approved, ground-eligible and mind-eligible. It is the
correct first ingestion: public domain, foundational, and it makes the
citation demo work.
