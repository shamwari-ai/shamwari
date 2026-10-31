"""
Core's routes with the data API replaced by a recording fake.

The point of most cases is a count: when Core refuses on a rule it makes ZERO data API
calls. The API's own query filters (owner, supersededBy, isActive) are tested in nyuchi-api
(tests/test_shamwari.py); what is tested here is what Core decides before it calls, and what
it checks on the way back.
"""

import os
import subprocess
import sys
import unittest
from pathlib import Path

os.environ.setdefault("NYUCHI_API_INTERNAL_KEY", "nyk_test.nys_test")
os.environ["SHAMWARI_CORE_TOKEN"] = "worker-token"
os.environ["SHAMWARI_OPS_TOKEN"] = "ops-token"  # same as test_ops_auth: whichever imports main first sets it

try:
    from fastapi.testclient import TestClient

    import main
    from nyuchi_api import DataApiRefusal, DataApiUnavailable

    SKIP = None
except Exception as e:  # noqa: BLE001 - any import problem means "deps not installed"
    main = None
    SKIP = f"core dependencies not installed: {e}"

HERE = Path(__file__).parent
AUTH = {"Authorization": "Bearer worker-token"}
OPS = {"Authorization": "Bearer ops-token"}
CHUNK = {"content": "x", "heading": "s 56 Equality", "title": "T", "authority": "A",
         "resource_type": "legislation", "source_url": None, "effective_from": "2013-05-22",
         "scope": "platform"}


class FakeApi:
    def __init__(self):
        self.calls = []
        self.answers = {}

    def _do(self, name, *args):
        self.calls.append((name, args))
        a = self.answers.get(name)
        if isinstance(a, Exception):
            raise a
        return a

    async def ground_search(self, body):
        return self._do("ground_search", body) or {
            "scope": body["scope"], "hit": True, "chunks": [{**CHUNK, "scope": body["scope"]}]
        }

    async def sink(self, database, collections):
        return self._do("sink", database, collections) or {"written": {k: len(v) for k, v in collections.items()}}

    async def usage_rollup(self, owner, period):
        return self._do("usage_rollup", owner, period) or {"total_tokens": 7, "total_cost": 0.5, "requests": 2}

    async def guardrails(self, surface):
        return self._do("guardrails", surface) or {"platform": [{"id": "r1"}], "entity": []}

    async def whoami(self):
        return self._do("whoami") or {"tier": "community"}

    async def aclose(self):
        pass


@unittest.skipIf(SKIP, SKIP or "")
class Base(unittest.TestCase):
    def setUp(self):
        self.real = main.api
        self.api = FakeApi()
        main.api = self.api
        self.addCleanup(setattr, main, "api", self.real)
        self.http = TestClient(main.app, raise_server_exceptions=False)

    def search(self, **over):
        body = {"query": "equality", "owner_entity_id": "e1", "scope": "platform", "destination": "cloud"}
        body.update(over)
        return self.http.post("/ground/search", headers=AUTH, json=body)


class GroundRule1(Base):
    def test_personal_scope_to_cloud_is_a_409_and_makes_no_data_call(self):
        r = self.search(scope="personal")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["error"], "scope_requires_local_inference")
        self.assertEqual(self.api.calls, [])

    def test_a_mind_query_that_arrives_embedded_is_refused_and_makes_no_data_call(self):
        r = self.search(scope="personal", destination="mind", embedding=[0.1] * 1024)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["error"], "edge_embedding_forbidden")
        self.assertEqual(self.api.calls, [])

    def test_a_mind_query_without_an_embedding_is_forwarded_as_personal_for_mind(self):
        r = self.search(scope="personal", destination="mind")
        self.assertEqual(r.status_code, 200)
        (name, (body,)), = self.api.calls
        self.assertEqual((body["scope"], body["destination"]), ("personal", "mind"))
        self.assertNotIn("embedding", body)

    def test_a_cloud_query_is_forwarded_with_exactly_what_the_api_takes(self):
        r = self.search(embedding=[0.5] * 1024, language="sn", top_k=8)
        self.assertEqual(r.status_code, 200)
        (_, (body,)), = self.api.calls
        self.assertEqual(
            set(body),
            {"query", "embedding", "owner_entity_id", "scope", "destination", "language", "top_k"},
        )
        self.assertEqual((body["owner_entity_id"], body["top_k"], body["language"]), ("e1", 8, "sn"))

    def test_the_answer_carries_the_chunks_the_api_returned(self):
        r = self.search()
        self.assertEqual(r.json(), {"scope": "platform", "hit": True, "chunks": [CHUNK]})

    def test_a_miss_is_reported_as_a_miss(self):
        self.api.answers["ground_search"] = {"scope": "platform", "hit": False, "chunks": []}
        self.assertFalse(self.search().json()["hit"])

    # -- the third check: what comes back ------------------------------------------

    def test_an_api_answer_for_a_different_scope_than_asked_is_refused(self):
        self.api.answers["ground_search"] = {"scope": "personal", "hit": True, "chunks": [CHUNK]}
        r = self.search()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"], {"error": "data_api_unavailable"})

    def test_a_personal_chunk_in_a_cloud_answer_never_leaves_core(self):
        leak = {**CHUNK, "scope": "personal", "content": "PAYSLIP"}
        self.api.answers["ground_search"] = {"scope": "platform", "hit": True, "chunks": [CHUNK, leak]}
        r = self.search()
        self.assertEqual(r.status_code, 503)
        self.assertNotIn("PAYSLIP", r.text)

    def test_the_api_s_own_409_reaches_the_caller_as_that_409(self):
        self.api.answers["ground_search"] = DataApiRefusal(409, {"error": "scope_requires_local_inference"})
        r = self.search()
        self.assertEqual((r.status_code, r.json()["detail"]["error"]), (409, "scope_requires_local_inference"))

    def test_a_malformed_chunk_or_a_mismatched_mind_chunk_fails_closed_not_500(self):
        for destination, scope, chunks in (
            ("cloud", "platform", [None]),
            ("cloud", "platform", ["text"]),
            ("mind", "personal", [{**CHUNK, "scope": "platform"}]),  # not the caller's own scope
            ("mind", "personal", [{**CHUNK, "scope": "personal"}, {**CHUNK, "scope": "community"}]),
        ):
            self.api.answers["ground_search"] = {"scope": scope, "hit": True, "chunks": chunks}
            r = self.search(scope=scope, destination=destination)
            self.assertEqual(r.status_code, 503, (destination, chunks))

    def test_a_mind_answer_of_the_callers_own_scope_passes(self):
        self.api.answers["ground_search"] = {"scope": "personal", "hit": True, "chunks": [{**CHUNK, "scope": "personal"}]}
        self.assertEqual(self.search(scope="personal", destination="mind").status_code, 200)

    # -- fail closed ------------------------------------------------------------------

    def test_an_unreachable_api_is_a_503_that_says_nothing_about_why(self):
        self.api.answers["ground_search"] = DataApiUnavailable("ConnectError: nyuchi-api.internal")
        r = self.search()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"], {"error": "data_api_unavailable"})
        self.assertNotIn("nyuchi-api", r.text)

    # -- input is bounded before it is forwarded -----------------------------------------

    def test_bad_input_is_a_422_and_makes_no_data_call(self):
        for over in ({"top_k": 21}, {"top_k": 0}, {"owner_entity_id": "a b"}, {"owner_entity_id": ""},
                     {"embedding": [0.1] * 10}, {"query": ""}, {"scope": "everything"}):
            self.assertEqual(self.search(**over).status_code, 422, over)
        self.assertEqual(self.api.calls, [])

    def test_no_token_and_a_wrong_token_never_reach_the_api(self):
        body = {"query": "q", "owner_entity_id": "e1"}
        self.assertEqual(self.http.post("/ground/search", json=body).status_code, 422)
        self.assertEqual(
            self.http.post("/ground/search", headers={"Authorization": "Bearer nope"}, json=body).status_code, 401
        )
        self.assertEqual(self.api.calls, [])


class Sink(Base):
    def post(self, database, collections):
        return self.http.post("/sink/bulk", headers=AUTH, json={"database": database, "collections": collections})

    def conv(self, **over):
        d = {"licenseClass": "open_weight", "scope": "platform", "trainingEligible": True,
             "createdAt": "2026-10-31T04:00:00Z", "requestId": "r1"}
        d.update(over)
        return d

    def test_a_good_batch_is_forwarded_untouched_with_timestamps_still_strings(self):
        r = self.post("shamwari", {"conversations": [self.conv()], "messages": []})
        self.assertEqual(r.status_code, 200)
        (_, (db, cols)), = self.api.calls
        self.assertEqual(db, "shamwari")
        self.assertEqual(cols, {"conversations": [self.conv()]})  # empty collections are dropped
        self.assertIsInstance(cols["conversations"][0]["createdAt"], str)

    def test_provenance_violations_are_refused_before_anything_is_forwarded(self):
        bad = [
            self.conv(licenseClass=None), self.conv(licenseClass="permissive"), self.conv(licenseClass=["x"]),
            self.conv(scope="everyone"), self.conv(trainingEligible="yes"), self.conv(trainingEligible=None),
            self.conv(licenseClass="restricted", trainingEligible=True),
            self.conv(scope="personal", trainingEligible=True),
        ]
        for doc in bad:
            self.assertEqual(self.post("shamwari", {"conversations": [doc]}).status_code, 400, doc)
        self.assertEqual(self.api.calls, [])

    def test_restricted_and_personal_rows_that_are_marked_untrainable_pass(self):
        for doc in (self.conv(licenseClass="restricted", trainingEligible=False),
                    self.conv(scope="personal", trainingEligible=False)):
            self.assertEqual(self.post("shamwari", {"conversations": [doc]}).status_code, 200)

    def test_one_bad_document_means_the_whole_batch_is_refused(self):
        r = self.post("shamwari", {"conversations": [self.conv(), self.conv(licenseClass=None)]})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.api.calls, [])

    def test_the_sink_is_an_allow_list(self):
        for db, cols in (("admin", {"x": [{}]}), ("shamwari", {"users": [{}]}), ("platform", {"apiKeys": [{}]})):
            self.assertEqual(self.post(db, cols).status_code, 400, (db, cols))
        self.assertEqual(self.api.calls, [])

    def test_usage_and_probe_rows_go_through(self):
        r = self.post("platform", {"usageEvents": [{"requestId": "r"}], "serviceHealth": [{"ok": True}]})
        self.assertEqual(r.status_code, 200)

    def test_an_api_refusal_and_an_outage_are_distinct(self):
        self.api.answers["sink"] = DataApiRefusal(413, "too many documents in one batch")
        self.assertEqual(self.post("platform", {"usageEvents": [{}]}).status_code, 413)
        self.api.answers["sink"] = DataApiUnavailable("x")
        self.assertEqual(self.post("platform", {"usageEvents": [{}]}).status_code, 503)


class Rest(Base):
    def test_rollup_shape_and_validation(self):
        r = self.http.get("/rollup", headers=AUTH, params={"owner_entity_id": "e1", "billing_period": "2026-10"})
        self.assertEqual(r.json(), {"total_tokens": 7, "total_cost": 0.5, "requests": 2})
        for params in ({"owner_entity_id": "e1", "billing_period": "2026-13"},
                       {"owner_entity_id": "e 1", "billing_period": "2026-10"}):
            self.assertEqual(self.http.get("/rollup", headers=AUTH, params=params).status_code, 422)

    def test_a_garbled_rollup_is_a_503_not_a_500(self):
        self.api.answers["usage_rollup"] = {"total_tokens": "lots", "total_cost": {"x": 1}}
        r = self.http.get("/rollup", headers=AUTH, params={"owner_entity_id": "e1", "billing_period": "2026-10"})
        self.assertEqual(r.status_code, 503)

    def test_the_upstream_cannot_rename_the_surface(self):
        self.api.answers["guardrails"] = {"surface": "other", "platform": [], "entity": []}
        self.assertEqual(self.http.get("/guardrails", headers=AUTH).json()["surface"], "shamwari")

    def test_guardrails_come_from_the_api(self):
        r = self.http.get("/guardrails", headers=AUTH)
        self.assertEqual(r.json(), {"surface": "shamwari", "platform": [{"id": "r1"}], "entity": []})
        self.assertEqual(self.http.get("/guardrails", headers=AUTH, params={"surface": "A B"}).status_code, 422)

    def reset_health(self):
        main._health.update(until=0.0, ok=False)

    def test_health_is_readiness_of_the_data_api_and_fails_closed(self):
        self.reset_health()
        self.assertEqual(self.http.get("/health").json()["ok"], True)
        self.reset_health()
        self.api.answers["whoami"] = DataApiUnavailable("x")
        r = self.http.get("/health")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"], {"error": "data_api_unavailable"})

    def test_hammering_health_costs_the_api_one_call_per_window(self):
        self.reset_health()
        for _ in range(50):
            self.http.get("/health")
        self.assertEqual([c for c in self.api.calls if c[0] == "whoami"].__len__(), 1)
        self.api.answers["whoami"] = DataApiUnavailable("x")
        self.reset_health()
        for _ in range(50):
            self.assertEqual(self.http.get("/health").status_code, 503)
        self.assertEqual([c for c in self.api.calls if c[0] == "whoami"].__len__(), 2)

    def test_key_verification_has_moved_and_says_so_without_admitting_anyone(self):
        r = self.http.post("/auth/verify", headers=AUTH, json={"key_prefix": "sk_shamwari_", "key_hash": "0" * 64})
        self.assertEqual(r.status_code, 501)
        self.assertEqual(r.json()["detail"]["error"], "key_verification_moved")
        self.assertEqual(self.api.calls, [])

    def test_the_parked_operator_routes_are_501_for_the_operator_and_closed_to_everyone_else(self):
        for method, path in (("POST", "/replay/usage"), ("POST", "/replay/requeue"), ("GET", "/replay/stats"),
                             ("GET", "/rollup/by-tier?billing_period=2026-10&owner_entity_id=e1")):
            self.assertEqual(self.http.request(method, path, headers=OPS).status_code, 501, path)
            self.assertEqual(self.http.request(method, path, headers=AUTH).status_code, 401, path)
        self.assertEqual(self.api.calls, [])


class NoDatabaseDriver(unittest.TestCase):
    def test_importing_core_loads_no_database_driver(self):
        code = (
            "import sys, main; "
            "bad = [m for m in ('motor','pymongo','asyncpg') if m in sys.modules]; "
            "print(bad); sys.exit(1 if bad else 0)"
        )
        r = subprocess.run(
            [sys.executable, "-c", code], cwd=HERE, capture_output=True, text=True,
            env={"PATH": os.environ.get("PATH", ""), "SHAMWARI_CORE_TOKEN": "t",
                 "NYUCHI_API_INTERNAL_KEY": "nyk_a.nys_b"},
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_core_does_not_start_without_its_data_api_key(self):
        r = subprocess.run(
            [sys.executable, "-c", "import main"], cwd=HERE, capture_output=True, text=True,
            env={"PATH": os.environ.get("PATH", ""), "SHAMWARI_CORE_TOKEN": "t"},
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("NYUCHI_API_INTERNAL_KEY", r.stderr)


if __name__ == "__main__":
    unittest.main()
