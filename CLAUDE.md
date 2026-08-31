# CLAUDE.md — Shamwari AI

Read this before touching anything. It records decisions that are expensive to
rediscover and, in the "already applied" section, changes that are **live on
production databases** and must not be re-run.

---

## What this is

Shamwari AI is the community pillar of the Bundu Ecosystem — an African AI
companion, positioned as the Digital Twin's conversational interface.

- **IP owner:** Bundu Foundation (Zimbabwe CLG)
- **Sold commercially under:** Nyuchi Africa
- **Licence:** Apache-2.0, copyright Bundu Foundation. Chosen over MIT for
  the patent grant and the attribution requirement — both matter when the
  same code is licensed commercially. `NOTICE` carries the third-party
  model and corpus terms, which are *not* covered by ours.
- **Surfaces:** shamwari.ai (standalone), Mukoko mini-apps, Nyuchi products
- **Brand:** Shona for "friend". Mineral: sodalite. Voice: helpful, warm,
  intelligent. *"A friend that serves; a friend that does not control."*

Ecosystem: Bundu Foundation governs four pillars — Bundu Labs (research),
Mukoko (consumer super-app), Nyuchi Africa (commercial), Shamwari AI
(community).

---

## The two rules that must not be broken

### 1. Personal-layer data never reaches a third-party inference provider

Shamwari's canonical architecture is three **data scopes**, not deployment
tiers:

| Scope | Content | May reach Cloud? |
|---|---|---|
| `personal` | the user's own pod data | **No. Ever.** |
| `community` | anonymised platform data | Yes |
| `platform` | base Mukoko knowledge | Yes |

A `personal`-scope request bound for an external provider returns **409
`scope_requires_local_inference`**. It is **not** silently downgraded to
`platform` — a downgrade answers confidently while withholding the user's own
data, giving no signal that anything was missing. That is worse than an error.

Enforced twice on purpose:
- `gateway/src/scope.ts` — fast fail, saves a Core round trip
- `core/main.py::resolve_scope` — authoritative, Worker cannot override

Two checks because one is a single bug away from a leak, and this leak is a
broken sovereignty claim rather than a 500.

**Two checks were not enough, and the reason is worth keeping.** Three code
paths downstream of the gate never read the decision it returned: `ground()`
embedded the question on Workers AI, `infer()` sent the prompt to a provider,
and Core's lexical retrieval pipeline had no owner filter at all. Both checks
passed in every case. `docs/scaling-and-memory.md` has the write-up. The rule
that follows: **a scope decision no downstream function is obliged to read is
a comment, not a control.** When adding an endpoint, pass the decision to
everything that touches provider I/O, and add the test that counts the calls.

**Consequence:** Shamwari Mind (on-device) is load-bearing, not a nice-to-have.
If Personal can't reach Cloud and Personal is what makes a companion a
companion, Mind is the product and Cloud is the general-knowledge fallback.

`MIND_AVAILABLE=false` today. It gates `/v1/ground/context` — retrieval only,
no provider call — which is the endpoint Mind calls to get Ground context and
a system prompt before generating **on the device**. It deliberately does not
gate `/v1/chat/completions`: that endpoint generates on Cloud, so no value of
a Worker variable can make it serve personal scope.

This used to read "flipping it routes personal scope to Mind with no code
change". That was false and it hid a leak — there is no Mind client in the
Worker and there cannot be one, so flipping the flag sent personal prompts to
Moonshot. Mind is a client of the gateway, not a backend behind it.

### 2. Only `open_weight` provenance may train Shamwari Mind

Anthropic and OpenAI terms bar using their outputs to train competing models.
Kimi K3 and Qwen permit it.

`licenseClass` is stamped at generation time and never inferred later:
- `gateway/src/router.ts` — premium tier is hardcoded `restricted`. **Do not
  change this,** and do not move `licenseClass` into
  `gateway/routing-policy.json`. That file is the editable routing heuristic;
  provenance must not be editable without a code review. `validatePolicy`
  and `test/policy.test.ts` both assert the split.
- `gateway/src/provenance.ts` — resolves the licence from the model that
  **actually served**, against an allowlist in code, and **fails closed to
  `restricted` for anything unlisted**. This is the value that gets stamped;
  `router.ts` records intent.
- `core/main.py::sink_bulk` — rejects any conversation missing a valid
  `licenseClass` rather than defaulting it, and rejects
  `licenseClass: restricted` together with `trainingEligible: true`
- Postgres `training_examples.license_class` has `CHECK (= 'open_weight')` — a
  restricted row physically cannot enter the table
- `mind_training_chunks` view is the only thing the training pipeline reads

**Why the tier alone was not enough — the rule-1 lesson again.** The tier
records what the Worker *asked for*. The model that answers is not always the
model that was asked for: `infer()` degrades to Workers AI when both the
Gateway and the direct provider are unreachable, and an **AI Gateway dynamic
route can substitute the model from a dashboard — no deploy, no code review.**
A route failing over from Kimi to a restricted model wrote rows stamped
`open_weight` and flagged trainable. So provenance is now resolved from
`cf-aig-provider` / `cf-aig-model` on the response, and Core re-checks the
combination, because the Worker's allowlist is exactly the thing a route change
can outdate. Restated: **a provenance claim derived from intent rather than
from what happened is a label, not a control.**

---

## Language discipline

Precision here is not pedantry — it is the difference between a defensible
claim and one a journalist can puncture.

| Don't say | Do say |
|---|---|
| "open source model" | "open weights" — Kimi K3 ships under a bespoke licence, not MIT/Apache |
| "your data stays in Africa" (for Cloud) | Sovereignty attaches to Mind + Ground only. **Never to Cloud.** |
| "we built our own model" | "We train Shamwari Mind. We route Shamwari Cloud." |

Kimi K3's licence: broadly permissive, but requires a separate agreement for
Model-as-a-Service operators above $20M revenue over any 12 months, and
attribution above 100M MAU or $20M monthly revenue. Nowhere near either
threshold. **Read the LICENSE file directly before shipping** — do not trust
this summary.

---

## Architecture

```
Client
  │
  ▼
gateway/          Cloudflare Workers, TypeScript
                  routing · KV auth cache · AI Gateway · scope gate · queue producer
                  holds NO database credentials, never talks to Mongo
  │
  ├──► Cloudflare AI Gateway ──► Qwen (economy) / Kimi K3 (standard)
  │         └─ degradation: gateway → direct provider → Workers AI
  │
  └──► core/      FastAPI on Nyuchi infrastructure
                  owns MongoDB · Ground retrieval · auth · scope enforcement
                    │
                    ├──► MongoDB Atlas    conversations, usageEvents, knowledgeBase
                    └──► Supabase Postgres  training corpus, audit trail
```

### Why TypeScript at the edge, not Rust

A gateway is I/O-bound — HTTP routing, header rewriting, `fetch`. Zero
CPU-bound work. workers-rs compiles to WASM, costing bundle size and cold-start
time, and the bindings this depends on (AI Gateway, Queues, KV) are
TypeScript-first. Rust earns its place in the future `deno_core` sandbox host
and in queue consumers doing real computation. **Not in the gateway.**

### Why Core exists

MongoDB's Atlas Data API was removed in September 2025. The native driver
technically works in Workers via node:net/node:tls but is not
production-hardened — cold starts and Atlas connection limits are live
concerns. So something must front Mongo. Given that, Core is also the right
place for scope enforcement, because it needs to live where Cloudflare cannot
see it.

Because Core is where rule 1 is enforced authoritatively, its dependencies are
**pinned with hashes**. `core/requirements.in` is the hand-edited spec;
`core/requirements.txt` is generated by `pip-compile --generate-hashes` and
must not be edited by hand. `core/check_lock.py` runs in CI and fails if the
spec names something the lock does not pin — a stale lockfile does not break,
it quietly stops describing the spec. The lock resolves for CPython 3.11 on
Linux, matching CI and the deploy target; on macOS or Windows the
platform-specific `uvicorn[standard]` wheels will not satisfy the hashes, so
develop against `requirements.in` there.

### Cloudflare is an enhancement, never a dependency

Three-step degradation in `gateway/src/gateway.ts`. Every response carries
`inference_path` (`gateway` | `direct` | `workers-ai`). The fallback paths are
what make the claim true, and **on a healthy day nothing reaches them** —
step 2 runs only when step 1 fails, step 3 only when both do — so they rot
silently and the rot is invisible until the outage that needs them.

This used to say "break the Gateway credential deliberately once a month".
That was a manual chore, and skipping it looks exactly like passing it. It is
now a weekly cron: `probe()` exercises all three paths **independently** and
writes one row to `platform.serviceHealth`. `gateway.ts` therefore exposes
`viaGateway` / `viaDirect` / `viaWorkersAI` separately and `infer()` composes
them — a probe built on `infer()` would only ever report on the gateway,
because `infer()` stops at the first success.

`docs/degradation-probe.md` has what to alert on. The short version:
`serviceable: false` pages someone; `directOk`/`workersAiOk` false for two
consecutive weeks means a fallback has rotted while users noticed nothing.

---

## ALREADY APPLIED TO LIVE DATABASES — do not re-run

### Supabase `shamwari_ai_db` (project `hxjblxsheosjbjqgmlhx`, eu-west-1, PG17)

Applied as migrations on 2026-08-27:
- `add_license_class_provenance_gate` — `license_class` enum; columns on
  `documents`, `chunks`, `synthetic_jobs`; CHECK on `synthetic_jobs`;
  `mind_training_chunks` and `corpus_coverage` views
- `add_ground_freshness_tracking` — `authority`, `jurisdiction`,
  `resource_type`, `refresh_cadence`, `last_checked_at`, `ground_eligible`,
  `mind_eligible` on `corpus_sources`; `effective_from`, `superseded_by`,
  `mongodb_ground_id` on `documents`; `ground_refresh_due` view
- `add_license_gate_to_news_feeds` — `license`, `license_class`,
  `ground_eligible`, `mind_eligible` on `news_api_sources` + CHECK

Data seeded: 4 datasets (`zw-law-v1`, `zw-tax-v1`, `zw-monetary-v1`,
`zw-statistics-v1`), 12 corpus sources. Existing seeds' eligibility flags set.

`db/supabase/02-training-additions-REFERENCE.sql` is a **reference copy of an
earlier draft**. It does not match what was applied. Read the live schema, not
that file.

Pre-existing schema (26 migrations, Mar–Jun 2026) was already well-built:
13 public tables, `identity` schema (FK anchors only), `system` schema, RLS
with service_role/authenticated split. Security advisors return zero lints.
**Do not restructure it.**

### MongoDB Atlas `nyuchi-platform-doc-db` (project `6989ca17b7b03d132b6deb78`)

Indexes created 2026-08-27:
- `shamwari.knowledgeBase` — `ground_vector_search` (vectorSearch, 1024 dims,
  cosine, scalar quantization; filters: isActive, resourceType, ownerEntityId,
  jurisdiction, language, supersededBy) · `ground_text_search` (Atlas Search,
  lucene.english) · `source_ordinal` · `freshness_scan`. **Both search indexes
  are READY and queryable.**
- `shamwari.groundMisses` — collection created + `roadmap_scan`
- `shamwari.conversations` — `promotion_scan`
- `shamwari.messages` — `provenance_scan`
- `shamwari.guardrails` — `active_rules`

`db/mongodb/mongo-setup-REFERENCE.js` is an **earlier draft that does not match
the live cluster**. It proposes collections that already exist under different
names. Reference only.

### Collections that already existed — use these, do not create new ones

| Need | Existing collection | Existing index to use |
|---|---|---|
| accounts | `entity.entities` (12,298 docs) | — |
| persons | `identity.persons` | — |
| API keys | `platform.apiKeys` | `keyPrefix` |
| usage/billing | `platform.usageEvents` | `apiKeyId+billingPeriod`, `ownerEntityId+billingPeriod` |
| rate limits | `platform.rateLimits` | — |
| conversations | `shamwari.conversations` | `ownerPersonId+lastMessageAt`, `surfaceContext+lastMessageAt` |
| messages | `shamwari.messages` | `conversationId+sequence` |
| Ground chunks | `shamwari.knowledgeBase` | `ground_vector_search` |

Also present, unused so far: `platform.signingKeys`, `auditLog`,
`featureFlags`, `serviceHealth`, `jobRuns`, `ucpCapabilities`, `ucpProfiles`,
`paymentHandlers`.

### Embedding model — locked

`@cf/baai/bge-m3`, **1024 dimensions**. Matches `ground_vector_search` and the
23,218 already-embedded documents in `news.articles`. Multilingual, which is
why it was chosen — it handles Shona and Ndebele.

Changing this means re-embedding two corpora and rebuilding two indexes.
`ingest_ground.py` hard-fails on a dimension mismatch rather than writing
unqueryable vectors. Keep that behaviour.

---

## Current state

| Piece | Status |
|---|---|
| Supabase schema + provenance gates | live, advisors clean |
| Mongo indexes, Ground vector + text | live, READY |
| 22 corpus sources seeded | 5 blocked pending licence review |
| `core/` | written, syntax-verified, **not deployed** |
| `gateway/` | written, typecheck clean, structural assertions pass, **not deployed** |
| rule-1 enforcement downstream of the gate | fixed 2026-08-27, 3 defects, tests added |
| `shamwari.knowledgeBase` content | **EMPTY — this is the only blocker to a demo** |

### The single next step

Deploy Core, then ingest the Constitution:

```bash
cd core
python ingest_ground.py --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 --effective-from 2013-05-22 --dataset zw-law-v1
```

It is the only legal source currently approved, ground-eligible **and**
mind-eligible. Public domain, foundational, and it makes the citation demo real.

---

## Blocked on human decisions — do not resolve these in code

Five corpus sources are `is_approved = false` because their terms have not been
read. `ingest_ground.py` **refuses** them rather than warning and continuing.
Keep that behaviour.

| Source | Why blocked |
|---|---|
| ZimLII | Likely CC-BY via AfricanLII/Laws.Africa. **Highest-value unblock, probably a 5-minute read.** |
| Veritas Zimbabwe | Best SI coverage in Zimbabwe. Partnership candidate — approach before scraping. |
| AGRITEX | Ministry terms unconfirmed |
| MoHCC / EDLIZ | Clinical accuracy — human review mandatory before Ground eligibility |
| ZIMSEC | **DO NOT SCRAPE.** Copyrighted, needs a licence agreement. Probably the most commercially valuable education asset once licensed. |

Scraped news (`news.articles`, 23,231 docs) is Ground-eligible with citation
and link-out. **Not** Mind training data without a redistribution licence.

---

## Known inconsistency in upstream sources

`bundu.org` describes four pillars governed by the Foundation, with Nyuchi as
one pillar. The Mzizi registry's `bundu` entry describes three pillars with
Nyuchi as parent. **These contradict.** The registry is what MCP agents load
first, so the stale one will propagate into generated copy. Worth fixing
upstream; not something to paper over here.

---

## Deliberately not in this phase

Streaming responses · semantic caching · premium tier (Claude/GPT) ·
self-serve billing · Shamwari Mind · `code.shamwari.ai` sandboxes ·
voice and image.

On voice and image, when that phase starts — three findings from the
catalogue check on 2026-08-27, so they are not rediscovered:

- **The scope gate has to come with them.** `gateway/src/scope.ts` guards
  `/v1/chat/completions` only. A voice note or a photo is the most personal
  thing a user sends: a clinic recording, a payslip, a child. Any new
  endpoint must pass `parseScope` and `decideDestination` before a byte
  reaches a provider, or rule 1 is broken by the feature that looks least
  like text.
- **`licenseClass` stops working per tier.** It is derived from the tier in
  `router.ts` today. Deepgram Aura and the Leonardo image models are
  proprietary; FLUX `dev` is restricted while `schnell` is not; Whisper is
  permissive. That has to be stamped per model.
- **There is no Shona or Ndebele text-to-speech in the catalogue.** Aura is
  English and Spanish, MeloTTS covers neither. Voice *output* in either
  language cannot be served from Cloudflare at all. Whisper has some Shona
  in its training mix, so voice *input* is worth measuring rather than
  assuming.

Vision has one convenience: `@cf/qwen/qwen3.8-27b` is Image-Text-to-Text
and the same family as the text tier, so image input needs no new provider.

`docs/workers-ai-models.md` has the verified model ids for all of it.

On sandboxes, when that phase starts: Cloudflare Sandbox SDK went GA April
2026 and does per-session containers with code interpreters and live preview
URLs. Start on `transport: "rpc"` and tunnels — WebSocket transport and
`exposePort()` were deprecated with a 9 July 2026 cutoff, so most tutorials are
stale. But note it runs on Cloudflare Containers, so **personal-scope artifacts
cannot execute there** under rule 1. That needs a Rust + `deno_core` backend
behind a shared `SandboxProvider` interface. Deno cannot run on Workers — they
are competing runtimes.

Meter usage now, invoice the first ten customers by hand. You want to be
talking to them anyway.
