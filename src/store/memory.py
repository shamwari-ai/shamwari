"""Per-user in-process store.

A pragmatic stand-in for CouchDB. The router code reads/writes through
this layer so we can ship working endpoints (and tests) without
requiring CouchDB to be deployed. Once Fly's CouchDB service is online
we replace these calls with src/db/couch.py reads/writes — the public
API does not change.

Not safe across multi-process deploys. Fine for staging + local dev.
"""

from __future__ import annotations

from collections import defaultdict
from threading import Lock
from typing import Any

_lock = Lock()
_keys: dict[str, list[dict[str, Any]]] = defaultdict(list)
_usage_events: dict[str, list[dict[str, Any]]] = defaultdict(list)
_profiles: dict[str, dict[str, Any]] = {}


def list_keys(user_id: str) -> list[dict[str, Any]]:
    with _lock:
        return [dict(k) for k in _keys.get(user_id, [])]


def insert_key(user_id: str, key: dict[str, Any]) -> None:
    with _lock:
        _keys[user_id].append(dict(key))


def remove_key(user_id: str, key_id: str) -> bool:
    with _lock:
        before = _keys.get(user_id, [])
        after = [k for k in before if k.get("id") != key_id]
        _keys[user_id] = after
        return len(after) != len(before)


def list_usage_events(user_id: str) -> list[dict[str, Any]]:
    with _lock:
        return [dict(e) for e in _usage_events.get(user_id, [])]


def get_profile(user_id: str) -> dict[str, Any] | None:
    with _lock:
        profile = _profiles.get(user_id)
        return dict(profile) if profile else None


def upsert_profile(user_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        existing = _profiles.get(user_id, {})
        existing.update(profile)
        _profiles[user_id] = existing
        return dict(existing)


def reset_for_tests() -> None:
    """Wipe everything — tests call this in fixtures."""
    with _lock:
        _keys.clear()
        _usage_events.clear()
        _profiles.clear()
