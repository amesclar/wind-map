"""Grid weather service: wind for a lat/lon grid at the current hour or a forecast hour.

Current values come from Open-Meteo's `current` block; a requested hour comes from the hourly
series for that UTC day (SCRUM-115). Rows are cached per (rounded lat, lon, model, hour), and one
forecast-hour request stores every hour of that day from the same response (SCRUM-166), so a
multi-hour range reads the rest of the day from SQLite instead of calling Open-Meteo again.
"""

import time
from datetime import UTC, datetime

import httpx

from backend.app.config import (
    CACHE_TTL_SECONDS,
    DEFAULT_MODEL,
    GRID_REQUEST_MAX_POINTS,
    OPEN_METEO_FORECAST_URL,
    OPEN_METEO_GRID_TIMEOUT_SECONDS,
)
from backend.app.database import db_connection
from backend.app.models import GridWindPoint
from backend.app.services import open_meteo
from backend.app.services.time_window import hour_key
from backend.app.units import as_float, c_to_f, coord_key

GRID_VARIABLES = ("wind_speed_10m", "wind_direction_10m", "temperature_2m")


async def get_grid_wind(
    points: list[tuple[float, float]],
    model: str = DEFAULT_MODEL,
    at: datetime | None = None,
) -> list[GridWindPoint]:
    """Wind speed (knots), direction (degrees) and temperature (°F) for each (lat, lon) point.

    `at` is an aware UTC hour (already validated) or None for current conditions. Cache misses
    are fetched in one batched Open-Meteo request.
    """
    if not points:
        return []

    hour = hour_key(at)
    now = time.time()
    results, missing = _read_cached_points(points, model, hour, now)
    if not missing:
        return results

    if at is None:
        # No DB connection is held during the HTTP call.
        fetched = await _fetch_current(missing, model)
        _store_points(fetched, model, hour, now)
        return results + fetched

    # One response already carries the whole UTC day, so cache every hour of it. The rest of a
    # multi-hour range is then served from SQLite instead of repeating the Open-Meteo call
    # (SCRUM-166), which used to trip its rate limit.
    series = await _fetch_hourly_day(missing, model, at)
    for series_hour, hour_points in series.items():
        _store_points(hour_points, model, series_hour, now)
    return results + series[hour]


def _read_cached_points(
    points: list[tuple[float, float]],
    model: str,
    hour: str,
    now: float,
) -> tuple[list[GridWindPoint], list[tuple[float, float]]]:
    """Split points into cached results and coordinates that still need fetching.

    One statement per request (SCRUM-174) instead of one per point: a full view used to
    run up to 900 SELECTs, which measured 5-6 ms per lookup. The rounded latitudes bound the
    scan, and the dict lookup keeps the caller's point order (and drops rows outside the box).
    """
    if not points:
        return [], []
    keys = {coord_key(lat, lon) for lat, lon in points}
    lat_keys = sorted({lat_key for lat_key, _ in keys})
    placeholders = ",".join("?" for _ in lat_keys)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT lat_key, lon_key, wind_speed_knots, wind_direction_deg, temperature_f "  # noqa: S608
            "FROM grid_weather_cache "
            "WHERE model=? AND hour=? AND expires_at>? AND temperature_f IS NOT NULL "
            f"AND lat_key IN ({placeholders})",  # only generated placeholders, every value is bound
            (model, hour, now, *lat_keys),
        ).fetchall()
    cached = {(row["lat_key"], row["lon_key"]): row for row in rows}

    results: list[GridWindPoint] = []
    missing: list[tuple[float, float]] = []  # original coords for missing cache entries
    for lat, lon in points:
        row = cached.get(coord_key(lat, lon))
        if row is None:
            missing.append((lat, lon))
            continue
        results.append(
            GridWindPoint(
                latitude=lat,
                longitude=lon,
                wind_speed_knots=row["wind_speed_knots"],
                wind_direction_deg=row["wind_direction_deg"],
                temperature_f=row["temperature_f"],
                time=None if hour == "current" else hour,
            )
        )
    return results, missing


def _store_points(fetched: list[GridWindPoint], model: str, hour: str, now: float) -> None:
    expires_at = now + CACHE_TTL_SECONDS
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO grid_weather_cache
                (lat_key, lon_key, model, hour, cached_at, expires_at,
                 wind_speed_knots, wind_direction_deg, temperature_f)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, model, hour) DO UPDATE SET
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
                    hour,
                    now,
                    expires_at,
                    p.wind_speed_knots,
                    p.wind_direction_deg,
                    p.temperature_f,
                )
                for p in fetched
            ],
        )


def _chunks(points: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
    """Split the points into requests whose URL Open-Meteo accepts (SCRUM-192)."""
    size = GRID_REQUEST_MAX_POINTS
    return [points[start : start + size] for start in range(0, len(points), size)]


def _batch_params(points: list[tuple[float, float]], model: str) -> dict:
    """Open-Meteo accepts comma-separated lat/lon arrays, so one request covers every point."""
    return {
        **open_meteo.forecast_params(model),
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
    }


def _as_list(data: object, expected: int) -> list[dict]:
    """Open-Meteo returns an object for one point and an array for several."""
    items = [data] if isinstance(data, dict) else list(data)  # type: ignore[arg-type]
    if len(items) != expected:
        # Treated as an upstream failure (502), not silently truncated.
        raise httpx.HTTPError(f"Open-Meteo returned {len(items)} grid points for {expected} requested")
    return items  # type: ignore[return-value]


def _point_from_current(lat: float, lon: float, item: dict, hour: str | None) -> GridWindPoint:
    current = item.get("current") or {}
    return GridWindPoint(
        latitude=lat,
        longitude=lon,
        wind_speed_knots=as_float(current.get("wind_speed_10m")),
        wind_direction_deg=as_float(current.get("wind_direction_10m")),
        temperature_f=c_to_f(current.get("temperature_2m")),
        time=hour,
    )


def _point_from_hourly(lat: float, lon: float, item: dict, index: int, hour: str) -> GridWindPoint:
    hourly = item.get("hourly") or {}
    series = {name: hourly.get(name) or [] for name in GRID_VARIABLES}
    values = {name: series[name][index] if index < len(series[name]) else None for name in GRID_VARIABLES}
    return GridWindPoint(
        latitude=lat,
        longitude=lon,
        wind_speed_knots=as_float(values["wind_speed_10m"]),
        wind_direction_deg=as_float(values["wind_direction_10m"]),
        temperature_f=c_to_f(values["temperature_2m"]),
        time=hour,
    )


async def _fetch_current(
    points: list[tuple[float, float]],
    model: str,
) -> list[GridWindPoint]:
    """Live values for every point, in chunked batched requests (SCRUM-192)."""
    fetched: list[GridWindPoint] = []
    for chunk in _chunks(points):
        data = await open_meteo.get_json(
            OPEN_METEO_FORECAST_URL,
            {
                **_batch_params(chunk, model),
                "current": ",".join(GRID_VARIABLES),
                "forecast_days": 1,
            },
            timeout=OPEN_METEO_GRID_TIMEOUT_SECONDS,
        )
        items = _as_list(data, len(chunk))
        fetched.extend(_point_from_current(lat, lon, item, None) for (lat, lon), item in zip(chunk, items, strict=True))
    return fetched


async def _fetch_hourly_day(
    points: list[tuple[float, float]],
    model: str,
    at: datetime,
) -> dict[str, list[GridWindPoint]]:
    """One request per chunk for the requested UTC day, merged into every hour it contains.

    Keys are cache hours (`2026-11-25T14:00`), so the caller can store the whole day and return
    the requested hour without a second request. Chunking (SCRUM-192) keeps each URL inside what
    Open-Meteo accepts; the requests run one at a time because the free tier allows one concurrent
    request per IP.
    """
    day = at.astimezone(UTC).strftime("%Y-%m-%d")
    series: dict[str, list[GridWindPoint]] = {}
    for chunk in _chunks(points):
        data = await open_meteo.get_json(
            OPEN_METEO_FORECAST_URL,
            {
                **_batch_params(chunk, model),
                "hourly": ",".join(GRID_VARIABLES),
                "start_date": day,
                "end_date": day,
                "timezone": "UTC",
            },
            timeout=OPEN_METEO_GRID_TIMEOUT_SECONDS,
        )
        items = _as_list(data, len(chunk))
        times = _series_times(items)
        for stamp in times:
            series.setdefault(_series_hour(stamp), [])
        for (lat, lon), item in zip(chunk, items, strict=True):
            for index, stamp in enumerate(times):
                series_hour = _series_hour(stamp)
                series[series_hour].append(_point_from_hourly(lat, lon, item, index, series_hour))

    requested = hour_key(at)
    if requested not in series:
        raise httpx.HTTPError(f"Open-Meteo response did not include the requested hour {requested}")
    return series


def _series_times(items: list[dict]) -> list[str]:
    """The shared hourly time axis; every point in one response uses the same one."""
    times = (items[0].get("hourly") or {}).get("time") or []
    if not times:
        raise httpx.HTTPError("Open-Meteo grid response did not include hourly times")
    return times


def _series_hour(stamp: str) -> str:
    """Normalise an Open-Meteo hourly stamp to the grid cache's hour key."""
    return f"{stamp[:13]}:00" if len(stamp) >= 13 else stamp
