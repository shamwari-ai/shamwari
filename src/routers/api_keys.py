"""API Keys router — developer key management."""

from fastapi import APIRouter, HTTPException

from src.schemas.api_keys import APIKeyCreateRequest, APIKeyCreateResponse, APIKeyResponse
from src.schemas.common import ErrorResponse

router = APIRouter(prefix="/v1", tags=["api-keys"])


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
async def list_api_keys() -> list[APIKeyResponse]:
    """List API keys for the current organization."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


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
        403: {
            "model": ErrorResponse,
            "description": "Maximum API keys reached for current plan",
        },
    },
)
async def create_api_key(request: APIKeyCreateRequest) -> APIKeyCreateResponse:
    """Create a new API key."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.delete(
    "/api-keys/{key_id}",
    status_code=204,
    summary="Revoke API key",
    description="Permanently revoke an API key. This action cannot be undone.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        404: {"model": ErrorResponse, "description": "API key not found"},
    },
)
async def revoke_api_key(key_id: str) -> None:
    """Revoke an API key."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
