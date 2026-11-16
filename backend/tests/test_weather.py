"""Weather service and caching tests."""

import os
import pytest
import time
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "./data/test_wind_map.db"
os.environ["DATA_DIR"] = "./data"

from unittest.mock import patch
import httpx
from backend.app.database import init_db, get_db_connection
from backend.app.main import app
from backend.app.services.weather_service import deg_to_cardinal, build_weather_point

MOCK_RAW_RESPONSE = {
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
        "time": [f"2026-11-{12 + i//24:02d}T{i%24:02d}:00" for i in range(96)],
        "temperature_2m": [12.0] * 96,
        "relative_humidity_2m": [60] * 96,
        "wind_speed_10m": [15.0] * 96,
        "wind_direction_10m": [220] * 96,
        "weather_code": [1] * 96,
        "wind_gusts_10m": [22.0] * 96,
    },
}


@pytest.fixture(autouse=True)
def setup_test_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS weather_cache;")
    cursor.execute("DROP TABLE IF EXISTS point_weather_cache;")
    cursor.execute("DROP TABLE IF EXISTS locations;")
    conn.commit()
    conn.close()
    init_db()
    yield
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS weather_cache;")
    cursor.execute("DROP TABLE IF EXISTS point_weather_cache;")
    cursor.execute("DROP TABLE IF EXISTS locations;")
    conn.commit()
    conn.close()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_deg_to_cardinal():
    assert deg_to_cardinal(0) == "N"
    assert deg_to_cardinal(360) == "N"
    assert deg_to_cardinal(90) == "E"
    assert deg_to_cardinal(180) == "S"
    assert deg_to_cardinal(270) == "W"
    assert deg_to_cardinal(45) == "NE"
    assert deg_to_cardinal(225) == "SW"


def test_build_weather_point():
    pt = build_weather_point(
        time_str="2026-11-12T12:00",
        temp_c=10.0,
        humidity=75.0,
        wind_knots=10.0,
        wind_deg=180.0,
        weather_code=3,
        gust_knots=22.0,
    )
    assert pt.temperature_c == 10.0
    assert pt.temperature_f == 50.0  # 10 * 1.8 + 32 = 50
    assert pt.wind_speed_knots == 10.0
    assert pt.wind_speed_kmh == 18.5
    assert pt.wind_direction_cardinal == "S"
    assert pt.wind_gust_knots == 22.0
    assert pt.wind_gust_kmh == round(22.0 * 1.852, 1)
    assert pt.wind_gust_mph == round(22.0 * 1.15078, 1)


def test_weather_forecast_and_cache(client):
    # Fetch default location id
    locs = client.get("/api/locations").json()
    assert len(locs) > 0
    loc_id = locs[0]["id"]

    mock_resp = httpx.Response(
        status_code=200,
        json=MOCK_RAW_RESPONSE,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        # First call: fetched from API
        start_time = time.time()
        resp1 = client.get(f"/api/weather?location_id={loc_id}&model=best_match")
        dur1 = time.time() - start_time
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert data1["cached"] is False
        assert len(data1["forecast"]) == 16
        assert "current" in data1
        assert data1["model"] == "best_match"

    # Second call: must come from SQLite cache without calling httpx
    start_time = time.time()
    resp2 = client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    dur2 = time.time() - start_time
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["cached"] is True
    assert dur2 < 0.2
    assert len(data2["forecast"]) == 16


def test_point_weather_returns_forecast(client):
    mock_resp = httpx.Response(
        status_code=200,
        json=MOCK_RAW_RESPONSE,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        resp = client.get("/api/weather/point?lat=48.29&lon=-122.60")

    assert resp.status_code == 200
    data = resp.json()
    assert data["location_id"] == 0
    assert "48.29" in data["location_name"]
    assert "122.60" in data["location_name"]
    assert "current" in data
    assert len(data["forecast"]) == 16


def test_point_weather_location_name_format(client):
    """Name should encode N/S and E/W correctly for all quadrants."""
    mock_resp = httpx.Response(
        status_code=200,
        json=MOCK_RAW_RESPONSE,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )

    cases = [
        (48.29,  -122.60, "N", "W"),
        (-33.87,  151.21, "S", "E"),
        (1.0,     -1.0,   "N", "W"),
        (-1.0,     1.0,   "S", "E"),
    ]

    for lat, lon, expected_lat_hem, expected_lon_hem in cases:
        # Wipe the weather cache so location_id=0 doesn't return a stale entry
        conn = get_db_connection()
        conn.execute("DELETE FROM weather_cache WHERE location_id = 0;")
        conn.commit()
        conn.close()

        with patch("httpx.AsyncClient.get", return_value=mock_resp):
            resp = client.get(f"/api/weather/point?lat={lat}&lon={lon}")
        assert resp.status_code == 200
        name = resp.json()["location_name"]
        assert expected_lat_hem in name, f"Expected {expected_lat_hem} in '{name}' (lat={lat})"
        assert expected_lon_hem in name, f"Expected {expected_lon_hem} in '{name}' (lon={lon})"


def _mock_resp():
    return httpx.Response(
        status_code=200,
        json=MOCK_RAW_RESPONSE,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )


def test_point_weather_distinct_points_not_shared(client):
    with patch("httpx.AsyncClient.get", return_value=_mock_resp()):
        a = client.get("/api/weather/point?lat=48.78&lon=-121.94").json()
        b = client.get("/api/weather/point?lat=48.10&lon=-123.20").json()
    assert a["cached"] is False and b["cached"] is False
    assert a["location_name"] != b["location_name"]
    assert (a["latitude"], a["longitude"]) == (48.78, -121.94)
    assert (b["latitude"], b["longitude"]) == (48.10, -123.20)


def test_point_weather_same_point_cached(client):
    with patch("httpx.AsyncClient.get", return_value=_mock_resp()):
        first = client.get("/api/weather/point?lat=48.78&lon=-121.94").json()
    # Second call must not hit Open-Meteo (no patch active).
    second = client.get("/api/weather/point?lat=48.78&lon=-121.94").json()
    assert first["cached"] is False
    assert second["cached"] is True
    assert second["location_name"] == first["location_name"]
    assert second["latitude"] == 48.78 and second["longitude"] == -121.94


def test_saved_location_still_uses_weather_cache(client):
    loc_id = client.get("/api/locations").json()[0]["id"]
    with patch("httpx.AsyncClient.get", return_value=_mock_resp()):
        client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT COUNT(*) AS n FROM weather_cache WHERE location_id = ?;", (loc_id,)
    ).fetchone()
    conn.close()
    assert rows["n"] == 1


def test_point_weather_rejects_invalid_coords(client):
    assert client.get("/api/weather/point?lat=91&lon=0").status_code == 422
    assert client.get("/api/weather/point?lat=0&lon=181").status_code == 422
    assert client.get("/api/weather/point?lat=-91&lon=0").status_code == 422


def test_point_weather_requires_lat_and_lon(client):
    assert client.get("/api/weather/point?lat=48.0").status_code == 422
    assert client.get("/api/weather/point?lon=-122.0").status_code == 422
    assert client.get("/api/weather/point").status_code == 422


def test_point_weather_forwards_model(client):
    """The model query param must reach the Open-Meteo request."""
    mock_resp = httpx.Response(
        status_code=200,
        json=MOCK_RAW_RESPONSE,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )
    captured = {}

    async def fake_get(self_or_url, url=None, **kwargs):
        captured["params"] = kwargs.get("params", {})
        return mock_resp

    with patch("httpx.AsyncClient.get", new=fake_get):
        resp = client.get("/api/weather/point?lat=48.0&lon=-122.0&model=gfs_seamless")

    assert resp.status_code == 200
    assert captured["params"].get("models") == "gfs_seamless"



def test_first_forecast_slice_uses_current_conditions(client):
    """SCRUM-89: forecast[0] must be the Open-Meteo 'current' values, not the hourly value."""
    import copy

    raw = copy.deepcopy(MOCK_RAW_RESPONSE)
    raw["current"].update(
        {"time": "2026-11-12T12:15", "wind_speed_10m": 18.0, "wind_direction_10m": 250, "temperature_2m": 9.0}
    )
    mock_resp = httpx.Response(
        status_code=200,
        json=raw,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )
    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        data = client.get("/api/weather/point?lat=48.78&lon=-121.94").json()

    forecast = data["forecast"]
    assert len(forecast) == 16
    first = forecast[0]
    assert first == data["current"]
    assert first["time"] == "2026-11-12T12:15"
    assert first["wind_speed_knots"] == 18.0
    assert first["wind_direction_deg"] == 250
    # Later slices are still hourly values at +3h steps from the current hour.
    assert forecast[1]["time"] == "2026-11-12T15:00"
    assert forecast[1]["wind_speed_knots"] == 15.0
    assert forecast[1]["wind_direction_deg"] == 220
