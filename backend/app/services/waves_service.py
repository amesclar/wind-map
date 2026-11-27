"""Ocean-wave service: wave height, direction and period for a grid or point (SCRUM-233).

Values come from Open-Meteo's Marine API (`wave_height`, `wave_direction`, `wave_period`), hourly
for 10 days, through the same shared client as the currents (retries, 429 → `QuotaExceededError`).

Two properties of the Marine API shape this module:

- **It does not return null over land.** An inland request is snapped to the nearest sea cell
  (east of Seattle answered for a cell about 16 km away), so without a filter the layer would draw
  waves over land. A value whose cell is farther than the caller's tolerance from the requested
  point is treated as "no waves" and cached as an empty row. Distance alone is not enough on a
  narrow coast — the model's own mask is about 8 km wide, so an island cell can be two kilometres
  away — so a cell on land in the 1 km GLOBE mask is dropped too (SCRUM-263).
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

from backend.app.config import WAVES_MIN_LAND_TOLERANCE_KM, WAVES_POINT_LAND_TOLERANCE_KM
from backend.app.models import WavePoint, WaveSeriesPoint
from backend.app.services import marine_grid
from backend.app.services.land_mask import is_land
from backend.app.services.model_info import floor_hour
from backend.app.services.time_window import hour_key
from backend.app.units import coord_key

logger = logging.getLogger(__name__)

WAVE_VARIABLES = ("wave_height", "wave_direction", "wave_period")
POINT_SERIES_HOURS = 48


# What this layer caches; the machinery around it is shared (SCRUM-276).
SPEC = marine_grid.MarineSpec(
    table="grid_waves_cache",
    variables=WAVE_VARIABLES,
    label="waves",
    value_columns=("wave_height_m", "wave_direction_deg", "wave_period_s"),
)
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
    cached = marine_grid.read_points(SPEC, points, hour, now, _cached_value)
    missing = [point for point in points if coord_key(*point) not in cached]
    if not missing:
        return _points_from(points, cached, hour)

    if at is None:
        fetched = await marine_grid.fetch_current(SPEC, missing, _wave_value)
        values = _drop_on_land(_drop_snapped(fetched, missing, tolerance_km))
        marine_grid.store(SPEC, missing, values, hour, now, _unpack)
        for point, value in zip(missing, values, strict=True):
            cached[coord_key(*point)] = value
        return _points_from(points, cached, hour)

    # One response already carries the whole UTC day, so cache every hour of it (SCRUM-166).
    series = await marine_grid.fetch_hourly(SPEC, missing, at, at, _hour_value)
    for series_hour, values in series.items():
        kept = _drop_on_land(_drop_snapped(values, missing, tolerance_km))
        marine_grid.store(SPEC, missing, kept, series_hour, now, _unpack)
    requested = hour_key(at)
    if requested not in series:
        raise httpx.HTTPError(f"Open-Meteo wave response did not include the requested hour {requested}")
    return _points_from(points, marine_grid.read_points(SPEC, points, hour, now, _cached_value), hour)


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
    wanted_hours = [hour_key(moment) for moment in wanted]
    cached = marine_grid.read_series(SPEC, lat, lon, wanted_hours, time.time(), _cached_value)

    missing_days = sorted({hour_key(moment)[:10] for moment in wanted if hour_key(moment) not in cached})
    for day in missing_days:
        day_start = datetime.fromisoformat(day).replace(tzinfo=UTC)
        series = await marine_grid.fetch_hourly(SPEC, [(lat, lon)], day_start, day_start, _hour_value)
        stamp = time.time()
        for series_hour, values in series.items():
            values = _drop_on_land(_drop_snapped(values, [(lat, lon)], tolerance_km))
            marine_grid.store(SPEC, [(lat, lon)], values, series_hour, stamp, _unpack)
    if missing_days:
        cached = marine_grid.read_series(SPEC, lat, lon, wanted_hours, time.time(), _cached_value)

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


def _drop_on_land(values: list[Value]) -> list[Value]:
    """Null values whose model cell is land (SCRUM-263).

    The cell is where the arrow is drawn, and the wave models' mask is coarse enough to put one on
    a narrow island (Whidbey Island, in the spike). The distance filter cannot see that: the cell
    is close, it is simply not sea, so every surviving cell is tested against the 1 km land mask.
    """
    return [None if value is not None and is_land(value.latitude, value.longitude) else value for value in values]


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


def _wave_value(current: dict, cell: tuple[float, float]) -> Value:
    """One live value from a `current` block."""
    return _value(current.get("wave_height"), current.get("wave_direction"), current.get("wave_period"), cell)


def _hour_value(hourly: dict, index: int, cell: tuple[float, float]) -> Value:
    """One value at `index` of an `hourly` block."""
    height = hourly.get("wave_height") or []
    direction = hourly.get("wave_direction") or []
    period = hourly.get("wave_period") or []
    return _value(
        height[index] if index < len(height) else None,
        direction[index] if index < len(direction) else None,
        period[index] if index < len(period) else None,
        cell,
    )


def _unpack(value: Value) -> tuple[object, ...]:
    """A value as its cache columns, empty rows included."""
    if value is None:
        return (None, None, None, None, None)
    return (value.height_m, value.direction_deg, value.period_s, value.latitude, value.longitude)
