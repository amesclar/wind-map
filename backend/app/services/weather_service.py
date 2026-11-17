"""Weather service handling Open-Meteo API requests and 30-minute caching."""

import json
import time
from typing import Dict, Any, List
import httpx
from backend.app.config import OPEN_METEO_FORECAST_URL, CACHE_TTL_SECONDS
from backend.app.database import db_connection
from backend.app.models import WeatherForecastPoint, WeatherForecastResponse

CARDINALS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]


# Round point coordinates to 2 decimals (~1.1 km) for cache keys.
POINT_CACHE_PRECISION = 2

POINT_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS point_weather_cache (
    lat_key      REAL NOT NULL,
    lon_key      REAL NOT NULL,
    model        TEXT NOT NULL,
    cached_at    REAL NOT NULL,
    expires_at   REAL NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (lat_key, lon_key, model)
);
"""


def _point_cache_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, POINT_CACHE_PRECISION), round(lon, POINT_CACHE_PRECISION))


def deg_to_cardinal(deg: float) -> str:
    idx = int((deg + 11.25) / 22.5) % 16
    return CARDINALS[idx]


def build_weather_point(
    time_str: str,
    temp_c: float | None,
    humidity: float | None,
    wind_knots: float | None,
    wind_deg: float | None,
    weather_code: int | None,
    gust_knots: float | None = 0.0,
) -> WeatherForecastPoint:
    temp_c_val = 0.0 if temp_c is None else float(temp_c)
    humidity_val = 0.0 if humidity is None else float(humidity)
    wind_knots_val = 0.0 if wind_knots is None else float(wind_knots)
    wind_deg_val = 0.0 if wind_deg is None else float(wind_deg)
    weather_code_val = 0 if weather_code is None else int(weather_code)
    gust_knots_val = 0.0 if gust_knots is None else float(gust_knots)

    temp_f = round(temp_c_val * 9.0 / 5.0 + 32.0, 1)
    wind_kmh = round(wind_knots_val * 1.852, 1)
    wind_mph = round(wind_knots_val * 1.15078, 1)
    wind_ms = round(wind_knots_val * 0.514444, 1)
    gust_kmh = round(gust_knots_val * 1.852, 1)
    gust_mph = round(gust_knots_val * 1.15078, 1)
    gust_ms = round(gust_knots_val * 0.514444, 1)

    return WeatherForecastPoint(
        time=time_str,
        temperature_c=round(temp_c_val, 1),
        temperature_f=temp_f,
        wind_speed_knots=round(wind_knots_val, 1),
        wind_speed_kmh=wind_kmh,
        wind_speed_mph=wind_mph,
        wind_speed_ms=wind_ms,
        wind_gust_knots=round(gust_knots_val, 1),
        wind_gust_kmh=gust_kmh,
        wind_gust_mph=gust_mph,
        wind_gust_ms=gust_ms,
        wind_direction_deg=round(wind_deg_val, 1),
        wind_direction_cardinal=deg_to_cardinal(wind_deg_val),
        humidity=round(humidity_val, 1),
        weather_code=weather_code_val,
    )


async def get_weather(
    location_id: int,
    location_name: str,
    latitude: float,
    longitude: float,
    model: str = "best_match",
    timezone: str = "America/Los_Angeles",
) -> WeatherForecastResponse:
    now = time.time()

    # Ad-hoc map points (location_id == 0) are cached by coordinates; saved
    # locations keep using weather_cache keyed by (location_id, model).
    is_point = location_id == 0
    lat_key, lon_key = _point_cache_key(latitude, longitude)

    # Short-lived connection for the cache read; no connection is held during the HTTP call.
    with db_connection() as conn:
        cursor = conn.cursor()
        if is_point:
            cursor.execute(POINT_CACHE_DDL)
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
    params: Dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,wind_gusts_10m",
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,wind_gusts_10m",
        "wind_speed_unit": "kn",
        "timezone": timezone,
        "forecast_days": 4,
    }

    if model and model != "best_match":
        params["models"] = model

    transport = httpx.AsyncHTTPTransport(retries=2)
    async with httpx.AsyncClient(transport=transport, timeout=15.0) as client:
        resp = await client.get(OPEN_METEO_FORECAST_URL, params=params)
        resp.raise_for_status()
        raw_data = resp.json()

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

    # Parse 16 points starting from now every 3 hours
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
    for i in range(16):
        idx = start_idx + (i * 3)
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

