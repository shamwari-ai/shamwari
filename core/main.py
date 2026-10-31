"""
Shamwari Core: the service that enforces Shamwari's two rules in front of its data.

Core holds NO database login. Ground, the sink and usage live behind the Nyuchi API
(/v1/shamwari, nyuchi/nyuchi-api#393), which Core reaches over Fly's private network
with one internal key (nyuchi_api.py). That is the owner's decision of 2026-10-27:
only the Nyuchi API talks to databases.

What Core is for, then, is deciding BEFORE a call is made, and checking what comes back:

SCOPE MODEL, the load-bearing rule of this service
--------------------------------------------------
Shamwari's canonical architecture is three layers of intelligence:

    personal   the user's own pod data
    community  anonymised platform data
    platform   base Mukoko knowledge

Personal-layer content NEVER leaves the device or this service. It is not sent to
Z.ai, Claude, or any other third-party provider. That is what makes "sovereign AI
companion" true rather than marketing.

`resolve_scope` decides what a caller may see and `/ground/search` makes no data call
at all for a request it refuses. The API decides again on its side, and Core checks the
scope of what it gets back. Three checks, because a decision nothing downstream is
obliged to read is a comment, not a control.

PROVENANCE
----------
Every logged exchange carries `licenseClass`. Only 'open_weight' may ever become
Shamwari Mind training data. Anthropic and OpenAI terms bar using their outputs to
train competing models, so such traffic is stamped 'restricted' and the sink refuses
to mark it trainable. Core checks a batch before it forwards it; the API checks again.
"""

from __future__ import annotations

import hmac
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from enum import Enum
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from nyuchi_api import DataApi, DataApiRefusal, DataApiUnavailable

log = logging.getLogger("shamwari.core")

CORE_TOKEN = os.environ["SHAMWARI_CORE_TOKEN"]
#: Operator routes take a DIFFERENT secret from the one the edge Worker holds, so a
#: compromised Worker cannot read usage reports or reach the parked replay routes.
#: Unset means those routes are shut.
OPS_TOKEN = os.environ.get("SHAMWARI_OPS_TOKEN", "")

#: Built from the environment at import, so a missing key stops Core at boot, loudly,
#: rather than at the first request. Tests replace it.
api = DataApi.from_env()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await api.aclose()  # looked up at shutdown, so a replaced client is the one closed


app = FastAPI(title="Shamwari Core", version="0.4.0", lifespan=lifespan)

_ID = r"^[A-Za-z0-9_.:-]{1,64}$"
_PERIOD = r"^\d{4}-(0[1-9]|1[0-2])$"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def require_token(authorization: str = Header(...)) -> None:
    """Shared-secret gate. Only the Worker calls this."""
    if not hmac.compare_digest(authorization.encode(), f"Bearer {CORE_TOKEN}".encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad core token")


async def require_ops_token(authorization: str = Header(...)) -> None:
    """Operator-only gate: a separate secret, constant-time compared, closed if unset."""
    if not OPS_TOKEN:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "operator routes are not enabled")
    if not hmac.compare_digest(authorization.encode(), f"Bearer {OPS_TOKEN}".encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad operator token")


def _unavailable() -> HTTPException:
    """The data API could not answer. Fail closed; say nothing about why."""
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"error": "data_api_unavailable"})


def _refusal(e: DataApiRefusal) -> HTTPException:
    return HTTPException(e.status_code, e.detail)


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

    A personal-scope request bound for Cloud is not silently downgraded: that would
    leak by omission and produce a confidently wrong answer. It is refused, so the
    caller must route to Mind or tell the user.
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
# API key verification: moved
# ---------------------------------------------------------------------------

@app.post("/auth/verify", dependencies=[Depends(require_token)])
async def verify_key() -> None:
    """
    Gone from Core, on purpose. Core used to look keys up in Mongo; it holds no database
    login now, and the Nyuchi API authenticates a key from the raw key itself
    (GET /v1/shamwari/whoami), which the Worker never sends to Core.

    Kept as an explicit 501 and not removed, so a Worker still pointed here is told why
    (it reads this as "auth unavailable" and denies, never admits) instead of getting a
    404 that looks like a typo. The replacement is the Worker's key seam
    (gateway/src/keys.ts) pointed at the API; docs/data-api-routes.md has the gap.
    """
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        {"error": "key_verification_moved", "to": "nyuchi-api /v1/shamwari/whoami"},
    )


# ---------------------------------------------------------------------------
# Ground: retrieval, through the API
# ---------------------------------------------------------------------------

class GroundQuery(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    #: Absent means the caller did not embed the query, which is required of a `mind`
    #: destination (see ground_search). 1024 is bge-m3 and matches the live index; a
    #: mismatch is rejected rather than searched against the wrong index.
    embedding: list[float] | None = Field(default=None, min_length=1024, max_length=1024)
    owner_entity_id: str = Field(min_length=1, pattern=_ID)
    scope: Scope = Scope.PLATFORM
    destination: Literal["cloud", "mind"] = "cloud"
    language: str | None = Field(default=None, max_length=20)
    top_k: int = Field(default=6, ge=1, le=20)


@app.post("/ground/search", dependencies=[Depends(require_token)])
async def ground_search(body: GroundQuery) -> dict[str, Any]:
    """
    Hybrid retrieval over Ground, run by the Nyuchi API.

    What is Core's: the two rule checks below, made before any call, so a refused
    request reads nothing and embeds nothing; and the check on what comes back. What is
    the API's: building the query. Its owner / supersededBy / isActive filters on both
    retrieval pipelines are tested in nyuchi-api (tests/test_shamwari.py), not here.
    """
    scope = resolve_scope(body.scope, body.destination)

    # RULE 1, AUTHORITATIVELY, IN THE LEAK PATH.
    #
    # A `mind` destination that arrives carrying an embedding means the caller embedded
    # the user's question before calling us. Embedding is inference, so on the edge that
    # is a Cloudflare-hosted model seeing personal text. The Worker guards it too
    # (gateway/src/ground.ts); this is the check the Worker cannot bypass, and it is a
    # refusal rather than a silent discard of the vector, because a discard would hide a
    # Worker that had already leaked.
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

    try:
        out = await api.ground_search(
            {
                "query": body.query,
                **({"embedding": body.embedding} if body.embedding is not None else {}),
                "owner_entity_id": body.owner_entity_id,
                "scope": scope.value,
                "destination": body.destination,
                "language": body.language,
                "top_k": body.top_k,
            }
        )
    except DataApiRefusal as e:
        raise _refusal(e) from None
    except DataApiUnavailable:
        raise _unavailable() from None

    # The third check. Whatever the API says, every chunk must be a well-formed object that
    # carries exactly the scope that was asked for. For a cloud destination that means
    # cloud-safe by the API's own account of it; for Mind it means the caller's own scope and
    # nothing else's. Anything else fails closed.
    chunks = out["chunks"]
    if out.get("scope") != scope.value or any(
        not isinstance(c, dict) or c.get("scope") != scope.value for c in chunks
    ):
        log.error("data api answered with a scope other than the one asked for")
        raise _unavailable()

    return {"scope": scope.value, "hit": bool(out["chunks"]), "chunks": out["chunks"]}


# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------

@app.get("/guardrails", dependencies=[Depends(require_token)])
async def guardrails(surface: str = "shamwari") -> dict[str, Any]:
    """Active rules for a surface. The one copy lives at /v1/ai/guardrails."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,39}", surface):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad surface")
    try:
        rules = await api.guardrails(surface)
    except DataApiRefusal as e:
        raise _refusal(e) from None
    except DataApiUnavailable:
        raise _unavailable() from None
    return {**rules, "surface": surface}


# ---------------------------------------------------------------------------
# Sink: batched writes from the Worker's queue consumer
# ---------------------------------------------------------------------------

class BulkWrite(BaseModel):
    database: str
    collections: dict[str, list[dict[str, Any]]]


_ALLOWED: dict[str, set[str]] = {
    "shamwari": {"conversations", "messages", "groundMisses"},
    # serviceHealth carries the weekly degradation probe's reading. It holds no user
    # content by construction (gateway/src/probe.ts).
    "platform": {"usageEvents", "auditLog", "serviceHealth"},
}
_LICENCE = {"open_weight", "restricted"}
_SCOPES = {"personal", "community", "platform"}


def check_sink(database: str, collections: dict[str, list[dict[str, Any]]]) -> None:
    """
    Refuse a batch that breaks the allow-list or a provenance rule, before anything is
    forwarded. The API checks the same rules again; this is the first of the two.
    """
    allowed = _ALLOWED.get(database)
    if not allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"database not writable: {database}")

    for name, docs in collections.items():
        if name not in allowed:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"collection not writable: {name}")
        if name not in {"conversations", "messages"}:
            continue
        for d in docs:
            # Refuse unstamped provenance rather than defaulting it to something permissive.
            licence = d.get("licenseClass")
            if not isinstance(licence, str) or licence not in _LICENCE:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"{name} document missing valid licenseClass"
                )
            scope = d.get("scope")
            if not isinstance(scope, str) or scope not in _SCOPES:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{name} document missing valid scope")
            eligible = d.get("trainingEligible")
            if not isinstance(eligible, bool):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"{name} document missing boolean trainingEligible"
                )

            # licenseClass gates the teacher model's terms. It says nothing about the
            # user's. A personal-scope exchange is the caller's own pod data and must
            # never reach the Mind training corpus however permissive the teacher
            # model's licence was, so refuse the combination at write time rather than
            # filtering it at read time: a read-time filter is one forgotten WHERE
            # clause away from training on someone's payslip.
            if scope == "personal" and eligible:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{name} document is personal scope and must set trainingEligible=false",
                )

            # The other half of the same invariant. The Worker resolves licenseClass
            # from the model that actually served (gateway/src/provenance.ts), but an AI
            # Gateway dynamic route can substitute the model from a dashboard with no
            # deploy, so the Worker's view is exactly the thing that can go stale.
            if licence == "restricted" and eligible:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{name} document has restricted provenance and cannot set trainingEligible=true",
                )


@app.post("/sink/bulk", dependencies=[Depends(require_token)])
async def sink_bulk(body: BulkWrite) -> dict[str, Any]:
    """
    Allow-list, not a generic write proxy. An edge worker should not be able to write
    to arbitrary collections even if it is compromised.

    Documents are forwarded exactly as received (timestamps stay RFC 3339 strings; the
    API parses them and gives each record a content-derived id, so a retried batch is a
    counted duplicate and not a second row).
    """
    check_sink(body.database, body.collections)
    try:
        return await api.sink(body.database, {k: v for k, v in body.collections.items() if v})
    except DataApiRefusal as e:
        raise _refusal(e) from None
    except DataApiUnavailable:
        raise _unavailable() from None


# ---------------------------------------------------------------------------
# Billing rollup
# ---------------------------------------------------------------------------

@app.get("/rollup", dependencies=[Depends(require_token)])
async def rollup(owner_entity_id: str, billing_period: str) -> dict[str, Any]:
    if not re.fullmatch(_ID, owner_entity_id) or not re.fullmatch(_PERIOD, billing_period):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad owner or billing period")
    try:
        r = await api.usage_rollup(owner_entity_id, billing_period)
    except DataApiRefusal as e:
        raise _refusal(e) from None
    except DataApiUnavailable:
        raise _unavailable() from None
    try:
        return {
            "total_tokens": int(r.get("total_tokens") or 0),
            "total_cost": float(r.get("total_cost") or 0.0),
            "requests": int(r.get("requests") or 0),
        }
    except (TypeError, ValueError):
        raise _unavailable() from None


# ---------------------------------------------------------------------------
# Operator routes: parked until the data API has the routes they need
# ---------------------------------------------------------------------------
# Spill replay and the per-tier report read and mark rows in platform.usageEvents, which
# Core could do while it held a Mongo login. Through the API they need routes that do not
# exist yet (docs/data-api-routes.md, G3 and G4). They answer 501 rather than being
# removed, so an operator who calls them is told why. Nothing at launch needs them: they
# matter only when SERVERS_API_ENABLED is switched on.

_PARKED = {"error": "needs_data_api_route", "see": "docs/data-api-routes.md"}


@app.post("/replay/usage", dependencies=[Depends(require_ops_token)])
async def replay_usage() -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _PARKED)


@app.post("/replay/requeue", dependencies=[Depends(require_ops_token)])
async def replay_requeue() -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _PARKED)


@app.get("/replay/stats", dependencies=[Depends(require_ops_token)])
async def replay_stats() -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _PARKED)


@app.get("/rollup/by-tier", dependencies=[Depends(require_ops_token)])
async def rollup_by_tier(billing_period: str, owner_entity_id: str) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, _PARKED)


#: /health is open (Fly's check, and anyone else) and each real check is an authenticated call
#: with Core's key, so it is answered from a short cache. The API sees at most one readiness call
#: per window however often /health is hit, and a hammered /health cannot spend Core's rate limit.
_HEALTH_OK_SECONDS = 10.0
_HEALTH_FAIL_SECONDS = 3.0
_health: dict[str, Any] = {"until": 0.0, "ok": False}


@app.get("/health")
async def health() -> dict[str, Any]:
    """Readiness: Core is up AND the data API answers Core's key. Fails closed otherwise."""
    now = time.monotonic()
    if now >= _health["until"]:
        try:
            await api.whoami()
            _health.update(ok=True, until=now + _HEALTH_OK_SECONDS)
        except (DataApiUnavailable, DataApiRefusal):
            _health.update(ok=False, until=now + _HEALTH_FAIL_SECONDS)
    if not _health["ok"]:
        raise _unavailable()
    return {"ok": True, "service": "shamwari-core", "version": "0.4.0"}
