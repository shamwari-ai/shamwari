# Surfaces, scaling, sandboxes and memory

Answers to five questions, and one decision that has to be made before four
of them can be answered properly.

## The decision everything else depends on

Rule 1 says personal-layer data never reaches a third-party **inference
provider**. CLAUDE.md's note on sandboxes goes further without saying so
explicitly: it rules out Cloudflare Containers for personal-scope artifacts,
which extends the rule from *inference* to *execution*.

Neither statement covers storage. And that gap is where Durable Objects,
memory, and sandboxes all live. So the rule needs a third column:

| Cloudflare does | On personal-scope data | Status |
|---|---|---|
| **Transport** — TLS terminate, read a request body, route it | Already happening. A personal-scope request arrives at the Worker in cleartext and the Worker reads it to decide to refuse it | Permitted, by existing practice |
| **Storage** — KV, R2, D1, Durable Object SQLite | Not yet happening anywhere | **Undecided** |
| **Execution** — Durable Object code, Containers, Workers for Platforms | Not yet happening | Barred for artifacts, per CLAUDE.md |
| **Inference** — Workers AI model calls, embeddings included | Barred, and now actually enforced downstream of the gate — see below | Barred, rule 1 |

Pick one of two positions, because the architecture forks here:

**Position A — Cloudflare is trusted infrastructure, not a trusted brain.**
Transport and storage are fine; inference and execution over personal data
are not. Durable Objects hold personal state, Workers for Platforms hosts
user apps, and the sovereignty claim is specifically about *models* not
seeing your data. Cheap, fast, and everything below works.

**Position B — personal-scope bytes never rest on infrastructure we do not
control.** Durable Objects cannot hold personal memory; that moves to Core
and the device. More honest, considerably more work, and it makes per-user
Durable Objects useless for the thing they are best at.

The current code implies A (personal requests already transit Cloudflare)
while CLAUDE.md's language implies B. Nothing will be consistent until this
is written down. My read: **A, stated explicitly and narrowly** — because B
is not achievable while a Cloudflare Worker is the front door at all, and a
claim that is quietly untrue is worse than a narrower one that holds.

## Three rule-1 defects that were live in the code

All three are fixed now. They are written up rather than deleted because
they share one shape, and that shape is the thing to watch for: **rule 1 was
enforced at a gate, and then three separate code paths downstream of the
gate never asked what the gate had decided.**

An earlier version of this document claimed the first of these was already
fixed when it was not. That was wrong, and it is the reason the other two
were found — a doc that asserts a guard exists is worth less than a test
that fails when it does not, so each now has one.

**1. The embedding.** `ground()` called `embed()` — `env.AI.run(EMBEDDING_MODEL)`,
a Cloudflare-hosted model — on the last user message unconditionally.
`destination` was a parameter, and its only use was being forwarded to Core.
While `MIND_AVAILABLE=false` this was unreachable, because `decideDestination`
threw first. The moment the flag flipped, every personal-scope question was
embedded by a third-party model, upstream of Core's authoritative check.

*Fixed:* `ground()` embeds only for a `cloud` destination. Core accepts a
query with no embedding and falls back to lexical-only retrieval — weaker
ranking over the same public corpus, which is the honest cost of not
embedding on Cloud. Core also now **refuses** a `mind`-destination query
that arrives carrying an embedding, rather than discarding the vector: a
silent discard would hide a Worker that had already leaked.
`gateway/test/ground.test.ts` counts `AI.run` calls.

**2. The prompt, which was the bigger half.** `route()` and `infer()` never
saw `decision` either. So `MIND_AVAILABLE=true` did not route personal scope
to Mind — there is no Mind client in the Worker, and there cannot be one,
because Mind runs on the device. It sent the prompt itself to Moonshot or
Alibaba. CLAUDE.md's "flipping it routes personal scope to Mind with no code
change" was the claim that made this invisible.

*Fixed:* the scope gate now takes a capability. `/v1/chat/completions`
generates on Cloud by definition, so it refuses personal scope regardless of
the flag. `MIND_AVAILABLE` instead gates `/v1/ground/context`, a new
retrieval-only endpoint that returns the system prompt and citations and
calls no provider. The device generates. That is what "routes to Mind"
actually has to mean.

**3. The lexical pipeline had no owner filter.** Found while restructuring
for (1). Core's `$rankFusion` applied the scope prefilter to `$vectorSearch`
only; the Atlas Search half filtered on `isActive` and nothing else. So a
`platform`-scope Cloud request could surface **another entity's** personal
pod chunks by keyword and forward them to a provider — no flag required, and
the two-check design could not see it, because both checks had already
passed by then.

*Fixed:* the prefilter is re-applied as a `$match` immediately after
`$search`, before `$limit`, so the limit counts documents the caller may
actually see.

The lesson for the next feature: a scope gate that returns a decision no
downstream function is obliged to read is a comment, not a control. Voice and
image will arrive with the same trap — see the note in
`docs/workers-ai-models.md`.

## 1. Where does shamwari.ai run?

Nowhere. The SvelteKit app that served it was removed in the pivot, so what
resolves today is a stale Vercel build from before that, and its Vercel
project is still configured to build a tree that no longer contains an app.

Recommendation: Astro on Cloudflare Workers, matching `docs-site/` and the
console. That puts every web surface on one platform, one deploy story, and
one place to reason about where a request goes.

## 2. The console — platform.shamwari.ai

Astro with server-side rendering on Workers, TypeScript to start.

It is a dashboard over data Core already exposes: `POST /auth/verify`,
`GET /rollup` for usage and billing period totals. What is missing on Core's
side is key issuance and revocation, and a per-key usage breakdown — three
endpoints, not a service.

Rust underneath is worth it only where there is CPU-bound work. A console
that renders tables of somebody else's aggregates has none. Keep Rust for the
sandbox host, where it earns its place.

Note that the console shows *usage*, which is `platform`-scope data about a
customer's account — not `personal`-scope pod data. It sits outside rule 1
entirely, which is why it is the easiest of these to build.

## 3. Scaling: a Durable Object per user

Viable, and the limits are not the constraint:

| | |
|---|---|
| Objects per account | Unlimited |
| Storage per Object | 10 GB (SQLite backend) |
| CPU per request | 30s default, configurable to 5 min |
| Wall time | Unlimited while a request, WebSocket or pending I/O is in flight |
| WebSocket message | 32 MiB |

What a per-user Object is genuinely good at: single-threaded consistency. One
Object per user means no locking around conversation state, no race between
two devices writing the same memory, and a natural home for a per-user rate
limit that does not need a round trip to Core.

Shape it as two classes, not one:

- **`UserObject`** — one per person. Long-lived. Holds the memory index,
  entitlements, per-user limits. Rarely evicted, cheap when idle.
- **`ConversationObject`** — one per conversation. Holds working state and
  the WebSocket for streaming. Hibernates aggressively; the WebSocket
  Hibernation API keeps the socket without keeping the Object billable.

Do not put both in one Object. A per-user Object that also serves every
active conversation serialises them behind one thread, which is exactly wrong
for someone with two devices open.

**Under Position B, this section does not survive** — a `UserObject` holding
personal memory is Cloudflare storage and Cloudflare execution over personal
data. That is the fork.

## 4. Sandboxes per session

Cloudflare Containers is the substrate, and the limits do bound this:

| Instance | vCPU | Memory | Disk |
|---|---|---|---|
| `lite` | 1/16 | 256 MiB | 2 GB |
| `basic` | 1/4 | 1 GiB | 4 GB |
| `standard-1` | 1/2 | 4 GiB | 8 GB |

Account ceiling is 1,500 concurrent vCPU and 6 TiB concurrent memory. At
`lite`, memory binds first: about 24,000 concurrent sandboxes, and far fewer
at any instance size worth running a real interpreter on. `basic` gives
roughly 6,000.

So "a sandbox for every session" is affordable only if a session that is not
actively executing has no container. Design for that from the start: create
on first execution, not on session open, and reap on idle. A per-session
container that lives as long as the conversation is the version of this that
becomes unaffordable at a few thousand users.

And per CLAUDE.md: **personal-scope artifacts cannot execute on Containers.**
That needs a Rust host with `deno_core` behind a shared `SandboxProvider`
interface, so the two backends are interchangeable and the scope decides
which one runs. Build the interface before the first backend, or the second
one never fits.

## 5. Deploying projects the way Claude and ChatGPT do

These are two different products and it is worth not conflating them:

**Preview** — generated code rendered immediately, sandboxed in the user's own
browser inside an iframe. No server, no deploy, no cost, no URL. This is what
most artifact interactions actually want, and it is where to start.

**Publish** — a real URL that outlives the session and can be shared. That is
[Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/):
dispatch namespaces, one Worker per user artifact, unlimited applications,
per-customer CPU and subrequest limits, per-tenant bindings, and a subdomain
per app. Cloudflare's own reference architectures for this are named after
the use case.

The sequencing that follows: browser preview first, because it costs nothing
and covers the common case. Workers for Platforms when users start asking for
a link. Containers only for artifacts that need a real interpreter and a
filesystem — which is a much smaller set than it first appears.

## 6. Memory

Four kinds, and they do not belong in the same place:

| Kind | Example | Where | Scope |
|---|---|---|---|
| **Working** | the current conversation | `ConversationObject` SQLite | personal |
| **Durable facts** | "I am a smallholder in Mutoko", "paid in USD" | `UserObject` SQLite, or Core under Position B | personal |
| **Episodic** | "we worked out your PAYE in March" | Core — Mongo `conversations`, already built | personal |
| **Semantic corpus** | Zimbabwean law and tax | Ground — Mongo `knowledgeBase`, already built | platform |

Retrieval over durable facts is where rule 1 bites hardest. Useful memory
means retrievable memory, retrievable means embedded, and **embedding is
inference** — so personal memory cannot be embedded by Workers AI, by an
external provider, or by anything that is not Mind or Core.

Three options, in order of how honest they are:

1. **Mind embeds, on the device.** Correct, and blocked on Mind existing.
2. **Core embeds, on Nyuchi infrastructure.** Available now, and it means
   personal text crosses the network to Core — which is already true, since
   Core stores conversations. Needs a self-hosted embedding model rather than
   the Workers AI binding, so `EMBEDDING_MODEL` cannot be the same call.
3. **No embedding: keyword and recency only over a small fact table.** Much
   weaker retrieval, zero new exposure, and probably good enough for the
   first few hundred durable facts a person actually has. Worth measuring
   before assuming it is not.

Recommendation: **3 now, 2 when it stops being enough, 1 when Mind ships.**
The bge-m3 dimension lock does not apply to personal memory — it is a
separate index, and it can move independently of Ground.

## What to do next, in order

1. Write down Position A or B. Nothing below is decidable without it.
2. Review the three rule-1 fixes above. The one judgement call worth
   confirming: a personal-scope query now gets lexical-only Ground rather
   than nothing, on the argument that Ground is public law and the thing
   needing protection is the question. If you disagree, the alternative is
   ungrounded — say so and it changes one line.
3. Fill Ground and deploy Core. Still the only thing between this and a
   working demo, and none of the above changes that.
4. Build the console. It is `platform`-scope only, so it is unblocked by
   the decision above.
5. Stand shamwari.ai up on Workers, and retire the stale Vercel project.
6. `SandboxProvider` interface before either sandbox backend.
