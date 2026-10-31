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
- **CORS** on the gateway allows exactly `https://shamwari.ai` (the app origin). `www` is
  not allowed: the marketing site never calls the API. This needs the gateway change in
  the follow-up PR, then a gateway deploy.
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
   step 6.
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
   Domains & Routes, Add, Custom domain, `api.shamwari.ai`. Then deploy the gateway with
   the CORS follow-up so `CORS_ORIGINS` is `https://shamwari.ai`. Check
   `https://api.shamwari.ai/health` shows `ok`.
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
   is a 404. Then add the `routes` line the comment in `site/wrangler.app.jsonc` describes,
   in a small change, so a later deploy keeps the domain.
7. **Later, not now:** register the WorkOS redirect URI `https://shamwari.ai/chat/callback`;
   set `PUBLIC_CHAT_AUTH=mukoko` on the app build only when the session Worker exists; set
   `PUBLIC_CHAT_LIVE=true` on the marketing build when the app is released.

**If something is wrong after step 5:** in `shamwari-app` remove `shamwari.ai`, then in
`shamwari-site` add `shamwari.ai` back. The marketing site serves both hostnames again,
as it does today.

## Things this has not verified

- Whether Cloudflare offers a gap-free move of a custom domain between Workers. The steps
  assume it does not, and say so.
- That `api.shamwari.ai` can be added: the owner reported there is no DNS or custom domain
  for it yet, and it needs the `shamwari.ai` zone to be on Cloudflare, which the existing
  custom domains suggest it is.
- The two Workers Builds projects both read this repository. A change that touches only the
  app triggers a build of both; each only deploys its own output.
