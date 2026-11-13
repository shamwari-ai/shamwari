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

**Its own Worker on the apex, at `https://shamwari.ai/lite/`: the light edge chat.** The marketing
site is a separate Worker on `https://www.shamwari.ai`. Owner decision, 2026-10-31 (two Workers),
and 2026-11-01 (the main Shamwari Chat, a LibreChat fork, owns `https://shamwari.ai/chat/`; this
original build is kept as the light edge chat at `/lite/`, and how people are routed between the
two is designed elsewhere). The full map, the build commands and the Cloudflare steps are in
`docs/domains-and-deploy.md`.

- The app is the root product, so it gets the short hostname. The marketing site is
  `www`. Neither Worker can serve the other's pages: `site/check.mjs` fails the build if
  one does, and the two build and test independently in CI.
- Same repository and the same `site/` package, so the Mzizi tokens, the brand overlay
  and the checks are shared, but two Astro configs (`astro.config.mjs` for marketing,
  `astro.app.config.mjs` for the app) with separate source (`app-src/`) and public
  (`app-public/`) folders. Chat JS is built only into the app.
- The service worker is scoped to `/lite/` on the app origin. The root `/` answers 302
  to `/chat/` (the main chat) for now; `/chat/` itself is not served by this Worker.
- The cost is one more Workers Builds project to create and a hostname to move; both are
  dashboard steps in the doc above.

## Built for poor devices

No framework. Plain TypeScript, bundled by Astro, with DOM built through
`textContent` (never `innerHTML`, so a Ground passage cannot inject markup).
`@bundu/ui` React components are not used: they render fine statically, but
shipping React to the browser would take most of the budget.

The frame is Mzizi's own: `AppShell` from `@bundu/ui/app` (the standard app chrome, mounted
once). It is an Astro component, so it ships as HTML and one small script, with no React. It
brings the top bar (the brand, a new-chat action, the bell, the account menu), a drawer for the
chats kept on the device, and a quiet footer. Its classes are Tailwind's, so the app build
compiles Tailwind to one static stylesheet (`tailwind.app.config.mjs` scans only the chat and
the three `@bundu/ui` parts it uses). The chat's own styles are plain CSS in `src/chat/chat.css`
and take every size from the Bundu floor tokens (`--fs-body`, `--fs-caption`, `--target-floor`,
`--inset-floor`, `--gap-floor`, `--leading-floor`), never from numbers of their own. Dark mode
follows the device. Nothing is inlined into the page, because its content-security policy allows
scripts and styles only from its own origin.

Where the chat departs from the library, and why:

- **No web fonts.** Mzizi names Noto Sans first; the chat loads no font and falls back to the
  device's own, because the shell has to paint on 2G.
- **A hand-drawn bell.** The icon set has no bell yet.
- **Settings is a native `<dialog>` opened from the account row, not Mzizi's `AccountMenu`.** The
  component names a signed-in person (their initials and name); this chat has none to show until
  Mukoko sign-in is on. Switch to `AccountMenu` then. The dialog is modal (focus held, Esc closes,
  the page behind it is inert), full screen below 40rem with a pinned 49 px close button, a centred
  box of at most 32rem above. Its markup is in the page, not a lazy chunk: the handlers it needs
  (language, delete, install, sign out) are bound at start, and the markup is the same bytes the old
  panel had. There is no Appearance section: the page follows the device's light or dark setting and
  there is no override to choose yet. Language is a radio group (all three in view, one tap each) and
  the Offline mode switch lives here too; the top bar shows an Offline mode badge only while it is on, and the
  badge opens Settings.
- **The menu, close and top-bar action buttons are lifted from 44 px to the 49 px floor** in
  `chat.css`; `AppShell` draws them at 44 px. Worth raising upstream.

The Bundu floor (17 px body, 14 px minimum text, a 49 px hit region on every control, 7 px
between controls, 14 px insets, 1.5 leading) is measured on the rendered page by the e2e
tests in `site/e2e/a11y.spec.ts`: the home screen, an answer with its citation card, the
account menu open and the drawer open. A control that falls under it fails the build.

| Budget                         | Limit                 | Measured (this build)        | Check            |
| ------------------------------ | --------------------- | ---------------------------- | ---------------- |
| First-load JS, gzipped         | 100 KB                | 12.3 KB                      | `site/check.mjs` |
| Chat CSS, gzipped              | 30 KB                 | 19.0 KB                      | `site/check.mjs` |
| Whole first load (HTML+CSS+JS) | 50 KB (R2 design)     | 34.8 KB                      | `site/check.mjs` |
| Web fonts                      | none, system stack    | none                         | `site/check.mjs` |
| Hit regions and text sizes     | the Bundu floor       | all at or above the floor    | e2e test         |
| Accessibility                  | axe wcag2a/aa/21/22aa | 0 violations, light and dark | e2e test         |

## How an answer is drawn

An answer is formatted: bold, italics, headings, lists, inline code and code blocks, quotes, links and simple
tables, as the model writes them. `site/src/chat/markdown.ts` (about 2.5 KB gzipped, hand-written, in the main
chunk) builds the DOM with `createElement` and text nodes only: raw HTML in an answer is shown as the characters it
is, links are limited to `http:`, `https:` and `mailto:` (with `rel="noopener noreferrer"` and
`target="_blank"`), and an image is drawn as its alt text. It is linear in the size of the answer (no lookbehind,
block nesting capped at 4, inline at 5, an answer over 60 000 characters is one plain paragraph).
`test/app/markdown.test.ts` fails if any of that breaks, and `e2e/markdown.spec.ts` checks a malicious answer in a
real browser. Headings are styled paragraphs with `role="heading"` that start at level 2 and never skip a level, so
the page's outline is untouched; tables and code blocks scroll inside their own boxes. Copy, Share and Save still
use `plainText()`, so the clipboard and a WhatsApp message get plain words. Refs #269.

## Installable and offline

- **Install.** A web manifest scoped to `/lite/` (standalone, sodalite theme,
  192/512 and maskable icons) makes it installable from the browser on Android.
  iOS has no install event, so there people use Share, then Add to Home Screen;
  the page carries the Apple meta tags for that.
- **Service worker** (`/lite/sw.js`, scope `/lite/`, generated by
  `site/scripts/post-build.mjs` with the exact hashed files of that build).
  The shell opens from cache first and refreshes in the background, so it paints
  at once on a bad connection. It answers only same-origin GETs under `/lite/`
  and `/lite/_astro/`; the API is another origin and a POST, so a question and its
  answer never enter a cache. `check.mjs` fails the build if a precached file
  is missing or the worker could touch API traffic.
- **Offline queue.** Offline, or when an answer does not arrive (a timeout on
  2G), the question is saved on the device as "waiting to send", with the
  person told so, and sent by itself when the network returns (the `online`
  event, the tab becoming visible, and a 15 s to 5 min backoff while the tab is
  open). It is sent oldest first, one at a time, and a question queued in an
  earlier chat is still delivered after New chat. Each question's id is its
  `Idempotency-Key`, so a retry after a dropped connection is replayed by the
  gateway instead of answered and metered twice. Background Sync is not used:
  iOS does not have it, and the people this is for are often on iOS WebViews
  or old Android.
- **Content Security Policy** on `/lite/*` (written to `dist/_headers`, which
  Workers static assets honours): `script-src 'self'`, no inline script or
  style, `connect-src` only this site and the one API origin the build was
  pointed at, `frame-ancestors 'none'`. The e2e tests run under the same
  headers and fail on any violation.

## Data decisions

- **History is local only; the server keeps a service record, not content.**
  Conversations are kept in IndexedDB on the device and the app never syncs them
  anywhere. "New chat" starts an empty thread; "Delete history" wipes the
  database. Owner decision (2026-10-31): for the `pwa` channel the gateway keeps
  **no message or answer text**; the app sends `X-Shamwari-Channel: pwa` and the
  gateway then writes no `conversations` document (so nothing is trainable),
  only the usage event (request id, scope, model, token counts, path, time).
  Built in #125. One exception is disclosed in the app's Settings: so a retry is
  never charged twice, the idempotent-replay path holds the answer in KV for up to
  10 minutes and then deletes it. The footer says exactly this and nothing more.
  Until #125 is deployed the older gateway still stores the conversation, so
  **this wording is only true once that change is deployed**.
- **The drawer is local too: pinned, projects, chats, artifacts.** A _project_ is a
  named group of chats; a chat is in at most one. _Pinned_ is a shortcut to a chat
  or project, not a move. An _artifact_ is one answer the person chose to keep (its
  text and sources), kept apart from the chat so deleting the chat does not lose
  it. All three live in the same IndexedDB (`projects`, `artifacts` beside
  `threads`, database version 2) and go with "Delete history". Nothing about them
  is sent anywhere. These are defaults, chosen so the drawer could ship; they are
  cheap to change while the data is only on the device.
- **Owner decision, 2026-11-11: the mobile app keeps chats on the device (sync is opt-in);
  every other surface (the web chat and Lite) stores them in the database.** This
  supersedes "History is local only" above for the web. The collections already exist in
  Mongo (`shamwari.conversations`: `ownerPersonId`, `lastMessageAt`, `surfaceContext`,
  `licenseClass`, `promoted`; `shamwari.messages`: `conversationId` + `sequence`, unique,
  `licenseClass`), both empty today. The Nyuchi Servers API (`/v1/shamwari/*`) owns the
  messages routes and the Shamwari API (`api.shamwari.ai`) serves them to the apps; Core
  holds no database login. Both are Rust (#66). Until they are live the web chat keeps
  using the device store described below, so nothing breaks. The footer text ("saved on
  this device only") and the `pwa` channel's "no content stored" rule change with the
  web switch-over, in the same release. Rule 2 still holds: only `open_weight` provenance
  trains Mind, whatever is stored.
- **Offline queue.** A question written offline is stored on the device and sent
  when the network returns, with one `Idempotency-Key` per message so a retry
  after a dropped connection is replayed by the gateway instead of answered and
  metered twice.
- **Scope.** The app sends `scope: community` or `platform` and never
  `personal`. A personal question gets the gateway's 409
  (`scope_requires_local_inference`), and the app explains it kindly: personal
  questions need Shamwari Mind on the device, which is not shipped yet. It is
  never rendered as a generic error.
- **Language claims.** The footer says "Answered by Shamwari Cloud (a routed
  model). This is not legal advice." No sovereignty or residency claim is made
  for Cloud.

## Sign-in

Two providers behind one `AuthProvider` interface (`site/src/chat/auth.ts`), so
the second replaces the first without touching the chat:

1. **Developer key (now, isolated).** The person pastes a `sk_shamwari_…` key.
   It is kept in `localStorage` on the device, sent only to the Shamwari API,
   and the screen says it is for testing.
2. **Mukoko Account (built, OFF).** Owner direction, 2026-10-31: a person signs
   in with WorkOS AuthKit and the gateway verifies their **WorkOS access token**
   (shamwari-ai/shamwari#130). **Nothing here mints or stores a per-user key.**
   The page holds the short-lived access token **in memory only** (never
   localStorage, sessionStorage, IndexedDB, a cookie or the Cache API), gets it
   from the session Worker's cookie-authenticated `GET /auth/token`, and
   sends it as `Authorization: Bearer`. Renewals are serialised, because the
   session behind it rotates single-use refresh tokens. A `401` from the gateway
   triggers **one** silent renewal and one repeat of the ask under the same
   `Idempotency-Key`; a second `401` goes to sign-in, never a loop. Sign-out
   clears the token, asks the Worker to end the session, and does not sign back
   in from the cookie. Being offline is not being signed out: a non-secret
   "signed in before" yes/no (`shamwari.mukoko.hint`) is the only thing kept, so
   an offline reload does not throw a signed-in person at the sign-in screen.
   **Mukoko sign-in is the default build mode** (`site/src/chat/auth-mode.ts`); the developer-key screen is built only by `PUBLIC_CHAT_AUTH=developer-key`, and `node check.mjs app` plus `test/app/auth-mode.test.ts` fail a build that comes out in any other mode. The
   session Worker itself (login, callback, cookie, refresh) is a design in
   `docs/chat-signin.md` on #130, not code; the e2e tests run against a stand-in
   for it (`e2e/serve.mjs --stub-auth`). A found-and-fixed detail: the service
   worker passes `/auth/*` and `/callback` (and the old `/lite/auth/*`, `/lite/callback`) straight to the network, or
   it would answer the sign-in redirect from the cached shell.
   **Rollout note:** that pass-through is in the service worker, and a worker
   update waits until every tab is closed. A returning installed-app user who
   keeps the app open would still be served the cached shell for the sign-in
   redirect until they close it. Turn the flag on only after a release has been
   live long enough for workers to have updated (or add a "reload to update"
   prompt first). Also: sign-out removes the chats from the device (a Mukoko
   account belongs to a person, the phone may not), and a sign-out the session
   Worker did not acknowledge is retried before anything else on the next visit,
   so a surviving cookie cannot sign the previous person back in.

## Gateway changes this needs (not made here)

- **CORS.** The gateway sends no CORS headers today, so a browser on
  `shamwari.ai` cannot call `api.shamwari.ai`. It needs an `OPTIONS` answer and
  `Access-Control-Allow-Origin` for `https://shamwari.ai` (not `*`), allowing the
  `Authorization`, `Content-Type`, `Idempotency-Key` and `X-Shamwari-Channel` request headers, and
  `Access-Control-Expose-Headers: Retry-After` (found by the e2e test: without it
  a browser hides `Retry-After` from the page and the app cannot say how long to
  wait). This is a code
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
PUBLIC_SHAMWARI_API=http://localhost:8788 npm run dev:app   # http://localhost:4321/lite/
```

Developer keys for the mock: `sk_shamwari_mock_ok` answers; `_402`, `_403`,
`_429`, `_503` return those errors. Asking about `personal` scope returns the
409, and a question containing "slow" takes 3 s.

## Light and dark, and the drawer's density (2026-11-12)

- **Themes are Mzizi's.** `chat.css` imports `@bundu/ui` `globals.css` (tokens and the density layer), then `color-scheme.css`, then
  the brand overlay last. Without `color-scheme.css` nothing set `.dark` or `data-theme`, so a dark phone got a light page with
  white text (the "before" screenshots in `docs/ui-2026-11-12/` are byte-identical in light and dark). Now the page follows
  `prefers-color-scheme`, and an explicit `data-theme="light"` (or `"dark"`) wins. `body` takes its colour and background from the
  tokens. Tests: `e2e/theme.spec.ts`, and the floor audit and axe run in dark.
- **Density is Mzizi's.** `@bundu/ui` 0.14.0: the hit region is 49px always (`--target-floor`); controls are DRAWN at
  `--size-control-sm`, which is 32px on a desktop with a mouse (64rem up, fine pointer, hover, no touch) and 49px everywhere else. The
  drawer's rows (sections, foot rows, chat titles) use that token, a 14px label, a flat look (no border or fill at rest, a soft
  fill on hover, a stronger one and a marker on the open section) and 7px between rows. The foot rows (Use the API, Disclaimer and
  privacy, Settings) are text only, no icons. Tests: `e2e-desktop/density.spec.ts` (32px, flat, no icons, no overlap, light and
  dark) and `e2e/density-touch.spec.ts` (49px on touch at any width).
- **Owner's list (2026-11-12), each with a test:** labels never break inside a word (rows wrap at spaces only, the chip stays on one
  line, `e2e-desktop/density.spec.ts` at 1000, 1280 and 1440, light and dark); a fixed sidebar column of 17.5rem; the version line and
  the Install button live in Settings, not the drawer's foot or above the composer; the top bar says "Offline mode" and "New chat"
  from 40rem up; controls use the small radius, not the marketing pill; New chat is a quiet outline and the composer is the filled
  control; the foot rows sit under one hairline; muted text is held to 4.5:1 in both themes (`e2e/theme.spec.ts`).
- **Why not `SideNav`:** the package's `SideNav` renders links with tooltips and 44px touch rows; the drawer needs in-page section
  buttons (`aria-current` follows the open section), a non-interactive "coming soon" row and a different set of foot rows, so
  the rows are the chat's own, built from the same tokens, not from numbers of its own.

## The shell as a chat console (2026-11-12)

The drawer and the page were rebuilt to read like the chat consoles people already know. `e2e/shell.spec.ts` covers the new
behaviour; the geometry tests moved with it. Screenshots (light and dark; 390, 1000, 1280 and 1440px): `docs/ui-2026-11-12/shell-*.png`.

- **Drawer** (a slim 17.5rem column from 64rem): the brand and a collapse toggle at the top; plain rows, 16px icons, no fill: New
  chat, Search chats, then the sections (Chat, Projects, Factory, Artifacts, Plugins); the history under muted, collapsible labels
  (Pinned, Recents) and, inside Recents, Today / Yesterday / Previous 7 days / Older; one line per chat, the title cut with an
  ellipsis and the time muted at the right (the hour today, the weekday this week, else the day and month); the open chat has a
  soft fill. Search opens a field and narrows the lists by title; Escape closes it. The account row is pinned at the bottom and opens
  the Settings dialog (language and its draft note; delete history, Install, remove key; Disclaimer and privacy, Use the API, version). There is no version line, Install
  pill or big button in the drawer itself.
- **Page:** one centred column (46rem). The top bar is thin and shows the chat's title (it is the page's `h1`; with no messages it
  is the app name, for screen readers only). Replies are plain prose with a quiet row under them (Copy answer, Save answer); the
  person's own question is a soft block at the right. The composer is one rounded container: the text above, a round send button
  below that is muted and disabled until there is text; Enter sends, Shift+Enter is a new line.
- **Chat menu and sources:** pin, project and delete live in a "…" menu beside the chat's title (a popover; Delete still asks first). A
  source is one compact row (Source badge, the section, an "Open source" link) with the document, issuer and date under a disclosure, with a one-line "Taken from a cited source, not guessed."
  The composer's container is its only edge; its focus ring is the container's.
- **Row menu:** each chat in the list has its own "…" (pin, project, delete). With a mouse it shows over the time on hover and on focus;
  on touch it is always there, beside the row. One shared popover, inside the drawer so opening it does not close the drawer.
- **Not built yet, on purpose:** thumbs up/down (nothing
  stores feedback), read aloud (no Shona/Ndebele text to speech), and the "+" attach and microphone buttons (the next piece).

## Attachments, phase 1: on this device only (2026-11-12)

A "+" at the left of the composer opens a menu with **Upload a file** (a skills entry is not shown until Skills has something in it), and a
microphone records a **voice note**. Both stay on this device and go nowhere: adding, recording and removing make no network request
(`e2e/attach.spec.ts` watches every request), and what is sent with the question is its text and nothing about the attachment.

- **Where they live:** until the question is sent they are in memory only (up to 4 per question, 10 MB each, a voice note up to
  5 minutes). On send they are written to IndexedDB (`files`, database version 3) next to the question, and every chip says
  "Kept on this device. Not sent." A voice note plays from the copy on the device; a file is offered as "Save a copy". Deleting a chat,
  discarding a queued question or deleting history removes its files; starting another chat leaves unsent ones behind.
- **What it does not do:** no transcription (we promise nothing for Shona or Ndebele speech), no reading of a file's contents, no text to
  speech. The model never sees an attachment.
- **CSP:** `media-src 'self' blob:` was added in `scripts/post-build.mjs` so a recording can play from a blob URL made on the device; nothing
  else may load media.
- **Known limits:** attachments are not encrypted on the device (same as the chats); the attachments code (1.5 KB gzipped) loads on the first tap of "+" or the microphone, so the first load stays under its budget.

## Stopping a slow answer (2026-11-12)

Ten seconds after a question is sent, the thinking bubble says the network is slow and offers **Stop**. Stop cancels the request in the browser
(the client already took an `AbortSignal`); the question is kept on this device, marked "Stopped. Your question is kept on this device and
was not answered.", and is NOT queued, so nothing sends it again by itself. The person can **Send now** (under a fresh idempotency key, since
the gateway may still be finishing the first try) or **Discard**. An answer that arrives in the same moment as the click is shown as usual.
It reuses the offline-mode `local` status with `hint: 'stopped'`. Not covered: Stop during a credential renewal waits for the renewal.

## Plain messages (2026-11-13)

Owner's direction: no markdown marks in messages, no chat bubbles, smaller message text, a really small "thinking", and text (not icons) for
the answer actions. An answer is shown with `plainText()` (`render.ts`): headings, bold, italic, code, quotes, rules, tables and fences lose their
marks, list items become plain dashes, `[text](url)` becomes "text (url)" (the address is the pointer to the source); no regex lookbehind (older phones
cannot parse it). The same plain words are copied, shared and saved (a saved answer from before is shown plain). The question is plain text too,
set apart by weight (600), not by a box; message text is 14px (`--fs-small`, the smallest the Bundu floor allows) and "thinking" is 14px and
muted. Copy answer, Share answer (only where the browser can share; closing the sheet is not an error, any other failure copies the text instead)
and Save answer are text buttons. Refusal and error boxes stay: they are notices, not bubbles.
