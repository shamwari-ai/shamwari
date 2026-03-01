"""Billing models — plans, subscriptions, and invoices.

Designed for the African market: USD pricing with affordability tiers.
Organizations own subscriptions. Invoices track payment history.
"""

from datetime import datetime
from enum import StrEnum

from beanie import Indexed
from pydantic import BaseModel, Field

from src.models.base import TimestampedDocument


# ---------------------------------------------------------------------------
# Billing Plans
# ---------------------------------------------------------------------------


class BillingPlan(TimestampedDocument):
    """A pricing tier for API access.

    Tiers designed for affordability: Free tier for experimentation,
    paid tiers for production use by African businesses and developers.
    """

    name: str = Field(description="e.g., Free, Starter, Pro, Enterprise")
    slug: Indexed(str, unique=True)  # type: ignore[valid-type]
    description: str = ""
    price_monthly_usd: float = 0.0
    price_annual_usd: float = 0.0
    token_quota_monthly: int = Field(
        default=10_000, description="Monthly token allowance"
    )
    rate_limit_rpm: int = Field(default=10, description="Requests per minute")
    max_api_keys: int = 1
    features: list[str] = Field(
        default_factory=list, description="Feature flags: e.g., 'priority_support'"
    )
    is_active: bool = True

    class Settings:
        name = "billing_plans"
        use_state_management = True


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    TRIALING = "trialing"


class PaymentMethod(BaseModel):
    """Embedded: payment method summary (no sensitive card data stored)."""

    type: str = Field(description="card, mobile_money, bank_transfer")
    last4: str | None = None
    brand: str | None = None
    provider: str | None = Field(
        default=None, description="e.g., 'ecocash', 'innbucks', 'stripe'"
    )


class Subscription(TimestampedDocument):
    """An organization's active subscription to a billing plan.

    Tracks billing periods and payment method. One active subscription
    per organization.
    """

    organization_id: Indexed(str, unique=True)  # type: ignore[valid-type]
    plan_id: str
    status: SubscriptionStatus = SubscriptionStatus.TRIALING
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    payment_method: PaymentMethod | None = None

    class Settings:
        name = "subscriptions"
        use_state_management = True


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    PAID = "paid"
    VOID = "void"
    UNCOLLECTIBLE = "uncollectible"


class InvoiceLineItem(BaseModel):
    """Embedded: a single line item on an invoice."""

    description: str
    quantity: int = 1
    unit_price_usd: float = 0.0
    amount_usd: float = 0.0


class Invoice(TimestampedDocument):
    """A billing record for an organization.

    Line items are embedded (small, bounded array, always read together).
    """

    organization_id: Indexed(str)  # type: ignore[valid-type]
    subscription_id: str | None = None
    amount_usd: float = 0.0
    currency: str = "USD"
    status: InvoiceStatus = InvoiceStatus.DRAFT
    line_items: list[InvoiceLineItem] = Field(default_factory=list)
    period_start: datetime | None = None
    period_end: datetime | None = None
    due_date: datetime | None = None
    paid_at: datetime | None = None

    class Settings:
        name = "invoices"
        use_state_management = True
        indexes = [
            [("organization_id", 1), ("created_at", -1)],
            [("status", 1)],
        ]
