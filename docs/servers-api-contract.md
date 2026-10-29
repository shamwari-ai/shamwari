# Servers API contract for Shamwari

What the Shamwari gateway needs from the Nyuchi Servers API to take over
API-key verification and usage metering from Core. Code: `gateway/src/keys.ts`.
Contract tests (against a fake): `gateway/test/keys.test.ts`. Tracking: seam
issue, under #83.

The Servers API implementation is **off by default** (`SERVERS_API_ENABLED=false`).
Core and the sink queue remain the live path until the owner turns it on.

Keys belong in the ledger's `platform.api_keys`, not Mongo. Nyuchi-Doris is
search and analytics and is never on this read path.

All calls: `Authorization: Bearer <SERVERS_API_TOKEN>`, JSON, namespace
`/v1/shamwari/*`. The token is a service credential for the gateway only.

## 1. Verify a key — `POST /v1/shamwari/keys/verify`

Request (nothing else may be sent):

```json
{ "key_prefix": "sk_shamwari_", "key_hash": "<sha256 hex of the full key>" }
```

The gateway sends the first 12 characters and the SHA-256 hash. The raw key
never leaves the Worker. The Servers API finds by prefix and compares the hash
in constant time, honouring `isActive`/revocation and expiry.

| Status          | Meaning                                  | Gateway does                                   |
| --------------- | ---------------------------------------- | ---------------------------------------------- |
| 200 + body      | key valid                                | caches the context for `AUTH_CACHE_TTL`, admits |
| 401, 403 or 404 **with body `{"error":"invalid_key"}`** | key unknown, revoked, expired, wrong hash | caches "invalid" for `AUTH_CACHE_TTL`, answers 401 |
| anything else, **including a bare 401/403/404** | Servers API cannot say (a rotated gateway token or wrong route looks like a bare 401/404) | **denies with 503 `auth_unavailable`, caches nothing** |

200 body (all required except `owner_person_id` and `key_type`):

```json
{
  "api_key_id": "string",
  "owner_entity_id": "string",
  "owner_person_id": "string | null",
  "key_type": "standard",
  "tier": "community",
  "monthly_token_cap": 100000
}
```

A 200 that is not JSON, lacks a required field, has an empty id or tier, or has
a `monthly_token_cap` that is not a positive integer is treated as unavailable.
"This key is bad" must carry `{"error":"invalid_key"}`; the gateway will not cache
a verdict on a good key because its own credential or route is wrong.

**Latency budget:** p95 ≤ 150 ms, hard client timeout 800 ms. KV absorbs
repeat traffic, so this is on the cold path only.

**Revocation window:** `AUTH_CACHE_TTL` (60 s). No cache-invalidation call is
needed or defined.

## 2. Usage rollup — `GET /v1/shamwari/usage/rollup?owner_entity_id=&billing_period=YYYY-MM`

200: `{ "total_tokens": 12345 }` (input + output, this owner, this period).
Anything else, malformed bodies included, is an error to the gateway. Budget:
p95 ≤ 150 ms, timeout 800 ms.

**Failure behaviour (unchanged from today, deliberately):** the quota check
fails **open** — a rollup outage must not stop a paying customer. That is a
billing decision, not an auth one, and it is the only fail-open path. Auth never
fails open.

## 3. Record usage — `POST /v1/shamwari/usage/events`

```json
{ "events": [ { "requestId": "…", "ownerEntityId": "…", "apiKeyId": "…", "…": "…" } ] }
```

Fields are an allowlist (`USAGE_EVENT_FIELDS` in `keys.ts`): identifiers,
period, tier/model/provider, `licenseClass`, token counts, cache/ground flags,
`inferencePath`, `latencyMs`, `createdAt`. **No prompt, answer, message, scope or
system-prompt content is ever sent** (Rule 1); the Servers API must not ask for any.

- **Idempotent on `requestId`.** The gateway may send an event twice (fallback,
  queue retry). A repeat must be accepted and not double-counted.
- 2xx = accepted. Anything else, or a timeout (2 s), makes the gateway spill
  the event to the existing sink (`platform.usageEvents` via Core), so it is not
  lost. **The spill is not counted** by quota or billing while the flag is on,
  because those read the Servers API. **Needs from the Servers API owner:** a
  replay of spilled Core `usageEvents` rows into `POST /usage/events`, safe
  because of the `requestId` dedup. A timeout after acceptance can spill a
  duplicate; the dedup makes that harmless.
- Fire-and-forget from the request path (`waitUntil`); metering never delays
  or fails a user answer.

## What the gateway does when the Servers API is down

| Call     | Behaviour                                                                  |
| -------- | -------------------------------------------------------------------------- |
| verify   | cached good keys keep working for ≤ `AUTH_CACHE_TTL`; uncached keys get 503, never admitted, no negative cache entry |
| rollup   | fail open (existing billing behaviour)                                      |
| usage    | spill to the sink; counted only once replayed to the Servers API (deduped by `requestId`) |

Not done, on purpose: serving stale cached keys past their TTL (it would
lengthen the revocation window), and falling back from the Servers API to Core
for verification when the flag is on (two sources of truth for revocation).

## Rule 1 and Rule 2

- Verification and metering carry no personal-scope content. The scope gate
  (`scope.ts`, `core/main.py::resolve_scope`) is untouched by this seam and still
  runs after authentication.
- `licenseClass` on usage events is stamped by the gateway from the model that
  served. The Servers API stores it and must never infer or rewrite it.
