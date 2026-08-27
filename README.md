# Shamwari AI

African AI companion, built in Zimbabwe. Community pillar of the Bundu
Ecosystem. Bundu Foundation IP, sold commercially under Nyuchi Africa.

> **Read [CLAUDE.md](./CLAUDE.md) first.** It records the two rules that must
> not be broken, and — importantly — which database changes are already live and
> must not be re-run.

---

## Repo map

```
CLAUDE.md                      handoff context, invariants, applied-migration log
LICENSE  NOTICE                Apache-2.0; third-party model and corpus terms
.github/workflows/ci.yml       gateway types + tests, Core imports, secret scan
docs/architecture-and-gtm.md   product architecture + go-to-market
docs/repo-split.md             proposal for breaking up this monorepo
docs/workers-ai-models.md      verified provider slugs and model ids

docs-site/                     docs.shamwari.ai — one HTML file, no build

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

---

## Quickstart

### 1. Shamwari Core

```bash
cd core
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in
uvicorn main:app --host 0.0.0.0 --port 8000
curl localhost:8000/health
```

### 2. Fill Ground

`shamwari.knowledgeBase` is empty. The vector and text indexes are live and
READY, but there is nothing to retrieve. This is the only thing between the
codebase and a working demo.

```bash
python ingest_ground.py --list      # sources and licence status
python ingest_ground.py --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 --effective-from 2013-05-22 --dataset zw-law-v1
```

### 3. Gateway

```bash
cd gateway
npm install
wrangler kv namespace create AUTH_CACHE     # paste id into wrangler.jsonc
wrangler queues create shamwari-sink
wrangler queues create shamwari-sink-dlq
cp .dev.vars.example .dev.vars              # fill in
npm run typecheck && npm run dev
```

### 4. Verify

```bash
curl localhost:8787/health

# Scope gate — should return 409 while MIND_AVAILABLE=false
curl localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk_shamwari_..." -H "Content-Type: application/json" \
  -d '{"scope":"personal","messages":[{"role":"user","content":"what did I spend last month"}]}'

# Grounded query — should return citations
curl localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk_shamwari_..." -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What does the Constitution say about equality?"}]}'
```

---

## Before deploying to production

- [ ] Verify provider slugs in `gateway/src/router.ts` against the current
      AI Gateway provider list
- [ ] Set a **spend limit** in the AI Gateway dashboard — cheapest insurance available
- [ ] Enable exact-match caching
- [ ] Read the Kimi K3 LICENSE file directly, not a summary of it
- [ ] Confirm ZimLII's licence terms and flip `is_approved` if they permit reuse
- [ ] Schedule a monthly game-day: break the AI Gateway credential and confirm
      the direct and Workers AI fallbacks still answer

---

## Licence

Platform code: Apache-2.0 (`LICENSE`), copyright Bundu Foundation.
Shamwari Mind: open weights, Apache-2.0 base.

Third-party model terms and per-source corpus licences are in `NOTICE`.
They are not covered by ours, and Ground eligibility is not training
eligibility.

Shamwari Cloud routes to third-party open-weight and commercial models. It is
**not** "fully open source" — say "open weights". See the language discipline
table in CLAUDE.md.
