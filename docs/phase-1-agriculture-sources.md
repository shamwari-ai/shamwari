# Phase 1 (agriculture): official sources, terms and proposed flags

Tracking: #148. Read on **2026-11-01**. Related: #87.
**Read-only.** Nothing was ingested, no database was written, no `is_approved`
flag was changed, and no one was contacted. Every flag below is a **proposal**;
approving a row and flipping `is_approved` is the owner's step.

Scope is the owner's decision of 1 Nov 2026: phase 1 is agriculture; law
(Constitution, ZimLII, Veritas, Parliament) is phase 2 and is not touched here.
Primary publishers are preferred over aggregators. `zimdata.org` is an
aggregator, used only to find leads (see the end).

Firecrawl credits used: **about 66** (18 on searches, 16 on 16 single-page
scrapes, 32 on one 32-page PDF, which ignored the page cap I asked for).

## How to read the flags

- `ground_eligible` means: retrieved, cited and linked out, as scraped news already
  is. It is not a licence to republish the full text.
- `mind_eligible` is a generated column (`license_class = 'open_weight'`). Every
  row here is proposed **`restricted`**, so **NO**: none of these terms grants
  derivative or training use, and CLAUDE.md rule 2 is not relaxed.
- **Silence is not permission.** Where a site states nothing, the row says so and
  proposes `ground_eligible = false` until the publisher says yes in writing. One
  short email per publisher turns most of these into yes (drafts at the end).

## Decision table

| #   | Source (verified to exist)                                                                                                             | Language / format / cadence                                                                                                                                                                                                                                                                                                       | Terms found (quoted, URL, read 2026-11-01)                                                                                                                                                                                                                                                                                                                                                                                          | Proposed flags                                                                                                                                                                                                                                                            | Numbers or narrative                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Meteorological Services Department (MSD)**, `weatherzw.org.zw`                                                                       | English; Shona, Ndebele and Tonga editions of the seasonal outlook exist (2025/26 titles "2025-2026 MAMIRIRO EMWAKA WEMVURA", "ISIMO SOMNYAKA WEZULU", "BWIIME BWAMVULA"). HTML summary plus PDF. Seasonal outlook once a year with a September-November update; weekly rainfall, dekadal agromet and seasonal monitor bulletins. | **None stated.** `/robots.txt` returns 404; `/privacy-policy/` returns 404; the 20 links on the home page include no terms, copyright or data-policy page. Site footer text not shown on the pages read.                                                                                                                                                                                                                            | `ground_eligible` **false until MSD agrees in writing** (recommend asking first: highest farmer value, and its own Shona text means no translation risk). `mind_eligible` NO. `license_class` restricted.                                                                 | Bulletins: **numbers** (rainfall by station/dekad) behind the Servers API; outlook text and translations: **narrative**, Ground.      |
| 2   | **ZIMSTAT**, `zimstat.co.zw` (Production Division, agriculture statistics)                                                             | English. PDF reports: Post-Harvest Survey 2024/25 (Sept 2025), Crops, Livestock and Fisheries Reports round 1 and 2 (2025), Food Balance Sheets (2021-24, 2025), quarterly Milk and Meat reports (Q1, Q2 2026). Annual and quarterly.                                                                                             | "Unless otherwise stated, the material or information published within the Zimbabwe National Statistics Agency Website is ZIMSTAT copyright.." (`zimstat.co.zw/copyright-disclaimer-and-privacy-policy/`). No reuse licence is given. `robots.txt`: `User-agent: *` / `Disallow:` (nothing disallowed).                                                                                                                             | `ground_eligible` **true, cite and link out**, consistent with the existing approved ZIMSTAT row in `corpus_sources` (`docs/launch-plan.md`). **Owner to re-confirm** that approval for commercial use, because the notice is a bare copyright claim. `mind_eligible` NO. | **Both.** Tables (production by crop, province, sector) are numbers for Servers API routes; the report prose is narrative for Ground. |
| 3   | **Ministry of Lands, Agriculture, Fisheries, Water and Rural Development**, `agric.gov.zw`                                             | English. News and announcements in HTML, many as WhatsApp-style images; no publications or extension-guide section found on the home page. Daily to weekly news.                                                                                                                                                                  | Footer: "Copyright (C) 2023. Ministry of Agriculture, Mechanisation & Water Resources Development. All rights reserved." No terms page found; `/robots.txt` returns the home page, not a robots file.                                                                                                                                                                                                                               | `ground_eligible` **false (hold)**: all-rights-reserved with no licence. Link-out only; ask. `mind_eligible` NO.                                                                                                                                                          | **Narrative** (news, announcements). Low structure.                                                                                   |
| 4   | **AGRITEX** (extension service, part of the Ministry)                                                                                  | No separate AGRITEX site found. Searches turned up no current AGRITEX guide or crop budget on an official site. The one crop-budget hit is an old FAO-hosted "guide to maize marketing" quoting AGRITEX budgets (FAO, not AGRITEX).                                                                                               | None to read: nothing published by AGRITEX itself was found.                                                                                                                                                                                                                                                                                                                                                                        | `ground_eligible` **false** (nothing to ingest yet). **Partnership approach needed** (draft below). Any pesticide, dosage or animal-health content needs human review before Ground.                                                                                      | Would be **narrative** (guides) plus **numbers** (crop budgets).                                                                      |
| 5   | **Grain Marketing Board (GMB)**, `gmbdura.co.zw`                                                                                       | English. The "Producer Prices" page (modified 10 Oct 2026) is **images only** (JPEG posters); no text, no table. Ad hoc, per marketing season.                                                                                                                                                                                    | Only a cookie/privacy policy is linked (`gmbdura.co.zw/privacy-policy/`); **no reuse terms**. `robots.txt`: only `/wp-admin/` disallowed.                                                                                                                                                                                                                                                                                           | `ground_eligible` **false until GMB agrees**. A producer price is a fact, but the poster is theirs. `mind_eligible` NO.                                                                                                                                                   | **Numbers**: keyed by a person from the poster into a Servers API route, citing the image URL and date. Not parseable by script.      |
| 6   | **Agricultural Marketing Authority (AMA)**, `ama.co.zw`                                                                                | English. "Market Commodity Price" posts: min/max USD per kg at Mbare, Sakubva and Renkini for ~15 horticulture lines, as text; plus "Bulletins" (page not read). **The post I read is dated 8 Nov 2025: a year stale** (URL slug 2021, modified 12 Nov 2025).                                                                     | **None found** on the page read. `robots.txt`: only `/wp-admin/` disallowed.                                                                                                                                                                                                                                                                                                                                                        | `ground_eligible` **false until AMA agrees**; ask for the current bulletin feed. `mind_eligible` NO.                                                                                                                                                                      | **Numbers**, behind the Servers API, with `asOf` shown on every answer.                                                               |
| 7   | **Zimbabwe Mercantile Exchange (ZMX)**, `zmx.co.zw` (the commodity-exchange equivalent; a private exchange, not a government body)     | English. Home-page ticker, USD/kg, about 15 grains and oilseeds (maize 0.37, wheat 0.46, soyabean 0.60 on the day read); weekly auction results; a mobile app.                                                                                                                                                                    | **Not read** (no terms link on the home page). `robots.txt` returns 404.                                                                                                                                                                                                                                                                                                                                                            | `ground_eligible` **false**; commercial price data, so expect a licensing conversation. `mind_eligible` NO.                                                                                                                                                               | **Numbers**, Servers API only if licensed.                                                                                            |
| 8   | **ZimVAC** (published through the Food and Nutrition Council, `fnc.org.zw/documents/`)                                                 | English PDFs: rural livelihoods assessments 2003-2023 (national and per province), urban assessments; the 2024 ZimLAC report is hosted by UNICEF. Annual (June-July fieldwork).                                                                                                                                                   | **None found** on the pages read (no terms link among the home-page links). FNC `robots.txt` could not be fetched (connection reset). UNICEF's terms for the 2024 report were not read.                                                                                                                                                                                                                                             | `ground_eligible` **false until FNC agrees**. `mind_eligible` NO. Food-security figures are used for planning, so cite the year on every answer.                                                                                                                          | **Both**: tables (food insecurity by province) and narrative.                                                                         |
| 9   | **FEWS NET**, `fews.net`                                                                                                               | English. Monthly outlooks and alerts; Zimbabwe El Nino special report (Oct 2026). Monthly.                                                                                                                                                                                                                                        | "FEWS NET publishes all data according to permissions provided by the original source institution, and all data sources are fully attributed." and "Some data are provided by third parties, and may not be redistributed or reused without the consent of the original data provider" (`fews.net/data-attribution`). **`robots.txt` has `Disallow: /` for AI/LLM crawlers including `ClaudeBot`, `GPTBot` and `CCBot`.**           | `ground_eligible` **true for citation and link-out with the required attribution, but do not crawl the site**: robots forbids it. Use the FEWS NET Data Warehouse/API or write to `data.policy@fews.net`. `mind_eligible` NO.                                             | **Both.** Outlook text: narrative; indicators via the warehouse: numbers.                                                             |
| 10  | **FAO** statistical databases (FAOSTAT, GIEWS FPMA, DIEM)                                                                              | English. Machine-readable datasets, updated on FAO's schedules.                                                                                                                                                                                                                                                                   | "all datasets disseminated through FAO corporate statistical databases ... are licensed under the Creative Commons Attribution-4.0 International licence (CC BY 4.0)" **and** "Datasets shall not be used for or in conjunction with the promotion of a commercial enterprise and/or its product(s) or services (s)" (`fao.org/contact-us/terms/db-terms-of-use/en/`). Third-party data inside FAO databases may carry other terms. | `ground_eligible` **conditional**: CC BY 4.0 is open, but the commercial-promotion clause needs a lawyer's reading against selling Shamwari. `mind_eligible` NO until that is settled.                                                                                    | **Numbers** (Servers API, with the citation format FAO prescribes).                                                                   |
| 11  | **National Agriculture Policy Framework 2019-2030** (Ministry)                                                                         | English PDF. The copy found is a mirror (HarvestPlus); the Ministry's own URL was not found.                                                                                                                                                                                                                                      | None: mirror host's terms not read, the Ministry's notice is "All rights reserved" (row 3).                                                                                                                                                                                                                                                                                                                                         | `ground_eligible` **false** until the Ministry copy and permission are in hand.                                                                                                                                                                                           | **Narrative.**                                                                                                                        |
| 12  | **Tobacco Industry and Marketing Board (TIMB)** `timb.co.zw`, **Directorate of Veterinary Services** (Facebook only; no website found) | Not assessed beyond existence. TIMB's certificate failed verification from this environment (I did not bypass it). DVS posts livestock-disease notices on Facebook.                                                                                                                                                               | **Not read.**                                                                                                                                                                                                                                                                                                                                                                                                                       | Not proposed. **DVS: animal-health content needs human review (clinical/safety rule) before any Ground use.**                                                                                                                                                             | Not assessed.                                                                                                                         |

**Not found or not checked in this run:** Cotton Company, Horticultural Development
Council, Kutsaga Research, Zimbabwe Parks/EMA, WFP VAM, IPC country page, FAO GIEWS
country brief. They remain candidates; no terms were read for them.

## Sample answers (what a farmer would see)

Each sample uses only what the page said. "Unverified" lines were written by the
model and must not ship.

**1. Rain outlook (MSD, scraped `weatherzw.org.zw/products/seasonal-forecast/2026-2027-seasonal-forecast/`)**

> The Met Services Department expects below-normal rain this season (2026/27)
> because of El Nino, and a very erratic start: a large part of the country may
> see no effective onset, and October to December 2026 is expected to be drier
> than normal in every province. Talk to your AGRITEX officer before you plant.
> _Source: MSD, "2026-2027 Seasonal Forecast (National Climate Outlook)", 1 Oct 2026._

chiShona: **unverified, do not ship.** `Mvura inotarisirwa kuva shoma kupfuura yakajairika mwaka uno, uye kutanga kwayo kunogona kusava nechokwadi.` MSD publishes its own Shona edition of the outlook (2025/26: "MAMIRIRO EMWAKA WEMVURA"); ingest that text instead of translating.

**2. National production (ZIMSTAT, scraped from the Post-Harvest Survey 2024/25 PDF)**

> Mashonaland West grew the most maize in 2024/25: about 393,058 tonnes, 21.6% of
> the national 1,819,819 tonnes. Communal areas produced about 44% of all maize.
> _Source: ZIMSTAT, 2024/25 Post-Harvest Survey Report (Sept 2025), Tables 3.4 and 3.5._

Extraction is not safe unattended: in the same report Table 3.7 prints the
national soya bean total as `7,750` while Table 3.2 gives `57,750`; Table 3.6
prints an A1 pearl millet figure as `3,6259`; the text says "2025/25". Numbers
from PDFs need a human check against the table before they reach a route.

**3. Market prices (AMA, scraped `ama.co.zw/market-commodity-price-28-09-2021-3/`)**

> The last AMA price I can see is from 8 November 2025: potatoes at Mbare were
> US$0.45 to US$0.55 a kg. That is a year old, so please check today's price
> with AMA or at the market before you sell.
> _Source: AMA, "Market Commodity Price", as at 8 Nov 2025._

This sample is the freshness rule in action: a price answer must carry its date
and refuse to present an old price as current. GMB's producer price page is
images only, so there is no scraped sample (see row 5).

## Numbers behind the Servers API, narrative in Ground

| Goes behind Servers API data routes (numbers, `asOf` required)                                                                                                                                                              | Goes into Ground via `POST /v1/shamwari/ground/ingest` (narrative, chunked with citation)                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AMA market prices; ZMX commodity prices (if licensed); GMB producer prices (hand-keyed from posters); MSD rainfall and dekadal values; ZIMSTAT production tables and food balance sheets; FAO and FEWS NET indicator series | MSD seasonal outlook and its Shona/Ndebele editions; MSD agromet narrative; ZIMSTAT report prose; ZimVAC reports; Ministry policy documents once licensed; AGRITEX guides once licensed |

The Atlas `agriculture.datasets` collection (13 entries) is where the earlier run
recorded the numeric side. **I could not read it:** the read-only data tool in
this session lists only the platform domain databases, and `agriculture` is not
one of them. Cross-check this table against that collection before approving.

## Aggregator leads (not sources)

`zimdata.org` (`robots.txt` allows everything except `/dashboard`, `/auth/callback`
and `/api`) lists 9 agriculture datasets, for example FAOSTAT fertilizer use
(CC-BY-4.0) and CHIRPS subnational rainfall indicators (CC-BY-4.0). Its
"licence-reviewed" label was not relied on. Go to each original publisher for
the terms.

## Draft message for the owner to send (AGRITEX, the Ministry, MSD)

Nobody at the Ministry is named on the pages read. The site shows two addresses
(`agriccommunications@gmail.com`, `agricpermsec@gmail.com`; the home-page links to
them are malformed), so address it to the **Permanent Secretary**, copy the
**Director of AGRITEX**, and confirm the addresses first. For MSD, address the
**Director, Meteorological Services Department**, via the site's contact page.
Do not send from this session.

> Subject: Permission to cite your published agricultural information in Shamwari, a free farmer assistant
>
> Shamwari is an AI companion, built by the Bundu Foundation and operated with
> Nyuchi Africa, that answers farmers' questions in English, chiShona and isiNdebele.
> We would like to answer from your published material (seasonal outlook, bulletins,
> price notices, extension guides) and always show the farmer the source, the date
> and a link back to you. We would not alter your content or present it as ours,
> and we would not use it to train models. Could you confirm in writing that we may
> quote and link to these publications, and tell us whom to contact when a
> bulletin is updated? We would be glad to share what farmers ask most, so you can
> see where your information is reaching people.

## What was not touched

No database, no `is_approved`, no ingest, no outreach, no change to CLAUDE.md or
any other doc. Stale phase-order lines are listed in #148 for a separate change.
