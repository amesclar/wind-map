"""Tests for the wind grid endpoint and grid_weather_service."""

import os
import time
import pytest
import httpx
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "./data/test_wind_map.db"
os.environ["DATA_DIR"] = "./data"

from backend.app.database import init_db, get_db_connection
from backend.app.main import app
from backend.app.models import GridWindPoint
from backend.app.services.grid_weather_service import (
    get_grid_wind,
    _cache_key,
    _fetch_from_open_meteo,
    CACHE_PRECISION,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_open_meteo_item(speed: float = 10.0, direction: float = 180.0, temp_c: float = 10.0) -> dict:
    return {"current": {"wind_speed_10m": speed, "wind_direction_10m": direction, "temperature_2m": temp_c}}


def _mock_response(items: list) -> httpx.Response:
    """Build a mock httpx.Response returning `items` as JSON."""
    payload = items if len(items) > 1 else items[0]
    return httpx.Response(
        status_code=200,
        json=payload,
        request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"),
    )


# ---------------------------------------------------------------------------
# DB fixture — wipes and recreates grid_weather_cache between every test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def setup_test_db():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS grid_weather_cache;")
    cur.execute("DROP TABLE IF EXISTS weather_cache;")
    cur.execute("DROP TABLE IF EXISTS locations;")
    conn.commit()
    conn.close()
    init_db()
    # grid table is created lazily by the service on first use; force it now
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS grid_weather_cache (
            lat_key  REAL NOT NULL,
            lon_key  REAL NOT NULL,
            model    TEXT NOT NULL,
            cached_at  REAL NOT NULL,
            expires_at REAL NOT NULL,
            wind_speed_knots REAL NOT NULL,
            wind_direction_deg REAL NOT NULL,
            temperature_f REAL,
            PRIMARY KEY (lat_key, lon_key, model)
        );
        """
    )
    conn.commit()
    conn.close()
    yield
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS grid_weather_cache;")
    cur.execute("DROP TABLE IF EXISTS weather_cache;")
    cur.execute("DROP TABLE IF EXISTS locations;")
    conn.commit()
    conn.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Unit: _cache_key
# ---------------------------------------------------------------------------

def test_cache_key_rounds_to_precision():
    lk, lnk = _cache_key(48.29391, -122.60641)
    assert lk == round(48.29391, CACHE_PRECISION)
    assert lnk == round(-122.60641, CACHE_PRECISION)


def test_cache_key_same_for_nearby_points():
    # Two points that differ only beyond CACHE_PRECISION decimal places
    # must share a cache key (intentional coarsening).
    epsilon = 10 ** -(CACHE_PRECISION + 1)
    k1 = _cache_key(48.29, -122.60)
    k2 = _cache_key(48.29 + epsilon, -122.60 + epsilon)
    assert k1 == k2


# ---------------------------------------------------------------------------
# Unit: _fetch_from_open_meteo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_single_point_dict_response():
    """Open-Meteo returns a plain dict for a single point; service wraps it correctly."""
    pts = [(48.29, -122.60)]
    mock_resp = _mock_response([_make_open_meteo_item(15.0, 220.0)])

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        result = await _fetch_from_open_meteo(pts, "best_match")

    assert len(result) == 1
    assert result[0].latitude == 48.29
    assert result[0].longitude == -122.60
    assert result[0].wind_speed_knots == 15.0
    assert result[0].wind_direction_deg == 220.0


@pytest.mark.asyncio
async def test_fetch_multiple_points_array_response():
    """Open-Meteo returns a JSON array for multiple points."""
    pts = [(48.0, -122.0), (47.0, -121.0), (46.0, -120.0)]
    items = [
        _make_open_meteo_item(5.0, 90.0),
        _make_open_meteo_item(20.0, 180.0),
        _make_open_meteo_item(35.0, 270.0),
    ]
    mock_resp = _mock_response(items)

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        result = await _fetch_from_open_meteo(pts, "best_match")

    assert len(result) == 3
    assert result[0].wind_speed_knots == 5.0
    assert result[1].wind_speed_knots == 20.0
    assert result[2].wind_speed_knots == 35.0
    # Each result preserves its original lat/lon (not the rounded cache key)
    assert result[1].latitude == 47.0
    assert result[1].longitude == -121.0


@pytest.mark.asyncio
async def test_fetch_handles_null_wind_values():
    """None values from Open-Meteo should default to 0.0, not raise."""
    pts = [(48.0, -122.0)]
    item = {"current": {"wind_speed_10m": None, "wind_direction_10m": None}}
    mock_resp = _mock_response([item])

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        result = await _fetch_from_open_meteo(pts, "best_match")

    assert result[0].wind_speed_knots == 0.0
    assert result[0].wind_direction_deg == 0.0


@pytest.mark.asyncio
async def test_fetch_non_best_match_model_adds_models_param():
    """A non-default model should be forwarded in the Open-Meteo request params."""
    pts = [(48.0, -122.0)]
    mock_resp = _mock_response([_make_open_meteo_item()])
    captured = {}

    async def fake_get(self_or_url, url=None, **kwargs):
        # httpx calls client.get(url, params=...) so the url lands in self_or_url
        captured["params"] = kwargs.get("params", {})
        return mock_resp

    with patch("httpx.AsyncClient.get", new=fake_get):
        await _fetch_from_open_meteo(pts, "ecmwf_ifs04")

    assert captured["params"].get("models") == "ecmwf_ifs04"


@pytest.mark.asyncio
async def test_fetch_best_match_omits_models_param():
    """best_match should NOT add a 'models' key to the request."""
    pts = [(48.0, -122.0)]
    mock_resp = _mock_response([_make_open_meteo_item()])
    captured = {}

    async def fake_get(self_or_url, url=None, **kwargs):
        captured["params"] = kwargs.get("params", {})
        return mock_resp

    with patch("httpx.AsyncClient.get", new=fake_get):
        await _fetch_from_open_meteo(pts, "best_match")

    assert "models" not in captured["params"]


# ---------------------------------------------------------------------------
# Unit: get_grid_wind (service layer with cache)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_grid_wind_empty_input():
    result = await get_grid_wind([])
    assert result == []


@pytest.mark.asyncio
async def test_get_grid_wind_cache_miss_then_hit():
    pts = [(48.0, -122.0), (47.0, -121.0)]
    items = [_make_open_meteo_item(12.0, 200.0), _make_open_meteo_item(8.0, 100.0)]
    mock_resp = _mock_response(items)

    with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
        # First call: cache miss → one HTTP request
        result1 = await get_grid_wind(pts, "best_match")
        assert mock_get.call_count == 1
        assert len(result1) == 2

        # Second call: both points are cached → no HTTP request
        result2 = await get_grid_wind(pts, "best_match")
        assert mock_get.call_count == 1  # still 1
        assert len(result2) == 2

    # Values are consistent across cache miss and hit
    speeds_first = {round(p.wind_speed_knots, 1) for p in result1}
    speeds_second = {round(p.wind_speed_knots, 1) for p in result2}
    assert speeds_first == speeds_second


@pytest.mark.asyncio
async def test_get_grid_wind_partial_cache_hit():
    """When some points are cached and others are not, only missing points are fetched."""
    conn = get_db_connection()
    cur = conn.cursor()
    now = time.time()
    # Pre-seed one point into the cache
    cur.execute(
        """
        INSERT INTO grid_weather_cache
            (lat_key, lon_key, model, cached_at, expires_at, wind_speed_knots, wind_direction_deg, temperature_f)
        VALUES (48.0, -122.0, 'best_match', ?, ?, 7.0, 90.0, 55.0)
        """,
        (now, now + 3600),
    )
    conn.commit()
    conn.close()

    pts = [(48.0, -122.0), (47.0, -121.0)]  # first is cached, second is not
    mock_resp = _mock_response([_make_open_meteo_item(25.0, 270.0)])

    with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
        result = await get_grid_wind(pts, "best_match")
        assert mock_get.call_count == 1  # fetched only the missing point

    speeds = {round(p.wind_speed_knots, 1) for p in result}
    assert 7.0 in speeds   # from cache
    assert 25.0 in speeds  # from API


@pytest.mark.asyncio
async def test_get_grid_wind_expired_cache_refetches():
    """An expired cache entry should trigger a fresh API call."""
    conn = get_db_connection()
    cur = conn.cursor()
    past = time.time() - 10  # already expired
    cur.execute(
        """
        INSERT INTO grid_weather_cache
            (lat_key, lon_key, model, cached_at, expires_at, wind_speed_knots, wind_direction_deg)
        VALUES (48.0, -122.0, 'best_match', ?, ?, 3.0, 45.0)
        """,
        (past, past),
    )
    conn.commit()
    conn.close()

    pts = [(48.0, -122.0)]
    mock_resp = _mock_response([_make_open_meteo_item(18.0, 180.0)])

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        result = await get_grid_wind(pts, "best_match")

    # Stale value (3.0) replaced by fresh value (18.0)
    assert result[0].wind_speed_knots == 18.0


@pytest.mark.asyncio
async def test_get_grid_wind_different_models_cached_independently():
    """Cache entries are keyed by (lat, lon, model); same point with different model is a miss."""
    pts = [(48.0, -122.0)]
    mock_resp = _mock_response([_make_open_meteo_item(10.0, 90.0)])

    with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
        await get_grid_wind(pts, "best_match")
        assert mock_get.call_count == 1

        await get_grid_wind(pts, "ecmwf_ifs04")
        assert mock_get.call_count == 2  # different model → cache miss


# ---------------------------------------------------------------------------
# Integration: GET /api/weather/grid
# ---------------------------------------------------------------------------

def test_grid_endpoint_returns_correct_point_count(client):
    """cols × rows must equal the number of returned points."""
    mock_items = [_make_open_meteo_item(10.0, 180.0)] * 6
    mock_resp = _mock_response(mock_items)

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        resp = client.get(
            "/api/weather/grid",
            params={
                "min_lat": 47.0, "max_lat": 49.0,
                "min_lon": -123.0, "max_lon": -121.0,
                "cols": 3, "rows": 2,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 6  # 3 cols × 2 rows


def test_grid_endpoint_point_coordinates_span_bbox(client):
    """Corner points should coincide with the requested bounding box."""
    mock_items = [_make_open_meteo_item()] * 4
    mock_resp = _mock_response(mock_items)

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        resp = client.get(
            "/api/weather/grid",
            params={
                "min_lat": 47.0, "max_lat": 49.0,
                "min_lon": -123.0, "max_lon": -121.0,
                "cols": 2, "rows": 2,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    lats = {round(p["latitude"], 2) for p in data}
    lons = {round(p["longitude"], 2) for p in data}
    assert 47.0 in lats and 49.0 in lats
    assert -123.0 in lons and -121.0 in lons


def test_grid_endpoint_response_schema(client):
    """Every returned point must contain latitude, longitude, wind_speed_knots, wind_direction_deg."""
    mock_items = [_make_open_meteo_item(14.5, 225.0)] * 4
    mock_resp = _mock_response(mock_items)

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        resp = client.get(
            "/api/weather/grid",
            params={
                "min_lat": 47.0, "max_lat": 49.0,
                "min_lon": -123.0, "max_lon": -121.0,
                "cols": 2, "rows": 2,
            },
        )

    assert resp.status_code == 200
    for point in resp.json():
        assert "latitude" in point
        assert "longitude" in point
        assert "wind_speed_knots" in point
        assert "wind_direction_deg" in point


def test_grid_endpoint_rejects_inverted_lat(client):
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 49.0, "max_lat": 47.0,  # inverted
            "min_lon": -123.0, "max_lon": -121.0,
            "cols": 2, "rows": 2,
        },
    )
    assert resp.status_code == 422


def test_grid_endpoint_rejects_inverted_lon(client):
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0, "max_lat": 49.0,
            "min_lon": -121.0, "max_lon": -123.0,  # inverted
            "cols": 2, "rows": 2,
        },
    )
    assert resp.status_code == 422


def test_grid_endpoint_rejects_cols_above_max(client):
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0, "max_lat": 49.0,
            "min_lon": -123.0, "max_lon": -121.0,
            "cols": 31, "rows": 2,  # 31 > MAX_COLS=30
        },
    )
    assert resp.status_code == 422


def test_grid_endpoint_rejects_rows_above_max(client):
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0, "max_lat": 49.0,
            "min_lon": -123.0, "max_lon": -121.0,
            "cols": 2, "rows": 31,  # 31 > MAX_ROWS=30
        },
    )
    assert resp.status_code == 422


def test_grid_endpoint_requires_all_bbox_params(client):
    # Missing max_lat
    resp = client.get(
        "/api/weather/grid",
        params={
            "min_lat": 47.0,
            "min_lon": -123.0, "max_lon": -121.0,
            "cols": 2, "rows": 2,
        },
    )
    assert resp.status_code == 422


def test_grid_endpoint_uses_model_param(client):
    """The model query param must be forwarded to the Open-Meteo request."""
    mock_items = [_make_open_meteo_item()] * 4
    mock_resp = _mock_response(mock_items)
    captured = {}

    async def fake_get(self_or_url, url=None, **kwargs):
        captured["params"] = kwargs.get("params", {})
        return mock_resp

    with patch("httpx.AsyncClient.get", new=fake_get):
        resp = client.get(
            "/api/weather/grid",
            params={
                "min_lat": 47.0, "max_lat": 49.0,
                "min_lon": -123.0, "max_lon": -121.0,
                "cols": 2, "rows": 2,
                "model": "gfs_seamless",
            },
        )

    assert resp.status_code == 200
    assert captured["params"].get("models") == "gfs_seamless"


def test_grid_endpoint_second_request_served_from_cache(client):
    """A second identical request must not trigger a second HTTP call."""
    mock_items = [_make_open_meteo_item(9.0, 135.0)] * 4
    mock_resp = _mock_response(mock_items)

    bbox_params = {
        "min_lat": 47.0, "max_lat": 49.0,
        "min_lon": -123.0, "max_lon": -121.0,
        "cols": 2, "rows": 2,
    }

    with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
        r1 = client.get("/api/weather/grid", params=bbox_params)
        r2 = client.get("/api/weather/grid", params=bbox_params)
        assert mock_get.call_count == 1  # only one real HTTP request

    assert r1.status_code == 200
    assert r2.status_code == 200


# ---------------------------------------------------------------------------
# SCRUM-89: temperature for temperature-colored map barbs
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_returns_temperature_f_and_requests_temperature():
    """Grid points carry current temperature in °F, converted like the drawer (1 decimal)."""
    captured = {}
    mock_resp = _mock_response([_make_open_meteo_item(12.0, 200.0, temp_c=12.3)])

    async def fake_get(self_or_url, url=None, **kwargs):
        captured["params"] = kwargs.get("params", {})
        return mock_resp

    with patch("httpx.AsyncClient.get", new=fake_get):
        result = await _fetch_from_open_meteo([(48.0, -122.0)], "best_match")

    assert "temperature_2m" in captured["params"]["current"]
    assert result[0].temperature_f == round(12.3 * 9 / 5 + 32, 1)  # 54.1


@pytest.mark.asyncio
async def test_get_grid_wind_caches_temperature():
    pts = [(48.0, -122.0)]
    with patch("httpx.AsyncClient.get", return_value=_mock_response([_make_open_meteo_item(12.0, 200.0, temp_c=20.0)])):
        first = await get_grid_wind(pts, "best_match")
    # Second call is served from cache (no patch active) and keeps the temperature.
    second = await get_grid_wind(pts, "best_match")
    assert first[0].temperature_f == 68.0
    assert second[0].temperature_f == 68.0


@pytest.mark.asyncio
async def test_get_grid_wind_migrates_old_table_and_refetches_rows_without_temperature():
    """An existing cache table without temperature_f gains the column; old rows are refetched."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS grid_weather_cache;")
    cur.execute(
        """
        CREATE TABLE grid_weather_cache (
            lat_key REAL NOT NULL, lon_key REAL NOT NULL, model TEXT NOT NULL,
            cached_at REAL NOT NULL, expires_at REAL NOT NULL,
            wind_speed_knots REAL NOT NULL, wind_direction_deg REAL NOT NULL,
            PRIMARY KEY (lat_key, lon_key, model)
        );
        """
    )
    now = time.time()
    cur.execute(
        "INSERT INTO grid_weather_cache VALUES (48.0, -122.0, 'best_match', ?, ?, 7.0, 90.0)",
        (now, now + 3600),
    )
    conn.commit()
    conn.close()

    mock_resp = _mock_response([_make_open_meteo_item(9.0, 100.0, temp_c=0.0)])
    with patch("httpx.AsyncClient.get", return_value=mock_resp) as mock_get:
        result = await get_grid_wind([(48.0, -122.0)], "best_match")
        assert mock_get.call_count == 1  # old row has no temperature → cache miss

    assert result[0].temperature_f == 32.0
    assert result[0].wind_speed_knots == 9.0
    conn = get_db_connection()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(grid_weather_cache)").fetchall()}
    conn.close()
    assert "temperature_f" in cols


def test_grid_endpoint_includes_temperature_f(client):
    mock_items = [_make_open_meteo_item(14.5, 225.0, temp_c=15.0)] * 4
    with patch("httpx.AsyncClient.get", return_value=_mock_response(mock_items)):
        resp = client.get(
            "/api/weather/grid",
            params={"min_lat": 47, "max_lat": 48, "min_lon": -123, "max_lon": -122, "cols": 2, "rows": 2},
        )
    assert resp.status_code == 200
    assert all(p["temperature_f"] == 59.0 for p in resp.json())


# ---------------------------------------------------------------------------
# SCRUM-92 phase 1: specific error handling
# ---------------------------------------------------------------------------

def test_grid_endpoint_upstream_failure_is_502_without_internal_detail(client):
    error = httpx.ConnectError("secret-host.internal", request=httpx.Request("GET", "https://x"))
    with patch("httpx.AsyncClient.get", side_effect=error):
        resp = client.get(
            "/api/weather/grid",
            params={"min_lat": 47, "max_lat": 48, "min_lon": -123, "max_lon": -122, "cols": 2, "rows": 2},
        )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch grid wind data from Open-Meteo"
    assert "secret-host" not in resp.text
