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

| Layer       | Content                  | May reach Cloud? |
| ----------- | ------------------------ | ---------------- |
| `personal`  | the user's own pod data  | **No**           |
| `community` | anonymised platform data | Yes              |
| `platform`  | base Mukoko knowledge    | Yes              |

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

wrangler secret put SHAMWARI_CORE_TOKEN     # shared with Core

npm run dev
```

`CF_ACCOUNT_ID`, `CF_GATEWAY_ID` and `CF_ROUTE_NAME` are plain vars in
`wrangler.jsonc` (an id and a name authorise nothing). There is no provider
key: inference runs on Workers AI and is billed through Cloudflare.

The AI Gateway authentication token is `SHAMWARI_AI_TOKEN` in the account's
Secrets Store, bound to the Worker as `CF_AIG_TOKEN` in `wrangler.jsonc`. It is
read at request time with `env.CF_AIG_TOKEN.get()`; there is no `wrangler secret
put` for it.

Shamwari Core must be reachable at `CORE_URL` first.

## Tier routing

`routing-policy.json` holds the tuning surface of the heuristic: the default
tier, the public model aliases, the escalation thresholds, and the hard-task
keyword list bucketed by language. Edit it and redeploy to retune routing
without touching TypeScript.

What is deliberately _not_ in it: tier identity, provider slugs, direct
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

`dynamic-route.json` specifies the target route for AI Gateway's Dynamic
Routing; `dynamic-route-phase1.json` is the subset that needs no guesswork.
It validates against Cloudflare's own `POST /routes` schema, and its graph
is checked by `test/dynamic-route.test.ts` — one start, one end, no dangling
`elementId`, every element reachable, and no restricted provider anywhere.

```
start → budget_month (cost cap)
          success  → tier_check
          fallback → economy_glm
        tier_check (metadata.tier == "standard")
          true  → standard_glm → fallback → economy_glm
          false → economy_glm  → fallback → workers_ai → done
```

The feature is in Beta.

**The dashboard has no JSON import.** The Create dialog takes only a name
and a template, and the Editor is a visual canvas. So `dynamic-route.json`
is the _specification_ — the record of what the route should be, guarded by
the tests — and the route itself is built by hand from the table below.
Keep the two in step: if you change the route in the dashboard, change the
JSON to match, or the next person reads a file that lies.

### Paste it into the editor's JSON view

The route Editor has a JSON view, and it takes the bare `elements` array —
not the `{name, elements}` wrapper the API wants. Creating a route from
scratch seeds it with a skeleton whose conventions are worth matching:
`START` and `END` in caps, `outputs: {}` on the end node, and a blank model
node at `provider: ""`, `timeout: 0`, `retries: 0`.

Do it in two passes, because two fields have no published shape:

**Pass 1 — `dynamic-route-phase1.json`.** Paste that array. Every node is
on `workersai`, the only provider slug these model families have natively,
so it needs no custom provider and no API key:

| Node          | Model                       | Why                                                                                                                               |
| ------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `economy`     | `@cf/zai-org/glm-5.3-flash` | fast, MIT-licensed, natively multimodal — the bulk tier                                                                           |
| `standard`    | `@cf/zai-org/glm-5.3`       | GLM-5.3 flagship; both tiers are natively on Workers AI, unlike Kimi K3 before it                                                 |
| `last_resort` | `@cf/zai-org/glm-5.3-flash` | same weights as `economy`, Cloudflare-hosted — deliberately redundant, matches `WORKERS_AI_FALLBACK_MODEL` in `src/provenance.ts` |

Save and deploy; it is a working route.

It is also behaviourally identical to the full route today. `tier_check`
would take its `false` branch on every request until `src/gateway.ts` sends
`tier` as custom metadata, and `false` goes to economy — so pass 1 gives up
nothing real, it just defers the spend cap.

`docs/workers-ai-models.md` has the verified list if a newer GLM point
release is worth swapping in.

**Pass 2 — the two unknown nodes.** Add `tier_check` (Conditional) and
`budget_month` (Budget Limit) in the visual editor, wire them per
`dynamic-route.json`, and point START at `budget_month`. Then re-open the
JSON view and copy what the dashboard wrote for `properties.conditions` and
`rate.key` into `dynamic-route.json`. That is the moment the spec stops
being a guess.

**Pass 3 is not needed.** `dynamic-route.json` runs every node on
`workers-ai`: both GLM tiers are natively on Workers AI and billed through
Cloudflare, so there is no custom `zai` provider and no gateway-side key to
manage (owner decision, 2026-10-21, tracked on #53). There is also no direct
third-party step any more: the Worker calls the route, and falls back to the
Workers AI binding.

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

Do _not_ choose "Start from example", despite the RECOMMENDED badge — it
wires a `gpt-4o` OpenAI node, which is rule 2 broken before the route
serves a single request. See the open-weight section below.

The name is fixed in the UI. `PATCH /routes/{id}` takes a `name`, so a
misnamed route is still recoverable.

Then add six nodes. Add them in this order so each one's target already
exists when you wire its output:

| #   | Node           | Type         | Settings                                                              | Wire outputs to                                  |
| --- | -------------- | ------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `done`         | End          | —                                                                     | —                                                |
| 2   | `workers_ai`   | Model        | Workers AI · `@cf/zai-org/glm-5.3-flash` · timeout 15000 · retries 0  | success → `done`, fallback → `done`              |
| 3   | `economy_glm`  | Model        | Workers AI · `@cf/zai-org/glm-5.3-flash` · timeout 20000 · retries 1  | success → `done`, fallback → `workers_ai`        |
| 4   | `standard_glm` | Model        | Workers AI · `@cf/zai-org/glm-5.3` · timeout 30000 · retries 1        | success → `done`, fallback → `economy_glm`       |
| 5   | `tier_check`   | Conditional  | `metadata.tier` equals `standard`                                     | true → `standard_glm`, false → `economy_glm`     |
| 6   | `budget_month` | Budget Limit | cost · key `metadata.ownerEntityId` · limit 50 · window 2592000 (30d) | success → `tier_check`, fallback → `economy_glm` |

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

### It is step 1 of two

`src/gateway.ts` degrades AI Gateway route → Workers AI binding. A dynamic
route lives _inside_ AI Gateway, so if the Gateway is down the route is down
with it; the binding is called directly, with no Gateway in the path. Keep
the second step in `gateway.ts`. The route makes step 1 smarter; it does not
make the binding redundant.

### Every node must stay open-weight — this is rule 2

The Worker stamps `licenseClass` from the tier it _intended_ to call, in
`targets()`. A route's fallback chain can serve the response from a
different provider than the one the Worker picked, and the Worker will not
know. Every node here is open-weight (GLM-5.3, GLM-5.3-Flash, Workers AI), so
every path through the graph is `open_weight` and the stamp stays true
whichever node answers.

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
- The GLM-5.3 LICENSE file, read directly
  (<https://huggingface.co/zai-org/GLM-5.3/raw/main/LICENSE>)

## Degradation

AI Gateway route → Workers AI binding. Both are Cloudflare, so Cloudflare is
the dependency; the second step only takes the AI Gateway out of the path.
`inference_path` in every response tells you which was used — watch it,
because step 2 rots silently if never exercised.

A third rung sits beneath both: **extractive**. Ground's cited passage is
returned with no generation, either because the caller sent
`"mode": "extractive"` or because every inference path failed and Ground had a
hit (`shamwari.degraded: true`). It makes no inference call, cannot invent a
citation, and is metered as a usage event only: no conversation row is
written, because it has no teacher model to stamp a `licenseClass` from and the
quoted chunks carry their own `mind_eligible` terms. The scope gate runs
first, so personal scope is still a 409. It does not judge relevance: Ground
returns the nearest passage whether or not it answers the question, so the
citation reads "Closest source", and `shamwari.truncated` says when a passage
was cut. If Core cannot be reached, `mode: "extractive"` returns 503
`ground_unavailable` rather than claiming the corpus has nothing. A model
reply with no text counts as a failure at both inference steps, so the next
rung engages. See `docs/tiered-access-design.md`.

## Reach

How the caller reaches Shamwari, sent as `"reach": "r0" | "r1" | "r2"` on
`/v1/chat/completions` (r0 SMS/USSD, r1 chat app, r2 Lite PWA; see
`docs/tiered-access-design.md`). An unknown value is a 400 `invalid_reach`, and
a request with no reach behaves exactly as before. For the model tier and the
generation length, reach is a **ceiling, never a floor**, set in
`routing-policy.json`:

- `max_tier` clamps the routed model tier down (r0 cannot reach `standard`).
  `premium` is never a reach ceiling: the policy validator rejects it, so a
  channel alone cannot choose a model with different terms and cost. The tier
  it was routed to before the clamp is recorded as `routedTier`.
- `max_output_tokens` caps generation. It can only lower the 2048 default (the
  validator rejects more), and `finish_reason: "length"` and
  `shamwari.truncated` say when the cap cut an answer off.
- `extractive_max_chars` is different: it is the **length budget of that
  channel** for an extractive answer, not a ceiling over a default (a request
  with no reach keeps the 450-character default, so r1 and r2 may return
  more). On r0 the text is also plain: typographic quotes, dashes and the
  ellipsis become ASCII, because one such character forces an SMS into UCS-2.

The response carries `shamwari.reach` and `shamwari.reach_clamped`, and the
usage event and conversation record the reach, so per-tier cost can be read
from `usageEvents`. Reach changes nothing about scope: r0 to r2 all hand text to
a provider, so personal scope is still a 409 on every one of them. The clamped
tier's `licenseClass` still comes from `router.ts`, never from the policy file.

## Idempotent requests and the compact envelope

Two opt-ins on `/v1/chat/completions` for callers on weak networks, where a
request is often retried and every byte is paid for.

**`Idempotency-Key`** (1 to 64 of `A-Za-z0-9_.:-`; otherwise 400
`invalid_idempotency_key`). A retry with the same key and the same request
returns the stored answer with `Idempotent-Replayed: true` and runs no Ground,
no inference and no usage event. The same key with a different request
(messages, model, scope, mode, reach or format) is a 422
`idempotency_key_reuse`. A request still running is a 409 `request_in_progress`
with `Retry-After`. Only a 200 is stored; a failure is released so the retry
runs. Keys are scoped to the calling entity. A replay skips the quota check (the
caller already earned that answer), and a degraded answer (every inference path
failed, Ground answered) is not stored, so the retry can get a proper one.

- It fails open: a KV error is logged and the request runs unprotected. It is
  best-effort, not exactly-once. It uses the existing KV namespace, which
  is eventually consistent, so two simultaneous first attempts in different
  locations can both run. It stops the common retry; it does not make billing
  exact. For that the sink must also dedupe on the request id.
- What is stored is the response body for ten minutes, under a hash of the key.
  **Personal scope stores nothing**: it is refused before this code runs, and a
  stored answer would be a second copy of the user's data outside their pod.

**`"format": "compact"`** (minified; on r0 the labels are plain ASCII) returns
`{id, answer, cites: [{n, label, url?}], scope, via, truncated, degraded}`
instead of the OpenAI-shaped body. Every channel adapter reads this one shape.
An unknown format is a 400 `invalid_format`. It is applied last, so the
extractive rung and a replay agree with the inference rung.

## Channels: SMS and USSD

`POST /v1/channels/sms` and `POST /v1/channels/ussd` take a message from an
operator and answer in that channel's own limit (459 characters for SMS, three
GSM-7 segments; 182 for a USSD screen), as plain ASCII, with one source line.
They are clients of the gateway, like Mind: the adapter calls
`/v1/chat/completions` in-process with the channel's own key, so quota,
scope, provenance and idempotency are the ones every API caller gets.

- **The operator is verified first.** The body is signed with HMAC-SHA256 in
  `X-Signature`. A bad or missing signature is a 401, and a channel missing
  either secret below is a 503. Nothing is called in either case.
- **Rule 1.** The scope belongs to the adapter (`platform`), never to the
  message, so a person cannot declare `personal`. An adapter that carried it
  would be refused at the adapter, before the chat path, with a short message
  that points to the app. The chat path checks again.
- **The sender is never forwarded.** A phone number is not in the chat
  request, the idempotency key, the stored conversation or a log line; the
  tests scan every outbound call for it. The operator's message id and the text
  are hashed into the idempotency key, so an operator retry is the same answer.
- **The wire formats are placeholders** (`{id, from, text}` to `{reply}`;
  `{sessionId, msisdn, input}` to `{message, end}`) until an operator or
  aggregator is chosen. A real one changes `parse` and `render` in
  `src/channels/sms.ts` or `ussd.ts` and nothing else.

Secrets, set by the owner (not in `wrangler.toml`): `CHANNEL_WEBHOOK_SECRET`
(shared with the operator) and `CHANNEL_API_KEY` (a customer-style key for the
entity that pays for the channel).

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
