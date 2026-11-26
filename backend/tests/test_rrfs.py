"""NOAA RRFS coverage (SCRUM-231), using the SCRUM-229 decision: split on the coverage 400."""

from datetime import UTC, datetime

import httpx
import pytest

from backend.app.services import grid_weather_service as grid_service
from backend.app.services import open_meteo
from backend.app.services.grid_weather_service import COVERAGE_SPLIT_MAX_REQUESTS, get_grid_wind
from factories import forecast_payload, grid_hourly_item, grid_item, grid_payload

RRFS = "ncep_rrfs_north_america"
HOUR = "2026-11-25T12:00"
BBOX = {"min_lat": 47.0, "max_lat": 49.0, "min_lon": -123.0, "max_lon": -121.0}


def grid_params(**overrides) -> dict:
    return {**BBOX, "cols": 2, "rows": 2, **overrides}


def outside_coverage(lat: float, lon: float) -> bool:
    """The RRFS edge measured in SCRUM-229: roughly 18-80 N and 140-50 W."""
    return not (18.0 <= lat <= 80.0 and -140.0 <= lon <= -50.0)


def stub_rrfs(monkeypatch) -> list[list[tuple[float, float]]]:
    """Replace the Open-Meteo call: a batch with one outside point gets the real coverage 400."""
    requests: list[list[tuple[float, float]]] = []

    async def fake_get_json(url, params, **kwargs):
        lats = [float(value) for value in str(params["latitude"]).split(",")]
        lons = [float(value) for value in str(params["longitude"]).split(",")]
        points = list(zip(lats, lons, strict=True))
        requests.append(points)
        if any(outside_coverage(lat, lon) for lat, lon in points):
            raise open_meteo.CoverageError(request=httpx.Request("GET", url))
        if "start_date" in params:  # the hourly grid series
            return grid_payload(*[grid_hourly_item(HOUR) for _ in points])
        if "timezone" in params:  # a point/saved-location forecast
            return forecast_payload()
        return grid_payload(*[grid_item(12.0, 250.0) for _ in points])

    monkeypatch.setattr(grid_service.open_meteo, "get_json", fake_get_json)
    return requests


@pytest.mark.asyncio
async def test_rrfs_grid_keeps_covered_points_when_a_batch_has_an_outside_point(open_meteo, monkeypatch):
    """The whole view no longer fails because one point is off-domain (SCRUM-229)."""
    calls = stub_rrfs(monkeypatch)

    result = await get_grid_wind([(48.0, -122.0), (40.0, -150.0), (47.0, -121.0)], RRFS)

    assert [(p.latitude, p.longitude) for p in result] == [(48.0, -122.0), (47.0, -121.0)]
    assert all(p.wind_speed_knots == 12.0 for p in result)
    assert len(calls) >= 3  # the failed batch, plus its halves
    assert len(calls) <= 2 * COVERAGE_SPLIT_MAX_REQUESTS


@pytest.mark.asyncio
async def test_rrfs_grid_entirely_outside_is_empty_not_an_error(open_meteo, monkeypatch):
    calls = stub_rrfs(monkeypatch)

    result = await get_grid_wind([(40.0, -150.0), (35.0, -160.0)], RRFS)

    assert result == []
    assert calls  # bounded splitting, and the router answers 200 with []


@pytest.mark.asyncio
async def test_rrfs_hourly_day_keeps_covered_points(open_meteo, monkeypatch):
    stub_rrfs(monkeypatch)

    result = await get_grid_wind(
        [(48.0, -122.0), (40.0, -150.0)],
        RRFS,
        datetime(2026, 11, 25, 12, tzinfo=UTC),
    )

    assert [(p.latitude, p.longitude) for p in result] == [(48.0, -122.0)]
    assert result[0].time == HOUR
    assert result[0].wind_speed_knots == 10.0


def test_grid_endpoint_returns_only_covered_points_across_the_edge(client, open_meteo, monkeypatch):
    stub_rrfs(monkeypatch)

    resp = client.get(
        "/api/weather/grid",
        params=grid_params(model=RRFS, min_lon=-145.0, max_lon=-135.0),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2  # the -135 column, both rows
    assert all(point["longitude"] == -135.0 for point in body)


def test_grid_endpoint_outside_coverage_returns_empty_200(client, open_meteo, monkeypatch):
    """No 502 for a view entirely off-domain: the map draws no barbs there."""
    stub_rrfs(monkeypatch)

    resp = client.get(
        "/api/weather/grid",
        params=grid_params(model=RRFS, min_lon=-170.0, max_lon=-160.0),
    )

    assert resp.status_code == 200
    assert resp.json() == []


def test_point_forecast_outside_rrfs_is_no_data_not_an_error(client, open_meteo, monkeypatch):
    """A saved location or barb in Europe shows no data instead of a 502 (SCRUM-231)."""
    calls = stub_rrfs(monkeypatch)

    resp = client.get(f"/api/weather/point?lat=48.85&lon=2.35&model={RRFS}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["model"] == RRFS
    assert body["cached"] is False
    assert body["forecast"] == []
    assert body["current"]["wind_speed_knots"] is None
    assert body["current"]["temperature_f"] is None

    again = client.get(f"/api/weather/point?lat=48.85&lon=2.35&model={RRFS}")
    assert again.json()["cached"] is False
    assert len(calls) == 2  # a no-data answer is never cached


def test_all_weather_gives_an_outside_location_no_data(client, open_meteo, monkeypatch):
    """The marker for a saved Paris location has null wind, so it renders "No data"."""
    client.post(
        "/api/locations",
        json={"name": "Paris", "latitude": 48.85, "longitude": 2.35},
    )
    stub_rrfs(monkeypatch)

    resp = client.get(f"/api/weather/all?model={RRFS}")

    assert resp.status_code == 200
    paris = next(item for item in resp.json() if item["location_name"] == "Paris")
    assert paris["current"]["wind_speed_knots"] is None
    assert paris["forecast"] == []
