# The desired Cloudflare state

What should exist in the Cloudflare account, what runs where, and what must
never run there. Read `docs/scaling-and-memory.md` first for the trust
decision this all rests on.

## The answer to "sandbox per user, or Worker per user?"

Neither. Cloudflare OS — Cloudflare's own agentic workspace, Apache-2.0
licensed source, shipped August 2026 — solves exactly this problem and uses a
third mechanism: **Dynamic Workers, reached through the Worker Loader
binding**.

```jsonc
"worker_loaders": [{ "binding": "LOADER" }]
```

```ts
// packages/workshop-backend/src/overseer.ts
return this.env.LOADER.get(`${this.ctx.id}.${codeVersion}.${gadgetId}`, async () => {
  // ... assemble `modules` as a map of filename -> JS source
});
```

Code is handed to the runtime **as module strings at load time**, keyed by a
cache key that includes the code version. There is no deploy step, no
dispatch namespace to administer, no upload, and no container to cold-start.
A "gadget" — their word for a small personal app — is a dynamically loaded
Worker plus a Durable Object holding its state.

Two loading modes, and Cloudflare OS uses the second: `load(code)` spins up a
fresh Dynamic Worker for one-time execution, while `get(id, callback)` caches
by id so it stays warm across requests. One-shot generated code wants
`load()`; a gadget someone returns to wants `get()`.

There are **zero Containers bindings anywhere in that repository**. Cloudflare
does not use Containers for this, and neither should we.

| Mechanism | Deploy step | Cold start | Ceiling | Verdict |
|---|---|---|---|---|
| **Dynamic Workers** (Worker Loader) | none — code strings at load | isolate | Worker limits | **Use this**, but see the maturity note |
| Workers for Platforms | upload per artifact | isolate | unlimited apps | Only if artifacts need their own hostname |
| Containers | image build | container boot | 1,500 vCPU / 6 TiB account-wide | Only for a real interpreter and filesystem |
| Worker per user | upload per user | isolate | — | Solves nothing a Durable Object doesn't solve better |

### Maturity: open beta, not GA

Dynamic Workers entered **open beta on 24 March 2026** and had not reached
general availability when this was written. An earlier version of this
document recommended it without saying so, which is the kind of omission that
turns into a production surprise. Treat the recommendation as conditional:
the mechanism is right, and a beta is not a foundation to put a paying
customer's gadget on without a fallback. Re-check the changelog before
committing to it.

Note also that the docs now brand this **Dynamic Workers**, with Worker
Loader as the binding name rather than the product name.

So: **one dynamically loaded Worker per gadget version, not per user.** A user
with forty gadgets gets forty isolates on demand and pays for none of them
while idle.

## What to take from Cloudflare OS, and what not to

It is Apache-2.0, the same licence as Shamwari's platform code, and its
README says outright that the intent is for others to copy and rebrand it.
Three things are worth taking.

**Worker Loader for generated code.** Directly adoptable. This is the
mechanism, and it is better than either option we were considering.

**Gatekeepers.** The most valuable idea in the repository for us. A
Gatekeeper is a Worker that mediates one external resource: it wraps the
native API in a clean RPC interface, handles OAuth, **enforces narrow access
to only the specific resource the user intended**, logs every action, and
gates side effects behind human approval.

The approval design is genuinely novel. Rather than blocking the agent while
a human decides, the Gatekeeper *simulates* the outcome, lets the agent
continue and queue further actions, and returns simulated results if the
agent reads back. The human approves in bulk later. That removes the reason
people set agents to auto-approve, which is the actual security failure in
practice.

For Shamwari this maps almost exactly onto the scope model. A Gatekeeper is
how a gadget touches a user's pod **without the gadget ever seeing the pod**:
narrow capability, full audit log, side effects held for approval. Rule 1
currently says *no*; a Gatekeeper is the design that could eventually say
*yes, this much, and here is the log*.

**Gadgets as private instances.** Every user gets their own copy of the app
rather than sharing a multi-tenant SaaS instance. Their argument is that a
per-user instance cannot have a bug that leaks your data to another user,
because there is no other user in it. That is the same argument as rule 1,
arrived at from the security side rather than the sovereignty side.

**What not to take:** the whole product. Cloudflare OS is an enterprise
workspace for company knowledge work. Shamwari is a consumer companion for
Zimbabwean law, tax and daily life. Fork the mechanisms, not the shape.

**And the constraint that does not go away:** a Dynamic Worker runs on
Cloudflare. Under CLAUDE.md's own reading — personal-scope artifacts cannot
execute on Cloudflare Containers — a gadget computing over personal data is
the same category of problem, just cheaper. Adopting this gives us
`platform` and `community` scope immediately. `personal` still needs the
Rust + `deno_core` host behind a shared `SandboxProvider`.

One control is worth knowing about even so, because it is the strongest
version of the argument for eventually saying yes. `load()` and `get()` both
accept **`globalOutbound: null`**, which blocks all outbound network access
from the Dynamic Worker — the code can compute but cannot exfiltrate, and
every capability it does get is one the host passed in explicitly. That is
precisely the shape a Gatekeeper needs.

It does not settle rule 1 by itself: the code and the data it touches are
still on hardware we do not control, which is the storage-and-execution
question `scaling-and-memory.md` leaves open. But it means the eventual
answer is a trust decision about Cloudflare rather than a missing mechanism.

## Desired account state

### Workers

| Worker | Repo | Purpose | Bindings |
|---|---|---|---|
| `shamwari-gateway` | `shamwari-gateway` | The edge: auth, scope gate, routing, queue producer | `AI`, `AUTH_CACHE` (KV), `SINK` (Queue) |
| `shamwari-docs` | `shamwari-docs` | `docs.shamwari.ai` | static assets only |
| `shamwari-web` | `shamwari-web` | `shamwari.ai` — Astro, SSR | `USER` (DO), `CONVERSATION` (DO) |
| `shamwari-console` | `shamwari-platform` | `platform.shamwari.ai` — Astro, SSR | calls Core over HTTP |
| `shamwari-workshop` | `shamwari-workshop` | Gadget host, if and when we adopt this | `LOADER`, `GADGET` (DO), R2, KV |
| `shamwari-gatekeeper-*` | `shamwari-workshop` | One per mediated resource | per-resource |

### Durable Object classes

| Class | Granularity | Holds | Why |
|---|---|---|---|
| `UserObject` | one per person | memory index, entitlements, per-user limits | single-threaded consistency per user; no locking |
| `ConversationObject` | one per conversation | working state, the streaming WebSocket | hibernates; two devices must not serialise behind one thread |
| `GadgetObject` | one per gadget | gadget state, code version | mirrors Cloudflare OS's `class Gadget extends DurableObject` |

Limits are not the constraint: unlimited objects, 10 GB each on the SQLite
backend, 30 s CPU per request (raisable to 5 min), unlimited wall time while
a WebSocket or request is in flight.

### Other resources

- **KV** — `AUTH_CACHE` (exists). Short TTL is the revocation window.
- **Queues** — `shamwari-sink` and `shamwari-sink-dlq` (exist).
- **R2** — gadget content and blueprints, when the workshop lands.
- **AI Gateway** — gateway `shamwari`, spend limit set, exact-match caching
  on, custom providers for Qwen and Moonshot, and the `shamwari` dynamic
  route.
- **Workers AI** — `@cf/baai/bge-m3` for Ground embeddings only. **Never for
  personal-scope text.** See the defect in `scaling-and-memory.md`.

### What must never be on Cloudflare

- Inference over `personal`-scope content, including embeddings. This is
  rule 1, and it is the thing currently broken behind the `MIND_AVAILABLE`
  flag.
- Execution of `personal`-scope artifacts, whether on Containers or via
  Worker Loader.
- Mongo or Postgres credentials. The gateway holds none today; keep it that
  way.

## Sequencing

1. **Write down the trust position** (`scaling-and-memory.md`). Everything
   below depends on it.
2. **Fill Ground, deploy Core.** Unchanged, and still the only thing between
   this and a working demo.
3. **`shamwari-web` on Workers**, Astro SSR, and retire the stale Vercel
   project. This is the missing surface — shamwari.ai currently runs nothing.
4. **`shamwari-console`.** `platform` scope only, so it is unblocked by
   step 1.
5. **`UserObject` and `ConversationObject`.** Only after step 1 says whether
   personal state may rest in Durable Object storage.
6. **Evaluate the Cloudflare OS fork** for the workshop. Not before the
   companion works — a gadget platform on top of a product with an empty
   corpus is the wrong order.

## Sources

- [`cloudflare/cloudflare-os`](https://github.com/cloudflare/cloudflare-os) —
  Apache-2.0. Read at commit `1411714`.
- [Dynamic Workers open beta, 24 March 2026](https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/)
- [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)
- [Cloudflare OS](https://os.cloudflare.app/)
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/)
