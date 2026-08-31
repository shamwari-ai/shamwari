# Splitting the monorepo

The ordering below is **agreed** (2026-08-27). The risk section is the part
worth re-reading before each extraction, not the repo list.

## Proposed repositories

| Repo | Contents | Deploys to | Language | Why it is its own repo |
|---|---|---|---|---|
| `shamwari-gateway` | `gateway/` | Cloudflare Workers | TypeScript | Already standalone — own lockfile, own `wrangler deploy`, touches no other component's files. Deploys on its own cadence, several times a day if routing is being tuned. |
| `shamwari-core` | `core/` + `db/` | Nyuchi infrastructure | Python | Owns MongoDB and Postgres. `db/` goes with it, not on its own: `ingest_ground.py` writes to both stores and the schema is meaningless apart from the service that reads it. |
| `shamwari-docs` | `docs-site/` | `docs.shamwari.ai`, on Cloudflare Workers | Astro + MDX, static output | Public-facing, no bindings, no secrets. Anyone in the org should be able to fix a typo without touching a repo that can deploy inference. |
| `shamwari` (this one) | `CLAUDE.md`, `README.md`, `docs/`, `LICENSE`, `NOTICE`, `scripts/` | nothing | — | The umbrella. Handoff context, the applied-migration log, architecture and GTM, the repo index. Keeps the name so the ecosystem's front door does not move. |

Later, when those phases open:

| Repo | Contents |
|---|---|
| `shamwari-mind` | Training pipeline, QLoRA config, eval harness. Reads `mind_training_chunks` and nothing else. |
| `shamwari-web` | `shamwari.ai` — the consumer surface. |
| `shamwari-platform` | `platform.shamwari.ai` — the console: keys, usage, billing. Astro, with TypeScript or Rust underneath. |
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

Fix before splitting, not after: have Core export its OpenAPI document —
FastAPI already generates it at `/openapi.json` — commit it to `shamwari`,
and generate the Worker's types from it. That turns a drift class into a
build error. `GroundQuery.embedding` being pinned to exactly 1024 floats is
the kind of constraint that should be enforced by generated types rather
than by a comment.

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
2. **Extract `shamwari-docs`.** Lowest risk: no secrets, no dependencies,
   no coupling. A good rehearsal of the mechanics.
3. **Extract `shamwari-gateway`.** Already self-contained. Its CI job moves
   across almost verbatim.
4. **Extract `shamwari-core` with `db/`.** Needs the Python CI job and the
   deploy target moved.
5. **Leave `shamwari` as the umbrella.** Rewrite its README as an index of
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
- **Do not point a new repo at the old Vercel projects.** The SvelteKit web
  and platform apps were removed from this repo in the pivot, but their
  Vercel projects still exist on Vercel's side and now build from a tree
  that has no app in it. Delete or re-target them deliberately rather than
  leaving them failing.

- **Do not split before the demo works.** `shamwari.knowledgeBase` is still
  empty and Core is not deployed. Repo surgery competes for attention with
  the only task that turns this into a working product.
