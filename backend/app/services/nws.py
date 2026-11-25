"""NOAA NWS NDFD client (SCRUM-106).

Two requests per point: `/points` maps a coordinate to a grid cell, `/gridpoints` returns the
numeric series the parser slices. The mapping is long-lived — a coordinate's grid does not move —
and the forecast itself is cached by the forecast cache for 30 minutes, so a warm hour costs no
upstream call at all.
"""

import asyncio
import logging
import time
from typing import Any

import httpx

from backend.app.config import NWS_BASE_URL, NWS_RETRIES, NWS_TIMEOUT_SECONDS, NWS_USER_AGENT
from backend.app.services.forecast_cache import NwsGridCache
from backend.app.services.open_meteo import retry_delay

logger = logging.getLogger(__name__)

# NWS asks every client to identify itself (an empty User-Agent is answered with 403) and returns
# 503 when it is overloaded, so the header and the retry are both part of the contract. Measured
# 2026-11-25: 200 with any identified client, 403 with none, 404 outside the US.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class NwsCoverageError(httpx.HTTPError):
    """The point is outside NDFD coverage: `/points` answered 404. The US only."""


async def _get_json(url: str) -> Any:
    """GET one api.weather.gov document.

    Raises NwsCoverageError outside coverage and httpx.HTTPError for anything else. Retries follow
    the Open-Meteo client: `Retry-After` when NWS sends one, else a short backoff, inside the same
    attempt budget, so one upstream wobble does not become a 502 on the map.
    """
    headers = {"User-Agent": NWS_USER_AGENT, "Accept": "application/geo+json"}
    async with httpx.AsyncClient(timeout=NWS_TIMEOUT_SECONDS, headers=headers) as client:
        attempt = 0
        while True:
            response = await client.get(url)
            if response.status_code == 404:
                raise NwsCoverageError(f"NWS has no grid for {url}")
            if response.status_code in RETRYABLE_STATUS and attempt < NWS_RETRIES:
                logger.warning("NWS answered %s for %s; retrying", response.status_code, url)
                await asyncio.sleep(retry_delay(response, attempt))
                attempt += 1
                continue
            response.raise_for_status()
            return response.json()


async def grid_for(latitude: float, longitude: float) -> tuple[str, int, int]:
    """The forecast office and grid cell for a coordinate, cached in SQLite for good."""
    cache = NwsGridCache(latitude, longitude)
    cached = cache.get()
    if cached is not None:
        return cached

    data = await _get_json(f"{NWS_BASE_URL}/points/{latitude:.4f},{longitude:.4f}")
    properties = data.get("properties") or {}
    office, grid_x, grid_y = properties.get("gridId"), properties.get("gridX"), properties.get("gridY")
    if not office or grid_x is None or grid_y is None:
        # A body without a grid is not a forecast; treat it like a point outside coverage.
        raise NwsCoverageError("NWS /points response carried no grid")

    grid = (str(office), int(grid_x), int(grid_y))
    cache.put(grid, time.time())
    return grid


async def fetch_gridpoints(latitude: float, longitude: float) -> dict[str, Any]:
    """The raw `/gridpoints/{office}/{x},{y}` document for a coordinate."""
    office, grid_x, grid_y = await grid_for(latitude, longitude)
    return await _get_json(f"{NWS_BASE_URL}/gridpoints/{office}/{grid_x},{grid_y}")
