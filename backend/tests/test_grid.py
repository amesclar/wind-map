"""Tests for the wind grid endpoint and grid_weather_service."""

import pytest

from backend.app.config import COORD_CACHE_PRECISION as CACHE_PRECISION
from backend.app.services.grid_weather_service import _fetch_from_open_meteo, get_grid_wind
from backend.app.units import coord_key as _cache_key
from factories import grid_item, grid_payload, insert_grid_row, upstream_error

BBOX = {"min_lat": 47.0, "max_lat": 49.0, "min_lon": -123.0, "max_lon": -121.0}


def grid_params(**overrides) -> dict:
    return {**BBOX, "cols": 2, "rows": 2, **overrides}


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
async def test_fetch_single_point_dict_response(open_meteo):
    """Open-Meteo returns a plain dict for a single point; service wraps it correctly."""
    pts = [(48.29, -122.60)]
    open_meteo.respond(grid_payload(grid_item(15.0, 220.0)))

    result = await _fetch_from_open_meteo(pts, "best_match")

    assert len(result) == 1
    assert result[0].latitude == 48.29
    assert result[0].longitude == -122.60
    assert result[0].wind_speed_knots == 15.0
    assert result[0].wind_direction_deg == 220.0


@pytest.mark.asyncio
async def test_fetch_multiple_points_array_response(open_meteo):
    """Open-Meteo returns a JSON array for multiple points."""
    pts = [(48.0, -122.0), (47.0, -121.0), (46.0, -120.0)]
    open_meteo.respond(grid_payload(grid_item(5.0, 90.0), grid_item(20.0, 180.0), grid_item(35.0, 270.0)))

    result = await _fetch_from_open_meteo(pts, "best_match")

    assert len(result) == 3
    assert result[0].wind_speed_knots == 5.0
    assert result[1].wind_speed_knots == 20.0
    assert result[2].wind_speed_knots == 35.0
    # Each result preserves its original lat/lon (not the rounded cache key)
    assert result[1].latitude == 47.0
    assert result[1].longitude == -121.0


@pytest.mark.asyncio
async def test_fetch_handles_null_wind_values(open_meteo):
    """None values from Open-Meteo should default to 0.0, not raise."""
    pts = [(48.0, -122.0)]
    item = {"current": {"wind_speed_10m": None, "wind_direction_10m": None}}
    open_meteo.respond(grid_payload(item))

    result = await _fetch_from_open_meteo(pts, "best_match")

    assert result[0].wind_speed_knots == 0.0
    assert result[0].wind_direction_deg == 0.0


@pytest.mark.asyncio
async def test_fetch_non_best_match_model_adds_models_param(open_meteo):
    """A non-default model should be forwarded in the Open-Meteo request params."""
    open_meteo.respond(grid_payload(grid_item()))

    await _fetch_from_open_meteo([(48.0, -122.0)], "ecmwf_ifs04")

    assert open_meteo.last_params.get("models") == "ecmwf_ifs04"


@pytest.mark.asyncio
async def test_fetch_best_match_omits_models_param(open_meteo):
    """best_match should NOT add a 'models' key to the request."""
    open_meteo.respond(grid_payload(grid_item()))

    await _fetch_from_open_meteo([(48.0, -122.0)], "best_match")

    assert "models" not in open_meteo.last_params


# ---------------------------------------------------------------------------
# Unit: get_grid_wind (service layer with cache)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_grid_wind_empty_input(open_meteo):
    result = await get_grid_wind([])
    assert result == []
    assert open_meteo.call_count == 0


@pytest.mark.asyncio
async def test_get_grid_wind_cache_miss_then_hit(open_meteo):
    pts = [(48.0, -122.0), (47.0, -121.0)]
    open_meteo.respond(grid_payload(grid_item(12.0, 200.0), grid_item(8.0, 100.0)))

    # First call: cache miss → one HTTP request
    result1 = await get_grid_wind(pts, "best_match")
    assert open_meteo.call_count == 1
    assert len(result1) == 2

    # Second call: both points are cached → no HTTP request
    result2 = await get_grid_wind(pts, "best_match")
    assert open_meteo.call_count == 1  # still 1
    assert len(result2) == 2

    # Values are consistent across cache miss and hit
    speeds_first = {round(p.wind_speed_knots, 1) for p in result1}
    speeds_second = {round(p.wind_speed_knots, 1) for p in result2}
    assert speeds_first == speeds_second


@pytest.mark.asyncio
async def test_get_grid_wind_partial_cache_hit(open_meteo):
    """When some points are cached and others are not, only missing points are fetched."""
    insert_grid_row(48.0, -122.0, speed=7.0, direction=90.0, temperature_f=55.0)  # pre-seed one point

    pts = [(48.0, -122.0), (47.0, -121.0)]  # first is cached, second is not
    open_meteo.respond(grid_payload(grid_item(25.0, 270.0)))

    result = await get_grid_wind(pts, "best_match")

    assert open_meteo.call_count == 1  # fetched only the missing point
    assert open_meteo.last_params["latitude"] == "47.0"

    speeds = {round(p.wind_speed_knots, 1) for p in result}
    assert 7.0 in speeds  # from cache
    assert 25.0 in speeds  # from API


@pytest.mark.asyncio
async def test_get_grid_wind_expired_cache_refetches(open_meteo):
    """An expired cache entry should trigger a fresh API call."""
    insert_grid_row(48.0, -122.0, speed=3.0, direction=45.0, expires_in=-10)  # already expired

    pts = [(48.0, -122.0)]
    open_meteo.respond(grid_payload(grid_item(18.0, 180.0)))

    result = await get_grid_wind(pts, "best_match")

    # Stale value (3.0) replaced by fresh value (18.0)
    assert result[0].wind_speed_knots == 18.0


@pytest.mark.asyncio
async def test_get_grid_wind_different_models_cached_independently(open_meteo):
    """Cache entries are keyed by (lat, lon, model); same point with different model is a miss."""
    pts = [(48.0, -122.0)]
    open_meteo.respond(grid_payload(grid_item(10.0, 90.0)))

    await get_grid_wind(pts, "best_match")
    assert open_meteo.call_count == 1

    await get_grid_wind(pts, "ecmwf_ifs04")
    assert open_meteo.call_count == 2  # different model → cache miss


# ---------------------------------------------------------------------------
# Integration: GET /api/weather/grid
# ---------------------------------------------------------------------------


def test_grid_endpoint_returns_correct_point_count(client, open_meteo):
    """cols × rows must equal the number of returned points."""
    open_meteo.respond([grid_item(10.0, 180.0)] * 6)

    resp = client.get("/api/weather/grid", params=grid_params(cols=3, rows=2))

    assert resp.status_code == 200
    assert len(resp.json()) == 6  # 3 cols × 2 rows


def test_grid_endpoint_point_coordinates_span_bbox(client, open_meteo):
    """Corner points should coincide with the requested bounding box."""
    open_meteo.respond([grid_item()] * 4)

    resp = client.get("/api/weather/grid", params=grid_params())

    assert resp.status_code == 200
    data = resp.json()
    lats = {round(p["latitude"], 2) for p in data}
    lons = {round(p["longitude"], 2) for p in data}
    assert 47.0 in lats and 49.0 in lats
    assert -123.0 in lons and -121.0 in lons


def test_grid_endpoint_response_schema(client, open_meteo):
    """Every returned point must contain latitude, longitude, wind_speed_knots, wind_direction_deg."""
    open_meteo.respond([grid_item(14.5, 225.0)] * 4)

    resp = client.get("/api/weather/grid", params=grid_params())

    assert resp.status_code == 200
    for point in resp.json():
        assert "latitude" in point
        assert "longitude" in point
        assert "wind_speed_knots" in point
        assert "wind_direction_deg" in point


def test_grid_endpoint_rejects_inverted_lat(client, open_meteo):
    resp = client.get("/api/weather/grid", params=grid_params(min_lat=49.0, max_lat=47.0))
    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_inverted_lon(client, open_meteo):
    resp = client.get("/api/weather/grid", params=grid_params(min_lon=-121.0, max_lon=-123.0))
    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_cols_above_max(client, open_meteo):
    resp = client.get("/api/weather/grid", params=grid_params(cols=31))  # 31 > MAX_COLS=30
    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_rows_above_max(client, open_meteo):
    resp = client.get("/api/weather/grid", params=grid_params(rows=31))  # 31 > MAX_ROWS=30
    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_requires_all_bbox_params(client, open_meteo):
    params = grid_params()
    del params["max_lat"]
    resp = client.get("/api/weather/grid", params=params)
    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_uses_model_param(client, open_meteo):
    """The model query param must be forwarded to the Open-Meteo request."""
    open_meteo.respond([grid_item()] * 4)

    resp = client.get("/api/weather/grid", params=grid_params(model="gfs_seamless"))

    assert resp.status_code == 200
    assert open_meteo.last_params.get("models") == "gfs_seamless"


def test_grid_endpoint_second_request_served_from_cache(client, open_meteo):
    """A second identical request must not trigger a second HTTP call."""
    open_meteo.respond([grid_item(9.0, 135.0)] * 4)

    r1 = client.get("/api/weather/grid", params=grid_params())
    r2 = client.get("/api/weather/grid", params=grid_params())

    assert open_meteo.call_count == 1  # only one real HTTP request
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r2.json() == r1.json()


# ---------------------------------------------------------------------------
# SCRUM-89: temperature for temperature-colored map barbs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_returns_temperature_f_and_requests_temperature(open_meteo):
    """Grid points carry current temperature in °F, converted like the drawer (1 decimal)."""
    open_meteo.respond(grid_payload(grid_item(12.0, 200.0, temp_c=12.3)))

    result = await _fetch_from_open_meteo([(48.0, -122.0)], "best_match")

    assert "temperature_2m" in open_meteo.last_params["current"]
    assert result[0].temperature_f == round(12.3 * 9 / 5 + 32, 1)  # 54.1


@pytest.mark.asyncio
async def test_get_grid_wind_caches_temperature(open_meteo):
    pts = [(48.0, -122.0)]
    open_meteo.respond(grid_payload(grid_item(12.0, 200.0, temp_c=20.0)))

    first = await get_grid_wind(pts, "best_match")
    # Second call is served from cache and keeps the temperature.
    second = await get_grid_wind(pts, "best_match")

    assert open_meteo.call_count == 1
    assert first[0].temperature_f == 68.0
    assert second[0].temperature_f == 68.0


@pytest.mark.asyncio
async def test_get_grid_wind_refetches_cached_rows_without_temperature(open_meteo):
    """A cached row with no temperature (e.g. written before SCRUM-89) is a cache miss."""
    insert_grid_row(48.0, -122.0, speed=7.0, direction=90.0, temperature_f=None)
    open_meteo.respond(grid_payload(grid_item(9.0, 100.0, temp_c=0.0)))

    result = await get_grid_wind([(48.0, -122.0)], "best_match")

    assert open_meteo.call_count == 1
    assert result[0].temperature_f == 32.0
    assert result[0].wind_speed_knots == 9.0


def test_grid_endpoint_includes_temperature_f(client, open_meteo):
    open_meteo.respond([grid_item(14.5, 225.0, temp_c=15.0)] * 4)

    resp = client.get(
        "/api/weather/grid",
        params={"min_lat": 47, "max_lat": 48, "min_lon": -123, "max_lon": -122, "cols": 2, "rows": 2},
    )

    assert resp.status_code == 200
    assert all(p["temperature_f"] == 59.0 for p in resp.json())


# ---------------------------------------------------------------------------
# SCRUM-92 phase 1: specific error handling
# ---------------------------------------------------------------------------


def test_grid_endpoint_upstream_failure_is_502_without_internal_detail(client, open_meteo):
    open_meteo.fail(upstream_error("secret-host.internal"))

    resp = client.get("/api/weather/grid", params=grid_params())

    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch grid wind data from Open-Meteo"
    assert "secret-host" not in resp.text
