# Shamwari Cloud — edge gateway

TypeScript on Cloudflare Workers. Routing, caching, AI Gateway, scope gate.
Holds no database credentials and never talks to MongoDB.

## Why TypeScript and not Rust

A gateway is I/O-bound: HTTP routing, header rewriting, `fetch`. No CPU-bound
work. workers-rs compiles to WASM, costing bundle size and cold-start time,
and the bindings this depends on — AI Gateway, Queues, KV — are
TypeScript-first. Rust earns its place in the `deno_core` sandbox host and in
queue consumers doing real computation. Not here.

## The scope rule

| Layer | Content | May reach Cloud? |
|---|---|---|
| `personal` | the user's own pod data | **No** |
| `community` | anonymised platform data | Yes |
| `platform` | base Mukoko knowledge | Yes |

Callers declare scope; `platform` is the default. A personal-scope request
returns **409 `scope_requires_local_inference`** while `MIND_AVAILABLE` is
false. It is not silently downgraded — a downgrade answers confidently while
withholding the user's own data, with no signal anything was missing.

Enforced in `src/scope.ts` (fast fail) and again in Core's `resolve_scope`
(authoritative). Two checks, because one is a single bug away from a leak.

## Setup

```
wrangler kv namespace create AUTH_CACHE     # paste id into wrangler.jsonc
wrangler queues create shamwari-sink
wrangler queues create shamwari-sink-dlq

wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_AIG_TOKEN
wrangler secret put SHAMWARI_CORE_TOKEN
wrangler secret put QWEN_API_KEY
wrangler secret put MOONSHOT_API_KEY

npm run dev
```

Shamwari Core must be reachable at `CORE_URL` first.

## Tier routing

`routing-policy.json` holds the tuning surface of the heuristic: the default
tier, the public model aliases, the escalation thresholds, and the hard-task
keyword list bucketed by language. Edit it and redeploy to retune routing
without touching TypeScript.

What is deliberately *not* in it: tier identity, provider slugs, direct
provider URLs, API key bindings, and `licenseClass`. Those are
provenance-bearing and stay in `src/router.ts`, because Core rejects
restricted rows from the Mind training path on the strength of what that file
stamps. Model ids stay in the `ECONOMY_MODEL` and `STANDARD_MODEL` wrangler
vars, which are already the no-code-edit place to change a model.

`validatePolicy` runs at module load and refuses a policy that parses but
means something different — an unknown tier name, a threshold of zero, an
uppercase keyword the lowercased match could never fire on. The Worker fails
to serve rather than silently routing everything to one tier. `npm test`
validates the shipped file, so that failure lands in CI rather than in
production.

The keyword buckets are `en`, `sn` and `nd`. Ndebele is empty today; that is
a visible gap rather than a hidden one.

## AI Gateway dynamic route

`dynamic-route.json` specifies the route for AI Gateway's Dynamic Routing.
It validates against Cloudflare's own `POST /routes` schema, and its graph
is checked by `test/dynamic-route.test.ts` — one start, one end, no dangling
`elementId`, every element reachable, and no restricted provider anywhere.

```
start → budget_month (cost cap)
          success  → tier_check
          fallback → economy_qwen
        tier_check (metadata.tier == "standard")
          true  → standard_kimi → fallback → economy_qwen
          false → economy_qwen  → fallback → workers_ai → done
```

The feature is in Beta.

**The dashboard has no JSON import.** The Create dialog takes only a name
and a template, and the Editor is a visual canvas. So `dynamic-route.json`
is the *specification* — the record of what the route should be, guarded by
the tests — and the route itself is built by hand from the table below.
Keep the two in step: if you change the route in the dashboard, change the
JSON to match, or the next person reads a file that lies.

### One command, if you have an API token

The dashboard has no JSON import, but the REST API does accept the payload
— despite the docs page saying Dynamic Routing is not on the REST API, it is
in Cloudflare's OpenAPI schema. This creates the route, finds its version
and deploys it, which is the step that is easy to miss by hand:

```bash
export CF_ACCOUNT_ID=... CF_API_TOKEN=...   # token needs AI Gateway edit
./scripts/create-dynamic-route.sh
```

It checks `success` in the response body rather than the status code,
because Cloudflare returns 200 with `success: false` for domain errors, and
it prints the read-back command for the two undocumented fields. Build by
hand only if you would rather not mint a token.

### Build it by hand

Create the route: name it `shamwari` (so calls read
`model: "dynamic/shamwari"`) and choose **Start from scratch**.

Do *not* choose "Start from example", despite the RECOMMENDED badge — it
wires a `gpt-4o` OpenAI node, which is rule 2 broken before the route
serves a single request. See the open-weight section below.

The name is fixed in the UI. `PATCH /routes/{id}` takes a `name`, so a
misnamed route is still recoverable.

Then add six nodes. Add them in this order so each one's target already
exists when you wire its output:

| # | Node | Type | Settings | Wire outputs to |
|---|---|---|---|---|
| 1 | `done` | End | — | — |
| 2 | `workers_ai` | Model | Workers AI · `@cf/qwen/qwen2.5-coder-32b-instruct` · timeout 15000 · retries 0 | success → `done`, fallback → `done` |
| 3 | `economy_qwen` | Model | Qwen · `qwen3-32b-instruct` · timeout 20000 · retries 1 | success → `done`, fallback → `workers_ai` |
| 4 | `standard_kimi` | Model | Moonshot · `kimi-k3` · timeout 30000 · retries 1 | success → `done`, fallback → `economy_qwen` |
| 5 | `tier_check` | Conditional | `metadata.tier` equals `standard` | true → `standard_kimi`, false → `economy_qwen` |
| 6 | `budget_month` | Budget Limit | cost · key `metadata.ownerEntityId` · limit 50 · window 2592000 (30d) | success → `tier_check`, fallback → `economy_qwen` |

Finally point **Start** at `budget_month`, then **Save** the version and
**Deploy** it — saving alone does not make it live.

Node names are for your own legibility; the editor may not let you set the
ids. What matters is the shape of the graph.

Two settings the UI will phrase its own way. The conditional's field/
operator/value builder is the one part of `dynamic-route.json` that was a
guess — the JSON shape is unpublished upstream
([cloudflare-docs#27334](https://github.com/cloudflare/cloudflare-docs/issues/27334))
— so build it in the UI and treat the UI as correct. Same for the budget
key: whether it accepts a metadata path at all is undocumented, so if
`metadata.ownerEntityId` is not offered, use whatever per-key option it
gives you and note it here.

Worth doing once the route exists, so the file stops being a guess:

```bash
ACC=$CF_ACCOUNT_ID; GW=shamwari
API=https://api.cloudflare.com/client/v4/accounts/$ACC/ai-gateway/gateways/$GW
curl -sS "$API/routes" -H "Authorization: Bearer $CF_API_TOKEN" | jq .
```

That returns the route exactly as the dashboard stored it. Copy the real
`conditions` and `key` shapes into `dynamic-route.json` and the spec becomes
accurate rather than approximate.

Then call it with `model: "dynamic/shamwari"` on `/compat/chat/completions`.

### It replaces step 1 of the degradation, not all three

`src/gateway.ts` degrades AI Gateway → direct provider → Workers AI. The
second step exists precisely because it has no Cloudflare in the path. A
dynamic route lives *inside* AI Gateway, so it cannot provide that: if the
Gateway is down, the route is down with it. Keep steps 2 and 3 in
`gateway.ts`. The route makes step 1 smarter; it does not make the rest
redundant.

### Every node must stay open-weight — this is rule 2

The Worker stamps `licenseClass` from the tier it *intended* to call, in
`targets()`. A route's fallback chain can serve the response from a
different provider than the one the Worker picked, and the Worker will not
know. Every node here is open-weight (Qwen, Kimi K3, Workers AI), so every
path through the graph is `open_weight` and the stamp stays true whichever
node answers.

Add a Claude or GPT node and that stops holding: the Worker would stamp
`open_weight` on restricted output, and Core would accept it into the Mind
training path. If premium is ever routed here, the Worker must first read
the `cf-aig-provider` and `cf-aig-model` response headers, which name the
provider that actually served the request, and stamp from those instead of
from `target`.

### Two fields to confirm in the editor

`properties.conditions` on the conditional is typed `unknown` in
Cloudflare's OpenAPI schema and in their SDKs — the shape is not published
anywhere ([cloudflare-docs#27334](https://github.com/cloudflare/cloudflare-docs/issues/27334)).
The value here is modelled on the `user_plan == "paid"` example in the docs
and is the one part of this file that is a guess. Same for what `rate.key`
accepts: the field is typed `string`, but whether it resolves a metadata
path is not documented.

Fastest way to settle both: build one conditional and one budget node in the
visual editor, then read back what the dashboard wrote —

```bash
curl -sS "$API/routes/$ROUTE" -H "Authorization: Bearer $CF_API_TOKEN" | jq .
```

and copy its exact shape into this file.

### Metadata the Worker must send

The route branches on `metadata.tier`, and the budget node keys on
`metadata.ownerEntityId`. Neither is sent today — `src/gateway.ts` posts
`model`, `messages`, `temperature` and `max_tokens` only. Wire them through
AI Gateway custom metadata before pointing traffic at the route, or
`tier_check` will always take the `false` branch and every request will go
to economy.

## Verify before deploy

- Provider slugs in `src/router.ts` against the current AI Gateway provider list
- A spend limit set in the AI Gateway dashboard — cheapest insurance available
- Exact-match caching enabled
- The Kimi K3 LICENSE file, read directly

## Degradation

AI Gateway → direct provider → Workers AI. Cloudflare is an enhancement, not
a dependency. `inference_path` in every response tells you which was used —
watch it, because steps 2 and 3 rot silently if never exercised.

## Provenance

`licenseClass` is stamped on every conversation and usage event at generation
time. Only `open_weight` may become Shamwari Mind training data; Anthropic and
OpenAI terms bar using their outputs to train competing models. Core rejects
any conversation missing a valid `licenseClass`, and Postgres
`training_examples` carries a CHECK constraint that a restricted row cannot
satisfy.

When premium tier is added, `licenseClass` stays `restricted` in
`src/router.ts`. Do not change it.

## Not in this phase

Streaming, semantic caching, premium tier, self-serve billing, Shamwari Mind,
`code.shamwari.ai` sandboxes. Meter usage now and invoice the first ten
customers by hand — you want to be talking to them anyway.
