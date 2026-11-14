# AGENTS.md

How to work in this repository, for people and coding agents. Everything here is
checked against files in the repo (named in each section). If a rule here and a
file disagree, the file wins; fix this page.

`mobile/` has its own [`mobile/AGENTS.md`](./mobile/AGENTS.md) for Expo work.

## The two rules

These are the point of the project. Do not weaken either without the owner's
written sign-off.

1. **Personal-layer content never reaches a third-party inference provider.**
   Enforced in the gateway (`gateway/src/scope.ts`: `decideDestination`,
   `providerScope`) and again in Core (`core/main.py`: `resolve_scope`,
   `/ground/search`). A question the gateway's own rules flag as needing the
   person's own information (`gateway/src/personal.ts`, mirrored in
   `core/personal.py`, shared cases in `core/scope_cases.json`) is treated as
   personal scope: no edge embedding, no completion, only the cited Ground
   passage (shamwari#291).
2. **Only open-weight output may train Shamwari Mind, and storing is not
   consent.** Provenance is resolved from the model that actually served
   (`gateway/src/provenance.ts`). A conversation is trainable only with an
   explicit `trainingConsent: true` (`conversationTrainable` in
   `gateway/src/index.ts`); Core refuses a trainable row without it
   (`check_sink` in `core/main.py`). The reference schema requires both licence
   and consent (`db/supabase/01-base-schema.sql`, held by
   `core/test_schema.py`).

Each rule has tests. Read them before touching the files they cover.

## Layout

| Path         | What                                                        | Stack                          |
| ------------ | ----------------------------------------------------------- | ------------------------------ |
| `gateway/`   | the edge API: scope gate, routing, Ground retrieval, sink   | TypeScript, Cloudflare Workers |
| `core/`      | authoritative scope checks, Ground, auth, sink writes       | Python 3.11, FastAPI           |
| `site/`      | shamwari.ai landing page and the Lite chat app (`app-src/`) | Astro                          |
| `chat/`      | LibreChat config, its guard, and the `/chat` proxy Worker   | Node                           |
| `mobile/`    | the mobile app                                              | Expo / React Native            |
| `docs-site/` | stale mirror; pages moved to `shamwari-ai/docs`             | Astro                          |
| `db/`        | reference SQL and Mongo setup (not run by Core)             | SQL, JS                        |
| `scripts/`   | `e2e.sh` (Worker against real Core) and generators          | bash                           |
| `docs/`      | design notes, runbooks, decisions                           | Markdown                       |

## Build and test

What CI runs (`.github/workflows/ci.yml`), per directory. Run the ones for what
you changed before you push.

```bash
# gateway/
npm ci
npm run typecheck          # tsc --noEmit
npm test                   # vitest run

# core/  (Python 3.11 in CI)
pip install --require-hashes -r requirements.txt
python check_lock.py       # lockfile matches requirements.in
python -m unittest -v

# Worker -> real Core -> Ground contract (needs both of the above installed)
PYTHON=python bash scripts/e2e.sh

# site/  landing page
npm ci && npm run build && npm run check && npm run test:site
# site/  Lite chat app
npm run build:app && npm run check:app && npm run test:app && npm run e2e

# chat/librechat/ and chat/proxy/
npm ci && npm test

# mobile/
npm ci && npm run typecheck && npm test

# docs-site/
npm ci && npm run build && npm run check
```

There is no separate linter. The checks that stand in for one are the type
checks, `site/check.mjs` (links, tokens, size budgets, language rules), the
PR-title lint and the gitleaks secret scan, all in CI.

## Branches

- **`staging` is the integration branch.** Open pull requests against it.
- `main` is released from `staging` automatically: when CI is green on a push to
  `staging`, `release-to-main.yml` opens or updates one release PR to `main`.
  Do not open feature PRs against `main`.
- A push to `main` deploys (`deploy.yml`); `staging` pushes get a patch version
  tag (`staging-version.yml`).
- CI runs on pull requests to `main`, `staging` and `claude/**`, so a stacked PR
  targets the branch below it and still gets checks.

## Commits and pull requests

- **Conventional Commits.** The PR title is linted
  (`.github/workflows/pr-title-lint.yml`) and becomes the squash-commit subject.
  Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
  `chore`, `revert`, `style`. Scope optional (the history uses `gateway`,
  `core`, `lite`, `deploy`, ...). The subject starts lowercase, is imperative
  and has no trailing period.
- Reference the issue (`Refs #123`, or `Closes #123` only when it really closes).
- **This repository is public.** No secrets, keys, tokens, internal hostnames or
  exploit detail in code, commits, PRs or issues. gitleaks runs on every PR.
- Merging is the owner's decision.

## Language

Say "open weights", not "fully open source": Shamwari Cloud routes to
third-party models (`README.md`, Licence). Ground eligibility is not training
eligibility (`NOTICE`).
