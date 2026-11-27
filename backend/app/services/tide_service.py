"""Tide service (SCRUM-195): sea level at one point with the nearest high and low.

Values come from Open-Meteo's Marine API (`sea_level_height_msl`, MeteoFrance SMOC): hourly,
about 8 km, 10 days, updated once a day. The value is sea level *including tides* referred to
global mean sea level, not a chart datum, and Open-Meteo calls it unsuitable for navigation, so
responses name the datum and the pop-up repeats the caveat.

A pop-up needs the selected hour plus the nearest high and low around it, so the previous,
selected and following UTC day are read and every hour of that window is cached. Only the days
that are actually missing are fetched (SCRUM-286), and a cold point still costs one request
because its three missing days form one contiguous range. Extremes
are found by neighbour comparison (which also says high or low unambiguously) and refined with a
three-point parabola, which turns hourly samples into a time to the minute and a peak height.
"""

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from backend.app.config import (
    CACHE_TTL_SECONDS,
    LAND_ELEVATION_THRESHOLD_M,
    OPEN_METEO_ELEVATION_TIMEOUT_SECONDS,
    OPEN_METEO_ELEVATION_URL,
    OPEN_METEO_MARINE_TIMEOUT_SECONDS,
    OPEN_METEO_MARINE_URL,
)
from backend.app.database import db_connection
from backend.app.models import TideExtreme, TidePointResponse, TideSample
from backend.app.services import open_meteo
from backend.app.services.model_info import floor_hour
from backend.app.services.time_window import hour_key
from backend.app.units import coord_key

logger = logging.getLogger(__name__)

TIDE_VARIABLE = "sea_level_height_msl"
DATUM = "msl"


@dataclass(frozen=True)
class Height:
    """One hourly sample."""

    moment: datetime
    height_m: float


def _stamp(moment: datetime) -> str:
    """UTC minute stamp, e.g. `2026-11-25T15:38` (the frontend reads it as UTC)."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M")


def _parse(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y-%m-%dT%H:%M").replace(tzinfo=UTC)


def _window_start(moment: datetime) -> datetime:
    """Midnight UTC of the day before the selected hour."""
    day = moment.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=1)


def window_hours(moment: datetime) -> list[str]:
    """Cache hours covering the previous, selected and following UTC day."""
    start = _window_start(moment)
    return [hour_key(start + timedelta(hours=step)) for step in range(72)]


async def _on_land(lat: float, lon: float) -> bool:
    """True when the point itself sits above sea level (SCRUM-317).

    The Marine model snaps a shore request to its nearest sea cell — 48.24, -122.74 comes back as
    a cell about 4 km offshore — so a terrestrial point would otherwise inherit that cell's
    tide. Elevation is the same land test the currents use (SCRUM-238). A failed lookup is not a
    verdict: the tide is kept, because hiding real water is worse than a rare value on land.
    """
    try:
        data = await open_meteo.get_json(
            OPEN_METEO_ELEVATION_URL,
            {"latitude": lat, "longitude": lon},
            timeout=OPEN_METEO_ELEVATION_TIMEOUT_SECONDS,
            label="tide",
        )
    except httpx.HTTPError as exc:
        logger.warning("Elevation lookup failed; keeping the tide: %s", exc)
        return False
    values = data.get("elevation") if isinstance(data, dict) else None
    elevation = values[0] if isinstance(values, list) and values else values
    if not isinstance(elevation, (int, float)):
        logger.warning("Elevation lookup returned an unexpected payload; keeping the tide")
        return False
    return float(elevation) > LAND_ELEVATION_THRESHOLD_M


async def get_point_tide(lat: float, lon: float, at: datetime | None = None) -> TidePointResponse:
    """Sea level around `at` (or now) with the nearest high and low on either side."""
    moment = (at or floor_hour(datetime.now(UTC))).astimezone(UTC)
    hours = window_hours(moment)
    cached = _read_window(lat, lon, hours)
    missing = [hour for hour in hours if hour not in cached]
    if missing:
        if await _on_land(lat, lon):
            # The empty rows a null height already means double as the cached land verdict, so the
            # point costs one elevation lookup per TTL and never a marine request.
            _store(lat, lon, dict.fromkeys(missing), time.time())
        else:
            cached = {**cached, **await _fetch_missing(lat, lon, missing)}

    samples = [Height(_parse(hour), height) for hour in hours if (height := cached.get(hour)) is not None]
    last, following, after = derive_extremes(samples, moment)
    return TidePointResponse(
        latitude=lat,
        longitude=lon,
        datum=DATUM,
        unit="m",
        hour=hour_key(moment),
        points=[TideSample(time=_stamp(sample.moment), height_m=round(sample.height_m, 3)) for sample in samples],
        last_extreme=last,
        next_extreme=following,
        next_extreme_after=after,
    )


def _refine(previous: Height, current: Height, following: Height, kind: str) -> TideExtreme:
    """Parabolic refinement of one extreme: time to the minute and a corrected height."""
    denominator = previous.height_m - 2 * current.height_m + following.height_m
    offset_hours = 0.0
    height = current.height_m
    if denominator != 0:
        offset_hours = 0.5 * (previous.height_m - following.height_m) / denominator
        offset_hours = max(-1.0, min(1.0, offset_hours))
        height = current.height_m - 0.25 * (previous.height_m - following.height_m) * offset_hours
    peak = current.moment + timedelta(hours=offset_hours)
    peak = (peak + timedelta(seconds=30)).replace(second=0, microsecond=0)
    return TideExtreme(type=kind, time=_stamp(peak), height_m=round(height, 3))


def derive_extremes(
    samples: list[Height], moment: datetime
) -> tuple[TideExtreme | None, TideExtreme | None, TideExtreme | None]:
    """Nearest high/low at or before `moment`, and the first two after it.

    A sample above both neighbours is a high and one below both is a low, so a flat or
    single-slope stretch never invents an extreme and the series edges are not extrapolated.
    """
    extremes: list[TideExtreme] = []
    for index in range(1, len(samples) - 1):
        previous, current, following = samples[index - 1], samples[index], samples[index + 1]
        if current.height_m > previous.height_m and current.height_m >= following.height_m:
            extremes.append(_refine(previous, current, following, "high"))
        elif current.height_m < previous.height_m and current.height_m <= following.height_m:
            extremes.append(_refine(previous, current, following, "low"))

    last = next((extreme for extreme in reversed(extremes) if _parse(extreme.time) <= moment), None)
    upcoming = [extreme for extreme in extremes if _parse(extreme.time) > moment]
    following = upcoming[0] if upcoming else None
    after = upcoming[1] if len(upcoming) > 1 else None
    return last, following, after


def _read_window(lat: float, lon: float, hours: list[str]) -> dict[str, float | None]:
    """Cached heights for the window; a NULL row means "checked, no water here"."""
    lat_key, lon_key = coord_key(lat, lon)
    placeholders = ",".join("?" for _ in hours)
    with db_connection() as conn:
        rows = conn.execute(
            f"SELECT hour, height_m FROM tide_point_cache "  # noqa: S608
            f"WHERE lat_key=? AND lon_key=? AND hour IN ({placeholders}) AND expires_at>?",
            (lat_key, lon_key, *hours, time.time()),
        ).fetchall()
    return {row["hour"]: row["height_m"] for row in rows}


def _store(lat: float, lon: float, values: dict[str, float | None], now: float) -> None:
    """Write every hour of the fetched window, empty rows included (inland is not refetched)."""
    lat_key, lon_key = coord_key(lat, lon)
    rows = [(lat_key, lon_key, hour, now, now + CACHE_TTL_SECONDS, height) for hour, height in values.items()]
    with db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO tide_point_cache (lat_key, lon_key, hour, cached_at, expires_at, height_m)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(lat_key, lon_key, hour) DO UPDATE SET
                cached_at=excluded.cached_at,
                expires_at=excluded.expires_at,
                height_m=excluded.height_m
            """,
            rows,
        )


def _missing_ranges(missing: list[str]) -> list[tuple[datetime, datetime]]:
    """The UTC days that own the missing hours, grouped into contiguous ranges.

    Grouping keeps a cold point at one request: its three missing days are one range (SCRUM-286).
    """
    days = sorted({_parse(hour).replace(hour=0, minute=0) for hour in missing})
    ranges: list[tuple[datetime, datetime]] = []
    for day in days:
        if ranges and ranges[-1][1] + timedelta(days=1) == day:
            ranges[-1] = (ranges[-1][0], day)
        else:
            ranges.append((day, day))
    return ranges


async def _fetch_missing(lat: float, lon: float, missing: list[str]) -> dict[str, float | None]:
    """Fetch and cache only the days that have missing hours, not the whole window.

    One expired row used to re-request all three days and rewrite all 72 rows; the currents and
    waves services already fetch only the UTC days they lack (SCRUM-286).
    """
    values: dict[str, float | None] = {}
    for start, end in _missing_ranges(missing):
        values.update(await _fetch_window(lat, lon, start, end))
    return values


async def _fetch_window(lat: float, lon: float, start: datetime, end: datetime) -> dict[str, float | None]:
    """One marine request for the given UTC days, cached per hour."""
    data = await open_meteo.get_json(
        OPEN_METEO_MARINE_URL,
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": TIDE_VARIABLE,
            "timezone": "UTC",
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
        },
        timeout=OPEN_METEO_MARINE_TIMEOUT_SECONDS,
        label="tide",
    )
    item = data[0] if isinstance(data, list) else data
    hourly = item.get("hourly") or {}
    times = hourly.get("time") or []
    heights = hourly.get(TIDE_VARIABLE) or []
    if not times:
        raise httpx.HTTPError("Open-Meteo marine response did not include hourly times")

    values = {
        hour_key(_parse(stamp)): (None if index >= len(heights) or heights[index] is None else float(heights[index]))
        for index, stamp in enumerate(times)
    }
    _store(lat, lon, values, time.time())
    return values
