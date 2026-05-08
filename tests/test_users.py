"""Profile (`/v1/users/me`) — defaults, persistence, partial PATCH."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_profile_requires_auth(client: TestClient) -> None:
    assert client.get("/v1/users/me").status_code == 401


def test_get_profile_seeds_defaults(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    r = client.get("/v1/users/me", headers=auth_headers)
    assert r.status_code == 200
    profile = r.json()
    assert profile["id"] == "user_test_alice"
    assert profile["preferences"]["language"] == "en"
    assert profile["preferences"]["theme"] == "system"


def test_patch_updates_name_and_preferences(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    patched = client.patch(
        "/v1/users/me",
        headers=auth_headers,
        json={
            "name": "Alice Q",
            "preferences": {
                "language": "sn",
                "theme": "dark",
                "notifications_enabled": False,
            },
        },
    ).json()
    assert patched["name"] == "Alice Q"
    assert patched["preferences"]["language"] == "sn"
    assert patched["preferences"]["theme"] == "dark"


def test_patch_persists_across_get(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    client.patch(
        "/v1/users/me",
        headers=auth_headers,
        json={"name": "Persist"},
    )
    profile = client.get("/v1/users/me", headers=auth_headers).json()
    assert profile["name"] == "Persist"
