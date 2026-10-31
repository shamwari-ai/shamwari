# Core and the Nyuchi API: what exists, what is missing

Owner decision, 2026-10-27 (#81): **Core holds no database login; only the Nyuchi API
talks to databases.** Core reaches data through `/v1/shamwari` on the API
(nyuchi/nyuchi-api#393, `gateway/routers/shamwari.py`) over Fly's private network, with
one internal key. Client: `core/nyuchi_api.py`. This page maps every Mongo call Core
used to make to a route, and specifies the routes that are missing so the API side can be
built. The API repo is not writable from here.

The owner checked 2026-10-31: `platform.apiKeys` holds 3 documents, all `internal` with
`nyk_` prefixes, and **no `sk_shamwari_` key**.

## What Core used to do in Mongo, and where it goes

| Core route                                            | Mongo calls it made                                                           | Now                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /ground/search`                                 | `shamwari.knowledgeBase.aggregate`, `groundMisses.insert_one`                 | `POST /v1/shamwari/ground/search` (exists). The API logs the miss, and omits the question for personal scope. |
| `GET /guardrails`                                     | `shamwari.guardrails.find`                                                    | `GET /v1/ai/guardrails?applies_to=` (exists, scope `ai`). Shape is `{platform, entity}`, not `{rules}`.       |
| `POST /sink/bulk`                                     | `insert_many` on six collections                                              | `POST /v1/shamwari/sink` (exists). Content-derived ids make a retry a counted duplicate.                      |
| `GET /rollup`                                         | `platform.usageEvents.aggregate`                                              | `GET /v1/shamwari/usage/rollup` (exists).                                                                     |
| `GET /health`                                         | `admin.command("ping")`                                                       | `GET /v1/shamwari/whoami` with Core's key (exists). Readiness means "the API answers my key".                 |
| `POST /auth/verify`                                   | `platform.apiKeys.find_one`, `entity.entities.find_one`                       | **G1**. Core answers 501 `key_verification_moved`; the Worker denies.                                         |
| `GET /rollup/by-tier`                                 | `usageEvents.aggregate` (by reach, tier, path)                                | **G3**. Core answers 501.                                                                                     |
| `POST /replay/usage`, `/requeue`, `GET /replay/stats` | `usageEvents` find, `update_many`, `count_documents`                          | **G4**. Core answers 501.                                                                                     |
| `ingest_ground.py`                                    | `knowledgeBase` insert, update, count; Postgres `documents`, `corpus_sources` | **G5**. A one-off from a trusted machine until then.                                                          |

What Core keeps, and why: `resolve_scope` and the embedding refusal run **before** a call,
so a refused request makes zero data calls (counted in `core/test_core_routes.py` and in the
end-to-end test). Core checks the scope of what comes back (a cloud answer holding any
non-cloud-safe chunk becomes a 503). The sink batch is checked against the provenance rules
before it is forwarded. The API checks the same again: three checks, because a decision nothing
downstream is obliged to read is a comment, not a control.

What moved out of Core's tests: the owner, `supersededBy` and `isActive` filters on both
retrieval pipelines are the API's now, and are tested in nyuchi-api (`tests/test_shamwari.py`:
`test_platform_scope_searches_only_the_shared_corpus_on_both_pipelines`,
`test_the_lexical_pipeline_is_owner_filtered_before_it_is_limited`, and neighbours). The
end-to-end test's API is a stand-in and says so.

## The gaps, as route specs

All service routes: internal key scoped `shamwari:service` (beside `shamwari`), `Cache-Control:
private, no-store`, the shared `shamwari_service_limit` bucket (6000 a minute), a body with
`extra="forbid"`, the whole request validated before anything is written.

### G1. Customer authentication (decided: WorkOS-first, 2026-10-31)

**Superseded.** This section used to offer options A (the Worker sends the customer's own key to
`whoami`) and B (`keys/verify`). The owner has decided that people authenticate with **WorkOS
AuthKit access tokens**, which the gateway verifies offline against the WorkOS JWKS. No
customer-key route is needed on the API for people, and Core still never sees a credential. See
`docs/chat-signin.md`.

What is still open:

- **Machine callers** keep `sk_shamwari_` keys through the gateway's existing `KeyService` seam,
  unchanged, until the machine-key path is decided (WorkOS API keys are organisation-scoped, so
  they fit B2B keys and not per-person ones).
- **G6** below: WorkOS callers are metered on the canonical person id, which is the owner id the API
  already uses, so no special case is needed.
- `/auth/verify` stays 501 `key_verification_moved`.

### G2. Citation fields (small, unblocks nothing but polish)

`ground_pipeline`'s `$project` and `chunk_view` should also return `section` and `citation`
(both strings, absent on older chunks). The ingest writes them (`core/ingest_ground.py`). Today
the answer carries the section only inside `heading` ("s 56 Equality ..."), which is enough for
the gateway to cite it.

### G3. Per-tier usage report

`GET /v1/shamwari/usage/by-tier?owner_entity_id=<id>&billing_period=YYYY-MM`, same validation as
`usage/rollup`. Group `platform.usageEvents` on `ownerEntityId + billingPeriod` by
`{reach (null -> "none"), routedTier (null -> tier), inferencePath (null -> "unknown")}` and
return `{"estimate": "<note: derived, never billing-grade>", "rows": [{reach, routed_tier,
inference_path, requests, input_tokens, output_tokens, cost_usd_estimate, unpriced_requests}]}`.
The pipeline and shape are `core/telemetry.py` (`by_tier_pipeline`, `shape`).

### G4. Spilled-usage replay

Replay delivers usage events that the Worker could not send to the Servers API (they were spilled
to the sink). It matters only once `SERVERS_API_ENABLED` is on. Prefer to run it **inside the
API**, which owns both stores, and drop it from Core. If it stays a Core job it needs:

- `GET /v1/shamwari/usage/spilled?limit=<1..500>`: rows with `spilled: true` and neither
  `replayedAt` nor `replayRejectedAt`, ordered `createdAt, _id`.
- `POST /v1/shamwari/usage/spilled/mark {"ids": [...], "outcome": "sent"}` and
  `{"id": ..., "outcome": "rejected", "reason": "<short>"}`: sets `replayedAt` or
  `replayRejectedAt` + `replayRejectedReason`. Rows are marked, never deleted.
- `POST /v1/shamwari/usage/spilled/requeue`: clears `replayRejectedAt` on rejected spilled rows;
  returns `{"requeued": n}`.
- `GET /v1/shamwari/usage/spilled/stats`: `{pending, oldest_pending_age_seconds, rejected}`.

Core's `replay.py` keeps its logic and its tests; only the store behind it changes.

### G5. Ground ingest through the API (so nobody holds Atlas or Supabase credentials)

A separate scope, `shamwari:ground:write`, on a key held by the operator and **not** by Core:

- `POST /v1/shamwari/ground/documents`, body fields: `slug`, `title`, `source_name`,
  `effective_from`, `dataset`, `replace` (bool) and `chunks`, each chunk carrying `ordinal`,
  `heading`, `content`, `section`, `sectionTitle`, `subsections`, `chapter`, `citation` and
  `kind`. Server side, in one unit: refuse unless the named `corpus_sources`
  row is `is_approved` and `ground_eligible`; stamp `licenseClass` from its `mind_eligible`;
  **embed each chunk with bge-m3 itself** (so the operator needs no Workers AI token, and the
  1024-dimension check lives in one place); write the audit row and the chunks atomically; on
  `replace`, retire the old chunks softly (`isActive=false`, `supersededBy`) only after the new
  ones are in; refuse an active `slug` without `replace`.
- `POST /v1/shamwari/ground/documents/{slug}/retire`: soft retire.
- Rate limit: tight (a handful a minute); this is an operator route.

Until then `core/ingest_ground.py` runs from a trusted machine with four credentials
(`docs/core-fly-runbook.md`). It is **not** a Core secret.

### G6. Owner id (related to G1)

The API says the `owner_entity_id` in a search is asserted by the holder of Core's service key,
not proven per end user. When the Worker authenticates each customer (G1), Core should derive the
owner from that result and not from the request body. Today Core trusts the Worker's token.
