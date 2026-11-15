# Core on Fly: deploy runbook

Tracking: #81 (deploy), #17 (Ground), #266 (deploy on release). A release to `main`
deploys **automatically, through Cloudflare's and Fly's own GitHub connections** (see
Deploy); no deploy secret is held in GitHub. Everything else that creates or sets (the app,
its secrets, connecting the repository) is **owner-only**; nothing in the repo does it. The
manual commands below are the break-glass path. They follow Fly's documented CLI and were
**not run from the build session** (no `flyctl`, no Fly credential there), so read each
once before running it.

Core is the interim Python service (`core/`, issue #66 replaces it with the Rust
origin). It is public HTTPS on `shamwari-core.fly.dev`; every route except
`/health` needs a bearer token.

**Core holds no database login.** Owner decision, 2026-10-27: only the Nyuchi API
talks to databases. Core reaches Ground, the sink and usage through the API's
`/v1/shamwari` routes (nyuchi/nyuchi-api#393) over Fly's private network, with one
internal key. Rule 1 is decided in Core before any call, and checked again on what the
API returns; the API checks it a third time. Which routes exist and which are missing:
`docs/data-api-routes.md`.

## Secrets: by name

Set on the **Fly app `shamwari-core`** (the running service reads exactly these;
`core/test_deploy_config.py` fails if the code reads another):

| Name                      | Required | What it is for                                                                                | Where the value comes from                                                                                                                                 |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHAMWARI_CORE_TOKEN`     | yes      | The edge Worker's bearer token. Opens Ground, guardrails, sink and rollup.                    | Generated: `openssl rand -hex 32`. Must be **the same value** as the gateway Worker secret of the same name.                                               |
| `NYUCHI_API_INTERNAL_KEY` | yes      | Core's one credential for the Nyuchi API, form `nyk_<id>.nys_<secret>`.                       | Minted in the Console by a person holding `console:api-keys-mint`: an **internal** key with scopes `shamwari`, `shamwari:service` and `ai`. Nothing wider. |
| `SHAMWARI_OPS_TOKEN`      | no       | Operator routes (`/replay/*`, `/rollup/by-tier`; both parked, see below). Unset = answer 503. | Generated, a **different** value from the Worker's.                                                                                                        |

Plain settings, in `fly.toml` `[env]` (not secrets): `NYUCHI_API_URL`
(`http://nyuchi-api.internal:8080`, Fly's private network) and `NYUCHI_API_HOST`
(`api.nyuchi.com`; the API trusts a list of hosts and `.internal` is not on it).

`SERVERS_API_URL` is a third plain setting. Whether it is set is whatever `core/fly.toml`
`[env]` says; the file, not a deploy flag, is the only place, so a deploy started by Fly's
GitHub connection, by the break-glass workflow or from a shell all run the same
configuration. **Unset (today), Core uses the Nyuchi API client.** Set to
`http://nyuchi-servers-api.internal:8081`, the Servers API's keyless listener on Fly's
private network, Core uses the Servers API client: **no key and no token** (same Fly org),
the owner in the `x-shamwari-person` header for a personal-scope search, never in the body,
and the refusal reason from the RFC 9457 `error` member. An address that is not
`*.internal` makes Core refuse to start: outside callers (the gateway Worker) use the key
and token, Core holds neither for this. **Do not set it until the Servers API's internal
listener is on and reachable** (order below): a Core pointed at a port nothing listens on
answers `/health` 503 and Fly takes its only machine out of rotation. The change is a
separate PR from the one that moved deploys onto the platforms, so it can wait.

The Cloudflare Secrets Store is for Workers only; Fly cannot read it. Core's secrets
are Fly secrets, whose values come from the owner's vault.

**Not set on the Fly app** (`ingest_ground.py` only, run from your own shell; the script
and its database drivers are not in the image):

| Name              | What it is for                                   | Where the value comes from                                                                                            |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL` | the audit record (`documents`, `corpus_sources`) | Supabase project `hxjblxsheosjbjqgmlhx`, a direct connection string.                                                  |
| `MONGODB_URI`     | writes `shamwari.knowledgeBase`                  | A Mongo user for ingest only, `readWrite` on `shamwari.knowledgeBase`. Goes away when the API has a write route (G5). |
| `CF_ACCOUNT_ID`   | embeds chunks on Workers AI                      | `125a2dfbc21f76a25c980609609e8218` (Nyuchi Web Services).                                                             |
| `CF_API_TOKEN`    | embeds chunks with `@cf/baai/bge-m3`             | A token scoped to **Workers AI read only**. Do not reuse a broad token.                                               |

## What does not work yet (read before you promise anyone a launch)

- **No customer can authenticate.** Core used to check keys against Mongo; it cannot now,
  and `/auth/verify` answers 501 `key_verification_moved`. The Worker denies (never
  admits). The Nyuchi API authenticates a key from the raw key, which the Worker never
  sent to Core, and the existing `platform.apiKeys` holds no `sk_shamwari_` keys at all
  (3 internal keys, checked 2026-10-31). So there is nothing to verify and nowhere to
  issue one. This is gap **G1** in `docs/data-api-routes.md` and needs an owner decision.
- `/replay/*` and `/rollup/by-tier` answer 501 until the API has the routes they need
  (G3, G4). Nothing at launch uses them.
- Answers carry the section in `heading` ("s 56 Equality ..."), but not the separate
  `section` and `citation` fields: the API does not project them yet (G2).

## Cost (assumptions flagged)

`shared-cpu-1x`, 512 MB, one machine always on, region `jnb`:

- Fly's published price for this size is **$3.69/month** in its cheapest regions
  (iad/ewr), $2.19 for 256 MB and $6.70 for 1 GB. The page says prices vary by
  region and does not list `jnb`; **assume a premium and budget about $5-6/month**
  until the invoice shows the real figure.
- Shared IPv4 and IPv6: free. Dedicated IPv4 ($2/month) is not needed.
- Outbound data: $0.12/GB for the Africa/India group (assumed to cover `jnb`).
  Core returns small JSON; at demo traffic this is cents.
- No volume. Builder and registry storage: free today, subject to change.
- Atlas and Supabase are existing Nyuchi spend, not new. Private-network traffic to the
  API is within Fly.

Expect **under $10/month** for Core. With no database driver 512 MB is generous; watch
memory in `fly logs` and `fly status` for the first week before shrinking it.

## Deploy

**Automatic on release, through the platforms' own GitHub connections.** Owner decision,
2026-11-13: production deploys do not use secrets held in GitHub. A push to `main` (the
release PR that `release-to-main.yml` merges) is deployed by the two platforms themselves:

| What                  | Deployed by                     | Reads its configuration from       |
| --------------------- | ------------------------------- | ---------------------------------- |
| `shamwari-site`       | Cloudflare Workers Builds       | `site/wrangler.jsonc`              |
| `shamwari-app`        | Cloudflare Workers Builds       | `site/app/wrangler.jsonc`          |
| `shamwari-gateway`    | Cloudflare Workers Builds (new) | `gateway/wrangler.jsonc`           |
| `shamwari-core` (Fly) | Fly's GitHub deployment (new)   | `core/fly.toml`, including `[env]` |

The gateway and Core connections are the owner's one-time steps below. Until they are made,
a release does **not** deploy those two; they stay on the break-glass commands.

What this changes, so nobody is surprised:

- **A deploy is not gated on CI.** Both platforms deploy a push to `main` as soon as it
  lands. `main` only moves through the release PR, which opens after CI is green on the
  staging head and has the required checks on it, so a red commit does not normally
  reach `main`; but the platforms do not check.
- **No post-deploy check is part of the deploy.** `smoke-production.yml` runs on every
  push to `main` (retrying while the deploys land) and every 30 minutes, and now also
  checks `https://api.shamwari.ai/health` and `https://shamwari-core.fly.dev/health` for
  200; it opens an issue (or comments on the open one) when either fails. Core's answers 200
  only while its data API also answers Core's key. It only reads and rolls nothing back.
- **Rollback is unchanged and manual** (see Rollback).
- **Non-secret settings must be in the files.** The platforms run no flags, so whatever
  Core and the gateway need that is not a secret is in `core/fly.toml` `[env]` or
  `gateway/wrangler.jsonc` `vars`. (`wrangler deploy` replaces a Worker's dashboard
  variables with the file's.) Secrets stay where they are: Fly secrets for Core,
  Cloudflare for the Worker.

### Owner steps: connect the gateway Worker (Cloudflare)

Same way `shamwari-app` and `shamwari-site` already deploy (docs/domains-and-deploy.md).

1. Cloudflare dashboard, Nyuchi Web Services account, **Workers & Pages**, the Worker
   `shamwari-gateway`, **Settings**, **Builds**, connect a repository: `shamwari-ai/shamwari`.
2. **Production branch** `main`. **Root directory** `gateway`. **Build command**: `npm ci`
   (a lockfile install, so the wrangler version `package-lock.json` pins is the one that runs).
   **Deploy command** `npx wrangler deploy`. For other branches, turn branch builds off, or keep
   Cloudflare's default non-production command (`npx wrangler versions upload`, which uploads a
   version and does not deploy it). Never give a branch a deploy command: the gateway has no
   `previews` block, so a branch build must not replace production.
3. Workers Builds checks the Worker's name against `name` in the root directory's
   `wrangler.jsonc` (`shamwari-gateway`); it matches, so nothing needs renaming.
4. Merge or re-run a build, then open `https://api.shamwari.ai/health`: it should answer
   `{"ok":true,"service":"shamwari-gateway",...}`.

Not verified from the build session (no Cloudflare dashboard access there): the exact
wording and order of the **Builds** menu, whether Workers Builds installs dependencies on
its own before the build command (`npm ci` is safe either way), and what the default
non-production branch command is today.

### Owner steps: connect Core (Fly)

**Order matters** if Core is to use the Servers API client (the `SERVERS_API_URL` change
in `core/fly.toml`, a separate draft PR that says "merge only after" these are done):

1. Pin the tunnel/VPC route to `:8080` (owner step, not yet done when this was written).
2. Turn on the Servers API's internal listener (`SERVERS_API_INTERNAL_PORT=8081` on the
   `nyuchi-servers-api` Fly app) and verify it answers from `shamwari-core`'s private
   network, for example `fly ssh console --app shamwari-core` then `curl -sS
http://nyuchi-servers-api.internal:8081/ready`.
3. Merge the `SERVERS_API_URL` PR.
4. Connect Fly to GitHub (below). **Once connected, merging that PR deploys it**, so do
   steps 1 and 2 first.

Until the `SERVERS_API_URL` PR merges, a Core built by Fly stays on its previous client
(no `SERVERS_API_URL`). Connecting Fly without it is safe.

1. Fly dashboard, the app `shamwari-core` (organisation `nyuchi-web-services`),
   **Deployments**, then its settings: connect the GitHub repository `shamwari-ai/shamwari`.
   Fly's own post on this (community.fly.io, "Auto-deploy on push to GitHub", October 2024)
   says: App, **Deployments**, **settings**, and that an app not yet set up for GitHub
   deployments may have to walk through Fly's Launch setup first.
2. Choose branch `main`, and the **directory `core`** (where `fly.toml` and the `Dockerfile`
   are). Turn on deploy on push.
3. After the first deploy: `fly status --app shamwari-core` must show **one** machine in
   `jnb`. A connected deployment cannot pass `--ha=false`; if Fly made a second machine,
   run `fly scale count 1 --app shamwari-core` (a second machine is extra cost).
4. `curl -fsS https://shamwari-core.fly.dev/health` must answer 200.

Not verified from the build session (no Fly dashboard access there; the Fly page for this
could not be opened in full): the labels for choosing the branch and the working
directory, whether the setting is called auto-deploy, and whether Fly honours `[env]`
from a build it runs itself. Fly's documentation says the repository must already hold the
app's `fly.toml`, which `core/fly.toml` does. If a label differs, follow the dashboard and
correct this page in a PR.

Neither connection needs a GitHub secret, and nothing in these steps sets one.

### Break-glass: the Deploy workflow (needs secrets, off by default)

`.github/workflows/deploy.yml` ("Deploy (break-glass)") is the same deploy as a manual
workflow, for the day the platform connections are unavailable. It **only runs when a
person starts it** from the Actions tab, on `main`. Nothing triggers it. It deploys the
gateway (`npm ci`, `npx --no wrangler deploy` in `gateway/`) and Core
(`flyctl deploy --app shamwari-core --ha=false --remote-only` in `core/`) as two independent
jobs behind the `production` GitHub Environment, each followed by a `/health` check
(6 tries, 10 seconds apart) that fails the job. A job fails with an error naming a missing
secret; it never skips and never reports success without deploying. It does not roll back
by itself.

It works only if the owner has chosen to add these secrets to the `production`
Environment of `shamwari-ai/shamwari`. The owner has said they would rather not, so
expect it to fail at the first step, by name, until then:

| Name                    | Used by | What it is                                                            |
| ----------------------- | ------- | --------------------------------------------------------------------- |
| `FLY_API_TOKEN`         | core    | A Fly deploy token scoped to the `shamwari-core` app only.            |
| `CLOUDFLARE_API_TOKEN`  | gateway | A Cloudflare token allowed to deploy Workers in the Nyuchi account.   |
| `CLOUDFLARE_ACCOUNT_ID` | gateway | The Nyuchi Web Services account id (an identifier, not a credential). |

Values never go in the repo, an issue or a PR; `core/test_deploy_workflow.py` fails if the
workflow reads any other secret, passes one to a step that does not need it, or carries a
literal. The Worker's own runtime secrets (including `SHAMWARI_CORE_TOKEN`) stay in
Cloudflare; Core's stay in Fly. The workflow touches neither.

### Break-glass: deploy from a shell

Use only when the platform connections and the workflow above are both unavailable, or
a release must go out ahead of CI. Run from a clean checkout of `main` at the commit you
mean to ship. This deploys with whatever `core/fly.toml` says. The first four steps are also
the one-time setup of a Fly app that does not exist yet. Values come from your
environment or a secret manager; nothing below prints one.

```bash
set -euo pipefail

# 0. Preflight. Read-only.
fly auth whoami
fly apps list --org nyuchi-web-services | grep -c '^shamwari-core ' || true   # 0 = not created yet
git rev-parse --short HEAD

# 1. Create the app. No machines yet. (First time only.)
fly apps create shamwari-core --org nyuchi-web-services

# 2. Secrets. `fly secrets import` reads NAME=value lines from stdin, so a value
#    never reaches argv, `ps`, or shell history. --stage queues them for the
#    first deploy instead of restarting anything.
#    Export NYUCHI_API_INTERNAL_KEY first, from your secret manager (not typed inline).
SHAMWARI_CORE_TOKEN="$(openssl rand -hex 32)"
SHAMWARI_OPS_TOKEN="$(openssl rand -hex 32)"
printf 'NYUCHI_API_INTERNAL_KEY=%s\nSHAMWARI_CORE_TOKEN=%s\nSHAMWARI_OPS_TOKEN=%s\n' \
  "$NYUCHI_API_INTERNAL_KEY" "$SHAMWARI_CORE_TOKEN" "$SHAMWARI_OPS_TOKEN" \
  | fly secrets import --stage --app shamwari-core

# 3. Keep both tokens in your secret manager NOW: Fly never shows a secret's
#    value again. The Worker needs the same Core token (see "Point the Worker at
#    Core"), so do not lose it. Then drop them from this shell.
unset SHAMWARI_CORE_TOKEN SHAMWARI_OPS_TOKEN NYUCHI_API_INTERNAL_KEY

# 4. Deploy Core. Remote builder; CI builds this image on every PR, so a Dockerfile or lock
#    problem has already failed there. One machine (fly.toml: min_machines_running = 1).
cd core
fly deploy --app shamwari-core --ha=false

# 5. Names only (never values): confirm what is set.
fly secrets list --app shamwari-core

# 6. Deploy the gateway Worker (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in this shell).
cd ../gateway && npm ci && npx --no wrangler deploy
```

Core reaches `nyuchi-api.internal` only if both apps are in the same Fly organisation
(`nyuchi-web-services`), which they are. If `fly logs` shows `data api unavailable`,
check that the API app is deployed and that its machine listens on 8080.

## Verify

```bash
# Needs the Core token from your secret manager (step 3 dropped it from the shell).
# Exported here, never printed.
: "${SHAMWARI_CORE_TOKEN:?export it from your secret manager first}"

# Readiness, no auth. 200 {"ok":true,...} means the machine is up AND the Nyuchi API answered
# Core's key. Fly's check is this same route, so an API outage takes the only machine out of
# rotation (the Worker sees 503) instead of letting it answer errors. Nothing restarts.
curl -fsS https://shamwari-core.fly.dev/health

# Auth is on: no header -> 422, wrong token -> 401. Neither reveals anything.
curl -sS -o /dev/null -w '%{http_code}\n' https://shamwari-core.fly.dev/guardrails
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' \
  https://shamwari-core.fly.dev/guardrails

# Operator routes are shut to the Worker's token: the REAL Core token must get 401
# here (503 if no ops token is set), or the two secrets are not separate.
curl -sS -o /dev/null -w '%{http_code}\n' -H @<(printf 'Authorization: Bearer %s' "$SHAMWARI_CORE_TOKEN") \
  https://shamwari-core.fly.dev/replay/stats

# Rule 1, against the live Core: a personal-scope Cloud search is refused 409
# before any call to the API. The token is read from the environment, never printed.
curl -sS -w '\n%{http_code}\n' -X POST https://shamwari-core.fly.dev/ground/search \
  -H @<(printf 'Authorization: Bearer %s' "$SHAMWARI_CORE_TOKEN") \
  -H 'Content-Type: application/json' \
  -d '{"query":"x","owner_entity_id":"probe","scope":"personal","destination":"cloud"}'
# expect {"detail":{"error":"scope_requires_local_inference",...}} and 409

# A platform-scope search reaches the API with Core's key (404-free hit or miss, 200):
curl -sS -w '\n%{http_code}\n' -X POST https://shamwari-core.fly.dev/ground/search \
  -H @<(printf 'Authorization: Bearer %s' "$SHAMWARI_CORE_TOKEN") \
  -H 'Content-Type: application/json' \
  -d '{"query":"equality","owner_entity_id":"probe","scope":"platform","destination":"cloud"}'

fly status --app shamwari-core
fly logs --app shamwari-core --no-tail | tail -50
```

## Point the Worker at Core

Only after the checks above pass. The Worker is a separate deploy with its own
bindings (KV, queue, secrets store, AI Gateway); the go-live checklist on #81 has
the order. Two things that bite:

- `wrangler secret put` on a Worker that is not deployed yet prompts interactively
  to create a draft one, which breaks a non-interactive script. Deploy the Worker
  first, then set the secret.
- `CORE_URL` is a plain variable in `gateway/wrangler.jsonc`, currently
  `https://core.shamwari.ai`. Change it to `https://shamwari-core.fly.dev` (a PR to
  `staging`, the owner's merge) and redeploy.

```bash
cd gateway
printf '%s' "$SHAMWARI_CORE_TOKEN" | npx wrangler secret put SHAMWARI_CORE_TOKEN
```

## Ingest the Constitution

Run **from your own machine**, with the four ingest variables (`SUPABASE_DB_URL`,
`MONGODB_URI`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`) exported in that shell only, using the
ingest lock (`pip install --require-hashes -r core/requirements-ingest.txt`). The Fly
app never sees them. See `docs/ground-ingest.md`. Until the API has a ground-write route
(G5) this is a one-off from a trusted machine.

## Hardening: take the public address away (before real user data)

The interim is public HTTPS behind a bearer token. The architecture is no public
address and a tunnel from the Worker. Cloudflare Workers cannot reach Fly's
`.internal` network, so that needs a Cloudflare Tunnel connector next to Core:
a second small Fly app running `cloudflared` (image pinned by digest) with a
`TUNNEL_TOKEN` secret, forwarding to `http://shamwari-core.internal:8000`, then
`fly ips release` on Core and the Worker's `CORE_URL` pointed at the tunnel
hostname. It is not built here; it needs a tunnel the owner creates in the
Cloudflare dashboard. Until it is, the controls are the bearer token, `/health`
being the only open route, and rule 1/2 enforced inside Core.

## Rollback

A bad release is not rolled back by anything automatic: the platforms deploy what
`main` holds, and the break-glass workflow only reports a failed health check (the new
version is live; its error names the commands). A person rolls back with the commands
below. They are deliberately not automated: CI cannot test them, and a wrong automatic
rollback is worse than a red job. Then fix forward on `staging`; the next release deploys
the fix. If the platform keeps redeploying a bad `main`, disconnect it or revert on
`staging` first.

Code (Core):

```bash
fly releases --app shamwari-core --image          # find the last good release and its image
fly deploy --app shamwari-core --image <registry.fly.io/shamwari-core:deployment-ID-from-above>
```

Secrets: `fly secrets import` creates a new release too. To revert a bad value,
import the old one (you keep it in the secret manager) and the app restarts on it.
To revoke Core's data access at once, revoke its internal key in the Console: Core then
answers 503 to everything that needs data and nothing leaks.

Worker: `cd gateway && npx wrangler rollback` returns the Worker to its previous
version. To take Cloud answering out of the loop without a deploy, point `CORE_URL`
back or pause the app (`fly scale count 0 --app shamwari-core`): the Worker already
degrades when Core is unreachable (ungrounded answers, key checks fail closed).

Data: Ground ingest is additive; nothing here deletes a chunk.

## Failure signs

| You see                                           | Likely cause                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Boot crash `KeyError: 'NYUCHI_API_INTERNAL_KEY'`  | secret missing: `fly secrets list` shows names                                              |
| `/health` 503, logs `data api refused Core's key` | the internal key is revoked or lacks `shamwari`, `shamwari:service` or `ai`: mint a new one |
| `/health` 503, logs `data api unavailable`        | the API app is down, or not reachable at `NYUCHI_API_URL` over the private network          |
| Worker answers `401 invalid_api_key`              | expected until G1 is built: Core no longer verifies keys                                    |
| Worker answers `503 auth_unavailable`             | Core unreachable from the Worker: `CORE_URL`                                                |
| Ground answers `503 data_api_unavailable`         | the API is failing; Core fails closed and serves nothing in its place                       |
