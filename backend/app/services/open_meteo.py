"""Shared Open-Meteo HTTP client (SCRUM-92).

All forecast, grid and geocoding requests go through `get_json`, so timeouts, retries
and the model rule live in one place. Callers handle `httpx.HTTPError`.
"""

import asyncio
import weakref
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from backend.app.config import (
    DEFAULT_MODEL,
    OPEN_METEO_RETRIES,
    OPEN_METEO_TIMEOUT_SECONDS,
    PROVIDER_ONLY_MODELS,
)
from backend.app.services import open_meteo_usage

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


def shared_client() -> httpx.AsyncClient:
    """The pooled client, for a caller that needs its own headers or timeout (SCRUM-285).

    NWS used to open a client per request and so paid a handshake for each of the two documents a
    forecast needs, with no connection ever reused. The pool is keyed by loop, so this is the same
    object `get_json` uses and `close_client` closes at shutdown.
    """
    return _client()


async def close_client() -> None:
    """Close the shared client for the running loop (app shutdown). Safe to call twice."""
    client = _CLIENTS.pop(asyncio.get_running_loop(), None)
    if client is not None:
        await client.aclose()


# Open-Meteo answers this 400 when any point of a request is outside a regional model's domain.
# It is the only 400 that means "coverage", not "bad request", so the grid can split the batch
# instead of failing the view (SCRUM-229, SCRUM-231).
COVERAGE_REASON = "no data is available for this location"


class CoverageError(httpx.HTTPError):
    """The upstream has no data for the requested location(s).

    Raised only for the exact coverage 400 above; every other 400 keeps its HTTPStatusError so a
    malformed request is never mistaken for a point outside a model's domain.
    """

    def __init__(
        self, message: str = "No data is available for this location", *, request: httpx.Request | None = None
    ):
        super().__init__(message)
        self.request = request


def is_coverage_rejection(response: httpx.Response) -> bool:
    """True when `response` is the coverage 400, identified by its reason rather than its status."""
    if response.status_code != 400:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    reason = body.get("reason") if isinstance(body, dict) else None
    return isinstance(reason, str) and reason.strip().lower() == COVERAGE_REASON


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
    Open-Meteo should choose (best_match).

    A provider-only model (NDFD) has no Open-Meteo id, so the wind grid keeps asking for the
    default rather than failing on a model Open-Meteo does not know (SCRUM-245 prototype).
    """
    params: dict[str, Any] = {"wind_speed_unit": "kn"}
    if model and model != DEFAULT_MODEL and model not in PROVIDER_ONLY_MODELS:
        params["models"] = model
    return params


async def get_json(
    url: str,
    params: dict[str, Any],
    timeout: float = OPEN_METEO_TIMEOUT_SECONDS,
    retries: int = OPEN_METEO_RETRIES,
    label: str | None = None,
) -> Any:
    """GET `url` and return the decoded JSON body. Raises httpx.HTTPError on network
    errors and non-2xx responses.

    Every attempt's quota headers are recorded for the usage log (SCRUM-327); `label` names the
    caller, so the log can tell a grid view from a point forecast when both use the same URL.

    One retry policy only (SCRUM-174): the loop below honours `Retry-After`, so the client
    keeps its default transport retries off rather than stacking a second, invisible policy
    that could multiply upstream attempts. Connection-level failures keep the same budget
    (SCRUM-176) and are retried immediately, which is what the transport used to do.
    """
    client = _client()
    for attempt in range(retries + 1):
        try:
            resp = await client.get(url, params=params, timeout=timeout)
        except httpx.TransportError:
            if attempt == retries:
                raise
            continue
        # One row per attempt, retries included; recording never raises (SCRUM-327).
        open_meteo_usage.record(url, resp, label)
        if resp.status_code in RETRYABLE_STATUS and attempt < retries:
            await asyncio.sleep(retry_delay(resp, attempt))
            continue
        if is_coverage_rejection(resp):
            raise CoverageError(request=resp.request)
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
