"""FastAPI dependencies for authenticated endpoints.

Two ways in:

1. Bearer JWT — the canonical path. Frontend forwards the AuthKit access
   token, we verify it via WorkOS JWKS and pull the user id from `sub`.

2. Header-only fallback — useful for local development without WorkOS.
   Set SHAMWARI_ALLOW_HEADER_AUTH=1 and pass `X-User-Id` directly.
   Never enabled in production.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from src.auth.workos import verify_token


@dataclass(frozen=True)
class CurrentUser:
    """The minimum subset of identity we propagate downstream."""

    id: str
    email: str | None
    organization_id: str | None
    raw_claims: dict[str, object]


def _header_auth_enabled() -> bool:
    return os.environ.get("SHAMWARI_ALLOW_HEADER_AUTH") == "1"


async def current_user(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
) -> CurrentUser:
    """Resolve the calling user.

    Bearer token wins. When header-only auth is explicitly enabled and no
    Bearer is present, the `X-User-Id` header becomes the source of truth.
    """
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        claims = await verify_token(token)
        sub = str(claims.get("sub") or "")
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject",
            )
        email = claims.get("email")
        org_id = claims.get("organization_id") or claims.get("org_id")
        return CurrentUser(
            id=sub,
            email=str(email) if isinstance(email, str) else None,
            organization_id=str(org_id) if isinstance(org_id, str) else None,
            raw_claims=dict(claims),
        )

    if _header_auth_enabled() and x_user_id:
        return CurrentUser(
            id=x_user_id,
            email=x_user_email,
            organization_id=None,
            raw_claims={},
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
