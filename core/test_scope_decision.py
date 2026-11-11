"""
The system, not the user, decides the scope (shamwari-ai/shamwari#81). Core's side.

What these pin:
  * the "needs the person's own information" rules give the same answers as the gateway's
    copy (the shared cases in scope_cases.json);
  * Core is authoritative: a caller cannot tell it `false`, cannot widen the scope with a
    claim, and no cloud request ever reaches the data API with a personal scope;
  * a scope outside what the caller holds is refused BEFORE any data call.

The counts are the tests: a personal path to the data API is a leak even if the response is
an error, so each case states how many calls were made.
"""

import json
import unittest
from pathlib import Path

import test_core_routes as t
from personal import needs_own_information

CASES = json.loads((Path(__file__).parent / "scope_cases.json").read_text())["cases"]
CLOUD_SAFE = {"community", "platform"}


class Rules(unittest.TestCase):
    def test_every_shared_case_gives_the_agreed_answer(self):
        for c in CASES:
            self.assertEqual(needs_own_information(c["text"]), c["needs_own_information"], c["text"])

    def test_a_non_string_never_reaches_the_rules_unchecked(self):
        # The route's model is the guard (min_length=1, str), not this function: say so.
        with self.assertRaises(Exception):
            needs_own_information(None)  # type: ignore[arg-type]


class CoreDecidesToo(t.Base):
    def test_a_personal_looking_question_is_answered_cloud_safe_and_flagged(self):
        r = self.search(query="What is my tax this month?")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["scope"], "platform")
        self.assertTrue(r.json()["needs_own_information"])
        (_, (body,)), = self.api.calls
        self.assertEqual((body["scope"], body["destination"]), ("platform", "cloud"))

    def test_a_plain_question_is_not_flagged(self):
        r = self.search(query="What does section 56 say?")
        self.assertFalse(r.json()["needs_own_information"])

    def test_the_gateway_saying_false_cannot_unflag_a_question_core_sees_as_personal(self):
        r = self.search(query="my payslip", needs_own_information=False)
        self.assertTrue(r.json()["needs_own_information"])

    def test_the_gateway_saying_true_is_honoured_and_changes_no_scope(self):
        r = self.search(query="What does section 56 say?", needs_own_information=True)
        self.assertTrue(r.json()["needs_own_information"])
        self.assertEqual(r.json()["scope"], "platform")

    def test_a_personal_looking_question_never_turns_a_cloud_request_personal(self):
        # The only way to ask for personal is to say so, and for Cloud that is a 409 with no call.
        r = self.search(query="my payslip", scope="personal")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["error"], "scope_requires_local_inference")
        self.assertEqual(self.api.calls, [])

    def test_no_cloud_request_of_any_shape_reaches_the_data_api_with_a_personal_scope(self):
        for query in ("my payslip", "section 56", "ndiri kuda mari yangu", "Can I vote?"):
            for scope in ("personal", "community", "platform"):
                for extra in ({}, {"needs_own_information": True}, {"granted_scopes": ["personal", "platform"]}):
                    self.api.calls.clear()
                    self.search(query=query, scope=scope, destination="cloud", **extra)
                    for _, (body,) in self.api.calls:
                        self.assertIn(body["scope"], CLOUD_SAFE, (query, scope, extra))
                        self.assertEqual(body["destination"], "cloud")
                    if scope == "personal":
                        self.assertEqual(self.api.calls, [], (query, extra))

    def test_a_scope_the_caller_does_not_hold_is_a_403_with_no_data_call(self):
        r = self.search(scope="platform", granted_scopes=["community"])
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"]["error"], "scope_not_granted")
        self.assertEqual(self.api.calls, [])

    def test_mind_personal_needs_the_personal_grant(self):
        r = self.search(scope="personal", destination="mind", granted_scopes=["community", "platform"])
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.api.calls, [])
        r = self.search(scope="personal", destination="mind", granted_scopes=["personal", "platform"])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(self.api.calls), 1)

    def test_an_absent_grant_list_narrows_nothing(self):
        self.assertEqual(self.search().status_code, 200)

    def test_core_and_the_gateway_disagreeing_on_the_scope_of_the_answer_fails_closed(self):
        # The data API answers for a different scope than the one decided: nothing is returned.
        self.api.answers["ground_search"] = {"scope": "community", "hit": True, "chunks": [{**t.CHUNK, "scope": "community"}]}
        r = self.search(scope="platform")
        self.assertEqual(r.status_code, 503)


if __name__ == "__main__":
    unittest.main()
