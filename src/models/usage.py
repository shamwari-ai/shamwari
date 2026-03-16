"""Usage event model — API consumption tracking.

Written to the shamwari_events CouchDB database on every API call.
Consumed by the CouchDB-to-Doris event pipeline via the _changes feed
for real-time analytics aggregation.

Schema.org mapping: UseAction
"""

from datetime import UTC, datetime

from pydantic import Field

from src.models.base import TimestampedDocument


class UsageEvent(TimestampedDocument):
    """A single API usage event.

    Written on every API call. Consumed by the event pipeline worker
    which transforms and loads into Apache Doris for analytics.

    CouchDB database: shamwari_events
    Document _id: "evt_{timestamp}_{uuid}"
    Schema.org @type: UseAction
    """

    type: str = "usage_event"
    event_type: str = Field(description="'api_call', 'chat_inference', 'on_device_sync'")
    api_key_id: str | None = None
    organization_id: str | None = None
    user_id: str | None = Field(default=None, description="Consumer user, if applicable")
    model_id: str | None = None
    model_version: str | None = None
    endpoint: str = Field(default="", description="e.g., /v1/chat/completions")
    tokens_input: int = 0
    tokens_output: int = 0
    latency_ms: int = 0
    region: str = Field(default="jnb", description="Fly.io region serving the request")
    status: str = Field(default="success", description="success, error, rate_limited")
    status_code: int = 200
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
