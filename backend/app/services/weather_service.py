"""Forecast service (SCRUM-92): cache lookup → provider fetch → parse → cache store.

Each step is its own function or class:
- `fetch_forecast`         HTTP only (services/open_meteo.py, services/nws.py)
- `parse_provider_forecast`  pure parsing (services/forecast_parser.py, services/nws_parser.py)
- `SavedLocationCache` / `PointCache`  caching (services/forecast_cache.py)

Open-Meteo is the provider for every model but NDFD, which is dispatched by model id (SCRUM-106).
Both providers share this cache: a warm (location, model, timezone, hour) costs no upstream call.
"""

import math
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from backend.app.config import (
    DEFAULT_MODEL,
    DEFAULT_TIMEZONE,
    FORECAST_DAYS,
    NWS_MODEL,
    OPEN_METEO_FORECAST_URL,
    model_horizon_days,
)
from backend.app.models import POINT_LOCATION_ID, LocationResponse, WeatherForecastResponse
from backend.app.services import nws, open_meteo
from backend.app.services.forecast_cache import (
    ForecastCache,
    PointCache,
    SavedLocationCache,
    is_stale,
)
from backend.app.services.forecast_parser import FORECAST_VARIABLES, parse_forecast
from backend.app.services.model_availability import refresh_clock
from backend.app.services.nws_parser import parse_nws_forecast
from backend.app.services.time_window import hour_key


def point_name(lat: float, lon: float) -> str:
    """Display name for an ad-hoc map point, e.g. "48.78°N, 121.94°W"."""
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"


async def fetch_forecast(
    latitude: float,
    longitude: float,
    model: str,
    timezone: str,
    days: int = FORECAST_DAYS,
) -> dict[str, Any]:
    """Raw provider forecast (current + hourly). Raises httpx.HTTPError.

    NDFD returns one gridpoint document per point instead of a request with parameters; the
    parser turns its periods into the same slices (SCRUM-106).
    """
    if model == NWS_MODEL:
        return await nws.fetch_gridpoints(latitude, longitude)

    variables = ",".join(FORECAST_VARIABLES)
    params = {
        **open_meteo.forecast_params(model),
        "latitude": latitude,
        "longitude": longitude,
        "hourly": variables,
        "current": variables,
        "timezone": timezone,
        "forecast_days": days,
    }
    return await open_meteo.get_json(OPEN_METEO_FORECAST_URL, params)


def parse_provider_forecast(
    raw: dict[str, Any],
    model: str,
    at: datetime | None = None,
    timezone: str = DEFAULT_TIMEZONE,
) -> Any:
    """The parser for the provider that served `raw` (SCRUM-106)."""
    if model == NWS_MODEL:
        return parse_nws_forecast(raw, at=at, timezone=timezone)
    return parse_forecast(raw, at=at, timezone=timezone)


def forecast_days_for(at: datetime, model: str, now: datetime | None = None) -> int:
    """Days of hourly data a request for `at` needs, capped at the model's horizon."""
    moment = now or datetime.now(UTC)
    hours_ahead = max(0.0, (at - moment).total_seconds() / 3600)
    needed = math.ceil((hours_ahead + 1) / 24) + 1  # today, the requested day, and a margin
    return max(FORECAST_DAYS, min(model_horizon_days(model), needed))


async def _get_forecast(
    cache: ForecastCache,
    identity: dict[str, Any],
    model: str,
    timezone: str,
    at: datetime | None = None,
    refresh: bool = False,
) -> WeatherForecastResponse:
    """Serve from `cache` if fresh, otherwise fetch, parse and store.

    `identity` (location_id, location_name, latitude, longitude) always describes the
    request, so a point cache hit shared by nearby coordinates reports the coordinates
    that were asked for. `at` selects one forecast hour instead of live conditions
    (SCRUM-115); the cache key already includes that hour.

    `refresh` (SCRUM-113) skips a row that predates the model's newest published run and is
    served from cache otherwise, so a click — or a stale tab sending the flag by hand — cannot
    spend a call for data that already covers that run.
    """
    now = time.time()
    hit = cache.get(now)
    if hit:
        clock = await _run_clock_seconds(model) if refresh else None
        if not is_stale(hit.cached_at, clock):
            return WeatherForecastResponse(**{**hit.payload, **identity}, cached=True, cached_at=hit.cached_at)

    raw = await fetch_forecast(
        identity["latitude"],
        identity["longitude"],
        model,
        timezone,
        FORECAST_DAYS if at is None else forecast_days_for(at, model),
    )
    try:
        parsed = parse_provider_forecast(raw, model, at=at, timezone=timezone)
    except ValueError as exc:  # response did not cover the requested hour
        raise httpx.HTTPError(str(exc)) from exc
    payload = {
        **identity,
        "model": model,
        "timezone": timezone,
        "current": parsed.current.model_dump(),
        "forecast": [p.model_dump() for p in parsed.points],
        "valid_time": parsed.valid_time,
    }
    # A frame with no wind value anywhere is a temporary upstream gap, not a calm forecast:
    # return it but do not cache it, so the next request asks Open-Meteo again (SCRUM-225).
    if any(p.wind_speed_knots is not None for p in (parsed.current, *parsed.points)):
        cache.put(payload, now)
    return WeatherForecastResponse(**payload, cached=False, cached_at=now)


async def _run_clock_seconds(model: str) -> float | None:
    """The newest published run of `model` as Unix seconds, or None when unknown (SCRUM-113)."""
    clock = await refresh_clock(model)
    return None if clock is None else clock.timestamp()


async def get_location_forecast(
    location: LocationResponse,
    model: str = DEFAULT_MODEL,
    timezone: str = DEFAULT_TIMEZONE,
    at: datetime | None = None,
    refresh: bool = False,
) -> WeatherForecastResponse:
    """Forecast for a saved location, cached per (location, model, timezone, hour)."""
    identity = {
        "location_id": location.id,
        "location_name": location.name,
        "latitude": location.latitude,
        "longitude": location.longitude,
    }
    cache = SavedLocationCache(location.id, model, timezone, hour_key(at))
    return await _get_forecast(cache, identity, model, timezone, at, refresh)


async def get_point_forecast(
    latitude: float,
    longitude: float,
    model: str = DEFAULT_MODEL,
    timezone: str = DEFAULT_TIMEZONE,
    at: datetime | None = None,
    refresh: bool = False,
) -> WeatherForecastResponse:
    """Forecast for an arbitrary map point (barb selection), cached per rounded coordinates
    and hour. Reported with location_id POINT_LOCATION_ID and a coordinate name."""
    identity = {
        "location_id": POINT_LOCATION_ID,
        "location_name": point_name(latitude, longitude),
        "latitude": latitude,
        "longitude": longitude,
    }
    cache = PointCache(latitude, longitude, model, timezone, hour_key(at))
    return await _get_forecast(cache, identity, model, timezone, at, refresh)
