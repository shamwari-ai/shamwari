# Shamwari Chat sign-in: the Servers API key route and the WorkOS redirect

Tracking: #83. Context: `docs/chat-app.md` (how the chat works today),
`docs/servers-api-contract.md` (how the gateway verifies keys). Status: **spec,
not built.** Until it ships the chat keeps its developer-key mode behind the
`AuthProvider` seam (`site/src/chat/auth.ts`).

**Provenance of the Console facts below.** The session that wrote this could not
read `nyuchi/nyuchi-platform` (`console/backend`); the owner's session relayed
how the Console signs in, and this spec follows that account. Anything marked
_check_ should be confirmed against the Console code before it is built.

## What the Console does (as relayed)

- Signs in through the **WorkOS Auth API on the custom domain `auth.mukoko.com`**,
  app **Mukoko Account**, client `client_01KQBBSMQTSMTBN7HEC9KQBJC0`.
- **PKCE authorization-code flow**, with a callback on the app's own origin.
- An **encrypted first-party session cookie** holds the session.
- **Refresh tokens are single-use**, so refreshes are serialised per token.
- Server calls to the Nyuchi API use a **short-lived person token**.

## What the chat does, aligned to that

The chat is a static site, so the part that holds a session cookie and a refresh
token needs a server. **Proposal: one small Worker, `chat-auth`, on
`https://shamwari.ai/chat/auth/*`**, that does what the Console backend does and
nothing else. It is a new deployment and needs the owner's yes.

```
browser                    chat-auth Worker                WorkOS / Servers API
  │ GET /chat/auth/login ───►│ make state + PKCE verifier, set short cookie
  │◄── 302 auth.mukoko.com/user_management/authorize?client_id=…&redirect_uri=
  │         https://shamwari.ai/chat/callback&code_challenge=…&state=…
  │ …person signs in with Mukoko Account…
  │ GET /chat/callback?code&state ─►│ check state, POST code + verifier to
  │                                 │ auth.mukoko.com/user_management/authenticate
  │                                 │ ◄─ access token, refresh token, person id
  │                                 │ set encrypted session cookie (HttpOnly,
  │                                 │ Secure, SameSite=Lax, Path=/chat/)
  │                                 │ POST /v1/shamwari/keys/issue  (below)
  │◄── 302 /chat/ + key in a one-time handoff (see "Handing the key over")
```

- **Redirect URI to register on the WorkOS app:** `https://shamwari.ai/chat/callback`
  (and, for testing, the branch-preview origin if the owner wants one; never a
  wildcard).
- **Single-use refresh tokens:** the Worker refreshes at most once per session at
  a time (a per-session lock, for example a Durable Object or a KV lease with a
  short TTL) and stores the new refresh token before using the new access token.
- **Why not a pure browser PKCE flow?** It would work for the code exchange (a
  public client needs no secret), but the refresh token would live in browser
  storage, and a rotated single-use token raced by two tabs signs the person out.
  The Console avoids both with the cookie and the lock; the chat should too.

## The Servers API route to build: issue a person's key

`POST /v1/shamwari/keys/issue` on the Nyuchi Servers API (internal, same
`Authorization: Bearer <SERVERS_API_TOKEN>` and `x-nyuchi-internal-key` as the
routes in `docs/servers-api-contract.md`). Called only by `chat-auth`.

Request:

```json
{ "person_id": "string", "surface": "shamwari-chat" }
```

Behaviour:

1. Find the person's existing **active** `shamwari` key for this surface in
   `platform.api_keys`; if there is one, **rotate it** (revoke the old, mint a
   new) rather than returning a stored secret, because the table holds only the
   SHA-256 hash and the secret cannot be read back.
2. Otherwise mint one. Format `sk_shamwari_` + 32 random bytes, URL-safe base64.
3. Store: `key_type = "shamwari"`, `owner_person_id = person_id`, the person's
   owning entity as `owner_entity_id`, `key_hash`, `key_prefix`
   (`sk_shamwari_`), `is_active = true`.
4. **Fixed limits, not caller-chosen:** `tier = "community"`,
   `scopes = ["community", "platform"]` (never `personal`; a key that cannot ask
   for it cannot be tricked into it), `monthly_token_cap` = a small integer set by
   the owner (suggested to be set from the $0.20 per user per month target in
   `docs/tiered-access-design.md`, converted to tokens with `gateway/pricing.json`).
5. **Revocable:** the existing revoke path and the gateway's 60 s `AUTH_CACHE_TTL`
   apply unchanged; the Console can revoke it.

Response `200`:

```json
{ "api_key_id": "string", "key": "sk_shamwari_…", "monthly_token_cap": 100000,
  "scopes": ["community", "platform"] }
```

The raw `key` is returned **once** and never logged. Errors: `401`/`403` for a bad
service credential, `404 {"error":"unknown_person"}`, `409` if a rotation is
already in flight for that person, `5xx` otherwise (the Worker shows the chat's
"try again" state). The gateway needs **no change** to meter it per person: this
is the key shape it already verifies (`owner_person_id` is part of the 200 body
today).

## Handing the key over to the page

The gateway authenticates with a Bearer **key**, not a cookie, and the key has to
reach `fetch()` in the page. Two options; the first is proposed.

1. **A short-lived key the page re-fetches.** `GET /chat/auth/key` (cookie
   authenticated, same origin, `Cache-Control: no-store`) returns the key; the
   page keeps it in memory only, and asks again after a reload. The long-lived
   secret is then the HttpOnly cookie, which script cannot read, and the key
   can be rotated on every session refresh.
2. **Proxy every call through `chat-auth`.** The page never sees a key; the Worker
   attaches it. Strongest for secrecy, but it puts a Worker hop on every question,
   which costs latency on the networks this app is built for and breaks the offline
   queue's direct `Idempotency-Key` retry unless the Worker forwards it.

With option 1 the CSP in `site/scripts/post-build.mjs` already restricts
`connect-src` to the site and the API origin, and `script-src 'self'`, which is
what protects an in-memory key from injected script.

## What changes in the chat

- A second `AuthProvider` (`mukoko`) next to `developerKey`: `getKey()` returns the
  in-memory key; "Sign in with Mukoko" (disabled today) goes to
  `/chat/auth/login`; sign-out clears the cookie through `POST /chat/auth/logout`.
- The developer-key panel stays until this ships, then is hidden outside
  development builds.
- No change to the client, the queue or the scope handling.

## Needs the owner

- A yes to the `chat-auth` Worker (a new deployment) and where its session
  encryption key and WorkOS client secret (if the app is confidential) live.
- The WorkOS redirect URI registration above.
- The Servers API issue-key route, and the monthly token cap number.
- Confirmation of the _check_ items against the Console code: cookie attributes,
  the lock mechanism, and whether the person token is exchanged before or after
  `keys/issue`.
- A comment on `nyuchi-servers-api` issue #2 carrying the route spec above. That
  repository is outside this session's access, so nothing was posted there.
