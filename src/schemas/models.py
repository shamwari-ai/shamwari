"""AI Model API schemas — Schema.org SoftwareApplication alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class ModelPricingResponse(BaseModel):
    """Model pricing per 1k tokens."""

    input_per_1k_tokens: float
    output_per_1k_tokens: float


class AIModelResponse(SchemaOrgMixin):
    """AI model response.

    Schema.org @type: SoftwareApplication
    Maps: version → softwareVersion, capabilities → applicationCategory,
          supported_languages → inLanguage
    """

    schema_type: str = Field(
        default="SoftwareApplication", alias="@type", serialization_alias="@type"
    )
    id: str = Field(description="Model document ID")
    name: str = Field(description="Model name (Schema.org: name)")
    slug: str
    software_version: str = Field(description="Model version (Schema.org: softwareVersion)")
    application_category: list[str] = Field(
        description="Model capabilities (Schema.org: applicationCategory)"
    )
    in_language: list[str] = Field(
        description="Supported languages, ISO 639-1 (Schema.org: inLanguage)"
    )
    description: str = Field(default="", description="Schema.org: description")
    parameter_count: str = Field(description="e.g., '1B', '3B', '7B'")
    quantization: str | None = None
    max_context_length: int
    artifact_url: str | None = Field(default=None, description="R2 download path")
    status: str = Field(description="Model status: training, ready, deprecated, archived")
    pricing: ModelPricingResponse
    created_at: datetime


class AIModelListResponse(BaseModel):
    """List of AI models response."""

    models: list[AIModelResponse]
    total: int = Field(description="Total number of models")
