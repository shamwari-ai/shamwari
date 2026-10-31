"""
Ground ingest, end to end against in-memory stores. Nothing here touches a network.

The cases are the gates a bad ingest would slip through: the licence refusal, the
dimension check that protects the vector index, an ingest run twice, a replacement
that fails half way, and the citation fields that make "section 56" findable.
"""

import asyncio
import io
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path

import fakes
import ingest_ground as ig

HERE = Path(__file__).parent
FIXTURE = (HERE / "eval" / "fixtures" / "synthetic-constitution.txt").read_text(encoding="utf-8")
TITLE = "Constitution of Zimbabwe Amendment (No. 20) Act 2013"
QUIET = lambda _msg: None  # noqa: E731


def ingest(pg=None, kb=None, embed=None, **over):
    pg = pg or fakes.FakePg()
    kb = kb if kb is not None else fakes.Collection()
    embed = embed or fakes.CountingEmbedder()
    args = dict(
        source_name="Constitution of Zimbabwe",
        text=FIXTURE,
        title=TITLE,
        slug="constitution-2013",
        effective_from=date(2013, 5, 22),
        dataset="zw-law-v1",
        log=QUIET,
    )
    args.update(over)
    out = asyncio.run(ig.run_ingest(pg, kb, embed, **args))
    return pg, kb, embed, out


def doc(n: int, title: str, subs: list[str]) -> str:
    """A numbered section of `subs` subsections, each about 700 tokens."""
    body = "\n".join(f"({i}) " + ("word " * 560).strip() for i in subs)
    return f"{n} {title}\n{body}\n"


class Chunking(unittest.TestCase):
    def chunks(self, text=FIXTURE):
        return ig.chunk_document(text, "Constitution (2013)")

    def test_a_section_is_a_chunk_and_carries_what_a_citation_needs(self):
        c = next(x for x in self.chunks() if x["section"] == "56")
        self.assertEqual(c["heading"], "s 56 Equality and non-discrimination")
        self.assertEqual(c["citation"], "Constitution (2013), s 56")
        self.assertEqual(c["sectionTitle"], "Equality and non-discrimination")
        self.assertEqual(c["subsections"], ["1", "2", "3", "4"])
        self.assertEqual((c["chapter"], c["chapterTitle"]), ("4", "Declaration Of Rights"))
        self.assertEqual((c["part"], c["partTitle"]), ("2", "Fundamental human rights and freedoms"))
        self.assertTrue(c["content"].startswith("(1) All persons are equal before the law"))

    def test_the_contents_list_does_not_register_a_section_twice(self):
        secs = [c["section"] for c in self.chunks() if c["section"]]
        self.assertEqual(len(secs), len(set(secs)))
        self.assertIn("164", secs)
        self.assertEqual(len(secs), 33)

    def test_ordinals_and_hashes_are_set(self):
        cs = self.chunks()
        self.assertEqual([c["ordinal"] for c in cs], list(range(len(cs))))
        self.assertTrue(all(len(c["contentHash"]) == 64 and c["tokenCount"] > 0 for c in cs))

    def test_a_long_section_is_cut_at_subsection_boundaries_and_cites_the_range(self):
        text = "CHAPTER 1\nFOUNDING\n" + doc(1, "A very long section", ["1", "2", "3", "4"])
        cs = ig.chunk_document(text, "X")
        self.assertGreater(len(cs), 1)
        self.assertTrue(all(c["section"] == "1" for c in cs))
        cites = [c["citation"] for c in cs]
        self.assertTrue(all(c.startswith("X, s 1(") for c in cites), cites)
        covered = [s for c in cs for s in c["subsections"]]
        self.assertEqual(covered, ["1", "2", "3", "4"])
        self.assertTrue(any("–" in c for c in cites) or len(cites) == 4)

    def test_one_overlong_subsection_is_split_on_paragraphs_with_overlap(self):
        paras = "\n\n".join(f"Paragraph {i}. " + ("lorem " * 120).strip() for i in range(12))
        text = f"CHAPTER 1\nFOUNDING\n1 Long\n(1) {paras}\n"
        cs = ig.chunk_document(text, "X")
        self.assertGreater(len(cs), 1)
        self.assertTrue(all(c["subsections"] == ["1"] for c in cs))
        self.assertTrue(all(c["tokenCount"] < ig.TARGET_TOKENS * 2 for c in cs))
        tail = cs[0]["content"].split("\n\n")[-1]
        self.assertIn(tail, cs[1]["content"], "no overlap carried across the cut")

    def test_a_wrapped_line_that_starts_with_a_date_is_not_a_heading(self):
        text = (
            "CHAPTER 1\nFOUNDING\n"
            "90 Last section here\nThe Act came into force on\n22 May 2013 and applies to all.\n"
        )
        cs = ig.chunk_document(text, "X")
        self.assertEqual([c["section"] for c in cs], ["90"])
        self.assertIn("22 May 2013", cs[0]["content"])

    def test_a_wrapped_cross_reference_does_not_open_a_chapter_or_part(self):
        text = (
            "CHAPTER 1\nFOUNDING\n1 One\n(1) The rules apply as set out in\n"
            "Chapter 4 applies to every person.\nPart 3 of this Act also applies.\n"
        )
        cs = ig.chunk_document(text, "X")
        self.assertEqual(len(cs), 1)
        self.assertEqual((cs[0]["chapter"], cs[0]["part"]), ("1", None))
        self.assertIn("Chapter 4 applies", cs[0]["content"])

    def test_schedule_paragraphs_cite_the_schedule(self):
        text = (
            "CHAPTER 1\nFOUNDING\n1 Only section\nText of the only section here.\n"
            "SIXTH SCHEDULE\nCOMMENCEMENT\n1 Definitions\nThe words used have these meanings.\n"
            "2 Savings\nThings done before remain valid.\n"
        )
        cs = ig.chunk_document(text, "X")
        para = [c for c in cs if c["kind"] == "paragraph"]
        self.assertEqual([c["citation"] for c in para], ["X, Sixth Schedule, para 1", "X, Sixth Schedule, para 2"])
        self.assertEqual(para[0]["schedule"], "Sixth")

    def test_pdf_furniture_is_removed(self):
        header = "CONSTITUTION OF ZIMBABWE AMENDMENT (No. 20) ACT, 2013"
        pages = "\f".join(f"{header}\n{n}\n" for n in range(1, 12))
        text = "CHAPTER 1\nFOUNDING\n1 Republic\n(1) Zimbabwe is one.\n" + pages + "(2) It is sovereign.\n"
        cs = ig.chunk_document(text, "X")
        body = cs[0]["content"]
        self.assertNotIn("AMENDMENT (No. 20)", body)
        self.assertNotRegex(body, r"(?m)^\d+$")
        self.assertIn("(2) It is sovereign.", body)

    def test_older_heading_styles_still_chunk(self):
        for text in ("56. Equality\nAll are equal.\n57. Privacy\nHome is private.\n",
                     "Section 56 Equality\nAll are equal.\nSection 57 Privacy\nHome is private.\n"):
            cs = ig.chunk_document(text, "X")
            self.assertEqual([c["section"] for c in cs], ["56", "57"], text)

    def test_text_with_no_structure_is_a_document_not_a_preamble(self):
        cs = ig.chunk_document("Just some notes\nwith no sections at all.", "Notes")
        self.assertEqual(len(cs), 1)
        self.assertEqual((cs[0]["kind"], cs[0]["citation"]), ("document", "Notes"))

    def test_the_embedded_text_carries_the_heading(self):
        c = next(x for x in self.chunks() if x["section"] == "56")
        self.assertTrue(ig.embed_input(TITLE, c).startswith(f"{TITLE} — s 56 Equality"))


class IngestHappyPath(unittest.TestCase):
    def test_chunks_land_with_vectors_licence_and_scope_fields(self):
        pg, kb, embed, out = ingest()
        self.assertEqual(out["chunks"], len(kb.docs))
        d = next(x for x in kb.docs if x["section"] == "56")
        self.assertEqual(len(d["embedding"]), 1024)
        self.assertEqual(d["embeddingModel"], "@cf/baai/bge-m3")
        self.assertEqual(d["licenseClass"], "open_weight")
        self.assertIsNone(d["ownerEntityId"])
        self.assertIsNone(d["supersededBy"])
        self.assertTrue(d["isActive"])
        self.assertEqual(d["effectiveFrom"].date(), date(2013, 5, 22))
        self.assertEqual(d["sourceSlug"], "constitution-2013")
        self.assertEqual(d["citation"], f"{TITLE}, s 56")
        self.assertEqual(d["authority"], "Parliament of Zimbabwe")
        self.assertEqual(d["jurisdiction"], "ZW")

    def test_the_audit_record_carries_effective_date_and_licence(self):
        pg, kb, embed, out = ingest()
        (args,) = pg.inserted
        self.assertEqual(args[0], 7)  # dataset id
        self.assertEqual(args[1], TITLE)
        self.assertEqual(args[11], date(2013, 5, 22))  # effective_from
        self.assertEqual(args[12], "open_weight")
        self.assertEqual(args[13], "Public document (operator-confirmed)")
        self.assertEqual(args[14]["slug"], "constitution-2013")
        self.assertEqual(args[14]["chunker"], ig.CHUNKER)
        sqls = " ".join(s for s, _ in pg.executed)
        self.assertIn("mongodb_ground_id", sqls)
        self.assertIn("doc_count", sqls)

    def test_a_source_that_may_not_train_mind_is_stamped_restricted(self):
        pg, kb, embed, out = ingest(pg=fakes.FakePg(mind_eligible=False))
        self.assertEqual({d["licenseClass"] for d in kb.docs}, {"restricted"})
        self.assertEqual(out["license_class"], "restricted")

    def test_the_heading_is_what_gets_embedded(self):
        pg, kb, embed, out = ingest()
        sent = [t for batch in embed.calls for t in batch]
        self.assertTrue(any(t.startswith(f"{TITLE} — s 56 Equality") for t in sent))

    def test_batches_of_32(self):
        pg, kb, embed, out = ingest()
        self.assertEqual([len(c) for c in embed.calls], [32, 1])


class Gates(unittest.TestCase):
    def assertRefused(self, pg=None, kb=None, embed=None, **over):
        pg = pg or fakes.FakePg()
        kb = kb if kb is not None else fakes.Collection()
        embed = embed or fakes.CountingEmbedder()
        with self.assertRaises(SystemExit) as cm:
            ingest(pg=pg, kb=kb, embed=embed, **over)
        self.assertEqual(pg.inserted, [])
        self.assertEqual(pg.executed, [])
        self.assertEqual(kb.docs, [])
        return cm.exception, embed

    def test_an_unapproved_source_is_refused_before_anything_is_embedded_or_written(self):
        exc, embed = self.assertRefused(pg=fakes.FakePg(is_approved=False))
        self.assertIn("REFUSED", str(exc))
        self.assertIn("not approved", str(exc))
        self.assertEqual(embed.calls, [])

    def test_an_approved_but_not_ground_eligible_source_is_refused(self):
        exc, embed = self.assertRefused(pg=fakes.FakePg(ground_eligible=False))
        self.assertIn("not ground_eligible", str(exc))
        self.assertEqual(embed.calls, [])

    def test_an_unknown_source_and_an_unknown_dataset_exit(self):
        exc, _ = self.assertRefused(source_name="Nonexistent Source")
        self.assertIn("no corpus_source", str(exc))
        exc, _ = self.assertRefused(dataset="zw-nothing-v9")
        self.assertIn("no dataset", str(exc))

    def test_a_wrong_dimension_is_a_hard_failure_that_writes_nothing(self):
        async def short(texts):
            return [[0.0] * 768 for _ in texts]

        pg, kb = fakes.FakePg(), fakes.Collection()
        with self.assertRaisesRegex(RuntimeError, "768 != 1024"):
            ingest(pg=pg, kb=kb, embed=short)
        self.assertEqual(kb.docs, [])
        self.assertEqual(pg.inserted, [])

    def test_a_short_batch_from_the_embedder_is_a_failure_that_writes_nothing(self):
        async def drops_one(texts):
            return [fakes.hash_vector(t) for t in texts[:-1]]

        pg, kb = fakes.FakePg(), fakes.Collection()
        with self.assertRaisesRegex(RuntimeError, "embedded"):
            ingest(pg=pg, kb=kb, embed=drops_one)
        self.assertEqual((kb.docs, pg.inserted), ([], []))

    def test_a_failure_part_way_through_leaves_no_half_ingested_document(self):
        calls = {"n": 0}

        async def fails_second_batch(texts):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("workers ai down")
            return [fakes.hash_vector(t) for t in texts]

        pg, kb = fakes.FakePg(), fakes.Collection()
        with self.assertRaisesRegex(RuntimeError, "workers ai down"):
            ingest(pg=pg, kb=kb, embed=fails_second_batch)
        self.assertEqual((kb.docs, pg.inserted), ([], []))

    def test_check_dims_accepts_1024_and_names_the_expected_size(self):
        ig.check_dims([[0.0] * 1024])
        with self.assertRaisesRegex(RuntimeError, "expects 1024"):
            ig.check_dims([[0.0] * 1023])


class Rerun(unittest.TestCase):
    def test_running_the_same_slug_twice_is_refused_and_changes_nothing(self):
        pg, kb, embed, out = ingest()
        before = list(kb.docs)
        with self.assertRaises(SystemExit) as cm:
            ingest(pg=pg, kb=kb)
        self.assertIn("--replace", str(cm.exception))
        self.assertEqual(kb.docs, before)
        self.assertEqual(len(pg.inserted), 1)

    def test_replace_retires_the_old_text_softly_and_points_it_at_the_new_document(self):
        pg, kb, embed, out = ingest()
        n = len(kb.docs)
        old_ids = {d["_id"] for d in kb.docs}
        pg2, kb2, embed2, out2 = ingest(pg=pg, kb=kb, replace=True)
        self.assertEqual(out2["retired"], n)
        active = [d for d in kb.docs if d["isActive"]]
        retired = [d for d in kb.docs if not d["isActive"]]
        self.assertEqual(len(active), n)
        self.assertEqual({d["_id"] for d in retired}, old_ids)
        self.assertEqual({d["supersededBy"] for d in retired}, {out2["document_id"]})
        self.assertEqual(len(kb.docs), 2 * n, "retire is soft: nothing is deleted")

    def test_a_failed_replacement_leaves_the_old_text_serving(self):
        pg, kb, embed, out = ingest()

        class FailingInsert(fakes.Collection):
            async def insert_many(self, docs, ordered=True):
                raise RuntimeError("mongo down")

        failing = FailingInsert(kb.docs)
        with self.assertRaisesRegex(RuntimeError, "mongo down"):
            ingest(pg=pg, kb=failing, replace=True)
        self.assertTrue(all(d["isActive"] and d["supersededBy"] is None for d in kb.docs))


class Credentials(unittest.TestCase):
    def run_py(self, code: str, env: dict[str, str]):
        return subprocess.run(
            [sys.executable, "-c", code],
            cwd=HERE,
            env={"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(HERE), **env},
            capture_output=True,
            text=True,
        )

    def test_importing_needs_no_credentials(self):
        r = self.run_py("import ingest_ground", {})
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_dry_run_needs_no_credentials_and_makes_no_network_call(self):
        r = self.run_py(
            "import ingest_ground as g; g.main(['--dry-run','--file','eval/fixtures/synthetic-constitution.txt',"
            "'--cite-as','Fixture'])",
            {},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Fixture, s 56", r.stdout)
        self.assertIn("33 distinct sections", r.stdout)

    def test_an_ingest_without_credentials_names_what_is_missing_and_where_not_to_put_them(self):
        r = self.run_py(
            "import ingest_ground as g; g.main(['--source','x','--file','eval/fixtures/synthetic-constitution.txt',"
            "'--title','t','--slug','s'])",
            {},
        )
        self.assertNotEqual(r.returncode, 0)
        for name in ("SUPABASE_DB_URL", "MONGODB_URI", "CF_ACCOUNT_ID", "CF_API_TOKEN"):
            self.assertIn(name, r.stderr)
        self.assertIn("Do not set them on the Core Fly app", r.stderr)


class Cli(unittest.TestCase):
    def test_dry_run_prints_citations(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            ig.main(["--dry-run", "--file", str(HERE / "eval/fixtures/synthetic-constitution.txt"), "--title", "Doc"])
        self.assertIn("Doc, s 48", buf.getvalue())

    def test_the_command_requires_its_arguments(self):
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            ig.main(["--source", "x"])


if __name__ == "__main__":
    unittest.main()
