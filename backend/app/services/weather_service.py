"""Weather service: Open-Meteo forecasts with 30-minute caching (CACHE_TTL_SECONDS)."""

import json
import time
from typing import List

from backend.app.config import (
    CACHE_TTL_SECONDS,
    DEFAULT_MODEL,
    DEFAULT_TIMEZONE,
    FORECAST_DAYS,
    FORECAST_POINTS,
    FORECAST_STEP_HOURS,
    OPEN_METEO_FORECAST_URL,
)
from backend.app.database import db_connection
from backend.app.models import WeatherForecastPoint, WeatherForecastResponse
from backend.app.services import open_meteo
from backend.app.units import as_float, c_to_f, coord_key, deg_to_cardinal, knots_to_units

__all__ = ["build_weather_point", "deg_to_cardinal", "get_weather"]

FORECAST_VARIABLES = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,wind_gusts_10m"
)


def build_weather_point(
    time_str: str,
    temp_c: float | None,
    humidity: float | None,
    wind_knots: float | None,
    wind_deg: float | None,
    weather_code: int | None,
    gust_knots: float | None = None,
) -> WeatherForecastPoint:
    wind = knots_to_units(wind_knots)
    gust = knots_to_units(gust_knots)
    wind_deg_val = as_float(wind_deg)
    return WeatherForecastPoint(
        time=time_str,
        temperature_c=round(as_float(temp_c), 1),
        temperature_f=c_to_f(temp_c),
        wind_speed_knots=wind["knots"],
        wind_speed_kmh=wind["kmh"],
        wind_speed_mph=wind["mph"],
        wind_speed_ms=wind["ms"],
        wind_gust_knots=gust["knots"],
        wind_gust_kmh=gust["kmh"],
        wind_gust_mph=gust["mph"],
        wind_gust_ms=gust["ms"],
        wind_direction_deg=round(wind_deg_val, 1),
        wind_direction_cardinal=deg_to_cardinal(wind_deg_val),
        humidity=round(as_float(humidity), 1),
        weather_code=0 if weather_code is None else int(weather_code),
    )


async def get_weather(
    location_id: int,
    location_name: str,
    latitude: float,
    longitude: float,
    model: str = DEFAULT_MODEL,
    timezone: str = DEFAULT_TIMEZONE,
) -> WeatherForecastResponse:
    now = time.time()

    # Ad-hoc map points (location_id == 0) are cached by coordinates; saved
    # locations keep using weather_cache keyed by (location_id, model).
    is_point = location_id == 0
    lat_key, lon_key = coord_key(latitude, longitude)

    # Short-lived connection for the cache read; no connection is held during the HTTP call.
    with db_connection() as conn:
        cursor = conn.cursor()
        if is_point:
            cursor.execute(
                """
                SELECT payload_json, cached_at, expires_at
                FROM point_weather_cache
                WHERE lat_key = ? AND lon_key = ? AND model = ?;
                """,
                (lat_key, lon_key, model),
            )
        else:
            cursor.execute(
                """
                SELECT payload_json, cached_at, expires_at
                FROM weather_cache
                WHERE location_id = ? AND model = ?;
                """,
                (location_id, model),
            )
        row = cursor.fetchone()

    if row and row["expires_at"] > now:
        cached_data = json.loads(row["payload_json"])
        if is_point:
            cached_data["location_name"] = location_name
            cached_data["latitude"] = latitude
            cached_data["longitude"] = longitude
        return WeatherForecastResponse(
            **cached_data,
            cached=True,
            cached_at=row["cached_at"],
        )

    # Fetch from Open-Meteo API
    params = {
        **open_meteo.forecast_params(model),
        "latitude": latitude,
        "longitude": longitude,
        "hourly": FORECAST_VARIABLES,
        "current": FORECAST_VARIABLES,
        "timezone": timezone,
        "forecast_days": FORECAST_DAYS,
    }
    raw_data = await open_meteo.get_json(OPEN_METEO_FORECAST_URL, params)

    # Parse current point
    curr = raw_data.get("current", {})
    current_point = build_weather_point(
        time_str=curr.get("time", "") or "",
        temp_c=curr.get("temperature_2m"),
        humidity=curr.get("relative_humidity_2m"),
        wind_knots=curr.get("wind_speed_10m"),
        wind_deg=curr.get("wind_direction_10m"),
        weather_code=curr.get("weather_code"),
        gust_knots=curr.get("wind_gusts_10m"),
    )

    # FORECAST_POINTS slices starting at the current hour, every FORECAST_STEP_HOURS
    hourly = raw_data.get("hourly", {})
    hourly_times: List[str] = hourly.get("time", []) or []
    hourly_temps: List[float] = hourly.get("temperature_2m", []) or []
    hourly_humidity: List[float] = hourly.get("relative_humidity_2m", []) or []
    hourly_winds: List[float] = hourly.get("wind_speed_10m", []) or []
    hourly_wind_dirs: List[float] = hourly.get("wind_direction_10m", []) or []
    hourly_codes: List[int] = hourly.get("weather_code", []) or []
    hourly_gusts: List[float] = hourly.get("wind_gusts_10m", []) or []

    current_hour_str = (curr.get("time", "")[:13] + ":00") if curr.get("time") else ""
    try:
        start_idx = hourly_times.index(current_hour_str)
    except ValueError:
        start_idx = 0

    forecast_points: List[WeatherForecastPoint] = []
    for i in range(FORECAST_POINTS):
        idx = start_idx + (i * FORECAST_STEP_HOURS)
        if idx < len(hourly_times):
            forecast_points.append(
                build_weather_point(
                    time_str=hourly_times[idx],
                    temp_c=hourly_temps[idx] if idx < len(hourly_temps) else 0.0,
                    humidity=hourly_humidity[idx] if idx < len(hourly_humidity) else 0.0,
                    wind_knots=hourly_winds[idx] if idx < len(hourly_winds) else 0.0,
                    wind_deg=hourly_wind_dirs[idx] if idx < len(hourly_wind_dirs) else 0.0,
                    weather_code=hourly_codes[idx] if idx < len(hourly_codes) else 0,
                    gust_knots=hourly_gusts[idx] if idx < len(hourly_gusts) else 0.0,
                )
            )

    # SCRUM-89: the first ("Now") slice uses current conditions so it matches the
    # map grid barbs, which are also drawn from Open-Meteo "current" values.
    if curr.get("time"):
        if forecast_points:
            forecast_points[0] = current_point
        else:
            forecast_points.append(current_point)

    result_dict = {
        "location_id": location_id,
        "location_name": location_name,
        "latitude": latitude,
        "longitude": longitude,
        "model": model,
        "timezone": timezone,
        "current": current_point.model_dump(),
        "forecast": [p.model_dump() for p in forecast_points],
    }

    # Store in cache
    expires_at = now + CACHE_TTL_SECONDS
    with db_connection() as conn:
        if is_point:
            conn.execute(
                """
                INSERT INTO point_weather_cache (lat_key, lon_key, model, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(lat_key, lon_key, model) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (lat_key, lon_key, model, now, expires_at, json.dumps(result_dict)),
            )
        else:
            conn.execute(
                """
                INSERT INTO weather_cache (location_id, model, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(location_id, model) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (location_id, model, now, expires_at, json.dumps(result_dict)),
            )

    return WeatherForecastResponse(
        **result_dict,
        cached=False,
        cached_at=now,
    )

