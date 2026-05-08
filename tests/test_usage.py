"""Usage events + summary aggregation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from src.store import memory


def test_usage_summary_empty(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/usage/summary", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total_requests"] == 0
    assert body["total_tokens"] == 0


def test_usage_summary_aggregates_recent_events(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    user_id = "user_test_alice"
    now = datetime.now(UTC)
    memory._usage_events[user_id] = [
        {
            "id": "evt_1",
            "event_type": "api_call",
            "tokens_input": 100,
            "tokens_output": 50,
            "latency_ms": 200,
            "status": "success",
            "start_time": (now - timedelta(days=1)).isoformat(),
        },
        {
            "id": "evt_2",
            "event_type": "api_call",
            "tokens_input": 60,
            "tokens_output": 40,
            "latency_ms": 150,
            "status": "error",
            "start_time": (now - timedelta(days=2)).isoformat(),
        },
    ]
    body = client.get(
        "/v1/usage/summary",
        headers=auth_headers,
        params={"range": "30d"},
    ).json()
    assert body["total_requests"] == 2
    assert body["total_tokens_input"] == 160
    assert body["total_tokens_output"] == 90
    assert body["error_count"] == 1


def test_list_usage_returns_pagination_envelope(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/usage", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert body["page"] == 1
