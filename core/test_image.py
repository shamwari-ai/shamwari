"""The image must carry every file Core imports or reads at import time.

A module that exists in the source tree but not in the image passes every other
test and crashes Core at boot, taking auth, the sink, Ground and the Rule 1 check
down with it. This is the test that catches that.
"""

import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class Image(unittest.TestCase):
    def copied(self) -> set[str]:
        names: set[str] = set()
        for line in (HERE / "Dockerfile").read_text().splitlines():
            if line.startswith("COPY ") and "requirements" not in line:
                names.update(line.split()[1:-1])
        return names

    def test_every_local_module_main_imports_is_in_the_image(self):
        src = (HERE / "main.py").read_text()
        local = {
            f"{m}.py"
            for m in re.findall(r"^(?:import|from) (\w+)", src, re.M)
            if (HERE / f"{m}.py").exists()
        }
        self.assertTrue(local, "found no local imports; the check is broken")
        self.assertLessEqual(local, self.copied(), local - self.copied())

    def test_every_data_file_a_module_reads_is_in_the_image(self):
        needed = set()
        for py in ("main.py", "replay.py"):
            needed |= set(re.findall(r"[\w.]+\.json", (HERE / py).read_text()))
        self.assertIn("usage_event_fields.json", needed)
        self.assertLessEqual(needed, self.copied(), needed - self.copied())

    def test_every_base_image_is_pinned_by_digest(self):
        froms = [
            line.split()[1]
            for line in (HERE / "Dockerfile").read_text().splitlines()
            if line.startswith("FROM ")
        ]
        self.assertTrue(froms)
        for ref in froms:
            self.assertRegex(ref, r"@sha256:[0-9a-f]{64}$", f"{ref} is not pinned by digest")


class LeastPrivilege(unittest.TestCase):
    """What Core's Servers API credential can do: write usage events, nothing else."""

    def test_core_calls_exactly_one_servers_api_route(self):
        src = (HERE / "main.py").read_text() + (HERE / "replay.py").read_text()
        routes = set(re.findall(r"/v1/shamwari/[\w/-]+", src))
        self.assertEqual(routes, {"/v1/shamwari/usage/events"})

    def test_core_never_issues_revokes_or_reads_keys(self):
        src = (HERE / "main.py").read_text()
        for word in ("keys/issue", "keys/revoke", "keys/list", "api_keys", "keys/create"):
            self.assertNotIn(word, src)

    def test_no_secret_reaches_a_log_or_the_report(self):
        import asyncio
        import contextlib
        import io

        import replay

        secrets = ("tok-SECRET-1", "nyk_id.nys_SECRET-2")

        class Store:
            async def pending(self, n):
                return [
                    {"_id": 1, "requestId": "r1", "ownerEntityId": "e", "apiKeyId": "k",
                     "createdAt": "2026-10-29T00:00:00Z"}
                ]

            async def mark_sent(self, ids):
                pass

            async def mark_rejected(self, id, reason):
                pass

            async def requeue_rejected(self):
                return 0

        async def send(body):
            return "retry"

        async def nosleep(_):
            return None

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            report = asyncio.run(replay.replay_once(Store(), send, sleep=nosleep, jitter=lambda: 0))
        text = buf.getvalue() + repr(vars(report))
        for s in secrets:
            self.assertNotIn(s, text)


if __name__ == "__main__":
    unittest.main()
