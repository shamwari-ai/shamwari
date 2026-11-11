# Two Workers, two hostnames: the app and the marketing site

Owner decision, 2026-10-31. Tracking: #83. This is the map of what lives where and the
exact order to switch it on.

**Status, 2026-11-11:** `shamwari-app` is deployed (created with Wrangler from `staging`, not yet
connected to GitHub as a Workers Build, so it is redeployed by hand with
`npx wrangler deploy --config wrangler.app.jsonc` from `site/`). The apex `shamwari.ai` was moved to it
with the Workers custom-domains API (`override_existing_origin`), `www.shamwari.ai` stays on
`shamwari-site`, and `api.shamwari.ai` is the gateway. The root `/` sends visitors to `/lite/` for now
(`CHAT_LIVE` is `false`). The sign-in secrets are not bound yet, so sign-in answers 503 and the chat
stays in developer-key mode. To undo the apex move, point `shamwari.ai` back at `shamwari-site` with the
same API call and restore the apex line in `site/wrangler.jsonc`.

## What lives where

|                 | Shamwari Chat (the app)                     | Marketing site                                                 |
| --------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Worker          | `shamwari-app`                              | `shamwari-site` (the existing one)                             |
| Hostname        | `https://shamwari.ai` (the apex)            | `https://www.shamwari.ai`                                      |
| Pages           | `/lite/` only. `/` answers 302 to `/chat/`. | Home, Blueprint, Project, Contact, `sitemap.xml`, `robots.txt` |
| Source          | `site/app-src/`, `site/app-public/`         | `site/src/`, `site/public/`                                    |
| Astro config    | `site/astro.app.config.mjs`                 | `site/astro.config.mjs`                                        |
| Wrangler config | `site/wrangler.app.jsonc`                   | `site/wrangler.jsonc`                                          |
| Build           | `npm run build:app` into `site/dist-app/`   | `npm run build` into `site/dist/`                              |
| CI job          | "Chat app (build, check, unit, e2e)"        | "Landing page (build, links, tokens, size)" (name unchanged)   |
| Canonical URLs  | `https://shamwari.ai/lite/`                 | `https://www.shamwari.ai/...`                                  |
| Service worker  | scope `/lite/`                              | none                                                           |

The API is a third hostname, `https://api.shamwari.ai` (the `shamwari-gateway` Worker).

**Neither build can carry the other's pages.** `site/check.mjs` fails the marketing build
if it contains any `/lite/` or `/chat/` file, and fails the app build if it contains any page
that is not `/lite/`, if the root does not 302 to `/chat/` (the main Shamwari Chat, another
build), or if a redirect goes anywhere except `/chat/`, `/lite/` or the marketing origin. Canonical and social URLs must be on each Worker's own
origin. The app Worker redirects the three old apex marketing links (`/blueprint/`,
`/project/`, `/contact/`) to `www`; a redirect is not serving a page.

**"Open chat" on the marketing site** points at `https://shamwari.ai/chat/`, the MAIN
Shamwari Chat (a separate build), not the light chat this Worker serves at `/lite/`. It is
**not shown until that chat is released** (build variable `PUBLIC_CHAT_LIVE=true` on the
marketing build). Until then it shows "Get in touch", because a link that answers 404 would
say the chat is ready when it is not. Do not set the variable before `/chat/` answers.

## What the code now assumes about hostnames

- **CSP** on the app (`site/scripts/post-build.mjs`): `script-src 'self'` (the app origin
  itself), `connect-src 'self' https://api.shamwari.ai`. The API origin is read from the
  built page, so the policy and the app cannot disagree, and `check.mjs` verifies it.
- **CORS** on the gateway (`CORS_ORIGINS`) allows only `https://shamwari.ai`, the app
  origin, so the chat works the day the gateway with this change is deployed. `www` is not
  listed: the marketing site makes no API calls. Until that deploy, the deployed gateway
  still lists both origins, which is harmless.
- **Service worker** scope `/lite/` on the app origin; it passes `/lite/auth/*` and
  `/lite/callback` straight to the network.
- **WorkOS redirect URI**: `https://shamwari.ai/lite/callback` (moved from `/chat/callback` on
  2026-11-01 when the PWA became the light chat at `/lite/`; the callback is on the app origin, as
  the Console's own pattern requires). The WorkOS application must also allow the sign-in start
  `https://shamwari.ai/lite/auth/login` and the logout return `https://shamwari.ai/lite/`.
- **The shared brand overlay** `site/src/styles/brand-shamwari.css` is imported by both.

## Switching it on: the order matters

Everything below is done in the Cloudflare dashboard, on a phone is fine. Do the steps in
this order; each one is safe to stop after.

**Two gates before step 5 (moving the apex).** Both come from the code review of this change:

- **`https://shamwari.ai/chat/` must already answer.** After the move the apex root redirects
  there, and today nothing serves it. Until the main chat is deployed, moving the apex would
  turn the root URL of the company into a 404. If the main chat is not ready, either wait, or
  change the one line in `site/app-public/_redirects` (and the matching check in
  `site/check.mjs`) so the root goes to `/lite/` for now.
- **Do step 6's config change in the same sitting.** Until `site/wrangler.jsonc` stops
  declaring the apex, the next routine deploy of `shamwari-site` can try to take it back from
  `shamwari-app`, and whether Wrangler does that is **not verified**. Merge step 6's change
  straight after the move, and pause `shamwari-site`'s automatic deploys in between if you
  can.

1. **Merge the code.** The stack and this change reach `main` only when the owner says.
   Nothing changes for visitors yet: `shamwari-site` keeps serving both hostnames until
   step 5. **Also add the new check name `Chat app (build, check, unit, e2e)` to the
   repository's required status checks.** The old name, `Landing page (build, links,
tokens, size)`, now covers the marketing site only; without the new one, a change that
   breaks the chat can merge on a green marketing check.
2. **Create the app Worker from GitHub.** Workers & Pages, Create, Import a repository,
   choose `shamwari-ai/shamwari`. Name it `shamwari-app`. Root directory `site`. Build
   command `npm ci && npm run build:app`. Deploy command
   `npx wrangler deploy --config wrangler.app.jsonc`. Production branch `main`.
   (It is the same repository as `shamwari-site`; it is a second Workers Builds project.)
3. **Check it on its own address.** Open `https://shamwari-app.nyuchi.workers.dev/lite/`.
   The chat should load, and `https://shamwari-app.nyuchi.workers.dev/` should redirect to
   it. It cannot answer a question yet: it calls `https://api.shamwari.ai`, which does
   not exist until step 4. Do not go on if the page does not load.
4. **Give the gateway its hostname.** Workers & Pages, `shamwari-gateway`, Settings,
   Domains & Routes, Add, Custom domain, `api.shamwari.ai`. Check
   `https://api.shamwari.ai/health` shows `ok`. (The gateway already allows the app
   origin; see the CORS note above.)
5. **Move the apex, in two quick taps.** The apex is attached to `shamwari-site` today and
   a hostname can belong to only one Worker, so it has to be released first. Have both
   screens open. In `shamwari-site`, Settings, Domains & Routes, remove `shamwari.ai`
   (leave `www.shamwari.ai`). Straight away, in `shamwari-app`, Settings, Domains & Routes,
   Add, Custom domain, `shamwari.ai`. If the dashboard offers to move the domain from
   `shamwari-site`, accept that instead: it avoids the gap. The apex is without a Worker
   for the few seconds between the two taps; that is the one unavoidable moment, and it
   is why this step is last before the check.
6. **Verify.** `https://shamwari.ai/` goes to `/chat/` (where the main chat will live; until it is deployed that is a 404, which is expected). `https://www.shamwari.ai/` shows the
   marketing site. `https://shamwari.ai/lite/` shows the light chat. `https://shamwari.ai/blueprint/` redirects to `www`. `https://www.shamwari.ai/chat/`
   is a 404.
   **Then make the files match the dashboard, in ONE small change:** add
   `{ "pattern": "shamwari.ai", "custom_domain": true }` to `routes` in
   `site/wrangler.app.jsonc` and delete that same line from `site/wrangler.jsonc`.
   It is deliberately not done in advance: dropping the apex from `shamwari-site`'s file
   before the move could let a deploy release it with nothing else holding it, and
   declaring it on `shamwari-app` before the move would make a deploy fight for it.
   Whether `wrangler deploy` removes a custom domain that is missing from the file is
   **not verified**, which is the reason to keep the two in step. Watch the first deploy
   of each Worker after this change and confirm the hostnames are still attached.
7. **When the main chat answers at `/chat/`:** set `CHAT_LIVE` to `"true"` in `site/wrangler.app.jsonc`
   and deploy `shamwari-app`. Until then the root `https://shamwari.ai/` sends everyone to `/lite/`
   (`site/worker/root.ts`): by connection quality it would otherwise send fast visitors to `/chat/`.
   Nothing in this build can check that `/chat/` is served by another build, so confirm
   `https://shamwari.ai/chat/` answers 200 first; flipping the switch early turns the root into a 404
   for fast connections.
8. **Later, not now:** register the WorkOS redirect URI `https://shamwari.ai/lite/callback`;
   set `PUBLIC_CHAT_AUTH=mukoko` on the app build only when the session Worker exists; set
   `PUBLIC_CHAT_LIVE=true` on the marketing build when the app is released.

**If something is wrong after step 5:** in `shamwari-app` remove `shamwari.ai`, then in
`shamwari-site` add `shamwari.ai` back. The marketing site serves both hostnames again,
as it does today.

## Before sign-in can work (owner steps; all in the dashboard)

The session Worker (`site/worker/`, see `docs/chat-signin.md`) ships inside `shamwari-app`. It is
inert until these are done, and the page keeps using developer-key mode (`PUBLIC_CHAT_AUTH` is off):

1. In Cloudflare, open **Secrets Store** and create two secrets: the WorkOS **API key** for the
   Shamwari Chat environment, and a **cookie password** (32 or more random characters).
2. Tell the next session the store id and the two secret names. They go into
   `secrets_store_secrets` in `site/wrangler.app.jsonc` (the commented block). Nothing else is
   needed from you: no value is ever put in git.
3. The first deploy of `shamwari-app` also creates the `SessionRefresh` Durable Object (a migration
   in the same file). It shows up under Workers & Pages > shamwari-app > Bindings.
4. Sign-in cannot be tried on the `workers.dev` address: WorkOS accepts only
   `https://shamwari.ai/lite/callback`. Test it after the apex is attached to `shamwari-app`.

## Things this has not verified

- **What `wrangler deploy` does to a custom domain that is not in the file.** See step 6.
  Until the move, both files are left as they are for exactly this reason.
- Whether Cloudflare offers a gap-free move of a custom domain between Workers. The steps
  assume it does not, and say so.
- That `api.shamwari.ai` can be added: the owner reported there is no DNS or custom domain
  for it yet, and it needs the `shamwari.ai` zone to be on Cloudflare, which the existing
  custom domains suggest it is.
- The two Workers Builds projects both read this repository. A change that touches only the
  app triggers a build of both; each only deploys its own output.
