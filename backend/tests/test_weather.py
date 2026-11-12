"""Weather service and caching tests."""

import os
import pytest
import time
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "./data/test_wind_map.db"
os.environ["DATA_DIR"] = "./data"

from backend.app.database import init_db, get_db_connection
from backend.app.main import app
from backend.app.services.weather_service import deg_to_cardinal, build_weather_point


@pytest.fixture(autouse=True)
def setup_test_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS weather_cache;")
    cursor.execute("DROP TABLE IF EXISTS locations;")
    conn.commit()
    conn.close()
    init_db()
    yield
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS weather_cache;")
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
    )
    assert pt.temperature_c == 10.0
    assert pt.temperature_f == 50.0  # 10 * 1.8 + 32 = 50
    assert pt.wind_speed_knots == 10.0
    assert pt.wind_speed_kmh == 18.5
    assert pt.wind_direction_cardinal == "S"


def test_weather_forecast_and_cache(client):
    # Fetch default location id
    locs = client.get("/api/locations").json()
    assert len(locs) > 0
    loc_id = locs[0]["id"]

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

    # Second call: must come from cache and be fast (<0.5s)
    start_time = time.time()
    resp2 = client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    dur2 = time.time() - start_time
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["cached"] is True
    assert dur2 < 0.5
    assert len(data2["forecast"]) == 16

