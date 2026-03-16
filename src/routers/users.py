"""Users router — user profile management."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse
from src.schemas.users import UserResponse, UserUpdateRequest

router = APIRouter(prefix="/v1", tags=["users"])


@router.get(
    "/users/me",
    response_model=UserResponse,
    summary="Get current user profile",
    description=(
        "Returns the authenticated user's profile with Schema.org Person "
        "structured data. Includes preferences, role, and organization memberships."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def get_current_user() -> UserResponse:
    """Get the current user's profile."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.patch(
    "/users/me",
    response_model=UserResponse,
    summary="Update current user profile",
    description="Update the authenticated user's display name, avatar, or preferences.",
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        400: {"model": ErrorResponse, "description": "Invalid update parameters"},
    },
)
async def update_current_user(request: UserUpdateRequest) -> UserResponse:
    """Update the current user's profile."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
