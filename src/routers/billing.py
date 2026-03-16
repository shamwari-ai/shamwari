"""Billing router — plans, subscriptions, and invoices."""

from fastapi import APIRouter, HTTPException

from src.schemas.billing import BillingPlanResponse, InvoiceResponse, SubscriptionResponse
from src.schemas.common import ErrorResponse, PaginatedResponse

router = APIRouter(prefix="/v1/billing", tags=["billing"])


@router.get(
    "/plans",
    response_model=list[BillingPlanResponse],
    summary="List billing plans",
    description=(
        "Returns all active billing plans with Schema.org Offer structured data. "
        "Includes pricing, token quotas, rate limits, and feature flags."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Invalid or missing API key"},
    },
)
async def list_plans() -> list[BillingPlanResponse]:
    """List all active billing plans."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/subscription",
    response_model=SubscriptionResponse,
    summary="Get current subscription",
    description=(
        "Returns the current organization's subscription with Schema.org Order "
        "structured data. Includes billing period, status, and payment method."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        404: {"model": ErrorResponse, "description": "No active subscription"},
    },
)
async def get_subscription() -> SubscriptionResponse:
    """Get the current organization's subscription."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@router.get(
    "/invoices",
    response_model=PaginatedResponse[InvoiceResponse],
    summary="List invoices",
    description=(
        "Returns paginated invoice history with Schema.org Invoice structured data. "
        "Includes line items, payment status, and billing periods."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_invoices(
    page: int = 1,
    per_page: int = 25,
) -> PaginatedResponse[InvoiceResponse]:
    """List invoices for the current organization."""
    raise HTTPException(status_code=501, detail="Not yet implemented")
