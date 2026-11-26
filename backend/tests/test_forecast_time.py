"""Tests for forecast-time support (SCRUM-115): model metadata, `time` validation and hourly data."""

from datetime import UTC, datetime, timedelta

import pytest

from backend.app.config import MODEL_IDS, MODEL_METADATA, model_horizon_days, model_horizon_hours
from backend.app.services.model_info import floor_hour, last_run_utc, next_run_utc
from backend.app.services.time_window import hour_key
from factories import forecast_payload_for_hour, grid_hourly_item, grid_payload

BBOX = {"min_lat": 47.0, "max_lat": 49.0, "min_lon": -123.0, "max_lon": -121.0}


def grid_params(**overrides) -> dict:
    return {**BBOX, "cols": 2, "rows": 2, **overrides}


def future_hour(hours: int = 2) -> datetime:
    """An hour-aligned UTC time inside every model's window."""
    return floor_hour(datetime.now(UTC)) + timedelta(hours=hours)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Cycle maths
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 23, 13, 45, tzinfo=UTC), datetime(2026, 11, 23, 12, tzinfo=UTC)),
        (datetime(2026, 11, 23, 12, 0, tzinfo=UTC), datetime(2026, 11, 23, 12, tzinfo=UTC)),
        (datetime(2026, 11, 23, 5, 59, tzinfo=UTC), datetime(2026, 11, 23, 0, tzinfo=UTC)),
        # The 00 UTC cycle keeps the wrap honest: just after midnight the run is today's 00.
        (datetime(2026, 11, 23, 1, 0, tzinfo=UTC), datetime(2026, 11, 23, 0, tzinfo=UTC)),
    ],
)
def test_last_run_utc(now, expected):
    assert last_run_utc([0, 6, 12, 18], now) == expected


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 23, 13, 45, tzinfo=UTC), datetime(2026, 11, 23, 18, tzinfo=UTC)),
        (datetime(2026, 11, 23, 12, 0, tzinfo=UTC), datetime(2026, 11, 23, 18, tzinfo=UTC)),
        # Midnight wrap: the next cycle is today at 00.
        (datetime(2026, 11, 23, 19, 0, tzinfo=UTC), datetime(2026, 11, 24, 0, tzinfo=UTC)),
    ],
)
def test_next_run_utc(now, expected):
    assert next_run_utc([0, 6, 12, 18], now) == expected


def test_last_run_wraps_when_there_is_no_midnight_cycle():
    now = datetime(2026, 11, 23, 1, 0, tzinfo=UTC)
    assert last_run_utc([6, 12, 18], now) == datetime(2026, 11, 22, 18, tzinfo=UTC)


def test_hourly_model_has_every_hour_as_a_cycle():
    now = datetime(2026, 11, 23, 13, 45, tzinfo=UTC)
    assert last_run_utc(MODEL_METADATA["best_match"]["update_cycles_utc"], now) == datetime(
        2026, 11, 23, 13, tzinfo=UTC
    )
    assert next_run_utc(MODEL_METADATA["best_match"]["update_cycles_utc"], now) == datetime(
        2026, 11, 23, 14, tzinfo=UTC
    )


# ---------------------------------------------------------------------------
# /api/weather/models
# ---------------------------------------------------------------------------


def test_models_expose_cadence_horizon_and_run_times(client):
    models = {m["id"]: m for m in client.get("/api/weather/models").json()}

    assert set(models) == set(MODEL_METADATA)
    gfs = models["gfs_seamless"]
    assert gfs["horizon_hours"] == 384
    assert gfs["update_hours"] == 6
    assert gfs["update_cycles_utc"] == [0, 6, 12, 18]
    assert gfs["last_run_utc"].endswith("Z") and gfs["next_run_utc"].endswith("Z")
    assert gfs["last_run_utc"] < gfs["next_run_utc"]

    aifs = models["ecmwf_aifs025_single"]
    assert aifs["horizon_hours"] == 360
    assert aifs["update_hours"] == 6
    assert aifs["update_cycles_utc"] == [0, 6, 12, 18]

    gem = models["gem_seamless"]
    assert gem["horizon_hours"] == 240
    assert gem["update_hours"] == 6
    assert gem["update_cycles_utc"] == [0, 6, 12, 18]

    rrfs = models["ncep_rrfs_north_america"]
    assert rrfs["name"] == "RRFS (North America)"
    assert rrfs["horizon_hours"] == 84
    assert rrfs["update_hours"] == 6
    assert rrfs["update_cycles_utc"] == [0, 6, 12, 18]


def test_model_metadata_is_the_source_of_truth():
    """Cadence and horizon live in config now that the static guide table is gone (SCRUM-232)."""
    assert set(MODEL_METADATA) == MODEL_IDS

    # best_match is a composite: Open-Meteo's documented 7-day default, not a single model.
    assert model_horizon_hours("best_match") == 168

    for model_id, meta in MODEL_METADATA.items():
        assert int(meta["update_hours"]) >= 1, model_id
        cycles = [int(c) for c in meta["update_cycles_utc"]]  # type: ignore[union-attr]
        assert cycles and all(0 <= cycle < 24 for cycle in cycles), model_id
        assert model_horizon_hours(model_id) > 0, model_id


@pytest.mark.parametrize(
    ("model", "days"),
    [
        ("best_match", 7),
        ("ecmwf_ifs", 15),
        ("ecmwf_aifs025_single", 15),
        ("gfs_seamless", 16),
        ("gem_seamless", 10),
        ("ncep_rrfs_north_america", 4),
        ("icon_seamless", 8),
    ],
)
def test_horizon_days_cover_the_window(model, days):
    assert model_horizon_days(model) == days


# ---------------------------------------------------------------------------
# Validation of ?time=
# ---------------------------------------------------------------------------


def test_grid_time_rejects_a_past_hour(client):
    past = floor_hour(datetime.now(UTC)) - timedelta(hours=1)
    resp = client.get("/api/weather/grid", params=grid_params(time=iso(past)))
    assert resp.status_code == 422
    assert "past" in resp.json()["detail"]


def test_grid_time_rejects_a_misaligned_hour(client):
    resp = client.get("/api/weather/grid", params=grid_params(time=iso(future_hour()) + ".5"))
    assert resp.status_code == 422


def test_grid_time_rejects_a_naive_time(client):
    naive = future_hour().replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%S")
    resp = client.get("/api/weather/grid", params=grid_params(time=naive))
    assert resp.status_code == 422
    assert "timezone offset" in resp.json()["detail"]


def test_grid_time_respects_each_models_horizon(client, open_meteo):
    far = future_hour(hours=200)  # beyond ICON's 180 h, inside GFS's 384 h
    open_meteo.respond(grid_payload(*[grid_hourly_item(iso(far)[:16]) for _ in range(4)]))

    rejected = client.get("/api/weather/grid", params=grid_params(time=iso(far), model="icon_seamless"))
    assert rejected.status_code == 422
    assert "horizon" in rejected.json()["detail"]

    accepted = client.get("/api/weather/grid", params=grid_params(time=iso(far), model="gfs_seamless"))
    assert accepted.status_code == 200


# ---------------------------------------------------------------------------
# Grid values for a requested hour
# ---------------------------------------------------------------------------


def test_grid_time_serves_that_hours_values_and_caches_per_hour(client, open_meteo):
    hour = future_hour()
    hour_iso = hour.strftime("%Y-%m-%dT%H:00")
    open_meteo.respond(
        grid_payload(*[grid_hourly_item(hour_iso, speed=12.0, direction=250.0, temp_c=15.0) for _ in range(4)])
    )

    first = client.get("/api/weather/grid", params=grid_params(time=iso(hour)))
    assert first.status_code == 200
    body = first.json()
    assert len(body) == 4
    assert body[0]["wind_speed_knots"] == 12.0
    assert body[0]["wind_direction_deg"] == 250.0
    assert body[0]["time"] == hour_iso
    calls = open_meteo.call_count

    # Same hour again: served from the cache.
    again = client.get("/api/weather/grid", params=grid_params(time=iso(hour)))
    assert again.status_code == 200
    assert open_meteo.call_count == calls

    # Other hours of that day are cached by the same response (SCRUM-166); the same-day cases
    # and the cross-day boundary are covered in test_grid.py.


def test_grid_time_rejects_an_hour_past_rrfs_horizon(client):
    """RRFS stops at 84 h even though the endpoint allows longer windows (SCRUM-231)."""
    resp = client.get(
        "/api/weather/grid", params=grid_params(time=iso(future_hour(hours=90)), model="ncep_rrfs_north_america")
    )
    assert resp.status_code == 422
    assert "horizon" in resp.json()["detail"]


def test_grid_time_rejects_an_hour_past_gems_horizon(client):
    """GEM seamless stops at 10 days even though the endpoint allows longer windows (SCRUM-228)."""
    far = future_hour(hours=250)
    resp = client.get("/api/weather/grid", params=grid_params(time=iso(far), model="gem_seamless"))
    assert resp.status_code == 422
    assert "horizon" in resp.json()["detail"]


def test_grid_without_time_still_serves_current_conditions(client, open_meteo):
    from factories import grid_item

    open_meteo.respond(grid_payload(*[grid_item(7.0, 90.0) for _ in range(4)]))
    body = client.get("/api/weather/grid", params=grid_params()).json()
    assert body[0]["wind_speed_knots"] == 7.0
    assert body[0]["time"] is None
    assert "current" in open_meteo.last_params


def test_hour_key_marks_live_values():
    assert hour_key(None) == "current"
    assert hour_key(datetime(2026, 11, 23, 12, tzinfo=UTC)) == "2026-11-23T12:00"


# ---------------------------------------------------------------------------
# Saved-location markers for a requested hour
# ---------------------------------------------------------------------------


def test_forecast_at_hour_returns_that_hour_for_markers(client, open_meteo):
    hour = future_hour()
    hour_iso = hour.strftime("%Y-%m-%dT%H:00")
    open_meteo.respond(forecast_payload_for_hour(hour_iso, speed=9.0))

    resp = client.get("/api/weather/all", params={"time": iso(hour), "timezone": "UTC"})
    assert resp.status_code == 200
    body = resp.json()[0]
    assert body["valid_time"] == hour_iso
    assert body["current"]["time"] == hour_iso
    assert body["current"]["wind_speed_knots"] == 9.0

    calls = open_meteo.call_count
    client.get("/api/weather/all", params={"time": iso(hour), "timezone": "UTC"})
    assert open_meteo.call_count == calls  # cached per hour


def test_forecast_at_hour_beyond_horizon_is_rejected(client):
    resp = client.get("/api/weather/all", params={"time": iso(future_hour(hours=200)), "model": "icon_seamless"})
    assert resp.status_code == 422
