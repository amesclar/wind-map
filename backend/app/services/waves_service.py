"""Ocean-wave service: wave height, direction and period for a grid or point (SCRUM-233).

Values come from Open-Meteo's Marine API (`wave_height`, `wave_direction`, `wave_period`), hourly
for 10 days, through the same shared client as the currents (retries, 429 → `QuotaExceededError`).

Two properties of the Marine API shape this module:

- **It does not return null over land.** An inland request is snapped to the nearest sea cell
  (east of Seattle answered for a cell about 16 km away), so without a filter the layer would draw
  waves over land. A value whose cell is farther than the caller's tolerance from the requested
  point is treated as "no waves" and cached as an empty row.
- **One request carries the whole UTC day.** The cache is keyed by (rounded lat, lon, hour) and one
  hourly request stores every hour of that day, as the currents cache does (SCRUM-166).

`wave_direction` is where the waves come *from* (meteorological convention, like wind), so the
frontend adds 180° to point an arrow where they travel. Heights stay in metres here; the UI
converts to feet.
"""

import logging
import math
import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from backend.app.config import (
    CACHE_TTL_SECONDS,
    OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    OPEN_METEO_MARINE_URL,
    WAVES_MIN_LAND_TOLERANCE_KM,
    WAVES_POINT_LAND_TOLERANCE_KM,
)
from backend.app.database import db_connection
from backend.app.models import WavePoint, WaveSeriesPoint
from backend.app.services import open_meteo
from backend.app.services.model_info import floor_hour
from backend.app.services.time_window import hour_key
from backend.app.units import coord_key

logger = logging.getLogger(__name__)

WAVE_VARIABLES = ("wave_height", "wave_direction", "wave_period")
POINT_SERIES_HOURS = 48
EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class WaveValue:
    """A wave value and the marine model cell it came from."""

    latitude: float
    longitude: float
    height_m: float
    direction_deg: float
    period_s: float


# A cached value with its cell, or None when the point has no waves there (inland / outside the
# wave model, or a snapped cell too far from the request).
Value = WaveValue | None


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres (haversine)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def land_tolerance_km(lat_step_deg: float, lon_step_deg: float, centre_lat: float) -> float:
    """Half the requested grid spacing in km, with a floor for a very fine grid.

    The nearest sea cell a wave model can answer with is one model cell away; half the spacing
    between requested points is the distance at which a snapped cell stops being "this node".
    """
    lat_km = abs(lat_step_deg) * 111.32
    lon_km = abs(lon_step_deg) * 111.32 * max(0.05, math.cos(math.radians(centre_lat)))
    return max(WAVES_MIN_LAND_TOLERANCE_KM, 0.5 * max(lat_km, lon_km))


async def get_grid_waves(
    points: list[tuple[float, float]],
    at: datetime | None = None,
    tolerance_km: float = WAVES_POINT_LAND_TOLERANCE_KM,
) -> list[WavePoint]:
    """Wave values per sea node, now or at a forecast hour.

    `at` is an aware UTC hour (already validated) or None for current conditions. Nodes without
    a value (inland, outside the model, or snapped too far) are absent from the result. Cache
    misses are fetched in one batched marine request.
    """
    if not points:
        return []

    hour = hour_key(at)
    now = time.time()
    cached = _read_cached_points(points, hour, now)
    missing = [point for point in points if coord_key(*point) not in cached]
    if not missing:
        return _points_from(points, cached, hour)

    if at is None:
        values = _drop_snapped(await _fetch_wave(missing), missing, tolerance_km)
        _store(missing, values, hour, now)
        for point, value in zip(missing, values, strict=True):
            cached[coord_key(*point)] = value
        return _points_from(points, cached, hour)

    # One response already carries the whole UTC day, so cache every hour of it (SCRUM-166).
    series = await _fetch_hourly(missing, at, at)
    for series_hour, values in series.items():
        _store(missing, _drop_snapped(values, missing, tolerance_km), series_hour, now)
    requested = hour_key(at)
    if requested not in series:
        raise httpx.HTTPError(f"Open-Meteo wave response did not include the requested hour {requested}")
    return _points_from(points, _read_cached_points(points, hour, now), hour)


async def get_point_waves(
    lat: float,
    lon: float,
    hours: int = POINT_SERIES_HOURS,
    now: datetime | None = None,
    tolerance_km: float = WAVES_POINT_LAND_TOLERANCE_KM,
) -> list[WaveSeriesPoint]:
    """Hourly wave values for one point from the current hour.

    Empty when the point has no waves (inland, outside the model, or snapped farther than the
    fixed tolerance). Missing hours are fetched one UTC day at a time and cached with the grid.
    """
    start = floor_hour(now or datetime.now(UTC))
    wanted = [start + timedelta(hours=step) for step in range(hours)]
    cached = _read_series(lat, lon, [hour_key(moment) for moment in wanted])

    missing_days = sorted({hour_key(moment)[:10] for moment in wanted if hour_key(moment) not in cached})
    for day in missing_days:
        day_start = datetime.fromisoformat(day).replace(tzinfo=UTC)
        series = await _fetch_hourly([(lat, lon)], day_start, day_start)
        stamp = time.time()
        for series_hour, values in series.items():
            _store([(lat, lon)], _drop_snapped(values, [(lat, lon)], tolerance_km), series_hour, stamp)
    if missing_days:
        cached = _read_series(lat, lon, [hour_key(moment) for moment in wanted])

    result: list[WaveSeriesPoint] = []
    for moment in wanted:
        value = cached.get(hour_key(moment))
        if value is None:
            continue
        result.append(
            WaveSeriesPoint(
                time=hour_key(moment),
                height_m=value.height_m,
                direction_deg=value.direction_deg,
                period_s=value.period_s,
            )
        )
    return result


def _cached_value(row: sqlite3.Row) -> Value:
    """One cached value with its cell, or None for an empty row ("checked, no waves")."""
    if row["wave_height_m"] is None:
        return None
    return WaveValue(
        latitude=row["cell_lat"] if row["cell_lat"] is not None else row["lat_key"],
        longitude=row["cell_lon"] if row["cell_lon"] is not None else row["lon_key"],
        height_m=row["wave_height_m"],
        direction_deg=row["wave_direction_deg"],
        period_s=row["wave_period_s"],
    )


def _read_cached_points(
    points: list[tuple[float, float]],
    hour: str,
    now: float,
) -> dict[tuple[float, float], Value]:
    """Cached values for the requested points at `hour`. Empty rows mean "checked, no waves"."""
    keys = {coord_key(lat, lon) for lat, lon in points}
    lat_keys = sorted({lat_key for lat_key, _ in keys})
    placeholders = ",".join("?" for _ in lat_keys)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT lat_key, lon_key, wave_height_m, wave_direction_deg, wave_period_s, "  # noqa: S608
            "cell_lat, cell_lon FROM grid_waves_cache "
            f"WHERE hour=? AND expires_at>? AND lat_key IN ({placeholders})",
            (hour, now, *lat_keys),
        ).fetchall()
    return {(row["lat_key"], row["lon_key"]): _cached_value(row) for row in rows}


def _read_series(
    lat: float,
    lon: float,
    hours: list[str],
) -> dict[str, Value]:
    """Cached values for one point at the requested hours; empty rows mean "checked, no waves"."""
    if not hours:
        return {}
    lat_key, lon_key = coord_key(lat, lon)
    placeholders = ",".join("?" for _ in hours)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT hour, lat_key, lon_key, wave_height_m, wave_direction_deg, wave_period_s, "  # noqa: S608
            "cell_lat, cell_lon FROM grid_waves_cache "
            f"WHERE lat_key=? AND lon_key=? AND hour IN ({placeholders}) AND expires_at>?",
            (lat_key, lon_key, *hours, time.time()),
        ).fetchall()
    return {row["hour"]: _cached_value(row) for row in rows}


def _points_from(
    points: list[tuple[float, float]],
    cached: dict[tuple[float, float], Value],
    hour: str,
) -> list[WavePoint]:
    """One point per model cell with data, in request order.

    Points without waves are dropped. Several requested points can snap to the same water cell,
    so each cell is returned once and carries its own coordinates: the arrow sits on water and
    its pop-up names the true source of the value.
    """
    result: list[WavePoint] = []
    seen: set[tuple[float, float]] = set()
    for lat, lon in points:
        value = cached.get(coord_key(lat, lon))
        if value is None:
            continue
        cell = (round(value.latitude, 6), round(value.longitude, 6))
        if cell in seen:
            continue
        seen.add(cell)
        result.append(
            WavePoint(
                latitude=value.latitude,
                longitude=value.longitude,
                height_m=value.height_m,
                direction_deg=value.direction_deg,
                period_s=value.period_s,
                time=None if hour == "current" else hour,
            )
        )
    return result


def _store(
    points: list[tuple[float, float]],
    values: list[Value],
    hour: str,
    now: float,
) -> None:
    """Write one row per point, including empty rows for points that have no waves."""
    expires_at = now + CACHE_TTL_SECONDS
    rows = []
    for (lat, lon), value in zip(points, values, strict=True):
        lat_key, lon_key = coord_key(lat, lon)
        if value is None:
            height, direction, period, cell_lat, cell_lon = None, None, None, None, None
        else:
            height, direction, period = value.height_m, value.direction_deg, value.period_s
            cell_lat, cell_lon = value.latitude, value.longitude
        rows.append((lat_key, lon_key, hour, now, expires_at, height, direction, period, cell_lat, cell_lon))
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO grid_waves_cache
                (lat_key, lon_key, hour, cached_at, expires_at, wave_height_m, wave_direction_deg,
                 wave_period_s, cell_lat, cell_lon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, hour) DO UPDATE SET
                cached_at=excluded.cached_at,
                expires_at=excluded.expires_at,
                wave_height_m=excluded.wave_height_m,
                wave_direction_deg=excluded.wave_direction_deg,
                wave_period_s=excluded.wave_period_s,
                cell_lat=excluded.cell_lat,
                cell_lon=excluded.cell_lon
            """,
            rows,
        )


def _batch_params(points: list[tuple[float, float]]) -> dict:
    """The marine API accepts comma-separated lat/lon arrays, like the forecast API."""
    return {
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
    }


def _as_list(data: object, expected: int) -> list[dict]:
    """Open-Meteo returns an object for one point and an array for several."""
    items = [data] if isinstance(data, dict) else list(data)  # type: ignore[arg-type]
    if len(items) != expected:
        # Treated as an upstream failure (502), not silently truncated.
        raise httpx.HTTPError(f"Open-Meteo returned {len(items)} marine points for {expected} requested")
    return items  # type: ignore[return-value]


def _cell(item: dict, fallback: tuple[float, float]) -> tuple[float, float]:
    """The model cell Open-Meteo answered with; the request is the fallback if it omits it."""
    lat = item.get("latitude")
    lon = item.get("longitude")
    if lat is None or lon is None:
        return fallback
    return (float(lat), float(lon))


def _drop_snapped(
    values: list[Value],
    points: list[tuple[float, float]],
    tolerance_km: float,
) -> list[Value]:
    """Null values whose cell is farther than `tolerance_km` from the requested point.

    The wave models answer an inland request with their nearest sea cell. Half the grid spacing
    (or the fixed point tolerance) is the line between "a coastal node answered by the cell that
    covers it" and "an inland node borrowing water from somewhere else".
    """
    result: list[Value] = []
    for value, (lat, lon) in zip(values, points, strict=True):
        if value is None:
            result.append(None)
            continue
        if distance_km(lat, lon, value.latitude, value.longitude) > tolerance_km:
            result.append(None)
            continue
        result.append(value)
    return result


def _value(height: object, direction: object, period: object, cell: tuple[float, float]) -> Value:
    """A value at its model cell, or None when the API has no wave for that point or hour."""
    if height is None or direction is None or period is None:
        return None
    return WaveValue(
        latitude=cell[0],
        longitude=cell[1],
        height_m=float(height),  # type: ignore[arg-type]
        direction_deg=float(direction),  # type: ignore[arg-type]
        period_s=float(period),  # type: ignore[arg-type]
    )


async def _fetch_wave(points: list[tuple[float, float]]) -> list[Value]:
    """One batched request for every point's live values."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            **_batch_params(points),
            "current": ",".join(WAVE_VARIABLES),
            "forecast_days": 1,
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    )
    items = _as_list(data, len(points))
    return [
        _value(
            (item.get("current") or {}).get("wave_height"),
            (item.get("current") or {}).get("wave_direction"),
            (item.get("current") or {}).get("wave_period"),
            _cell(item, point),
        )
        for item, point in zip(items, points, strict=True)
    ]


def _series_times(items: list[dict]) -> list[str]:
    """The shared hourly time axis; every point in one response uses the same one."""
    times = (items[0].get("hourly") or {}).get("time") or []
    if not times:
        raise httpx.HTTPError("Open-Meteo wave response did not include hourly times")
    return times


def _series_hour(stamp: str) -> str:
    """Normalise an Open-Meteo hourly stamp to the cache's hour key."""
    return f"{stamp[:13]}:00" if len(stamp) >= 13 else stamp


async def _fetch_hourly(
    points: list[tuple[float, float]],
    start: datetime,
    end: datetime,
) -> dict[str, list[Value]]:
    """One request for [start, end]'s UTC days, parsed into a value list per hour."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            **_batch_params(points),
            "hourly": ",".join(WAVE_VARIABLES),
            "start_date": start.astimezone(UTC).strftime("%Y-%m-%d"),
            "end_date": end.astimezone(UTC).strftime("%Y-%m-%d"),
            "timezone": "UTC",
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    )
    items = _as_list(data, len(points))
    cells = [_cell(item, point) for item, point in zip(items, points, strict=True)]
    series: dict[str, list[Value]] = {}
    for index, stamp in enumerate(_series_times(items)):
        values: list[Value] = []
        for item, cell in zip(items, cells, strict=True):
            hourly = item.get("hourly") or {}
            height = hourly.get("wave_height") or []
            direction = hourly.get("wave_direction") or []
            period = hourly.get("wave_period") or []
            values.append(
                _value(
                    height[index] if index < len(height) else None,
                    direction[index] if index < len(direction) else None,
                    period[index] if index < len(period) else None,
                    cell,
                )
            )
        series[_series_hour(stamp)] = values
    return series
