"""Usage record model — API consumption tracking (time-series pattern).

High-volume collection optimized for writes and time-range queries.
TTL index automatically expires raw records after 90 days.
Aggregated summaries (daily/monthly) are computed by MongoDB scheduled triggers.
"""

from datetime import UTC, datetime

from beanie import Indexed
from pydantic import Field

from src.models.base import TimestampedDocument


class UsageRecord(TimestampedDocument):
    """A single API usage event.

    Written on every API call. Indexed for time-range queries by
    organization, API key, and model. TTL-expired after 90 days;
    MongoDB scheduled triggers aggregate into daily/monthly summaries
    before expiration.
    """

    api_key_id: str
    organization_id: Indexed(str)  # type: ignore[valid-type]
    user_id: str | None = Field(default=None, description="Consumer user, if applicable")
    model_id: str
    endpoint: str = Field(description="e.g., /v1/chat/completions")
    tokens_input: int = 0
    tokens_output: int = 0
    response_time_ms: int = 0
    status_code: int = 200
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "usage_records"
        use_state_management = True
        indexes = [
            [("timestamp", 1)],
            [("api_key_id", 1), ("timestamp", -1)],
            [("organization_id", 1), ("timestamp", -1)],
            [("model_id", 1), ("timestamp", -1)],
        ]
        # TTL: 90 days (7_776_000 seconds). Raw records auto-expire.
        # MongoDB scheduled triggers aggregate before expiration.
        timeseries = {
            "timeField": "timestamp",
            "metaField": "organization_id",
            "granularity": "minutes",
            "expireAfterSeconds": 7_776_000,
        }
