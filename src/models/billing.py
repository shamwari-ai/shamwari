"""Billing models — plans, subscriptions, and invoices.

Designed for the African market: USD pricing with affordability tiers.
Organizations own subscriptions. Stored in shamwari_platform CouchDB database.

Schema.org mappings: BillingPlan → Offer, Subscription → Order, Invoice → Invoice
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from src.models.base import TimestampedDocument

# ---------------------------------------------------------------------------
# Billing Plans (Schema.org: Offer)
# ---------------------------------------------------------------------------


class BillingPlan(TimestampedDocument):
    """A pricing tier for API access.

    Tiers designed for affordability: Free tier for experimentation,
    paid tiers for production use by African businesses and developers.

    CouchDB database: shamwari_platform
    Document _id: "plan_{slug}"
    Schema.org @type: Offer
    """

    type: str = "billing_plan"
    name: str = Field(description="e.g., Free, Starter, Pro, Enterprise")
    slug: str
    description: str = ""
    price_monthly_usd: float = 0.0
    price_annual_usd: float = 0.0
    token_quota_monthly: int = Field(default=10_000, description="Monthly token allowance")
    rate_limit_rpm: int = Field(default=10, description="Requests per minute")
    max_api_keys: int = 1
    features: list[str] = Field(
        default_factory=list, description="Feature flags: e.g., 'priority_support'"
    )
    is_active: bool = True


# ---------------------------------------------------------------------------
# Subscriptions (Schema.org: Order)
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
    provider: str | None = Field(default=None, description="e.g., 'ecocash', 'innbucks', 'stripe'")


class Subscription(TimestampedDocument):
    """An organization's active subscription to a billing plan.

    Tracks billing periods and payment method. One active subscription
    per organization.

    CouchDB database: shamwari_platform
    Document _id: "sub_{organization_id}"
    Schema.org @type: Order
    """

    type: str = "subscription"
    organization_id: str
    plan_id: str
    status: SubscriptionStatus = SubscriptionStatus.TRIALING
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    payment_method: PaymentMethod | None = None


# ---------------------------------------------------------------------------
# Invoices (Schema.org: Invoice)
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

    CouchDB database: shamwari_platform
    Document _id: "inv_{uuid}"
    Schema.org @type: Invoice
    """

    type: str = "invoice"
    organization_id: str
    subscription_id: str | None = None
    amount_usd: float = 0.0
    currency: str = "USD"
    status: InvoiceStatus = InvoiceStatus.DRAFT
    line_items: list[InvoiceLineItem] = Field(default_factory=list)
    period_start: datetime | None = None
    period_end: datetime | None = None
    due_date: datetime | None = None
    paid_at: datetime | None = None
