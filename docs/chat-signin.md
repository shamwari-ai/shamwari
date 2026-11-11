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
2. **`iss`** equals `WORKOS_ISSUER`; **`aud`** is checked, and _required_, **only when
   `WORKOS_AUDIENCE` is set** (see below); **`client_id`** equals `WORKOS_CLIENT_ID`; `exp`, `iat`
   and `sub` must be present (a token with no `exp` would otherwise never expire).
3. **`sid`** must be present: it is what revocation is keyed on.
   `maxTokenAge` caps how long any token may have been valid, whatever its `exp`
   (`WORKOS_MAX_TOKEN_AGE_SECONDS`, default 3600): a template left at a long lifetime costs a
   refusal, not a long revocation window.
4. **JWKS** is fetched from `https://api.workos.com/sso/jwks/{clientId}` (override with
   `WORKOS_JWKS_URL`, HTTPS only), cached per isolate for 10 minutes, and re-fetched on an
   unknown `kid` at most once per 30 seconds, so a flood of forged `kid`s cannot become a flood
   at WorkOS. A JWKS outage is **503 `auth_unavailable`**, not 401: the person's session may be
   fine, and a client that drops its session on a 401 would turn our outage into theirs. Anything
   jose says about the token itself (including an unsupported header) is a 401; only failing to
   reach or read the JWKS is a 503.
   Known edge: if WorkOS rotates its signing key and a token with the new `kid` arrives within
   30 seconds of the last JWKS fetch, it is refused (401) until the cooldown ends. The client then
   signs in again and succeeds. WorkOS publishes a new key in the JWKS before using it, which is
   what makes this rare; it was not verified here.
5. Nothing is cached per token. The signature check is the whole cost, and a cached verdict
   would only lengthen the revocation window.

### Scope: one fixed grant, from no claim at all

**Owner decision, 2026-10-31: no new WorkOS permissions, and no permission or role in the chat
path.** The Mukoko Account production environment already carries many (`data:read`,
`data:admin`, `console:*`, `mongodb:access`, `github:access`, `fundi:admin`,
`mukoko:news-moderator`, `manage-production-app`); Shamwari reuses none of them and adds none.

- Any **valid** access token (signature, `iss`, `aud` when configured, the Shamwari Chat `client_id`,
  `exp`, `sub`, `sid`) from a signed-in person gets exactly one grant, decided in gateway code
  (`FIXED_GRANT` in `gateway/src/workos.ts`): **`community` and `platform`, the free tier,
  metered per person.** The default does not depend on any permission being present: a token
  with an empty or absent `permissions` claim works.
- **Nothing in the token can raise it.** `permissions`, `role`, `roles`, `org_id`, `act` and any
  scope-looking claim are never read to decide the grant. A token carrying `data:admin` or
  `console:admin` gets what a token carrying nothing gets. `test/workos.test.ts` asserts that
  byte for byte.
- **`personal` is never grantable.** A person who needs `personal` uses Shamwari Mind on their
  device; Cloud never serves it (rule 1). The gate is unchanged and independent of this code:
  `gateway/src/scope.ts` (409 `scope_requires_local_inference`) and `core/main.py::resolve_scope`.
  The tests prove an admin token carrying a personal-looking permission still gets a 409 on a
  personal-scope request, with no provider or embedding call.
- **Paid tiers later** come from the existing UCP subscription / ledger entitlement (the pattern
  already noted on `fundi:admin`: public tiers use a UCP subscription, not a permission), not
  from new permissions.
- An account with no usable canonical person id (below) gets **403 `not_provisioned`**
  (`reason: no_person_id`), not 401: the person is signed in and the account is the gap, and a
  401 would send the chat client round the sign-in loop with the same token. (The chat client
  maps any 403 to its "not permitted" state; a distinct message for `not_provisioned` is a small
  site change not made here.)

### Who is metered

Per person, on the platform's **one canonical person id** (the WorkOS `externalId`, carried in
the token by a JWT-template claim named `person_id`). The context is
`ownerEntityId = ownerPersonId = <person_id>`, `apiKeyId = workos:sid:<sid>` (the session),
`tier = community`, cap `WORKOS_MONTHLY_TOKEN_CAP` (positive integer; the owner sets it,
suggested from the $0.20 per user per month target in `docs/tiered-access-design.md` converted
with `gateway/pricing.json`).

- **No `person_id`, no request.** A valid token without the claim, or with one that is not
  1 to 64 characters of `A-Za-z0-9_.:-` (Core's owner-id pattern, pinned by a test that reads
  `core/main.py`), is refused (403 `not_provisioned`). It does **not** fall back to WorkOS
  `sub`: that would give one person two quota identities. The alphabet is a guard, not a format
  claim: the id is interpolated into a Core URL on the default quota path, so it must be inert
  there. If the platform's person ids use other characters, widen the pattern in
  `gateway/src/workos.ts` deliberately.
- `org_id` is deliberately not used for ownership: a chat user's quota is theirs, not their
  organisation's.
- This matches the API's G6 owner id (`docs/data-api-routes.md`), so the API needs no special
  case for WorkOS callers.

### Configuration (none of it secret)

| Variable                   | Meaning                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WORKOS_CLIENT_ID`         | Turns WorkOS sign-in on. Unset means JWTs are refused with no call.                                                                                    |
| `WORKOS_ISSUER`            | The exact `iss` of the app's access tokens. **Unverified, see below.**                                                                                 |
| `WORKOS_AUDIENCE`          | Optional. When set, `aud` must equal it exactly and a token without one is refused. Unset: `aud` is not checked. Blank is a configuration error (503). |
| `WORKOS_JWKS_URL`          | Optional. Defaults to the WorkOS JWKS URL for the client id.                                                                                           |
| `WORKOS_MONTHLY_TOKEN_CAP` | Per-person monthly cap, positive integer.                                                                                                              |

**Why `aud` is optional.** The chat is its own AuthKit application, so the `client_id` check
already isolates it: a token minted for any other app in the environment (Console, weather, news)
is refused. `aud` lives in the JWT template, which is shared by every app in the production
environment, and a verifier elsewhere that is given a token with an `aud` and no expected
audience may reject it (unverified), so production's template does not carry one. The staging
template does (`https://api.shamwari.ai`); set `WORKOS_AUDIENCE` to that there and the check is
enforced. Production runs on `iss` + `client_id` + `exp` unless the owner later adds `aud`.

Enabled but incomplete (any of issuer or cap missing or malformed, or a blank audience) is
**503, never permissive**.

`WORKOS_ISSUER` is a value to read off a real token before setting. The Console signs in
through the custom domain `accounts.mukoko.com` (app **Mukoko Account**), and whether that changes
`iss` from WorkOS's default is not something this session could confirm.

### Things the code assumes about a real token (unverified)

- `client_id` is present and equals the app's client id. It is a standard AuthKit access-token
  claim per the WorkOS documentation as relayed, but no real token was inspected. **If a real
  token has no `client_id`, every sign-in is refused and the failure looks like a bad credential:**
  read a real token before enabling `WORKOS_CLIENT_ID`.
- `sid` is present, and `person_id` is present once the template exposes the WorkOS `externalId`.
  If the template cannot expose it under that name, the claim name is one constant
  (`PERSON_ID_CLAIM`); what to do for accounts without one is the owner's call, and today they
  are refused rather than metered under `sub`.

### Two behaviours the owner should know about

- **Signed-in people are never Mind training material.** `trainingEligible` is false for a WorkOS
  caller whatever the model, because nobody has asked them (the same rule as SMS and USSD).
  `conversationTrainable` in `gateway/src/index.ts` is the one place that says so.
- **The quota check fails open** (existing behaviour, written for paying key holders): if the
  rollup cannot be read the request is served. For these free people that means the cap is not
  enforced while the rollup is failing. The gateway now logs `quota rollup failed, cap not
enforced`. Whether people should instead fail closed is a policy choice that depends on the API
  accepting person ids (G6); it is not changed here.

## The chat: a thin session Worker (built, not deployed)

The chat page is static. A browser that held a WorkOS refresh token itself would store it
where page script can read it, and a single-use refresh token raced by two tabs signs the
person out. So the part that holds the session is a server.

**Built in `site/worker/`, as part of the `shamwari-app` Worker** (not a third Worker): static
assets answer everything, and `assets.run_worker_first` in `site/app/wrangler.jsonc` sends only
`/lite/auth/login`, `/lite/auth/token`, `/lite/auth/logout` and `/lite/callback` to the script.
It uses the **WorkOS SDK** (`@workos-inc/node`, its `workerd` build) for the authorization URL,
the code exchange, cookie sealing, JWT verification, refresh and session revocation. There is no
PKCE, sealing or token-refresh code of our own. (The Console's own pattern in
`nyuchi/nyuchi-platform` was not readable from this session, so nothing here was checked against it.)

```
browser                    shamwari-app Worker (worker/)         WorkOS
  | GET /lite/auth/login --->| state (random, one-time cookie); SDK authorization URL
  |<-- 302 to WorkOS --------|
  | ...person signs in...    |
  | GET /lite/callback?code ->| state checked; SDK exchanges the code and SEALS the session
  |<-- Set-Cookie __Secure-shamwari_session (Path=/lite/) (HttpOnly, Secure, SameSite=Lax), 302 /lite/
  | GET /lite/auth/token --->| SDK verifies; refreshes if < 60 s left (one at a time per session)
  |<-- { access_token, expires_at }   Cache-Control: no-store, Vary: Cookie
  | POST api.shamwari.ai/v1/chat/completions   Authorization: Bearer <access_token>
```

- The **refresh token never leaves the Worker**: it exists only inside the sealed cookie. The page
  gets the short-lived access token, keeps it in memory, and asks again on expiry or reload.
- **What the page expects** (`site/src/chat/auth-mukoko.ts`): `GET /lite/auth/token` returns
  `{ "access_token": "<jwt>", "expires_at": <epoch seconds> }`. **401 means the session is over**
  (the Worker also clears the cookie); anything else (403, 5xx, a network failure) is "not now",
  never a sign-out. The page reads no claim from the token.
- **What the gateway expects of the token** (unchanged, `gateway/src/workos.ts`): `iss`, `client_id`,
  `exp`, `iat`, `sub`, `sid`, and `person_id` from the JWT template. The Worker adds and changes none.
- **Refresh is serialised per session** by a Durable Object (`SessionRefresh`, keyed by WorkOS `sid`),
  because refresh tokens are single-use: two tabs renewing together cause one refresh, and the second
  gets the first one's result (for 30 s) instead of spending the same token twice and being signed out.
- **Only a terminal answer ends a session.** A WorkOS outage, a rate limit or an unexpected fault while
  reading the cookie is `503` with `Retry-After` and the cookie stays, so our outage is not their
  sign-out. The only paths to a 401 and a cleared cookie are a cookie we cannot read at all (wrong
  password, tampering), a terminal refusal from WorkOS, or a session too large to keep (below).
- **A renewal's new cookie is always kept.** The old refresh token is spent the moment WorkOS answers,
  so even when the new access token cannot be used (no readable `exp`) the new sealed cookie is set and
  the answer is a quick `503` retry.
- **The cookie size is checked where it can be seen.** A sealed session over 3800 characters is refused
  (sign-in goes back to `/lite/?signin=failed`; a renewal ends the session honestly) rather than being
  silently dropped by the browser. The real size with an access token, refresh token and user record
  has still not been measured.
- **Sign-out revokes the WorkOS session even when the access token has expired**, which is the usual
  state of the cookie when someone comes back and signs out (the session id is read from the sealed
  cookie, not from a verified token).
- **The refresh de-duplication survives eviction:** the Durable Object also writes its last successful
  result to its own storage, keyed by a hash of the old cookie (never the cookie), and ignores it after
  30 s.
- **Failures are logged** (the message only, never the request, cookies or tokens) and a browser
  navigation to sign-in lands back on the app with `?signin=failed` instead of a JSON page.
- **No open redirect:** after sign-in the person always lands on `/lite/`; the request cannot choose.
  The login `state` is random, single-use and compared in constant time. A failed sign-in returns to
  `/lite/?signin=failed` (the page does not show a message for it yet).
- `/lite/auth/token` and `/lite/auth/logout` refuse requests the browser marks `Sec-Fetch-Site: cross-site`.
- Sign-out is `POST /lite/auth/logout`: it clears both cookies at once and revokes the WorkOS session
  in the background; a failed revocation does not stop the sign-out.
- The CSP already restricts `connect-src` to the site and the API origin and `script-src` to `'self'`,
  which is what protects an in-memory token from injected script.

**Configuration, by name only.** Public vars in `app/wrangler.jsonc`: `WORKOS_CLIENT_ID`
(`client_01KQBBSMQTSMTBN7HEC9KQBJC0`, the Mukoko Account application that `CONSOLE_WORKOS_API_KEY` belongs to; not a secret) and `WORKOS_REDIRECT_URI`
(`https://shamwari.ai/lite/callback`). Two **secrets**, bound from the account's Secrets Store and
never written into git: `WORKOS_API_KEY` (the WorkOS environment's API key; the Worker is a
confidential client) and `COOKIE_PASSWORD` (seals the cookie; at least 32 random characters).
With either unbound the auth routes answer `503` and the gate fails closed: the page is a `503`, never served
(`docs/domains-and-deploy.md`, "Before sign-in can work, and what the gate does"). The bindings are by name in
`site/app/wrangler.jsonc` (`CONSOLE_WORKOS_API_KEY` and `SESSION_SECRET` in the shared Secrets Store).

**Not verified** (nothing here has met a real WorkOS tenant; no credentials exist in this session):
the sealed cookie must stay under the browser's size limit once it carries the access token, the
refresh token and the user record (the SDK is designed for this; the real size was not measured); the
cookie's 30-day lifetime is only an upper bound, and the real limit is the refresh token's, which a
terminal refusal turns into a sign-out; and the SDK's refresh and error classification were exercised
against a fake, not against WorkOS. The Worker was run under the Workers runtime locally (the real SDK
built the correct AuthKit URL and a bad cookie was refused), but no code exchange or refresh was run.

## The mobile app (Expo): a public client, PKCE, no secret

Built in `mobile/src/auth/`, tested without a phone (`mobile/test/auth.test.ts`). It signs in to the
**same Shamwari Chat AuthKit application** as the web chat (client `client_01M68PCT0T5ECHKDYH45ECT0GV`),
so the gateway verifies its tokens exactly as it does the chat's and nothing in the gateway changes.
It differs from the web chat in one way that matters: a phone cannot keep a secret, so there is no
session Worker. The app is a **public client** using the authorization code flow with **PKCE**
(WorkOS: `code_verifier` is required when the client secret is absent).

What the WorkOS documentation says, read 2026-11-02 (not exercised against a real tenant): authorize at
`/user_management/authorize` with `provider=authkit`, `state`, `code_challenge` and
`code_challenge_method=S256`; exchange and refresh at `POST /user_management/authenticate` (JSON);
refresh tokens **rotate**; sign-out is `/user_management/sessions/logout?session_id=…&return_to=…`
(read from the WorkOS Node SDK source). WorkOS's own Android SDK uses the same shape with a custom
scheme redirect and tells native apps to keep the access token in memory and the refresh token in
keystore-backed storage.

Rules the code keeps, each pinned by a test that fails when it breaks:

- **No secret in the bundle.** No `client_secret`, API key or `sk_` string in `mobile/src`. The exchange
  and refresh requests carry `client_id` and `code_verifier` / `refresh_token` only.
- **The verifier and state are saved before the browser opens** (the OS can kill the app while it is
  up), the redirect's `state` must match (constant-time) or nothing is exchanged, and the record is
  cleared whether or not the exchange worked. A cancel and `access_denied` are "cancelled", not errors.
- **Tokens:** the access token is in memory only; the refresh token is in the OS keystore only
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Nothing logs a token, a code or a verifier.
- **Rotation is saved first.** The new refresh token is written before the new access token is used,
  because the old one is already spent.
- **Refresh is serialised.** Any number of concurrent callers cause one refresh.
- **Only `invalid_grant` deletes the stored credential.** An outage, a 429 or a network failure keeps the
  session; the ask stays queued and is retried (the client treats a throwing credential lookup as
  offline, not as signed out). Any other refusal (a 401 `invalid_client`, an unexpected 4xx) means a
  request or configuration problem: the person is asked to sign in, but the keystore is **not** touched,
  so a wrong client id can never wipe everyone's session.
- **No stale write.** Sign-in and sign-out bump an epoch; a refresh that was in flight is discarded, so a
  late answer can neither sign the person back in after sign-out nor delete a newer sign-in.
  Two taps on "Sign in" are one sign-in.
- **After a 401** the app renews once and retries once with a different token; it never loops.
- **Sign-out** wipes this phone's copy first, before the browser opens: the waiting questions, the
  thread, the pasted developer key and the keystore session, and any send already in flight has its
  answer dropped. Only then does it open the WorkOS logout URL for the session. So on a shared phone,
  killing the app or a hung browser still leaves the next person nothing of the last person's and
  nothing able to send as them.
- **Rule 1 is untouched:** sign-in grants nothing new. The gateway still gives a signed-in person only
  the fixed `community` + `platform` grant, and the app still refuses a personal-scope ask on the phone.

**Redirect scheme.** The app's own id, `ai.shamwari.app` (not a generic word: any other app can claim a
generic scheme and intercept the redirect). Redirect `ai.shamwari.app://callback`, logout return
`ai.shamwari.app://signed-out`. Expo Go cannot use this scheme, so Expo Go and tests use the pasted
developer key; sign-in needs a development or preview build.

**Not verified:** nothing here has met a real WorkOS tenant or a phone. In particular: that the
Shamwari Chat application accepts a public-client exchange (no secret) and refresh; the exact error
body WorkOS returns for a spent or revoked refresh token (the app deletes the credential only on
`invalid_grant`; if WorkOS answers a revoked token with another code, the person is asked to sign in
again and nothing is deleted);
that `sid` is present in the token the app holds (it is needed to build the logout URL); and the
keychain behaviour across an iOS reinstall (a keychain item can outlive the app).

**Needs the owner (WorkOS production, Shamwari Chat application, Redirects tab):** add the redirect
URI `ai.shamwari.app://callback` and the logout return `ai.shamwari.app://signed-out`. Custom-scheme
redirects are accepted in this environment (it already holds `mukokolingo://auth/callback` and
`mukoko://sign-in-callback`); the environment-level list was read on 2026-11-02 and holds no Shamwari
entry. If the Shamwari Chat application does not allow a public client, say so: the alternative is a
small token-exchange Worker, which would hold the secret instead of the phone.

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

| Piece                                                                                     | State                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway accepts and verifies a WorkOS token                                               | built, 59 tests, guards mutation-checked                                                                                                                    |
| One fixed grant, no permissions, no `personal`                                            | built, tested                                                                                                                                               |
| Per-person metering on the canonical person id                                            | built; person ids must never equal entity ids (G6)                                                                                                          |
| Session Worker (`site/worker/`), `mukoko` AuthProvider, and the gate in front of `/lite/` | built, tested against a fake WorkOS and under the Workers runtime locally; secrets bound by name in `app/wrangler.jsonc`; **not deployed from this change** |
| Revocation by `sid` deny list                                                             | not built, not asked for                                                                                                                                    |

## Needs the owner

- **Done in WorkOS production (2026-10-31, relayed by the orchestrating session):** a dedicated
  AuthKit application **Shamwari Chat**, client `client_01M68PCT0T5ECHKDYH45ECT0GV` (not a
  secret), **access-token lifetime 300 s**, redirect URI `https://shamwari.ai/chat/callback` only,
  logout `https://shamwari.ai/chat/`, web origin `https://shamwari.ai`. **The sign-in page is now the light
  chat at `/lite/` (owner, 2026-11-01), so the app also needs the redirect URI
  `https://shamwari.ai/lite/callback`, the sign-in start `https://shamwari.ai/lite/auth/login` and the
  logout return `https://shamwari.ai/lite/`; the `/chat/` values are for the main chat and are left alone.** So
  `WORKOS_CLIENT_ID=client_01M68PCT0T5ECHKDYH45ECT0GV`, and the revocation window is about five
  minutes. The shared "Mukoko Account" app was not used because it has about forty redirect URIs
  and a five-hour access-token lifetime.
- **Changed 2026-11-11 (owner's decision, relayed by the orchestrating session): the light chat (`/lite/`) signs
  in through the Mukoko Account application, client `client_01KQBBSMQTSMTBN7HEC9KQBJC0`.** The Shamwari Chat
  application has no API key, so the Worker's confidential code exchange (with `CONSOLE_WORKOS_API_KEY`, which
  belongs to Mukoko Account) was refused. Consequences: the gateway must accept both client ids
  (`gateway/wrangler.jsonc`), and light-chat access tokens now live as long as that application's setting (about
  five hours, not five minutes), so a revoked session can keep working at the gateway for that long. The mobile
  app is unchanged and stays on Shamwari Chat.
- **Done: the JWT template.** Production now carries `urn:nyuchi:roles` (unchanged) plus
  `person_id` (`{{ user.external_id }}`). **No permission and no role is added for Shamwari, and
  no `aud`** (see above). Staging still has `{"aud": "https://api.shamwari.ai", ...}`. An unset
  `externalId` may render as an empty string or null rather than a missing claim; the gateway
  refuses both (403 `not_provisioned`).
- **Done: WorkOS `externalId` is set** for the 11 linked people (reconcile applied, in sync).
  Anyone without one is refused until they are linked.
- **Set in `gateway/wrangler.jsonc` (production vars), not yet read off a real token:**
  `WORKOS_CLIENT_ID` is the Shamwari Chat client above. `WORKOS_ISSUER` is
  two comma-separated values: `https://accounts.mukoko.com`, the `issuer` of the Mukoko Account custom
  domain's OIDC discovery document (`https://accounts.mukoko.com/.well-known/openid-configuration`), and
  the per-client form `https://accounts.mukoko.com/user_management/client_01KQBBSMQTSMTBN7HEC9KQBJC0` that
  WorkOS user-management tokens have carried. Which one `iss` really is cannot be told without a real
  signed-in token, so both are accepted and anything else is refused; the issuer is per environment, not
  per app. (An earlier version of this file named `auth.mukoko.com`, which is not the
  Mukoko Account domain.) WorkOS advises copying `iss` from a decoded
  token because the documented form varies (a trailing slash is tolerated here). If this is
  wrong, every WorkOS token is refused with 401 and `sk_shamwari_` keys are unaffected.
  The JWKS (default URL for the chat client id) serves the same signing key as the Mukoko Account
  one, checked. `WORKOS_AUDIENCE` is unset. `WORKOS_MONTHLY_TOKEN_CAP` is `1000000`: about $0.20
  at the economy model's blended price, an estimate the owner can replace.
- **Still to do: decode one real access token** from the Shamwari Chat app and confirm `iss`,
  `client_id`, `sid` and `person_id` before the chat flag is turned on.
- **Approve the gateway auth change at merge time** (this PR adds the `jose` dependency, MIT,
  the verifier for the token; nothing else new).
- **A yes to the `chat-auth` Worker** (a new deployment) and where its cookie-sealing secret
  and WorkOS client secret live.
