"""NWS NDFD provider (SCRUM-106): parser, endpoint, grid cache, retries and coverage.

Every payload is recorded under `fixtures/nws/`, so nothing here reaches the network: the
autouse `open_meteo` stub in conftest replaces `httpx.AsyncClient.get` and is told what to answer,
which is also how the two NDFD requests (`/points`, then `/gridpoints`) are served in order.
"""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import config
from backend.app.database import db_connection
from backend.app.main import app
from backend.app.services import open_meteo
from backend.app.services.nws_parser import parse_nws_forecast
from factories import http_response

FIXTURES = Path(__file__).parent / "fixtures" / "nws"
POINTS_FILE = "points-oak-harbor.json"
GRID_FILE = "gridpoints-sew-123-102.json"

# The recorded grid runs from 2026-11-25T13:00Z for 7.5 days, so both clocks are frozen inside it.
FROZEN_NOW = datetime(2026, 11, 25, 20, tzinfo=UTC)
FIXED_HOUR = datetime(2026, 11, 26, 2, tzinfo=UTC)
LATER_HOUR = "2026-11-26T05:00:00Z"


def recorded(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


class _FrozenDatetime(datetime):
    """`datetime` whose `now()` is fixed, so the hour validation never drifts past the payload."""

    @classmethod
    def now(cls, tz=None):
        return FROZEN_NOW.astimezone(tz) if tz else FROZEN_NOW.replace(tzinfo=None)


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch):
    monkeypatch.setattr("backend.app.services.time_window.datetime", _FrozenDatetime)


# ---------------------------------------------------------------------------
# Parser (pure)
# ---------------------------------------------------------------------------


def test_parser_maps_a_slice_from_the_recorded_grid():
    parsed = parse_nws_forecast(recorded(GRID_FILE), at=FIXED_HOUR, timezone="America/Los_Angeles")

    assert len(parsed.points) == 16
    first = parsed.points[0]
    assert first.time == "2026-11-25T18:00"  # 02:00Z is 18:00 PST
    assert first.wind_speed_knots == pytest.approx(23.0, abs=0.1)  # 42.596 km/h
    assert first.wind_gust_knots == pytest.approx(31.0, abs=0.1)  # 57.412 km/h
    assert first.wind_direction_deg == 150.0
    assert first.wind_direction_cardinal == "SSE"
    assert first.temperature_c == pytest.approx(12.2, abs=0.1)
    assert first.temperature_f == pytest.approx(54.0, abs=0.1)
    assert first.humidity == 85.0
    assert parsed.valid_time == "2026-11-25T18:00"
    assert parsed.current is parsed.points[0]


def test_parser_repeats_a_long_period_instead_of_averaging():
    """A 15-hour wind period starts at 2026-11-28T03:00Z in this recording."""
    parsed = parse_nws_forecast(recorded(GRID_FILE), at=datetime(2026, 11, 28, 3, tzinfo=UTC), timezone="UTC")

    speeds = [point.wind_speed_knots for point in parsed.points[:5]]
    assert speeds == [pytest.approx(2.0, abs=0.1)] * 5  # 3.704 km/h held across five slices


def test_parser_keeps_missing_fields_missing():
    grid = {
        "properties": {
            "windSpeed": {"values": [{"validTime": "2026-11-26T00:00:00+00:00/PT3H", "value": 18.52}]},
        }
    }

    parsed = parse_nws_forecast(grid, at=datetime(2026, 11, 26, 0, tzinfo=UTC), timezone="UTC")

    assert len(parsed.points) == 16
    assert parsed.points[0].wind_speed_knots == pytest.approx(10.0)
    assert parsed.points[0].wind_gust_knots is None
    assert parsed.points[0].wind_direction_deg is None
    assert parsed.points[0].temperature_c is None
    # NDFD's humidity grid can gap; null means "not reported", never 0 % (SCRUM-106).
    assert parsed.points[0].humidity is None
    assert parsed.points[1].wind_speed_knots is None  # no period covers 03:00


# ---------------------------------------------------------------------------
# Endpoint and caches
# ---------------------------------------------------------------------------


def test_endpoint_serves_a_us_point_with_the_unchanged_response(client, open_meteo):
    open_meteo.respond_sequence(recorded(POINTS_FILE), recorded(GRID_FILE))
    location_id = client.get("/api/locations").json()[0]["id"]

    resp = client.get(
        f"/api/weather?location_id={location_id}&model=nws_ndfd&time=2026-11-26T02:00:00Z&timezone=America/Los_Angeles"
    )

    assert resp.status_code == 200
    body = resp.json()
    # The response shape is the one Open-Meteo already produces: nothing new, nothing renamed.
    assert set(body) == {
        "location_id",
        "location_name",
        "latitude",
        "longitude",
        "model",
        "timezone",
        "cached",
        "cached_at",
        "current",
        "forecast",
        "valid_time",
    }
    assert body["model"] == "nws_ndfd"
    assert body["valid_time"] == "2026-11-25T18:00"
    assert len(body["forecast"]) == 16
    assert body["forecast"][0]["wind_speed_knots"] == pytest.approx(23.0, abs=0.1)
    assert body["current"]["wind_direction_cardinal"] == "SSE"
    assert body["forecast"][0]["time"] == "2026-11-25T18:00"

    # /points then /gridpoints, in that order.
    assert open_meteo.call_count == 2
    assert open_meteo.calls[0]["url"].endswith("/points/48.2939,-122.6064")
    assert open_meteo.calls[1]["url"].endswith("/gridpoints/SEW/123,102")

    # The second request is served from the SQLite forecast cache, so the provider is not asked.
    again = client.get(
        f"/api/weather?location_id={location_id}&model=nws_ndfd&time=2026-11-26T02:00:00Z&timezone=America/Los_Angeles"
    )
    assert again.json()["cached"] is True
    assert open_meteo.call_count == 2


def test_grid_mapping_is_stored_once_and_reused_for_other_hours(client, open_meteo):
    """A different hour misses the forecast cache but still skips `/points` (SCRUM-106)."""
    open_meteo.respond_sequence(recorded(POINTS_FILE), recorded(GRID_FILE), recorded(GRID_FILE))
    location_id = client.get("/api/locations").json()[0]["id"]

    client.get(f"/api/weather?location_id={location_id}&model=nws_ndfd&time=2026-11-26T02:00:00Z")
    later = client.get(f"/api/weather?location_id={location_id}&model=nws_ndfd&time={LATER_HOUR}")

    assert later.status_code == 200
    assert later.json()["cached"] is False  # a new hour, so the forecast cache missed
    assert open_meteo.call_count == 3
    assert open_meteo.calls[2]["url"].endswith("/gridpoints/SEW/123,102")

    with db_connection() as conn:
        row = conn.execute("SELECT office, grid_x, grid_y FROM nws_grid_cache;").fetchone()
    assert (row["office"], row["grid_x"], row["grid_y"]) == ("SEW", 123, 102)


def test_outside_coverage_is_404_not_502(client, open_meteo):
    open_meteo.respond(
        {
            "type": "https://api.weather.gov/problems/InvalidPoint",
            "status": 404,
            "detail": "Unable to provide data for requested point 49.2827,-123.1207",
        },
        status=404,
    )

    resp = client.get("/api/weather/point?lat=49.2827&lon=-123.1207&model=nws_ndfd")

    assert resp.status_code == 404
    assert "United States" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Retries and error mapping
# ---------------------------------------------------------------------------


def test_transient_503_is_retried(client, monkeypatch):
    responses = [
        http_response({}, status=503),
        http_response(recorded(POINTS_FILE)),
        http_response(recorded(GRID_FILE)),
    ]

    async def fake_get(self, url, **kwargs):
        return responses.pop(0)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("backend.app.services.nws.retry_delay", lambda response, attempt: 0.0)

    location_id = client.get("/api/locations").json()[0]["id"]
    resp = client.get(f"/api/weather?location_id={location_id}&model=nws_ndfd&time=2026-11-26T02:00:00Z")

    assert resp.status_code == 200
    assert responses == []  # the retry consumed the 503 and both documents


def test_persistent_503_becomes_a_502_without_internal_detail(client, monkeypatch):
    async def fake_get(self, url, **kwargs):
        return http_response({"detail": "secret-host.internal refused"}, status=503)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("backend.app.services.nws.retry_delay", lambda response, attempt: 0.0)

    resp = client.get("/api/weather/point?lat=48.2939&lon=-122.6064&model=nws_ndfd")

    assert resp.status_code == 502
    assert "secret-host" not in resp.text


# ---------------------------------------------------------------------------
# Model registration
# ---------------------------------------------------------------------------


def test_model_is_listed_with_the_spike_horizon(client):
    models = {m["id"]: m for m in client.get("/api/weather/models").json()}

    assert models["nws_ndfd"]["name"] == "NOAA NWS NDFD"
    assert models["nws_ndfd"]["horizon_hours"] == 168
    assert models["nws_ndfd"]["update_hours"] == 1
    assert models["nws_ndfd"]["update_cycles_utc"] == list(range(24))


def test_wind_grid_never_sends_the_ndfd_id_to_open_meteo():
    """NDFD cannot serve the grid, so the grid keeps asking Open-Meteo for its default."""
    assert "models" not in open_meteo.forecast_params("nws_ndfd")
    assert open_meteo.forecast_params("gfs_seamless")["models"] == "gfs_seamless"


# ---------------------------------------------------------------------------
# User-Agent (SCRUM-255)
# ---------------------------------------------------------------------------


def test_user_agent_default_names_the_app_and_a_contact():
    agent = config.nws_user_agent("")

    assert "prototype" not in agent.lower()
    assert "github.com/amesclar/wind-map" in agent


def test_user_agent_uses_the_configured_value():
    assert config.nws_user_agent("  my-app/1.0 (ops@example.com)  ") == "my-app/1.0 (ops@example.com)"
    assert config.nws_user_agent("   ") == config.NWS_DEFAULT_USER_AGENT


def test_startup_warns_when_the_user_agent_is_unset(monkeypatch, caplog):
    monkeypatch.delenv("NWS_USER_AGENT", raising=False)

    with caplog.at_level(logging.WARNING, logger="backend.app.main"), TestClient(app):
        pass

    assert "NWS_USER_AGENT is not set" in caplog.text


def test_startup_is_quiet_when_the_user_agent_is_set(monkeypatch, caplog):
    monkeypatch.setenv("NWS_USER_AGENT", "wind-map/0.11 (ops@example.com)")

    with caplog.at_level(logging.WARNING, logger="backend.app.main"), TestClient(app):
        pass

    assert "NWS_USER_AGENT" not in caplog.text
