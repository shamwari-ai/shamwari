# Shamwari Factory

Design: [`docs/factory.md`](../docs/factory.md). Tracking: #330.

The factory is [OpenCode](https://opencode.ai) with its web UI, one server per
signed-in person, each in its own Cloudflare Container run by that person's own
Durable Object. OpenCode calls models only through the Shamwari gateway. It
works on the code repositories the person clones into it, and on nothing else.

**Nothing here is live.** `wrangler.jsonc` declares no route, custom domain,
`workers.dev` or preview URL, and `npm test` fails if one appears
(`test/config.test.ts`). The WorkOS bindings are not set either, so a deployed
copy would answer every request with 503 and never start a container.

## How it works

```text
browser ── https://factory.shamwari.ai/... ──▶ shamwari-factory Worker (src/index.ts → router.ts)
  /auth/login, /callback, /auth/logout   sign-in for this host (session.ts, WorkOS AuthKit)
  anything else                           gate.ts: a verified Shamwari session, or 302 / 401 / 503
     │  who = `sub` of the verified WorkOS access token (never the path, a query or a header)
     ▼
  FACTORY_WORKSPACE.getByName("user:<sub>")    one Durable Object per person (workspace.ts)
     │  setGatewayCredential(the person's token)   kept in the object, never in the container
     │  fetch(request without Cookie / Authorization)
     ▼
  ctx.container (standard-1, enableInternet: false, sleeps after 15 idle minutes)
     └─ opencode serve :4096   (OpenCode 1.19.4; UI and API proxied at the root, ?url=<this origin>)
          │ every HTTP / HTTPS request it makes
          ▼
  Outbound entrypoint (outbound.ts → egress.ts)
     api.shamwari.ai  POST /v1/chat/completions, /v1/responses
                      → Authorization: the person's token, X-Shamwari-Channel: factory
     github.com       → passed through (clone, push)
     anything else    → 403, never fetched
```

| Path                    | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `src/router.ts`         | the request path: sign-in routes, gate, the person's workspace                 |
| `src/session.ts`        | sign-in routes and the `__Host-` session cookie (from `site/worker/`)          |
| `src/gate.ts`           | verifies the session, renews it, and names the person (`sub`)                  |
| `src/workos-port.ts`    | the only file that calls the WorkOS SDK                                        |
| `src/refresh-do.ts`     | serialises session renewals per WorkOS session (refresh tokens are single-use) |
| `src/workspace.ts`      | the `FactoryWorkspace` Durable Object (runtime wiring)                         |
| `src/workspace-core.ts` | starts the container, the intercepts and `opencode serve`; proxies the UI      |
| `src/outbound.ts`       | the `Outbound` entrypoint every container request goes through                 |
| `src/egress.ts`         | the allow-list and the credential injection, as pure rules                     |
| `src/opencode.ts`       | OpenCode's configuration and environment                                       |
| `Dockerfile`            | the workspace image: Node, Git, ripgrep, OpenCode, `sandbox-shim`              |

```bash
npm ci
npm run typecheck
npm test
```

The tests run in Node against fakes (no container, no WorkOS):
unauthenticated access is refused and reaches no workspace; the allow-list
refuses everything but the gateway's two inference paths and `github.com`; no
credential is in the container's environment or configuration; one person
cannot reach another's workspace; OpenCode's configuration uses only keys the
pinned release reads and enables only the `shamwari` provider; and the
configuration cannot switch anything on.

## Versions and where they were checked (2026-11-18)

| Pin                                    | Source                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@cloudflare/sandbox` 1.0.3            | npm `latest` (22 Oct 2026); the sandbox-sdk OpenCode example's `package.json` uses 1.0.3    |
| `cloudflare/sandbox:1.0.3` (by digest) | Docker Hub tag 1.0.3; the example's Dockerfile; the tag must equal the npm version (tested) |
| `opencode-linux-x64-baseline` 1.19.4   | Cloudflare's "Run OpenCode in a sandbox" and "Start an OpenCode server" pages pin 1.19.4    |
| `node:24-trixie-slim` (by digest)      | the base image in the same Cloudflare pages                                                 |
| `@workos-inc/node` 12.1.0              | the version `site/` resolves                                                                |

OpenCode 1.19.4's configuration shape is the `provider` map (`npm`,
`options`, `models`), checked against `ConfigV1` at tag `v1.19.4` of
`anomalyco/opencode`. The `providers` / `package` / `settings` shape now on
opencode.ai/docs/providers is OpenCode 2.x: 1.19.4 reports it as unsupported
and ignores it. The image was built here and `opencode debug config` and
`opencode models` were run in it with no network: the configuration is read as
written, and the only models listed are `shamwari/shamwari-economy` and
`shamwari/shamwari-standard`.

## Before it is useful: the gateway

OpenCode is an agent: every model call it makes is a streamed
`/v1/chat/completions` with `tools` and `tool_choice` (seen in the built image
against a stub server). The gateway's chat endpoint today answers a plain chat
request: it replaces the system prompt with Ground's, does not pass `tools` and
does not stream, and caps output at 2048 tokens; the Open Responses endpoint in
PR #326 refuses `stream` and `tools` with a 400. So until the gateway has a
factory path, OpenCode in the factory will chat but cannot edit files or run
commands. That path is a gateway change for its own pull request and the
owner's review (docs/factory.md, "Gateway"), not something this package does.

## Owner steps to switch it on (none done)

1. **Gateway factory path.** Agree and merge the gateway change above,
   including a code-model tier (an open-weight Workers AI model whose licence
   has been read; not `kimi-k2.7-code`, which Cloudflare retires on 2026-11-20,
   #331) in the dynamic route and the
   provenance allow-list. Then add it to `MODELS` in `src/opencode.ts`.
2. **WorkOS.** In the Mukoko Account environment's AuthKit application, add the
   redirect URI `https://factory.shamwari.ai/callback`. Set the
   `WORKOS_CLIENT_ID` and `WORKOS_REDIRECT_URI` vars, and bind
   `WORKOS_API_KEY` and a NEW `COOKIE_PASSWORD` (32+ characters, not the
   chat's) from the Secrets Store. The gateway already accepts this client's
   tokens if it is in its `WORKOS_CLIENT_ID` list.
3. **Hostname.** Add `routes: [{ "pattern": "factory.shamwari.ai",
"custom_domain": true }]` and change `test/config.test.ts`'s allow-list in
   the same reviewed change. The UI must be at the root of its own hostname.
4. **Deploy** with Docker running (`wrangler deploy` builds and pushes the
   image). Containers need the Workers Paid plan.
5. **Limits and cost.** Each person's container is `standard-1` (1/2 vCPU,
   4 GiB, 8 GB disk) and sleeps after 15 idle minutes. At Cloudflare's
   published rates (Containers pricing, 13 Nov 2026) one running hour is about
   $0.036 of memory and $0.002 of disk, plus CPU at $0.072 per busy vCPU-hour
   (at most $0.036 for a half vCPU): roughly $0.04 to $0.08 per active hour,
   beyond the Paid plan's included 25 GiB-hours, 375 vCPU-minutes and 200
   GB-hours a month. Model tokens are billed through the gateway as usual and
   count against the person's monthly cap there.

## Use Shamwari from your own OpenCode

For developers running OpenCode on their own machine against the public
gateway, with a Shamwari API key in `SHAMWARI_API_KEY`. The same gateway caveat
applies: until the factory path above lands, this gives you chat, not the
agent's tools.

OpenCode 1.x (`~/.config/opencode/opencode.json`; the shape the factory uses):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["shamwari"],
  "model": "shamwari/shamwari-standard",
  "provider": {
    "shamwari": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Shamwari",
      "options": {
        "baseURL": "https://api.shamwari.ai/v1",
        "apiKey": "{env:SHAMWARI_API_KEY}"
      },
      "models": {
        "shamwari-standard": { "name": "Shamwari Standard" },
        "shamwari-economy": { "name": "Shamwari Economy" }
      }
    }
  }
}
```

OpenCode 2.x (the shape on opencode.ai/docs/providers; not run here):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "shamwari": {
      "name": "Shamwari",
      "env": ["SHAMWARI_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "https://api.shamwari.ai/v1" },
      "models": {
        "shamwari-standard": { "name": "Shamwari Standard" },
        "shamwari-economy": { "name": "Shamwari Economy" }
      }
    }
  }
}
```

Only the custom OpenAI-compatible provider is documented: the gateway does not
speak any other provider's API, so pointing a built-in provider's `baseURL` at
it would not work.
