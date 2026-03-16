"""API Key schemas — no direct Schema.org mapping."""

from datetime import datetime

from pydantic import BaseModel, Field


class APIKeyResponse(BaseModel):
    """API key response (excludes key_hash for security)."""

    id: str = Field(description="API key document ID")
    key_prefix: str = Field(description="First 8 chars for identification: shai_xxxx")
    name: str = Field(description="User-friendly label")
    organization_id: str
    scopes: list[str] = Field(description="Permission scopes")
    rate_limit_rpm: int
    status: str = Field(description="active, revoked, expired")
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    created_at: datetime


class APIKeyCreateRequest(BaseModel):
    """Create API key request."""

    name: str = Field(min_length=1, max_length=100)
    scopes: list[str] = Field(
        default_factory=lambda: ["inference"],
        description="Permission scopes: inference, fine_tune, datasets, models_read, usage_read",
    )
    rate_limit_rpm: int = Field(default=60, ge=1, le=10000)
    expires_at: datetime | None = None


class APIKeyCreateResponse(BaseModel):
    """Response after creating an API key — includes the plaintext key (shown once)."""

    key: str = Field(description="The full API key (shown once, never again)")
    key_prefix: str
    id: str
    name: str
