"""
Shamwari Core — the service that owns MongoDB.

Runs on Nyuchi infrastructure, not at the Cloudflare edge. Three reasons:
  1. The Atlas Data API was removed in September 2025 and the native driver
     is not production-hardened in Workers.
  2. Mongo credentials never reach a Cloudflare edge node.
  3. Scope enforcement (below) must live somewhere Cloudflare cannot see.

SCOPE MODEL — the load-bearing rule of this service
---------------------------------------------------
Shamwari's canonical architecture is three layers of intelligence:

    personal   — the user's own pod data
    community  — anonymised platform data
    platform   — base Mukoko knowledge

Personal-layer content NEVER leaves the device or this service. It is not
sent to Kimi, Qwen, Claude or any other third-party provider. That is what
makes "sovereign AI companion" true rather than marketing.

Enforcement is structural: `resolve_scope` decides what a caller may see,
and `/ground/search` cannot return personal chunks to a request that will
be routed to Cloud. The Worker cannot override this.

PROVENANCE
----------
Every logged exchange carries `licenseClass`. Only 'open_weight' may ever
become Shamwari Mind training data. Anthropic and OpenAI terms bar using
their outputs to train competing models, so premium-tier traffic is
stamped 'restricted' at write time and filtered at read time.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

MONGODB_URI = os.environ["MONGODB_URI"]
CORE_TOKEN = os.environ["SHAMWARI_CORE_TOKEN"]
DB_SHAMWARI = "shamwari"
DB_PLATFORM = "platform"

app = FastAPI(title="Shamwari Core", version="0.3.0")
client = AsyncIOMotorClient(MONGODB_URI, maxPoolSize=20, serverSelectionTimeoutMS=5000)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def require_token(authorization: str = Header(...)) -> None:
    """Shared-secret gate. Only the Worker and the ingest job call this."""
    if authorization != f"Bearer {CORE_TOKEN}":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad core token")


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

class Scope(str, Enum):
    PERSONAL = "personal"
    COMMUNITY = "community"
    PLATFORM = "platform"


#: Scopes whose content may be sent to an external inference provider.
CLOUD_SAFE: frozenset[Scope] = frozenset({Scope.COMMUNITY, Scope.PLATFORM})


def resolve_scope(requested: Scope, destination: Literal["cloud", "mind"]) -> Scope:
    """
    Narrow the scope to what the destination is allowed to see.

    A personal-scope request bound for Cloud is not silently downgraded —
    that would leak by omission and produce a confidently wrong answer.
    It is refused, so the caller must route to Mind or tell the user.
    """
    if destination == "mind":
        return requested
    if requested not in CLOUD_SAFE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "error": "scope_requires_local_inference",
                "scope": requested.value,
                "message": (
                    "Personal-layer data cannot be sent to an external provider. "
                    "Route this request to Shamwari Mind on-device, or ask the "
                    "user to rephrase without reference to their own pod data."
                ),
            },
        )
    return requested


# ---------------------------------------------------------------------------
# API key verification
# ---------------------------------------------------------------------------

class KeyLookup(BaseModel):
    key_prefix: str
    key_hash: str


class KeyResult(BaseModel):
    api_key_id: str
    owner_entity_id: str
    owner_person_id: str | None = None
    key_type: str
    tier: str
    monthly_token_cap: int


@app.post("/auth/verify", response_model=KeyResult, dependencies=[Depends(require_token)])
async def verify_key(body: KeyLookup) -> KeyResult:
    """
    Two-step lookup matching the existing platform.apiKeys indexes:
    find by keyPrefix (indexed), then constant-time compare the hash.
    """
    doc = await client[DB_PLATFORM].apiKeys.find_one(
        {"keyPrefix": body.key_prefix, "isActive": True}
    )
    if not doc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown key")

    stored = doc.get("keyHash", "")
    if not hmac.compare_digest(stored, body.key_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad key")

    expires = doc.get("expiresAt")
    if expires and expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "expired key")

    entity = await client["entity"].entities.find_one(
        {"_id": doc["ownerEntityId"]}, {"tier": 1, "monthlyTokenCap": 1}
    ) or {}

    return KeyResult(
        api_key_id=str(doc["_id"]),
        owner_entity_id=str(doc["ownerEntityId"]),
        owner_person_id=str(doc["createdByPersonId"]) if doc.get("createdByPersonId") else None,
        key_type=doc.get("keyType", "standard"),
        tier=entity.get("tier", "community"),
        monthly_token_cap=int(entity.get("monthlyTokenCap", 100_000)),
    )


# ---------------------------------------------------------------------------
# Ground — hybrid retrieval over shamwari.knowledgeBase
# ---------------------------------------------------------------------------

class GroundQuery(BaseModel):
    query: str
    #: Absent means the caller did not embed the query, which is required of
    #: a `mind` destination — see ground_search. 1024 is bge-m3 and matches
    #: the live ground_vector_search index; a mismatch is rejected rather
    #: than searched against the wrong index.
    embedding: list[float] | None = Field(default=None, min_length=1024, max_length=1024)
    owner_entity_id: str
    scope: Scope = Scope.PLATFORM
    destination: Literal["cloud", "mind"] = "cloud"
    language: str | None = None
    top_k: int = 6


class GroundChunk(BaseModel):
    content: str
    heading: str | None = None
    title: str
    authority: str
    resource_type: str
    source_url: str | None = None
    effective_from: str | None = None
    scope: str


@app.post("/ground/search", dependencies=[Depends(require_token)])
async def ground_search(body: GroundQuery) -> dict[str, Any]:
    """
    $rankFusion over the vector and lexical indexes.

    Reciprocal Rank Fusion rather than averaging scores: the two indexes
    produce incompatible score scales, and averaging them ranks badly.

    The owner filter is what implements the three-layer model:
      platform  -> ownerEntityId is null (shared corpus)
      community -> shared corpus plus anonymised aggregates
      personal  -> the caller's own pod, and only for mind destinations
    """
    scope = resolve_scope(body.scope, body.destination)

    # RULE 1, AUTHORITATIVELY, IN THE LEAK PATH.
    #
    # A `mind` destination that arrives carrying an embedding means the
    # caller embedded the user's question before calling us. Embedding is
    # inference, so on the edge that is a Cloudflare-hosted model seeing
    # personal text — the leak this endpoint's own docstring claims cannot
    # happen. The Worker guards it too (gateway/src/ground.ts); this is the
    # check the Worker cannot bypass, and it is deliberately a refusal
    # rather than a silent discard of the vector, because a discard would
    # hide a Worker that had already leaked.
    if body.destination == "mind" and body.embedding is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "error": "edge_embedding_forbidden",
                "message": (
                    "A mind-destination query must not be embedded by the caller. "
                    "Embedding is inference; the device supplies its own vector."
                ),
            },
        )

    if scope is Scope.PERSONAL:
        owner_filter: dict[str, Any] = {"ownerEntityId": body.owner_entity_id}
    elif scope is Scope.COMMUNITY:
        owner_filter = {"ownerEntityId": {"$in": [None, "__community__"]}}
    else:
        owner_filter = {"ownerEntityId": None}

    prefilter = {
        "isActive": True,
        "supersededBy": None,  # never cite repealed law
        **owner_filter,
    }
    if body.language:
        prefilter["language"] = {"$in": [body.language, "en"]}

    lexical: list[dict[str, Any]] = [
        {
            "$search": {
                "index": "ground_text_search",
                "compound": {
                    "must": [
                        {
                            "text": {
                                "query": body.query,
                                "path": ["title", "heading", "content"],
                            }
                        }
                    ],
                    "filter": [{"equals": {"path": "isActive", "value": True}}],
                },
            }
        },
        # The owner filter belongs on BOTH retrieval pipelines, not just the
        # vector one. Atlas Search cannot express the whole prefilter in its
        # compound form, so it is re-applied as a $match immediately after
        # $search — before $limit, so the limit counts documents the caller
        # is actually allowed to see.
        #
        # Without this, $rankFusion merged lexical hits that had passed only
        # an isActive check into a result set the caller was scope-gated out
        # of: a platform-scope Cloud request could surface another entity's
        # personal pod chunks by keyword and forward them to Moonshot. The
        # scope model is only as strong as its least-filtered pipeline.
        {"$match": prefilter},
        {"$limit": body.top_k * 2},
    ]

    if body.embedding is None:
        # Lexical only. Weaker ranking over the same corpus, not a different
        # corpus — the prefilter above still applies. This is what a
        # personal-scope query gets until Mind ships its own embedding, and
        # it is the honest cost of not embedding on Cloud.
        retrieval: list[dict[str, Any]] = [*lexical]
    else:
        retrieval = [
            {
                "$rankFusion": {
                    "input": {
                        "pipelines": {
                            "semantic": [
                                {
                                    "$vectorSearch": {
                                        "index": "ground_vector_search",
                                        "path": "embedding",
                                        "queryVector": body.embedding,
                                        "numCandidates": body.top_k * 20,
                                        "limit": body.top_k * 2,
                                        "filter": prefilter,
                                    }
                                }
                            ],
                            "lexical": lexical,
                        }
                    },
                    # RRF, not averaged scores: the two indexes produce
                    # incompatible score scales and averaging ranks badly.
                    "combination": {"weights": {"semantic": 2, "lexical": 1}},
                }
            }
        ]

    pipeline: list[dict[str, Any]] = [
        *retrieval,
        {"$limit": body.top_k},
        {
            "$project": {
                "_id": 0,
                "content": 1,
                "heading": 1,
                "title": 1,
                "authority": 1,
                "resourceType": 1,
                "sourceUrl": 1,
                "effectiveFrom": 1,
            }
        },
    ]

    cursor = client[DB_SHAMWARI].knowledgeBase.aggregate(pipeline)
    rows = await cursor.to_list(length=body.top_k)

    chunks = [
        GroundChunk(
            content=r["content"],
            heading=r.get("heading"),
            title=r.get("title", "Untitled"),
            authority=r.get("authority", "Unknown"),
            resource_type=r.get("resourceType", "unknown"),
            source_url=r.get("sourceUrl"),
            effective_from=(
                r["effectiveFrom"].date().isoformat() if r.get("effectiveFrom") else None
            ),
            scope=scope.value,
        )
        for r in rows
    ]

    # A miss is a line in the corpus roadmap, written by a paying customer.
    if not chunks:
        await client[DB_SHAMWARI].groundMisses.insert_one(
            {
                "ownerEntityId": body.owner_entity_id,
                "query": body.query,
                "language": body.language,
                "scope": scope.value,
                "createdAt": datetime.now(timezone.utc),
            }
        )

    return {"scope": scope.value, "hit": bool(chunks), "chunks": [c.model_dump() for c in chunks]}


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------

@app.get("/guardrails", dependencies=[Depends(require_token)])
async def guardrails(surface: str = "shamwari.ai") -> dict[str, Any]:
    """Active rules for a surface, highest priority first."""
    cursor = (
        client[DB_SHAMWARI]
        .guardrails.find({"isActive": True, "$or": [{"surfaces": surface}, {"surfaces": None}]})
        .sort("priority", 1)
    )
    rules = await cursor.to_list(length=200)
    for r in rules:
        r["_id"] = str(r["_id"])
    return {"surface": surface, "rules": rules}


# ---------------------------------------------------------------------------
# Sink — batched writes from the Worker's queue consumer
# ---------------------------------------------------------------------------

class BulkWrite(BaseModel):
    database: str
    collections: dict[str, list[dict[str, Any]]]


_ALLOWED: dict[str, set[str]] = {
    "shamwari": {"conversations", "messages", "groundMisses"},
    # serviceHealth carries the weekly degradation probe's reading. It holds
    # no user content by construction — see gateway/src/probe.ts — and the
    # collection already existed, unused.
    "platform": {"usageEvents", "auditLog", "serviceHealth"},
}


@app.post("/sink/bulk", dependencies=[Depends(require_token)])
async def sink_bulk(body: BulkWrite) -> dict[str, Any]:
    """
    Allow-list, not a generic write proxy. An edge worker should not be
    able to write to arbitrary collections even if it is compromised.
    """
    allowed = _ALLOWED.get(body.database)
    if not allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"database not writable: {body.database}")

    written: dict[str, int] = {}
    for name, docs in body.collections.items():
        if name not in allowed:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"collection not writable: {name}")
        if not docs:
            continue

        for d in docs:
            if isinstance(d.get("createdAt"), str):
                d["createdAt"] = datetime.fromisoformat(d["createdAt"].replace("Z", "+00:00"))
            # Refuse unstamped provenance rather than defaulting it to
            # something permissive.
            if name in {"conversations", "messages"} and d.get("licenseClass") not in {
                "open_weight",
                "restricted",
            }:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{name} document missing valid licenseClass",
                )

            # licenseClass gates the teacher model's terms. It says nothing
            # about the user's. A personal-scope exchange is the caller's own
            # pod data and must never reach the Mind training corpus however
            # permissive the teacher model's licence was, so refuse the
            # combination at write time rather than filtering it at read
            # time — a read-time filter is one forgotten WHERE clause away
            # from training on someone's payslip.
            if name in {"conversations", "messages"} and d.get("scope") == "personal":
                if d.get("trainingEligible") is not False:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        f"{name} document is personal scope and must set "
                        "trainingEligible=false",
                    )

            # The other half of the same invariant, and the authoritative
            # copy of it. A restricted teacher model's output may be stored
            # and served; it may never be marked trainable.
            #
            # The Worker already resolves licenseClass from the model that
            # actually served (gateway/src/provenance.ts) and refuses this
            # combination itself. This check exists because an AI Gateway
            # dynamic route can substitute the model from a dashboard, with
            # no deploy and no code review — so the Worker's view of what
            # served is exactly the thing that can go stale. Two checks, for
            # the same reason rule 1 has two: one is a single bug away from a
            # corpus that has to be thrown away.
            if name in {"conversations", "messages"}:
                if d.get("licenseClass") == "restricted" and d.get("trainingEligible") is True:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        f"{name} document has restricted provenance and cannot set "
                        "trainingEligible=true",
                    )

        res = await client[body.database][name].insert_many(docs, ordered=False)
        written[name] = len(res.inserted_ids)

    return {"written": written}


# ---------------------------------------------------------------------------
# Billing rollup
# ---------------------------------------------------------------------------

@app.get("/rollup", dependencies=[Depends(require_token)])
async def rollup(owner_entity_id: str, billing_period: str) -> dict[str, Any]:
    """
    Aggregates on the existing ownerEntityId + billingPeriod index rather
    than scanning a rolling window.
    """
    cursor = client[DB_PLATFORM].usageEvents.aggregate(
        [
            {"$match": {"ownerEntityId": owner_entity_id, "billingPeriod": billing_period}},
            {
                "$group": {
                    "_id": None,
                    "total_tokens": {"$sum": {"$add": ["$inputTokens", "$outputTokens"]}},
                    "total_cost": {"$sum": "$costUsd"},
                    "requests": {"$sum": 1},
                }
            },
        ]
    )
    rows = await cursor.to_list(length=1)
    if not rows:
        return {"total_tokens": 0, "total_cost": 0.0, "requests": 0}
    r = rows[0]
    return {
        "total_tokens": int(r.get("total_tokens") or 0),
        "total_cost": float(r.get("total_cost") or 0.0),
        "requests": int(r.get("requests") or 0),
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    await client.admin.command("ping")
    return {"ok": True, "service": "shamwari-core", "version": "0.3.0"}
