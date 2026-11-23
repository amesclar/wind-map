"""Shared Open-Meteo HTTP client (SCRUM-92).

All forecast, grid and geocoding requests go through `get_json`, so timeouts, retries
and the model rule live in one place. Callers handle `httpx.HTTPError`.
"""

import asyncio
from typing import Any

import httpx

from backend.app.config import DEFAULT_MODEL, OPEN_METEO_RETRIES, OPEN_METEO_TIMEOUT_SECONDS

# Open-Meteo throttles with 429 and occasionally returns a transient gateway error. Retrying those
# briefly (SCRUM-166) keeps a range export from turning a momentary limit into a failed hour.
RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
MAX_RETRY_WAIT_SECONDS = 5.0


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
    errors and non-2xx responses."""
    transport = httpx.AsyncHTTPTransport(retries=retries)
    async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
        for attempt in range(retries + 1):
            resp = await client.get(url, params=params)
            if resp.status_code in RETRYABLE_STATUS and attempt < retries:
                await asyncio.sleep(retry_delay(resp, attempt))
                continue
            resp.raise_for_status()
            try:
                return resp.json()
            except ValueError as exc:  # malformed body is an upstream failure, not a bug here
                raise httpx.DecodingError("Open-Meteo returned invalid JSON", request=resp.request) from exc
    raise AssertionError("unreachable: the retry loop always returns or raises")
