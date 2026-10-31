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

    def test_every_data_file_a_shipped_module_reads_is_in_the_image(self):
        shipped = {n for n in self.copied() if n.endswith(".py")}
        self.assertIn("main.py", shipped)
        needed = set()
        for py in shipped:
            needed |= set(re.findall(r"[\"'](\w[\w.-]*\.json)[\"']", (HERE / py).read_text()))
        self.assertLessEqual(needed, self.copied(), needed - self.copied())

    def test_the_image_ships_only_what_serving_needs(self):
        """No parked or operator-only module: dead code in the image is attack surface."""
        self.assertEqual({n for n in self.copied() if n.endswith(".py")}, {"main.py", "nyuchi_api.py"})

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
    """What Core's one data-API credential can do: the four /v1/shamwari routes and the guardrails read."""

    def test_core_calls_exactly_these_data_api_routes(self):
        src = (HERE / "nyuchi_api.py").read_text()  # the only module that makes a request
        routes = set(re.findall(r"/v1/[\w-]+(?:/[\w-]+)+", src))
        self.assertEqual(
            routes,
            {
                "/v1/shamwari/whoami",
                "/v1/shamwari/ground/search",
                "/v1/shamwari/sink",
                "/v1/shamwari/usage/rollup",
                "/v1/ai/guardrails",
            },
        )

    def test_core_never_issues_revokes_or_reads_keys(self):
        src = (HERE / "main.py").read_text() + (HERE / "nyuchi_api.py").read_text()
        for word in ("keys/issue", "keys/revoke", "keys/list", "api_keys", "keys/create", "apiKeys"):
            self.assertNotIn(word, src)

    def test_core_holds_no_database_driver_or_login(self):
        """The owner's rule: only the Nyuchi API talks to databases."""
        for py in ("main.py", "nyuchi_api.py"):
            src = (HERE / py).read_text()
            for word in ("motor", "pymongo", "asyncpg", "MONGODB", "SUPABASE"):
                self.assertNotIn(word, src, f"{py} mentions {word}")

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
