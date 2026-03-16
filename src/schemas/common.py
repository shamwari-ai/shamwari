"""Common API schemas — shared response wrappers and error models."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginated list response wrapper."""

    items: list[T]
    total: int = Field(description="Total number of items matching the query")
    page: int = Field(default=1, description="Current page number (1-indexed)")
    per_page: int = Field(default=25, description="Items per page")


class ErrorResponse(BaseModel):
    """Standard API error response (RFC 7807-inspired)."""

    error: str = Field(description="Machine-readable error code")
    detail: str | None = Field(default=None, description="Human-readable error description")
    status_code: int = Field(description="HTTP status code")


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(default="ok", description="Service health status")
