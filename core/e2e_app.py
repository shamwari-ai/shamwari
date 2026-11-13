"""
A Core process for the end-to-end contract test (gateway/test/e2e.test.ts).

Test-only: not copied into the image, and it refuses to import outside scripts/e2e.sh.

Core's real `main.app` runs unchanged, talking to the Nyuchi API over real HTTP exactly as
it will on Fly. The API here is a STAND-IN served by the same process under /__api: it
accepts the four /v1/shamwari routes and the guardrails read, checks the bearer token it issued at /auth/token, records every
call, and keeps what the sink receives. Its retrieval is a small keyword-and-vector ranking
over the ingested fixture corpus.

What that does and does not prove:

  * It proves Core calls the API with the requests the API accepts (paths, key header, body
    shape) and what Core does with the answers (refusals, outages, scope checks).
  * It proves Core makes ZERO calls to the API for a request it refuses. That is the count
    rule 1 needs.
  * It does NOT prove the real API's query filters (owner, supersededBy, isActive). Those
    live in nyuchi-api and are tested there (tests/test_shamwari.py). The filter below is a
    stand-in so the fixture corpus can be searched; a planted foreign chunk here would only
    test the stand-in, so none is planted.
"""

from __future__ import annotations

import asyncio
import os
import secrets
from datetime import date
from pathlib import Path
from typing import Any

if os.environ.get("E2E_APP") != "1":
    # Importing this module adds unauthenticated routes. It runs only from scripts/e2e.sh.
    raise RuntimeError("e2e_app is a test harness: run it through scripts/e2e.sh")

PORT = os.environ["E2E_PORT"]
#: The key pair the WORKER holds (scripts/e2e.sh makes it random per run and gives it to the test too).
#: Core is never given it: it is only the stand-in API's record of whom to hand a token to.
CLIENT_ID = os.environ["E2E_API_CLIENT_ID"]
CLIENT_SECRET = os.environ["E2E_API_CLIENT_SECRET"]
#: Random per process: the one machine token the stand-in API issues and then accepts.
API_TOKEN = f"e2e.{secrets.token_hex(24)}"
os.environ["NYUCHI_API_URL"] = f"http://127.0.0.1:{PORT}/__api"
os.environ["SHAMWARI_CORE_TOKEN"] = os.environ.get("E2E_CORE_TOKEN", "e2e-core-token")

import fakes
import ingest_ground
from eval_ground import terms
from fastapi import APIRouter, Body, Header, HTTPException, Request

import main

HERE = Path(__file__).parent
TITLE = "Constitution of Zimbabwe Amendment (No. 20) Act 2013"

kb = fakes.Collection()
asyncio.run(
    ingest_ground.run_ingest(
        fakes.FakePg(), kb, fakes.CountingEmbedder(),
        source_name="Constitution of Zimbabwe",
        text=(HERE / "eval" / "fixtures" / "synthetic-constitution.txt").read_text(encoding="utf-8"),
        title=TITLE, slug="constitution-2013", effective_from=date(2013, 5, 22),
        dataset="zw-law-v1", log=lambda _m: None,
    )
)

#: What the test reads back. Reset between cases.
state: dict[str, Any] = {"api": [], "embed_calls": 0, "stored": {}, "token_exchanges": [], "api_token": API_TOKEN}

app = main.app

# ---------------------------------------------------------------------------
# The stand-in Nyuchi API
# ---------------------------------------------------------------------------
api = APIRouter(prefix="/__api/v1")


def _auth(authorization: str | None) -> None:
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(401, "bad token")


@api.post("/auth/token")
async def issue_token(request: Request) -> dict[str, Any]:
    """The real API's client_credentials exchange (RFC 6749 4.4), form-encoded."""
    from urllib.parse import parse_qs

    form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
    state["token_exchanges"].append({"grant_type": form.get("grant_type")})
    ok = (
        form.get("grant_type") == "client_credentials"
        and form.get("client_id") == CLIENT_ID
        and secrets.compare_digest(form.get("client_secret", ""), CLIENT_SECRET)
    )
    if not ok:
        raise HTTPException(401, {"error": "invalid_client"})
    return {"access_token": API_TOKEN, "token_type": "Bearer", "expires_in": 3600, "scope": "shamwari"}


def _record(request: Request) -> None:
    state["api"].append({"method": request.method, "path": request.url.path.removeprefix("/__api")})


@api.get("/shamwari/whoami")
async def whoami(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    _record(request)
    return {"api_key_id": "k1", "owner_entity_id": None, "owner_person_id": None,
            "key_type": "internal", "tier": "community", "monthly_token_cap": 100000}


@api.post("/shamwari/ground/search")
async def ground_search(
    request: Request, body: dict[str, Any] = Body(...), authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _auth(authorization)
    _record(request)
    state["api"][-1]["summary"] = {
        "scope": body.get("scope"),
        "destination": body.get("destination"),
        "owner_entity_id": body.get("owner_entity_id"),
        "top_k": body.get("top_k"),
        "embedding_dims": len(body["embedding"]) if body.get("embedding") else None,
    }
    scope, dest = body["scope"], body["destination"]
    # The API's own two checks, as it documents them.
    if dest == "cloud" and scope == "personal":
        raise HTTPException(409, {"error": "scope_requires_local_inference", "scope": scope})
    if dest == "mind" and body.get("embedding") is not None:
        raise HTTPException(409, {"error": "edge_embedding_forbidden"})

    owner = {"platform": None, "community": None}.get(scope, body["owner_entity_id"])
    pool = [d for d in kb.docs if d.get("isActive") and d.get("supersededBy") is None
            and d.get("ownerEntityId") == owner]
    q = set(terms(body["query"]))
    vec = body.get("embedding")

    def rank(items: list[tuple[float, dict[str, Any]]]) -> list[dict[str, Any]]:
        return [d for s, d in sorted(items, key=lambda x: -x[0]) if s > 0]

    lexical = rank([(len(q & set(terms(f"{d['title']} {d['heading']} {d['content']}"))), d) for d in pool])
    semantic = rank([(fakes.cosine(vec, d["embedding"]), d) for d in pool]) if vec else []
    fused: dict[int, float] = {}
    for weight, lst in ((2, semantic[: body["top_k"] * 2]), (1, lexical[: body["top_k"] * 2])):
        for r, d in enumerate(lst, start=1):
            fused[id(d)] = fused.get(id(d), 0.0) + weight / (60 + r)
    by_id = {id(d): d for d in pool}
    rows = [by_id[i] for i in sorted(fused, key=lambda i: -fused[i])][: body["top_k"]]
    chunks = [
        {"content": r["content"], "heading": r["heading"], "title": r["title"], "authority": r["authority"],
         "resource_type": r["resourceType"], "source_url": r["sourceUrl"],
         "effective_from": r["effectiveFrom"].date().isoformat() if r["effectiveFrom"] else None,
         "scope": scope}
        for r in rows
    ]
    return {"scope": scope, "hit": bool(chunks), "chunks": chunks}


@api.post("/shamwari/sink")
async def sink(
    request: Request, body: dict[str, Any] = Body(...), authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _auth(authorization)
    _record(request)
    written: dict[str, int] = {}
    for name, docs in body["collections"].items():
        state["stored"].setdefault(f"{body['database']}.{name}", []).extend(docs)
        written[name] = len(docs)
    return {"written": written}


@api.get("/shamwari/usage/rollup")
async def rollup(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    _record(request)
    return {"total_tokens": 0, "total_cost": 0.0, "requests": 0}


@api.get("/ai/guardrails")
async def guardrails(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    _record(request)
    return {"platform": [], "entity": []}


app.include_router(api)

# ---------------------------------------------------------------------------
# Harness routes
# ---------------------------------------------------------------------------


@app.get("/__e2e/ready")
async def ready() -> dict[str, bool]:
    return {"ready": True}


@app.post("/__e2e/reset")
async def reset() -> dict[str, bool]:
    state.update(api=[], embed_calls=0, stored={}, token_exchanges=[])
    return {"ok": True}


@app.post("/__e2e/embed")
async def embed(text: str = Body(..., embed=True)) -> dict[str, Any]:
    """Stands in for Workers AI bge-m3, and counts the questions it was asked to embed."""
    state["embed_calls"] += 1
    return {"data": [fakes.hash_vector(text)]}


@app.get("/__e2e/state")
async def get_state() -> dict[str, Any]:
    return state
