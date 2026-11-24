"""Ocean-current service: currents for a lat/lon grid or point, now or at a forecast hour.

Values come from Open-Meteo's Marine API (MeteoFrance SMOC via Copernicus Marine): global at about
8 km, hourly, 10 days, updated once a day (SCRUM-96). Two properties of that API shape this module:

- It returns `null` over land and outside the model domain. Those nodes are dropped from responses
  and cached as empty rows, so an inland view is not fetched again on every pan.
- Velocity is converted to knots by the request itself (`wind_speed_unit=kn`), matching the wind
  endpoints; no km/h maths happens here.

The cache is keyed by (rounded lat, lon, hour), and one hourly request stores every hour of that
UTC day from the same response, as the wind grid does (SCRUM-166).
"""

import time
from datetime import UTC, datetime, timedelta

import httpx

from backend.app.config import (
    CACHE_TTL_SECONDS,
    OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    OPEN_METEO_MARINE_URL,
)
from backend.app.database import db_connection
from backend.app.models import CurrentPoint, CurrentSeriesPoint
from backend.app.services import open_meteo
from backend.app.services.model_info import floor_hour
from backend.app.services.time_window import hour_key
from backend.app.units import coord_key

CURRENT_VARIABLES = ("ocean_current_velocity", "ocean_current_direction")
# The marine API converts current velocity to knots when asked; verified against the live API.
MARINE_PARAMS = {"wind_speed_unit": "kn"}
POINT_SERIES_HOURS = 48

# A cached value pair, or None when the point has no current there (land / outside the domain).
Value = tuple[float, float] | None


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
    cached = _read_cached_points(points, hour, now)
    missing = [point for point in points if coord_key(*point) not in cached]
    if not missing:
        return _points_from(points, cached, hour)

    if at is None:
        values = await _fetch_current(missing)
        _store(missing, values, hour, now)
        for point, value in zip(missing, values, strict=True):
            cached[coord_key(*point)] = value
        return _points_from(points, cached, hour)

    # One response already carries the whole UTC day, so cache every hour of it (SCRUM-166).
    series = await _fetch_hourly(missing, at, at)
    for series_hour, values in series.items():
        _store(missing, values, series_hour, now)
    requested = hour_key(at)
    if requested not in series:
        raise httpx.HTTPError(f"Open-Meteo marine response did not include the requested hour {requested}")
    return _points_from(points, _read_cached_points(points, hour, now), hour)


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
    cached = _read_series(lat, lon, [hour_key(moment) for moment in wanted])

    missing_days = sorted({hour_key(moment)[:10] for moment in wanted if hour_key(moment) not in cached})
    for day in missing_days:
        day_start = datetime.fromisoformat(day).replace(tzinfo=UTC)
        series = await _fetch_hourly([(lat, lon)], day_start, day_start)
        stamp = time.time()
        for series_hour, values in series.items():
            _store([(lat, lon)], values, series_hour, stamp)
    if missing_days:
        cached = _read_series(lat, lon, [hour_key(moment) for moment in wanted])

    result: list[CurrentSeriesPoint] = []
    for moment in wanted:
        value = cached.get(hour_key(moment))
        if value is None:
            continue
        result.append(
            CurrentSeriesPoint(
                time=hour_key(moment),
                velocity_knots=value[0],
                direction_deg=value[1],
            )
        )
    return result


def _read_cached_points(
    points: list[tuple[float, float]],
    hour: str,
    now: float,
) -> dict[tuple[float, float], Value]:
    """Cached values for the requested points at `hour`. Empty rows mean "checked, no current"."""
    keys = {coord_key(lat, lon) for lat, lon in points}
    lat_keys = sorted({lat_key for lat_key, _ in keys})
    placeholders = ",".join("?" for _ in lat_keys)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT lat_key, lon_key, velocity_knots, direction_deg FROM grid_currents_cache "  # noqa: S608
            f"WHERE hour=? AND expires_at>? AND lat_key IN ({placeholders})",
            (hour, now, *lat_keys),
        ).fetchall()
    return {
        (row["lat_key"], row["lon_key"]): (
            None if row["velocity_knots"] is None else (row["velocity_knots"], row["direction_deg"])
        )
        for row in rows
    }


def _read_series(
    lat: float,
    lon: float,
    hours: list[str],
) -> dict[str, Value]:
    """Cached values for one point at the requested hours; empty rows mean "checked, no current"."""
    if not hours:
        return {}
    lat_key, lon_key = coord_key(lat, lon)
    placeholders = ",".join("?" for _ in hours)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT hour, velocity_knots, direction_deg FROM grid_currents_cache "  # noqa: S608
            f"WHERE lat_key=? AND lon_key=? AND hour IN ({placeholders}) AND expires_at>?",
            (lat_key, lon_key, *hours, time.time()),
        ).fetchall()
    return {
        row["hour"]: (None if row["velocity_knots"] is None else (row["velocity_knots"], row["direction_deg"]))
        for row in rows
    }


def _points_from(
    points: list[tuple[float, float]],
    cached: dict[tuple[float, float], Value],
    hour: str,
) -> list[CurrentPoint]:
    """Requested coordinates with data, in request order; points without a current are dropped."""
    result: list[CurrentPoint] = []
    for lat, lon in points:
        value = cached.get(coord_key(lat, lon))
        if value is None:
            continue
        result.append(
            CurrentPoint(
                latitude=lat,
                longitude=lon,
                velocity_knots=value[0],
                direction_deg=value[1],
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
    """Write one row per point, including empty rows for points that have no current."""
    expires_at = now + CACHE_TTL_SECONDS
    rows = []
    for (lat, lon), value in zip(points, values, strict=True):
        lat_key, lon_key = coord_key(lat, lon)
        velocity, direction = (None, None) if value is None else value
        rows.append((lat_key, lon_key, hour, now, expires_at, velocity, direction))
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO grid_currents_cache
                (lat_key, lon_key, hour, cached_at, expires_at, velocity_knots, direction_deg)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, hour) DO UPDATE SET
                cached_at=excluded.cached_at,
                expires_at=excluded.expires_at,
                velocity_knots=excluded.velocity_knots,
                direction_deg=excluded.direction_deg
            """,
            rows,
        )


def _batch_params(points: list[tuple[float, float]]) -> dict:
    """The marine API accepts comma-separated lat/lon arrays, like the forecast API."""
    return {
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
        **MARINE_PARAMS,
    }


def _as_list(data: object, expected: int) -> list[dict]:
    """Open-Meteo returns an object for one point and an array for several."""
    items = [data] if isinstance(data, dict) else list(data)  # type: ignore[arg-type]
    if len(items) != expected:
        # Treated as an upstream failure (502), not silently truncated.
        raise httpx.HTTPError(f"Open-Meteo returned {len(items)} marine points for {expected} requested")
    return items  # type: ignore[return-value]


def _value(velocity: object, direction: object) -> Value:
    """A value pair, or None when the API has no current for that point or hour."""
    if velocity is None or direction is None:
        return None
    return (float(velocity), float(direction))  # type: ignore[arg-type]


async def _fetch_current(points: list[tuple[float, float]]) -> list[Value]:
    """One batched request for every point's live values."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            **_batch_params(points),
            "current": ",".join(CURRENT_VARIABLES),
            "forecast_days": 1,
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    )
    items = _as_list(data, len(points))
    return [
        _value(
            (item.get("current") or {}).get("ocean_current_velocity"),
            (item.get("current") or {}).get("ocean_current_direction"),
        )
        for item in items
    ]


def _series_times(items: list[dict]) -> list[str]:
    """The shared hourly time axis; every point in one response uses the same one."""
    times = (items[0].get("hourly") or {}).get("time") or []
    if not times:
        raise httpx.HTTPError("Open-Meteo marine response did not include hourly times")
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
            "hourly": ",".join(CURRENT_VARIABLES),
            "start_date": start.astimezone(UTC).strftime("%Y-%m-%d"),
            "end_date": end.astimezone(UTC).strftime("%Y-%m-%d"),
            "timezone": "UTC",
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    )
    items = _as_list(data, len(points))
    series: dict[str, list[Value]] = {}
    for index, stamp in enumerate(_series_times(items)):
        values: list[Value] = []
        for item in items:
            hourly = item.get("hourly") or {}
            velocity = hourly.get("ocean_current_velocity") or []
            direction = hourly.get("ocean_current_direction") or []
            values.append(
                _value(
                    velocity[index] if index < len(velocity) else None,
                    direction[index] if index < len(direction) else None,
                )
            )
        series[_series_hour(stamp)] = values
    return series
