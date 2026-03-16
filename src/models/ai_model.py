"""AI Model registry — tracks model versions, capabilities, and pricing.

Each model version is a separate document. Models are served via the
inference engine (cloud) or downloaded to devices (on-device via R2).
Stored in shamwari_platform CouchDB database.

Schema.org mapping: SoftwareApplication
"""

from enum import StrEnum

from pydantic import BaseModel, Field

from src.models.base import TimestampedDocument


class ModelStatus(StrEnum):
    TRAINING = "training"
    READY = "ready"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class ModelCapability(StrEnum):
    CHAT = "chat"
    COMPLETION = "completion"
    TRANSLATION = "translation"
    SUMMARIZATION = "summarization"
    EMBEDDING = "embedding"


class ModelPricing(BaseModel):
    """Embedded: per-token pricing in USD for API usage."""

    input_per_1k_tokens: float = 0.0
    output_per_1k_tokens: float = 0.0


class AIModel(TimestampedDocument):
    """A registered AI model version in the Shamwari AI platform.

    Tracks model metadata, supported languages, capabilities, and pricing.
    Artifacts (weights, configs) are stored in Cloudflare R2.

    CouchDB database: shamwari_platform
    Document _id: "model_{slug}_{version}"
    Schema.org @type: SoftwareApplication
    """

    type: str = "ai_model"
    name: str
    slug: str
    version: str
    parameter_count: str = Field(description="e.g., '1B', '3B', '7B'")
    quantization: str | None = Field(
        default=None, description="e.g., 'fp16', 'int8', 'int4', 'q4_k_m'"
    )
    supported_languages: list[str] = Field(
        default_factory=lambda: ["en"],
        description="ISO 639-1 codes: en, sn (Shona), nd (Ndebele)",
    )
    description: str = ""
    capabilities: list[ModelCapability] = Field(default_factory=lambda: [ModelCapability.CHAT])
    max_context_length: int = 2048
    artifact_url: str | None = Field(default=None, description="R2 path to model artifacts")
    status: ModelStatus = ModelStatus.TRAINING
    pricing: ModelPricing = Field(default_factory=ModelPricing)
