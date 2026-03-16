"""Usage API schemas — Schema.org UseAction alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class UsageResponse(SchemaOrgMixin):
    """Usage event response.

    Schema.org @type: UseAction
    Maps: tokens → result, timestamp → startTime
    """

    schema_type: str = Field(default="UseAction", alias="@type", serialization_alias="@type")
    id: str = Field(description="Event document ID")
    event_type: str = Field(description="api_call, chat_inference, on_device_sync")
    instrument: str | None = Field(default=None, description="API key ID (Schema.org: instrument)")
    agent: str | None = Field(default=None, description="User ID (Schema.org: agent)")
    object: str | None = Field(default=None, description="Model ID (Schema.org: object)")
    model_version: str | None = None
    endpoint: str = Field(default="")
    tokens_input: int = 0
    tokens_output: int = 0
    latency_ms: int = 0
    region: str = Field(default="jnb")
    status: str = Field(default="success")
    start_time: datetime = Field(description="Event timestamp (Schema.org: startTime)")


class UsageSummaryResponse(BaseModel):
    """Aggregated usage summary for a time period."""

    period_start: datetime
    period_end: datetime
    total_requests: int = 0
    total_tokens_input: int = 0
    total_tokens_output: int = 0
    total_tokens: int = 0
    average_latency_ms: float = 0.0
    success_count: int = 0
    error_count: int = 0
    rate_limited_count: int = 0
