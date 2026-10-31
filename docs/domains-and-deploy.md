# Two Workers, two hostnames: the app and the marketing site

Owner decision, 2026-10-31. Tracking: #83. This is the map of what lives where and the
exact order to switch it on. **Nothing here has been done in Cloudflare.** The code is
built so that each step below is a click in the dashboard, in this order, and the root
is never dead.

## What lives where

|                 | Shamwari Chat (the app)                     | Marketing site                                                 |
| --------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Worker          | `shamwari-app`                              | `shamwari-site` (the existing one)                             |
| Hostname        | `https://shamwari.ai` (the apex)            | `https://www.shamwari.ai`                                      |
| Pages           | `/chat/` only. `/` answers 302 to `/chat/`. | Home, Blueprint, Project, Contact, `sitemap.xml`, `robots.txt` |
| Source          | `site/app-src/`, `site/app-public/`         | `site/src/`, `site/public/`                                    |
| Astro config    | `site/astro.app.config.mjs`                 | `site/astro.config.mjs`                                        |
| Wrangler config | `site/wrangler.app.jsonc`                   | `site/wrangler.jsonc`                                          |
| Build           | `npm run build:app` into `site/dist-app/`   | `npm run build` into `site/dist/`                              |
| CI job          | "Chat app (build, check, unit, e2e)"        | "Landing page (build, links, tokens, size)" (name unchanged)   |
| Canonical URLs  | `https://shamwari.ai/chat/`                 | `https://www.shamwari.ai/...`                                  |
| Service worker  | scope `/chat/`                              | none                                                           |

The API is a third hostname, `https://api.shamwari.ai` (the `shamwari-gateway` Worker).

**Neither build can carry the other's pages.** `site/check.mjs` fails the marketing build
if it contains any `/chat/` file, and fails the app build if it contains any page that is
not `/chat/`, if the root does not 302 to `/chat/`, or if a redirect goes anywhere except
the chat or the marketing origin. Canonical and social URLs must be on each Worker's own
origin. The app Worker redirects the three old apex marketing links (`/blueprint/`,
`/project/`, `/contact/`) to `www`; a redirect is not serving a page.

**"Open chat" on the marketing site** points at `https://shamwari.ai/chat/` and is
**not shown until the app is released** (build variable `PUBLIC_CHAT_LIVE=true` on the
marketing build). Until then it shows "Get in touch", because a link to an app that
answers 404 would say it is ready when it is not.

## What the code now assumes about hostnames

- **CSP** on the app (`site/scripts/post-build.mjs`): `script-src 'self'` (the app origin
  itself), `connect-src 'self' https://api.shamwari.ai`. The API origin is read from the
  built page, so the policy and the app cannot disagree, and `check.mjs` verifies it.
- **CORS** on the gateway (`CORS_ORIGINS`) already allows `https://shamwari.ai`, the app
  origin, so the chat works the day it is deployed. It also still allows `www`, which the
  marketing site never needs (it makes no API calls); a small follow-up PR tightens it to
  the app origin only. That tightening is hygiene, not a dependency of the move.
- **Service worker** scope `/chat/` on the app origin; it passes `/chat/auth/*` and
  `/chat/callback` straight to the network.
- **WorkOS redirect URI**: `https://shamwari.ai/chat/callback` (unchanged; the callback
  is on the app origin, as the Console's own pattern requires).
- **The shared brand overlay** `site/src/styles/brand-shamwari.css` is imported by both.

## Switching it on: the order matters

Everything below is done in the Cloudflare dashboard, on a phone is fine. Do the steps in
this order; each one is safe to stop after.

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
3. **Check it on its own address.** Open `https://shamwari-app.nyuchi.workers.dev/chat/`.
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
6. **Verify.** `https://shamwari.ai/` goes to `/chat/`. `https://www.shamwari.ai/` shows the
   marketing site. `https://shamwari.ai/blueprint/` redirects to `www`. `https://www.shamwari.ai/chat/`
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
7. **Later, not now:** register the WorkOS redirect URI `https://shamwari.ai/chat/callback`;
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
   `https://shamwari.ai/chat/callback`. Test it after the apex is attached to `shamwari-app`.

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
