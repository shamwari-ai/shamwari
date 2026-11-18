# Shamwari Factory

Tracking: #330. Code: [`factory/`](../factory/README.md). Status: built and
tested, not live.

Owner, 2026-11-18: "shamwari factory becomes open code. I still need a web
interface. Our factory should run open code in a container on cloudflare using
do."

## What it is

[OpenCode](https://opencode.ai) (MIT) with its web UI, at the root of its own
hostname (planned: `factory.shamwari.ai`), behind Shamwari sign-in. Each
signed-in person gets their own Durable Object, reached by `getByName` on their
WorkOS user id, and that object owns one Cloudflare Container running a pinned
`opencode serve`. The Worker proxies the UI and API through the object. Every
request the container makes goes through a Worker entrypoint that allows only
the Shamwari gateway and `github.com`.

## Why a Container here is consistent with Rule 1

Rule 1 (AGENTS.md) is that personal-layer content never reaches a third-party
inference provider, and the recorded constraint
(`docs/desired-cloudflare-state.md`, `docs/scaling-and-memory.md`) is that
personal-scope artifacts never execute on Cloudflare. The factory keeps both:

- **What runs there is a code workspace, not the person's Shamwari data.** The
  container is given OpenCode's configuration and switches and nothing else: no
  memories, no personal skills, no chat history, no Shamwari account data
  (`factory/src/opencode.ts`; OpenCode's own lookups for skills and prompts
  outside its configuration are switched off). It works on the repositories the
  person clones into it. That is `platform`-scope work in the sense of
  `docs/desired-cloudflare-state.md`: the category it already says may run on
  Cloudflare.
- **The gateway stays the only model path, and its scope gate still runs.**
  OpenCode has one provider, `shamwari`, and `enabled_providers` names only it;
  the egress allow-list refuses every other host anyway. The Worker sends the
  person's own WorkOS token, so the gateway authenticates the person and runs
  its usual `resolveScope` and own-information checks on every factory request;
  the factory never sets a scope. A question the gateway judges to need the
  person's own information is answered by the gateway's own rule, not by a
  model.
- **No credential is in the container.** OpenCode sends a fixed placeholder
  key; the Worker replaces the Authorization header on the way out. The
  person's token is kept in their Durable Object and read by the outbound
  entrypoint, never passed to the container.
- **Marked as factory traffic.** Requests carry `X-Shamwari-Channel: factory`.
  The gateway already treats any channel header as never trainable
  (`conversationTrainable`), so factory traffic cannot become Mind training data
  (Rule 2).

What the factory does NOT do: run anything over personal-scope data. Code that
must compute over a person's own information still needs a host off
Cloudflare.

## What it supersedes

The earlier plan for coding work was a Rust + `deno_core` sandbox host at
`code.shamwari.ai` (`docs/repo-split.md`, `shamwari-sandbox`), and in the AAIF
runtime note on PR #325 (`docs/aaif-runtime.md`, not edited here) OpenSandbox on
Fly or Kubernetes. For coding on code the person brings, the factory replaces
both. The off-Cloudflare host is still the plan for personal-scope execution,
which the factory does not do.

## Container or OpenCode's workerd SDK

OpenCode now ships `@opencode/sdk/workerd` (OpenCode 2.x), which runs an
OpenCode host inside a Durable Object with SQLite storage and no local
filesystem or processes. It was not chosen:

- The owner asked for a container.
- A coding agent needs a real filesystem, Git, a shell and ripgrep; the workerd
  host replaces those services, and its page does not say what the shell and
  Git tools become.
- The web UI comes with `opencode serve`; the workerd page does not describe
  serving it.
- It is OpenCode 2.x, whose packages were published this week; Cloudflare's
  Sandbox SDK documents and tests the container path with OpenCode 1.19.4.

Worth revisiting for a lighter, chat-only factory once 2.x settles.

## Gateway

OpenCode's model calls are streamed `/v1/chat/completions` requests with
`tools` and `tool_choice`. The gateway's chat endpoint today does not pass
`tools`, does not stream, replaces the system prompt with Ground's and caps
output at 2048 tokens; the Open Responses endpoint in #326 refuses `stream`
and `tools`. So the factory chats but cannot act until the gateway has a path
for it. Owner steps, each its own reviewed gateway change (none made here, and
no production routing was edited):

1. A factory path on the gateway (for example a `factory` channel or surface)
   that passes `tools`, `tool_choice` and `stream` through, keeps OpenCode's
   system prompt rather than Ground's, and runs the same authentication, quota,
   `resolveScope` and own-information gate first.
2. Keep no conversation content for it, as for the web chat
   (`X-Shamwari-Channel: pwa` today drops the conversation document): people's
   code should not be stored as conversations.
3. A code-model tier in the dynamic route and the provenance allow-list, on an
   open-weight code model the gateway can already reach on Workers AI (for
   example `@cf/moonshotai/kimi-k2.7-code`, `docs/workers-ai-models.md`). Until
   then the factory defaults to `shamwari-standard` (GLM, open weights).

## Sizing and cost

- **Instance:** `standard-1` (1/2 vCPU, 4 GiB, 8 GB disk). Cloudflare's
  OpenCode notes report that `lite` did not answer within 30 seconds.
- **Sleep after 15 idle minutes** (`setInactivityTimeout`). A sleeping
  workspace costs nothing; a new one starts on the next request.
- **Files go with the container.** A workspace that sleeps loses its clone and
  any work not pushed. Snapshots (free during their beta) or a bucket mount are
  the follow-up if that matters to users; pushing to GitHub is the answer
  today.
- **Cost per active hour** at Cloudflare's published rates (13 Nov 2026):
  about $0.036 memory + $0.002 disk + CPU used (at most $0.036 for the half
  vCPU), so $0.04 to $0.08, beyond the Workers Paid plan's included usage.
  Twenty active hours a month is about $1 to $1.60 per developer, plus model
  tokens through the gateway.
- **Ceiling:** the account limits (15,000 concurrent vCPU, 60 TiB memory) allow
  about 15,000 concurrent `standard-1` workspaces; memory and CPU bind
  together.

## Revenue

A paid developer plan on open-weight code models is the obvious shape, in the
range OpenCode itself charges for its own (OpenCode Go, $10 a month). At the
cost above, $10 a month covers a few dozen active container hours with room
for model tokens on open-weight models served through the gateway. Pricing and
quotas are the owner's decision; nothing here meters or bills beyond what the
gateway already does.

## What is not verified

- Nothing has run on Cloudflare: no deploy, no Container, no Durable Object.
  The intercepts, the `?url=` UI proxy, WebSocket upgrades through the object,
  and the HTTPS trust inside the container follow Cloudflare's documentation
  and are tested against fakes only.
- The image was built locally (with a local proxy certificate added for the
  build only), and OpenCode 1.19.4 was run in it with no network: it reads the
  configuration, lists only the `shamwari` models and serves its web UI.
- A session lasts as long as the person's token: the gate renews it on each
  request, but if the browser is closed for more than about an hour while a
  task runs, the gateway refuses the token and the task stops with a
  "sign-in has lapsed" error until the person comes back. A per-person
  Shamwari API key held by the Worker would remove that limit.
