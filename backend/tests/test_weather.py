"""Weather service and caching tests."""

from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.database import get_db_connection
from backend.app.main import app
from backend.app.services.forecast_parser import build_weather_point
from backend.app.units import deg_to_cardinal
from factories import forecast_payload, upstream_error, upstream_status_error

POINT = "/api/weather/point?lat=48.78&lon=-121.94"


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


def test_build_weather_point_keeps_missing_humidity_missing():
    """A provider without a humidity value reports null, not 0 % (SCRUM-106)."""
    pt = build_weather_point(
        time_str="2026-11-12T12:00",
        temp_c=10.0,
        humidity=None,
        wind_knots=10.0,
        wind_deg=180.0,
        weather_code=0,
    )
    assert pt.humidity is None


def test_weather_forecast_and_cache(client, open_meteo):
    loc_id = client.get("/api/locations").json()[0]["id"]
    open_meteo.respond(forecast_payload())

    resp1 = client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["cached"] is False
    assert len(data1["forecast"]) == 16
    assert "current" in data1
    assert data1["model"] == "best_match"
    assert open_meteo.call_count == 1

    # Second call must come from the SQLite cache, not Open-Meteo.
    resp2 = client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["cached"] is True
    assert len(data2["forecast"]) == 16
    assert open_meteo.call_count == 1


def test_all_missing_forecast_is_not_cached(client, open_meteo):
    """A frame with no wind anywhere is an upstream gap, not a calm forecast (SCRUM-225)."""
    raw = forecast_payload(
        wind_speed_10m=None,
        wind_direction_10m=None,
        temperature_2m=None,
        wind_gusts_10m=None,
    )
    for name in ("wind_speed_10m", "wind_direction_10m", "temperature_2m", "wind_gusts_10m"):
        raw["hourly"][name] = [None] * len(raw["hourly"]["time"])
    open_meteo.respond(raw)

    first = client.get(POINT).json()
    second = client.get(POINT).json()

    assert open_meteo.call_count == 2  # the null frame was not stored
    assert first["cached"] is False and second["cached"] is False
    assert first["current"]["wind_speed_knots"] is None
    assert first["current"]["temperature_f"] is None


def test_point_weather_returns_forecast(client, open_meteo):
    open_meteo.respond(forecast_payload())
    resp = client.get("/api/weather/point?lat=48.29&lon=-122.60")
    assert resp.status_code == 200
    data = resp.json()
    assert data["location_id"] == 0
    assert "48.29" in data["location_name"]
    assert "122.60" in data["location_name"]
    assert "current" in data
    assert len(data["forecast"]) == 16


def test_point_weather_location_name_format(client, open_meteo):
    """Name should encode N/S and E/W correctly for all quadrants."""
    open_meteo.respond(forecast_payload())
    cases = [
        (48.29, -122.60, "N", "W"),
        (-33.87, 151.21, "S", "E"),
        (1.0, -1.0, "N", "W"),
        (-1.0, 1.0, "S", "E"),
    ]
    for lat, lon, expected_lat_hem, expected_lon_hem in cases:
        resp = client.get(f"/api/weather/point?lat={lat}&lon={lon}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["cached"] is False  # every case is a distinct point
        name = data["location_name"]
        assert expected_lat_hem in name, f"Expected {expected_lat_hem} in '{name}' (lat={lat})"
        assert expected_lon_hem in name, f"Expected {expected_lon_hem} in '{name}' (lon={lon})"


def test_point_weather_distinct_points_not_shared(client, open_meteo):
    open_meteo.respond(forecast_payload())
    a = client.get("/api/weather/point?lat=48.78&lon=-121.94").json()
    b = client.get("/api/weather/point?lat=48.10&lon=-123.20").json()
    assert a["cached"] is False and b["cached"] is False
    assert a["location_name"] != b["location_name"]
    assert (a["latitude"], a["longitude"]) == (48.78, -121.94)
    assert (b["latitude"], b["longitude"]) == (48.10, -123.20)
    assert open_meteo.call_count == 2


def test_point_weather_same_point_cached(client, open_meteo):
    open_meteo.respond(forecast_payload())
    first = client.get(POINT).json()
    second = client.get(POINT).json()
    assert open_meteo.call_count == 1  # second call did not reach Open-Meteo
    assert first["cached"] is False
    assert second["cached"] is True
    assert second["location_name"] == first["location_name"]
    assert second["latitude"] == 48.78 and second["longitude"] == -121.94


def test_saved_location_still_uses_weather_cache(client, open_meteo):
    loc_id = client.get("/api/locations").json()[0]["id"]
    open_meteo.respond(forecast_payload())
    client.get(f"/api/weather?location_id={loc_id}&model=best_match")
    conn = get_db_connection()
    rows = conn.execute("SELECT COUNT(*) AS n FROM weather_cache WHERE location_id = ?;", (loc_id,)).fetchone()
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


def test_point_weather_forwards_model(client, open_meteo):
    """The model query param must reach the Open-Meteo request."""
    open_meteo.respond(forecast_payload())
    resp = client.get("/api/weather/point?lat=48.0&lon=-122.0&model=gfs_seamless")
    assert resp.status_code == 200
    assert open_meteo.last_params.get("models") == "gfs_seamless"


def test_first_forecast_slice_uses_current_conditions(client, open_meteo):
    """SCRUM-89: forecast[0] must be the Open-Meteo 'current' values, not the hourly value."""
    open_meteo.respond(
        forecast_payload(time="2026-11-12T12:15", wind_speed_10m=18.0, wind_direction_10m=250, temperature_2m=9.0)
    )
    data = client.get(POINT).json()
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


# ---------------------------------------------------------------------------
# SCRUM-92 phase 1: specific error handling
# ---------------------------------------------------------------------------


def test_location_weather_upstream_failure_is_502_without_internal_detail(client, open_meteo):
    loc_id = client.get("/api/locations").json()[0]["id"]
    open_meteo.fail(upstream_error())
    resp = client.get(f"/api/weather?location_id={loc_id}")
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch weather forecast"
    assert "secret-host" not in resp.text


def test_point_weather_upstream_failure_is_502_without_internal_detail(client, open_meteo):
    open_meteo.fail(upstream_error())
    resp = client.get("/api/weather/point?lat=48.0&lon=-122.0")
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch point weather forecast"
    assert "secret-host" not in resp.text


def test_programming_errors_are_500_not_502():
    """Non-HTTP errors (bugs) must not be reported as an upstream failure."""
    with (
        TestClient(app, raise_server_exceptions=False) as c,
        patch("backend.app.routers.weather.get_point_forecast", side_effect=KeyError("bug")),
    ):
        resp = c.get("/api/weather/point?lat=48.0&lon=-122.0")
    assert resp.status_code == 500


def test_all_weather_skips_and_logs_failed_location(client, open_meteo, caplog):
    open_meteo.fail(upstream_error())
    with caplog.at_level("ERROR", logger="backend.app.routers.weather"):
        resp = client.get("/api/weather/all")
    assert resp.status_code == 200
    assert resp.json() == []
    assert "skipping" in caplog.text


# ---------------------------------------------------------------------------
# SCRUM-92 phase 3: model validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/weather?location_id=1&model=not_a_model",
        "/api/weather/all?model=not_a_model",
        "/api/weather/point?lat=48&lon=-122&model=not_a_model",
        "/api/weather/grid?min_lat=47&max_lat=48&min_lon=-123&max_lon=-122&cols=2&rows=2&model=not_a_model",
    ],
)
def test_unknown_model_is_rejected_without_calling_open_meteo(client, open_meteo, path):
    resp = client.get(path)
    assert resp.status_code == 422
    assert "best_match" in resp.json()["detail"]
    assert open_meteo.call_count == 0


def test_every_listed_model_is_accepted(client, open_meteo):
    open_meteo.respond(forecast_payload())
    # NDFD is served by its own provider, so it answers from recorded payloads in
    # test_nws_prototype.py rather than from this Open-Meteo stub (SCRUM-245 prototype).
    models = [m["id"] for m in client.get("/api/weather/models").json() if m["id"] != "nws_ndfd"]
    for model in models:
        assert client.get(f"/api/weather/point?lat=48&lon=-122&model={model}").status_code == 200


def test_invalid_json_from_open_meteo_is_502(client, monkeypatch):
    async def fake_get(self, url, **kwargs):
        return httpx.Response(200, content=b"<html>", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    resp = client.get("/api/weather/point?lat=48&lon=-122")
    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# SCRUM-92 phase 4: forecast caches are keyed by timezone
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/weather?location_id=1", "/api/weather/point?lat=48.78&lon=-121.94"])
def test_changing_timezone_does_not_serve_the_other_timezones_cache(client, open_meteo, path):
    """Hourly times come back in the requested timezone; a cached Pacific forecast must
    not be returned for UTC (it was, for up to 30 minutes)."""
    open_meteo.respond(forecast_payload())

    pacific = client.get(f"{path}&timezone=America/Los_Angeles").json()
    utc = client.get(f"{path}&timezone=UTC").json()
    utc_again = client.get(f"{path}&timezone=UTC").json()

    assert pacific["cached"] is False
    assert utc["cached"] is False and utc["timezone"] == "UTC"
    assert open_meteo.call_count == 2
    assert open_meteo.last_params["timezone"] == "UTC"
    assert utc_again["cached"] is True and utc_again["timezone"] == "UTC"


def test_saved_location_cache_hit_reports_current_location_details(client, open_meteo):
    """Identity fields come from the request, not the cached payload."""
    from backend.app.database import db_connection

    open_meteo.respond(forecast_payload())
    client.get("/api/weather?location_id=1")
    with db_connection() as conn:
        conn.execute("UPDATE locations SET name = 'Renamed' WHERE id = 1;")

    hit = client.get("/api/weather?location_id=1").json()

    assert hit["cached"] is True
    assert hit["location_name"] == "Renamed"


# ---------------------------------------------------------------------------
# Logging (SCRUM-253)
# ---------------------------------------------------------------------------


def test_point_weather_failure_logs_the_exception_but_not_the_point(client, open_meteo, caplog):
    open_meteo.fail(upstream_status_error("https://api.open-meteo.com/v1/forecast?latitude=48.0&longitude=-122.0"))

    with caplog.at_level("DEBUG", logger="backend.app.routers.weather"):
        resp = client.get("/api/weather/point?lat=48.0&lon=-122.0")

    assert resp.status_code == 502
    assert "HTTPStatusError" in caplog.text
    assert "48.0" not in caplog.text
    assert "-122.0" not in caplog.text


def test_an_unknown_timezone_is_rejected_before_any_upstream_call(client, open_meteo):
    # A free-form zone used to reach Open-Meteo (a 502 from a client mistake), add a cache row per
    # string, and crash the NWS parser's ZoneInfo lookup with a 500 (SCRUM-271).
    response = client.get(
        "/api/weather/point",
        params={"lat": 48.29, "lon": -122.61, "timezone": "Bogus/Zone"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown timezone"
    assert open_meteo.call_count == 0


def test_an_unknown_timezone_is_rejected_for_ndfd_too(client, open_meteo):
    response = client.get(
        "/api/weather/point",
        params={"lat": 48.29, "lon": -122.61, "timezone": "Bogus/Zone", "model": "nws_ndfd"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown timezone"
    assert open_meteo.call_count == 0


def test_a_valid_timezone_still_reaches_the_upstream(client, open_meteo):
    open_meteo.respond(forecast_payload())

    response = client.get(
        "/api/weather/point",
        params={"lat": 48.29, "lon": -122.61, "timezone": "America/New_York"},
    )

    assert response.status_code == 200
    assert open_meteo.call_count == 1
