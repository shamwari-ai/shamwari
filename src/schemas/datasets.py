"""Dataset API schemas — Schema.org Dataset alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class DatasetResponse(SchemaOrgMixin):
    """Dataset response.

    Schema.org @type: Dataset
    Maps: language → inLanguage, format → encodingFormat
    """

    schema_type: str = Field(default="Dataset", alias="@type", serialization_alias="@type")
    id: str = Field(description="Dataset document ID")
    name: str = Field(description="Dataset name (Schema.org: name)")
    description: str = Field(default="", description="Schema.org: description")
    in_language: str = Field(description="Language, ISO 639-1 (Schema.org: inLanguage)")
    encoding_format: str = Field(description="File format (Schema.org: encodingFormat)")
    source: str = Field(default="", description="Data provenance")
    record_count: int
    size_bytes: int
    artifact_url: str | None = None
    status: str = Field(description="uploading, processing, ready, archived")
    domain: str | None = None
    quality_score: float | None = None
    created_by_user_id: str | None = None
    created_at: datetime


class DatasetCreateRequest(BaseModel):
    """Create dataset request."""

    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    language: str = Field(max_length=5, description="ISO 639-1 code")
    source: str = Field(default="", max_length=500)
    format: str = Field(default="jsonl", description="jsonl, csv, parquet, txt")
    domain: str | None = Field(default=None, max_length=50)
