"""Smoke + behaviour tests for /v1/api-keys."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_keys_unauthenticated(client: TestClient) -> None:
    response = client.get("/v1/api-keys")
    assert response.status_code == 401


def test_list_keys_empty(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/api-keys", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_create_key_returns_secret_once(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    create = client.post(
        "/v1/api-keys",
        headers=auth_headers,
        json={"name": "production-web"},
    )
    assert create.status_code == 201
    body = create.json()
    assert body["name"] == "production-web"
    assert body["key"].startswith("shai_")
    assert body["key_prefix"] == body["key"][:12]

    listed = client.get("/v1/api-keys", headers=auth_headers).json()
    assert len(listed) == 1
    assert listed[0]["name"] == "production-web"
    assert "key" not in listed[0]
    assert listed[0]["key_prefix"] == body["key_prefix"]


def test_revoke_removes_key(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    created = client.post(
        "/v1/api-keys",
        headers=auth_headers,
        json={"name": "to-be-revoked"},
    ).json()

    revoke = client.delete(
        f"/v1/api-keys/{created['id']}",
        headers=auth_headers,
    )
    assert revoke.status_code == 204

    listed = client.get("/v1/api-keys", headers=auth_headers).json()
    assert listed == []


def test_revoke_unknown_key_404(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.delete("/v1/api-keys/key_does_not_exist", headers=auth_headers)
    assert response.status_code == 404


def test_keys_are_scoped_per_user(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    other = {"X-User-Id": "user_test_bob", "X-User-Email": "bob@example.com"}
    client.post("/v1/api-keys", headers=auth_headers, json={"name": "alice"})
    bob_keys = client.get("/v1/api-keys", headers=other).json()
    assert bob_keys == []
