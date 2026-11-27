"""Shared marine-grid cache for the current and wave services (SCRUM-276).

`currents_service` and `waves_service` are the same module twice: the same batched Open-Meteo
request, the same (rounded lat, lon, hour) cache, the same per-UTC-day fetch, the same "one row per
requested point, empty rows for land" write. The two copies drifted, because a cache-key, SQL or
chunking change had to be made twice.

This module owns that machinery, parameterised by a `MarineSpec`: the cache table, the Open-Meteo
variables, the value columns and the extra request parameters. Each layer keeps only what is
genuinely its own — the value dataclass it parses, and its land test (`_drop_land` for the
elevation check on currents, `_drop_snapped`/`_drop_on_land` for waves).
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from backend.app.config import CACHE_TTL_SECONDS, OPEN_METEO_MARINE_TIMEOUT_SECONDS, OPEN_METEO_MARINE_URL
from backend.app.database import db_connection
from backend.app.services import open_meteo
from backend.app.units import coord_key

# cell_lat/cell_lon are stored with every row: the value belongs to the model cell, not to the
# request (SCRUM-238).
CELL_COLUMNS = ("cell_lat", "cell_lon")


@dataclass(frozen=True)
class MarineSpec:
    """What one layer stores and asks for, so the rest can be shared."""

    table: str
    variables: tuple[str, ...]
    # Cache columns that carry the value, in the order the unpack callable returns them.
    value_columns: tuple[str, ...]
    # Extra request parameters, e.g. the unit conversion the currents request relies on.
    params: dict[str, Any] | None = None
    # Name this layer's calls in the usage log (SCRUM-327): both layers share the marine URL.
    label: str = "marine"

    @property
    def value_columns_sql(self) -> str:
        return ", ".join(self.value_columns)


def _placeholders(count: int) -> str:
    return ",".join("?" for _ in range(count))


def read_points[V](
    spec: MarineSpec,
    points: list[tuple[float, float]],
    hour: str,
    now: float,
    parse: Callable[[sqlite3.Row], V | None],
) -> dict[tuple[float, float], V | None]:
    """Cached values for the requested points at `hour`; empty rows mean "checked, no value"."""
    keys = {coord_key(lat, lon) for lat, lon in points}
    lat_keys = sorted({lat_key for lat_key, _ in keys})
    placeholders = _placeholders(len(lat_keys))
    with db_connection() as conn:
        rows = conn.execute(
            f"SELECT lat_key, lon_key, {spec.value_columns_sql}, cell_lat, cell_lon "  # noqa: S608
            f"FROM {spec.table} "
            f"WHERE hour=? AND expires_at>? AND lat_key IN ({placeholders})",
            (hour, now, *lat_keys),
        ).fetchall()
    return {(row["lat_key"], row["lon_key"]): parse(row) for row in rows}


def read_series[V](
    spec: MarineSpec,
    lat: float,
    lon: float,
    hours: list[str],
    now: float,
    parse: Callable[[sqlite3.Row], V | None],
) -> dict[str, V | None]:
    """Cached values for one point at the requested hours."""
    if not hours:
        return {}
    lat_key, lon_key = coord_key(lat, lon)
    placeholders = _placeholders(len(hours))
    with db_connection() as conn:
        rows = conn.execute(
            f"SELECT hour, lat_key, lon_key, {spec.value_columns_sql}, cell_lat, cell_lon "  # noqa: S608
            f"FROM {spec.table} "
            f"WHERE lat_key=? AND lon_key=? AND hour IN ({placeholders}) AND expires_at>?",
            (lat_key, lon_key, *hours, now),
        ).fetchall()
    return {row["hour"]: parse(row) for row in rows}


def store[V](
    spec: MarineSpec,
    points: list[tuple[float, float]],
    values: list[V | None],
    hour: str,
    now: float,
    unpack: Callable[[V | None], tuple[Any, ...]],
) -> None:
    """Write one row per point, empty rows included: inland is not refetched on every pan."""
    expires_at = now + CACHE_TTL_SECONDS
    rows = []
    for (lat, lon), value in zip(points, values, strict=True):
        lat_key, lon_key = coord_key(lat, lon)
        rows.append((lat_key, lon_key, hour, now, expires_at, *unpack(value)))
    columns = ", ".join(["lat_key", "lon_key", "hour", "cached_at", "expires_at", *spec.value_columns, *CELL_COLUMNS])
    touched = ("cached_at", "expires_at", *spec.value_columns, *CELL_COLUMNS)
    updates = ", ".join(f"{column}=excluded.{column}" for column in touched)
    with db_connection() as conn:
        conn.executemany(
            f"""
            INSERT INTO {spec.table} ({columns})
            VALUES ({_placeholders(len(spec.value_columns) + 5 + len(CELL_COLUMNS))})
            ON CONFLICT(lat_key, lon_key, hour) DO UPDATE SET {updates}
            """,  # noqa: S608 - table and columns come from the module-level spec, never a request
            rows,
        )


def batch_params(spec: MarineSpec, points: list[tuple[float, float]]) -> dict[str, Any]:
    """The marine API accepts comma-separated lat/lon arrays, like the forecast API."""
    return {
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
        **(spec.params or {}),
    }


def as_list(data: object, expected: int) -> list[dict]:
    """Open-Meteo returns an object for one point and an array for several."""
    items = [data] if isinstance(data, dict) else list(data)  # type: ignore[arg-type]
    if len(items) != expected:
        # Treated as an upstream failure (502), not silently truncated.
        raise httpx.HTTPError(f"Open-Meteo returned {len(items)} marine points for {expected} requested")
    return items  # type: ignore[return-value]


def cell(item: dict, fallback: tuple[float, float]) -> tuple[float, float]:
    """The model cell Open-Meteo answered with; the request is the fallback if it omits it."""
    lat = item.get("latitude")
    lon = item.get("longitude")
    if lat is None or lon is None:
        return fallback
    return (float(lat), float(lon))


def series_times(items: list[dict]) -> list[str]:
    """The shared hourly time axis; every point in one response uses the same one."""
    times = (items[0].get("hourly") or {}).get("time") or []
    if not times:
        raise httpx.HTTPError("Open-Meteo marine response did not include hourly times")
    return times


def series_hour(stamp: str) -> str:
    """Normalise an Open-Meteo hourly stamp to the cache's hour key."""
    return f"{stamp[:13]}:00" if len(stamp) >= 13 else stamp


async def fetch_current[V](
    spec: MarineSpec,
    points: list[tuple[float, float]],
    parse: Callable[[dict, tuple[float, float]], V | None],
) -> list[V | None]:
    """One batched request for every point's live values."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            **batch_params(spec, points),
            "current": ",".join(spec.variables),
            "forecast_days": 1,
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
        label=spec.label,
    )
    items = as_list(data, len(points))
    return [parse(item.get("current") or {}, cell(item, point)) for item, point in zip(items, points, strict=True)]


async def fetch_hourly[V](
    spec: MarineSpec,
    points: list[tuple[float, float]],
    start: datetime,
    end: datetime,
    parse: Callable[[dict, int, tuple[float, float]], V | None],
) -> dict[str, list[V | None]]:
    """One request for [start, end]'s UTC days, parsed into a value list per hour."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            **batch_params(spec, points),
            "hourly": ",".join(spec.variables),
            "start_date": start.astimezone(UTC).strftime("%Y-%m-%d"),
            "end_date": end.astimezone(UTC).strftime("%Y-%m-%d"),
            "timezone": "UTC",
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
        label=spec.label,
    )
    items = as_list(data, len(points))
    cells = [cell(item, point) for item, point in zip(items, points, strict=True)]
    series: dict[str, list[V | None]] = {}
    for index, stamp in enumerate(series_times(items)):
        series[series_hour(stamp)] = [
            parse(item.get("hourly") or {}, index, cell_) for item, cell_ in zip(items, cells, strict=True)
        ]
    return series
