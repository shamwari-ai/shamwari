"""API Key model — developer access tokens for platform.shamwari.ai.

Keys are SHA-256 hashed before storage. Only the hash and a display prefix
(first 8 chars) are persisted. The plaintext key is shown once at creation.
"""

from datetime import datetime
from enum import StrEnum

from beanie import Indexed
from pydantic import Field

from src.models.base import TimestampedDocument


class APIKeyStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class APIKeyScope(StrEnum):
    INFERENCE = "inference"
    FINE_TUNE = "fine_tune"
    DATASETS = "datasets"
    MODELS_READ = "models_read"
    USAGE_READ = "usage_read"


class APIKey(TimestampedDocument):
    """A hashed API key for programmatic access to Shamwari AI.

    The actual key is SHA-256 hashed. key_prefix stores the first 8 chars
    for display purposes (e.g., "shai_abc1..."). The plaintext is returned
    exactly once at creation time and never stored.
    """

    key_hash: Indexed(str, unique=True)  # type: ignore[valid-type]
    key_prefix: str = Field(description="First 8 chars for display: shai_xxxx")
    name: str = Field(description="User-friendly label for this key")
    organization_id: Indexed(str)  # type: ignore[valid-type]
    created_by_user_id: str
    scopes: list[APIKeyScope] = Field(default_factory=lambda: [APIKeyScope.INFERENCE])
    rate_limit_rpm: int = Field(default=60, description="Requests per minute")
    status: APIKeyStatus = APIKeyStatus.ACTIVE
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None

    class Settings:
        name = "api_keys"
        use_state_management = True
