"""Grid weather service: fetch wind data for a lat/lon grid using Open-Meteo batch requests."""

import json
import time
from typing import List, Tuple
import httpx
from backend.app.config import OPEN_METEO_FORECAST_URL, CACHE_TTL_SECONDS
from backend.app.database import get_db_connection
from backend.app.models import GridWindPoint

# Round coordinates to this many decimal places for cache keys.
# 2 decimal places ≈ 1.1 km resolution, fine-grained enough for a grid overlay.
CACHE_PRECISION = 2


def _cache_key(lat: float, lon: float) -> Tuple[float, float]:
    return (round(lat, CACHE_PRECISION), round(lon, CACHE_PRECISION))


async def get_grid_wind(
    points: List[Tuple[float, float]],
    model: str = "best_match",
) -> List[GridWindPoint]:
    """
    Return current wind speed (knots) and direction (degrees) for each (lat, lon) point.
    Hits the cache first; fetches any misses in a single batched Open-Meteo request.
    """
    if not points:
        return []

    now = time.time()
    conn = get_db_connection()
    cursor = conn.cursor()

    # Ensure grid cache table exists (migration-safe, idempotent).
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
            PRIMARY KEY (lat_key, lon_key, model)
        );
        """
    )
    conn.commit()

    results: List[GridWindPoint] = []
    missing: List[Tuple[float, float]] = []  # original coords for missing cache entries

    for lat, lon in points:
        lk, lnk = _cache_key(lat, lon)
        cursor.execute(
            "SELECT wind_speed_knots, wind_direction_deg FROM grid_weather_cache "
            "WHERE lat_key=? AND lon_key=? AND model=? AND expires_at>?",
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
                )
            )
        else:
            missing.append((lat, lon))

    if missing:
        fetched = await _fetch_from_open_meteo(missing, model)
        expires_at = now + CACHE_TTL_SECONDS

        for point in fetched:
            lk, lnk = _cache_key(point.latitude, point.longitude)
            cursor.execute(
                """
                INSERT INTO grid_weather_cache
                    (lat_key, lon_key, model, cached_at, expires_at, wind_speed_knots, wind_direction_deg)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lat_key, lon_key, model) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    wind_speed_knots=excluded.wind_speed_knots,
                    wind_direction_deg=excluded.wind_direction_deg
                """,
                (lk, lnk, model, now, expires_at, point.wind_speed_knots, point.wind_direction_deg),
            )
            results.append(point)

        conn.commit()

    conn.close()
    return results


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
        "current": "wind_speed_10m,wind_direction_10m",
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
            )
        )
    return output
