# Shamwari Chat sign-in: WorkOS access tokens at the gateway

Tracking: #83, #81. Context: `docs/chat-app.md` (how the chat works today),
`docs/data-api-routes.md` (G1). Status: **gateway half built in this PR; the chat
session Worker is a design, not code.**

**Owner decision, 2026-10-31: "go WorkOS-first".** A person signs in with WorkOS
AuthKit and the gateway accepts their **WorkOS access token** as the Bearer
credential. Minted `sk_shamwari_` keys are no longer how a person authenticates.
This replaces the earlier design in this file (a Servers API `keys/issue` route that
minted a per-person key) and G1 options A and B in `docs/data-api-routes.md`.

**What was and was not verified.** The WorkOS facts below were checked against
WorkOS's documentation on 2026-10-31 by the session that relayed the decision. They
were not exercised against a real WorkOS tenant, because no tenant credentials are
available to this session. Everything the gateway code assumes about the token is a
configuration value (below), so a wrong assumption is a config change, not a code change.

## What the gateway does

`gateway/src/workos.ts`, called from `authenticate` (`gateway/src/auth.ts`).

A Bearer credential is one of two shapes, told apart by prefix and never tried against
each other:

| Shape                      | Verified by                                      | Who uses it                     |
| -------------------------- | ------------------------------------------------ | ------------------------------- |
| `sk_shamwari_…`            | the key service (Core or Servers API), as before | machine callers, channels (SMS) |
| three-segment JWT (`eyJ…`) | `workos.ts`, offline against the WorkOS JWKS     | people, via the chat            |
| anything else              | refused 401, no outbound call                    |                                 |

Verification, every step failing closed:

1. **Signature**, RS256 only (`algorithms: ['RS256']`), key chosen from the JWKS by `kid`,
   never from the token. `alg: none` and HS256-with-the-public-key-as-secret are refused.
2. **`iss`** equals `WORKOS_ISSUER`; **`aud`** equals `WORKOS_AUDIENCE` and is _required_ (a
   token with no `aud` is refused); **`client_id`** equals `WORKOS_CLIENT_ID`; `exp`, `iat`
   and `sub` must be present (a token with no `exp` would otherwise never expire).
3. **`sid`** must be present: it is what revocation is keyed on.
4. **JWKS** is fetched from `https://api.workos.com/sso/jwks/{clientId}` (override with
   `WORKOS_JWKS_URL`, HTTPS only), cached per isolate for 10 minutes, and re-fetched on an
   unknown `kid` at most once per 30 seconds, so a flood of forged `kid`s cannot become a flood
   at WorkOS. A JWKS outage is **503 `auth_unavailable`**, not 401: the person's session may be
   fine, and a client that drops its session on a 401 would turn our outage into theirs.
5. Nothing is cached per token. The signature check is the whole cost, and a cached verdict
   would only lengthen the revocation window.

### Scope: from `permissions`, default deny

Authorize on the `permissions` claim, never on `role` strings.

| Permission (owner defines in the JWT template) | Grants      |
| ---------------------------------------------- | ----------- |
| `shamwari:community`                           | `community` |
| `shamwari:platform`                            | `platform`  |

- A valid token with **neither** is refused (401). There is no default scope.
- **`personal` cannot be granted by this file to anyone.** A `shamwari:personal` permission,
  or any other string, is ignored. A person who needs `personal` uses Shamwari Mind on their
  device; Cloud never serves it (rule 1). The gate that enforces this is unchanged and
  independent of this code: `gateway/src/scope.ts` (409 `scope_requires_local_inference`) and
  `core/main.py::resolve_scope`. `test/workos.test.ts` proves a token carrying a personal
  permission still gets a 409 on a personal-scope request, with no provider or embedding call.

### Who is metered

Per person. The context is `ownerEntityId = workos:<sub>`, `ownerPersonId = <sub>`,
`apiKeyId = workos:sid:<sid>`, `tier = community`, cap `WORKOS_MONTHLY_TOKEN_CAP` (positive
integer; the owner sets it, suggested from the $0.20 per user per month target in
`docs/tiered-access-design.md` converted with `gateway/pricing.json`). The `workos:` prefix
keeps these ids out of the entity and API-key namespaces.

`org_id` is deliberately not used for ownership: a chat user's quota is theirs, not their
organisation's.

> **Open question for the Nyuchi API (G6).** Quota reads `usage/rollup?owner_entity_id=…` and
> the usage event carries `ownerEntityId`. Both now carry a `workos:<sub>` value that is not an
> `entity.entities` id. The API has to accept it, or the gateway has to be told a different id
> to use. Until that is settled, per-person quota depends on the API treating the id as an
> opaque string.

### Configuration (none of it secret)

| Variable                   | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `WORKOS_CLIENT_ID`         | Turns WorkOS sign-in on. Unset means JWTs are refused with no call.    |
| `WORKOS_ISSUER`            | The exact `iss` of the app's access tokens. **Unverified, see below.** |
| `WORKOS_AUDIENCE`          | The `aud` the JWT template sets: our API's URI. Required.              |
| `WORKOS_JWKS_URL`          | Optional. Defaults to the WorkOS JWKS URL for the client id.           |
| `WORKOS_MONTHLY_TOKEN_CAP` | Per-person monthly cap, positive integer.                              |

Enabled but incomplete (any of issuer, audience or cap missing or malformed) is
**503, never permissive**.

`WORKOS_ISSUER` is a value to read off a real token before setting. The Console signs in
through the custom domain `auth.mukoko.com` (app **Mukoko Account**), and whether that changes
`iss` from WorkOS's default is not something this session could confirm.

## The chat: a thin session Worker (design, not built)

The chat page is static. A browser that held a WorkOS refresh token itself would store it
where page script can read it, and a single-use refresh token raced by two tabs signs the
person out. So the part that holds the session is a server.

**Proposal: one small Worker (`chat-auth`) on `https://shamwari.ai/chat/auth/*`**, a
backend-for-frontend that reuses **the WorkOS SDK and the Console's session pattern**
(`nyuchi/nyuchi-platform`, `console/backend`; this session could not read it, so confirm the
SDK and pattern there). It writes no PKCE, refresh or locking code of its own beyond what the
SDK provides.

```
browser                    chat-auth Worker                     WorkOS
  │ GET /chat/auth/login ───►│ SDK: authorization URL (PKCE, state)
  │◄── 302 to WorkOS ────────│
  │ …person signs in…        │
  │ GET /chat/callback?code ─►│ SDK: exchange the code; seal the session
  │◄── Set-Cookie (HttpOnly, Secure, SameSite=Lax, Path=/chat/), 302 /chat/
  │ GET /chat/auth/token ───►│ cookie → SDK refreshes if needed (server side only)
  │◄── { access_token, expires_at }   Cache-Control: no-store
  │ POST api.shamwari.ai/v1/chat/completions   Authorization: Bearer <access_token>
```

- The **refresh token never leaves the Worker.** The page gets only the short-lived access
  token, keeps it in memory, and asks again on expiry or reload.
- The CSP in `site/scripts/post-build.mjs` already restricts `connect-src` to the site and the
  API origin and `script-src` to `'self'`, which is what protects an in-memory token from
  injected script.
- The chat's `AuthProvider` seam (`site/src/chat/auth.ts`) gains a `mukoko` provider whose
  `getKey()` calls `/chat/auth/token`. The developer-key panel stays until this ships, then is
  hidden outside development builds.
- Sign-out is `POST /chat/auth/logout`: it clears the cookie and revokes the WorkOS session.

## Revocation, stated plainly

Revoking a session (sign-out, or an admin acting on `sid`) takes effect **when the access
token already in the browser expires**, because the gateway verifies offline and does not
call WorkOS per request. So the latency is the **access-token lifetime**, which is set in the
WorkOS dashboard; its default was not verified here and the owner should pick a short value
(minutes, not hours). After expiry the refresh fails server-side and the person is signed out.

If minutes is too long for some event (a compromised account), the lever is a `sid` deny list
in KV consulted by `authenticate`. That is not built, because it adds a read to every request
and the owner has not asked for faster revocation than the token lifetime.

The old design's 60-second window came from the key cache. A WorkOS token has no cache, so the
window is the token lifetime instead.

## Machine callers

`sk_shamwari_` keys keep working through the same `KeyService` seam, unchanged, **until the
machine-key path is decided**. WorkOS API keys exist but are **organisation-scoped** (user-scoped
keys are announced, not shipped), hashed at rest and permission-scoped, which fits B2B or
developer keys and not a per-person chat key. Whether to use them for machines is a separate
decision (pricing and any user-scoped support are unverified). Channels (SMS, USSD) keep their
owning-entity key.

## What is built, what is not

| Piece                                               | State                                    |
| --------------------------------------------------- | ---------------------------------------- |
| Gateway accepts and verifies a WorkOS token         | built, 36 tests, guards mutation-checked |
| `permissions` → scopes, default deny, no `personal` | built, tested                            |
| Per-person metering identity                        | built; API acceptance is open (G6)       |
| `chat-auth` session Worker, `mukoko` AuthProvider   | **design only**                          |
| Revocation by `sid` deny list                       | not built, not asked for                 |

## Needs the owner

- **JWT template in the WorkOS dashboard:** set `aud` to our API's URI and issue the
  `shamwari:community` / `shamwari:platform` permissions (the rendered template is capped at
  3072 bytes; reserved claims are `iss`, `sub`, `exp`, `iat`, `nbf`, `jti`).
- **Register** `https://shamwari.ai/chat/callback` on the WorkOS app (never a wildcard).
- **Read `iss` off a real access token** and set `WORKOS_ISSUER`; set `WORKOS_AUDIENCE`,
  `WORKOS_CLIENT_ID` and `WORKOS_MONTHLY_TOKEN_CAP`; choose the **access-token lifetime**.
- **Approve the gateway auth change at merge time** (this PR adds the `jose` dependency, MIT,
  the verifier for the token; nothing else new).
- **A yes to the `chat-auth` Worker** (a new deployment) and where its cookie-sealing secret
  and WorkOS client secret live.
- **G6:** confirm the Nyuchi API accepts `workos:<sub>` as an owner id.
