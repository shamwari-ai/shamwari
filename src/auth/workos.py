"""WorkOS AuthKit JWT verification.

The frontend (SvelteKit + @workos/authkit-sveltekit) issues sessions and
attaches the access token as a Bearer header on calls to this API. We
verify the JWT signature against WorkOS's JWKS endpoint and pull the
user id out of `sub`.

Network calls use httpx with a 5-second timeout; the JWKS payload is
cached in-process for 10 minutes so we don't hammer WorkOS on every
request.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status

JWKS_TTL_SECONDS = 600
HTTP_TIMEOUT = 5.0


class _JwksCache:
    """Simple {issuer: (fetched_at, keys)} cache with a TTL."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, dict[str, Any]]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        cached = self._store.get(key)
        if not cached:
            return None
        fetched_at, payload = cached
        if time.time() - fetched_at > JWKS_TTL_SECONDS:
            return None
        return payload

    def set(self, key: str, payload: dict[str, Any]) -> None:
        self._store[key] = (time.time(), payload)


_jwks_cache = _JwksCache()


def _jwks_url() -> str:
    """Build the AuthKit JWKS URL from WORKOS_CLIENT_ID."""
    client_id = os.environ.get("WORKOS_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="WORKOS_CLIENT_ID not configured",
        )
    base = os.environ.get(
        "WORKOS_JWKS_BASE",
        "https://api.workos.com/sso/jwks",
    ).rstrip("/")
    return f"{base}/{client_id}"


async def _fetch_jwks() -> dict[str, Any]:
    """Pull the JWKS from WorkOS, with a TTL'd in-process cache."""
    url = _jwks_url()
    cached = _jwks_cache.get(url)
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPError as err:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Could not fetch WorkOS JWKS: {err}",
            ) from err
    payload: dict[str, Any] = response.json()
    _jwks_cache.set(url, payload)
    return payload


def _key_for_kid(jwks: dict[str, Any], kid: str) -> Any:
    """Find the JWK with the given `kid` and return the public key object."""
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return jwt.PyJWK(key).key
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Signing key not found for token",
    )


async def verify_token(token: str) -> dict[str, Any]:
    """Verify an AuthKit access token and return its claims.

    Raises HTTPException(401) on any signature, expiry, or audience
    failure so FastAPI dependency code can let it bubble.
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token",
        ) from err

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing kid header",
        )

    jwks = await _fetch_jwks()
    public_key = _key_for_kid(jwks, kid)

    audience = os.environ.get("WORKOS_CLIENT_ID")
    issuer = os.environ.get("WORKOS_ISSUER")  # optional override

    try:
        claims = jwt.decode(
            token,
            key=public_key,
            algorithms=["RS256"],
            audience=audience if audience else None,
            issuer=issuer if issuer else None,
            options={"verify_aud": bool(audience), "verify_iss": bool(issuer)},
        )
    except jwt.ExpiredSignatureError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        ) from err
    except jwt.InvalidTokenError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {err}",
        ) from err

    return dict(claims)
