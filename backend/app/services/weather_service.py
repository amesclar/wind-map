"""Weather service handling Open-Meteo API requests and 30-minute caching."""

import json
import time
from typing import Dict, Any, List
import httpx
from backend.app.config import OPEN_METEO_FORECAST_URL, CACHE_TTL_SECONDS
from backend.app.database import get_db_connection
from backend.app.models import WeatherForecastPoint, WeatherForecastResponse

CARDINALS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]


def deg_to_cardinal(deg: float) -> str:
    idx = int((deg + 11.25) / 22.5) % 16
    return CARDINALS[idx]


def build_weather_point(
    time_str: str,
    temp_c: float,
    humidity: float,
    wind_knots: float,
    wind_deg: float,
    weather_code: int,
    gust_knots: float = 0.0,
) -> WeatherForecastPoint:
    temp_f = round(temp_c * 9.0 / 5.0 + 32.0, 1)
    wind_kmh = round(wind_knots * 1.852, 1)
    wind_mph = round(wind_knots * 1.15078, 1)
    wind_ms = round(wind_knots * 0.514444, 1)
    gust_kmh = round(gust_knots * 1.852, 1)
    gust_mph = round(gust_knots * 1.15078, 1)
    gust_ms = round(gust_knots * 0.514444, 1)

    return WeatherForecastPoint(
        time=time_str,
        temperature_c=round(temp_c, 1),
        temperature_f=temp_f,
        wind_speed_knots=round(wind_knots, 1),
        wind_speed_kmh=wind_kmh,
        wind_speed_mph=wind_mph,
        wind_speed_ms=wind_ms,
        wind_gust_knots=round(gust_knots, 1),
        wind_gust_kmh=gust_kmh,
        wind_gust_mph=gust_mph,
        wind_gust_ms=gust_ms,
        wind_direction_deg=round(wind_deg, 1),
        wind_direction_cardinal=deg_to_cardinal(wind_deg),
        humidity=round(humidity, 1),
        weather_code=weather_code,
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
    conn = get_db_connection()
    cursor = conn.cursor()

    # Check cache
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
        conn.close()
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
        time_str=curr.get("time", ""),
        temp_c=curr.get("temperature_2m", 0.0),
        humidity=curr.get("relative_humidity_2m", 0.0),
        wind_knots=curr.get("wind_speed_10m", 0.0),
        wind_deg=curr.get("wind_direction_10m", 0.0),
        weather_code=curr.get("weather_code", 0),
        gust_knots=curr.get("wind_gusts_10m", 0.0),
    )

    # Parse 16 points starting from now every 3 hours
    hourly = raw_data.get("hourly", {})
    hourly_times: List[str] = hourly.get("time", [])
    hourly_temps: List[float] = hourly.get("temperature_2m", [])
    hourly_humidity: List[float] = hourly.get("relative_humidity_2m", [])
    hourly_winds: List[float] = hourly.get("wind_speed_10m", [])
    hourly_wind_dirs: List[float] = hourly.get("wind_direction_10m", [])
    hourly_codes: List[int] = hourly.get("weather_code", [])
    hourly_gusts: List[float] = hourly.get("wind_gusts_10m", [])

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
                    temp_c=hourly_temps[idx],
                    humidity=hourly_humidity[idx],
                    wind_knots=hourly_winds[idx],
                    wind_deg=hourly_wind_dirs[idx],
                    weather_code=hourly_codes[idx],
                    gust_knots=hourly_gusts[idx] if idx < len(hourly_gusts) else 0.0,
                )
            )

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
    cursor.execute(
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
    conn.commit()
    conn.close()

    return WeatherForecastResponse(
        **result_dict,
        cached=False,
        cached_at=now,
    )

