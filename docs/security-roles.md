# Who and what may do what: credentials and permissions

Owner directive (2026-10-29): security, least privilege and strong role-based
access are a hard requirement. This is the map for everything Shamwari holds or
adds. Each line is enforced by a test unless it says it is an owner step.

## Principles

- **Fail closed.** A key check that cannot answer is a 503 and admits nothing,
  and the outage is not cached. A missing or unset secret shuts the route.
- **Least privilege.** Each credential can do only what its holder needs, and each
  holder has its own credential, so one leak does not open everything.
- **No secret in logs, argv, errors or usage events.** Credentials travel in
  headers only. Usage events carry an allowlist of fields and no content.
- **Rule 1 and Rule 2 tests stay mandatory.** Nothing here relaxes either.
- **Dependencies and images are pinned.** Core's Python packages by hash, its base
  image by digest, both checked in CI.

## Customer API key (`sk_shamwari_...`)

- Held by a customer. Issued only through the shared key table (key type
  `shamwari`); Shamwari code cannot issue, revoke or list keys.
- Verified by the gateway: unknown, revoked, expired or wrong-type keys get 401;
  a key store that cannot answer gets 503.
- Carries a tier, a monthly token cap and **scopes**. A key may ask only for
  scopes it holds. If none are listed it holds community and platform. **A
  personal-scope request is refused (403) unless the key was issued with
  `personal`**, and even then personal scope is only ever served by the
  retrieval-only endpoint that never calls a provider; against Cloud it is still
  the 409. Scopes can narrow what the sovereignty gate allows, never widen it.
- The scope of each request travels in its usage event as a label.

## Gateway to the Servers API

- Credential: `SERVERS_API_TOKEN` (scope `shamwari`) plus the internal key
  `SERVERS_API_INTERNAL_KEY`. Held by the edge Worker as secrets.
- May call exactly three routes: verify a key, read a usage total, write usage
  events. A test fails if the code names any other route. It cannot issue, revoke
  or list keys, or read the ledger beyond a verify.

## Core to the Servers API

- Core uses the same variable names but **should be given its own token**, limited
  to writing usage events. The Servers API owner defines that scope; until then the
  value is the owner's to mint. A test pins that Core names exactly one route.
- Used only by the spill replay. Core never reads keys.

## Edge Worker to Core

- `SHAMWARI_CORE_TOKEN`: the Worker's secret. Opens the routes the Worker uses
  (auth verify, Ground, guardrails, sink, rollup). It does **not** open operator
  routes.
- `SHAMWARI_OPS_TOKEN`: a separate operator secret for `/replay/*` and
  `/rollup/by-tier`. If it is unset those routes answer 503. Both secrets are
  compared in constant time. A compromised Worker cannot trigger a replay, requeue
  dead-lettered events, or read usage reports. Tested.

## People

- Approving a key-migration phase, minting a token, setting a secret, creating a
  database index, deploying or flipping `SERVERS_API_ENABLED` are the owner's, by
  name. Nothing in the repo does them.
- Merging to `staging` goes through the merge queue with green CI and a clean
  `/code-review`. Releasing `staging` to `main` is the owner's.

## What is not covered here

- Rotation: how often each secret changes, and who does it. An owner decision.
- Channel secrets (`CHANNEL_WEBHOOK_SECRET`, `CHANNEL_API_KEY`) are separate and
  still unset; the review found gaps in that webhook (see #83).
- Per-key rate limits beyond the monthly cap.
