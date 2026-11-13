"""
The Data API client: fail closed, pass rule refusals through, retry only where safe, log no secret.
No network: httpx's MockTransport stands in for the Nyuchi API.
"""

import asyncio
import json
import logging
import os
import unittest
from unittest import mock

import httpx

from nyuchi_api import DataApi, DataApiRefusal, DataApiUnavailable, ServersApi, data_api_from_env

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


def servers(handler, **kw):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://core-data.internal:8080")
    return ServersApi(base_url="http://core-data.internal:8080", http=http, backoff=0, **kw)


OWNER = "person_abc"
GROUND = {"scope": "platform", "chunks": []}


class ServersApiRequests(unittest.TestCase):
    def test_routes_are_the_servers_api_ones(self):
        seen = []

        def handler(req):
            seen.append((req.method, req.url.path, dict(req.url.params)))
            return httpx.Response(200, json={**GROUND, "written": {}})

        c = servers(handler)
        run(c.ground_search({"query": "q", "scope": "platform", "owner_entity_id": "e1"}))
        run(c.sink("shamwari", {"groundMisses": [{"a": 1}]}))
        run(c.guardrails("shamwari"))
        self.assertEqual(
            seen,
            [
                ("POST", "/v1/shamwari/ground/search", {}),
                ("POST", "/v1/shamwari/sink", {}),
                ("GET", "/v1/shamwari/guardrails", {"applies_to": "shamwari"}),
            ],
        )

    def test_a_personal_search_names_the_owner_in_the_header_and_never_in_the_body(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json={"scope": "personal", "chunks": []})

        run(servers(handler).ground_search({"query": "q", "scope": "personal", "destination": "mind", "owner_entity_id": OWNER}))
        self.assertEqual(seen[0].headers["x-shamwari-person"], OWNER)
        self.assertNotIn("owner_entity_id", json.loads(seen[0].content))
        self.assertNotIn(OWNER, seen[0].content.decode())

    def test_a_personal_search_with_no_owner_is_refused_before_any_call(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json=GROUND)

        with self.assertRaises(ValueError):
            run(servers(handler).ground_search({"query": "q", "scope": "personal"}))
        self.assertEqual(seen, [])

    def test_a_non_personal_search_sends_no_person_header(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json=GROUND)

        run(servers(handler).ground_search({"query": "q", "scope": "community", "owner_entity_id": "e1"}))
        self.assertNotIn("x-shamwari-person", seen[0].headers)

    def test_the_old_guardrails_path_is_not_used(self):
        seen = []

        def handler(req):
            seen.append(req.url.path)
            return httpx.Response(200, json={})

        run(servers(handler).guardrails("shamwari"))
        self.assertNotIn("/v1/ai/guardrails", seen)


class ServersApiAuth(unittest.TestCase):
    def _headers(self, **kw):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json=GROUND)

        run(kw.pop("make")(handler).ground_search({"query": "q", "scope": "platform", "owner_entity_id": "e1"}))
        return seen[0].headers

    def test_an_internal_host_gets_no_key_and_no_token_even_if_some_are_configured(self):
        h = self._headers(make=lambda handler: servers(handler, key=KEY, token="TOKENVALUE"))
        for name in ("authorization", "x-nyuchi-internal-key", "x-api-key"):
            self.assertNotIn(name, h)

    def test_internal_means_the_dot_internal_suffix_not_a_lookalike(self):
        for url in ("http://x.internal.example.com", "http://internal", "https://api.nyuchiservers.com"):
            with self.assertRaises(ValueError, msg=url):
                ServersApi(base_url=url)

    def test_a_non_internal_host_sends_the_key_and_the_token(self):
        def make(handler):
            http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.nyuchiservers.com")
            return ServersApi(base_url="https://api.nyuchiservers.com", key=KEY, token="TOKENVALUE", http=http, backoff=0)

        h = self._headers(make=make)
        self.assertEqual(h["authorization"], "Bearer TOKENVALUE")
        self.assertEqual(h["x-nyuchi-internal-key"], KEY)

    def test_a_non_internal_host_needs_both(self):
        for kw in ({}, {"key": KEY}, {"token": "t"}):
            with self.assertRaises(ValueError):
                ServersApi(base_url="https://api.nyuchiservers.com", **kw)

    def test_a_lookalike_never_gets_the_credentials_sent_as_if_internal(self):
        # the host decides, so a name merely containing "internal" must be treated as outside
        with self.assertRaises(ValueError):
            ServersApi(base_url="https://core.internal.evil.test")


class ServersApiRefusals(unittest.TestCase):
    def test_the_error_member_of_a_problem_json_body_is_what_the_caller_sees(self):
        body = {"type": "about:blank", "title": "Conflict", "status": 409, "detail": "no", "error": "scope_requires_local_inference"}
        with self.assertRaises(DataApiRefusal) as cm:
            run(servers(lambda r: httpx.Response(409, json=body)).ground_search({"query": "q", "scope": "platform"}))
        self.assertEqual(cm.exception.status_code, 409)
        self.assertEqual(cm.exception.detail["error"], "scope_requires_local_inference")

    def test_a_problem_body_without_error_still_says_it_was_refused(self):
        with self.assertRaises(DataApiRefusal) as cm:
            run(servers(lambda r: httpx.Response(422, json={"title": "x", "status": 422})).guardrails("shamwari"))
        self.assertEqual(cm.exception.detail["error"], "refused")

    def test_the_nyuchi_api_shape_still_unwraps(self):
        with self.assertRaises(DataApiRefusal) as cm:
            run(client(lambda r: httpx.Response(409, json={"detail": {"error": "x"}})).guardrails("s"))
        self.assertEqual(cm.exception.detail, {"error": "x"})


class FlagOffRefusalsAreUnchanged(unittest.TestCase):
    """The RFC 9457 reading lives in ServersApi only. The Nyuchi API client relays as before."""

    def refusal(self, status, body):
        with self.assertRaises(DataApiRefusal) as cm:
            run(client(lambda r: httpx.Response(status, json=body)).guardrails("s"))
        return cm.exception.detail

    def test_a_top_level_error_body_is_passed_on_whole_with_its_other_fields(self):
        body = {"error": "too_many", "limit": 5, "detail": "prose"}
        self.assertEqual(self.refusal(422, body), "prose")  # FastAPI-style: detail wins, as before

    def test_a_body_with_a_top_level_error_and_no_detail_is_passed_on_whole(self):
        body = {"error": "too_many", "limit": 5}
        self.assertEqual(self.refusal(422, body), body)

    def test_a_problem_shaped_body_with_a_string_detail_gives_that_string(self):
        self.assertEqual(self.refusal(400, {"type": "t", "title": "x", "status": 400, "detail": "prose"}), "prose")

    def test_the_servers_api_client_does_read_the_error_member(self):
        body = {"type": "t", "title": "x", "status": 409, "detail": "prose", "error": "e1", "limit": 5}
        with self.assertRaises(DataApiRefusal) as cm:
            run(servers(lambda r: httpx.Response(409, json=body)).guardrails("s"))
        self.assertEqual(cm.exception.detail, {"error": "e1", "message": "prose"})


class ServersApiReadiness(unittest.TestCase):
    def test_a_ready_object_is_ready(self):
        self.assertEqual(run(servers(lambda r: httpx.Response(200, json={"status": "ready"})).whoami()), {"status": "ready"})

    def test_a_plain_200_is_ready_too_so_fly_s_check_cannot_fail_forever(self):
        for res in (httpx.Response(200, text="ok"), httpx.Response(200), httpx.Response(200, json=["x"])):
            self.assertEqual(run(servers(lambda r, res=res: res).whoami()), {"status": "ready"})

    def test_a_503_problem_is_not_ready(self):
        problem = {"type": "t", "title": "Not ready", "status": 503}
        with self.assertRaises(DataApiUnavailable):
            run(servers(lambda r: httpx.Response(503, json=problem)).whoami())

    def test_the_nyuchi_client_still_needs_a_json_object_from_whoami(self):
        with self.assertRaises(DataApiUnavailable):
            run(client(lambda r: httpx.Response(200, text="ok")).whoami())


class ServersApiIsADataApi(unittest.TestCase):
    def test_it_shares_the_parent_s_retry_and_client_setup(self):
        calls = []

        def handler(req):
            calls.append(1)
            raise httpx.ConnectError("down")

        with self.assertRaises(DataApiUnavailable):
            run(servers(handler).guardrails("s"))
        self.assertEqual(len(calls), 2)  # one retry, from DataApi

    def test_it_never_carries_the_nyuchi_api_headers(self):
        seen = []

        def handler(req):
            seen.append(req)
            return httpx.Response(200, json={})

        run(servers(handler).guardrails("s"))
        self.assertNotIn("x-api-key", seen[0].headers)
        self.assertNotEqual(seen[0].headers.get("host"), "api.nyuchi.com")


class Selection(unittest.TestCase):
    def test_unset_means_the_nyuchi_api_client(self):
        with mock.patch.dict(os.environ, {"NYUCHI_API_INTERNAL_KEY": KEY}, clear=True):
            self.assertIsInstance(data_api_from_env(), DataApi)
            self.assertNotIsInstance(data_api_from_env(), ServersApi)

    def test_a_blank_value_is_unset(self):
        with mock.patch.dict(os.environ, {"NYUCHI_API_INTERNAL_KEY": KEY, "SERVERS_API_URL": "  "}, clear=True):
            self.assertNotIsInstance(data_api_from_env(), ServersApi)

    def test_set_selects_the_servers_api_and_needs_no_nyuchi_key(self):
        with mock.patch.dict(os.environ, {"SERVERS_API_URL": "http://servers.internal:8080"}, clear=True):
            self.assertIsInstance(data_api_from_env(), ServersApi)

    def test_set_to_an_outside_host_refuses_to_start_core_holds_no_key_for_it(self):
        with mock.patch.dict(os.environ, {"SERVERS_API_URL": "https://api.nyuchiservers.com"}, clear=True):
            with self.assertRaises(ValueError):
                data_api_from_env()


if __name__ == "__main__":
    unittest.main()
