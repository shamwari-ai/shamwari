"""
The Data API client: fail closed, pass rule refusals through, retry only where safe, log no secret.
No network: httpx's MockTransport stands in for the Nyuchi API.
"""

import asyncio
import logging
import unittest

import httpx

from nyuchi_api import DataApi, DataApiRefusal, DataApiUnavailable

KEY = "nyk_abc123.nys_SECRETVALUE"


def client(handler, **kw):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://api.test")
    return DataApi(key=KEY, http=http, backoff=0, **kw)


def run(coro):
    return asyncio.run(coro)


class Requests(unittest.TestCase):
    def test_every_request_carries_the_key_and_the_public_host(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json={"ok": True})

        run(client(handler).whoami())
        h = seen[0].headers
        self.assertEqual(h["x-api-key"], KEY)
        self.assertEqual(h["host"], "api.nyuchi.com")
        self.assertEqual(seen[0].url.path, "/v1/shamwari/whoami")

    def test_each_call_goes_to_its_route_with_its_shape(self):
        seen = []

        def handler(req):
            seen.append((req.method, req.url.path, dict(req.url.params), req.content))
            return httpx.Response(200, json={"scope": "platform", "chunks": [], "written": {}})

        c = client(handler)
        run(c.ground_search({"query": "q"}))
        run(c.sink("shamwari", {"groundMisses": [{"a": 1}]}))
        run(c.usage_rollup("e1", "2026-10"))
        run(c.guardrails("shamwari"))
        self.assertEqual(
            [(m, p) for m, p, _, _ in seen],
            [
                ("POST", "/v1/shamwari/ground/search"),
                ("POST", "/v1/shamwari/sink"),
                ("GET", "/v1/shamwari/usage/rollup"),
                ("GET", "/v1/ai/guardrails"),
            ],
        )
        self.assertEqual(seen[2][2], {"owner_entity_id": "e1", "billing_period": "2026-10"})
        self.assertEqual(seen[3][2], {"applies_to": "shamwari"})


class FailClosed(unittest.TestCase):
    def test_a_transport_error_is_unavailable_after_one_retry(self):
        calls = []

        def handler(req):
            calls.append(1)
            raise httpx.ConnectError("down")

        with self.assertRaises(DataApiUnavailable):
            run(client(handler).whoami())
        self.assertEqual(len(calls), 2)

    def test_a_transient_503_is_retried_once_and_can_recover(self):
        answers = [httpx.Response(503), httpx.Response(200, json={"ok": 1})]
        self.assertEqual(run(client(lambda r: answers.pop(0)).whoami()), {"ok": 1})

    def test_a_persistent_5xx_is_unavailable(self):
        for status in (500, 502, 503, 504):
            with self.assertRaises(DataApiUnavailable, msg=status):
                run(client(lambda r, s=status: httpx.Response(s)).whoami())

    def test_core_s_own_credential_being_refused_is_unavailable_never_a_caller_error(self):
        for status in (401, 403):
            calls = []

            def handler(req, s=status):
                calls.append(1)
                return httpx.Response(s, json={"detail": "key lacks shamwari:service"})

            with self.assertRaises(DataApiUnavailable):
                run(client(handler).ground_search({"query": "q"}))
            self.assertEqual(len(calls), 1, "a refused credential is not retried")

    def test_rate_limiting_is_unavailable_and_not_hammered(self):
        calls = []
        with self.assertRaises(DataApiUnavailable):
            run(client(lambda r: (calls.append(1), httpx.Response(429))[1]).whoami())
        self.assertEqual(len(calls), 1)

    def test_a_non_json_or_non_object_body_is_unavailable(self):
        for resp in (httpx.Response(200, text="<html>"), httpx.Response(200, json=[1, 2])):
            with self.assertRaises(DataApiUnavailable):
                run(client(lambda r, x=resp: x).whoami())

    def test_a_ground_answer_without_chunks_or_scope_is_unavailable(self):
        with self.assertRaises(DataApiUnavailable):
            run(client(lambda r: httpx.Response(200, json={"hit": False})).ground_search({"query": "q"}))


class Refusals(unittest.TestCase):
    def test_a_rule_refusal_is_passed_on_with_the_apis_own_body_unwrapped(self):
        body = {"detail": {"error": "scope_requires_local_inference", "scope": "personal"}}
        with self.assertRaises(DataApiRefusal) as cm:
            run(client(lambda r: httpx.Response(409, json=body)).ground_search({"query": "q"}))
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(cm.exception.detail["error"], "scope_requires_local_inference")

    def test_a_missing_route_is_an_outage_not_a_client_error(self):
        with self.assertRaises(DataApiUnavailable):
            run(client(lambda r: httpx.Response(404, json={"detail": "Not Found"})).whoami())

    def test_400_413_and_422_are_refusals_not_outages(self):
        for status in (400, 413, 422):
            with self.assertRaises(DataApiRefusal, msg=status):
                run(client(lambda r, s=status: httpx.Response(s, json={"detail": "no"})).sink("x", {}))

    def test_a_refusal_is_not_retried(self):
        calls = []
        with self.assertRaises(DataApiRefusal):
            run(client(lambda r: (calls.append(1), httpx.Response(409, json={"detail": "x"}))[1]).sink("x", {}))
        self.assertEqual(len(calls), 1)


class NoSecretsInLogs(unittest.TestCase):
    def test_no_failure_path_logs_the_key_a_header_or_a_body(self):
        marker = "PERSONAL-QUESTION-TEXT"
        with self.assertLogs("shamwari.core.data_api", level=logging.DEBUG) as cm:
            for handler in (
                lambda r: httpx.Response(401, json={"detail": KEY}),
                lambda r: httpx.Response(500, text=KEY),
                lambda r: httpx.Response(200, text=KEY),
                lambda r: (_ for _ in ()).throw(httpx.ConnectError(KEY)),
            ):
                try:
                    run(client(handler).ground_search({"query": marker}))
                except DataApiUnavailable:
                    pass
        text = "\n".join(cm.output)
        for secret in (KEY, "SECRETVALUE", marker):
            self.assertNotIn(secret, text)

    def test_a_missing_key_refuses_to_start(self):
        with self.assertRaises(ValueError):
            DataApi(key="")


if __name__ == "__main__":
    unittest.main()
