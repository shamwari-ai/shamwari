# Tiered access: design for poor devices and weak networks

Bundu Foundation / Nyuchi Africa · design v1 · October 2026 · tracked in the
issue linked from the pull request that added this file.

**Status: design; item 1 of the build order is built** (the extractive rung,
PR #85). Everything else below is decided direction or a proposal. Where it
says "built", it names the code. Numbers marked _assumed_ or
_unmeasured_ have no measurement behind them yet.

## Goal

By the first release, a person in Zimbabwe on a feature phone, a low-end Android
on 2G, or a capable phone gets a **cited answer** in English, Shona or Ndebele,
at a **cloud cost of about $0.20 per active user per month** (inference and
infrastructure only; channel fees are a separate line, see
[Cost model](#cost-model-at--020-per-user-per-month)), with **personal-scope
data never leaving the device**. Language support is per tier: R0 starts in
English, and Shona and Ndebele arrive first where the channel can carry them.

Owner decisions this design starts from (2026-10-28): all four access tiers are
in the first release; the unit-cost target is about $0.20; Zimbabwe first, with a
data model, language handling and routing policy that stay country-agnostic; and
the build loop may merge its own pull requests into `staging` when CI is green
and code-review is clean. Releases, deploys, secrets and paid resources still
need the owner's named yes.

## Requirements

### Functional

- Ask a question and get an answer with its citation, on every tier.
- Keep working with no network (cached Ground, then queued asks) and recover
  without the user retrying by hand.
- Answer in English, Shona or Ndebele where the tier can carry the language.

### Non-functional

| Concern      | Target                                                                        | Basis                                    |
| ------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| Unit cost    | ≈ $0.20 cloud cost per active user per month at the cheapest tier             | owner                                    |
| Payload      | R0 reply ≤ 3 SMS segments; R2 first load ≤ 50 KB over the wire, answer ≤ 4 KB | _assumed_; set from measurement          |
| Latency      | R2 answer or an honest "queued" in ≤ 10 s on 2G; R0 USSD turn ≤ 5 s           | _assumed_, USSD sessions are short-lived |
| Availability | An answer path always exists: degrade, never go dark                          | `docs/degradation-probe.md`              |
| Privacy      | Rule 1 and Rule 2 in `CLAUDE.md` hold on every tier                           | already enforced in code                 |

**Constraints:** a small team, Cloudflare Workers at the edge, Core on Fly,
Ground in MongoDB through the Nyuchi API, open-weights models, and Mzizi as the
UI system.

## API surfaces

There are two APIs, and only one of them is for customers.

```
person / app / channel adapter (SMS, USSD, chat, voice, PWA, Mind)
        │  consumer key
        ▼
api.shamwari.ai        Consumer API: the gateway Worker. Authenticates the
        │              caller, runs the Rule 1 scope gate first, routes.
        ▼
Core (Fly)             Decides scope again; holds no database login.
        │  internal key, over Fly 6PN, never public
        ▼
Business API           /v1/shamwari on the Nyuchi API (api.nyuchi.com today,
                       nyuchi-servers-api later). Pulls from the Nyuchi
                       platform: Ground, usage, keys. Internal only.
```

- **Consumer API (`api.shamwari.ai`).** What customers, apps and channel
  adapters call. It is the only Shamwari API with a public address.
- **Business API (`/v1/shamwari`).** Internal only, between internal apps. Its
  callers are internal services holding an internal key; no customer, app key or
  person token ever reaches it, and it is not in any public key catalogue.

## The tiers

"Tier" here means how a person reaches Shamwari. It is a third axis beside
scope (what it knows) and destination (where it runs); see
`docs/architecture-and-gtm.md`.

| Tier            | Device and network                      | Carries                            | Where the model runs        | Personal scope         |
| --------------- | --------------------------------------- | ---------------------------------- | --------------------------- | ---------------------- |
| **R0** SMS/USSD | any phone, 2G, no data plan             | short text, English first          | Cloud (cheapest route)      | refused (409)          |
| **R1** Chat app | smartphone, intermittent data           | text, short voice notes            | Cloud                       | refused (409)          |
| **R2** Lite PWA | low-end Android, 2G/3G                  | text, cached Ground, offline queue | Cloud, or none (extractive) | refused (409)          |
| **R3** Mind     | phone with enough RAM for a small model | everything above plus personal     | On the device               | **allowed, on device** |

Voice is a channel across R0 to R2, not a tier of its own: IVR on R0, voice
notes on R1 and R2.

**Consequence of Rule 1.** R0, R1 and R2 all hand text to a provider, so none of
them may carry personal scope. They answer from Platform and Community scope
and say plainly that personal questions need the app with Mind. That is the
design, not a gap: the tier ladder is also the privacy ladder.

### Device tiers for R3 (Mind)

Proposed, _unmeasured_: pick by RAM and storage at install, never by guesswork.

| Device                | Mind               | Fallback     |
| --------------------- | ------------------ | ------------ |
| ≥ 6 GB RAM, 8 GB free | ~4B quantised (Q4) | R2 behaviour |
| 3–4 GB RAM, 3 GB free | ~1–1.5B quantised  | R2 behaviour |
| < 3 GB RAM            | no on-device model | R2 behaviour |

The base model and the generation source are still an open owner decision
(shamwari-ai/shamwari#78). The model download is resumable, chunked, Wi-Fi
first, with delta updates, because a 2 GB fetch that restarts on every drop is
a model nobody gets.

## The degradation ladder

One ladder for every tier. A request takes the first rung that works and the
response says which rung served it (as `inference_path` does today).

1. **Mind** on the device (R3 only, and the only rung that may see personal scope).
2. **Ground-only, extractive.** Retrieval alone returns the closest cited
   passage with no generation. It costs no inference, works from a cached pack
   offline, and cannot invent a citation. It does not judge relevance, so it
   says "Closest source", and it carries the pack's "as of" date when it
   answered from a pack. For "what does the Constitution say about X" it is
   often the right answer, not a consolation.
3. **Cloud economy** (GLM-5.3-Flash class), grounded.
4. **Cloud standard** (GLM-5.3 class) for reasoning and long context only.
5. **Queue.** Store the ask, tell the person when to look, deliver when the
   network returns.

**Personal scope uses rung 1 only.** A personal-scope request that cannot reach
Mind (no device model, no network to a device, any of R0 to R2) gets the 409
`scope_requires_local_inference`, mapped to a short human message. It never
falls to rungs 2 to 5, and the queue never stores a personal-scope ask, because
a stored ask would be delivered to Cloud later. An R3 device with no model
therefore answers personal questions with a refusal that says why, not with an
R2 answer.

This is the cost lever. Rung 2 is free, rung 3 is the default, rung 4 is rare,
and premium models stay opt-in outside this ladder.

## Cost model at ≈ $0.20 per user per month

No price for any of this is verified in this repository, so this is a method,
not a result. `docs/workers-ai-models.md` lists model ids, not prices.

```
per-turn cost  = embedding + retrieval                       (every turn, even extractive)
               + P(cloud generation) × (tokens_in × p_in + tokens_out × p_out)
P(cloud gen)   = 1 − P(extractive) − P(exact-match cache hit)   (only if the three are disjoint)
monthly cost   = turns × per-turn cost + channel fees
budget per turn ≈ $0.20 ÷ turns          (30 turns → about $0.0067 per turn)
```

Embedding and retrieval are per-turn costs: even a turn that never reaches a
generative model embeds the question and queries the corpus. "Exact-match
cache" means the AI Gateway cache, keyed on an identical request; semantic
caching is out of the first phase, and a turn that is both cached and
extractive is counted once.

Levers, in order of size:

1. **Extractive and cached share.** A turn that never reaches a generative model costs only its embedding and retrieval.
   The first measurement to take is what fraction of real questions rung 2 can
   answer well enough.
2. **Token caps per tier.** R0 replies are capped near three segments, so the
   output budget is tiny by construction. R2 caps are looser; R3 is free to the
   operator.
3. **Model choice.** At least 70% of tokens on economy (already the target in
   `docs/architecture-and-gtm.md`).
4. **Ground grounding.** A grounded small model beats an ungrounded large one on
   local law and tax, so grounding lets a cheaper rung serve the turn.

**The honest risk: channel fees may dwarf inference.** SMS, USSD sessions and
chat-app conversations are billed by operators or aggregators, not by Cloudflare.
For R0 and R1 the channel can cost more per turn than the model. Nothing here
has a quote behind it. Until it does, the $0.20 target applies to **inference
plus infrastructure**, and the channel cost is a separate line the owner decides
who carries (the user, a sponsor, or zero-rating by the operator).

## Low-bandwidth protocol

A compact, cache-friendly response envelope shared by every channel adapter,
with the channel deciding the encoding.

- Fields: answer, citations (id and short label), scope, rung that served it,
  and a request id. Nothing else by default.
- Idempotent requests: the same request id is the same answer, so a retry on a
  flaky link costs nothing and never double-bills.
- Resumable and conditional: `ETag` and `If-None-Match` for Ground packs and
  cached answers; byte-range resume for model and pack downloads.
- Compression by default (Brotli/gzip), no per-request JSON bloat, no
  third-party scripts on R2.
- R0 truncates on word boundaries, numbers the segments, and ends with a short
  code for "more" rather than dropping the citation. The limit is per channel
  and encoding, not one number: a GSM-7 SMS segment holds 160 characters (153
  when concatenated, so three segments hold about 459), and any character
  outside GSM-7 switches the message to UCS-2 at 70 (67 concatenated); a USSD
  screen is about 182 characters. The envelope is specified against the
  channel's own limit, and the gateway's default of 450 characters stays under
  three GSM-7 segments.

## Ground packs (offline retrieval)

A build job that turns approved, **ground-eligible** slices of
`shamwari.knowledgeBase` into compact offline packs a phone can hold (for
example a SQLite file with full-text search per topic and language), versioned
and signed so the device can check it. Packs key on `ground_eligible`, the
retrieval gate: `mind_eligible` is the training gate and does not apply to
retrieval, so scraped news (ground-eligible with citation and link-out, not
Mind training data) can be in a pack. If a pack were ever used as training
material, `mind_eligible` would apply to it, and that is a separate decision.
Never a source whose terms are unread, and `supersededBy` content is excluded at
build time.

**A signature proves integrity, not currency.** A pack on a phone ages: a
statute can be superseded after the download. So a pack carries a version and an
"as of" date; an answer from a pack states that date; there is a maximum pack
age after which the device refuses to present an answer as current and says the
pack is stale; and the refresh cadence is tied to Ground's `refresh_cadence`.
Pack size and the maximum age are _unmeasured_.

## Channel adapters

One interface, one adapter per channel (`sms`, `ussd`, `chat`, `voice`),
all behind the same gate: **every adapter calls `parseScope` and
`decideDestination` before a byte reaches a provider.** `CLAUDE.md` is explicit
that voice and image are the endpoints most likely to break Rule 1 because they
look least like text. An adapter that cannot carry personal scope returns the
409 mapped to a short human message, never a silent downgrade.

Voice specifics:

- **Input:** Whisper large v3 turbo has some Shona in its training mix.
  Measure word-error rate on real Shona and Ndebele speech before promising it.
- **Output:** there is no Shona or Ndebele text-to-speech on Cloudflare. Spoken
  output is English-only for now; Shona and Ndebele answers go as text (SMS or
  chat) after the call.
- `licenseClass` has to be stamped **per model** for speech and image, because
  the catalogue mixes permissive and proprietary models.

## Multi-model routing

The routing heuristic stays in `gateway/routing-policy.json`; provenance stays in
code (`router.ts`, `provenance.ts`) and never moves into that file. New in this
design: the policy gains the **tier** and the **rung** as inputs, so R0 can never
select a long-context model and a premium model can never be chosen by tier
alone. GLM is primary; Kimi (2.7 or newer) and Qwen sit behind it and are used
when needed. No model is pinned as a threshold. Whichever model serves, its
licence class is resolved from the model that actually answered, against the
allowlist in `provenance.ts`, which fails closed to `restricted` for anything
unlisted: a newer Kimi or a Qwen is stamped `restricted` until a reviewed code
change lists it, and `licenseClass` never moves into `routing-policy.json`. How
they are reached (an AI Gateway route, or Workers AI) is part of that change.

## Mzizi and the UI

R2 is built from `@bundu/ui` and Mzizi components, not hand-rolled, consistent
with the site. A performance budget is part of the design: static pages with no
client JavaScript where possible, a stated byte budget per route, a service
worker for the offline queue, and a check in CI that fails when a route grows
past its budget. Mzizi Roots (Rust) is the target for the edge adapters when the
Rust rebuild lands (`shamwari-ai/shamwari#66`); until then the adapters are
TypeScript in `gateway/`.

## Trade-offs

| Decision                               | Gain                                    | Cost                                                     |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Tier ladder is also the privacy ladder | Rule 1 cannot be broken by a channel    | Personal questions only work on R3                       |
| Extractive rung before generation      | Free, offline, cannot invent a citation | Plainer answers; needs good retrieval                    |
| Packs on device                        | Works with no network                   | Storage, a refresh pipeline, and pack licensing to track |
| One envelope for all channels          | One tested path                         | R0's 160-character limit shapes the whole contract       |
| Cloud for R0 to R2                     | Reaches every phone                     | Channel fees may exceed inference cost                   |
| Mind needs RAM tiers                   | Honest about what a phone can run       | A device matrix to maintain and test                     |

## What to revisit as it grows

- Semantic caching (deliberately out of the first phase).
- Streaming responses, once R2 can use them on a bad link without stalling.
- A second Ground region or a replica close to users if latency, not cost, becomes the limit.
- Country-specific adapters and operator agreements beyond Zimbabwe.
- Whether Mind's training pipeline (`licenseClass` open-weight only) can be fed
  by R3 usage without breaking Rule 2: it cannot use personal-scope exchanges.

## Decisions still open (owner)

1. Which operator or aggregator carries USSD and SMS, and who pays the channel fee.
2. Chat-app channel and business-API provider.
3. Mind base model and generation source (#78).
4. Android Go native app versus PWA only for R2.
5. Customer key format and the Worker-to-Core path (#81).

## Build order

Each item is a small, testable change that can merge on its own.

1. Degradation ladder with the **extractive rung**, and `inference_path` reporting
   the rung (gateway).
2. Tier and rung as routing inputs, per-tier token caps (gateway, `routing-policy.json`).
3. The compact envelope and idempotent request ids (gateway).
4. Channel-adapter interface with the Rule 1 gate and tests that count provider
   calls, then the SMS/USSD adapter against a fake operator.
5. Ground pack build job and the signed, versioned pack format.
6. R2 Lite PWA on Mzizi with the offline queue and the byte-budget check.
7. Per-tier cost telemetry on `usageEvents` (it already has `tier` and `latencyMs`).
8. Voice: measure Whisper on Shona and Ndebele, then the IVR/voice-note adapter.
9. Mind device tiering and the resumable model delivery manager (after #78).
