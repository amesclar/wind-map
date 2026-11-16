"""API endpoint tests using FastAPI TestClient."""

import os
import pytest
from fastapi.testclient import TestClient

# Use temporary test database
os.environ["DATABASE_PATH"] = "./data/test_wind_map.db"
os.environ["DATA_DIR"] = "./data"

from backend.app.database import init_db, get_db_connection
from backend.app.main import app


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


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body  # SCRUM-91; exact value checked in test_version.py


def test_config(client):
    response = client.get("/api/config")
    assert response.status_code == 200
    assert "carto_api_key" in response.json()


def test_default_seeded_location(client):
    response = client.get("/api/locations")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    default_loc = data[0]
    assert "Oak Harbor" in default_loc["name"]
    assert abs(default_loc["latitude"] - 48.2939) < 0.01
    assert abs(default_loc["longitude"] - (-122.6064)) < 0.01


def test_create_and_delete_location(client):
    # Add new location
    new_loc = {
        "name": "Seattle, WA",
        "latitude": 47.6062,
        "longitude": -122.3321,
        "admin1": "Washington",
        "country": "United States",
    }
    create_resp = client.post("/api/locations", json=new_loc)
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    assert created_data["name"] == "Seattle, WA"
    loc_id = created_data["id"]

    # Verify present in list
    list_resp = client.get("/api/locations")
    ids = [loc["id"] for loc in list_resp.json()]
    assert loc_id in ids

    # Delete location
    del_resp = client.delete(f"/api/locations/{loc_id}")
    assert del_resp.status_code == 204

    # Verify removed
    list_resp_after = client.get("/api/locations")
    ids_after = [loc["id"] for loc in list_resp_after.json()]
    assert loc_id not in ids_after


def test_weather_models_list(client):
    resp = client.get("/api/weather/models")
    assert resp.status_code == 200
    models = resp.json()
    model_ids = [m["id"] for m in models]
    assert "best_match" in model_ids
    assert "ecmwf_ifs04" in model_ids
    assert "gfs_seamless" in model_ids
    assert "icon_seamless" in model_ids

