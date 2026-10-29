"""
Tests for replay.py. Standard library only: `python -m unittest` from core/.

The two that matter most are the ones named for the failure: a replay must not
lose an event (mark it sent when the Servers API never acknowledged it) and must
not double count one (send it again after it was marked, or count a resend).
"""

import asyncio
import json
import random
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import replay


def event(i: int, **extra):
    return {
        "_id": i,
        "requestId": f"r{i}",
        "ownerEntityId": "e1",
        "apiKeyId": "k1",
        "createdAt": datetime(2026, 10, 29, tzinfo=timezone.utc) + timedelta(seconds=i),
        "inputTokens": 10,
        "outputTokens": 5,
        "scope": "platform",
        **extra,
    }


class FakeStore:
    """Mongo's role: pending is the ordered, unsent, un-rejected set."""

    def __init__(self, docs, fail_mark_once=False):
        self.docs = {d["_id"]: d for d in docs}
        self.sent: set = set()
        self.rejected: dict = {}
        self.marked_log: list = []
        self.fail_mark_once = fail_mark_once

    async def pending(self, limit):
        rows = [
            d
            for d in self.docs.values()
            if d["_id"] not in self.sent and d["_id"] not in self.rejected
        ]
        rows.sort(key=lambda d: (d["createdAt"], d["_id"]))
        return rows[:limit]

    async def mark_sent(self, ids):
        if self.fail_mark_once:
            self.fail_mark_once = False
            raise RuntimeError("mongo down between send and mark")
        self.sent.update(ids)
        self.marked_log.extend(ids)

    async def mark_rejected(self, id, reason):
        self.rejected[id] = reason

    async def requeue_rejected(self):
        n = len(self.rejected)
        self.rejected.clear()
        return n


class FakeRemote:
    """The Servers API: deduplicates on requestId, like the real one."""

    def __init__(self, script=None, poison=()):
        self.script = list(script or [])  # results to return first, in order
        self.poison = set(poison)  # requestIds that make a batch a 422
        self.received: dict[str, int] = {}  # requestId -> times acked
        self.calls: list[list[str]] = []

    async def send(self, body):
        ids = [e["requestId"] for e in body]
        self.calls.append(ids)
        if self.script:
            r = self.script.pop(0)
            if r != "ok":
                return r
        if self.poison & set(ids):
            return "rejected"
        for i in ids:
            self.received[i] = self.received.get(i, 0) + 1
        return "ok"

    def counted(self, rid):
        """What the ledger would count: one per requestId, however often acked."""
        return 1 if rid in self.received else 0


async def no_sleep(_):
    return None


def run(coro):
    return asyncio.run(coro)


class Replay(unittest.TestCase):
    def go(self, store, remote, **kw):
        return run(replay.replay_once(store, remote.send, sleep=no_sleep, jitter=lambda: 0, **kw))

    def test_sends_oldest_first_in_bounded_batches(self):
        docs = [event(i) for i in range(250)]
        random.Random(1).shuffle(docs)
        store, remote = FakeStore(docs), FakeRemote()
        report = self.go(store, remote, batch=100, max_batches=10)
        self.assertEqual(report.sent, 250)
        self.assertEqual([len(c) for c in remote.calls], [100, 100, 50])
        flat = [r for c in remote.calls for r in c]
        self.assertEqual(flat, [f"r{i}" for i in range(250)])

    def test_run_is_bounded(self):
        store, remote = FakeStore([event(i) for i in range(500)]), FakeRemote()
        report = self.go(store, remote, batch=100, max_batches=2)
        self.assertEqual(report.sent, 200)
        self.assertEqual(len(store.sent), 200)

    def test_nothing_is_marked_sent_when_the_servers_api_is_down(self):
        """LOSS: marking before the ack would drop events for good."""
        store = FakeStore([event(i) for i in range(5)])
        remote = FakeRemote(script=["retry"] * 100)
        report = self.go(store, remote, max_attempts=4)
        self.assertEqual(store.sent, set())
        self.assertEqual(remote.received, {})
        self.assertEqual(report.attempts, 4)  # bounded
        self.assertEqual(report.stopped, "servers api unavailable")

    def test_backoff_is_capped_and_grows(self):
        delays = []

        async def sleep(d):
            delays.append(d)

        store = FakeStore([event(0)])
        remote = FakeRemote(script=["retry"] * 100)
        run(replay.replay_once(store, remote.send, max_attempts=6, sleep=sleep, jitter=lambda: 1))
        self.assertEqual(delays, sorted(delays))
        self.assertTrue(all(d <= replay.MAX_DELAY for d in delays))
        self.assertEqual(len(delays), 5)

    def test_a_crash_between_send_and_mark_resends_and_the_ledger_counts_once(self):
        """DUPLICATE: the resend must be harmless, and must happen only because it was unmarked."""
        store = FakeStore([event(0), event(1)], fail_mark_once=True)
        remote = FakeRemote()
        with self.assertRaises(RuntimeError):
            self.go(store, remote)
        self.assertEqual(store.sent, set())  # still pending: not lost
        self.go(store, remote)  # next run
        self.assertEqual(store.sent, {0, 1})
        self.assertEqual({r: remote.counted(r) for r in ("r0", "r1")}, {"r0": 1, "r1": 1})
        self.assertEqual(remote.received["r0"], 2)  # acked twice, counted once

    def test_never_sends_an_event_after_it_was_marked(self):
        store, remote = FakeStore([event(i) for i in range(30)]), FakeRemote()
        self.go(store, remote, batch=7)
        self.go(store, remote, batch=7)
        self.go(store, remote, batch=7)
        sent_ids = [r for c in remote.calls for r in c]
        self.assertEqual(len(sent_ids), len(set(sent_ids)))  # no id on the wire twice

    def test_flaky_servers_api_converges_with_no_loss_and_no_duplicates(self):
        rng = random.Random(7)
        docs = [event(i) for i in range(120)]
        store = FakeStore(docs)
        remote = FakeRemote()

        base = remote.send

        async def flaky(body):
            roll = rng.random()
            if roll < 0.35:
                return "retry"
            return await base(body)

        for _ in range(60):
            run(replay.replay_once(store, flaky, batch=25, max_attempts=2, sleep=no_sleep, jitter=lambda: 0))
            if len(store.sent) == 120:
                break
        self.assertEqual(store.sent, {d["_id"] for d in docs})
        # Marked implies acknowledged: nothing was marked that the remote never got.
        self.assertTrue(all(f"r{i}" in remote.received for i in store.sent))
        self.assertEqual(sum(remote.counted(f"r{i}") for i in range(120)), 120)

    def test_a_poison_event_is_isolated_and_the_rest_are_sent(self):
        store = FakeStore([event(i) for i in range(5)])
        remote = FakeRemote(poison={"r2"})
        report = self.go(store, remote)
        self.assertEqual(store.sent, {0, 1, 3, 4})
        self.assertEqual(list(store.rejected), [2])  # dead-lettered, not deleted
        self.assertIn(2, store.docs)
        self.assertEqual(report.rejected, 1)

    def test_a_server_that_rejects_everything_dead_letters_nothing(self):
        """A mismatch on the Servers API side must not turn into permanent loss."""
        store = FakeStore([event(i) for i in range(6)])
        remote = FakeRemote(poison={f"r{i}" for i in range(6)})
        report = self.go(store, remote)
        self.assertEqual(store.rejected, {})
        self.assertEqual(store.sent, set())
        self.assertIn("not dead-lettering", report.stopped)

    def test_rejected_events_can_be_put_back(self):
        store = FakeStore([event(i) for i in range(4)])
        remote = FakeRemote(poison={"r1"})
        self.go(store, remote)
        self.assertEqual(list(store.rejected), [1])
        remote.poison.clear()
        self.assertEqual(run(store.requeue_rejected()), 1)
        self.go(store, remote)
        self.assertEqual(store.sent, {0, 1, 2, 3})

    def test_a_pass_stops_at_its_deadline_and_loses_nothing(self):
        ticks = iter(range(0, 1000, 10))  # each clock() call advances 10s
        store, remote = FakeStore([event(i) for i in range(300)]), FakeRemote()
        report = run(
            replay.replay_once(
                store, remote.send, batch=100, sleep=no_sleep, deadline=25, clock=lambda: next(ticks)
            )
        )
        self.assertEqual(report.stopped, "deadline")
        self.assertLess(len(store.sent), 300)
        self.assertTrue(all(f"r{i}" in remote.received for i in store.sent))

    def test_slow_retries_cannot_overrun_the_deadline(self):
        """One batch of failing, backing-off sends must stop at the deadline too."""
        now = [0.0]

        async def slow_fail(body):
            now[0] += 6.0  # each attempt takes 6s
            return "retry"

        async def sleeping(d):
            now[0] += d

        store = FakeStore([event(i) for i in range(3)])
        report = run(
            replay.replay_once(
                store, slow_fail, max_attempts=50, sleep=sleeping, jitter=lambda: 1,
                deadline=25, clock=lambda: now[0],
            )
        )
        self.assertLessEqual(now[0], 25 + 6)  # at most one attempt past the line
        self.assertEqual(store.sent, set())
        self.assertEqual(report.stopped, "deadline")

    def test_only_a_missing_request_id_is_dead_lettered_locally(self):
        for k in ("apiKeyId", "createdAt", "ownerEntityId"):
            d = event(1)
            del d[k]
            self.assertIsNone(replay.unreplayable(d), k)  # the server decides these
        d = event(1)
        del d["requestId"]
        self.assertEqual(replay.unreplayable(d), "missing requestId")

    def test_an_event_with_no_request_id_is_dead_lettered_not_sent(self):
        bad = event(1)
        del bad["requestId"]
        store, remote = FakeStore([bad, event(2)]), FakeRemote()
        self.go(store, remote)
        self.assertEqual(store.sent, {2})
        self.assertEqual(store.rejected[1], "missing requestId")
        self.assertNotIn(None, [r for c in remote.calls for r in c])


class Payload(unittest.TestCase):
    def test_rule_1_only_allowlisted_keys_leave(self):
        junk = {
            k: "x"
            for k in ("messages", "content", "prompt", "completion", "answer", "text",
                      "citations", "systemPrompt", "embedding", "newField", "_id")
        }
        out = replay.payload(event(1, **junk))
        self.assertEqual(set(out) - set(replay.FIELDS), set())
        for k in junk:
            self.assertNotIn(k, out)

    def test_rule_1_scope_is_a_label_or_it_is_dropped(self):
        for bad in ("pod:abc123", "my clinic results", "", {"pod": "x"}, ["personal"], None):
            self.assertNotIn("scope", replay.payload(event(1, scope=bad)))
        for good in ("personal", "community", "platform"):
            self.assertEqual(replay.payload(event(1, scope=good))["scope"], good)

    def test_created_at_is_iso_utc(self):
        self.assertEqual(replay.payload(event(0))["createdAt"], "2026-10-29T00:00:00Z")

    def test_allowlist_has_no_content_field(self):
        for k in ("messages", "content", "prompt", "completion", "answer", "text", "citations"):
            self.assertNotIn(k, replay.FIELDS)

    def test_allowlist_file_is_a_list_of_strings(self):
        data = json.loads((Path(__file__).parent / "usage_event_fields.json").read_text())
        self.assertTrue(all(isinstance(k, str) for k in data))
        self.assertEqual(len(data), len(set(data)))


if __name__ == "__main__":
    unittest.main()
