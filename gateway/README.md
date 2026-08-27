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
