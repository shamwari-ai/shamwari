"""Billing endpoints — plans, subscription default, portal stub."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_plans_requires_auth(client: TestClient) -> None:
    assert client.get("/v1/billing/plans").status_code == 401


def test_plans_returns_three_tiers(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/billing/plans", headers=auth_headers)
    assert r.status_code == 200
    plans = r.json()
    assert {p["id"] for p in plans} == {"plan_free", "plan_developer", "plan_business"}


def test_subscription_defaults_to_free(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/billing/subscription", headers=auth_headers)
    assert r.status_code == 200
    sub = r.json()
    # Pydantic serializes Schema.org-aliased fields by alias OR field name
    # depending on FastAPI's response_model_by_alias; accept both shapes.
    assert sub.get("orderedItem", sub.get("ordered_item")) == "plan_free"
    assert sub.get("orderStatus", sub.get("order_status")) == "active"


def test_invoices_returns_empty_for_new_user(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/billing/invoices", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_portal_returns_fallback_url(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.post("/v1/billing/portal", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["url"].startswith("https://")
