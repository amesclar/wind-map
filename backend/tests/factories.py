"""Builders for Open-Meteo payloads, httpx responses and cache rows used by the tests."""

import copy
import time

import httpx

from backend.app.database import db_connection

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_FORECAST_PAYLOAD = {
    "current": {
        "time": "2026-11-12T12:00",
        "temperature_2m": 12.0,
        "relative_humidity_2m": 60,
        "wind_speed_10m": 15.0,
        "wind_direction_10m": 220,
        "weather_code": 1,
        "wind_gusts_10m": 22.0,
    },
    "hourly": {
        "time": [f"2026-11-{12 + i // 24:02d}T{i % 24:02d}:00" for i in range(96)],
        "temperature_2m": [12.0] * 96,
        "relative_humidity_2m": [60] * 96,
        "wind_speed_10m": [15.0] * 96,
        "wind_direction_10m": [220] * 96,
        "weather_code": [1] * 96,
        "wind_gusts_10m": [22.0] * 96,
    },
}


def forecast_payload(**current_overrides) -> dict:
    """A fresh Open-Meteo forecast response. Keyword args override `current` fields."""
    payload = copy.deepcopy(_FORECAST_PAYLOAD)
    payload["current"].update(current_overrides)
    return payload


def grid_item(
    speed: float = 10.0,
    direction: float = 180.0,
    temp_c: float = 10.0,
    gust: float | None = 18.0,
) -> dict:
    """One point of an Open-Meteo multi-point (grid) response; `gust=None` omits the gust."""
    current = {"wind_speed_10m": speed, "wind_direction_10m": direction, "temperature_2m": temp_c}
    if gust is not None:
        current["wind_gusts_10m"] = gust
    return {"current": current}


def grid_payload(*items: dict) -> dict | list:
    """Open-Meteo returns a plain object for one point and an array for several."""
    return items[0] if len(items) == 1 else list(items)


def _day_series(hour_iso: str, value: float, default: float) -> tuple[list[str], list[float]]:
    """Times for the UTC day of `hour_iso` with `value` at that hour and `default` elsewhere."""
    day = hour_iso[:10]
    times = [f"{day}T{hour:02d}:00" for hour in range(24)]
    values = [default] * 24
    values[int(hour_iso[11:13])] = value
    return times, values


def grid_hourly_item(
    hour_iso: str,
    speed: float = 10.0,
    direction: float = 180.0,
    temp_c: float = 10.0,
    gust: float = 20.0,
) -> dict:
    """One point of a grid response for a requested forecast hour (SCRUM-115)."""
    times, speeds = _day_series(hour_iso, speed, 1.0)
    _, gusts = _day_series(hour_iso, gust, 2.0)
    _, directions = _day_series(hour_iso, direction, 0.0)
    _, temps = _day_series(hour_iso, temp_c, 0.0)
    return {
        "hourly": {
            "time": times,
            "wind_speed_10m": speeds,
            "wind_gusts_10m": gusts,
            "wind_direction_10m": directions,
            "temperature_2m": temps,
        }
    }


def forecast_payload_for_hour(hour_iso: str, speed: float = 9.0) -> dict:
    """Forecast payload whose hourly series includes `hour_iso` (UTC wall clock)."""
    day = hour_iso[:10]
    times = [f"{day}T{hour:02d}:00" for hour in range(24)]
    speeds = [3.0] * 24
    speeds[int(hour_iso[11:13])] = speed
    payload = copy.deepcopy(_FORECAST_PAYLOAD)
    payload["hourly"] = {
        "time": times,
        "temperature_2m": [12.0] * 24,
        "relative_humidity_2m": [60] * 24,
        "wind_speed_10m": speeds,
        "wind_direction_10m": [220.0] * 24,
        "weather_code": [1] * 24,
        "wind_gusts_10m": [22.0] * 24,
    }
    return payload


def http_response(json, status: int = 200, url: str = FORECAST_URL) -> httpx.Response:
    return httpx.Response(status_code=status, json=json, request=httpx.Request("GET", url))


def upstream_error(msg: str = "secret-host.internal refused") -> httpx.ConnectError:
    return httpx.ConnectError(msg, request=httpx.Request("GET", FORECAST_URL))


def insert_grid_row(
    lat: float,
    lon: float,
    model: str = "best_match",
    speed: float = 7.0,
    direction: float = 90.0,
    temperature_f: float | None = 55.0,
    gust: float | None = 12.0,
    expires_in: float = 3600,
    hour: str = "current",
) -> None:
    """Seed grid_weather_cache. Negative `expires_in` = expired; `hour` keys forecast hours."""
    now = time.time()
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO grid_weather_cache "
            "(lat_key, lon_key, model, hour, cached_at, expires_at, wind_speed_knots, "
            "wind_gust_knots, wind_direction_deg, temperature_f) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            (lat, lon, model, hour, now, now + expires_in, speed, gust, direction, temperature_f),
        )
