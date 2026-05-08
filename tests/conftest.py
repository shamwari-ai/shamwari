"""Pytest fixtures.

Tests run with header-based auth (SHAMWARI_ALLOW_HEADER_AUTH=1) so we
can drive the API without a real WorkOS session. The in-memory store is
reset between tests so per-user state never leaks.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SHAMWARI_ALLOW_HEADER_AUTH", "1")

from src.main import app  # noqa: E402
from src.store import memory  # noqa: E402


@pytest.fixture
def client() -> Iterator[TestClient]:
    memory.reset_for_tests()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {
        "X-User-Id": "user_test_alice",
        "X-User-Email": "alice@example.com",
    }
