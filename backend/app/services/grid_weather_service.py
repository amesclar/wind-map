"""Grid weather service: fetch wind data for a lat/lon grid using Open-Meteo batch requests."""

import time
from typing import List, Optional, Tuple
import httpx
from backend.app.config import OPEN_METEO_FORECAST_URL, CACHE_TTL_SECONDS
from backend.app.database import db_connection
from backend.app.models import GridWindPoint

# Round coordinates to this many decimal places for cache keys.
# 2 decimal places ≈ 1.1 km resolution, fine-grained enough for a grid overlay.
CACHE_PRECISION = 2


def _cache_key(lat: float, lon: float) -> Tuple[float, float]:
    return (round(lat, CACHE_PRECISION), round(lon, CACHE_PRECISION))


def _c_to_f(temp_c: Optional[float]) -> float:
    """Same conversion and rounding as the drawer's forecast points (weather_service)."""
    c = 0.0 if temp_c is None else float(temp_c)
    return round(c * 9.0 / 5.0 + 32.0, 1)


async def get_grid_wind(
    points: List[Tuple[float, float]],
    model: str = "best_match",
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


def _ensure_grid_cache_table(cursor) -> None:
    """Create grid_weather_cache if needed (SCRUM-92 phase 3 moves this into init_db)."""
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS grid_weather_cache (
            lat_key  REAL NOT NULL,
            lon_key  REAL NOT NULL,
            model    TEXT NOT NULL,
            cached_at  REAL NOT NULL,
            expires_at REAL NOT NULL,
            wind_speed_knots REAL NOT NULL,
            wind_direction_deg REAL NOT NULL,
            temperature_f REAL,
            PRIMARY KEY (lat_key, lon_key, model)
        );
        """
    )
    # SCRUM-89 migration: older tables lack temperature_f. Rows without it are
    # treated as cache misses below, so they are refetched with temperature.
    columns = {r["name"] for r in cursor.execute("PRAGMA table_info(grid_weather_cache)").fetchall()}
    if "temperature_f" not in columns:
        cursor.execute("ALTER TABLE grid_weather_cache ADD COLUMN temperature_f REAL")


def _read_cached_points(
    points: List[Tuple[float, float]], model: str, now: float
) -> Tuple[List[GridWindPoint], List[Tuple[float, float]]]:
    """Split points into cached results and coordinates that still need fetching."""
    results: List[GridWindPoint] = []
    missing: List[Tuple[float, float]] = []  # original coords for missing cache entries
    with db_connection() as conn:
        cursor = conn.cursor()
        _ensure_grid_cache_table(cursor)
        for lat, lon in points:
            lk, lnk = _cache_key(lat, lon)
            cursor.execute(
                "SELECT wind_speed_knots, wind_direction_deg, temperature_f FROM grid_weather_cache "
                "WHERE lat_key=? AND lon_key=? AND model=? AND expires_at>? AND temperature_f IS NOT NULL",
                (lk, lnk, model, now),
            )
            row = cursor.fetchone()
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
        cursor = conn.cursor()
        for point in fetched:
            lk, lnk = _cache_key(point.latitude, point.longitude)
            cursor.execute(
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
                (lk, lnk, model, now, expires_at, point.wind_speed_knots, point.wind_direction_deg, point.temperature_f),
            )


async def _fetch_from_open_meteo(
    points: List[Tuple[float, float]],
    model: str,
) -> List[GridWindPoint]:
    """
    Open-Meteo supports comma-separated lat/lon arrays for batch current-weather fetches.
    One HTTP request returns current conditions for all points.
    """
    lats = ",".join(str(lat) for lat, _ in points)
    lons = ",".join(str(lon) for _, lon in points)

    params = {
        "latitude": lats,
        "longitude": lons,
        "current": "wind_speed_10m,wind_direction_10m,temperature_2m",
        "wind_speed_unit": "kn",
        "forecast_days": 1,
    }
    if model and model != "best_match":
        params["models"] = model

    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(transport=transport, timeout=20.0) as client:
        resp = await client.get(OPEN_METEO_FORECAST_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    # When multiple points are requested, Open-Meteo returns a JSON array.
    # When only one point is requested, it returns a single object.
    if isinstance(data, dict):
        data = [data]

    output: List[GridWindPoint] = []
    for i, item in enumerate(data):
        lat, lon = points[i]
        current = item.get("current", {})
        output.append(
            GridWindPoint(
                latitude=lat,
                longitude=lon,
                wind_speed_knots=float(current.get("wind_speed_10m") or 0.0),
                wind_direction_deg=float(current.get("wind_direction_10m") or 0.0),
                temperature_f=_c_to_f(current.get("temperature_2m")),
            )
        )
    return output
