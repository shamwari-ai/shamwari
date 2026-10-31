"""
ingest -> store -> Core /ground/search, against the in-memory store.

This is the local end-to-end for Ground: the text goes through the real chunker and the
real ingest into a store that interprets Core's real aggregation pipelines, and a
question comes back with the section it must cite. It also plants the rows that must
never come back (another entity's personal chunk, repealed text, inactive text) so the
owner, supersededBy and isActive filters in ground_search are what the test exercises.
"""

import asyncio
import os
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

os.environ.setdefault("MONGODB_URI", "mongodb://placeholder")
os.environ["SHAMWARI_CORE_TOKEN"] = "worker-token"
os.environ["SHAMWARI_OPS_TOKEN"] = "ops-token"  # same as test_ops_auth: whichever imports main first sets it

import fakes
import ingest_ground as ig
from eval_ground import CoreRetriever, evaluate, load_questions

try:
    import httpx
    from fastapi.testclient import TestClient

    import main

    SKIP = None
except Exception as e:  # noqa: BLE001 - any import problem means "deps not installed"
    main = None
    SKIP = f"core dependencies not installed: {e}"

HERE = Path(__file__).parent
FIXTURE = (HERE / "eval" / "fixtures" / "synthetic-constitution.txt").read_text(encoding="utf-8")
AUTH = {"Authorization": "Bearer worker-token"}
TITLE = "Constitution of Zimbabwe Amendment (No. 20) Act 2013"


def ingested_client():
    client = fakes.Client()
    kb = client["shamwari"].knowledgeBase
    asyncio.run(
        ig.run_ingest(
            fakes.FakePg(), kb, fakes.CountingEmbedder(),
            source_name="Constitution of Zimbabwe", text=FIXTURE, title=TITLE,
            slug="constitution-2013", effective_from=date(2013, 5, 22),
            dataset="zw-law-v1", log=lambda _m: None,
        )
    )
    return client, kb


def planted(**over):
    base = {
        "title": "Someone's pod", "heading": "s 56 Equality and non-discrimination",
        "content": "All persons are equal before the law, said the private note.",
        "authority": "Private", "resourceType": "note", "sourceUrl": None, "effectiveFrom": None,
        "section": "56", "citation": "PRIVATE, s 56", "language": "en",
        "ownerEntityId": None, "supersededBy": None, "isActive": True,
        "embedding": fakes.hash_vector("equal before the law equality discrimination"),
    }
    base.update(over)
    return base


@unittest.skipIf(SKIP, SKIP or "")
class GroundPipeline(unittest.TestCase):
    def setUp(self):
        self.real = main.client
        self.addCleanup(setattr, main, "client", self.real)
        main.client, self.kb = ingested_client()
        self.http = TestClient(main.app, raise_server_exceptions=False)

    def search(self, q, *, embed=True, **over):
        body = {"query": q, "owner_entity_id": "e1", "scope": "platform", "destination": "cloud", "top_k": 6}
        if embed:
            body["embedding"] = fakes.hash_vector(q)
        body.update(over)
        return self.http.post("/ground/search", headers=AUTH, json=body)

    def test_a_question_comes_back_with_the_section_to_cite(self):
        r = self.search("What does section 56 say about equality?")
        self.assertEqual(r.status_code, 200, r.text)
        top = r.json()["chunks"][0]
        self.assertTrue(r.json()["hit"])
        self.assertEqual(top["section"], "56")
        self.assertEqual(top["citation"], f"{TITLE}, s 56")
        self.assertEqual(top["heading"], "s 56 Equality and non-discrimination")
        self.assertEqual(top["effective_from"], "2013-05-22")
        self.assertEqual(top["authority"], "Parliament of Zimbabwe")
        self.assertEqual(top["scope"], "platform")

    def test_keyword_only_retrieval_finds_it_too(self):
        r = self.search("How many terms can a President serve?", embed=False)
        self.assertIn(r.json()["chunks"][0]["section"], {"91", "95"})

    def test_the_evaluation_harness_scores_the_real_search_path(self):
        """CoreRetriever -> HTTP -> ground_search -> pipelines -> the ingested store."""
        real_client = httpx.AsyncClient

        def asgi_client(**kw):
            return real_client(transport=httpx.ASGITransport(app=main.app), base_url="http://core", **kw)

        class Embeds:
            async def __call__(self, texts):
                return [fakes.hash_vector(t) for t in texts]

        with mock.patch("httpx.AsyncClient", asgi_client):
            rep = asyncio.run(
                evaluate(CoreRetriever("http://core", "worker-token", Embeds()), load_questions()["questions"], 6)
            )
        m = rep.metrics()
        self.assertGreaterEqual(m["hit_at_k"], 0.95, [(r.id, r.got) for r in rep.misses()])
        self.assertGreaterEqual(m["hit_at_1"], 0.8)

    # -- what must never come back ------------------------------------------------

    def test_another_entitys_personal_chunk_never_reaches_a_platform_or_community_search(self):
        """The planted chunk matches the question exactly, by words and by vector. top_k is wide
        enough to return every row the filters let through, so a missing owner filter on either
        branch shows up as the planted chunk, not as a lucky ranking."""
        q = "All persons are equal before the law"
        asyncio.run(
            self.kb.insert_many(
                [planted(ownerEntityId="someone-else", content=q, heading=q, embedding=fakes.hash_vector(q))]
            )
        )
        for scope in ("platform", "community"):
            for embed in (True, False):
                r = self.search(q, scope=scope, embed=embed, top_k=40)
                cites = [c["citation"] for c in r.json()["chunks"]]
                self.assertNotIn("PRIVATE, s 56", cites, (scope, embed))
                self.assertTrue(cites, "the search should still answer from the shared corpus")

    def test_repealed_and_inactive_text_is_never_cited(self):
        q = "All persons are equal before the law"
        same = dict(content=q, heading=q, embedding=fakes.hash_vector(q))
        asyncio.run(
            self.kb.insert_many(
                [planted(supersededBy="newer", citation="REPEALED, s 56", **same),
                 planted(isActive=False, citation="INACTIVE, s 56", **same)]
            )
        )
        for embed in (True, False):
            r = self.search(q, embed=embed, top_k=40)
            cites = " ".join(c["citation"] for c in r.json()["chunks"])
            self.assertNotIn("REPEALED", cites)
            self.assertNotIn("INACTIVE", cites)

    def test_a_miss_is_recorded_for_the_corpus_roadmap(self):
        r = self.search("zzzqqq unrelated xylophone", embed=False)
        self.assertFalse(r.json()["hit"])
        misses = main.client["shamwari"].groundMisses.docs
        self.assertEqual([m["query"] for m in misses], ["zzzqqq unrelated xylophone"])

    # -- rule 1 -----------------------------------------------------------------

    def test_personal_scope_to_cloud_is_a_409_with_no_retrieval_at_all(self):
        with mock.patch.object(fakes.Collection, "aggregate", side_effect=AssertionError("store touched")) as agg:
            r = self.search("my payslip", scope="personal", destination="cloud", embed=False)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["error"], "scope_requires_local_inference")
        agg.assert_not_called()

    def test_a_mind_query_that_arrives_embedded_is_refused_before_retrieval(self):
        with mock.patch.object(fakes.Collection, "aggregate", side_effect=AssertionError("store touched")) as agg:
            r = self.search("my payslip", scope="personal", destination="mind", embed=True)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["error"], "edge_embedding_forbidden")
        agg.assert_not_called()


if __name__ == "__main__":
    unittest.main()
