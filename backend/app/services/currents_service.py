"""Ocean-current service: currents for a lat/lon grid or point, now or at a forecast hour.

Values come from Open-Meteo's Marine API (MeteoFrance SMOC via Copernicus Marine): global at about
8 km, hourly, 10 days, updated once a day (SCRUM-96). Two properties of that API shape this module:

- It returns `null` over land and outside the model domain. Those nodes are dropped from responses
  and cached as empty rows, so an inland view is not fetched again on every pan.
- It answers each requested point with its nearest sea cell and returns that cell's coordinates.
  Values are placed at the cell, not the request (SCRUM-238), so a coastal point never gets a
  chevron on land; points sharing a cell share one chevron.
- Velocity is converted to knots by the request itself (`wind_speed_unit=kn`), matching the wind
  endpoints; no km/h maths happens here.

The cache is keyed by (rounded lat, lon, hour), and one hourly request stores every hour of that
UTC day from the same response, as the wind grid does (SCRUM-166).
"""

import logging
import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from backend.app.config import (
    LAND_ELEVATION_THRESHOLD_M,
    OPEN_METEO_ELEVATION_TIMEOUT_SECONDS,
    OPEN_METEO_ELEVATION_URL,
)
from backend.app.models import CurrentPoint, CurrentSeriesPoint
from backend.app.services import marine_grid, open_meteo
from backend.app.services.model_info import floor_hour
from backend.app.services.time_window import hour_key
from backend.app.units import coord_key

logger = logging.getLogger(__name__)

CURRENT_VARIABLES = ("ocean_current_velocity", "ocean_current_direction")
# Open-Meteo's elevation endpoint accepts a bounded coordinate list; grids are chunked like the
# marine fetch.
ELEVATION_BATCH_SIZE = 100
# The marine API converts current velocity to knots when asked; verified against the live API.
MARINE_PARAMS = {"wind_speed_unit": "kn"}
POINT_SERIES_HOURS = 48


# What this layer caches; the machinery around it is shared (SCRUM-276).
SPEC = marine_grid.MarineSpec(
    table="grid_currents_cache",
    variables=CURRENT_VARIABLES,
    label="currents",
    value_columns=("velocity_knots", "direction_deg"),
    params=MARINE_PARAMS,
)


@dataclass(frozen=True)
class CurrentValue:
    """A current value and the Marine model cell it came from (SCRUM-238)."""

    latitude: float
    longitude: float
    velocity_knots: float
    direction_deg: float


# A cached value with its cell, or None when the point has no current there (land / outside
# the domain).
Value = CurrentValue | None


async def get_grid_currents(
    points: list[tuple[float, float]],
    at: datetime | None = None,
) -> list[CurrentPoint]:
    """Current speed (knots) and direction (degrees the water flows towards) per point.

    `at` is an aware UTC hour (already validated) or None for current conditions. Points with no
    current are absent from the result. Cache misses are fetched in one batched marine request.
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
        values = await marine_grid.fetch_current(SPEC, missing, _current_value)
        values = _drop_land(values, await _land_cells(values))
        marine_grid.store(SPEC, missing, values, hour, now, _unpack)
        for point, value in zip(missing, values, strict=True):
            cached[coord_key(*point)] = value
        return _points_from(points, cached, hour)

    # One response already carries the whole UTC day, so cache every hour of it (SCRUM-166).
    series = await marine_grid.fetch_hourly(SPEC, missing, at, at, _hour_value)
    land = await _land_cells([value for values in series.values() for value in values if value is not None])
    for series_hour, values in series.items():
        marine_grid.store(SPEC, missing, _drop_land(values, land), series_hour, now, _unpack)
    requested = hour_key(at)
    if requested not in series:
        raise httpx.HTTPError(f"Open-Meteo marine response did not include the requested hour {requested}")
    return _points_from(points, marine_grid.read_points(SPEC, points, hour, now, _cached_value), hour)


async def get_point_currents(
    lat: float,
    lon: float,
    hours: int = POINT_SERIES_HOURS,
    now: datetime | None = None,
) -> list[CurrentSeriesPoint]:
    """Hourly current values for one point, starting at the current hour.

    Empty when the point has no current data (inland or outside the model domain). Missing hours
    are fetched one UTC day at a time and cached with the rest of the grid cache.
    """
    start = floor_hour(now or datetime.now(UTC))
    wanted = [start + timedelta(hours=step) for step in range(hours)]
    wanted_hours = [hour_key(moment) for moment in wanted]
    cached = marine_grid.read_series(SPEC, lat, lon, wanted_hours, time.time(), _cached_value)

    missing_days = sorted({hour_key(moment)[:10] for moment in wanted if hour_key(moment) not in cached})
    for day in missing_days:
        day_start = datetime.fromisoformat(day).replace(tzinfo=UTC)
        series = await marine_grid.fetch_hourly(SPEC, [(lat, lon)], day_start, day_start, _hour_value)
        land = await _land_cells([value for values in series.values() for value in values if value is not None])
        stamp = time.time()
        for series_hour, values in series.items():
            marine_grid.store(SPEC, [(lat, lon)], _drop_land(values, land), series_hour, stamp, _unpack)
    if missing_days:
        wanted_hours = [hour_key(moment) for moment in wanted]
    cached = marine_grid.read_series(SPEC, lat, lon, wanted_hours, time.time(), _cached_value)

    result: list[CurrentSeriesPoint] = []
    for moment in wanted:
        value = cached.get(hour_key(moment))
        if value is None:
            continue
        result.append(
            CurrentSeriesPoint(
                time=hour_key(moment),
                velocity_knots=value.velocity_knots,
                direction_deg=value.direction_deg,
            )
        )
    return result


def _cached_value(row: sqlite3.Row) -> Value:
    """One cached value with its cell, or None for an empty row ("checked, no current")."""
    if row["velocity_knots"] is None:
        return None
    # The stored cell places the chevron exactly as the live response did (SCRUM-238). The key
    # is a fallback for a row written before the schema bump; the migration replaces those.
    return CurrentValue(
        latitude=row["cell_lat"] if row["cell_lat"] is not None else row["lat_key"],
        longitude=row["cell_lon"] if row["cell_lon"] is not None else row["lon_key"],
        velocity_knots=row["velocity_knots"],
        direction_deg=row["direction_deg"],
    )


def _points_from(
    points: list[tuple[float, float]],
    cached: dict[tuple[float, float], Value],
    hour: str,
) -> list[CurrentPoint]:
    """One point per model cell with data, in request order (SCRUM-238).

    Points without a current are dropped. Several requested points can snap to the same cell,
    especially at high zoom, so each cell is returned once and carries its own coordinates: the
    chevron sits on water and its pop-up names the true source of the value.
    """
    result: list[CurrentPoint] = []
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
            CurrentPoint(
                latitude=value.latitude,
                longitude=value.longitude,
                velocity_knots=value.velocity_knots,
                direction_deg=value.direction_deg,
                time=None if hour == "current" else hour,
            )
        )
    return result


def _cell_of(value: CurrentValue) -> tuple[float, float]:
    """The rounded cell key used for deduplication and the land test."""
    return (round(value.latitude, 6), round(value.longitude, 6))


async def _elevations(cells: list[tuple[float, float]]) -> dict[tuple[float, float], float]:
    """Elevation in metres for each unique cell, or {} when Open-Meteo cannot say.

    One batched request per 100 cells. A failed lookup is not fatal: without a verdict the
    values are kept, because hiding real water is worse than a rare chevron over land while
    the elevation service is down.
    """
    unique = list(dict.fromkeys(cells))
    result: dict[tuple[float, float], float] = {}
    for start in range(0, len(unique), ELEVATION_BATCH_SIZE):
        chunk = unique[start : start + ELEVATION_BATCH_SIZE]
        try:
            data = await open_meteo.get_json(
                OPEN_METEO_ELEVATION_URL,
                {
                    "latitude": ",".join(str(lat) for lat, _ in chunk),
                    "longitude": ",".join(str(lon) for _, lon in chunk),
                },
                timeout=OPEN_METEO_ELEVATION_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            logger.warning("Elevation lookup failed; keeping current cells: %s", exc)
            return result
        values = data.get("elevation") if isinstance(data, dict) else None
        if not isinstance(values, list) or len(values) != len(chunk):
            logger.warning("Elevation lookup returned an unexpected payload; keeping current cells")
            return result
        for cell, elevation in zip(chunk, values, strict=True):
            if isinstance(elevation, (int, float)):
                result[cell] = float(elevation)
    return result


async def _land_cells(values: list[Value]) -> set[tuple[float, float]]:
    """Cells whose centre sits above sea level, so a chevron there would be on land (SCRUM-238).

    The Marine model's land mask is coarser than the chart: Whidbey is about one cell wide, so
    cells it considers sea can still fall on the island. Elevation is the check that keeps the
    chevron on water; a cell at or below the threshold is treated as sea.
    """
    cells = [_cell_of(value) for value in values if value is not None]
    if not cells:
        return set()
    elevations = await _elevations(cells)
    return {cell for cell, elevation in elevations.items() if elevation > LAND_ELEVATION_THRESHOLD_M}


def _drop_land(values: list[Value], land: set[tuple[float, float]]) -> list[Value]:
    """Null the values whose cell is on land, so they are cached as empty rows."""
    return [None if value is not None and _cell_of(value) in land else value for value in values]


def _value(velocity: object, direction: object, cell: tuple[float, float]) -> Value:
    """A value at its model cell, or None when the API has no current for that point or hour."""
    if velocity is None or direction is None:
        return None
    return CurrentValue(
        latitude=cell[0],
        longitude=cell[1],
        velocity_knots=float(velocity),  # type: ignore[arg-type]
        direction_deg=float(direction),  # type: ignore[arg-type]
    )


def _current_value(current: dict, cell: tuple[float, float]) -> Value:
    """One live value from a `current` block."""
    return _value(current.get("ocean_current_velocity"), current.get("ocean_current_direction"), cell)


def _hour_value(hourly: dict, index: int, cell: tuple[float, float]) -> Value:
    """One value at `index` of an `hourly` block."""
    velocity = hourly.get("ocean_current_velocity") or []
    direction = hourly.get("ocean_current_direction") or []
    return _value(
        velocity[index] if index < len(velocity) else None,
        direction[index] if index < len(direction) else None,
        cell,
    )


def _unpack(value: Value) -> tuple[object, ...]:
    """A value as its cache columns, empty rows included."""
    if value is None:
        return (None, None, None, None)
    return (value.velocity_knots, value.direction_deg, value.latitude, value.longitude)
