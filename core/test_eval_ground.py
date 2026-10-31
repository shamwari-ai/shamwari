"""
The citation evaluation harness, and the score the fixture must keep.

`test_the_fixture_keeps_its_score` is the offline regression gate: change the chunker,
the headings or the retriever so a question stops finding its section and it goes red.
"""

import asyncio
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import eval_ground as ev
import ingest_ground as ig

HERE = Path(__file__).parent
FIXTURE_TEXT = ev.FIXTURE.read_text(encoding="utf-8")


class Stub:
    """A retriever that answers from a table: question -> sections, in rank order."""

    def __init__(self, table):
        self.table = table

    async def search(self, question, k):
        return [ev.Hit(s) for s in self.table.get(question, [])[:k]]


class Questions(unittest.TestCase):
    def test_there_are_at_least_thirty_with_unique_ids_and_labels(self):
        data = ev.load_questions()
        qs = data["questions"]
        self.assertGreaterEqual(len(qs), 30)
        self.assertEqual(len({q["id"] for q in qs}), len(qs))
        for q in qs:
            self.assertTrue(q["question"].endswith("?"), q["id"])
            self.assertTrue(q["expected"] and q["evidence"], q["id"])

    def test_the_brief_topics_are_covered(self):
        topics = {q["topic"] for q in ev.load_questions()["questions"]}
        self.assertTrue({"equality", "citizenship", "president", "life", "fair-trial"} <= topics)
        text = " ".join(q["question"] for q in ev.load_questions()["questions"]).lower()
        self.assertIn("section 56", text)
        self.assertIn("terms can a president", text)

    def test_a_question_with_no_label_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "q.json"
            p.write_text(json.dumps({"questions": [{"id": "x", "question": "?", "expected": []}]}))
            with self.assertRaises(ValueError):
                ev.load_questions(p)


class Metrics(unittest.TestCase):
    def run_stub(self, table, qs, k=6):
        return asyncio.run(ev.evaluate(Stub(table), qs, k))

    def test_hit_rates_and_mrr(self):
        qs = [{"id": f"q{i}", "question": f"Q{i}", "expected": ["56"]} for i in range(4)]
        rep = self.run_stub(
            {"Q0": ["56"], "Q1": ["10", "56"], "Q2": ["1", "2", "3", "4", "5", "56"], "Q3": ["1", "2"]},
            qs,
            k=6,
        )
        self.assertEqual([r.rank for r in rep.results], [1, 2, 6, None])
        m = rep.metrics()
        self.assertEqual((m["hit_at_1"], m["hit_at_3"], m["hit_at_k"]), (0.25, 0.5, 0.75))
        self.assertAlmostEqual(m["mrr"], (1 + 0.5 + 1 / 6) / 4, places=3)

    def test_any_expected_section_is_a_hit_and_case_is_ignored(self):
        qs = [{"id": "q", "question": "Q", "expected": ["58", "59a"]}]
        self.assertEqual(self.run_stub({"Q": ["59A"]}, qs).results[0].rank, 1)

    def test_k_limits_what_counts(self):
        qs = [{"id": "q", "question": "Q", "expected": ["9"]}]
        self.assertIsNone(self.run_stub({"Q": ["1", "2", "9"]}, qs, k=2).results[0].rank)

    def test_a_regression_against_the_baseline_is_named(self):
        base = {"hit_at_1": 0.9, "hit_at_3": 1.0, "hit_at_k": 1.0, "mrr": 0.95}
        good = {"hit_at_1": 0.94, "hit_at_3": 1.0, "hit_at_k": 1.0, "mrr": 0.97}
        bad = {"hit_at_1": 0.8, "hit_at_3": 1.0, "hit_at_k": 0.9, "mrr": 0.9}
        self.assertEqual(ev.compare_baseline(good, base), [])
        out = ev.compare_baseline(bad, base)
        self.assertEqual(len(out), 3)
        self.assertEqual(ev.compare_baseline(bad, base, tolerance=0.2), [])

    def test_section_of_reads_the_field_then_the_heading(self):
        self.assertEqual(ev.section_of({"section": "56"}), "56")
        self.assertEqual(ev.section_of({"heading": "s 56(1)–(3) Equality"}), "56")
        self.assertEqual(ev.section_of({"heading": "s 7A Oath"}), "7A")
        self.assertIsNone(ev.section_of({"heading": "Preamble"}))


class FixtureGate(unittest.TestCase):
    def setUp(self):
        self.data = ev.load_questions()
        self.chunks = ig.chunk_document(FIXTURE_TEXT, self.data["cite_as"])

    def test_the_fixture_keeps_its_score(self):
        rep = asyncio.run(ev.evaluate(ev.LexicalRetriever(self.chunks), self.data["questions"], 6))
        m = rep.metrics()
        self.assertEqual(m["hit_at_k"], 1.0, [(r.id, r.got) for r in rep.misses()])
        self.assertGreaterEqual(m["hit_at_3"], 0.97)
        self.assertGreaterEqual(m["hit_at_1"], 0.85)
        self.assertGreaterEqual(m["mrr"], 0.9)

    def test_section_named_in_the_question_wins(self):
        hits = asyncio.run(ev.LexicalRetriever(self.chunks).search("What does section 56 say about equality?", 3))
        self.assertEqual(hits[0].section, "56")
        self.assertIn("s 56", hits[0].citation)

    def test_every_label_holds_on_the_fixture(self):
        self.assertEqual(ev.verify_labels(self.chunks, self.data["questions"]), [])

    def test_a_wrong_section_a_missing_section_and_missing_evidence_are_all_caught(self):
        qs = [
            {"id": "a", "question": "?", "expected": ["56"], "evidence": ["equal before the law"]},
            {"id": "b", "question": "?", "expected": ["57"], "evidence": ["equal before the law"]},
            {"id": "c", "question": "?", "expected": ["999"], "evidence": ["x"]},
            {"id": "d", "question": "?", "expected": ["143"], "evidence": ["five-year term"]},
        ]
        problems = ev.verify_labels(self.chunks, qs)
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any(p.startswith("b:") and "evidence" in p for p in problems))
        self.assertTrue(any(p.startswith("c:") and "not found" in p for p in problems))

    def test_evidence_may_straddle_a_line_break(self):
        qs = [{"id": "w", "question": "?", "expected": ["66"], "evidence": ["move freely within Zimbabwe"]}]
        self.assertEqual(ev.verify_labels(self.chunks, qs), [])


class Cli(unittest.TestCase):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = ev.main(list(argv))
        return code, out.getvalue()

    def test_offline_run_passes_its_gate(self):
        code, out = self.run_cli("--fixture", "--min-hit-at-k", "1.0", "--min-hit-at-1", "0.85")
        self.assertEqual(code, 0, out)
        self.assertIn("synthetic fixture (harness check only)", out)

    def test_an_unmet_gate_exits_non_zero(self):
        code, out = self.run_cli("--fixture", "--min-hit-at-1", "1.01")
        self.assertEqual(code, 1)
        self.assertIn("FAIL hit@1", out)

    def test_a_baseline_regression_exits_non_zero(self):
        with tempfile.TemporaryDirectory() as d:
            b = Path(d) / "b.json"
            b.write_text(json.dumps({"hit_at_1": 1.0, "mrr": 1.0}))
            code, out = self.run_cli("--fixture", "--baseline", str(b))
        self.assertEqual(code, 1)
        self.assertIn("baseline", out)

    def test_json_output_and_text_mode_on_a_supplied_file(self):
        code, out = self.run_cli("--text", str(ev.FIXTURE), "--json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.strip().splitlines()[-1])["questions"], len(ev.load_questions()["questions"]))

    def test_verify_labels_exits_non_zero_on_a_bad_label(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "q.json"
            data = ev.load_questions()
            data["questions"][0]["expected"] = ["500"]
            p.write_text(json.dumps(data))
            code, out = self.run_cli("--verify-labels", "--fixture", "--questions", str(p))
        self.assertEqual(code, 1)
        self.assertIn("LABEL q01: section 500 not found", out)

    def test_the_real_store_needs_a_token_and_it_is_never_printed(self):
        import os

        saved = os.environ.pop("SHAMWARI_CORE_TOKEN", None)
        try:
            with self.assertRaises(SystemExit) as cm:
                self.run_cli("--core-url", "http://core.invalid")
            self.assertIn("SHAMWARI_CORE_TOKEN", str(cm.exception))
        finally:
            if saved is not None:
                os.environ["SHAMWARI_CORE_TOKEN"] = saved


if __name__ == "__main__":
    unittest.main()
