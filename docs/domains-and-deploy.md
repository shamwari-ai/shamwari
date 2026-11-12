# Two Workers, two hostnames: the app and the marketing site

Owner decision, 2026-10-31. Tracking: #83. This is the map of what lives where and the
exact order to switch it on.

**Status, 2026-11-11:** `shamwari-app` is deployed (created with Wrangler from `staging`, not yet
connected to GitHub as a Workers Build, so it is redeployed by hand with
`npx wrangler deploy --config app/wrangler.jsonc` from `site/`). The apex `shamwari.ai` was moved to it
with the Workers custom-domains API (`override_existing_origin`), `www.shamwari.ai` stays on
`shamwari-site`, and `api.shamwari.ai` is the gateway. The root `/` sends visitors to `/lite/` for now
(`CHAT_LIVE` is `false`). The sign-in secrets are not bound yet, so sign-in answers 503 (the chat
is built in Mukoko sign-in mode, the default, so it shows the sign-in screen). To undo the apex move, point `shamwari.ai` back at `shamwari-site` with the
same API call, restore the apex line in `site/wrangler.jsonc` and **remove it from
`site/app/wrangler.jsonc`** (otherwise the next hand deploy of `shamwari-app` takes the apex back).

## What lives where

|                 | Shamwari Chat (the app)                     | Marketing site                                                 |
| --------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Worker          | `shamwari-app`                              | `shamwari-site` (the existing one)                             |
| Hostname        | `https://shamwari.ai` (the apex)            | `https://www.shamwari.ai`                                      |
| Pages           | `/lite/` only. `/` answers 302 to `/chat/`. | Home, Blueprint, Project, Contact, `sitemap.xml`, `robots.txt` |
| Source          | `site/app-src/`, `site/app-public/`         | `site/src/`, `site/public/`                                    |
| Astro config    | `site/astro.app.config.mjs`                 | `site/astro.config.mjs`                                        |
| Wrangler config | `site/app/wrangler.jsonc`                   | `site/wrangler.jsonc`                                          |
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
- **Service worker** scope `/lite/` on the app origin; it passes `/auth/*` and `/callback` (and the old
  `/lite/auth/*`, `/lite/callback`) straight to the network.
- **WorkOS redirect URI**: `https://shamwari.ai/callback` (the sign-in is at the root of the origin since 2026-11-12, so
  the light and the main chat share one session; it was `/lite/callback` from 2026-11-01 and `/chat/callback` before
  that). The WorkOS application must also allow the sign-in start `https://shamwari.ai/auth/login` and the logout
  return `https://shamwari.ai/`. The old `https://shamwari.ai/lite/callback` and `/lite/` stay registered while the
  old addresses redirect (one release); remove them after.
- **The shared brand overlay** `site/src/styles/brand-shamwari.css` is imported by both.

## Switching it on: the order matters

_Done on 2026-11-11, in a different way from the steps below:_ the app Worker was created with Wrangler
rather than from GitHub (step 2), and the apex was moved with the Workers custom-domains API rather than
two dashboard taps (step 5). The step 6 file change is in the repo. Steps 1, 3, 4 and 6 stand as written;
what is still open is the sign-in section below, connecting `shamwari-app` to GitHub so it deploys itself,
and step 7 (`CHAT_LIVE`).

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
   choose `shamwari-ai/shamwari`. Name it `shamwari-app`. **Root directory `site/app`**: Workers Builds
   reads the default `wrangler.jsonc` in the root directory and checks its `name` against the Worker's
   name, so the app's config is `site/app/wrangler.jsonc` (name `shamwari-app`) and `site/wrangler.jsonc`
   stays the marketing site's. Build command
   `cd .. && npm ci && npm run build:app` (no flag: Mukoko sign-in is the default, and `check.mjs app` fails a build
   that comes out in the developer-key mode, which is only built by `PUBLIC_CHAT_AUTH=developer-key` for local work;
   an earlier version made `mukoko` an opt-in flag, and a build without it shipped "Mukoko sign-in is coming soon"
   to everyone). Do not set `PUBLIC_CHAT_AUTH` on the Workers Build. Deploy command `npx wrangler deploy`.
   Non-production branch deploy command `npx wrangler preview` (needs the `previews` block already in the
   file). Production branch `main`.
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
   `site/app/wrangler.jsonc` and delete that same line from `site/wrangler.jsonc`.
   It is deliberately not done in advance: dropping the apex from `shamwari-site`'s file
   before the move could let a deploy release it with nothing else holding it, and
   declaring it on `shamwari-app` before the move would make a deploy fight for it.
   Whether `wrangler deploy` removes a custom domain that is missing from the file is
   **not verified**, which is the reason to keep the two in step. Watch the first deploy
   of each Worker after this change and confirm the hostnames are still attached.
7. **When the main chat answers at `/chat/`:** set `CHAT_LIVE` to `"true"` in `site/app/wrangler.jsonc`
   and deploy `shamwari-app`. Until then the root `https://shamwari.ai/` sends everyone to `/lite/`
   (`site/worker/root.ts`): by connection quality it would otherwise send fast visitors to `/chat/`.
   Nothing in this build can check that `/chat/` is served by another build, so confirm
   `https://shamwari.ai/chat/` answers 200 first; flipping the switch early turns the root into a 404
   for fast connections.
8. **Later, not now:** register the WorkOS redirect URI `https://shamwari.ai/callback`;
   (Mukoko sign-in is on by default now and needs no build setting); set
   `PUBLIC_CHAT_LIVE=true` on the marketing build when the app is released.

**If something is wrong after step 5:** in `shamwari-app` remove `shamwari.ai`, then in
`shamwari-site` add `shamwari.ai` back. The marketing site serves both hostnames again,
as it does today.

## Before sign-in can work, and what the gate does

The session Worker (`site/worker/`, see `docs/chat-signin.md`) ships inside `shamwari-app`, and it is also
the **gate** in front of the light chat: it runs first for `/lite/*` (the build output is under `/lite/_astro/`, inside the session cookie's Path)
(`assets.run_worker_first`), and serves the page and its scripts only to someone with a session. An
unauthenticated request for `/lite/` is sent straight to the AuthKit hosted sign-in. The only things served
without a session are the privacy page (`/lite/disclaimer/`), the manifest, the three install icons, the
service worker and the stylesheets (the list is in `site/worker/gate.ts` and is asserted exactly by
`site/test/worker/gate.test.ts`), plus the two root icons (`/favicon.png`, `/apple-touch-icon.png`), which the
Worker does not see.

1. **The two secrets are bound by name, with no values in git.** `site/app/wrangler.jsonc` binds
   `WORKOS_API_KEY` to the Secrets Store secret `CONSOLE_WORKOS_API_KEY` and `COOKIE_PASSWORD` to
   `SESSION_SECRET` (store `56f84bfa8a564c54a95dbf4f4b4281b4`). Both are the shared Mukoko secrets.
   Nothing is created by hand for them.
2. The gate **fails closed**. If either secret does not resolve, a request for the page is a `503` with a
   `Retry-After`, never the page; the public pages above still answer.
3. The first deploy of `shamwari-app` also creates the `SessionRefresh` Durable Object (a migration
   in the same file). It shows up under Workers & Pages > shamwari-app > Bindings.
4. Sign-in cannot be tried on the `workers.dev` address: WorkOS accepts only
   `https://shamwari.ai/callback`. Test it after the apex is attached to `shamwari-app`.

### Verify after deploy

The deploy is a separate, manual step. Nothing in the repository can show that the deployed Worker has the
latest config (when this was written, `shamwari-app` as deployed listed no secret bindings, only its plain
variables and the Durable Object), so check these against `https://shamwari.ai` after deploying:

- [ ] **First, redeploy `shamwari-app` from this change, then look at the dashboard.** Workers & Pages > `shamwari-app` >
      Settings > **Bindings** must list `WORKOS_API_KEY` and `COOKIE_PASSWORD` (Secrets Store), `SESSION_REFRESH` (Durable
      Object) and `ASSETS` (Assets). A Worker that lists none of the secrets was deployed before they were added to
      `site/app/wrangler.jsonc`: it will answer `503` to every page until it is redeployed with them. Then the Secrets Store
      must hold `CONSOLE_WORKOS_API_KEY` and `SESSION_SECRET` (it did when this was written; names only, never values).
- [ ] `GET /lite/` and `GET /` with no cookie answer `302` to `/auth/login`, not `503`, and not the page.
- [ ] `GET /lite/_astro/<any script>.js` with no cookie answers `401`.
- [ ] `GET /lite/disclaimer/`, `/lite/manifest.webmanifest` and `/lite/sw.js` answer `200` with no cookie.
- [ ] Signing in from `/auth/login` lands on `/` (then the app) and the chat loads; `/auth/token` answers `200`; the session cookie is `Path=/`.
- [ ] The old addresses redirect: `/lite/auth/login` is a `302` to `/auth/login`, `/lite/callback` a `302` to `/callback`, `POST /lite/auth/logout` a `307` to `/auth/logout`.
- [ ] `https://shamwari.ai/callback` completes (it is the registered redirect URI).
- [ ] With the cookie cleared, `/lite/` is a `302` to sign-in again.
- [ ] Bindings for `WORKOS_API_KEY`, `COOKIE_PASSWORD`, `SESSION_REFRESH` and `ASSETS` are listed on the Worker.

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

## WorkOS sign-in on the app Worker (2026-11-11)

`site/app/wrangler.jsonc` binds `WORKOS_API_KEY` (from `CONSOLE_WORKOS_API_KEY`) and `COOKIE_PASSWORD` (from
`SESSION_SECRET`) out of the account's Secrets Store, the shared Mukoko secrets. Deploy with
`npm run deploy:app` from `site/`, which builds (Mukoko sign-in is the default; nothing to set) and then runs `wrangler deploy`.
After a deploy, `GET /auth/login` should answer 302 to the Mukoko Account sign-in page; a real sign-in
needs a person and a registered redirect URI (`https://shamwari.ai/callback`).

## Automatic release to production (shamwari-ai/shamwari#201)

Every merge to `staging` is released to `main` and production without a manual step. Only a major
version is gated; it is never automatic.

1. A PR merges to `staging` through the queue.
2. **Verify:** `release-to-main.yml` runs when CI finishes on the staging head. A red head
   releases nothing, and a head that has since been replaced is left to the newer run.
3. **Release PR:** it keeps one branch, `release/staging-to-main`, whose tree equals staging's
   (branch from `main`, `git read-tree -u --reset origin/staging`, commit), opens or updates the
   PR `chore: release staging to main, DATE+n`, labels it `forward-ported`, and turns on
   auto-merge. It moves `main` only: the gateway and Core are not deployed by this.
4. **Deploy:** when `main` updates, Workers Builds deploys `shamwari-site` (connected) and
   `shamwari-app` (once the owner connects it in the Cloudflare dashboard).
5. **Smoke:** `smoke-production.yml` checks production for up to 18 minutes: `/lite/`
   unauthenticated is a 302 to `/auth/login`; `/lite/disclaimer/`,
   `/lite/manifest.webmanifest` and `/lite/sw.js` are 200; a `/lite/_astro/*.js` script named in
   `sw.js` is 401 without a session; `www.shamwari.ai` is 200. On failure it opens an issue.

**Rollback:** Cloudflare dashboard, Workers & Pages, the Worker, Deployments, roll back to the
previous version (a deploy keeps the previous version ids), then fix forward on `staging`.

**Needs the owner:** a GitHub App (or token) the release workflow can use, stored as the
repository secrets `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY`, installed on this repository
with Contents, Pull requests and Issues write. The built-in `GITHUB_TOKEN` is not enough: a PR it
opens does not start the pull-request workflows, so the required checks would never run.
Both workflows must also be on `main` before they run (`workflow_run` uses the default branch's
copy), so the first release is cut by hand.
