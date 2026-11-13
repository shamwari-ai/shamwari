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
        headers: dict[str, str] | None = None,
        lenient: bool = False,
    ) -> Any:
        attempts = 1 + (self._retries if retry else 0)
        last = "unreachable"
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(self._backoff * attempt)
            try:
                res = await self._http.request(
                    method, path, json=json, params=params, headers={**self._headers, **(headers or {})}
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
                raise DataApiRefusal(res.status_code, self._detail(res))
            if res.status_code >= 400:
                log.error("data api error: %s %s -> %s", method, path, res.status_code)
                raise DataApiUnavailable(str(res.status_code))
            if lenient:
                return None  # the caller only needs "it answered 2xx"
            try:
                return res.json()
            except ValueError:
                log.error("data api returned a non-JSON body: %s %s", method, path)
                raise DataApiUnavailable("malformed") from None

        log.error("data api unavailable: %s %s (%s)", method, path, last)
        raise DataApiUnavailable(last)

    @staticmethod
    def _detail(res: httpx.Response) -> Any:
        try:
            body = res.json()
        except ValueError:
            return {"error": "refused", "status": res.status_code}
        # FastAPI wraps an HTTPException's detail; pass that on, not the wrapper.
        return body.get("detail", body) if isinstance(body, dict) else body

    # -- /v1/shamwari ------------------------------------------------------------

    async def whoami(self) -> dict[str, Any]:
        """Cheap authenticated call; Core's readiness check."""
        return _object(await self._request("GET", "/v1/shamwari/whoami"))

    async def ground_search(self, body: dict[str, Any]) -> dict[str, Any]:
        return _ground(await self._request("POST", "/v1/shamwari/ground/search", json=body))

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


def _ground(value: Any) -> dict[str, Any]:
    out = _object(value)
    if not isinstance(out.get("chunks"), list) or "scope" not in out:
        raise DataApiUnavailable("malformed")
    return out


def _is_internal(url: str) -> bool:
    """A Fly private-network name: `<app>.internal`. Decided by the host, never by a header."""
    host = (httpx.URL(url).host or "").lower().rstrip(".")
    return host.endswith(".internal") and len(host) > len(".internal")


class ServersApi(DataApi):
    """
    The Servers API (nyuchi/nyuchi-servers-api): the internal gateway Core and the Worker
    reach data through. The Nyuchi API is the external B2B gateway and is not on this path.

    Auth follows where the caller sits. A Fly app in the same org reaches `<app>.internal`
    over the private network with NO key and NO token: none is sent, even if one is
    configured. A caller outside (the gateway Worker) must present both the internal key
    and the bearer token, and construction fails without them. The host decides, so a name
    that merely contains "internal" is treated as outside.

    For a personal-scope search the owner travels in the `x-shamwari-person` header and
    never in the body (owner decision, 2026-11-13). Core refuses personal scope before any
    call goes to Cloud; this only changes how the owner is named to the data layer.
    """

    def __init__(
        self,
        *,
        base_url: str,
        key: str | None = None,
        token: str | None = None,
        http: httpx.AsyncClient | None = None,
        retries: int = 1,
        backoff: float = 0.2,
    ) -> None:
        internal = _is_internal(base_url)
        if not internal and not (key and token):
            raise ValueError("a Servers API host outside the Fly private network needs an internal key and a token")
        # The key argument only satisfies the parent's check; its headers are replaced below,
        # so the Nyuchi API key and public host name are never sent to the Servers API.
        super().__init__(key="-", base_url=base_url, http=http, retries=retries, backoff=backoff)
        self._headers = {"Accept": "application/json", "User-Agent": "shamwari-core"}
        if not internal:
            self._headers["Authorization"] = f"Bearer {token}"
            self._headers["x-nyuchi-internal-key"] = str(key)

    @classmethod
    def from_env(cls) -> "ServersApi":
        # Core runs on Fly and reaches `<app>.internal`, so it reads no key or token. An
        # outside host therefore refuses to start; the key+token path is for the Worker's
        # client, built with explicit arguments.
        return cls(base_url=os.environ["SERVERS_API_URL"].strip())

    @staticmethod
    def _detail(res: httpx.Response) -> Any:
        try:
            body = res.json()
        except ValueError:
            return {"error": "refused", "status": res.status_code}
        if not isinstance(body, dict):
            return body
        # RFC 9457 problem+json: {type, title, status, detail, error}. The machine-readable
        # reason is the `error` extension member; `detail` is prose. Pass it on in the shape
        # callers already read ({"error": ...}).
        if isinstance(body.get("error"), str):
            out: dict[str, Any] = {"error": body["error"]}
            if isinstance(body.get("detail"), str):
                out["message"] = body["detail"]
            return out
        if ("type" in body or "title" in body) and "status" in body and not isinstance(body.get("detail"), dict):
            return {"error": "refused", "status": res.status_code}
        return body.get("detail", body)

    async def whoami(self) -> dict[str, Any]:
        # Core's readiness check. /ready is unauthenticated: 200 {"status":"ready"} when ready,
        # a bare 503 problem when a dependency is down (nyuchi-servers-api origin tests). Any
        # 2xx counts as ready, so a plain 200 can never fail Fly's check for good.
        await self._request("GET", "/ready", lenient=True)
        return {"status": "ready"}

    async def ground_search(self, body: dict[str, Any]) -> dict[str, Any]:
        body = dict(body)
        owner = body.pop("owner_entity_id", None)
        headers: dict[str, str] = {}
        if body.get("scope") == "personal":
            if not owner:
                raise ValueError("a personal search must name its owner")
            headers["x-shamwari-person"] = str(owner)
        elif owner is not None:
            body["owner_entity_id"] = owner
        return _ground(
            await self._request("POST", "/v1/shamwari/ground/search", json=body, headers=headers)
        )

    async def guardrails(self, surface: str) -> dict[str, Any]:
        return _object(await self._request("GET", "/v1/shamwari/guardrails", params={"applies_to": surface}))


def data_api_from_env() -> DataApi:
    """
    SERVERS_API_URL unset (or blank): the Nyuchi API client, as before, so merging this
    changes nothing in production. Set: the Servers API client, and no Nyuchi key is needed.
    """
    if os.environ.get("SERVERS_API_URL", "").strip():
        return ServersApi.from_env()
    return DataApi.from_env()


def _object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DataApiUnavailable("malformed")
    return value
