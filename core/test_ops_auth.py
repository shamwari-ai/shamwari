"""
Operator routes need the operator secret, not the one the edge Worker holds.

Skipped where Core's dependencies are not installed (CI installs them, so it runs
there). Nothing here reaches Mongo: every case is refused before a handler runs.
"""

import os
import unittest

os.environ.setdefault("MONGODB_URI", "mongodb://placeholder")
os.environ["SHAMWARI_CORE_TOKEN"] = "worker-token"  # forced: CI sets its own placeholder
os.environ["SHAMWARI_OPS_TOKEN"] = "ops-token"

try:
    from fastapi.testclient import TestClient

    import main

    client = TestClient(main.app, raise_server_exceptions=False)
except Exception as e:  # noqa: BLE001 - any import problem means "deps not installed"
    client = None
    SKIP = f"core dependencies not installed: {e}"

WORKER = "worker-token"

OPS_ROUTES = [
    ("POST", "/replay/usage"),
    ("POST", "/replay/requeue"),
    ("GET", "/replay/stats"),
    ("GET", "/rollup/by-tier?billing_period=2026-10"),
]


@unittest.skipIf(client is None, "core dependencies not installed")
class OpsAuth(unittest.TestCase):
    def call(self, method, path, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return client.request(method, path, headers=headers)

    def test_the_worker_token_cannot_reach_any_operator_route(self):
        # Not vacuous: the token used here must be the one Core really holds.
        self.assertEqual(main.CORE_TOKEN, WORKER)
        import asyncio

        self.assertIsNone(asyncio.run(main.require_token(f"Bearer {WORKER}")))  # it IS the worker secret
        for method, path in OPS_ROUTES:
            r = self.call(method, path, main.CORE_TOKEN)
            self.assertEqual(r.status_code, 401, f"{method} {path}")

    def test_no_token_and_a_wrong_token_are_refused(self):
        for method, path in OPS_ROUTES:
            self.assertIn(self.call(method, path).status_code, (401, 422), path)
            self.assertEqual(self.call(method, path, "nope").status_code, 401, path)

    def test_the_operator_route_closes_when_no_operator_secret_is_set(self):
        main.OPS_TOKEN = ""
        try:
            for method, path in OPS_ROUTES:
                self.assertEqual(self.call(method, path, "ops-token").status_code, 503, path)
                self.assertEqual(self.call(method, path, main.CORE_TOKEN).status_code, 503, path)
        finally:
            main.OPS_TOKEN = "ops-token"

    def test_the_operator_token_does_not_open_the_worker_routes(self):
        r = client.post(
            "/auth/verify",
            headers={"Authorization": "Bearer ops-token"},
            json={"key_prefix": "sk_shamwari_", "key_hash": "x"},
        )
        self.assertEqual(r.status_code, 401)


if __name__ == "__main__":
    unittest.main()
