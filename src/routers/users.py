"""Users router — user profile management."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends

from src.auth.dependencies import CurrentUser, current_user
from src.schemas.common import ErrorResponse
from src.schemas.users import UserPreferencesResponse, UserResponse, UserUpdateRequest
from src.store import memory

router = APIRouter(prefix="/v1", tags=["users"])


def _default_preferences() -> dict[str, Any]:
    return {
        "language": "en",
        "theme": "system",
        "notifications_enabled": True,
        "default_model_slug": None,
    }


def _default_profile(user: CurrentUser) -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "id": user.id,
        "name": user.email.split("@", 1)[0] if user.email else user.id,
        "email": user.email or f"{user.id}@unknown.invalid",
        "image": None,
        "role": "developer",
        "preferences": _default_preferences(),
        "organization_ids": [user.organization_id] if user.organization_id else [],
        "is_active": True,
        "last_active_at": now,
        "created_at": now,
    }


def _merge_preferences(
    existing: dict[str, Any],
    updates: UserPreferencesResponse,
) -> dict[str, Any]:
    return {
        **existing,
        **updates.model_dump(exclude_none=True),
    }


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
async def get_current_user_profile(
    user: CurrentUser = Depends(current_user),
) -> UserResponse:
    profile = memory.get_profile(user.id)
    if profile is None:
        profile = memory.upsert_profile(user.id, _default_profile(user))
    return UserResponse.model_validate(profile)


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
async def update_current_user_profile(
    payload: UserUpdateRequest,
    user: CurrentUser = Depends(current_user),
) -> UserResponse:
    existing = memory.get_profile(user.id) or _default_profile(user)
    if payload.name is not None:
        existing["name"] = payload.name
    if payload.image is not None:
        existing["image"] = payload.image
    if payload.preferences is not None:
        existing["preferences"] = _merge_preferences(
            existing.get("preferences", {}),
            payload.preferences,
        )
    saved = memory.upsert_profile(user.id, existing)
    return UserResponse.model_validate(saved)
