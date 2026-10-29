# Migrating existing Shamwari API keys to the shared key table

Status: **plan only. Nothing here has been run and nothing runs without the
owner's named yes.** Tracking: #91 and #81. Contract the new store must meet:
`docs/servers-api-contract.md`.

## Decision this implements

Owner, 2026-10-29: "it is on the same api keys table because the nyuchi platform
is the place everyone goes for api keys" and "what the keys are issued for
determines the keys type". Shamwari customer keys move from MongoDB
`platform.apiKeys` into the shared `platform.api_keys` (ledger) with key type
`shamwari`. Tier and monthly token cap become attributes of that type.

## What exists today

- Keys are stored as SHA-256 hashes (`keyHash`, lowercase hex) with a `keyPrefix`
  of `sk_shamwari_`, `isActive`, `expiresAt`, `ownerEntityId`,
  `createdByPersonId` and `keyType` in Mongo `platform.apiKeys`.
- Tier and monthly cap are read at verify time from `entity.entities`.
- The raw key is never stored. **The migration moves hashes and metadata only. No
  plaintext key is read, logged, transmitted or reconstructed at any step.**
- Usage history stays in Mongo `platform.usageEvents`.

## Requirements on the shared table (for the ledger worker)

1. Accepts an **import** of an existing SHA-256 hash with its metadata, as is.
   Same hash scheme: lowercase hex SHA-256 of the full key. No re-hashing, which
   is impossible without the plaintext.
2. `key_hash` is unique. Lookup is by hash; the prefix is not an identifier.
3. `key_type = shamwari` with `tier` and `monthly_token_cap` columns.
4. Import is idempotent (upsert by `key_hash`), records the source Mongo `_id`,
   and preserves `isActive`, `expiresAt`, owner and creator.
5. Verify distinguishes why a key failed, in the 401 body next to
   `"error":"invalid_key"`: `"reason": "unknown" | "revoked" | "expired"`.
   This is what makes the dual-accept window safe (see below).

## Lookup: a digest, and why

Chosen as the best-practice, most secure option, per the owner's instruction
(2026-10-29).

**Authoritative lookup is by an indexed SHA-256 digest of the full key** (the
`key_hash` column, unique), compared in constant time, never by prefix. Reasons:

- A customer API key is a long random secret, not a password. A fast hash is
  right for that: it is safe because the key has too much entropy to guess, and
  it allows an indexed O(1) lookup. A slow salted hash (bcrypt, argon2) exists to
  protect low-entropy passwords and would make every request pay for it, with
  nothing to look the row up by.
- The prefix is useless as an identifier: every Shamwari key starts
  `sk_shamwari_`. It stays only as a human-readable hint and a cheap pre-filter.
- Existing keys are already stored as this digest, so they migrate without any
  plaintext.

**New keys** carry a non-secret per-key id so a person or log can name a key
without touching the secret: `sk_shamwari_<key_id>_<secret>`. The `key_id` is for
display, revocation requests and audit logs; it never authenticates. The secret is
at least 256 bits from a cryptographically secure generator, shown once, and
stored only as its digest. Lookup stays by digest.

**Entropy of existing keys cannot be seen from their hash.** Before cutover the
owner should confirm they were generated from a CSPRNG at 128 bits or more; any
that were not are rotated rather than migrated.

**Always:** constant-time compare, an expiry and an active flag checked on every
verify, and no key, digest or prefix in logs beyond a short fingerprint.

## Phases

Each phase ends in a check, and phases 2, 4 and 6 need the owner's yes.

0. **Prepare (no data moves).** Ledger worker ships the columns and the import
   and verify behaviour above. Gateway ships the key-type check and keeps the flag
   off (done: #92, #93 and this change).
1. **Dry run.** A read-only script lists Mongo keys and reports counts by owner,
   active, expired and tier, and flags rows the table cannot take (missing hash,
   duplicate hash, non-`sk_shamwari_` prefix). Output holds counts and ids, never
   hashes beyond a short fingerprint. Owner reviews.
2. **Backfill (owner yes).** Import all rows into the shared table. Idempotent;
   safe to re-run. Mongo is not modified or deleted.
3. **Reconcile.** Compare the two stores by `key_hash` fingerprint: every active
   Mongo key must exist and be active in the ledger with the same owner, expiry,
   tier and cap. The count of differences must be zero. Re-run until it is.
4. **Shadow (owner yes to turn on).** With the flag on in shadow mode, the
   gateway still serves from Core, but also asks the Servers API and counts
   agreements and disagreements by category. No key material in logs. Needs a
   small gateway change (`SERVERS_API_SHADOW`), not built yet. Exit when
   disagreements stay at zero over a full billing period.
5. **Cutover at a period boundary (owner yes).** Flip to primary on the first of
   a month, UTC, so each monthly cap is counted in one store. With the flag on:
   - The gateway asks the Servers API first.
   - On `reason: "unknown"` only, it asks Core once (the **dual-accept
     window**), so a key somehow missing from the ledger still works.
   - On `revoked`, `expired`, a wrong key type, or any `unavailable`, it does
     **not** fall back. A revoked or expired key can never be resurrected from
     Mongo, and an outage never opens a second door. Auth still fails closed.
   - Fallback hits are counted. Needs a small gateway change
     (`SERVERS_API_FALLBACK_TO_CORE`, default off), not built yet.
6. **Close the window (owner yes).** When fallback hits have been zero for a full
   billing period, turn the fallback off. Mongo `platform.apiKeys` becomes a
   read-only archive; it is not deleted until the owner says so.

**The fallback is not safe to enable until it is built on a distinct outcome.**
Today the gateway reads only `error: "invalid_key"` and does not parse `reason`.
The fallback must be implemented on a separate `unknown` outcome, with tests that
fail if a revoked, expired, wrong-type or unavailable result ever calls Core.

## Known gaps in the Core path

Core's `/auth/verify` (not touched here; the Core auth change is #81 and is the
owner's) has two gaps that this plan has to account for before phase 5:

- It looks keys up by `keyPrefix` and `isActive` only. Every key shares
  `sk_shamwari_`, so with more than one active key it can fetch the wrong document
  and reject a valid key. The shared-table lookup by `key_hash` does not have this
  problem, so phase 5's fallback inherits it only for keys missing from the ledger.
- It does no key-type check and defaults a missing `keyType` to `standard`.
  Whether `platform.apiKeys` holds only Shamwari keys is unconfirmed. If it holds
  other products' keys, the fallback would admit them. Confirm this in phase 1
  (the dry run reports counts by `keyType`) before phase 5.

## During the window

- **New keys:** freeze issuance in Mongo from phase 2; issue only in the shared
  table. Keys issued there are not in Mongo.
- **Revocations:** applied in the ledger, and also in Mongo until phase 6, by the
  same operator step, so a rollback never brings a revoked key back. The
  reconcile job (phase 3) runs daily and alerts on any key active in Mongo but
  revoked in the ledger.
- **Quota:** a billing period that straddles cutover would need both stores
  summed. Cutting over on a period boundary avoids that.

## Rollback

At any phase before 6, set `SERVERS_API_ENABLED=false`. The gateway goes back to
Core and Mongo, which still holds every key it ever held. Two things to cover
first:

- Keys issued in the ledger since phase 2 are not in Mongo. A reverse export
  (hash and metadata, never plaintext) restores them to Mongo before rollback, or
  those customers lose access. Prepare and rehearse this export in phase 2.
- Revocations made only in the ledger must be mirrored first. The daily reconcile
  is the check.

After phase 6 rollback means re-enabling the Mongo archive and its fallback. Do
not delete the archive until the owner is sure.

## Rules this must not break

- **Auth never fails open.** No phase admits a key the ledger says is revoked,
  expired, or of another type, and an unavailable store denies.
- **Rule 1.** Verification and metering carry hashes, identifiers and counts, and
  the scope label only. No prompt or personal-scope content. A key's data cannot
  widen a request's scope.
- **Rule 2.** `licenseClass` on usage events is stamped by the gateway from the
  model that served and is never rewritten by the key store.

## Owner-only steps

Approve phase 2, 4, 5 and 6 each by name. Mint the Servers API token
(scope `shamwari`) and internal key. Set `SERVERS_API_URL`, `SERVERS_API_TOKEN`
and `SERVERS_API_INTERNAL_KEY`. Decide who runs the backfill and who owns the
spilled-usage replay.
