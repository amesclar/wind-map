"""Shared Open-Meteo HTTP client (SCRUM-92).

All forecast, grid and geocoding requests go through `get_json`, so timeouts, retries
and the model rule live in one place. Callers handle `httpx.HTTPError`.
"""

from typing import Any

import httpx

from backend.app.config import DEFAULT_MODEL, OPEN_METEO_RETRIES, OPEN_METEO_TIMEOUT_SECONDS


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
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError as exc:  # malformed body is an upstream failure, not a bug here
            raise httpx.DecodingError("Open-Meteo returned invalid JSON", request=resp.request) from exc
