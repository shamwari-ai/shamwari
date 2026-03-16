"""Dataset model — training data registry for African language models.

Dataset files are stored in Cloudflare R2. This document tracks metadata,
provenance, and processing status. Stored in shamwari_platform CouchDB database.

Schema.org mapping: Dataset
"""

from enum import StrEnum

from pydantic import Field

from src.models.base import TimestampedDocument


class DatasetStatus(StrEnum):
    UPLOADING = "uploading"
    PROCESSING = "processing"
    READY = "ready"
    ARCHIVED = "archived"


class DatasetFormat(StrEnum):
    JSONL = "jsonl"
    CSV = "csv"
    PARQUET = "parquet"
    TXT = "txt"


class Dataset(TimestampedDocument):
    """A training or evaluation dataset for Shamwari AI models.

    Files stored in R2, metadata tracked here. Language-tagged for
    the multilingual training pipeline (Shona, Ndebele, English, etc.).

    CouchDB database: shamwari_platform
    Document _id: "dataset_{uuid}"
    Schema.org @type: Dataset
    """

    type: str = "dataset"
    name: str
    description: str = ""
    language: str = Field(description="ISO 639-1: sn (Shona), nd (Ndebele), en, etc.")
    source: str = Field(default="", description="Data provenance description")
    format: DatasetFormat = DatasetFormat.JSONL
    record_count: int = 0
    size_bytes: int = 0
    artifact_url: str | None = Field(default=None, description="R2 path to dataset file")
    status: DatasetStatus = DatasetStatus.UPLOADING
    domain: str | None = Field(
        default=None,
        description="e.g., education, commerce, agriculture, health, general",
    )
    quality_score: float | None = Field(default=None, ge=0.0, le=1.0)
    created_by_user_id: str | None = None
