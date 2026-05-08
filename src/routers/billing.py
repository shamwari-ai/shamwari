"""Billing router — plans, subscriptions, and invoices.

Implementations are deliberately minimal: a hardcoded plans table that
matches /pricing on the marketing site, an empty subscription/invoice
projection for free-tier users, and a stub portal endpoint that the
frontend can already wire against. When Stripe Customer Portal is
provisioned the portal handler will return a real URL.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.auth.dependencies import CurrentUser, current_user
from src.schemas.billing import BillingPlanResponse, InvoiceResponse, SubscriptionResponse
from src.schemas.common import ErrorResponse, PaginatedResponse

router = APIRouter(prefix="/v1/billing", tags=["billing"])


_PLANS: list[dict[str, Any]] = [
    {
        "@type": "Offer",
        "id": "plan_free",
        "name": "Free",
        "slug": "free",
        "description": "Rate-limited chat and API for hobby projects.",
        "price": 0.0,
        "price_currency": "USD",
        "price_annual_usd": 0.0,
        "eligible_quantity": 50_000,
        "rate_limit_rpm": 10,
        "max_api_keys": 2,
        "features": ["Chat at shamwari.ai", "Open weights", "Community support"],
        "is_active": True,
    },
    {
        "@type": "Offer",
        "id": "plan_developer",
        "name": "Developer",
        "slug": "developer",
        "description": "1M tokens included, dashboards, email support.",
        "price": 19.0,
        "price_currency": "USD",
        "price_annual_usd": 190.0,
        "eligible_quantity": 1_000_000,
        "rate_limit_rpm": 60,
        "max_api_keys": 10,
        "features": [
            "API keys with usage dashboards",
            "Email support",
            "1M tokens / month included",
        ],
        "is_active": True,
    },
    {
        "@type": "Offer",
        "id": "plan_business",
        "name": "Business",
        "slug": "business",
        "description": "Dedicated capacity, on-prem, language tuning, SLAs.",
        "price": 0.0,
        "price_currency": "USD",
        "price_annual_usd": 0.0,
        "eligible_quantity": 0,
        "rate_limit_rpm": 600,
        "max_api_keys": 100,
        "features": [
            "Dedicated inference capacity",
            "On-prem deployment",
            "Custom language tuning",
            "SLA-backed support",
        ],
        "is_active": True,
    },
]


class BillingPortalResponse(BaseModel):
    """Stripe-style billing portal session."""

    url: str = Field(description="Hosted billing portal URL")
    expires_at: datetime = Field(description="Portal session expiry")


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
async def list_plans(_: CurrentUser = Depends(current_user)) -> list[BillingPlanResponse]:
    return [BillingPlanResponse.model_validate(p) for p in _PLANS]


@router.get(
    "/subscription",
    response_model=SubscriptionResponse,
    summary="Get current subscription",
    description=(
        "Returns the current organization's subscription with Schema.org Order "
        "structured data. New accounts default to the Free tier."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def get_subscription(
    user: CurrentUser = Depends(current_user),
) -> SubscriptionResponse:
    now = datetime.now(UTC)
    return SubscriptionResponse(
        id=f"sub_{user.id}",
        ordered_item="plan_free",
        order_status="active",
        organization_id=user.organization_id or user.id,
        current_period_start=None,
        current_period_end=None,
        cancel_at_period_end=False,
        payment_method=None,
        created_at=now,
    )


@router.get(
    "/invoices",
    response_model=PaginatedResponse[InvoiceResponse],
    summary="List invoices",
    description=("Returns paginated invoice history with Schema.org Invoice structured data."),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
    },
)
async def list_invoices(
    page: int = 1,
    per_page: int = 25,
    _: CurrentUser = Depends(current_user),
) -> PaginatedResponse[InvoiceResponse]:
    return PaginatedResponse[InvoiceResponse](
        items=[],
        total=0,
        page=page,
        per_page=per_page,
    )


@router.post(
    "/portal",
    response_model=BillingPortalResponse,
    summary="Create billing portal session",
    description=(
        "Returns a Stripe-style hosted billing portal URL where the user can "
        "manage their card, plan, and invoices. While Stripe is not yet "
        "wired up the response points at /pricing on the marketing site so the "
        "frontend can already link out from the dashboard."
    ),
    responses={
        401: {"model": ErrorResponse, "description": "Authentication required"},
        503: {"model": ErrorResponse, "description": "Billing not configured"},
    },
)
async def create_billing_portal_session(
    _: CurrentUser = Depends(current_user),
) -> BillingPortalResponse:
    fallback = os.environ.get(
        "BILLING_PORTAL_FALLBACK_URL",
        "https://shamwari.ai/pricing",
    )
    expires_at = datetime.now(UTC).replace(microsecond=0)
    if not fallback:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing portal not configured",
        )
    return BillingPortalResponse(url=fallback, expires_at=expires_at)
