"""Usage router — API consumption analytics."""

from fastapi import APIRouter, HTTPException

from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.usage import UsageResponse, UsageSummaryResponse

router = APIRouter(prefix="/v1", tags=["usage"])


@router.get(
    "/usage",
    response_model=PaginatedResponse[UsageResponse],
    summary="List usage events",
    description=(
        "Returns paginated API usage events with Schema.org UseAction structured data. "
        "Filter by date range, model, or API key."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_usage(
    page: int = 1,
    per_page: int = 50,
    api_key_id: str | None = None,
    model_id: str | None = None,
) -> PaginatedResponse[UsageResponse]:
    """List usage events for the current organization."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/usage/summary",
    response_model=UsageSummaryResponse,
    summary="Get usage summary",
    description=(
        "Returns aggregated usage metrics for the current billing period. "
        "Includes total requests, tokens, latency averages, and error rates."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def get_usage_summary() -> UsageSummaryResponse:
    """Get aggregated usage summary."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
