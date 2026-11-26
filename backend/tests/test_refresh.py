"""The refresh gate (SCRUM-113): a click refetches only what predates the newest published run."""

import time
from datetime import UTC, datetime

import pytest

from backend.app.database import db_connection
from backend.app.services import grid_weather_service, model_availability, weather_service
from backend.app.services.forecast_cache import is_stale
from backend.app.services.grid_box import grid_points
from backend.app.units import coord_key
from factories import forecast_payload, grid_item, grid_payload

POINT = "/api/weather/point?lat=48.78&lon=-121.94"
BBOX = "min_lat=47&max_lat=49&min_lon=-123&max_lon=-121&cols=2&rows=2"


def clock_at(seconds: float):
    """A stand-in for the publication clock, so a test decides what "newest run" means."""

    async def fake(_model: str) -> datetime:
        return datetime.fromtimestamp(seconds, UTC)

    return fake


@pytest.fixture(autouse=True)
def _empty_availability_cache():
    model_availability.reset_cache()
    yield
    model_availability.reset_cache()


# ---------------------------------------------------------------------------
# The staleness rule itself
# ---------------------------------------------------------------------------


def test_staleness_only_judges_a_row_against_a_known_run():
    assert is_stale(100.0, 200.0) is True
    assert is_stale(200.0, 200.0) is False
    # No clock: the refresh is served from cache, as it was before this gate existed.
    assert is_stale(100.0, None) is False


# ---------------------------------------------------------------------------
# The clock: published when known, derived otherwise
# ---------------------------------------------------------------------------

META = {
    "last_run_initialisation_time": datetime(2026, 11, 25, 12, tzinfo=UTC).timestamp(),
    "last_run_availability_time": datetime(2026, 11, 25, 18, 17, tzinfo=UTC).timestamp(),
    "update_interval_seconds": 6 * 3600,
}


@pytest.mark.asyncio
async def test_the_clock_prefers_the_published_time(open_meteo):
    open_meteo.respond(META)

    clock = await model_availability.refresh_clock("gfs_seamless")

    assert clock == datetime(2026, 11, 25, 18, 17, tzinfo=UTC)


@pytest.mark.asyncio
async def test_the_clock_falls_back_to_the_derived_cycle(open_meteo):
    # best_match has no metadata file at all.
    clock = await model_availability.refresh_clock("best_match")

    assert clock is not None
    assert clock.tzinfo is not None
    assert clock.minute == 0 and clock.second == 0


@pytest.mark.asyncio
async def test_a_metadata_outage_falls_back_too(open_meteo, monkeypatch):
    monkeypatch.setattr(
        model_availability,
        "availability_for",
        lambda _model: _failed(),
    )

    clock = await model_availability.refresh_clock("gfs_seamless")

    assert clock is not None


async def _failed():
    return None


# ---------------------------------------------------------------------------
# Endpoints: refresh bypasses only rows older than the run
# ---------------------------------------------------------------------------


def _prime_location(client, open_meteo) -> int:
    location_id = client.get("/api/locations").json()[0]["id"]
    open_meteo.respond(forecast_payload())
    first = client.get(f"/api/weather?location_id={location_id}&model=best_match").json()
    assert first["cached"] is False
    return location_id


def test_refresh_refetches_a_row_older_than_the_new_run(client, open_meteo, monkeypatch):
    location_id = _prime_location(client, open_meteo)
    before = client.get(f"/api/weather?location_id={location_id}&model=best_match").json()
    open_meteo.respond(forecast_payload())
    monkeypatch.setattr(weather_service, "refresh_clock", clock_at(time.time() + 60))

    after = client.get(f"/api/weather?location_id={location_id}&model=best_match&refresh=true").json()

    assert open_meteo.call_count == 2
    assert after["cached"] is False
    assert after["cached_at"] > before["cached_at"]


def test_refresh_is_ignored_for_a_row_newer_than_the_run(client, open_meteo, monkeypatch):
    """A stale tab sending the flag by hand must not be able to spend a pointless call."""
    location_id = _prime_location(client, open_meteo)
    monkeypatch.setattr(weather_service, "refresh_clock", clock_at(time.time() - 3600))

    body = client.get(f"/api/weather?location_id={location_id}&model=best_match&refresh=true").json()

    assert body["cached"] is True
    assert open_meteo.call_count == 1


def test_without_the_parameter_the_cache_behaves_as_before(client, open_meteo, monkeypatch):
    location_id = _prime_location(client, open_meteo)
    monkeypatch.setattr(weather_service, "refresh_clock", clock_at(time.time() + 60))

    body = client.get(f"/api/weather?location_id={location_id}&model=best_match").json()

    assert body["cached"] is True
    assert open_meteo.call_count == 1


def test_point_refresh_refetches_the_point(client, open_meteo, monkeypatch):
    open_meteo.respond(forecast_payload())
    client.get(POINT)
    open_meteo.respond(forecast_payload())
    monkeypatch.setattr(weather_service, "refresh_clock", clock_at(time.time() + 60))

    body = client.get(f"{POINT}&refresh=true").json()

    assert body["cached"] is False
    assert open_meteo.call_count == 2


def test_all_refreshes_every_marker(client, open_meteo, monkeypatch):
    open_meteo.respond(forecast_payload())
    markers = len(client.get("/api/weather/all?model=best_match").json())
    assert open_meteo.call_count == markers

    monkeypatch.setattr(weather_service, "refresh_clock", clock_at(time.time() + 60))
    refreshed = client.get("/api/weather/all?model=best_match&refresh=true").json()

    assert len(refreshed) == markers
    assert open_meteo.call_count == markers * 2


# ---------------------------------------------------------------------------
# The grid: one point stale, one point refetched
# ---------------------------------------------------------------------------


def _prime_grid(client, open_meteo) -> None:
    open_meteo.respond(grid_payload(*(grid_item(10.0, 180.0) for _ in range(4))))
    first = client.get(f"/api/weather/grid?{BBOX}&model=best_match")
    assert first.status_code == 200
    assert open_meteo.call_count == 1


def test_a_grid_refresh_refetches_only_the_stale_point(client, open_meteo, monkeypatch):
    _prime_grid(client, open_meteo)
    now = time.time()
    # The grid samples a lattice (SCRUM-267); age its first sample, whatever that coordinate is.
    first = grid_points(47.0, 49.0, -123.0, -121.0, 2, 2)[0]
    stale = coord_key(*first)
    with db_connection() as conn:
        conn.execute("UPDATE grid_weather_cache SET cached_at=?", (now + 600,))
        conn.execute(
            "UPDATE grid_weather_cache SET cached_at=? WHERE lat_key=? AND lon_key=?",
            (now - 600, *stale),
        )

    open_meteo.respond(grid_payload(grid_item(25.0, 90.0)))
    monkeypatch.setattr(grid_weather_service, "refresh_clock", clock_at(now))
    response = client.get(f"/api/weather/grid?{BBOX}&model=best_match&refresh=true")

    assert response.status_code == 200
    assert open_meteo.call_count == 2
    # Exactly one coordinate went upstream, and it is the stale one.
    assert open_meteo.last_params["latitude"] == str(first[0])
    points = response.json()
    assert len(points) == 4
    assert [p["wind_speed_knots"] for p in points].count(25.0) == 1
    assert [p["wind_speed_knots"] for p in points].count(10.0) == 3


def test_a_grid_refresh_with_nothing_stale_spends_no_call(client, open_meteo, monkeypatch):
    _prime_grid(client, open_meteo)
    now = time.time()
    with db_connection() as conn:
        conn.execute("UPDATE grid_weather_cache SET cached_at=?", (now + 600,))

    monkeypatch.setattr(grid_weather_service, "refresh_clock", clock_at(now))
    response = client.get(f"/api/weather/grid?{BBOX}&model=best_match&refresh=true")

    assert response.status_code == 200
    assert open_meteo.call_count == 1
    assert len(response.json()) == 4
