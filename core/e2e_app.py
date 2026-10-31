"""
A Core process for the end-to-end contract test (gateway/test/e2e.test.ts).

Test-only: not copied into the image. It is the real `main.app`, unchanged, with three
things swapped in around it: an in-memory store holding the ingested fixture corpus
plus a chunk that must never be served, and a handful of /__e2e/* routes the test uses
to read what Core did. The routes exist only in this process.

    python -m uvicorn e2e_app:app --port 8765

Why a real Core process and not a mock of its replies: the claim under test is that the
Worker's requests are what Core accepts, and that Core's refusals are what the Worker
expects. A mock of Core would agree with the Worker by construction.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from datetime import date
from pathlib import Path
from typing import Any

if os.environ.get("E2E_APP") != "1":
    # Importing this module replaces Core's store and adds unauthenticated routes. It runs
    # only from scripts/e2e.sh, which sets this.
    raise RuntimeError("e2e_app is a test harness: run it through scripts/e2e.sh")

os.environ.setdefault("MONGODB_URI", "mongodb://e2e.invalid")
os.environ["SHAMWARI_CORE_TOKEN"] = os.environ.get("E2E_CORE_TOKEN", "e2e-core-token")

import fakes
import ingest_ground
import main
from fastapi import Body

HERE = Path(__file__).parent
TITLE = "Constitution of Zimbabwe Amendment (No. 20) Act 2013"
Q = "All persons are equal before the law"

client = fakes.Client()
kb = client["shamwari"].knowledgeBase
embedder = fakes.CountingEmbedder()  # ingest-time; separate from the question embedder below

asyncio.run(
    ingest_ground.run_ingest(
        fakes.FakePg(), kb, embedder,
        source_name="Constitution of Zimbabwe",
        text=(HERE / "eval" / "fixtures" / "synthetic-constitution.txt").read_text(encoding="utf-8"),
        title=TITLE, slug="constitution-2013", effective_from=date(2013, 5, 22),
        dataset="zw-law-v1", log=lambda _m: None,
    )
)
# Another entity's personal chunk that matches the platform question exactly, by words and
# by vector. If any retrieval path ignored the owner filter it would rank first.
asyncio.run(
    kb.insert_many(
        [
            {
                "title": "Someone's private pod", "heading": f"s 56 {Q}", "content": Q,
                "authority": "PRIVATE", "resourceType": "note", "section": "56",
                "citation": "PRIVATE, s 56", "language": "en", "ownerEntityId": "someone-else",
                "supersededBy": None, "isActive": True, "embedding": fakes.hash_vector(Q),
            }
        ]
    )
)

#: A real key, so the Worker's key check goes to Core's /auth/verify and not to a stub.
E2E_API_KEY = "sk_shamwari_e2e_0123456789abcdef"
asyncio.run(
    client["platform"].apiKeys.insert_many(
        [
            {
                "_id": "k1", "keyPrefix": E2E_API_KEY[:12],
                "keyHash": hashlib.sha256(E2E_API_KEY.encode()).hexdigest(),
                "isActive": True, "keyType": "shamwari", "ownerEntityId": "e1",
            }
        ]
    )
)
asyncio.run(
    client["entity"].entities.insert_many([{"_id": "e1", "tier": "community", "monthlyTokenCap": 100000}])
)

main.client = client

#: What the test reads back. Reset between cases.
#: kb_reads counts every read of the Ground collection, by any method: that is the store a
#: personal-scope refusal must not touch.
state: dict[str, Any] = {"kb_reads": 0, "embed_calls": 0}


def _count_reads(name: str) -> None:
    original = getattr(fakes.Collection, name)

    def counted(self: fakes.Collection, *a: Any, **kw: Any) -> Any:
        if self is kb:
            state["kb_reads"] += 1
        return original(self, *a, **kw)

    setattr(fakes.Collection, name, counted)


for _name in ("aggregate", "find_one", "count_documents"):
    _count_reads(_name)

app = main.app


@app.get("/__e2e/key")
async def key() -> dict[str, str]:
    """The test API key. Fixture material for this process only."""
    return {"key": E2E_API_KEY}


@app.get("/__e2e/ready")
async def ready() -> dict[str, bool]:
    return {"ready": True}


@app.post("/__e2e/reset")
async def reset() -> dict[str, bool]:
    state.update(kb_reads=0, embed_calls=0)
    for db, cols in (("shamwari", ("conversations", "messages", "groundMisses")), ("platform", ("usageEvents",))):
        for c in cols:
            client[db][c].docs.clear()
    return {"ok": True}


@app.post("/__e2e/embed")
async def embed(text: str = Body(..., embed=True)) -> dict[str, Any]:
    """Stands in for Workers AI bge-m3, and counts the questions it was asked to embed."""
    state["embed_calls"] += 1
    return {"data": [fakes.hash_vector(text)]}


@app.get("/__e2e/state")
async def get_state() -> dict[str, Any]:
    stored = {
        f"{db}.{c}": [{k: v for k, v in d.items() if k != "embedding"} for d in client[db][c].docs]
        for db, c in (("shamwari", "conversations"), ("shamwari", "messages"), ("platform", "usageEvents"))
    }
    return {**state, "stored": stored}
