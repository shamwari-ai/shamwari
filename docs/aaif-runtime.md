# Adopting the AAIF software into Shamwari

**Status:** proposed design, 2026-11-17. Nothing here is built yet. Owner's instruction, the same
day: "the software we should be adopting as well as it help our build and makes a better product.
The agent router will [be] our routing".

The Agentic AI Foundation (AAIF) hosts ten projects (aaif.io/projects, read 2026-11-17). Its
standards are adopted in the Bundu register (`bundu-labs/bundu-standards`): MCP, AGENTS.md, Agent
Skills, Open Responses, A2A, OpenSandbox and OpenEnv. This note places the AAIF _software_ in
Shamwari's build: Agent Router, agentgateway, OpenSandbox, OpenEnv and goose. Two pieces are
built separately and are out of scope here: Agent Skills in Lite and the Open Responses endpoint
on the gateway.

## The constraint that decides every placement

The two rules in `AGENTS.md` are enforced in this repo, and they stay here:

1. **Personal-layer content never reaches a third-party provider.** The gateway decides scope
   (`gateway/src/scope.ts`, `personal.ts`), and Core checks it again (`core/main.py`). **Nothing
   below moves that decision into adopted software.** Every adopted proxy sits _behind_ the scope
   gate. A personal-scope request never reaches it, so a misconfigured route in someone else's
   software cannot leak personal content.
2. **Only open-weight output trains Mind.** Provenance is resolved from what actually served the
   request. Today that is the `cf-aig-provider` and `cf-aig-model` response headers
   (`gateway/src/gateway.ts:266-269`, `provenance.ts`). A replacement router must report the
   serving backend and model as reliably, or Rule 2 breaks. This is a **hard gate** before Agent
   Router takes production traffic.

## Placement

| Software     | Version read (2026-11-17)                        | Role in Shamwari                                                                                              | Replaces                                                     | Runs on                                                                                        |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Agent Router | v1.2.1 (formerly Envoy AI Gateway), Apache-2.0   | Model routing: tiers, provider credentials, failover, quotas, usage attribution                               | Cloudflare AI Gateway dynamic routing (`dynamic-route.json`) | Fly, beside Core (`aigw` standalone first; Envoy Gateway on Kubernetes only if scale needs it) |
| agentgateway | v1.7.0, Apache-2.0                               | MCP and A2A traffic: Ground as an MCP server, tools, other agents. Not model routing (Agent Router owns that) | nothing; the missing MCP and A2A rows in #291                | Fly                                                                                            |
| OpenSandbox  | Lifecycle API 0.1.0, Execd API 1.0.0, Apache-2.0 | `code.shamwari.ai`: run code an answer needs                                                                  | the planned Rust host in `shamwari-sandbox` (not started)    | Fly or our own Kubernetes, never Cloudflare Containers (Rule 1, `docs/repo-split.md`)          |
| OpenEnv      | v0.13.0 (spec RFC 002 In Review), BSD-3-Clause   | Mind training environments: Ground-cited Q&A, with the citation as the reward signal                          | nothing; `shamwari-mind` is not started                      | the training cluster, offline                                                                  |
| goose        | Apache-2.0                                       | A client: goose users pick Shamwari as a provider, and get Ground through MCP                                 | nothing                                                      | the user's machine                                                                             |

The request path once all of it is in:

```text
client (Lite, LibreChat, SMS, an Open Responses SDK, goose)
  -> gateway Worker: auth, Rule 1 scope gate, Ground retrieval   (unchanged, ours)
      -> personal scope: Ground passage only, no model           (unchanged)
      -> otherwise: Agent Router on Fly -> provider or our own models
          -> served backend and model returned -> Rule 2 provenance (gateway)
      -> tools: agentgateway -> MCP servers (Ground, others) / A2A agents
      -> code: OpenSandbox lifecycle API -> execd in a sandbox
Core: second Rule 1 check, sink, Rule 2 consent                   (unchanged)
Mind: OpenEnv environments over Ground, open-weight output only    (offline)
```

## Order, and what each step needs

Each step is its own PR with tests. The ones marked **owner** spend money or touch production
routing, so they wait for the owner's go.

1. **Agent Router behind a flag.**
   - Add an `UPSTREAM=agent-router` path in `gateway/src/gateway.ts`, beside the AI Gateway path,
     off by default.
   - Commit an `aigw` config that mirrors today's tiers (economy, standard; premium stays
     `restricted`).
   - Tests prove two things. The served backend and model are read from Agent Router's response
     into Rule 2. A response that names no served model is treated as not trainable, not as the
     requested model.
2. **Agent Router on Fly.** **owner:** a new Fly app, provider keys moved into it, cost. Shadow
   traffic first, then the flag flips. Cloudflare AI Gateway stays as the fallback until a week
   runs clean.
3. **Ground as an MCP server through agentgateway.**
   - Closes the "Tools and context via MCP" FAIL in #291.
   - goose, LibreChat and any MCP client can then search Ground with citations.
   - Personal scope stays out: Ground holds platform data only.
4. **OpenSandbox for `code.shamwari.ai`.** **owner:** the infrastructure, and a security review
   of egress and the credential vault. It replaces the Rust host plan, and `shamwari-sandbox`
   becomes its deployment repo.
5. **goose: Shamwari as a provider.** Documentation and a provider config, once Open Responses
   ships. No code in goose itself.
6. **OpenEnv in `shamwari-mind`.** When Mind training starts. Environments read only Ground and
   open-weight output (Rule 2).

## What this does not change

- **The two rules, their tests and their owners.** No adopted software is trusted to enforce
  either.
- **The gateway stays a Cloudflare Worker.** Agent Router and agentgateway are upstream of it, not
  replacements for it.
- **`routing-policy.json` stays the tier heuristic.** Agent Router carries the chosen tier's
  traffic; it does not choose the tier.

## Open for the owner

- **Fly placement.** `jnb`, beside Core, is assumed. Every model call would add a Worker-to-Fly
  hop.
- **Provider credentials.** Today they are bound to Cloudflare AI Gateway. Under Agent Router they
  move to Fly secrets.
- **Whether premium (`restricted`) traffic goes through Agent Router at all,** or stays on the
  current path.
