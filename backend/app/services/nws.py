"""NOAA NWS NDFD client (SCRUM-245 spike prototype; the real thing is SCRUM-106).

Two requests per point: `/points` maps a coordinate to a grid cell, `/gridpoints` returns the
numeric series the parser slices. Prototype limits, all recorded in SCRUM-106: the grid mapping
lives in this process instead of the database, and there is no retry policy yet.
"""

import logging
from typing import Any

import httpx

from backend.app.config import (
    COORD_CACHE_PRECISION,
    NWS_BASE_URL,
    NWS_TIMEOUT_SECONDS,
    NWS_USER_AGENT,
)

logger = logging.getLogger(__name__)

# Coordinate → (office, gridX, gridY). A coordinate's grid does not move, so this never expires;
# SCRUM-106 moves it into SQLite with the other caches.
_GRID_CACHE: dict[tuple[float, float], tuple[str, int, int]] = {}


class NwsCoverageError(httpx.HTTPError):
    """The point is outside NDFD coverage: `/points` answered 404. The US only."""


def clear_grid_cache() -> None:
    """Drop the in-process grid mapping (tests, and a manual refresh in development)."""
    _GRID_CACHE.clear()


def _key(latitude: float, longitude: float) -> tuple[float, float]:
    return (round(latitude, COORD_CACHE_PRECISION), round(longitude, COORD_CACHE_PRECISION))


async def _get_json(url: str) -> Any:
    """GET one api.weather.gov document. Raises httpx.HTTPError, or NwsCoverageError on 404."""
    headers = {"User-Agent": NWS_USER_AGENT, "Accept": "application/geo+json"}
    async with httpx.AsyncClient(timeout=NWS_TIMEOUT_SECONDS, headers=headers) as client:
        response = await client.get(url)
    if response.status_code == 404:
        raise NwsCoverageError(f"NWS has no grid for {url}")
    response.raise_for_status()
    return response.json()


async def grid_for(latitude: float, longitude: float) -> tuple[str, int, int]:
    """The forecast office and grid cell for a coordinate, cached for the process."""
    key = _key(latitude, longitude)
    cached = _GRID_CACHE.get(key)
    if cached is not None:
        return cached
    data = await _get_json(f"{NWS_BASE_URL}/points/{latitude:.4f},{longitude:.4f}")
    properties = data.get("properties") or {}
    office, grid_x, grid_y = properties.get("gridId"), properties.get("gridX"), properties.get("gridY")
    if not office or grid_x is None or grid_y is None:
        # A body without a grid is not a forecast; treat it like a point outside coverage.
        raise NwsCoverageError("NWS /points response carried no grid")
    grid = (str(office), int(grid_x), int(grid_y))
    _GRID_CACHE[key] = grid
    return grid


async def fetch_gridpoints(latitude: float, longitude: float) -> dict[str, Any]:
    """The raw `/gridpoints/{office}/{x},{y}` document for a coordinate."""
    office, grid_x, grid_y = await grid_for(latitude, longitude)
    return await _get_json(f"{NWS_BASE_URL}/gridpoints/{office}/{grid_x},{grid_y}")
