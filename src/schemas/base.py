"""Base schema with Schema.org structured data support.

Provides SchemaOrgMixin for API response models that should include
@context and @type fields in their JSON serialization.
"""

from pydantic import BaseModel, Field


class SchemaOrgMixin(BaseModel):
    """Mixin that adds Schema.org @context and @type to JSON output.

    Uses Pydantic v2 serialization_alias so that:
    - Python code uses schema_context / schema_type
    - JSON output uses @context / @type

    Example output:
        {
            "@context": "https://schema.org",
            "@type": "Person",
            "name": "Tendai",
            ...
        }
    """

    schema_context: str = Field(
        default="https://schema.org",
        alias="@context",
        serialization_alias="@context",
    )
    schema_type: str = Field(
        alias="@type",
        serialization_alias="@type",
    )

    model_config = {"populate_by_name": True}
