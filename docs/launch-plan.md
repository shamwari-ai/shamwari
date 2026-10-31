# Launch plan: public Shamwari Chat, the tooling behind it, the first ten customers

Tracking issue: #103. Children: #104 to #114 (sprint 1). Written 2026-10-31.
Owner's words (2026-10-31): "We need to get back to Shamwari now that we know the
console is working and the data is working and the API is updated. We need to go in
and start building all of our tooling, because this is holding us back from release
and potential revenue. Launching the chat and the app is very, very high [priority]."

**How to read this.** Status refreshed 2026-10-31 (tracking #131). Facts about this repo
were checked on `staging` (1c8c448) and, where marked, live that day (the live site,
gateway `/health`, the corpus table, the Ground collection count, the ledger's Fly
status). Facts about other repos (`nyuchi-api`, `nyuchi-servers-api`, `data-infra`,
Console) are the owner's statement of 2026-10-31; this session has no access to them
and has not verified them. Numbers marked _assumed_ or _unmeasured_ stay that way until measured.
Nothing in this plan is deployed, released or paid for by writing it.

## 1. Where things stand

| Piece                                                                             | State                                                                                                                                                                                                                              | Source                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `www.shamwari.ai`, `docs.shamwari.ai`                                             | live (checked 2026-10-31). Honest labels. `/chat/` is a **404**: the chat is merged to `staging`, not released                                                                                                                     | `site/src/data/status.ts` |
| Gateway Worker                                                                    | **deployed** (`/health` answers, `mind: false`, checked 2026-10-31); **accepts no customer key**: Core is not running and the Servers API path is off                                                                              | #81, #19                  |
| Core (Python)                                                                     | merged, **not deployed**: image never built, no Fly app, `core.shamwari.ai` does not resolve. **No database login**: reaches data only through the Nyuchi API (#127). Runbook merged (#117); Fly steps are the owner's             | #81, #117, #127           |
| Chat (`site/src/chat`)                                                            | shell, thread and citations, scope refusal, local history, CORS and a no-content chat channel merged to `staging` (#116, #119, #124, #125); runs against a stand-in; offline shell and accessibility tests are drafts (#120, #123) | #83, #104                 |
| Chat sign-in                                                                      | **decided, not built:** Mukoko Account (WorkOS) tokens verified at the gateway, no per-user keys (owner, 2026-10-31). Spec merged (#126). Gateway change is #130, **draft, needs the owner's approval**                            | #105, #126, #130          |
| Ground (`shamwari.knowledgeBase`)                                                 | indexes READY, **content empty (count 0, checked 2026-10-31)**. Ingest with section citations and a citation eval gate are merged (#121)                                                                                           | CLAUDE.md, #121           |
| Servers API                                                                       | _owner statement:_ merged to its staging; durable ledger stores are being built now                                                                                                                                                | owner                     |
| Ledger (`data-infra`, Postgres 17, forced RLS, shamwari key type, usage metering) | _owner statement:_ code, bring-up and restore-drill scripts released to `data-infra` main. **Not deployed**: `nyuchi-ledger` is `pending, deployed: false` on Fly (checked 2026-10-31). The owner runs `bring-up.sh`               | owner, Fly                |
| Nyuchi API `/v1/shamwari`, Console, WorkOS sign-in                                | _owner statement:_ live. Merged to staging, not deployed: citation fields and a locked Ground-ingest route (nyuchi-api), identity sync, sessions API, Console work                                                                 | owner                     |
| Model route (GLM-5.3 on Workers AI via AI Gateway), Data MCP                      | works (owner)                                                                                                                                                                                                                      | owner                     |
| Gateway features                                                                  | extractive rung, reach ceilings, compact envelope, idempotency, SMS/USSD adapter (no operator), cost estimate, scopes, usage replay, end-to-end contract test (#122)                                                               | #85-#97, #122             |
| Billing                                                                           | off. Meter usage and invoice the first ten by hand                                                                                                                                                                                 | CLAUDE.md                 |

Read-only check of `corpus_sources` (Supabase `shamwari_ai_db`, read live on
2026-10-31 and again for #131): 22 rows, 15 approved, 7 unapproved. CLAUDE.md's old
"5 blocked" and "Constitution is the only legal source approved" were stale and are
corrected in #131; the live table is authoritative. Approved
**and** ground-eligible: Constitution, Ministry of Finance (budget), Parliament
(hansard; not mind-eligible), PRAZ (regulation; not mind-eligible), RBZ (policy),
ZIMRA (typed `tariff`), ZIMSTAT, Shona/Ndebele Wikipedia, VOA Shona/Ndebele, the two
Bibles. **Blocked (`is_approved=false`)**: ZimLII, Veritas, AGRITEX, MoHCC/EDLIZ,
ZIMSEC, Zimbabwe Government Publications, Community Contributions.

**What that means for the headline.** The Constitution does not answer tax questions.
The approved ZIMRA row is typed `tariff`, which may not cover the Income Tax Act,
VAT Act or Statutory Instruments. The Acts themselves live on ZimLII and Veritas,
both blocked. So "law and tax answers with citations" needs an owner decision on
what the ZIMRA approval covers and a way to use the Acts. **ZimLII's terms were read on
2026-10-31** (`zimlii.org/terms-of-use/`): the default licence is **CC BY-NC 4.0**,
which forbids commercial use and so conflicts with selling Shamwari; some collections
may carry other licences (each landing page says), and otherwise it needs a written
agreement. Veritas needs a partnership first. Until one of those lands the honest
label is "Constitution and early-access sources", not "Zimbabwean tax".

## 2. The minimum honest v1

Entity: Nyuchi (pays and runs it); Ground stays a Bundu asset. Metric: first cited
answers served, then weekly active askers. Story: a bookkeeper checks a rule on her
phone and sees which Act and section it came from.

### In v1

1. Web PWA, installable, mobile-first, low-bandwidth (R1 chat + R2 Lite from #83).
   Spec and acceptance: #104.
2. Sign in with the Mukoko Account (WorkOS). #105 (owner-gated).
3. Free tier with a per-person monthly cap, metered through the Servers API/ledger
   in the end state; an interim counter in the Chat Worker. **No cap number is set;
   propose one from measured cost** (see §6).
4. GLM-5.3-Flash (economy) default and GLM-5.3 (standard) for hard cases via the AI
   Gateway. Premium (Claude/GPT) stays off.
5. Personal-scope questions refused with the 409 and a plain explanation until Mind.
6. English, Shona, Ndebele UI strings, native-speaker reviewed (#113).
7. A citation on every legal answer, or an honest "not found in my sources". "This
   is not legal advice" on the screen.
8. A public gate: the citation eval (#107) passes a threshold set from a measured
   baseline.

**Cut (not in v1)**: streaming, voice, image, Factory, CLI, MCP server, conversation
sync, sharing, premium tier, semantic cache, self-serve billing, Mind on device,
SMS/USSD (needs an operator quote first). The CLI and MCP server are small once the
API is stable (§3), but they do not block the first user.

**Native apps** (#86): after the web v1 proves the loop. The Expo spike (dev build +
llama.rn on a Go-class Android and an iPhone) is cheap and can start in parallel
because it only needs devices, not the backend. Expo shell for Chat first, Mind
later. ArkTS (HarmonyOS NEXT) waits for an estimate of NEXT devices in Zimbabwe
(none found); AppGallery distribution of the Android build covers most Huawei
phones for the cost of a store listing.

## 3. Critical path

Status 2026-10-31: **nothing on this path is deployed**; every step that creates, sets
or deploys is the owner's.

Constitution ingest in this repo does **not** depend on Core or on a key:
`core/ingest_ground.py` still reads `SUPABASE_DB_URL`, `MONGODB_URI`, `CF_ACCOUNT_ID`
and `CF_API_TOKEN` itself and writes to Mongo directly (checked in the file, which says
the running Core never reads them). _Owner statement, unverified here:_ the first
ingest is meant to go through the Nyuchi API's locked Ground-ingest route instead
(merged to its staging, not deployed), which needs four owner steps: a Postgres login,
the Fly secret `SHAMWARI_CORPUS_DATABASE_URL`, a redeploy of the `nyuchi-ai` Worker and
an ingest key. That secret name does not appear in this repo, so the two paths have not
been reconciled. The official PDF still has to be downloaded in a browser and its terms
read (`docs/ground-ingest.md`). The answer path still needs Core.

```
owner: Core path + secrets ──► Core on Fly (#81) ──► gateway CORE_URL+token ──► key works
                                      │                                         │
                          Constitution ingest (#17) ◄──────────────────────────┘
                                      │
                       first cited answer by curl  (Demo 1; no UI needed)
                                      │
   ┌─────────────────┬────────────────┼──────────────────┬───────────────────┐
 #106 CORS/API    #105 sign-in     #104 PWA          #107 eval harness   #113 prompt+strings
   │                 │                │                  │
   └─────────────────┴────────────────┴────────► baseline ► threshold ► invite-only pilots
                                                                            │
 ZimLII/ZIMRA ingest after owner licence read (#108) ───────────────► "law and tax" label
                                                                            │
                                         #110 Console keys + #109 status ► public
```

**Resolved: the Core path (B).** The owner decided on 2026-10-27 that Core does not
connect to databases itself ("the core doesn't need its own secrets by connecting to the
other fly apps ... the Nyuchi API Fly app already does that"), and #127 built it: Core
holds no database login and reaches Ground, the sink and usage through
`/v1/shamwari/*` on the Nyuchi API with one internal key, over Fly's private network
(`docs/data-api-routes.md`). `core/main.py` no longer uses `motor`, and its old
`/auth/verify` now answers 501 `key_verification_moved`. **Ingest is separate:**
`ingest_ground.py` is an operator tool and still needs its own credentials (above).

Still open from that decision: Workers cannot reach `.internal`, so the Worker reaches
Core either through the Cloudflare Tunnel or the interim public HTTPS with the bearer
token (#81 accepts the latter). That departs from CLAUDE.md's "no public IP": Core
enforces Rule 1 authoritatively, and a leaked `SHAMWARI_CORE_TOKEN` would let a caller
reach Core without the Worker's gate. Mitigations to carry into #81: a token generated
once and never logged, rotation on any suspicion and at launch, every route but
`/health` authenticated (already so), and the tunnel as the first thing after launch,
not the last.

**Auth for Chat (owner, 2026-10-31):** chat users sign in with a Mukoko Account (WorkOS)
token that the gateway verifies; no per-user keys are minted. #130 is the gateway
change (draft, needs the owner's approval); the WorkOS JWT template and the redirect URI
`https://shamwari.ai/chat/callback` are owner steps. Machine and developer keys remain a
separate path, **still undecided**.

**Sizes** are estimates in working days of one agent session, not commitments.

| Step                                   | Owner                      | Size         | Unblocks     |
| -------------------------------------- | -------------------------- | ------------ | ------------ |
| Core path decision + secrets/key       | owner                      | minutes      | everything   |
| Core to nyuchi-api client (B)          | **done** (#127)            | merged       | Core deploy  |
| `fly deploy`, DNS, gateway token (#81) | owner runs, agent prepares | 1 h          | key check    |
| Constitution ingest (#17)              | Core-deploy session        | 0.5 d        | Demo 1       |
| Smoke script (#111)                    | agent                      | 1 d          | safe deploys |
| CORS + API parity (#106)               | agent                      | 2 d          | browser/SDK  |
| Eval harness (#107)                    | agent + practitioner       | 3-5 d        | public gate  |
| Chat Worker + sign-in (#105)           | agent; owner decides       | 3 d          | PWA          |
| PWA (#104)                             | Chat session               | 5-8 d        | users        |
| Prompt + strings (#113)                | agent + speakers           | 2 d + review | trust        |

## 4. Tooling holding release back

Sequenced by value. "Revenue" means what a paying customer gets from it.

| #   | Tool                                                      | Issue                    | Owner                         | Size | Unblocks                                                       | Revenue it unlocks                                                |
| --- | --------------------------------------------------------- | ------------------------ | ----------------------------- | ---- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Core deploy + smoke test                                  | #81, #111                | owner + agent                 | S-M  | everything                                                     | none directly; no revenue without it                              |
| 2   | Ingest + corpus review tooling                            | #108, #17, #18           | agent; owner approves sources | M    | cited answers beyond the Constitution                          | the compliance pilots (tax/regulatory answers)                    |
| 3   | Citation evaluation/regression harness                    | #107                     | agent + practitioner          | M    | public gate, extractive threshold (#83.10), model choice (#78) | trust; the claim "cites the Statutory Instrument"                 |
| 4   | Gateway browser access + API parity                       | #106                     | agent                         | S    | PWA, SDKs, developers                                          | developer tier                                                    |
| 5   | Sign-in + cap                                             | #105                     | owner decides                 | M    | consumer Chat                                                  | community stays free; cap protects cost                           |
| 6   | Key issue/revoke + usage in the Console, hand-invoice CSV | #110                     | Nyuchi Console team/agent     | M    | first customers                                                | invoicing the first ten                                           |
| 7   | Observability, alerts, status page                        | #109                     | agent                         | M    | operating without fear                                         | SLA conversations (Business tier)                                 |
| 8   | Release automation                                        | #111                     | agent                         | S    | repeatable deploys                                             | none directly                                                     |
| 9   | Pilot kit + usage report                                  | #112                     | agent + owner                 | S    | onboarding                                                     | the first ten                                                     |
| 10  | CLI                                                       | new, sprint 2            | agent                         | S    | developers in terminals                                        | developer tier                                                    |
| 11  | MCP server                                                | new, sprint 2            | agent                         | S    | agents (Claude, Cursor) read cited law                         | developer/Business                                                |
| 12  | Factory prerequisites (sandboxes, Kimi code model route)  | #78, CLAUDE.md sandboxes | later                         | L    | paid coding agent                                              | later; rule 1 blocks Cloudflare Containers for personal artifacts |

Not in this list on purpose: Rust rebuild (#66), new architecture. Sandboxes and
Factory stay in the "deliberately not in this phase" list.

## 5. Dependency map

| Repo / system                                                         | Live                                            | Merged, not deployed                                                                                                           | Missing                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `shamwari` (this repo): gateway                                       | Worker deployed (`/health` checked 2026-10-31)  | seam, scopes, cost estimate, replay, CORS (#124), no-content chat channel (#125)                                               | error shape, `/v1/models`, `/v1/usage`; WorkOS path (#130, draft)     |
| `shamwari` core/                                                      | no                                              | Dockerfile, fly.toml, replay, nyuchi-api client (#127), runbook (#117)                                                         | image never built; Fly app and secrets (owner); deploy                |
| `shamwari` site/                                                      | `www.shamwari.ai`                               | Chat shell, thread, citations (#116, #119)                                                                                     | Chat release; WorkOS redirect; status page                            |
| `shamwari-core`, `-gateway`, `-platform`, `-sandbox`, `-mind`, `-web` | empty scaffolds (per #61, #66)                  |                                                                                                                                | decide which are real; Rust (#66)                                     |
| `nyuchi-api`                                                          | `/v1/shamwari`, Console, WorkOS sign-in (owner) |                                                                                                                                | internal key for Core; Shamwari key issue/revoke UI                   |
| `nyuchi-servers-api`                                                  |                                                 | merged to staging, in-memory KeyStore (owner)                                                                                  | durable ledger stores (being built, owner); first Fly app             |
| `data-infra` ledger                                                   |                                                 | code, bring-up and restore-drill scripts on `data-infra` main (owner); `nyuchi-ledger` Fly app pending, not deployed (checked) | **deploy** (about $49.62 a month, owner figure); key migration phases |
| Atlas `shamwari.knowledgeBase`                                        | indexes READY                                   |                                                                                                                                | content (count 0, checked 2026-10-31)                                 |
| Supabase `shamwari_ai_db`                                             | schema, 22 sources seeded                       |                                                                                                                                | long-term move to ledger `shamwari` schema                            |
| Workers AI / AI Gateway route                                         | GLM-5.3 and Flash                               |                                                                                                                                | #53 drift check; remove stray Anthropic key (#78)                     |
| WorkOS (Mukoko Account)                                               | live (owner)                                    |                                                                                                                                | JWT template and redirect `https://shamwari.ai/chat/callback` (owner) |

## 6. Revenue path (owner's terms)

"Meter usage now, invoice the first ten customers by hand. You want to be talking to
them anyway." Entity: **Nyuchi Africa** sells (Developer/Business tiers, USD or ZiG).
**Shamwari community Chat stays free** and sits with Bundu; Nyuchi's surplus flows to
Bundu. Fundraising is for scale, not for this.

**Who** (hypothesis to test in conversations): Zimbabwean tax and regulatory
compliance firms: accountants, bookkeepers, company-secretarial practices, small law
firms, and in-house finance teams at SMEs. Why them: being wrong costs money, rules
change monthly, global models are stale, and they already spend on consultants
(`docs/architecture-and-gtm.md` §7). Positioning to test: "Shamwari cites the
Statutory Instrument."

**What they would pay for** (to confirm, not assume): a cited answer they can forward
to a client; a weekly digest of what changed (needs the refresh pipeline and a
practitioner-approved corpus); API/MCP access for their own tools; an SLA and usage
reports (Business).

**Price: no figure is fixed.** What exists is arithmetic from assumptions.

- Cost per answer, _assumed_ 3,000 input and 400 output tokens, prices from
  `gateway/pricing.json` (Cloudflare list prices retrieved 2026-10-29, an upper bound,
  embedding and retrieval excluded): economy about $0.00065, standard about $0.006.
- At _assumed_ 30 answers per person per month (no usage data exists yet): economy about $0.02, standard about $0.18. So
  the owner's $0.20 per active user per month target (#83) holds only if most traffic is economy; an
  all-standard free tier would spend nearly the whole budget on inference alone.
- Fixed cost known: the ledger at about $49.62 a month (owner). Core on Fly, Atlas,
  Supabase, WorkOS and Cloudflare are not priced here.
- Break-even is a function of a price nobody has asked for yet. Any monthly price P
  per firm needs `49.62 / (P - variable cost)` firms to cover the ledger alone. Do
  not pick P from this document; ask three pilots what they pay a consultant for the
  same question and what a missed deadline costs them.

**Sequence**: (1) pilots free for 60 days, weekly call, practitioner reviews 20
answers each; (2) from the notes, write three price shapes (per seat, per question
bundle, per firm with an SLA) and test them; (3) invoice by hand from
the usage report (`scripts/pilot_report.py`, **to be built in #112**; until then Core
`/rollup/by-tier` by hand; estimate, not billing-grade); (4) only then consider
self-serve billing. MXT-denominated billing stays an open question
(`docs/architecture-and-gtm.md` §3).

## 7. Communications

**Principle.** Service and community storytelling: who was helped and how, not
persuasion. Every story comes from a real conversation, with permission. No invented
testimonials, no unmeasured accuracy claims.

**First narrative (draft, to be replaced by a real story).** "Most Zimbabweans who ask
what the law says get a rumour. Shamwari answers from the text and shows you the
section, in your language, on the phone you already have." Then one named, consented
example: the person, the question, the source they were shown, what they did next.

### Audiences and channels

| Audience                                      | What helps them                                         | Channel                                                                                                                 | Entity voice                           |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Accountants, bookkeepers, company secretaries | cited rules, change alerts                              | direct outreach and the pilot call; LinkedIn; ICAZ-style member bodies (to be approached, no relationship assumed here) | Nyuchi                                 |
| Lawyers                                       | primary-source retrieval, not advice                    | same; be explicit that it is not legal advice                                                                           | Nyuchi                                 |
| Students                                      | plain-language explanation of the Constitution and Acts | the free PWA; universities (UZ ALRI partnership is already a goal)                                                      | Shamwari/Bundu                         |
| Farmers                                       | when to plant, prices, extension advice                 | AgriConnect, WhatsApp/USSD (R0) once an operator exists                                                                 | Nyuchi data layer; Bundu for open data |
| Developers                                    | OpenAI-shaped API, MCP                                  | docs.shamwari.ai, Nyuchi API                                                                                            | Nyuchi                                 |
| Everyone                                      | the Mukoko app, shamwari.ai                             | Mukoko in-app entry, shamwari.ai                                                                                        | Mukoko/Shamwari                        |

R0 (SMS/USSD) has no operator quote and no payer for channel fees, so it is a
promise we do not make yet. WhatsApp needs a business-API provider (open decision).

**Safe to say now**: Shamwari answers from Zimbabwean sources and shows the source;
we use open-weights models (GLM) and route them; we train Shamwari Mind and route
Shamwari Cloud; personal data stays on your device with Mind and is never sent to
Cloud (Mind not shipped: say "will", not "does"); sovereignty attaches to Mind and
Ground only.
**Not safe**: "open source model"; "your data stays in Africa" for Cloud; "we built
our own model"; any accuracy or speed number not from the eval; "legal advice";
fluency in Shona/Ndebele before native review; that tax is covered before it is.

Site labels move from Planned/Building to Live only when the smoke test passes on the
live URL. `site/claims.mjs` guards the wording.

## 8. Owner-only steps (exact commands)

Run by the owner (or by an agent only with the named yes). Values never go in the
repo or issues. All assume `fly` and `wrangler` are logged in to the right account.

**A. Core on Fly (#81)**, from `core/` on `staging` after the Core change merges:

```bash
fly apps create shamwari-core --org nyuchi-web-services
# Path B (nyuchi-api): names set by the Core PR; one internal key from the Console
#   (scopes shamwari, shamwari:service, ai), plus the bearer token below.
# Path A (direct, interim): MONGODB_URI SUPABASE_DB_URL CF_ACCOUNT_ID CF_API_TOKEN
TOKEN="$(openssl rand -hex 32)"
fly secrets set -a shamwari-core SHAMWARI_CORE_TOKEN="$TOKEN"   # + path secrets
fly deploy -a shamwari-core --remote-only
curl -fsS https://shamwari-core.fly.dev/health
```

**B. DNS and gateway.** `CORE_URL` in `gateway/wrangler.jsonc` is
`https://core.shamwari.ai`: `fly certs add core.shamwari.ai -a shamwari-core`, add the
CNAME/A records `fly certs show` prints, then

```bash
cd gateway && printf %s "$TOKEN" | npx wrangler secret put SHAMWARI_CORE_TOKEN
npx wrangler deploy
# once #111 merges (scripts/smoke.sh does not exist yet); point it at the
# workers.dev URL wrangler prints:
bash scripts/smoke.sh "https://shamwari-gateway.<account>.workers.dev" "$SHAMWARI_KEY"
```

Note: `api.shamwari.ai` is the owner's decision of 2026-10-28 but no route or custom
domain is in `wrangler.jsonc`; binding it is a separate owner step (zone route, then
re-run the smoke test against it).

**C. The Constitution (#17).** Needs the four ingest credentials above, not a key. The
text file is not in the repo (`constitution-2013.txt`): obtain the official text from
a source whose terms have been read (the Constitution row is approved), keep it out of
git unless the licence allows it, and check the section count against the published
document before ingesting.

```bash
cd core && python ingest_ground.py --source "Constitution of Zimbabwe" \
  --file ./constitution-2013.txt --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 --effective-from 2013-05-22 --dataset zw-law-v1
```

**D. Ledger deploy (about $49.62 a month)** from the `data-infra` repo's own runbook
(not visible here). Then in this order, each phase on the owner's named yes
(`docs/api-key-migration.md`): 1 dry run, 2 backfill, 3 reconcile, 4 shadow, 5
cutover on the first of a month UTC, 6 close the window. Gateway side:

```bash
cd gateway
npx wrangler secret put SERVERS_API_TOKEN
npx wrangler secret put SERVERS_API_INTERNAL_KEY
# set SERVERS_API_URL, then SERVERS_API_ENABLED="true" (the flag flip is the cutover)
```

Core usage replay: `SHAMWARI_OPS_TOKEN`, `SERVERS_API_URL`, `SERVERS_API_TOKEN`,
`SERVERS_API_INTERNAL_KEY` on Fly, the Mongo replay index (`docs/usage-replay.md`),
and a schedule for `/replay/usage`.
**E. Decisions only the owner can make**: Core path (A or B); Chat auth option (#105);
what the ZIMRA approval covers; ZimLII terms; free-tier cap; extractive-turn metering;
WorkOS app; Shona/Ndebele reviewers and a practitioner reviewer; operator for
USSD/SMS; tagline; who the first ten are.

## 9. Sprint 1 (this plan's first moves)

| Issue    | What                              | Claim                |
| -------- | --------------------------------- | -------------------- |
| #81, #17 | Core deploy + Constitution ingest | Core-deploy session  |
| #104     | Chat v1 spec and PWA              | Chat session         |
| #105     | Sign-in and cap (owner-gated)     | decision first       |
| #106     | Browser access + API parity       | open                 |
| #107     | Eval harness                      | open                 |
| #108     | Corpus review/ingest tooling      | open                 |
| #109     | Observability + status            | open                 |
| #110     | Console keys + usage (cross-repo) | open                 |
| #111     | Release automation + smoke test   | open                 |
| #112     | First-ten kit                     | open                 |
| #113     | Legal-answer policy + strings     | open                 |
| #114     | Story kit + claims                | open, owner approves |

Sprint 2: CLI, MCP server, Expo spike and shell (#86), Ground packs and PWA offline
(#83.5), channel-webhook findings from #83's design review (chunked-body size bypass
first), AgriConnect first dataset (#87), key-migration phases.

Rules the loop keeps: Rule 1 and 2 on every endpoint; no claim without a
measurement; ticks never publish, merge or deploy without a named yes; each report
ends with "Needs you:".
