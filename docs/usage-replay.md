# Usage replay: delivering spilled events to the Servers API

Status: built behind the same off-by-default flag as the rest of the seam
(`SERVERS_API_ENABLED=false`). Nothing here deploys or runs until the owner turns
the flag on and schedules the job. Code: `core/replay.py`, endpoints in
`core/main.py`, tests in `core/test_replay.py`. Contract:
`docs/servers-api-contract.md`.

## Why it exists

With the flag on, the gateway meters to the Servers API. When that call fails or
times out, the gateway **spills** the event: it goes to the sink queue and lands
in Mongo `platform.usageEvents` with `spilled: true`. Quota and billing read the
Servers API, so a spilled event counts for nothing there until it is delivered.

**Quota counting lags until replay has caught up.** The lag is exactly the events
still pending. While the Servers API is down, usage is under-counted and the
quota check (which fails open) can admit a little more than the cap. It is
bounded by the outage and corrected by the replay. `/replay/stats` is the gauge.

## What it guarantees

- **Ordered.** Oldest first (`createdAt`, then `_id`).
- **Bounded.** Batches of at most 100, at most 10 batches per run, at most 4
  attempts per batch, exponential backoff capped at 8 seconds with jitter. A run
  that cannot get through stops and leaves everything pending.
- **Never loses an event.** A row is marked `replayedAt` only after the Servers
  API answered 2xx. A crash between send and mark leaves it pending; the next run
  sends it again.
- **Never double counts, provided the Servers API deduplicates on `requestId`.**
  That is a requirement on the Servers API, not something Core can supply. With
  it, the resend above is harmless: acknowledged twice, counted once. Without it,
  every crash between send and mark, and every second machine, double counts. The
  tests use a fake remote that deduplicates, so they cannot detect its absence:
  **verify the dedup on the real Servers API before turning the flag on.**
  Nothing is sent after it is marked.
- **Never wedges, never silently loses.** A 400/422 isolates the offending event
  (each event is retried alone) and dead-letters it with `replayRejectedAt` and a
  reason, but only once the Servers API has accepted something in the same run.
  If it rejects everything, that is a mismatch on its side, so nothing is
  dead-lettered and the run stops. A 401, 403, 404, 429 or 5xx is **retried, never
  dead-lettered**, because it may be our credential or route that is wrong; the
  run report carries `last_status` so an outage and a misconfiguration can be told
  apart. Rows are never deleted, and `POST /replay/requeue` puts dead-lettered
  ones back after the cause is fixed. Only an event with no `requestId` is
  dead-lettered locally, because without it nothing can deduplicate it.
- **Bounded in time.** A pass stops at a 25 second wall-clock deadline, under a
  typical scheduler timeout, so it is not cut off between a send and its mark.
- **Rule 1.** Only the allowlisted fields leave, and `scope` only as one of
  `personal`, `community` or `platform`. No prompt, completion or message text. The
  allowlist is `core/usage_event_fields.json`; a gateway test fails if it differs
  from the gateway's own `USAGE_EVENT_FIELDS`.

The tests fail if any of that breaks: marking before the acknowledgement, sending
a marked row, an unbounded retry, a poison event blocking the rest, or content
leaving. A flaky-remote simulation checks that every event is counted exactly once.

## Running it

- `POST /replay/usage` (operator token, `SHAMWARI_OPS_TOKEN`; the edge Worker's token is refused) runs one bounded pass. Schedule it about once
  a minute. It is safe to run concurrently on two machines: the Servers API
  deduplicates, and one machine skips while a pass is running.
- `GET /replay/stats` returns `pending`, `oldest_pending_age_seconds`, `rejected`
  and the last run. Alert on: `pending` above zero for more than 15 minutes (the
  replay is not catching up, or the Servers API is down), `oldest_pending_age_seconds`
  above an hour, and any `rejected` above zero (a dead-lettered event needs a
  human look; it is never retried).
- Only rows the gateway marked `spilled: true` are replayed. Events metered
  before the flag was on went to Mongo as normal and were counted there.
- Configuration in Core's environment: `SERVERS_API_URL`, `SERVERS_API_TOKEN`,
  `SERVERS_API_INTERNAL_KEY`. The job answers 503 if the first two are unset.

## Owner-only steps (nothing here has been run)

1. Set `SHAMWARI_OPS_TOKEN` and the three `SERVERS_API_*` values on Core, and schedule the call with the operator token.
2. Create a Mongo index so the pending query is not a scan, on
   `platform.usageEvents`: `{ spilled: 1, replayedAt: 1, replayRejectedAt: 1, createdAt: 1 }`
   (a partial index on `spilled: true` is smaller). This changes a live database,
   so it is yours to run or to approve.
3. Turn the flag on only after the Servers API ledger store exists **and its
   `requestId` dedup has been verified** (send one event twice, expect one count).
4. Add the three variables to `fly secrets set` (listed in `core/fly.toml`).
