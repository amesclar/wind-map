"""Forecast service (SCRUM-92): cache lookup → Open-Meteo fetch → parse → cache store.

Each step is its own function or class:
- `fetch_forecast`         HTTP only (services/open_meteo.py)
- `parse_forecast`         pure parsing (services/forecast_parser.py)
- `SavedLocationCache` / `PointCache`  caching (services/forecast_cache.py)
"""

import time
from typing import Any, Dict

from backend.app.config import DEFAULT_MODEL, DEFAULT_TIMEZONE, FORECAST_DAYS, OPEN_METEO_FORECAST_URL
from backend.app.models import POINT_LOCATION_ID, LocationResponse, WeatherForecastResponse
from backend.app.services import open_meteo
from backend.app.services.forecast_cache import ForecastCache, PointCache, SavedLocationCache
from backend.app.services.forecast_parser import FORECAST_VARIABLES, parse_forecast


def point_name(lat: float, lon: float) -> str:
    """Display name for an ad-hoc map point, e.g. "48.78°N, 121.94°W"."""
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"


async def fetch_forecast(latitude: float, longitude: float, model: str, timezone: str) -> Dict[str, Any]:
    """Raw Open-Meteo forecast (current + hourly). Raises httpx.HTTPError."""
    variables = ",".join(FORECAST_VARIABLES)
    params = {
        **open_meteo.forecast_params(model),
        "latitude": latitude,
        "longitude": longitude,
        "hourly": variables,
        "current": variables,
        "timezone": timezone,
        "forecast_days": FORECAST_DAYS,
    }
    return await open_meteo.get_json(OPEN_METEO_FORECAST_URL, params)


async def _get_forecast(
    cache: ForecastCache,
    identity: Dict[str, Any],
    model: str,
    timezone: str,
) -> WeatherForecastResponse:
    """Serve from `cache` if fresh, otherwise fetch, parse and store.

    `identity` (location_id, location_name, latitude, longitude) always describes the
    request, so a point cache hit shared by nearby coordinates reports the coordinates
    that were asked for.
    """
    now = time.time()
    hit = cache.get(now)
    if hit:
        return WeatherForecastResponse(**{**hit.payload, **identity}, cached=True, cached_at=hit.cached_at)

    parsed = parse_forecast(
        await fetch_forecast(identity["latitude"], identity["longitude"], model, timezone)
    )
    payload = {
        **identity,
        "model": model,
        "timezone": timezone,
        "current": parsed.current.model_dump(),
        "forecast": [p.model_dump() for p in parsed.points],
    }
    cache.put(payload, now)
    return WeatherForecastResponse(**payload, cached=False, cached_at=now)


async def get_location_forecast(
    location: LocationResponse,
    model: str = DEFAULT_MODEL,
    timezone: str = DEFAULT_TIMEZONE,
) -> WeatherForecastResponse:
    """Forecast for a saved location, cached per (location, model, timezone)."""
    identity = {
        "location_id": location.id,
        "location_name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
    }
    return await _get_forecast(SavedLocationCache(location.id, model, timezone), identity, model, timezone)


async def get_point_forecast(
    latitude: float,
    longitude: float,
    model: str = DEFAULT_MODEL,
    timezone: str = DEFAULT_TIMEZONE,
) -> WeatherForecastResponse:
    """Forecast for an arbitrary map point (grid barb click), cached per rounded
    coordinates. Reported with location_id POINT_LOCATION_ID and a coordinate name."""
    identity = {
        "location_id": POINT_LOCATION_ID,
        "location_name": point_name(latitude, longitude),
        "latitude": latitude,
        "longitude": longitude,
    }
    return await _get_forecast(PointCache(latitude, longitude, model, timezone), identity, model, timezone)
