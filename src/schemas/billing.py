"""Billing API schemas — Schema.org Offer, Order, Invoice alignment."""

from datetime import datetime

from pydantic import BaseModel, Field

from src.schemas.base import SchemaOrgMixin


class BillingPlanResponse(SchemaOrgMixin):
    """Billing plan response.

    Schema.org @type: Offer
    Maps: price_monthly_usd → price, name → name
    """

    schema_type: str = Field(default="Offer", alias="@type", serialization_alias="@type")
    id: str = Field(description="Plan document ID")
    name: str = Field(description="Plan name (Schema.org: name)")
    slug: str
    description: str = Field(default="", description="Schema.org: description")
    price: float = Field(description="Monthly price in USD (Schema.org: price)")
    price_currency: str = Field(default="USD", description="Schema.org: priceCurrency")
    price_annual_usd: float
    eligible_quantity: int = Field(description="Monthly token quota (Schema.org: eligibleQuantity)")
    rate_limit_rpm: int
    max_api_keys: int
    features: list[str]
    is_active: bool


class PaymentMethodResponse(BaseModel):
    """Payment method summary."""

    type: str = Field(description="card, mobile_money, bank_transfer")
    last4: str | None = None
    brand: str | None = None
    provider: str | None = None


class SubscriptionResponse(SchemaOrgMixin):
    """Subscription response.

    Schema.org @type: Order
    Maps: plan → orderedItem, status → orderStatus
    """

    schema_type: str = Field(default="Order", alias="@type", serialization_alias="@type")
    id: str = Field(description="Subscription document ID")
    ordered_item: str = Field(description="Plan ID (Schema.org: orderedItem)")
    order_status: str = Field(description="Subscription status (Schema.org: orderStatus)")
    organization_id: str
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool
    payment_method: PaymentMethodResponse | None = None
    created_at: datetime


class InvoiceLineItemResponse(BaseModel):
    """Invoice line item."""

    description: str
    quantity: int
    unit_price_usd: float
    amount_usd: float


class InvoiceResponse(SchemaOrgMixin):
    """Invoice response.

    Schema.org @type: Invoice
    Maps: amount_usd → totalPaymentDue, status → paymentStatus
    """

    schema_type: str = Field(default="Invoice", alias="@type", serialization_alias="@type")
    id: str = Field(description="Invoice document ID")
    organization_id: str
    total_payment_due: float = Field(
        description="Invoice amount in USD (Schema.org: totalPaymentDue)"
    )
    payment_status: str = Field(description="Invoice status (Schema.org: paymentStatus)")
    currency: str = Field(default="USD")
    line_items: list[InvoiceLineItemResponse]
    period_start: datetime | None = None
    period_end: datetime | None = None
    due_date: datetime | None = None
    paid_at: datetime | None = None
    created_at: datetime
