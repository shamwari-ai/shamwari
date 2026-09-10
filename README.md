<div align="center">

# Shamwari AI

**An AI companion that cites the law instead of guessing it.**

Built in Zimbabwe. Community pillar of the Bundu Ecosystem.
Shona for *"friend"* — *"A friend that serves; a friend that does not control."*

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Status: pre-launch](https://img.shields.io/badge/status-building%20in%20public-orange)](#where-this-actually-is-right-now)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)](#contributing)

[shamwari.ai](https://shamwari.ai) · [docs.shamwari.ai](https://docs.shamwari.ai) · [hello@shamwari.ai](mailto:hello@shamwari.ai)

</div>

---

## Why this exists

Ask a general-purpose model what Zimbabwe's current PAYE threshold is, or
what a specific Statutory Instrument actually says, and it will answer
confidently — often wrong, always unsourced, and stale the moment policy
changes. Zimbabwean law, tax, and monetary policy shift monthly. A model
with that baked into its weights was wrong on arrival.

Shamwari doesn't try to memorize the answer. It retrieves the actual
document, cites the provision, and shows the effective date — the same
discipline a good lawyer or accountant already uses, applied to an AI
companion that answers in Shona, Ndebele, and Zimbabwean English.

> *Shamwari cites the Statutory Instrument. A general-purpose model guesses.*

That's the pitch. Here's the part that makes it more than a pitch: **the
two claims that matter most are enforced in code, not asserted in a pitch
deck.**

## Two rules, enforced twice each

**1. Your own data never reaches a third-party model.** Shamwari's world is
three data scopes, not deployment tiers — `personal` (your own pod data),
`community` (anonymised platform data), `platform` (base shared knowledge).
Personal-scope content is never sent to Cloud inference, full stop. Not a
policy, not a checkbox — a `409` if a request tries. Checked twice
independently (once at the edge, once authoritatively before any
provider I/O), because a single check is one bug away from a leak, and this
leak is a broken promise, not a bug ticket.

**2. Only open-weight output trains Shamwari Mind.** Anthropic's and
OpenAI's terms bar using their outputs to train a competing model. Every
model Shamwari routes to for training-data generation is checked against
that — resolved from what actually served the request, not from what was
merely asked for, because a proxy substituting models behind your back is a
real failure mode this codebase has already hit and fixed once.

Read [`CLAUDE.md`](./CLAUDE.md) for the actual enforcement — file names,
line-level reasoning, and the defects each rule's *second* check exists
because of. It's the single most information-dense file in this repo.

## The three layers

| | What it is | Where your data goes |
|---|---|---|
| **Mind** | An on-device, open-weight model, distilled and quantized to run on modest hardware | Never leaves the device |
| **Ground** | Zimbabwean law, tax, and policy — retrieved with citation and an effective date, kept fresh as sources change | Retrieval only; personal-scope stays pod-scoped |
| **Cloud** | Multi-provider routed inference for community/platform-scope questions, degrading gracefully if any single provider goes down | Community and platform scope only — **never personal** |

Mind is not a someday feature bolted onto a chatbot — if personal-scope
data can never reach Cloud, and personal-scope data is what makes a
companion feel like *your* companion, then Mind **is** the product. Cloud
is the general-knowledge fallback.

Both Mind and its training corpus are meant to be genuinely open — weights,
data recipe, and eval suite, all publishable, released through Bundu
Foundation (a Zimbabwe CLG) rather than sold. "We train Shamwari Mind. We
route Shamwari Cloud."

## Where this actually is right now

Building in public means saying this part plainly. As of this writing:

| Piece | Status |
|---|---|
| Core (FastAPI) + Gateway (Cloudflare Workers) | written, tested, **not deployed yet** |
| Ground's vector + text search indexes | live and ready |
| Ground's actual content | **empty** — this is the one thing standing between this repo and a working demo |
| Corpus licensing (law, tax, health, education sources) | partly cleared, partly waiting on human review — see `CLAUDE.md` |

If you're evaluating this as a product today: it isn't one yet. If you're
looking for a project where the architecture is already decided, documented,
and defensible, and the actual build is genuinely still forming — this is
that project, and it's a good time to have opinions that stick.

## Quickstart

```bash
# 1. Shamwari Core
cd core
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in
uvicorn main:app --host 0.0.0.0 --port 8000
curl localhost:8000/health

# 2. Fill Ground — see what's ingestible and licensed
python ingest_ground.py --list
python ingest_ground.py --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 --effective-from 2013-05-22 --dataset zw-law-v1

# 3. Gateway
cd ../gateway
npm install
wrangler kv namespace create AUTH_CACHE     # paste id into wrangler.jsonc
wrangler queues create shamwari-sink
wrangler queues create shamwari-sink-dlq
cp .dev.vars.example .dev.vars              # fill in
npm run typecheck && npm run dev

# 4. Verify the scope gate actually gates
curl localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk_shamwari_..." -H "Content-Type: application/json" \
  -d '{"scope":"personal","messages":[{"role":"user","content":"what did I spend last month"}]}'
# → 409, every time MIND_AVAILABLE=false. That response is the whole point of rule 1.
```

This repo ships [Graft](https://github.com/trailhq/Graft) pre-wired for
Claude Code — a coding agent working here starts with a real map of the
codebase instead of grepping cold. If you use a different agent, `graft
init --agents <yours>` wires it in.

## Contributing

This project needs more than pull requests, and that's part of what makes
it worth joining early:

- **Code** — `gateway/` (TypeScript, Cloudflare Workers), `core/` (Python,
  FastAPI), corpus ingestion tooling. Start with [`CLAUDE.md`](./CLAUDE.md)
  and the per-directory READMEs; both rules above have tests you should
  read before you touch the files they cover.
- **Corpus review** — several high-value Zimbabwean legal and policy
  sources are blocked purely on licence review, not engineering. If you can
  read a licence and tell us whether it permits reuse, that unblocks real
  content faster than a code change would. See "Blocked on human decisions"
  in `CLAUDE.md`.
- **Language and annotation** — Shona and Ndebele fluency matters more here
  than almost anywhere else building AI right now. Shamwari Mind's training
  data is human-corrected, by design and by necessity — that correction
  work is the irreplaceable asset this project is built on, not a
  footnote to it.

Before your first PR: read `CLAUDE.md` in full (it's dense on purpose — the
"why," not just the "what"), and this org's
[contribution guidelines](https://github.com/shamwari-ai/.github/blob/main/CONTRIBUTING.md)
and [code of conduct](https://github.com/shamwari-ai/.github/blob/main/CODE_OF_CONDUCT.md).
Questions before that? [hello@shamwari.ai](mailto:hello@shamwari.ai).

## Repo map

```
CLAUDE.md                      handoff context, invariants, applied-migration log
LICENSE  NOTICE                Apache-2.0; third-party model and corpus terms
.github/workflows/ci.yml       gateway types + tests, Core imports, secret scan
docs/architecture-and-gtm.md   product architecture + go-to-market
docs/repo-split.md             proposal for breaking up this monorepo
docs/desired-cloudflare-state.md  what should exist in the CF account
docs/scaling-and-memory.md     surfaces, Durable Objects, sandboxes, memory
docs/workers-ai-models.md      verified provider slugs and model ids

docs-site/                     docs.shamwari.ai — one HTML file, no build

site/                           shamwari.ai — the public landing page

gateway/                       Cloudflare Workers, TypeScript
  src/scope.ts                 the scope gate — read this first
  src/router.ts                tier routing, licenseClass assignment
  src/gateway.ts               AI Gateway with three-step degradation
  src/ground.ts                retrieval via Core
  src/auth.ts                  KV cache + Core verification
  src/sink.ts                  queue consumer → Core
  src/index.ts                 fetch + queue handlers

core/                          FastAPI, runs on Nyuchi infrastructure
  main.py                      owns Mongo · Ground · auth · scope enforcement
  ingest_ground.py             corpus ingestion, heading-aware chunking

db/supabase/                   SQL (see CLAUDE.md for what's already applied)
db/mongodb/                    reference only — live cluster differs
scripts/                       generator for the gateway, kept for reference
```

## Before deploying to production

- [ ] Verify provider slugs in `gateway/src/router.ts` against the current
      AI Gateway provider list
- [ ] Set a **spend limit** in the AI Gateway dashboard — cheapest insurance available
- [ ] Enable exact-match caching
- [ ] Read the GLM-5.3 LICENSE file directly, not a summary of it
      (https://huggingface.co/zai-org/GLM-5.3/raw/main/LICENSE)
- [ ] Confirm ZimLII's licence terms and flip `is_approved` if they permit reuse
- [ ] Schedule a monthly game-day: break the AI Gateway credential and confirm
      the direct and Workers AI fallbacks still answer

## License

Platform code: Apache-2.0 (`LICENSE`), copyright Bundu Foundation.
Shamwari Mind: open weights, Apache-2.0 base.

Third-party model terms and per-source corpus licences are in `NOTICE`.
They are not covered by ours, and Ground eligibility is not training
eligibility.

Shamwari Cloud routes to third-party open-weight and commercial models. It is
**not** "fully open source" — say "open weights". See the language discipline
table in `CLAUDE.md`.
