"""Grid weather service: current wind for a lat/lon grid using Open-Meteo batch requests."""

import time
from typing import List, Tuple

import httpx

from backend.app.config import (
    CACHE_TTL_SECONDS,
    DEFAULT_MODEL,
    OPEN_METEO_FORECAST_URL,
    OPEN_METEO_GRID_TIMEOUT_SECONDS,
)
from backend.app.database import db_connection
from backend.app.models import GridWindPoint
from backend.app.services import open_meteo
from backend.app.units import as_float, c_to_f, coord_key


async def get_grid_wind(
    points: List[Tuple[float, float]],
    model: str = DEFAULT_MODEL,
) -> List[GridWindPoint]:
    """
    Return current wind speed (knots), direction (degrees) and temperature (°F) for each (lat, lon) point.
    Hits the cache first; fetches any misses in a single batched Open-Meteo request.
    """
    if not points:
        return []

    now = time.time()
    results, missing = _read_cached_points(points, model, now)
    if not missing:
        return results

    # No DB connection is held during the HTTP call.
    fetched = await _fetch_from_open_meteo(missing, model)
    _store_points(fetched, model, now)
    return results + fetched


def _read_cached_points(
    points: List[Tuple[float, float]], model: str, now: float
) -> Tuple[List[GridWindPoint], List[Tuple[float, float]]]:
    """Split points into cached results and coordinates that still need fetching."""
    results: List[GridWindPoint] = []
    missing: List[Tuple[float, float]] = []  # original coords for missing cache entries
    with db_connection() as conn:
        for lat, lon in points:
            lk, lnk = coord_key(lat, lon)
            row = conn.execute(
                "SELECT wind_speed_knots, wind_direction_deg, temperature_f FROM grid_weather_cache "
                "WHERE lat_key=? AND lon_key=? AND model=? AND expires_at>? AND temperature_f IS NOT NULL",
                (lk, lnk, model, now),
            ).fetchone()
            if row:
                results.append(
                    GridWindPoint(
                        latitude=lat,
                        longitude=lon,
                        wind_speed_knots=row["wind_speed_knots"],
                        wind_direction_deg=row["wind_direction_deg"],
                        temperature_f=row["temperature_f"],
                    )
                )
            else:
                missing.append((lat, lon))
    return results, missing


def _store_points(fetched: List[GridWindPoint], model: str, now: float) -> None:
    expires_at = now + CACHE_TTL_SECONDS
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO grid_weather_cache
                (lat_key, lon_key, model, cached_at, expires_at, wind_speed_knots, wind_direction_deg, temperature_f)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, model) DO UPDATE SET
                cached_at=excluded.cached_at,
                expires_at=excluded.expires_at,
                wind_speed_knots=excluded.wind_speed_knots,
                wind_direction_deg=excluded.wind_direction_deg,
                temperature_f=excluded.temperature_f
            """,
            [
                (
                    *coord_key(p.latitude, p.longitude),
                    model,
                    now,
                    expires_at,
                    p.wind_speed_knots,
                    p.wind_direction_deg,
                    p.temperature_f,
                )
                for p in fetched
            ],
        )


async def _fetch_from_open_meteo(
    points: List[Tuple[float, float]],
    model: str,
) -> List[GridWindPoint]:
    """
    Open-Meteo supports comma-separated lat/lon arrays for batch current-weather fetches.
    One HTTP request returns current conditions for all points.
    """
    params = {
        **open_meteo.forecast_params(model),
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
        "current": "wind_speed_10m,wind_direction_10m,temperature_2m",
        "forecast_days": 1,
    }
    data = await open_meteo.get_json(OPEN_METEO_FORECAST_URL, params, timeout=OPEN_METEO_GRID_TIMEOUT_SECONDS)

    # When multiple points are requested, Open-Meteo returns a JSON array.
    # When only one point is requested, it returns a single object.
    if isinstance(data, dict):
        data = [data]
    if len(data) != len(points):
        # Treated as an upstream failure (502), not silently truncated.
        raise httpx.HTTPError(f"Open-Meteo returned {len(data)} grid points for {len(points)} requested")

    output: List[GridWindPoint] = []
    for (lat, lon), item in zip(points, data, strict=True):
        current = item.get("current", {})
        output.append(
            GridWindPoint(
                latitude=lat,
                longitude=lon,
                wind_speed_knots=as_float(current.get("wind_speed_10m")),
                wind_direction_deg=as_float(current.get("wind_direction_10m")),
                temperature_f=c_to_f(current.get("temperature_2m")),
            )
        )
    return output
