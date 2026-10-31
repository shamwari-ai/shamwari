# Core on Fly: deploy runbook

Tracking: #81 (deploy), #17 (Ground). Everything here that creates, sets or
deploys is **owner-only**; nothing in the repo does it. Commands follow Fly's
documented CLI and were **not run from the build session** (no `flyctl`, no
Fly credential there), so read each once before running it.

Core is the interim Python service (`core/`, issue #66 replaces it with the Rust
origin). It is public HTTPS on `shamwari-core.fly.dev`; every route except
`/health` needs a bearer token, and rule 1 (`resolve_scope`) and rule 2 (the sink
checks) run unchanged.

## Secrets: by name

Set on the **Fly app `shamwari-core`** (the running service reads exactly these;
`core/test_deploy_config.py` fails if the code reads another):

| Name                       | Required | What it is for                                                            | Where the value comes from                                                                                                  |
| -------------------------- | -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`              | yes      | Core's Mongo login (`shamwari`, `platform`, read `entity`)                | Atlas, project `6989ca17b7b03d132b6deb78`, cluster `nyuchi-platform-doc-db`: a database user with the grants listed below. |
| `SHAMWARI_CORE_TOKEN`      | yes      | The edge Worker's bearer token. Opens auth, Ground, guardrails, sink, rollup | Generated: `openssl rand -hex 32`. Must be **the same value** as the gateway Worker secret of the same name.                |
| `SHAMWARI_OPS_TOKEN`       | no       | Operator routes (`/replay/*`, `/rollup/by-tier`). Unset = those answer 503 | Generated, a **different** value from the Worker's. Held by whoever runs the replay schedule.                               |
| `SERVERS_API_URL`          | no       | Where usage replay posts                                                  | Servers API hostname. Only when replay is switched on (`docs/usage-replay.md`).                                             |
| `SERVERS_API_TOKEN`        | no       | Replay credential, should be scoped to writing usage events only          | Minted by the Servers API owner in the Console.                                                                             |
| `SERVERS_API_INTERNAL_KEY` | no       | `x-nyuchi-internal-key` for the internal route                            | Minted in the Console.                                                                                                      |

**Not set on the Fly app** (`ingest_ground.py` only, run from your own shell):

| Name              | What it is for                                         | Where the value comes from                                                  |
| ----------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `SUPABASE_DB_URL` | the audit record (`documents`, `corpus_sources`)       | Supabase project `hxjblxsheosjbjqgmlhx`, a direct connection string.        |
| `CF_ACCOUNT_ID`   | embeds chunks on Workers AI                            | `125a2dfbc21f76a25c980609609e8218` (Nyuchi Web Services).                    |
| `CF_API_TOKEN`    | embeds chunks with `@cf/baai/bge-m3`                   | A token scoped to **Workers AI read only**. Do not reuse a broad token.     |

Earlier notes in #81 and the old `fly.toml` header listed these three as Core's.
They are not: Core never reads them while serving, so leaving them off shrinks
what a compromised Core exposes.

**Mongo grants** (from the 2026-10-27 plan in #81): `readWrite` on `shamwari` and
`platform`, `read` on `entity`. Core writes `usageEvents`, `conversations`,
`messages`, `groundMisses`, `auditLog`, `serviceHealth` and marks spilled
`usageEvents`; it only reads `apiKeys`, `entities`, `guardrails`, `knowledgeBase`.
A tighter role (per-collection) is possible and worth doing after launch.

### Open: Core's database credential

The 2026-10-27 direction in #81 was that Core should not hold a database login at
all and should call the Nyuchi API (`/v1/shamwari/*`, nyuchi-api#394) instead.
**That switch is not done in this repo**: `core/main.py` still uses `motor` and
reads `MONGODB_URI` at import. This runbook therefore deploys the code that
exists. If the owner wants launch to wait for the switch, say so; otherwise Core
ships with a scoped Mongo user now and drops it when the switch lands.

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
- Mongo and Supabase are existing Nyuchi spend, not new.

Expect **under $10/month** for Core. 512 MB is a guess for FastAPI plus motor
plus a 20-connection pool; watch memory in `fly logs` and `fly status` for the
first week before shrinking or growing it.

## Deploy

Run from a clean checkout of `staging` at the commit you mean to ship.
Values come from your environment or a secret manager; nothing below prints one.

```bash
set -euo pipefail

# 0. Preflight. Read-only.
fly auth whoami
fly apps list --org nyuchi-web-services | grep -c '^shamwari-core ' || true   # 0 = not created yet
git rev-parse --short HEAD

# 1. Create the app. No machines yet.
fly apps create shamwari-core --org nyuchi-web-services

# 2. Secrets. `fly secrets import` reads NAME=value lines from stdin, so a value
#    never reaches argv, `ps`, or shell history. --stage queues them for the
#    first deploy instead of restarting anything.
#    Export MONGODB_URI first, from your secret manager (not typed inline).
SHAMWARI_CORE_TOKEN="$(openssl rand -hex 32)"
SHAMWARI_OPS_TOKEN="$(openssl rand -hex 32)"
printf 'MONGODB_URI=%s\nSHAMWARI_CORE_TOKEN=%s\nSHAMWARI_OPS_TOKEN=%s\n' \
  "$MONGODB_URI" "$SHAMWARI_CORE_TOKEN" "$SHAMWARI_OPS_TOKEN" \
  | fly secrets import --stage --app shamwari-core

# 3. The same Core token goes to the gateway Worker, from the same variable.
cd gateway
printf '%s' "$SHAMWARI_CORE_TOKEN" | npx wrangler secret put SHAMWARI_CORE_TOKEN
cd ..

# 4. Keep both tokens in your secret manager NOW: Fly never shows a secret's
#    value again. Then drop them from this shell.
unset SHAMWARI_CORE_TOKEN SHAMWARI_OPS_TOKEN

# 5. Deploy. Remote builder; the image has never been built outside CI, so the
#    first build is the real test. One machine (fly.toml: min_machines_running = 1).
cd core
fly deploy --app shamwari-core --ha=false

# 6. Names only (never values): confirm what is set.
fly secrets list --app shamwari-core
```

`CORE_URL` on the gateway is the Worker's own variable (`gateway/wrangler.jsonc`),
not a secret: set it to `https://shamwari-core.fly.dev` and redeploy the Worker.

## Verify

```bash
# Liveness, no auth. 200 {"ok":true,...} means the machine is up AND Mongo answered a ping.
curl -fsS https://shamwari-core.fly.dev/health

# Auth is on: no header -> 422, wrong token -> 401. Neither reveals anything.
curl -sS -o /dev/null -w '%{http_code}\n' https://shamwari-core.fly.dev/guardrails
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' \
  https://shamwari-core.fly.dev/guardrails

# Operator routes are shut to the Worker's token (and 503 if no ops token is set).
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' \
  https://shamwari-core.fly.dev/replay/stats

# Rule 1, against the live Core: a personal-scope Cloud search is refused 409
# before any retrieval. The token is read from the environment, never printed.
curl -sS -w '\n%{http_code}\n' -X POST https://shamwari-core.fly.dev/ground/search \
  -H @<(printf 'Authorization: Bearer %s' "$SHAMWARI_CORE_TOKEN") \
  -H 'Content-Type: application/json' \
  -d '{"query":"x","owner_entity_id":"probe","scope":"personal","destination":"cloud"}'
# expect {"detail":{"error":"scope_requires_local_inference",...}} and 409

fly status --app shamwari-core
fly logs --app shamwari-core --no-tail | tail -50
```

(For the last `curl`, export `SHAMWARI_CORE_TOKEN` again from the secret manager;
step 4 unset it.)

## Ingest the Constitution

Run **from your own machine**, with the three ingest variables exported in that
shell only. The Fly app never sees them. See the header of `core/ingest_ground.py`
and `core/README.md` for the licence gate.

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

Code (Core):

```bash
fly releases --app shamwari-core --image          # find the last good release and its image
fly deploy --app shamwari-core --image <registry.fly.io/shamwari-core:deployment-ID-from-above>
```

Secrets: `fly secrets import` creates a new release too. To revert a bad value,
import the old one (you keep it in the secret manager) and the app restarts on it.

Worker: `cd gateway && npx wrangler rollback` returns the Worker to its previous
version. To take Cloud answering out of the loop without a deploy, point `CORE_URL`
back or pause the app (`fly scale count 0 --app shamwari-core`): the Worker already
degrades when Core is unreachable (ungrounded answers, key checks fail closed).

Data: Ground ingest is additive; nothing here deletes a chunk.

## Failure signs

| You see                                  | Likely cause                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Boot crash `KeyError: 'MONGODB_URI'`     | secret missing: `fly secrets list` shows names                      |
| `/health` 500 / machine restarting       | Mongo unreachable: Atlas network access list, or a bad URI          |
| Worker answers `401 invalid_api_key` to a real key | `SHAMWARI_CORE_TOKEN` differs between Fly and the Worker, or the `/auth/verify` defect (below) |
| Worker answers `503 auth_unavailable`    | Core unreachable from the Worker: `CORE_URL`                        |

**Known defect, owner-gated:** `/auth/verify` finds a key by `keyPrefix` only. Every
Shamwari key shares `sk_shamwari_`, so with more than one active key it can fetch
the wrong document and reject a valid key. A fix is prepared as a draft PR
(refs #81) and is not merged without the owner's named yes. Until it is, launch
with a single active key, or expect valid keys to fail.
