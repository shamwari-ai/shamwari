"""
Core's only door to data: the Nyuchi API's /v1/shamwari routes.

Core holds no database login. It reaches Ground, the sink and usage through the
Nyuchi API (nyuchi/nyuchi-api#393), over Fly's private network, with one internal
key. The decisions Core exists to make (scope, provenance) are made in main.py
BEFORE a call is built; the API checks them again on its side.

Behaviour that matters:

  * Fail closed. If the API cannot be reached, answers 5xx, or refuses Core's own
    credential, the caller gets DataApiUnavailable and Core answers 503. Nothing is
    guessed, cached or served from a stale copy.
  * A refusal on a rule (400/409/413/422) is not an outage. It is passed through as
    DataApiRefusal with the API's own body, so a 409 scope_requires_local_inference
    from the API reaches the caller as that 409.
  * Retries are bounded and only where they are safe: reads, and the sink (its
    records have content-derived ids, so a retry is a counted duplicate, not a
    second row). One retry, short backoff, then the failure stands.
  * No secret, header, body or query is logged. Failures log the method, the path
    and a status or exception class, nothing else.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("shamwari.core.data_api")

DEFAULT_URL = "http://nyuchi-api.internal:8080"
#: The API trusts a list of hosts and `.internal` is not on it, so Core presents the
#: public name while connecting over the private address.
DEFAULT_HOST = "api.nyuchi.com"

#: A status that means "this request broke a rule", not "the service is down". 404 is not
#: here: a missing route (Core deployed before the API has it, or a misrouted path) is an
#: outage, and must fail closed rather than look like an ordinary client error.
_REFUSALS = frozenset({400, 409, 413, 422})
_RETRYABLE = frozenset({502, 503, 504})


class DataApiUnavailable(Exception):
    """The API could not answer. Core answers 503; nothing is served in its place."""


class DataApiRefusal(Exception):
    """The API refused on a rule. `detail` is its body, passed on to the caller."""

    def __init__(self, status_code: int, detail: Any) -> None:
        super().__init__(f"data api refused: {status_code}")
        self.status_code = status_code
        self.detail = detail


class DataApi:
    def __init__(
        self,
        *,
        key: str,
        base_url: str = DEFAULT_URL,
        host: str = DEFAULT_HOST,
        http: httpx.AsyncClient | None = None,
        retries: int = 1,
        backoff: float = 0.2,
    ) -> None:
        if not key:
            raise ValueError("an internal key is required")
        self._http = http or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(10.0, connect=3.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        self._headers = {
            "X-API-Key": key,
            "Host": host,
            "Accept": "application/json",
            "User-Agent": "shamwari-core",
        }
        self._retries = retries
        self._backoff = backoff

    @classmethod
    def from_env(cls) -> "DataApi":
        return cls(
            key=os.environ["NYUCHI_API_INTERNAL_KEY"],
            base_url=os.environ.get("NYUCHI_API_URL", DEFAULT_URL),
            host=os.environ.get("NYUCHI_API_HOST", DEFAULT_HOST),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # -- the one place a request is made ---------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        retry: bool = True,
    ) -> Any:
        attempts = 1 + (self._retries if retry else 0)
        last = "unreachable"
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(self._backoff * attempt)
            try:
                res = await self._http.request(
                    method, path, json=json, params=params, headers=self._headers
                )
            except (httpx.TransportError, httpx.TimeoutException) as e:
                last = type(e).__name__
                continue

            if res.status_code in _RETRYABLE:
                last = str(res.status_code)
                continue
            if res.status_code in (401, 403):
                # Core's own credential is wrong or lacks a scope. Not the caller's fault,
                # not retryable, and not something to describe to a caller.
                log.error("data api refused Core's key: %s %s -> %s", method, path, res.status_code)
                raise DataApiUnavailable("credential")
            if res.status_code == 429:
                log.warning("data api rate limit: %s %s", method, path)
                raise DataApiUnavailable("rate_limited")
            if res.status_code in _REFUSALS:
                raise DataApiRefusal(res.status_code, _detail(res))
            if res.status_code >= 400:
                log.error("data api error: %s %s -> %s", method, path, res.status_code)
                raise DataApiUnavailable(str(res.status_code))
            try:
                return res.json()
            except ValueError:
                log.error("data api returned a non-JSON body: %s %s", method, path)
                raise DataApiUnavailable("malformed") from None

        log.error("data api unavailable: %s %s (%s)", method, path, last)
        raise DataApiUnavailable(last)

    # -- /v1/shamwari ------------------------------------------------------------

    async def whoami(self) -> dict[str, Any]:
        """Cheap authenticated call; Core's readiness check."""
        return _object(await self._request("GET", "/v1/shamwari/whoami"))

    async def ground_search(self, body: dict[str, Any]) -> dict[str, Any]:
        out = _object(await self._request("POST", "/v1/shamwari/ground/search", json=body))
        if not isinstance(out.get("chunks"), list) or "scope" not in out:
            raise DataApiUnavailable("malformed")
        return out

    async def sink(self, database: str, collections: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
        # Safe to retry: the API gives each record a content-derived id, so a repeat is a counted
        # duplicate and not a second row (nyuchi-api tests/test_shamwari.py:
        # test_a_retried_batch_is_not_stored_twice). The Worker's queue retries on top of this.
        return _object(
            await self._request(
                "POST", "/v1/shamwari/sink", json={"database": database, "collections": collections}
            )
        )

    async def usage_rollup(self, owner_entity_id: str, billing_period: str) -> dict[str, Any]:
        return _object(
            await self._request(
                "GET",
                "/v1/shamwari/usage/rollup",
                params={"owner_entity_id": owner_entity_id, "billing_period": billing_period},
            )
        )

    async def guardrails(self, surface: str) -> dict[str, Any]:
        """The rules for a surface, from the one copy at /v1/ai/guardrails."""
        return _object(await self._request("GET", "/v1/ai/guardrails", params={"applies_to": surface}))


def _detail(res: httpx.Response) -> Any:
    try:
        body = res.json()
    except ValueError:
        return {"error": "refused", "status": res.status_code}
    # FastAPI wraps an HTTPException's detail; pass that on, not the wrapper.
    return body.get("detail", body) if isinstance(body, dict) else body


def _object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DataApiUnavailable("malformed")
    return value
