"""Pure NDFD parsing (SCRUM-245 spike prototype): gridpoint periods → the app's 16 slices.

NDFD carries values as periods with ISO 8601 durations (`PT3H`, `P1DT6H`), not hourly instants.
Each slice takes the value of the period that contains its start instant, so a 6-hour period
simply repeats across two slices and nothing is averaged — measured durations at SEW on
2026-11-25 ran from 1 hour to 27 hours. A slice with no covering period keeps null values, which
the map already renders as "No data" (SCRUM-225).
"""

import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from backend.app.config import DEFAULT_TIMEZONE, FORECAST_POINTS, FORECAST_STEP_HOURS
from backend.app.services.forecast_parser import ParsedForecast, build_weather_point
from backend.app.services.model_info import floor_hour

KMH_PER_KNOT = 1.852
_DURATION = re.compile(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?")


def _duration(text: str) -> timedelta:
    match = _DURATION.fullmatch(text)
    if not match:
        raise ValueError(f"Unsupported NDFD duration {text!r}")
    days, hours, minutes = (int(part) if part else 0 for part in match.groups())
    return timedelta(days=days, hours=hours, minutes=minutes)


def _periods(grid: Mapping[str, Any], name: str) -> list[tuple[datetime, datetime, Any]]:
    """(start, end, value) for one grid, skipping the null entries NDFD leaves in place."""
    out: list[tuple[datetime, datetime, Any]] = []
    for item in (grid.get(name) or {}).get("values") or []:
        value = item.get("value")
        if value is None:
            continue
        start_text, _, duration_text = str(item["validTime"]).partition("/")
        start = datetime.fromisoformat(start_text).astimezone(UTC)
        out.append((start, start + _duration(duration_text), value))
    return out


def _sample(periods: Sequence[tuple[datetime, datetime, Any]], moment: datetime) -> Any:
    for start, end, value in periods:
        if start <= moment < end:
            return value
    return None


def _knots(speed_kmh: Any) -> float | None:
    return None if speed_kmh is None else float(speed_kmh) / KMH_PER_KNOT


def parse_nws_forecast(
    grid: Mapping[str, Any],
    at: datetime | None = None,
    timezone: str = DEFAULT_TIMEZONE,
    now: datetime | None = None,
) -> ParsedForecast:
    """Turn a `/gridpoints` document into one frame plus FORECAST_POINTS slices every 3 hours.

    `grid` is the whole GeoJSON document (or its `properties`, which is where the series live).
    Mirrors `forecast_parser.parse_forecast`: slice times are local wall-clock strings in the
    requested timezone, the frame is the first slice, and `valid_time` is set only when an hour
    was asked for. Units go in as NDFD serves them (km/h, °C, degrees) and come out as the app's
    knots and °C; `weather_code` is 0 because NDFD's weather grid is text and nothing displays a
    code (SCRUM-245).
    """
    start = floor_hour(at or now or datetime.now(UTC)).astimezone(UTC)
    zone = ZoneInfo(timezone)
    properties = grid.get("properties") or grid
    wind = _periods(properties, "windSpeed")
    gust = _periods(properties, "windGust")
    direction = _periods(properties, "windDirection")
    temperature = _periods(properties, "temperature")
    humidity = _periods(properties, "relativeHumidity")

    points = []
    for index in range(FORECAST_POINTS):
        moment = start + timedelta(hours=index * FORECAST_STEP_HOURS)
        points.append(
            build_weather_point(
                time_str=moment.astimezone(zone).strftime("%Y-%m-%dT%H:00"),
                temp_c=_sample(temperature, moment),
                humidity=_sample(humidity, moment),
                wind_knots=_knots(_sample(wind, moment)),
                wind_deg=_sample(direction, moment),
                weather_code=0,
                gust_knots=_knots(_sample(gust, moment)),
            )
        )
    return ParsedForecast(current=points[0], points=points, valid_time=points[0].time if at else None)
