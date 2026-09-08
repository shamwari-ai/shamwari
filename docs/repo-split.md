# Splitting the monorepo

The ordering below was **agreed 2026-08-27** and is **updated 2026-09-08**:
`shamwari-web` and `shamwari-platform` move out of the "later" table and into
the active plan — see [Runtime and framework choices](#runtime-and-framework-choices)
and [Suggested order](#suggested-order) below. The risk section is the part
worth re-reading before each extraction, not the repo list.

One thing to be precise about before anything else: **everything here runs
on Cloudflare Workers, not Deno.** They are separate, competing edge
runtimes — Workers runs `workerd` via `wrangler`; Deno Deploy is a different
platform entirely, with no path for one to host the other. `gateway/` is
already plain TypeScript on Workers for exactly this reason (see `CLAUDE.md`,
"Why TypeScript at the edge, not Rust"), and nothing below changes that.
Deno appears exactly once in this codebase's plans — `deno_core` embedded in
a **Rust** sandbox host for `code.shamwari.ai`, because personal-scope
artifacts can't execute on Cloudflare Containers under rule 1. That is an
embedded library, not a deployment target, and it has nothing to do with
these three repos.

## Runtime and framework choices

All three active repos below deploy to Cloudflare Workers. They split on
what they render, not on where they run:

- **`shamwari-gateway`** is a pure JSON API — three routes
  (`/health`, `/v1/chat/completions`, `/v1/ground/context`) plus a queue
  consumer and a cron handler, none of which render a page. Today's
  `src/index.ts` dispatches those three routes with a hand-rolled chain of
  `if (url.pathname === ...)` checks. **Moving this onto
  [Hono](https://hono.dev)** is the concrete next step for this repo:
  Hono is Workers-native (built for `workerd`, not a compatibility shim),
  adds no meaningful cold-start cost for three routes, and replaces the `if`
  chain with an `app.get`/`app.post` table that's easier to extend when
  voice/image endpoints arrive (see `CLAUDE.md`'s note that the scope gate
  has to come with them). Hono only wraps the `fetch` export — the `queue`
  and `scheduled` exports in `index.ts` stay exactly as they are; Hono has
  no opinion about either.
- **`shamwari-web`** and **`shamwari-platform`** render pages for humans —
  Astro, with server-side rendering on Workers. Astro is a site framework,
  not a routing shim, so there's no overlap or conflict with Hono: Astro
  owns page routing and layout for those two repos, Hono owns endpoint
  routing for the gateway. Each repo uses the tool suited to its own job.

## Proposed repositories

| Repo | Contents | Status | Deploys to | Framework | Why it is its own repo |
|---|---|---|---|---|---|
| `shamwari-gateway` | `gateway/` | Written, typecheck clean, **not deployed**. Not yet on Hono. | Cloudflare Workers | TypeScript, moving to Hono | Already standalone — own lockfile, own `wrangler deploy`, touches no other component's files. Deploys on its own cadence, several times a day if routing is being tuned. |
| `shamwari-web` | `site/` | `site/` exists today as a **static** Astro build (no bindings, no SSR) with routes already claiming `shamwari.ai` / `www.shamwari.ai` at the apex. The desired end state (`docs/desired-cloudflare-state.md`) is Astro **SSR** with `UserObject`/`ConversationObject` Durable Object bindings — a real gap, not just an extraction. | Cloudflare Workers | Astro (SSR) | The apex is currently the most broken thing in the ecosystem: per `docs/scaling-and-memory.md`, "Nowhere" is what actually resolves — the SvelteKit app that served it was removed in the pivot, and the stale Vercel project it left behind is still configured to build a tree with no app in it. Extracting this repo is also how that gets retired. |
| `shamwari-platform` | doesn't exist yet | Not started. The console needs three Core endpoints that don't exist yet: key issuance, key revocation, and a per-key usage breakdown (`GET /rollup` and `POST /auth/verify` already exist and cover the rest). | Cloudflare Workers | Astro (SSR) | `platform.shamwari.ai` — keys, usage, billing. Shows `platform`-scope data about a customer's own account, never `personal`-scope pod data, so it sits outside rule 1 entirely — the easiest of the active repos to build correctly. Rust is not warranted here: a console rendering someone else's aggregates has no CPU-bound work; save Rust for the sandbox host. |
| `shamwari-core` | `core/` + `db/` | Written, syntax-verified, **not deployed**. | Nyuchi infrastructure | Python / FastAPI | Owns MongoDB and Postgres. `db/` goes with it, not on its own: `ingest_ground.py` writes to both stores and the schema is meaningless apart from the service that reads it. |
| `shamwari-docs` | — | **Already extracted**, to `shamwari-ai/docs`. | `docs.shamwari.ai`, Cloudflare Workers (static) | Mintlify | Public-facing, no bindings, no secrets. Anyone in the org should be able to fix a typo without touching a repo that can deploy inference. |
| `shamwari` (this one) | `CLAUDE.md`, `README.md`, `docs/`, `LICENSE`, `NOTICE`, `scripts/` | Ongoing — the umbrella. | nothing | — | Handoff context, the applied-migration log, architecture and GTM, the repo index. Keeps the name so the ecosystem's front door does not move. |

Later, when those phases open:

| Repo | Contents |
|---|---|
| `shamwari-mind` | Training pipeline, QLoRA config, eval harness. Reads `mind_training_chunks` and nothing else. |
| `shamwari-sandbox` | `code.shamwari.ai`. Rust + `deno_core` behind a shared `SandboxProvider`, because personal-scope artifacts cannot execute on Cloudflare Containers under rule 1. |

## What the split costs

Splitting is not free here, and the cost lands precisely on the two rules
that must not be broken.

### Rule 1 is enforced in two repos, and neither can test the pair

The scope gate is deliberately duplicated: `gateway/src/scope.ts` fails
fast, `core/main.py::resolve_scope` is authoritative. Today one CI run
covers both. Split them and `shamwari-gateway`'s tests prove only that the
Worker refuses personal-scope requests, while `shamwari-core`'s prove only
that Core does. Nothing proves they still agree — and "they agree" is the
whole claim.

Both currently define the same set independently:

```ts
const CLOUD_SAFE: ReadonlySet<Scope> = new Set<Scope>(['community', 'platform']);
```
```python
CLOUD_SAFE: frozenset[Scope] = frozenset({Scope.COMMUNITY, Scope.PLATFORM})
```

That duplication is the point — a shared library would collapse two checks
into one, and one check is what the design is guarding against. So the fix
is not to deduplicate. It is a **contract test that runs in both repos**:
a small fixture file of `(scope, destination) -> expected outcome` rows,
committed to `shamwari` and vendored into each, asserting identical
behaviour. Cheap, and it fails loudly when someone edits one side.

### The Worker→Core HTTP contract has no schema

The Worker calls five endpoints and hand-writes the request and response
types in TypeScript; Core declares them in Pydantic. Nothing checks them
against each other. In one repo that is a code review away from being
caught. Across two repos it is a production 500.

| Worker calls | Core serves |
|---|---|
| `POST /auth/verify` | ✓ |
| `POST /ground/search` | ✓ |
| `POST /sink/bulk` | ✓ |
| `GET /rollup` | ✓ |
| — | `GET /guardrails` (built, unused) |
| — | `GET /health` |
| *(needed for `shamwari-platform`)* | key issuance — **missing** |
| *(needed for `shamwari-platform`)* | key revocation — **missing** |
| *(needed for `shamwari-platform`)* | per-key usage breakdown — **missing** |

Fix before splitting, not after: have Core export its OpenAPI document —
FastAPI already generates it at `/openapi.json` — commit it to `shamwari`,
and generate the Worker's types from it. That turns a drift class into a
build error. `GroundQuery.embedding` being pinned to exactly 1024 floats is
the kind of constraint that should be enforced by generated types rather
than by a comment. The three missing endpoints above block `shamwari-platform`
specifically and should be added to Core before that repo's extraction
starts, not discovered mid-build.

### `licenseClass` spans everything

Nineteen files mention it: the Worker stamps it, Core rejects rows without
it, Postgres has a CHECK constraint on it, and the docs explain it. It is
already a cross-cutting invariant, and the split does not make that worse
so much as make it less visible. The umbrella repo should hold the one
canonical statement of what the values mean, and each repo should link to
it rather than restate it.

## Suggested order

1. **Add the contract test and the generated types first, while everything
   is still in one repo** and a mistake is a red CI run rather than an
   outage.
2. ~~Extract `shamwari-docs`.~~ **Done** — now `shamwari-ai/docs`.
3. **Migrate `gateway/` to Hono, then extract `shamwari-gateway`.** Already
   self-contained; its CI job moves across almost verbatim. Do the Hono
   migration *before* the extraction, in this repo, so a routing mistake is
   caught by the existing test suite rather than surfacing as a fresh
   repo's first bug.
4. **Extract `shamwari-web`.** Start from `site/`'s existing static build —
   it already owns the `shamwari.ai` / `www.shamwari.ai` routes — then do
   the SSR + Durable Object work `docs/desired-cloudflare-state.md` calls
   for. This is also the point at which the stale pre-pivot Vercel project
   should be retired (see "What not to do" below): don't leave it building
   a tree with no app in it once a real Worker is serving the apex.
5. **Add the three missing Core endpoints** (key issuance, revocation,
   per-key usage breakdown), then **extract `shamwari-platform`.** `platform`
   scope only, so it's unblocked by step 1 and carries none of rule 1's
   risk — but it has no code to extract yet, so it's scaffolded fresh
   rather than lifted out.
6. **Extract `shamwari-core` with `db/`.** Needs the Python CI job and the
   deploy target moved.
7. **Leave `shamwari` as the umbrella.** Rewrite its README as an index of
   the others; keep `CLAUDE.md` here, because the applied-migration log and
   the two rules govern all of them.

Use `git subtree split` rather than a fresh `git init`, so each extracted
repo keeps the history of its own files. The reasoning in these commit
messages is most of the documentation.

## What not to do

- **Do not extract `db/` on its own.** Schema without the service that
  owns it invites someone to run a migration nobody is testing against.
  `CLAUDE.md` already records what is applied to live databases; that
  record must stay next to the code that depends on it.
- **Do not put the scope gate in a shared package.** Two independent
  implementations is the design. Deduplicating them removes the defence in
  depth and leaves the sovereignty claim resting on one function.
- **Do not point `shamwari-web` at the old Vercel project.** The SvelteKit
  web app was removed from this repo in the pivot, but its Vercel project
  still exists on Vercel's side and now builds from a tree that has no app
  in it. Delete or re-target it deliberately as part of the `shamwari-web`
  extraction, rather than leaving it failing (or worse, silently serving a
  stale build) alongside a working Worker.
- **Do not add Hono to `shamwari-web` or `shamwari-platform`, or Astro to
  `shamwari-gateway`.** They aren't interchangeable here — one is a routing
  library for an API with no pages, the other is a site framework for pages
  with no need for route-table middleware. Matching the tool to the repo is
  the point of the split.
- **Do not split before the demo works.** `shamwari.knowledgeBase` is still
  empty and Core is not deployed. Repo surgery competes for attention with
  the only task that turns this into a working product.
