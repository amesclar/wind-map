"""Grid weather service: wind for a lat/lon grid at the current hour or a forecast hour.

Current values come from Open-Meteo's `current` block; a requested hour comes from the hourly
series for that UTC day (SCRUM-115). Rows are cached per (rounded lat, lon, model, hour), and one
forecast-hour request stores every hour of that day from the same response (SCRUM-166), so a
multi-hour range reads the rest of the day from SQLite instead of calling Open-Meteo again.

The grid's samples sit on a lattice shared by every view of the same zoom (`grid_box.grid_points`,
SCRUM-267), so panning asks Open-Meteo for the strip it revealed and the cached rows are merged
back into the requested order.
"""

import time
from collections.abc import Callable
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
from backend.app.services.model_availability import refresh_clock
from backend.app.services.time_window import hour_key
from backend.app.units import as_optional_float, c_to_f, coord_key

GRID_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "temperature_2m")

# A regional model (RRFS) rejects a whole batch when one point is outside its domain (SCRUM-229).
# Splitting a chunk in half finds its covered points; this caps what a single chunk may spend so
# a view straddling a jagged edge cannot turn into hundreds of requests (SCRUM-231).
COVERAGE_SPLIT_MAX_REQUESTS = 24


async def get_grid_wind(
    points: list[tuple[float, float]],
    model: str = DEFAULT_MODEL,
    at: datetime | None = None,
    refresh: bool = False,
) -> list[GridWindPoint]:
    """Wind speed (knots), direction (degrees) and temperature (°F) for each (lat, lon) point.

    `at` is an aware UTC hour (already validated) or None for current conditions. Cache misses
    are fetched in one batched Open-Meteo request.

    `refresh` (SCRUM-113) treats only the rows older than the model's newest published run as
    misses, so the request asks Open-Meteo for those points alone and the rest stay cached.
    """
    if not points:
        return []

    hour = hour_key(at)
    now = time.time()
    clock = await refresh_clock(model) if refresh else None
    results, missing = _read_cached_points(points, model, hour, now, None if clock is None else clock.timestamp())
    if not missing:
        return results

    if at is None:
        # No DB connection is held during the HTTP call.
        fetched = await _fetch_current(missing, model)
        _store_series({hour: fetched}, model, now)
        return _merge(points, results, fetched)

    # One response already carries the whole UTC day, so cache every hour of it. The rest of a
    # multi-hour range is then served from SQLite instead of repeating the Open-Meteo call
    # (SCRUM-166), which used to trip its rate limit.
    series = await _fetch_hourly_day(missing, model, at)
    _store_series(series, model, now)
    return _merge(points, results, series[hour])


def _merge(
    points: list[tuple[float, float]],
    cached: list[GridWindPoint],
    fetched: list[GridWindPoint],
) -> list[GridWindPoint]:
    """A partial hit as one list in the caller's row-major order (SCRUM-267).

    Appending the fetched points after the cached ones put the two halves out of order, so the
    overlays could no longer read the response as a row-major grid. A point the model has no
    coverage for (an RRFS edge) stays absent rather than being invented.
    """
    by_coord = {(point.latitude, point.longitude): point for point in (*cached, *fetched)}
    return [by_coord[point] for point in points if point in by_coord]


def _read_cached_points(
    points: list[tuple[float, float]],
    model: str,
    hour: str,
    now: float,
    min_cached_at: float | None = None,
) -> tuple[list[GridWindPoint], list[tuple[float, float]]]:
    """Split points into cached results and coordinates that still need fetching.

    `min_cached_at` (SCRUM-113) also rejects rows older than a refresh's run clock, which is how
    one click refetches only the points the newest run obsoleted.

    One statement per request (SCRUM-174) instead of one per point: a full view used to
    run up to 900 SELECTs, which measured 5-6 ms per lookup. The rounded latitudes bound the
    scan, and the dict lookup keeps the caller's point order (and drops rows outside the box).
    """
    if not points:
        return [], []
    keys = {coord_key(lat, lon) for lat, lon in points}
    lat_keys = sorted({lat_key for lat_key, _ in keys})
    placeholders = ",".join("?" for _ in lat_keys)
    floor = "" if min_cached_at is None else " AND cached_at>=?"
    floor_values = () if min_cached_at is None else (min_cached_at,)
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT lat_key, lon_key, wind_speed_knots, wind_gust_knots, wind_direction_deg, "  # noqa: S608
            "temperature_f "
            "FROM grid_weather_cache "
            "WHERE model=? AND hour=? AND expires_at>? AND temperature_f IS NOT NULL "
            f"AND lat_key IN ({placeholders}){floor}",  # only generated placeholders, every value is bound
            (model, hour, now, *lat_keys, *floor_values),
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
                wind_gust_knots=row["wind_gust_knots"],
                wind_direction_deg=row["wind_direction_deg"],
                temperature_f=row["temperature_f"],
                time=None if hour == "current" else hour,
            )
        )
    return results, missing


def _store_series(series: dict[str, list[GridWindPoint]], model: str, now: float) -> None:
    """Write every hour of one fetched day in a single transaction (SCRUM-274).

    A forecast-hour request used to call the store once per hour, so one grid request paid 24
    connect/commit/close cycles and each of them could collide with a reader.

    A no-data point is not cached (SCRUM-225): a temporary upstream gap must not be served as calm
    wind for the whole TTL, and `_read_cached_points` only reads rows with a value.
    """
    rows = [
        (
            *coord_key(p.latitude, p.longitude),
            model,
            hour,
            now,
            now + CACHE_TTL_SECONDS,
            p.wind_speed_knots,
            p.wind_gust_knots,
            p.wind_direction_deg,
            p.temperature_f,
        )
        for hour, hour_points in series.items()
        for p in hour_points
        if p.wind_speed_knots is not None and p.temperature_f is not None
    ]
    if not rows:
        return
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO grid_weather_cache
                (lat_key, lon_key, model, hour, cached_at, expires_at,
                 wind_speed_knots, wind_gust_knots, wind_direction_deg, temperature_f)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, model, hour) DO UPDATE SET
                cached_at=excluded.cached_at,
                expires_at=excluded.expires_at,
                wind_speed_knots=excluded.wind_speed_knots,
                wind_gust_knots=excluded.wind_gust_knots,
                wind_direction_deg=excluded.wind_direction_deg,
                temperature_f=excluded.temperature_f
            """,
            rows,
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


def _grid_point(
    lat: float,
    lon: float,
    speed: float | None,
    gust: float | None,
    direction: float | None,
    temp_c: float | None,
    hour: str | None,
) -> GridWindPoint:
    """One grid point; a missing speed, direction or temperature makes it no data (SCRUM-225).

    All three go null together so nothing downstream can pair a real speed with a fabricated
    temperature, or draw a calm barb for a point the model has no value for.
    """
    has_data = speed is not None and direction is not None and temp_c is not None
    return GridWindPoint(
        latitude=lat,
        longitude=lon,
        wind_speed_knots=float(speed) if has_data else None,
        wind_gust_knots=as_optional_float(gust),
        wind_direction_deg=float(direction) if has_data else None,
        temperature_f=c_to_f(temp_c) if has_data else None,
        time=hour,
    )


def _point_from_current(lat: float, lon: float, item: dict, hour: str | None) -> GridWindPoint:
    current = item.get("current") or {}
    return _grid_point(
        lat,
        lon,
        current.get("wind_speed_10m"),
        current.get("wind_gusts_10m"),
        current.get("wind_direction_10m"),
        current.get("temperature_2m"),
        hour,
    )


def _point_from_hourly(lat: float, lon: float, item: dict, index: int, hour: str) -> GridWindPoint:
    hourly = item.get("hourly") or {}
    series = {name: hourly.get(name) or [] for name in GRID_VARIABLES}
    values = {name: series[name][index] if index < len(series[name]) else None for name in GRID_VARIABLES}
    return _grid_point(
        lat,
        lon,
        values["wind_speed_10m"],
        values["wind_gusts_10m"],
        values["wind_direction_10m"],
        values["temperature_2m"],
        hour,
    )


async def _covered_items(
    chunk: list[tuple[float, float]],
    params_for: Callable[[list[tuple[float, float]]], dict],
    budget: list[int],
) -> list[tuple[float, float, dict]]:
    """Items for the covered points of `chunk`, splitting a coverage 400 in half (SCRUM-231).

    Open-Meteo fails the whole batch with `No data is available for this location` when one
    point is outside a regional model's domain. Halving the chunk finds the covered points in
    `O(log n)` extra requests per boundary crossing and needs no projected polygon: the
    SCRUM-229 probe measured that the published RRFS grid box misclassifies island and edge
    points. A point that still answers the coverage 400 on its own is simply no data.

    `budget` is this chunk's request allowance (a one-item list, so the recursion can spend
    from it); an exhausted budget reports the rest as no data rather than failing the view.
    """
    if not chunk or budget[0] <= 0:
        return []
    budget[0] -= 1
    try:
        data = await open_meteo.get_json(
            OPEN_METEO_FORECAST_URL,
            params_for(chunk),
            timeout=OPEN_METEO_GRID_TIMEOUT_SECONDS,
        )
    except open_meteo.CoverageError:
        if len(chunk) == 1:
            return []
        middle = len(chunk) // 2
        left = await _covered_items(chunk[:middle], params_for, budget)
        right = await _covered_items(chunk[middle:], params_for, budget)
        return left + right
    items = _as_list(data, len(chunk))
    return [(lat, lon, item) for (lat, lon), item in zip(chunk, items, strict=True)]


async def _fetch_current(
    points: list[tuple[float, float]],
    model: str,
) -> list[GridWindPoint]:
    """Live values for the covered points, in chunked batched requests (SCRUM-192).

    A point outside a regional model's domain (RRFS) is absent from the result, not zeroed
    (SCRUM-231): the caller returns the covered points and the map leaves the rest blank.
    """
    fetched: list[GridWindPoint] = []
    for chunk in _chunks(points):

        def params_for(subset: list[tuple[float, float]]) -> dict:
            return {
                **_batch_params(subset, model),
                "current": ",".join(GRID_VARIABLES),
                "forecast_days": 1,
            }

        covered = await _covered_items(chunk, params_for, [COVERAGE_SPLIT_MAX_REQUESTS])
        fetched.extend(_point_from_current(lat, lon, item, None) for lat, lon, item in covered)
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

        def params_for(subset: list[tuple[float, float]]) -> dict:
            return {
                **_batch_params(subset, model),
                "hourly": ",".join(GRID_VARIABLES),
                "start_date": day,
                "end_date": day,
                "timezone": "UTC",
            }

        covered = await _covered_items(chunk, params_for, [COVERAGE_SPLIT_MAX_REQUESTS])
        if not covered:
            continue
        times = _series_times([item for _, _, item in covered])
        for stamp in times:
            series.setdefault(_series_hour(stamp), [])
        for lat, lon, item in covered:
            for index, stamp in enumerate(times):
                series_hour = _series_hour(stamp)
                series[series_hour].append(_point_from_hourly(lat, lon, item, index, series_hour))

    requested = hour_key(at)
    if requested not in series:
        if not series:
            # Every point was outside the model's domain: no data, not an upstream failure.
            return {requested: []}
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
