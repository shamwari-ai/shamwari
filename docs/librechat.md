# Shamwari Chat on LibreChat: design and runbook

Tracking: #146. Replaces the hand-built chat page described in
`docs/chat-app.md` (#83) as the main chat surface. Tiers and budgets:
`docs/tiered-access-design.md`.

Status: **design**. Nothing in this document has been built, deployed or
switched on. No Fly app, database, tunnel, DNS record, Worker route or secret
exists for it.

## What this is, in one paragraph

LibreChat is an open-source (MIT) chat application with history, search, a left
sidebar and a dark theme. We run one copy of a pinned release at
`https://shamwari.ai/chat`. It is configured with exactly one model backend, our
gateway at `https://api.shamwari.ai/v1`. It has its own MongoDB. The old R2 page
stays alive as `/chat/lite` for weak networks and old phones.

## How each claim below was established

The brief asked for answers from reading and testing, not from memory. This
session could read the source of the pinned release and the vendors' current
pages. It could **not run LibreChat**: there is no Docker daemon in the session,
and building third-party code locally was refused by the session's safety check.
So every answer carries one of these labels:

- **Read** — established by reading the pinned source at the commit below, with
  the file named.
- **Docs** — taken from a vendor page read on 1 Nov 2026.
- **To test** — a claim that must be proved by the CI job in the build step
  before anyone relies on it. Each has a named test in
  [What the build must prove](#what-the-build-must-prove).

Nothing labelled _To test_ is a finding yet.

## Relayed direction, awaiting owner confirmation in this session

Everything in this section is marked **owner decision recorded 1 Nov 2026
(relayed by orchestrator), awaiting owner confirmation in this session.** It
reached this work as messages from another Claude session quoting the owner. It
did not come from the owner in the session that wrote this page, and several
items reverse the original brief. So each is written as a design with options
and consequences, and **none is built, decided or assumed** until the owner
confirms it here in one pass. Where this section conflicts with the rest of the
page, this section is the proposal and the rest is the confirmed brief.

**Path change relayed:** the light chat moves to `shamwari.ai/lite/*` (not
`/chat/lite`). LibreChat owns `/chat/*`. Every `/chat/lite` in this page reads
`/lite` if confirmed. The service-worker trap is unchanged: the old worker is
scoped to `/chat/` and must retire itself before the route moves.

### 1. Fork instead of thin patch set

Relayed: "librechat out the box is the base we build it to make it ours."

| Option                                       | What it means                                                             | Consequence                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A. Config plus thin patches (original brief) | Stock image, patches in `PATCHES.md`                                      | Cheapest upgrades; cannot add a scope selector, structured citations or Servers API without patches |
| B. Fork at the pinned tag (relayed)          | Repo under `shamwari-ai`, `upstream` remote, our work as separate commits | We own the code and can change anything; every upstream security release becomes our merge job      |

If B, the policy: base is the exact tag `v0.8.8` (commit `e8f3be08`) and the build pins the fork commit above it (see the pin table); `upstream`
points at `danny-avila/LibreChat`; our changes land as clearly separated
commits by area (theme, scope selector, citations, Servers API, voice and
i18n) so a merge conflict names its owner; upstream release tags are merged
within a stated window (security releases first); the MIT licence text and
copyright notice stay in place and in `NOTICE`; the CI guard (gateway-only
endpoint, no provider keys, registration off) runs against the fork unchanged.
**Owner step:** the fork needs a repo under `shamwari-ai`, which this session
does not create. One step for the owner:
`gh repo fork danny-avila/LibreChat --org shamwari-ai --fork-name librechat --clone=false`.
The honest cost of B is recurring merge work; the ceiling on it is how much we
change.

#### Decision table: fork or stock

Each change we need, and the lightest mechanism that can do it. **Config** means
`librechat.yaml` or environment only. **Overlay** means a file added in the
Dockerfile (no LibreChat source edited). **Patch** means a small edit to
LibreChat source. **Fork-only** means a feature that needs real code.

| #   | Change                                                               | Mechanism                                                                                                            | Why                                                                               |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | One endpoint, gateway only; provider keys absent; other features off | Config                                                                                                               | `endpoints.custom`, `ENDPOINTS=custom`, feature flags (this page, "One endpoint") |
| 2   | Registration and email login off                                     | Config                                                                                                               | `ALLOW_REGISTRATION=false` and friends                                            |
| 3   | Scope sent to the gateway                                            | Config for fixed scope per endpoint (`addParams`); **fork-only** for a per-message pill in the composer              | Config cannot put a per-message choice into the body                              |
| 4   | Title generation off                                                 | Config                                                                                                               | `titleConvo: false`                                                               |
| 5   | Ground citations visible                                             | Config plus a gateway parameter (inline sources list) for launch; **fork-only** for numbered chips and a source card | The gateway change needs no LibreChat edit                                        |
| 6   | Plain 409 message                                                    | Config if LibreChat surfaces the gateway `message` (to test); otherwise Patch                                        | One error-mapper file                                                             |
| 7   | Streaming against a non-streaming gateway                            | Config (`stream: false`, to test) or a gateway shim                                                                  | No LibreChat edit either way                                                      |
| 8   | Theme and density (sodalite, shared tokens)                          | Overlay (one CSS file) for colours; Patch for density tokens that need new variables                                 | LibreChat has no theme key in YAML at this release                                |
| 9   | Welcome text and the link to the light chat                          | Config                                                                                                               | `interface.customWelcome`                                                         |
| 10  | Shona and isiNdebele interface text                                  | Patch (add locale files)                                                                                             | New locale, small and separable                                                   |
| 11  | Servers API integration                                              | **Fork-only**                                                                                                        | New server code                                                                   |
| 12  | Edge caching, routing, rate limits                                   | Neither: it lives in the Worker                                                                                      | Not LibreChat's code                                                              |

Count by the lightest mechanism that can do the whole row: pure config rows 1,
2, 4, 7 and 9 (five); overlay or patch row 8; mixed rows 3, 5 and 6 (config
for launch, patch or fork-only for the full version); patch row 10; fork-only
row 11; outside LibreChat row 12.

| Question                             | Stock plus patch set                                                                             | Fork at the pinned tag                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Repo layout                          | `chat/librechat/` in this repo: Dockerfile, `librechat.yaml`, `theme/`, `patches/`, `PATCHES.md` | A repo under `shamwari-ai` with an `upstream` remote; this repo holds only deploy config and the guard test |
| Upstream security release            | Bump the tag, patches reapply (or fail loudly)                                                   | Merge the tag; conflicts only where we changed code                                                         |
| Cost while we change little          | Lowest                                                                                           | Same: an unchanged fork merges cleanly                                                                      |
| Cost once rows 3, 5 and 11 are built | Patch set grows into a hidden fork                                                               | Honest and reviewable                                                                                       |
| Licence                              | MIT notice kept in the image                                                                     | MIT notice kept in the repo and `NOTICE`                                                                    |
| Guard test                           | Runs against `librechat.yaml` in this repo                                                       | Same test, run in this repo against the fork's config and in the fork's CI                                  |

**Recommendation (for the owner to confirm):** fork at the pinned tag from the
start, but **launch with rows 1, 2, 4, 5 (inline sources), 7 and 9 as config and
row 8 as an overlay**, so the first release is a stock build with a theme. A fork
costs nothing until it diverges, and rows 3 (pill), 5 (chips) and 11 are
already planned, so a later re-platforming from a patch set is avoided. The
rule that keeps merges cheap: no change to LibreChat source lands without a row
in this table and a commit that touches only that row's files. If the owner
prefers not to carry merge work yet, the stock option is the same launch with
one fewer repository, and the fork can start the day row 3 or 11 does.

### 2. Edge optimisation (the tunnel is the origin path, the edge does the rest)

Relayed: "by porting it through a tunnel we can optimize it at edge."

| Item             | Proposal                                                                                                                                                                                                       | Status                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Static build     | Worker serves and caches LibreChat's hashed JS, CSS, fonts and icons with `Cache-Control: public, max-age=31536000, immutable`; Brotli; early hints                                                            | To test, needs a build to know the file set                                                             |
| Dynamic traffic  | API, auth and any streaming go through the tunnel, never cached                                                                                                                                                | Design                                                                                                  |
| Edge limits      | Rate limit and an early session check at the edge so unauthenticated or abusive traffic never wakes the origin                                                                                                 | The gateway's limits and scope gate stay authoritative; **Rule 1 enforcement is not moved to the edge** |
| Origin placement | Put the origin in the nearest Fly region to users; **verify** which regions exist (an African region is not assumed) and measure the tunnel hop's extra latency for streaming                                  | To verify before choosing a region                                                                      |
| Cache safety     | Only public static assets are cacheable. A test fails if any user-specific response (anything under `/api`, `/oauth`, any response with `Set-Cookie` or an `Authorization` request) carries a cacheable header | Test named in the build list                                                                            |

Numbers asked for (first-load size and time-to-first-token on a throttled
mobile profile, before and after) are **unmeasured**; they come from the weight
job, which gains a "before edge caching / after" pair.

### 3. Two surfaces, one look

Relayed: the original build is customised into the edge chat, and both must look
like one product.

- **Full app:** LibreChat (fork or stock), own database, behind the tunnel.
- **Edge chat at `/lite`:** runs entirely on the Worker with no origin and no
  database, light enough for weak networks.
- **One visual language:** shared tokens in one file (Mzizi tokens, sodalite,
  Noto fonts) consumed by both, so they cannot drift. LibreChat layout patterns
  reproduced in the edge chat: collapsible left sidebar of conversations, calm
  empty state, wide rounded composer. **Only in the full app:** server-side
  history, search, cross-device sync (they need storage).
- **Edge chat storage (proposal, owner to confirm):** conversation history on
  the device only. **Nothing is stored for personal scope.** Anything beyond that
  is a question for the owner, not a default.
- Scope control, the 409 notice and citations appear in both.
- Accessibility and weak-network check for the edge chat: keyboard operation,
  contrast, and a size budget that fails the build.

### 4. Edge chat redesign

Relayed: the current page ("a form with a scope dropdown") is a redesign, not a
restyle. Target is the familiar Claude / ChatGPT / LibreChat pattern, with the
phone reference the owner sent (via the same relay): no marketing chrome, slim
top row (sidebar toggle left, one icon right), one centred greeting about 60%
down in display type with the Shamwari mark in sodalite, **no suggestion chips
or cards in the empty state** (this supersedes an earlier relayed line about
chips), a single wide rounded composer with a quiet placeholder and one control
row (plus, mode pill, model label, mic, voice), safe-area padding, a keyboard
that pushes the composer up without jumping. Scope lives in that control row as
a pill, not a dropdown.

Pattern set, kept small: collapsible sidebar (device-local list; slide-over on
phones); auto-growing composer, Enter sends and Shift+Enter breaks the line;
Send and Stop; user message as a subtle bubble and the answer as plain flowing
text; markdown rendered safely with code blocks and a copy button; copy and
retry per message; scroll-to-bottom with anchoring that does not fight the
reader; citations as small numbered chips opening a source card; the personal
409 as a calm inline notice saying what to do next.

Constraints and consequences:

- **Streaming:** the gateway does not stream today. A typing cue is possible
  without streaming; true streaming text needs the gateway shim in "Streaming"
  above and the owner's yes.
- **Library or not:** no heavy framework. If assistant-ui or the AI SDK UI is
  proposed, its cost is measured against the old page's 16.0 KB before adoption.
- **Voice and mic:** shown in the reference, but there is no Shona or Ndebele
  text-to-speech in the Cloudflare catalogue (`CLAUDE.md`, voice findings), and
  any voice input must pass the scope gate first. They are placeholders until
  that is solved, not shipped controls.
- **Done is the owner's call:** Playwright screenshots at a phone and a desktop
  viewport (empty and mid-conversation) go in the PR; the look is not marked
  done by the author.

### 5. Edge routing between the two surfaces

Relayed: screen size or device class must **not** decide; a laptop or iPad is
normally on wifi. Default is the full app. Route to the edge chat only on real
signals, with a manual switch remembered on the device.

| Signal                                                                      | Where it exists                                            | Use                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Save-Data: on` request header                                              | Chromium browsers; not Safari or Firefox (verify at build) | Strong: route to `/lite`                                                |
| Network Information API (`effectiveType`, `saveData`)                       | Chromium only; **not Safari/iPad**                         | Never depended on; hint only                                            |
| `deviceMemory`, `hardwareConcurrency`                                       | Chromium for memory; wider for cores (verify)              | Hint only                                                               |
| `request.cf` edge measurements (for example `clientTcpRtt`, `httpProtocol`) | Worker side, every browser                                 | The cross-browser signal; fields and availability verified in the build |
| Manual "Use light version / Use full version"                               | Any                                                        | Wins over everything; remembered on the device                          |

Thresholds are **proposed, not measured**: send to `/lite` only when Save-Data is
on, or the edge-measured round trip is high enough to suggest a weak link (a
number chosen from real traffic, not from this page). Unknown or missing signals
default to **full**. The redirect or HTML chosen from these signals is sent with
`Cache-Control: private, no-store` and `Vary: Save-Data`, so a shared cache
cannot serve a Save-Data phone's choice to a laptop. The manual choice is a
first-party cookie with `Path=/` (not under LibreChat's rewritten `Path=/chat`),
and a test asserts the two do not collide. The routing function is pure and unit-tested: laptop on
wifi gets full; Save-Data phone gets edge; unknown signals get full; a manual
choice wins.

### 6. Sizes and density (Mzizi proposal, not an edit to Mzizi)

Relayed: phones use Apple-aligned sizes (44 pt minimum touch target); wide
screens with a fine pointer step down to a calm dense layout; targets never fall
below 24 by 24 CSS px on fine pointers (WCAG 2.2 AA) and body text stays near
14 px or larger; contrast, focus rings, zoom and reduced motion unchanged.

- Implemented once as density tokens in the shared token file, driven by
  breakpoint plus `(hover: hover) and (pointer: fine)`, not per component.
- **The Apple numbers are not stated here.** They must be read from Apple's
  published Human Interface Guidelines at build time and cited by page; this
  session has not done that, and the table the relay asked for (token, old
  value, new value, Apple reference) is filled from that reading, not memory.
- The Mzizi package is **not edited**. The change is drafted as an upstream issue
  for the owner (Apple-aligned sizes plus a desktop density mode, with
  before and after measurements at phone, tablet and desktop widths).
- A test fails if a fine-pointer target drops below the floor.

### What confirming this changes

If the owner confirms all six: the Architecture and cutover sections gain the
fork and the `/lite` path; the build splits into at least three PRs (fork and
guard, Worker with edge caching and routing, edge-chat redesign with shared
tokens); the cost table is unchanged except for engineering time. If only some:
the owner names them and the rest stay as the original brief.

## The pin

|         |                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project | LibreChat, `github.com/danny-avila/LibreChat`, MIT                                                                                                         |
| Release | `v0.8.8` (latest non-release-candidate tag on 1 Nov 2026; tagged 30 Sep 2026)                                                                              |
| Base    | `e8f3be08623663d4ad7f7241e693c94469b63bb0`, the upstream commit the release tag names                                                                      |
| Commit  | the Shamwari fork commit built (`chat/librechat/PIN`), which must sit on the base                                                                          |
| Build   | from source at that commit by `chat/librechat/build.sh`; the project's ghcr image for `v0.8.8` was not in its tag list, so there is no image digest to pin |

A floating tag (`latest`, `main`) is a CI failure. An upgrade is a pull request
that changes the tag, re-runs every test below, and re-reads
`UPGRADING.md`. `UPGRADING.md` at `v0.8.8` describes a tenant-index migration for
databases that began on `v0.8.7` or earlier; our database starts on `v0.8.8`, so
it does not apply, but the upgrade checklist keeps it.

### Config plus a thin patch set

The owner expects to fork LibreChat later (for example to add the Servers API).
Until then the rule is: **configuration first, a patch only when configuration
cannot do it, and every patch written down.**

```
chat/librechat/
  Dockerfile          FROM the pinned image; applies patches/ and the theme overlay
  librechat.yaml      the one endpoint (see below)
  fly.toml            the Fly app; no public service
  cloudflared.yml     the tunnel config
  theme/shamwari.css  sodalite overlay (see "Look")
  patches/            one file per patch, each with a header: why, upstream issue, removal condition
  PATCHES.md          index of patches; empty at the start
```

Fork trigger (owner decision, not ours to take): when `PATCHES.md` holds more
than a handful of patches, or when the Servers API work starts. Moving to a fork
then is cheap because the patches are already isolated.

## Architecture

```
person ──► shamwari.ai/chat/*
              │
              ▼
        edge Worker  (route table, see "Sub-path hosting")
          /chat/lite, /chat/lite/*  ──► shamwari-app  (the old R2 page, unchanged)
          /chat, /chat/*  ──► LibreChat proxy path
              │  private connection (Workers VPC service, or Access-gated hostname)
              ▼
        cloudflared  ──► LibreChat on Fly   (no public IP)
              │                   │
              │                   └──► Atlas: its OWN database (separate user)
              ▼
        https://api.shamwari.ai/v1/chat/completions   (the gateway: scope gate first)
              │
              ▼
        Core / Workers AI  (unchanged)
```

LibreChat is a **client of the gateway**, the same way Shamwari Mind is. It is
not a backend behind it, and it never holds an inference-provider credential.

## Sub-path hosting: does it work under `/chat`?

**Partly, and the part that does not is solved by the Worker, not by a patch.**

What the release does (Read, `api/server/index.js:283-292`,
`packages/data-provider/src/api-endpoints.ts:6-22`,
`client/src/routes/index.tsx:204`):

- If `DOMAIN_CLIENT` has a path, the server rewrites `<base href="/">` in
  `index.html` to that path.
- The client reads the `<base>` element and prefixes every API call with it, so
  with `DOMAIN_CLIENT=https://shamwari.ai/chat` the browser asks
  `/chat/api/...` and loads assets from `/chat/...`.
- The router is created with that base as its `basename`.

What it does not do (Read, `api/server/index.js:370-420`): the **server mounts
everything at the root** (`/api/...`, `/oauth/...`, static files at `/`). It
expects whatever sits in front of it to strip the prefix. So:

| Part            | Behaviour under `/chat`                                                                                                                                                                          | Who handles it                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page and assets | work once `DOMAIN_CLIENT` carries the path                                                                                                                                                       | LibreChat                                                                                                                                                       |
| API calls       | browser sends `/chat/api/...`; origin only knows `/api/...`                                                                                                                                      | Worker strips `/chat`                                                                                                                                           |
| OAuth callback  | built as `DOMAIN_SERVER + OPENID_CALLBACK_URL` (`api/strategies/openidStrategy.js:947`), so with `DOMAIN_SERVER=https://shamwari.ai/chat` it is `https://shamwari.ai/chat/oauth/openid/callback` | Worker strips `/chat`; register that exact URL with WorkOS                                                                                                      |
| Cookies         | the refresh-token cookie is set by `res.cookie(...)` (`api/server/services/AuthService.js:721`); this session did not find an explicit `path` option                                             | **To test.** The Worker rewrites `Path=/` to `Path=/chat` on every `Set-Cookie` so LibreChat's cookies are never sent to the marketing pages or to `/chat/lite` |
| Redirects       | `Location` headers from the origin are root-relative                                                                                                                                             | Worker re-prefixes `Location`                                                                                                                                   |

**Chosen fix: a reverse-proxy rewrite in the Worker.** It is the least hacky of
the three options in the brief:

1. _Worker rewrite_ — chosen. No LibreChat patch, so upgrades stay a tag bump.
   The logic is small (strip prefix, rewrite `Location` and `Set-Cookie` path,
   add security headers) and is unit-testable without LibreChat.
2. _Internal-only tunnel hostname that the Worker proxies to_ — this is how the
   Worker reaches the origin (next section), not an alternative to the rewrite.
3. _A LibreChat patch to mount routes under a prefix_ — rejected. It touches the
   server's route table, which is exactly the code every upgrade changes.

### Route table (and an ordering trap)

Cloudflare picks the most specific route. Today the existing app Worker is
planned for `shamwari.ai/chat/` (draft #134). After this change:

| Pattern                                               | Worker                                                                      | Serves      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ----------- |
| `shamwari.ai/chat/lite` and `shamwari.ai/chat/lite/*` | `shamwari-app` (existing, rebased onto `/chat/lite/`; `/lite` if confirmed) | the R2 page |
| `shamwari.ai/chat` and `shamwari.ai/chat/*`           | the new proxy Worker                                                        | LibreChat   |

`#134` and the chat-app Worker need their path moved from `/chat/` to
`/chat/lite/` first. That is a change to open PRs, so it is sequenced in the
cutover list, not done here.

### The old service worker will trap returning users

The R2 page installs a service worker scoped to `/chat/` that serves its cached
shell first (`docs/chat-app.md`, "Installable and offline"). After cutover, any
phone that installed it would keep showing the old shell at `/chat/` and never
reach LibreChat. **Before the route switches**, one release of the old page must
ship a service worker that unregisters itself and clears its caches, and the new
`/chat/lite/` page must register a worker scoped to `/chat/lite/` only. This is
step 5 of the cutover and a test in the build step.

### How the Worker reaches the origin with no public IP

Two options. The build step uses the first and falls back to the second only if
the first cannot target the tunnel's local address.

1. **Workers VPC service binding** (Docs, developers.cloudflare.com/workers-vpc,
   updated 29 Oct 2026; listed as available on Free and Paid plans). The tunnel
   is registered as a VPC service and the Worker calls it through a binding. No
   public hostname exists for the origin at all.
2. **A tunnel public hostname behind Cloudflare Access** with a service token.
   The machine still has no public IP, but a public hostname exists; Access is
   the lock.

**To test:** whether a VPC service can target `localhost:3080` from a
`cloudflared` running in the same Fly machine, as the brief's tunnel guide
(`http://localhost:3080`) assumes. The docs list "host and port in your private
network"; they do not say `localhost` is accepted.

## One endpoint, and it is the gateway

LibreChat's `librechat.yaml` defines **one custom endpoint** (Read, the custom
endpoint shape in `librechat.example.yaml` and `packages/api/src/endpoints/openai/initialize.ts`):

```yaml
version: 1.3.17   # the pinned librechat.example.yaml's own version (Read, line 5)
endpoints:
  custom:
    - name: "Shamwari"
      apiKey: "${SHAMWARI_CHAT_PLACEHOLDER_KEY}"   # non-secret; see guard item 5
      baseURL: "https://api.shamwari.ai/v1"
      models:
        default: ["shamwari-economy"]
        fetch: false
      titleConvo: false
      addParams:
        scope: "platform"
      headers:
        X-Shamwari-Channel: "pwa"
```

(Illustrative; the exact `version`, key names and the per-person key handling
are fixed when the build step reads the pinned example file. Names above are
what this session read in the pinned source.)

### What stops it becoming a provider client

Rule 1 is a property of what LibreChat can reach, so the controls are
**subtractive**. A configuration that merely does not mention a provider is a
comment, not a control.

- `ENDPOINTS=custom` in the environment, so the built-in OpenAI, Anthropic,
  Google, Assistants and Azure endpoints are not offered at all (`.env.example:403`).
- No provider key variable in the app's environment, `fly.toml` or secrets:
  `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_KEY`, `GROQ_API_KEY`,
  `MISTRAL_API_KEY`, `OPENROUTER_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY` and any
  `*_API_KEY` that is not on an allowlist (which is empty at the start).
- Every other feature that calls a model is switched off in `librechat.yaml` and
  the environment, because each is a second route out that bypasses the
  endpoint list: agents and tools, web search, code execution, artifacts, image
  generation, speech-to-text and text-to-speech, file-search/RAG (its default
  embeddings go to OpenAI), MCP servers, memory, prompt suggestions,
  summarization and any agent or helper that makes its own model call (the
  full list is read from the pinned `librechat.example.yaml` in the build step), and conversation **title generation**
  (a second model call per chat, which also spends the person's token quota; the
  sidebar title falls back to the first words of the first message).
- Meilisearch and the RAG API sidecar are **not deployed**.

### The guard that fails the build

`chat/librechat/test/guard.test.ts` (run in CI) parses `librechat.yaml`,
`fly.toml`, the Dockerfile and any `.env*` template and **fails** if:

1. any `endpoints.custom[].baseURL` is not exactly the gateway's `/v1` URL;
2. any key other than `endpoints.custom` is present under `endpoints`;
3. `ENDPOINTS` is not exactly `custom`;
4. a provider key variable (list above) appears anywhere in those files;
5. an `apiKey` is `user_provided` (that mode shows every person a key dialog
   that nothing can satisfy, because no customer key is accepted today) or a
   real-looking secret; it must be an environment reference or a fixed
   non-secret placeholder that the `Authorization` header from the person's
   sign-in overrides (to test);
6. the build source is not pinned: `PIN` lacks a 40-hex `base` and `commit`, the commit equals the base, or `build.sh` does not check the commit, its ancestry on the base and the tag against the base;
7. any `mcpServers`, `webSearch`, `ocr`, `speech` or `fileConfig` block routes to
   a host other than the gateway;
8. `ALLOW_REGISTRATION`, `ALLOW_EMAIL_LOGIN` or `ALLOW_SOCIAL_LOGIN` is anything
   but `false` while sign-in is blocked;
9. any top-level `librechat.yaml` key is not on an explicit allowlist, so a
   feature that calls a model and is not named here fails the build instead of
   passing silently;
10. production `addParams.scope` is anything outside an explicit allowlist
    (`platform`, plus `community` only once confirmed). `personal` appears only
    in the test configuration.

The test also runs a mutation check: it feeds itself a copy of the config with a
provider `baseURL` and asserts it fails, so the guard cannot rot into a test
that always passes (the same discipline as `docs/degradation-probe.md`).

## How the scope reaches the gateway

The gateway reads `scope` from the JSON body: `parseScope(body.scope)` in
`gateway/src/scope.ts:17`, called from `admit()` in `gateway/src/index.ts:154`.
Anything other than `personal` or `community` becomes `platform`. The old page
sends `scope` in the body (`site/src/chat/client.ts`, `app.ts:257`).

**Mechanism:** the custom endpoint's `addParams` adds `scope` to the request
body (documented behaviour of custom endpoints; **To test** that the pinned
release forwards an unknown key unchanged). One endpoint per scope, each with
its own fixed value:

| Endpoint name shown  | `addParams.scope` | Enabled in production             |
| -------------------- | ----------------- | --------------------------------- |
| Shamwari             | `platform`        | yes                               |
| Shamwari (community) | `community`       | only once the owner confirms it   |
| Shamwari (personal)  | `personal`        | **no** until Shamwari Mind exists |

Why not one endpoint with a selector: LibreChat has no per-message field the
person can set that reaches the body of a custom endpoint, and a model spec's
preset changes model and parameters but not an endpoint's `addParams`. Three
endpoints is the mechanism that needs no patch. If the owner later wants a
single picker, that is a candidate for the thin patch set.

The `personal` endpoint exists in a **test configuration only**
(`librechat.test.yaml`, used by the stub-gateway test). It is not in the
production file, because an option that can only fail teaches people the product
is broken. When Mind lands, personal scope is served on the device, not through
this page (`CLAUDE.md`, rule 1: Mind is a client of the gateway).

### The 409, and what the person should see

A `personal` request to `/v1/chat/completions` returns
`409 {"error":"scope_requires_local_inference","scope":"personal","message":"...","capability":"cloud_inference"}`
(Read, `scope.ts:80-95`). LibreChat is **not** the enforcement point; the
gateway is, and Core re-checks. LibreChat only has to show the refusal well.

**To test:** what LibreChat 0.8.8 shows for a 409 from a custom endpoint. The
expectation to disprove is that it prints a generic "An error occurred" or dumps
the JSON. The test asserts the person sees the sentence "Personal-layer data
cannot be sent to an external inference provider". If it does not, the smallest
fix, in order of preference:

1. **Gateway-side, no LibreChat change:** when the request carries
   `X-Shamwari-Channel: pwa`, add a short `message` that already reads as a
   sentence a person can act on. The `message` field exists today; the work is
   checking LibreChat surfaces it. Rule 1 is untouched because the status stays
   409 and no inference happens.
2. A one-file patch to the client's error mapper, recorded in `PATCHES.md`.

### Streaming (the first thing the stub test must prove)

LibreChat sets `streaming: true` for custom endpoints (Read,
`packages/api/src/endpoints/openai/initialize.ts:101`). The gateway does not
stream: "Streaming responses" is listed under "Deliberately not in this phase"
in `CLAUDE.md`, and `gateway/src/index.ts` returns one JSON body. A client
that asks for a stream and receives JSON typically fails. **To test:** that
`addParams: { stream: false }` makes the endpoint work. If not, the smallest fix
is a gateway shim that, when `stream: true`, returns the finished answer as one
server-sent chunk plus `[DONE]`. That is a change to the gateway's contract and
needs the owner's yes before it is written.

### Rule 2 and the training corpus

LibreChat sends `X-Shamwari-Channel: pwa`. In the gateway that header means
"the web chat": it keeps no conversation document on the platform side and the
exchange is never trainable (`gateway/src/index.ts:31, 503-509, 552`; owner
decision 2026-10-31). That is correct here for a second reason: the content now
lives in LibreChat's own database, and the gateway must not keep a second copy.
No gateway change is needed. (The word `pwa` is a slight misnomer now; a
follow-up can add a `web` alias.)

## Sign-in: blocked, and stays off

**Do not turn sign-in on.** `WORKOS_ISSUER` has not been verified against a real
access token (`docs/chat-signin.md`, `CLAUDE.md` "single next step", item 3).
Until it is read off a real token, the gateway's verifier cannot be switched on,
and a sign-in that cannot reach the gateway is a sign-in that produces
errors.

What is already known, so that the day it is unblocked is short:

- **Can LibreChat forward the person's access token to the gateway as a Bearer
  token? Yes, in principle** (Read, `packages/api/src/utils/env.ts:154-190`,
  `packages/api/src/utils/oidc.ts`, `packages/api/src/endpoints/openai/initialize.ts:126`):
  custom-endpoint `headers` support the placeholder
  `{{LIBRECHAT_OPENID_ACCESS_TOKEN}}`, resolved per person from their OpenID
  session. So the endpoint would carry
  `headers: { Authorization: "Bearer {{LIBRECHAT_OPENID_ACCESS_TOKEN}}" }`.
  **To test:** that this header replaces the `apiKey`-derived one rather than
  being sent beside it.
- If LibreChat's OpenID refresh does not keep the token fresh enough, the
  alternative is a per-person key issued by the gateway. **No key is created,
  minted or invented by this work.** Machine and developer keys are undecided
  (`CLAUDE.md`, item 4) and stay so.
- OpenID settings (Read, `.env.example:940-987`): `OPENID_ISSUER`,
  `OPENID_CLIENT_ID` (the Shamwari Chat client), `OPENID_SCOPE`,
  `OPENID_USE_PKCE=true` so no client secret is needed, and
  `OPENID_CALLBACK_URL=/oauth/openid/callback`. The registered redirect URI must
  be `https://shamwari.ai/chat/oauth/openid/callback`; today the registered one
  is the old page's `/chat/callback`, which is a different path.
- **"Off" has to be enforced, not assumed.** The pinned `.env.example` ships
  `ALLOW_REGISTRATION=true` and `ALLOW_EMAIL_LOGIN=true` (lines 888-891). A
  LibreChat left on those defaults lets anyone create an account with an email
  address, with no WorkOS involved. The production environment therefore sets
  `ALLOW_REGISTRATION=false`, `ALLOW_EMAIL_LOGIN=false` and
  `ALLOW_SOCIAL_LOGIN=false`, and the guard test asserts all three.
- Until sign-in is on there is no way for a person to authenticate to the
  gateway through LibreChat, so the production page cannot answer real
  questions. That is the same state the old page is in (`CLAUDE.md`, "Current
  state") and is a reason to hold the cutover, not to improvise a shared key.

## Ground citations

**Gap (Read):** LibreChat renders the text in `choices[0].message.content`. The
gateway sends citations in a separate, non-standard object,
`shamwari.citations` (`gateway/src/index.ts`, `gateway/src/envelope.ts`).
LibreChat's custom-endpoint client has no reason to read it, so a cited answer
would arrive as an **uncited answer**. For a legal and tax companion that is the
product, not a cosmetic loss. **To test** against the stub, which returns a
real-shaped response including `shamwari.citations`.

**Smallest fix: let the gateway put the sources in the answer text.** A request
parameter, set by the endpoint's `addParams` (for example
`citations: "inline"`), makes the gateway append a plain markdown list to
`content`:

```
Sources
1. Constitution of Zimbabwe, section 56 (Equality and non-discrimination), Parliament of Zimbabwe, https://...
```

- It needs no LibreChat change, so it survives upgrades and a later fork.
- It only adds text to a response the gateway already builds; scope, auth and
  provenance are untouched. It still needs a gateway test and the owner's yes
  because it changes the response contract for one caller type.
- `safeUrl` handling already in the old client (`site/src/chat/client.ts`)
  must be mirrored: only `https:` links, so a Ground passage cannot smuggle a
  `javascript:` link into rendered markdown.

A structured citation card is the larger fix (a LibreChat patch to read
`shamwari.citations`), and it belongs to the fork conversation, not to launch.

## Weight and low bandwidth

| Page                       | First-load transfer                         | Basis                                            |
| -------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Old R2 page (`/chat/lite`) | 16.0 KB gzipped (HTML+CSS+JS); budget 50 KB | measured by `site/check.mjs`, `docs/chat-app.md` |
| LibreChat `/chat`          | **not measured**                            | see below                                        |

This session could not build or run LibreChat, so it has **no number** for it
and will not offer one. What can be said honestly: LibreChat is a full React
single-page application with a Markdown, code-highlighting and editor stack; it
is not designed to the 50 KB R2 budget (`docs/tiered-access-design.md`) and
should be expected to be far above it. That is the reason the old page is kept.

**The build step measures it** with a CI job that serves the built image behind
the real route table, loads `/chat/` in headless Chromium on a throttled
profile, and records bytes transferred, requests and time to interactive in the
job summary. It reports against the old page's 16.0 KB and fails only if the
number is _unrecorded_, not if it is large: the decision to keep the lite page
does not depend on the result.

### The lite fallback

- `/chat/lite` is the existing page, unchanged, with its service worker rescoped
  to `/chat/lite/`.
- LibreChat's welcome text links to it with the sentence "On a slow connection?
  Use the lightweight chat." (`interface.customWelcome`, Read,
  `packages/data-provider/src/config.ts:2265`).
- The marketing site's "Open chat" button keeps pointing at `/chat/`; the lite
  link lives inside the chat so the choice is made by the person, not guessed
  from their network.
- Status pages, offline queue and installable PWA remain the lite page's job.
  LibreChat's own PWA behaviour is not relied on.

## Look

The owner wants a look close to the Claude desktop app: dark, calm, an
"Let's noodle"-style empty state, a left sidebar. This stays inside
supported theming:

- **Empty state:** `interface.customWelcome` is a supported YAML key (Read, as
  above). The copy follows the brand voice (helpful, warm, intelligent), for
  example a Shona greeting and one line of what to ask.
- **Left sidebar, dark:** LibreChat has both by default.
- **Colours and type:** LibreChat themes through CSS custom properties
  (`--surface-primary`, `--surface-primary-alt`, and the dark set; Read,
  `client/src/style.css:175-299`). **There is no theme key in `librechat.yaml`
  at this release** (this session searched the config schema and found none).
  So the overlay is one CSS file, `theme/shamwari.css`, which sets those
  variables from the Mzizi sodalite tokens, injected by one line in the
  Dockerfile. That is the "thin" end of the patch set, it is an overlay not a
  fork, and it is listed in `PATCHES.md`. The variable names are the part an
  upgrade can break, so the theme test loads the built page and asserts the
  computed `--surface-primary` is the sodalite value.
- The Mzizi tokens come from `@bundu/ui` / `tokens.css`, the same source the
  lite page uses, so the two pages match.

## Database

LibreChat gets its **own MongoDB database**, per the owner's decision.

|               |                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where         | Atlas, a **separate database** in a separate **project or cluster** from `nyuchi-platform-doc-db`, so no credential for the platform database can see it and no credential for it can see the platform |
| User          | one user, scoped to that one database only, role `readWrite` on it and nothing else; no `atlasAdmin`, no cluster-wide roles                                                                            |
| Network       | allow-listed to the Fly app's egress addresses, not `0.0.0.0/0`; the connection string is a Fly secret set by stdin                                                                                    |
| Tier to start | Flex ($0.011/hour, capped at $30/month, 5 GB; Docs, mongodb.com/pricing)                                                                                                                               |
| Search        | Meilisearch off, so conversation search is the basic title search until the owner wants more                                                                                                           |
| RAG           | off                                                                                                                                                                                                    |

This is an **explicit exception** to "only the Nyuchi API and the Servers API
touch databases" (`CLAUDE.md`, architecture). It is recorded here and in #146 so
it is not mistaken for drift. It does not touch the platform database, Core's
no-database-login rule (#127), or the Ground store.

### What is stored, and the rule about it

Relayed (awaiting owner confirmation in this session): the owner accepts that
personal-scope conversation text may be stored here, in line with the verbatim
decision recorded in #146.
Two things follow and are written down so they are not rediscovered:

1. **It is allowed because of where it is stored, not because of where it is
   sent.** Storing text in a database we control is not Rule 1. Sending it to a
   provider is, and the gateway still returns 409. The two must not be confused
   when someone reads this page: the database being private does not make a
   Cloud completion of a personal prompt acceptable.
2. **Production offers no personal-scope endpoint yet** (above), so in practice
   the stored text starts as platform and community conversations. The decision
   is recorded for when Mind makes personal conversations possible.

### Retention and deletion

- **Retention (proposal, owner to confirm):** ordinary chats expire after 12
  months. The pinned `librechat.example.yaml` (Read, lines 324-334) has
  `retentionMode: "all"` with `generalChatRetention` in hours (maximum 8760, which
  is exactly 365 days; the example shows 2160 for 90 days). Stored deadlines are
  **not** migrated when the setting changes, so the value is chosen before the
  first conversation is stored, not after.
- **Deletion by the person:** LibreChat's own delete conversation and delete
  account. The build test creates a conversation, deletes it, and queries the
  non-production database to assert the documents are gone.
- **Deletion on request (a person who cannot reach the page):** a runbook script
  that removes one user and their conversations, messages, files and shared
  links by user id. Written and tested against a scratch database in the build
  step; run by the owner.
- **Account closure:** removal in LibreChat's database does not remove anything
  held by WorkOS. The deletion page says so.

### Backup

The pricing page lists backup as a feature section but this session did not read
its contents for the Flex tier, so Flex's snapshot schedule and retention are
**unverified**: the owner reads them off the Atlas console at creation, and if
Flex does not meet the need the answer is a scheduled `mongodump` job to a
bucket (named in the build step). A restore is **drilled once** into a scratch database before launch,
with the date recorded in this file. A backup never tested is not a backup.

## Same-origin risk (a disagreement worth reading)

The path route puts LibreChat on the same origin, `https://shamwari.ai`, as the
marketing site and the lite page. The lite page keeps each person's chat history
in the browser's IndexedDB (`docs/chat-app.md`, "Data decisions"). Browsers
isolate by origin, not by path. So **a script-injection bug anywhere in
LibreChat could read the lite page's stored history**, and a bug on the lite
page could reach LibreChat's non-HttpOnly storage.

The owner chose a path route for good reasons (no new DNS record, no second
certificate, simpler scaling), and this is not a reason to reverse it. It is a
reason to put these in the build:

- The proxy Worker adds a strict `Content-Security-Policy` to `/chat/*`
  responses: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri` limited to
  the base LibreChat sets, and `connect-src` limited to the site itself (the
  gateway is called by LibreChat's server, not by the browser).
- Code execution, artifacts and custom HTML rendering stay **off** (above).
- The lite page's history store gets a name that LibreChat code does not touch,
  and the build test asserts no LibreChat response sets cookies outside
  `Path=/chat`.
- If the owner would rather remove the exposure entirely, the alternative is to
  move the lite page to its own hostname; that is a one-line decision for the
  owner and it is cheap to take later.

## What it costs

Priced from the vendors' own pages on 1 Nov 2026.

| Item                                          | Price                                                           | Source                                      |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Fly machine, `shared-cpu-1x`, 1 GB, always on | $6.70/month in Ashburn, $7.73 Frankfurt, $8.50 Singapore        | Docs, fly.io/docs/about/pricing             |
| Atlas Flex                                    | about $8/month idle ($0.011 × 730 h), capped at $30/month       | Docs, mongodb.com/pricing                   |
| Cloudflare Tunnel, Worker                     | no per-tunnel charge; Workers VPC listed on Free and Paid plans | Docs, developers.cloudflare.com/workers-vpc |
| Egress                                        | $0.02/GB (Fly, North America and Europe)                        | Docs, fly.io                                |

**About $15/month to start, $37/month at the Flex cap.** One gap in the number:
a 1 GB machine is a starting assumption for LibreChat's memory, not a measurement.
The build step records peak resident memory under the CI load and the machine
size is chosen from that. Inference cost is unchanged because the same gateway
quota applies.

## What the build must prove

These are the tests the build step adds. Each turns a _To test_ above into a
fact, and each fails when a rule is broken.

| Test                    | Proves                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard.test.ts`         | the Rule 1 controls above and the sign-in-off settings, with a mutation check                                                              |
| Stub-gateway: platform  | a question is answered through the gateway only; the stub records the single outbound host                                                 |
| Stub-gateway: personal  | the 409 appears and the person sees the plain sentence, not a generic error; **and** the stub saw exactly one request and no provider host |
| Stub-gateway: streaming | the endpoint works against a non-streaming gateway                                                                                         |
| Stub-gateway: citations | a response carrying `shamwari.citations` shows its sources to the person                                                                   |
| Sub-path e2e            | page, assets, `/chat/api/...`, redirect and cookie path all work through the Worker rewrite; cookies have `Path=/chat`                     |
| Worker unit tests       | strip prefix, `Location` and `Set-Cookie` rewrite, CSP, the `/chat/lite` route wins                                                        |
| Old service worker      | the retiring worker unregisters and clears caches; the lite worker is scoped to `/chat/lite/`                                              |
| Weight job              | records first-load bytes against the old page's 16.0 KB                                                                                    |
| Theme test              | `--surface-primary` computes to the sodalite value                                                                                         |
| Egress test             | the LibreChat container, run with a network policy that allows only the stub and the database, makes no other outbound connection          |

That last test matters most: it is the Rule 1 sibling of the end-to-end
contract test (#122), and it catches the path the guard cannot, a feature we did
not know to disable.

## Cutover order (nothing happens without the owner's named yes)

1. Build step merged to `staging` with every test above green. Nothing deployed.
2. Owner creates the Atlas database and user, then the Fly app, then the tunnel
   (runbook below).
3. Deploy LibreChat to Fly with sign-in **off** and the chat flag **off**.
   Reach it only through the tunnel, from a test route on a preview hostname.
4. Ship a release of the old page whose service worker retires itself, and move
   the old page to `/chat/lite/`. Leave `/chat/` serving the old page until
   step 7. Keep the retiring worker script's own path served by `shamwari-app`
   (a dedicated route for that one path) after the flip, so phones that did not
   visit during the soak still fetch the retiring script. Soak at least 14 days
   and read the remaining installs from the old page's own usage before step 7.
5. Owner reads this page's _To test_ results and the weight number.
6. WorkOS sign-in is finished and **turned on in LibreChat first** (a real token's
   `iss` checked, one real signed-in question answered through the gateway).
   The route flip is gated on this: flipping it before sign-in works replaces
   a working page with one that cannot authenticate.
7. Owner flips the route so `/chat` and `/chat/*` go to LibreChat. The old page
   stays at `/chat/lite/`.

Rollback at any step after 7 is one route change back to the old page.

## Owner runbook (drafts, finalised with real names in the build step)

Written for a phone: each step is one screen of work. **Nothing here is done by
the session.** Secrets go in by stdin or the vendor's secret field, never in
chat, a file or an issue.

1. **Fly app first, for its egress addresses.** From a terminal:
   `fly apps create shamwari-chat`, then allocate static egress IPs for it
   (the command, believed to be `fly ips allocate-egress`, is confirmed against
   Fly's current docs in the build step; machines have no stable egress address
   without it) and note the addresses.
2. **Atlas.** In the Atlas app: New project "shamwari-chat" → Create a Flex
   database → Database Access → Add user, "Specific privileges" →
   `readWrite` on database `librechat` only → Network Access → add the Fly
   egress addresses from step 1, never `0.0.0.0/0`. Copy the connection string; do not paste
   it anywhere except the next step.
3. **Fly secrets.** With the connection string on the clipboard, `fly secrets import --app shamwari-chat`
   and paste `MONGO_URI=...` plus four generated values: `CREDS_KEY`
   (`openssl rand -hex 32`), `CREDS_IV` (`openssl rand -hex 16`),
   `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32` each).
4. **Tunnel.** In the Cloudflare dashboard: Networks → Tunnels → Create →
   name "shamwari-chat". Put its token in with
   `fly secrets set TUNNEL_TOKEN --app shamwari-chat` (value via stdin).
   Add the private service to `localhost:3080`.
5. **Worker route.** Merge the Worker PR. In Workers → Routes, add
   `shamwari.ai/chat` and `shamwari.ai/chat/*` to the proxy Worker and
   `shamwari.ai/chat/lite` and `shamwari.ai/chat/lite/*` to `shamwari-app`. Never
   use a bare `*` suffix: it also matches `/chatter` and `/chat/literature`. Do not remove the old route until step 7 of the cutover.
6. **Flags.** Leave sign-in off. The chat flag (its name is fixed in the build
   step) stays off until step 7 of the cutover.

Fly's `fly secrets import` reads from stdin, so no secret touches a file.
Region: pick the region of the existing Core app so the two are close.

## Decisions that are the owner's, not ours

Recorded 2 Nov 2026 (relayed by orchestrator, awaiting owner confirmation in
this session): title generation **off**, and Ground citations through the
gateway's inline-sources parameter, so every model call stays gateway-only and
sources render with no LibreChat change. The parameter still changes the
gateway's response contract for one caller type and needs the owner's yes before
it is written.

- Whether title generation stays off (recommended: yes, until token quotas are
  observed).
- Retention period (12 months proposed).
- Whether the lite page eventually gets its own hostname (see same-origin risk).
- When to fork (see the patch policy).
- The gateway citation parameter and the stream shim: both change the response
  contract and need a named yes before they are written.

## Not in this design

Streaming responses on the gateway (above), semantic caching, premium tier,
self-serve billing, voice, image, `code.shamwari.ai` sandboxes, Meilisearch, the
RAG API, the Servers API integration (a fork-time job), and sign-in (blocked).

## Language

Following `CLAUDE.md`: Shamwari Cloud is routed, not trained; sovereignty
attaches to Mind and Ground, never to Cloud. LibreChat is "open source (MIT)";
the models behind the gateway are "open weights". Nothing on the page says the
data stays in Africa, because Cloud completions do not.
