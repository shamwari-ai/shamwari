# Shamwari Chat: the R1 chat and R2 Lite PWA

Tracking: #83. Native apps: `docs/app-plan.md` (#86). Tiers and budgets:
`docs/tiered-access-design.md`. Owner direction, 2026-10-31: launching the chat
and the app is very high priority.

Status: **building**. It runs against `site/chat-mock/` (a stand-in for the
gateway), not against a deployed gateway, so it does not answer real questions
yet. The site says "Building", and `site/test/status.test.ts` fails if anyone
flips it to "Live" without `docs/chat-live-evidence.md` recording a real cited
answer.

## Where it lives, and why

**`shamwari.ai/chat/`, a route in `site/`.** Not `chat.shamwari.ai`, not a new
workspace app.

- One deploy, one origin, the same Workers static assets the site already uses.
  `chat.shamwari.ai` would need a DNS record, a second Worker and a second
  pipeline, all owner-only steps, for no user-visible gain.
- The Mzizi tokens, brand overlay and CI checks are already here.
- The service worker is scoped to `/chat/`, so it never touches the marketing
  pages. Chat JS is loaded only on `/chat/`; `site/check.mjs` fails the build if
  any other page ships a script.
- The cost is coupling: a marketing copy edit and a chat change deploy together.
  The site is already built independently of anything that can deploy inference,
  so this is acceptable. If the chat grows its own release rhythm, moving it out
  is cheap because it only shares `chat.css` imports and the tokens.

## Built for poor devices

No framework. Plain TypeScript, bundled by Astro, with DOM built through
`textContent` (never `innerHTML`, so a Ground passage cannot inject markup).
`@bundu/ui` React components are not used: they render fine statically, but
shipping React to the browser would take most of the budget. Mzizi's *tokens*
are used directly through `tokens.css` and `color-scheme.css` (plain CSS, dark
mode follows the device). Mzizi has no chat or citation component today.

| Budget | Limit | Check |
| --- | --- | --- |
| First-load JS, gzipped | 100 KB | `site/check.mjs` (prints the measured number) |
| Chat CSS, gzipped | 30 KB | `site/check.mjs` |
| Web fonts | none, system stack | `site/check.mjs` |
| Touch targets | 48 px (Mzizi) | e2e test |

## Data decisions

- **History is local only.** Conversations are kept in IndexedDB on the device
  and never sent to a server by the app. The gateway receives the messages of
  the current thread to answer, as any chat API does, and stores no
  conversation for this surface. "New chat" starts an empty thread; "Delete
  history" wipes the database.
- **Offline queue.** A question written offline is stored on the device and sent
  when the network returns, with one `Idempotency-Key` per message so a retry
  after a dropped connection is replayed by the gateway instead of answered and
  metered twice.
- **Scope.** The app sends `scope: community` or `platform` and never
  `personal`. A personal question gets the gateway's `409
  scope_requires_local_inference`, and the app explains it kindly: personal
  questions need Shamwari Mind on the device, which is not shipped yet. It is
  never rendered as a generic error.
- **Language claims.** The footer says "Answered by Shamwari Cloud (a routed
  model). This is not legal advice." No sovereignty or residency claim is made
  for Cloud.

## Sign-in

Two modes behind one `AuthProvider` interface, so the second can replace the
first without touching the chat:

1. **Developer key (now, isolated).** The person pastes a `sk_shamwari_…` key.
   It is kept in `localStorage` on the device, sent only to the Shamwari API,
   and the screen says it is for testing. Nothing else in the app reads it
   except through the provider.
2. **Mukoko Account (WorkOS AuthKit), not built.** The Console's own sign-in
   code (`nyuchi/nyuchi-platform`, `console/backend`) could not be read from the
   session that built this (access to that repository was denied by the
   session's classifier), so this is a proposal to check against the Console,
   not a description of it.

### Proposal: how a signed-in person gets a metered per-person key

1. The chat redirects to AuthKit (Mukoko Account) and returns to
   `https://shamwari.ai/chat/callback` with an authorization code.
2. A Servers API route (new, internal, namespace `/v1/shamwari`) exchanges the
   code, finds the person, and **issues or returns that person's key** in
   `platform.api_keys`: `key_type = "shamwari"`, `owner_person_id` set, tier
   `community`, scopes `["community","platform"]` (never `personal`), a small
   `monthly_token_cap`. This is exactly the shape `docs/servers-api-contract.md`
   already verifies, so the gateway needs no change to meter it per person.
3. The key is returned once to the browser and stored on the device. Signing out
   removes it; the Console can revoke it, and the gateway stops honouring it
   within `AUTH_CACHE_TTL` (60 s).
4. Risk to accept or reject: a key in `localStorage` is readable by script on the
   origin. Mitigations are a strict CSP on `/chat/` (no third-party script), a
   low cap, no `personal` scope, and revocation. The stronger alternative is a
   session cookie plus a same-origin Worker that attaches the key, which adds a
   server component this repo deliberately does not have yet.

**Needs the owner:** the Servers API issuing route, a WorkOS redirect URI for
`https://shamwari.ai/chat/callback`, and a decision between the two storage
options above.

## Gateway changes this needs (not made here)

- **CORS.** The gateway sends no CORS headers today, so a browser on
  `shamwari.ai` cannot call `api.shamwari.ai`. It needs an `OPTIONS` answer and
  `Access-Control-Allow-Origin` for `https://shamwari.ai` (not `*`), allowing the
  `Authorization`, `Content-Type` and `Idempotency-Key` headers. This is a code
  change with tests, and a deploy the owner must approve.
- **Streaming** (SSE) is deliberately out of this phase. The client's
  `onProgress` hook and the answer component are built so it can be added
  without a rewrite.
- **402.** The gateway answers `429 quota_exceeded` when a plan is used up and
  never 402. The app handles both.

## Run it

```bash
cd site
npm ci
node chat-mock/server.mjs        # gateway stand-in on http://localhost:8788
npm run dev                      # http://localhost:4321/chat/
```

Developer keys for the mock: `sk_shamwari_mock_ok` answers; `_402`, `_403`,
`_429`, `_503` return those errors. Asking about `personal` scope returns the
409, and a question containing "slow" takes 3 s.
