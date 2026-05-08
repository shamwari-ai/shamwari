"""Usage router — API consumption analytics."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query

from src.auth.dependencies import CurrentUser, current_user
from src.schemas.common import ErrorResponse, PaginatedResponse
from src.schemas.usage import UsageResponse, UsageSummaryResponse
from src.store import memory

router = APIRouter(prefix="/v1", tags=["usage"])


_RANGE_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}


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
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    api_key_id: str | None = None,
    model_id: str | None = None,
    user: CurrentUser = Depends(current_user),
) -> PaginatedResponse[UsageResponse]:
    """List usage events for the current organization."""
    events = memory.list_usage_events(user.id)
    if api_key_id:
        events = [e for e in events if e.get("instrument") == api_key_id]
    if model_id:
        events = [e for e in events if e.get("object") == model_id]

    total = len(events)
    start = (page - 1) * per_page
    page_items = events[start : start + per_page]
    items = [UsageResponse.model_validate(e) for e in page_items]
    return PaginatedResponse[UsageResponse](
        items=items,
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get(
    "/usage/summary",
    response_model=UsageSummaryResponse,
    summary="Get usage summary",
    description=(
        "Returns aggregated usage metrics for the requested rolling window. "
        "Pass `range=7d|30d|90d`. Defaults to 30 days."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def get_usage_summary(
    range_: str = Query(default="30d", alias="range"),
    user: CurrentUser = Depends(current_user),
) -> UsageSummaryResponse:
    """Aggregate usage events for the user over the requested window."""
    days = _RANGE_DAYS.get(range_, 30)
    period_end = datetime.now(UTC)
    period_start = period_end - timedelta(days=days)

    events = memory.list_usage_events(user.id)
    in_window: list[dict[str, Any]] = []
    for event in events:
        ts = event.get("start_time")
        if isinstance(ts, str):
            try:
                ts_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                continue
            if ts_dt >= period_start:
                in_window.append(event)

    return _aggregate(in_window, period_start, period_end)


def _aggregate(
    events: list[dict[str, Any]],
    period_start: datetime,
    period_end: datetime,
) -> UsageSummaryResponse:
    if not events:
        return UsageSummaryResponse(
            period_start=period_start,
            period_end=period_end,
        )
    total_input = sum(int(e.get("tokens_input", 0)) for e in events)
    total_output = sum(int(e.get("tokens_output", 0)) for e in events)
    success = sum(1 for e in events if e.get("status") == "success")
    error = sum(1 for e in events if e.get("status") == "error")
    rate_limited = sum(1 for e in events if e.get("status") == "rate_limited")
    latencies = [int(e.get("latency_ms", 0)) for e in events]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0.0
    return UsageSummaryResponse(
        period_start=period_start,
        period_end=period_end,
        total_requests=len(events),
        total_tokens_input=total_input,
        total_tokens_output=total_output,
        total_tokens=total_input + total_output,
        average_latency_ms=avg_latency,
        success_count=success,
        error_count=error,
        rate_limited_count=rate_limited,
    )
