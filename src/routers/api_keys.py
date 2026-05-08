"""API Keys router — developer key management."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status

from src.auth.dependencies import CurrentUser, current_user
from src.schemas.api_keys import APIKeyCreateRequest, APIKeyCreateResponse, APIKeyResponse
from src.schemas.common import ErrorResponse
from src.store import memory

router = APIRouter(prefix="/v1", tags=["api-keys"])


def _strip_secret(record: dict[str, object]) -> dict[str, object]:
    """Return a copy without the plaintext `key` field for safe persistence."""
    return {k: v for k, v in record.items() if k != "key"}


def _make_key(
    user_id: str,
    organization_id: str,
    payload: APIKeyCreateRequest,
) -> dict[str, object]:
    secret = f"shai_{secrets.token_urlsafe(32).replace('-', '').replace('_', '')[:40]}"
    return {
        "id": f"key_{secrets.token_urlsafe(8).replace('-', '').replace('_', '')[:16]}",
        "key": secret,
        "key_prefix": secret[:12],
        "name": payload.name,
        "organization_id": organization_id,
        "scopes": payload.scopes,
        "rate_limit_rpm": payload.rate_limit_rpm,
        "status": "active",
        "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
        "last_used_at": None,
        "created_at": datetime.now(UTC).isoformat(),
        "owner_user_id": user_id,
    }


@router.get(
    "/api-keys",
    response_model=list[APIKeyResponse],
    summary="List API keys",
    description=(
        "Returns all API keys for the authenticated user's organization. "
        "Key hashes are never exposed — only the prefix for identification."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_api_keys(
    user: CurrentUser = Depends(current_user),
) -> list[APIKeyResponse]:
    rows = memory.list_keys(user.id)
    return [APIKeyResponse.model_validate(row) for row in rows]


@router.post(
    "/api-keys",
    response_model=APIKeyCreateResponse,
    status_code=201,
    summary="Create API key",
    description=(
        "Create a new API key. The full key is returned exactly once in the "
        "response — it cannot be retrieved again. Store it securely."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid parameters"},
    },
)
async def create_api_key(
    payload: APIKeyCreateRequest,
    user: CurrentUser = Depends(current_user),
) -> APIKeyCreateResponse:
    record = _make_key(
        user_id=user.id,
        organization_id=user.organization_id or user.id,
        payload=payload,
    )
    memory.insert_key(user.id, _strip_secret(record))
    return APIKeyCreateResponse(
        key=str(record["key"]),
        key_prefix=str(record["key_prefix"]),
        id=str(record["id"]),
        name=str(record["name"]),
    )


@router.delete(
    "/api-keys/{key_id}",
    status_code=204,
    summary="Revoke API key",
    response_class=Response,
    responses={
        401: {"description": "Authentication required"},
        404: {"description": "Key not found"},
    },
)
async def revoke_api_key(
    key_id: str,
    user: CurrentUser = Depends(current_user),
) -> Response:
    removed = memory.remove_key(user.id, key_id)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
