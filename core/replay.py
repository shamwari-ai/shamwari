"""
Replay of spilled usage events to the Servers API.

With SERVERS_API_ENABLED, the gateway meters to the Servers API and, when that
call fails, spills the event to the sink queue, which lands it in Mongo
`platform.usageEvents` with `spilled: true`. Quota and billing read the Servers
API, so a spilled event counts for nothing until this job delivers it. THAT
LAG IS REAL: until replay has caught up, quota counting is behind by exactly
the events still pending. `/replay/stats` says how many and how old.

Guarantees, each pinned by test_replay.py:

  - Ordered: oldest first (createdAt, then _id).
  - Bounded: batches of at most BATCH, at most MAX_BATCHES per run, at most
    MAX_ATTEMPTS tries per batch with capped exponential backoff and jitter.
  - Never loses: an event is marked sent only after the Servers API answered
    2xx for it. A crash between the send and the mark leaves it pending, and
    the next run sends it again.
  - Never double counts: the Servers API deduplicates on `requestId`, which is
    what makes that resend safe. A resend is the only way an event is sent
    twice, and never after it is marked.
  - Never wedges: an event the Servers API rejects (400/422) is isolated and
    dead-lettered with its reason, not retried forever, and not deleted.
  - Rule 1: only the allowlisted fields leave, and `scope` only as one of its
    three names. The allowlist is usage_event_fields.json, which a gateway test
    holds equal to the gateway's own.

This module has no third-party imports so it is testable without Mongo or HTTP.
"""

from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal, Protocol

FIELDS: tuple[str, ...] = tuple(
    json.loads((Path(__file__).parent / "usage_event_fields.json").read_text())
)
SCOPE_LABELS = frozenset({"personal", "community", "platform"})

BATCH = 100
MAX_BATCHES = 10
MAX_ATTEMPTS = 4
BASE_DELAY = 0.5
MAX_DELAY = 8.0

SendResult = Literal["ok", "rejected", "retry"]


def _iso(v: Any) -> Any:
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return v


def payload(doc: dict[str, Any]) -> dict[str, Any]:
    """The only shape that leaves Core: allowlisted keys, scope as a label."""
    out = {k: _iso(doc[k]) for k in FIELDS if k in doc}
    if "scope" in out and not (isinstance(out["scope"], str) and out["scope"] in SCOPE_LABELS):
        del out["scope"]
    return out


def unreplayable(doc: dict[str, Any]) -> str | None:
    """Why an event cannot be replayed safely, or None. No requestId means no idempotency."""
    p = payload(doc)
    for k in ("requestId", "ownerEntityId", "apiKeyId", "createdAt"):
        if not p.get(k):
            return f"missing {k}"
    return None


class Store(Protocol):
    async def pending(self, limit: int) -> list[dict[str, Any]]: ...
    async def mark_sent(self, ids: list[Any]) -> None: ...
    async def mark_rejected(self, id: Any, reason: str) -> None: ...


Send = Callable[[list[dict[str, Any]]], Awaitable[SendResult]]


@dataclass
class RunReport:
    sent: int = 0
    rejected: int = 0
    attempts: int = 0
    stopped: str | None = None  # why the run ended early, if it did
    started_at: str = field(default_factory=lambda: _iso(datetime.now(timezone.utc)))


async def replay_once(
    store: Store,
    send: Send,
    *,
    batch: int = BATCH,
    max_batches: int = MAX_BATCHES,
    max_attempts: int = MAX_ATTEMPTS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    jitter: Callable[[], float] = random.random,
) -> RunReport:
    report = RunReport()
    for _ in range(max_batches):
        docs = await store.pending(batch)
        if not docs:
            return report

        # Rows that cannot be replayed safely are dead-lettered up front.
        ok_docs: list[dict[str, Any]] = []
        for d in docs:
            why = unreplayable(d)
            if why:
                await store.mark_rejected(d["_id"], why)
                report.rejected += 1
            else:
                ok_docs.append(d)
        if not ok_docs:
            continue

        result = await _send_with_retry(ok_docs, send, report, max_attempts, sleep, jitter)
        if result == "ok":
            await store.mark_sent([d["_id"] for d in ok_docs])
            report.sent += len(ok_docs)
        elif result == "rejected":
            # One bad event must not hold up the rest: isolate it.
            for d in ok_docs:
                r = await _send_with_retry([d], send, report, max_attempts, sleep, jitter)
                if r == "ok":
                    await store.mark_sent([d["_id"]])
                    report.sent += 1
                elif r == "rejected":
                    await store.mark_rejected(d["_id"], "rejected by servers api")
                    report.rejected += 1
                else:
                    report.stopped = "servers api unavailable"
                    return report
        else:
            report.stopped = "servers api unavailable"
            return report
    return report


async def _send_with_retry(
    docs: list[dict[str, Any]],
    send: Send,
    report: RunReport,
    max_attempts: int,
    sleep: Callable[[float], Awaitable[None]],
    jitter: Callable[[], float],
) -> SendResult:
    body = [payload(d) for d in docs]
    result: SendResult = "retry"
    for attempt in range(max_attempts):
        report.attempts += 1
        result = await send(body)
        if result != "retry":
            return result
        if attempt < max_attempts - 1:
            delay = min(MAX_DELAY, BASE_DELAY * (2**attempt))
            await sleep(delay * (0.5 + jitter() / 2))
    return result
