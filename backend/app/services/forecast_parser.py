"""Pure parsing of Open-Meteo forecast responses (SCRUM-92). No I/O, so it is tested
directly with plain dicts."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from backend.app.config import DEFAULT_TIMEZONE, FORECAST_POINTS, FORECAST_STEP_HOURS
from backend.app.models import WeatherForecastPoint
from backend.app.units import c_to_f, deg_to_cardinal, knots_to_units

# Variables requested for both `current` and `hourly`.
FORECAST_VARIABLES = (
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "weather_code",
    "wind_gusts_10m",
)


@dataclass(frozen=True)
class ParsedForecast:
    current: WeatherForecastPoint
    points: list[WeatherForecastPoint]
    # Hour `current` describes when one was requested (SCRUM-115); None means live values.
    valid_time: str | None = None


def build_weather_point(
    time_str: str,
    temp_c: float | None,
    humidity: float | None,
    wind_knots: float | None,
    wind_deg: float | None,
    weather_code: int | None,
    gust_knots: float | None = None,
) -> WeatherForecastPoint:
    """One forecast slice from Open-Meteo values (knots, °C). A missing value stays None
    (SCRUM-225), so no pop-up can show it as 0 kn or 32 °F."""
    wind = knots_to_units(wind_knots)
    gust = knots_to_units(gust_knots)
    wind_deg_val = None if wind_deg is None else round(float(wind_deg), 1)
    return WeatherForecastPoint(
        time=time_str,
        temperature_c=None if temp_c is None else round(float(temp_c), 1),
        temperature_f=c_to_f(temp_c),
        wind_speed_knots=wind["knots"],
        wind_speed_kmh=wind["kmh"],
        wind_speed_mph=wind["mph"],
        wind_speed_ms=wind["ms"],
        wind_gust_knots=gust["knots"],
        wind_gust_kmh=gust["kmh"],
        wind_gust_mph=gust["mph"],
        wind_gust_ms=gust["ms"],
        wind_direction_deg=wind_deg_val,
        wind_direction_cardinal=None if wind_deg_val is None else deg_to_cardinal(wind_deg_val),
        humidity=None if humidity is None else round(float(humidity), 1),
        weather_code=0 if weather_code is None else int(weather_code),
    )


def _point_from(values: Mapping[str, Any], time_str: str) -> WeatherForecastPoint:
    return build_weather_point(
        time_str=time_str,
        temp_c=values.get("temperature_2m"),
        humidity=values.get("relative_humidity_2m"),
        wind_knots=values.get("wind_speed_10m"),
        wind_deg=values.get("wind_direction_10m"),
        weather_code=values.get("weather_code"),
        gust_knots=values.get("wind_gusts_10m"),
    )


def _at(series: Sequence[Any] | None, idx: int) -> Any:
    """Value at idx, or None if the series is missing or too short."""
    return series[idx] if series is not None and idx < len(series) else None


def _start_index(hourly_times: Sequence[str], current_time: str) -> int:
    """Index of the current hour in the hourly series ("2026-11-12T12:15" → "…T12:00")."""
    if not current_time:
        return 0
    try:
        return list(hourly_times).index(current_time[:13] + ":00")
    except ValueError:
        return 0


def parse_forecast(
    raw: Mapping[str, Any],
    at: datetime | None = None,
    timezone: str = DEFAULT_TIMEZONE,
) -> ParsedForecast:
    """Turn an Open-Meteo response into one frame plus FORECAST_POINTS slices every
    FORECAST_STEP_HOURS.

    Without `at`, the frame is the `current` block and the slices start at the current hour;
    that matches the map grid barbs, which also use `current` (SCRUM-89). With `at` (SCRUM-115),
    the frame is that hour's value from the hourly series, in the requested timezone, and the
    slices start there. Raises ValueError when the response does not cover `at`.
    """
    hourly = raw.get("hourly") or {}
    times: Sequence[str] = hourly.get("time") or []

    if at is not None:
        wanted = at.astimezone(ZoneInfo(timezone)).strftime("%Y-%m-%dT%H:00")
        if wanted not in times:
            raise ValueError(f"Open-Meteo response has no hourly values for {wanted}")
        start = list(times).index(wanted)
        values = {name: _at(hourly.get(name), start) for name in FORECAST_VARIABLES}
        current = _point_from(values, wanted)
        valid_time: str | None = wanted
    else:
        current_values = raw.get("current") or {}
        current_time = current_values.get("time") or ""
        current = _point_from(current_values, current_time)
        start = _start_index(times, current_time)
        valid_time = None

    points: list[WeatherForecastPoint] = []
    for i in range(FORECAST_POINTS):
        idx = start + i * FORECAST_STEP_HOURS
        if idx >= len(times):
            break
        values = {name: _at(hourly.get(name), idx) for name in FORECAST_VARIABLES}
        points.append(_point_from(values, times[idx]))

    if at is not None:
        points[0] = current  # the requested hour is the first slice
    elif current_time:
        if points:
            points[0] = current
        else:
            points.append(current)
    # Without a current time there is nothing to anchor "now" to: keep the hourly slices.

    return ParsedForecast(current=current, points=points, valid_time=valid_time)
