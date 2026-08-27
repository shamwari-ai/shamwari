# Shamwari AI — Architecture & Go-to-Market

**Bundu Foundation / Nyuchi Africa · v2 · August 2026**

Supersedes v1, which framed the product as three infrastructure tiers. That was
wrong: Shamwari already has a canonical three-layer model, and it describes data
scope rather than deployment. This version reconciles the two.

---

## 1. Two axes, not one

**What it knows** — the canonical layers, from the brand registry:

| Layer | Content |
|---|---|
| Personal | the user's own pod data |
| Community | anonymised platform data |
| Platform | base Mukoko knowledge |

**Where it runs** — the infrastructure:

| | Runs on | Holds |
|---|---|---|
| Cloud | Cloudflare Workers → routed providers | nothing persistent |
| Ground | MongoDB Atlas (`shamwari.knowledgeBase`) | Zimbabwe corpus, hybrid retrieval |
| Mind | on-device, Qwen-based, quantized | distilled weights |

They intersect, and the intersection is the product:

| | Personal | Community | Platform |
|---|---|---|---|
| **Mind** | ✅ primary | — | ✅ cached |
| **Ground** | pod-scoped | anonymised aggregate | shared corpus |
| **Cloud** | ❌ **never** | ✅ | ✅ |

That bottom-left cell is the whole differentiator. It is enforced in code, not
policy — see CLAUDE.md.

---

## 2. What this means commercially

**Mind is not optional.** If Personal cannot reach Cloud, and Personal is what
makes a companion a companion rather than a search box, then Mind is the
product. Cloud is the general-knowledge fallback and the near-term revenue
engine, but the roadmap cannot treat Mind as phase three.

**Sovereignty means user-sovereign, not nationally-sovereign.** *"A friend that
serves; a friend that does not control."* Defensible with a multi-provider
gateway, on the single condition above. It is not defensible as a data-residency
claim while Supabase sits in Ireland and inference routes to Beijing and San
Francisco. Do not blur these.

**The Foundation is an under-used asset.** Bundu Foundation is a Zimbabwe CLG
and holds Shamwari IP. A research foundation releasing open weights is a far
stronger story than a startup doing it, and it opens grant, donor and
development-finance funding that Nyuchi Africa structurally cannot access. Mind,
Ground and ShamwariBench should be Foundation assets.

---

## 3. Commercial structure — split across entities

| Tier | Entity | Shape |
|---|---|---|
| **Community** | Bundu Foundation | Free. Mind downloadable, open weights, forever. This *is* the community pillar. |
| **Developer** | Nyuchi Africa | Pay-as-you-go, USD or ZiG. Economy tier default. |
| **Business** | Nyuchi Africa | Committed monthly, SLA, standard tier, usage dashboards. |
| **Sovereign** | Nyuchi Africa | Mind + Ground deployed on customer infrastructure. No data leaves. Annual licence. |

The split matters. It stops the community pillar from also having to be the
sales pillar, and it puts the open-weights release under the entity whose
mandate is research rather than revenue.

**Sovereign is the honest high-margin tier.** Cloud cannot sell data residency.
A self-hosted Mind + Ground deployment inside a ministry or a bank genuinely
can — which is why Ground lives in a portable store rather than a
Cloudflare-only one.

Open question: MXT is described as powering B2B API fees. Whether Shamwari API
billing is MXT-denominated is unresolved and affects pricing architecture.

---

## 4. Cloud economics

AI Gateway passes provider inference pricing through at cost and adds 5% on
Unified Billing credits. So there is **no margin in reselling** — a customer can
always go direct and undercut you.

Margin has to be manufactured, from three places:

1. **Route the bulk to cheap models.** Qwen and DeepSeek handle most traffic;
   Kimi K3 for reasoning and long context; Claude/GPT premium and opt-in only.
   Target ≥70% of tokens on economy.
2. **Cache hard.** Exact-match caching is free on AI Gateway. In a market where
   thousands ask near-identical questions about ZIMRA thresholds, hit rate
   should be high. Semantic caching later.
3. **Let Ground do the lifting.** A grounded 4B answer beats an ungrounded 400B
   answer on "what is the current PAYE threshold." Correct answers from cheap
   models is the entire game.

---

## 5. Ground — the moat

Zimbabwean law, tax and monetary policy change monthly. A model with that baked
into weights is stale on arrival and confidently wrong. Retrieval with citation
and an effective date is not a compromise, it is the correct architecture — and
it is the sharpest sales line available:

> *Shamwari knows which Statutory Instrument came out last Friday.*

Freshness beats volume. The refresh pipeline matters more than corpus size.
`ground_refresh_due` computes what needs re-checking; `supersededBy` filtering
means retrieval never cites repealed law.

**`shamwari.groundMisses` is the corpus roadmap**, written by paying customers
instead of by guesswork. Read it weekly.

### Acquisition priority

1. **Law** — Constitution (approved), ZimLII, Veritas, Parliament
2. **Economy** — ZIMRA, RBZ, ZIMSTAT, Ministry of Finance
3. **Verticals** — AGRITEX, MoHCC, ZIMSEC (licence required)
4. **Language** — Masakhane, Common Voice, VOA, UZ ALRI partnership

Five sources are blocked pending licence review. Ingestion refuses them rather
than warning. ZimLII is the highest-value unblock.

---

## 6. Mind — distillation, not fine-tuning from scratch

1. Seed question/answer pairs from Ground documents
2. Kimi K3 and Qwen generate candidates in Shona, Ndebele, Zimbabwean English
   and code-switched registers — **never Claude or GPT**, provider terms bar it
3. Paid human annotators correct. This is the irreplaceable asset, and a good
   story: Shamwari employs Zimbabweans to teach an AI Zimbabwe
4. QLoRA on Qwen 4B. Apache-2.0 base means Mind is genuinely open — weights,
   data recipe and eval suite all publishable
5. Quantize q4. Target a ~US$120 Android device
6. **Build ShamwariBench before training** — Zimbabwean law, tax, agriculture,
   health, Shona and Ndebele fluency. Publish it openly. Whoever owns the
   benchmark owns the argument about who is best at African languages, and it is
   cheap to produce. A marketing asset disguised as engineering.

---

## 7. Marketing wedge

Do not launch as "an African AI API" — too abstract, nobody's budget line.

Lead with **tax and regulatory compliance**. Real pain, being wrong costs money,
the answer changes monthly (so global models are structurally stale), and there
is existing consultant spend to redirect.

Positioning to test:

> *Shamwari cites the Statutory Instrument. ChatGPT guesses.*

Concrete, verifiable, and it makes the architecture the reason you win rather
than something to apologise for.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| "Just a wrapper" | Ground + Mind + ShamwariBench. Ship Mind v0 so the answer is a link, not a promise |
| Cloudflare outage takes down revenue | Three-step degradation, exercised monthly |
| Provider ToS violation via distillation | `licenseClass` enforced by database constraint |
| Sovereignty claim challenged | Claim user-sovereignty only; never data residency for Cloud |
| Corpus goes stale | Refresh cadence built before corpus scale |
| Margin compression | ≥70% economy routing, caching, Ground-boosted small models |
| ZIMSEC / news copyright | Partnership before ingestion; never scrape-first |
| Personal data leaks to a provider | Enforced twice, in gateway and Core. The one bug that must not happen |
