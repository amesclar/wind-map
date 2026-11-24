"""Shared Open-Meteo HTTP client (SCRUM-92).

All forecast, grid and geocoding requests go through `get_json`, so timeouts, retries
and the model rule live in one place. Callers handle `httpx.HTTPError`.
"""

import asyncio
import weakref
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from backend.app.config import DEFAULT_MODEL, OPEN_METEO_RETRIES, OPEN_METEO_TIMEOUT_SECONDS

# Open-Meteo throttles with 429 and occasionally returns a transient gateway error. Retrying those
# briefly (SCRUM-166) keeps a range export from turning a momentary limit into a failed hour.
RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
MAX_RETRY_WAIT_SECONDS = 5.0

# One pooled client per event loop (SCRUM-174). Creating a client per request threw away the
# connection pool, so every grid pan paid a new TCP + TLS handshake; with the process-wide
# loop in the container a single client is reused for every upstream call.
_CLIENTS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient] = weakref.WeakKeyDictionary()


def _client() -> httpx.AsyncClient:
    """The shared client for the running loop, created on first use."""
    loop = asyncio.get_running_loop()
    client = _CLIENTS.get(loop)
    if client is None:
        client = httpx.AsyncClient()
        _CLIENTS[loop] = client
    return client


async def close_client() -> None:
    """Close the shared client for the running loop (app shutdown). Safe to call twice."""
    client = _CLIENTS.pop(asyncio.get_running_loop(), None)
    if client is not None:
        await client.aclose()


class QuotaExceededError(httpx.HTTPError):
    """Open-Meteo is still throttling after every retry (SCRUM-170).

    `reset_at` is the upstream's advertised reset instant when it sent one, so the UI can say
    when data will return instead of only reporting a generic upstream failure.
    """

    def __init__(self, message: str, *, reset_at: datetime | None, request: httpx.Request | None = None):
        super().__init__(message)
        self.request = request
        self.reset_at = reset_at


def quota_reset_at(response: httpx.Response, now: datetime | None = None) -> datetime | None:
    """The instant Open-Meteo says the limit resets, from its headers when present."""
    reset = response.headers.get("x-ratelimit-reset")
    if reset:
        try:
            return datetime.fromtimestamp(float(reset), UTC)
        except TypeError, ValueError:
            pass
    retry_after = response.headers.get("retry-after")
    if retry_after:
        try:
            return (now or datetime.now(UTC)) + timedelta(seconds=max(0.0, float(retry_after)))
        except TypeError, ValueError:
            pass
    return None


def retry_delay(response: httpx.Response, attempt: int) -> float:
    """Seconds to wait before retry `attempt`: Retry-After when sent, else 0.5 s, 1 s, 2 s, …"""
    header = response.headers.get("retry-after")
    if header:
        try:
            return min(MAX_RETRY_WAIT_SECONDS, max(0.0, float(header)))
        except ValueError:
            pass
    return min(MAX_RETRY_WAIT_SECONDS, 0.5 * (2**attempt))


def forecast_params(model: str) -> dict[str, Any]:
    """Parameters every forecast request shares: speeds in knots, plus `models` unless
    Open-Meteo should choose (best_match)."""
    params: dict[str, Any] = {"wind_speed_unit": "kn"}
    if model and model != DEFAULT_MODEL:
        params["models"] = model
    return params


async def get_json(
    url: str,
    params: dict[str, Any],
    timeout: float = OPEN_METEO_TIMEOUT_SECONDS,
    retries: int = OPEN_METEO_RETRIES,
) -> Any:
    """GET `url` and return the decoded JSON body. Raises httpx.HTTPError on network
    errors and non-2xx responses.

    One retry policy only (SCRUM-174): the loop below honours `Retry-After`, so the client
    keeps its default transport retries off rather than stacking a second, invisible policy
    that could multiply upstream attempts.
    """
    client = _client()
    for attempt in range(retries + 1):
        resp = await client.get(url, params=params, timeout=timeout)
        if resp.status_code in RETRYABLE_STATUS and attempt < retries:
            await asyncio.sleep(retry_delay(resp, attempt))
            continue
        if resp.status_code == 429:
            raise QuotaExceededError(
                "Open-Meteo request limit reached",
                reset_at=quota_reset_at(resp),
                request=resp.request,
            )
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError as exc:  # malformed body is an upstream failure, not a bug here
            raise httpx.DecodingError("Open-Meteo returned invalid JSON", request=resp.request) from exc
    raise AssertionError("unreachable: the retry loop always returns or raises")
