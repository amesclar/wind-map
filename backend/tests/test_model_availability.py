"""Open-Meteo publication times (SCRUM-256): mapping, parsing, cache and endpoint."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from backend.app.services import model_availability
from backend.app.services.model_availability import Availability, parse_meta

RUN = datetime(2026, 11, 25, 12, tzinfo=UTC)
AVAILABLE = datetime(2026, 11, 25, 18, 17, tzinfo=UTC)
INTERVAL = 6 * 3600

META = {
    "last_run_initialisation_time": RUN.timestamp(),
    "last_run_availability_time": AVAILABLE.timestamp(),
    "last_run_modification_time": AVAILABLE.timestamp(),
    "update_interval_seconds": INTERVAL,
    "temporal_resolution_seconds": 3600,
}

RUN_ISO = "2026-11-25T12:00:00Z"
PUBLISHED = "2026-11-25T18:17:00Z"
NEXT_PUBLISHED = "2026-11-26T00:17:00Z"


@pytest.fixture(autouse=True)
def _empty_cache():
    """The cache is module state; a test must not inherit another test's answer."""
    model_availability.reset_cache()
    yield
    model_availability.reset_cache()


# ---------------------------------------------------------------------------
# Mapping and parsing (pure)
# ---------------------------------------------------------------------------


def test_mapping_names_only_models_with_one_upstream_run():
    assert model_availability.meta_model("gfs_seamless") == "ncep_gfs025"
    assert model_availability.meta_model("ecmwf_ifs") == "ecmwf_ifs025"
    assert model_availability.meta_model("ecmwf_aifs025_single") == "ecmwf_aifs025_single"
    assert model_availability.meta_model("icon_seamless") == "dwd_icon"
    # Composites have no single run, and GEM's metadata has been frozen since 2026-05-26.
    for model in ("best_match", "gem_seamless", "nws_ndfd"):
        assert model_availability.meta_model(model) is None


def test_parse_reads_the_run_its_publication_and_the_next_one():
    assert parse_meta(META) == Availability(run_utc=RUN_ISO, available_utc=PUBLISHED, next_available_utc=NEXT_PUBLISHED)


def test_parse_without_an_interval_reports_the_two_instants_it_has():
    without_interval = {k: v for k, v in META.items() if k != "update_interval_seconds"}
    assert parse_meta(without_interval) == Availability(
        run_utc=RUN_ISO, available_utc=PUBLISHED, next_available_utc=None
    )


def test_parse_rejects_bodies_that_are_not_a_pair_of_times():
    assert parse_meta({}) is None
    assert parse_meta("not json") is None
    assert parse_meta([]) is None
    assert parse_meta({"last_run_availability_time": AVAILABLE.timestamp()}) is None
    assert parse_meta({**META, "last_run_initialisation_time": 0}) is None
    assert parse_meta({**META, "last_run_availability_time": "yesterday"}) is None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


def test_endpoint_returns_the_publication_times(client, open_meteo):
    open_meteo.respond(META)

    body = client.get("/api/weather/models/gfs_seamless/availability").json()

    assert body == {
        "model": "gfs_seamless",
        "run_utc": RUN_ISO,
        "available_utc": PUBLISHED,
        "next_available_utc": NEXT_PUBLISHED,
    }
    assert open_meteo.calls[0]["url"] == "https://api.open-meteo.com/data/ncep_gfs025/static/meta.json"


def test_endpoint_answers_empty_fields_without_a_call_for_a_composite(client, open_meteo):
    body = client.get("/api/weather/models/best_match/availability").json()

    assert body == {"model": "best_match", "run_utc": None, "available_utc": None, "next_available_utc": None}
    assert open_meteo.call_count == 0


def test_endpoint_rejects_an_unknown_model(client, open_meteo):
    response = client.get("/api/weather/models/no_such_model/availability")

    assert response.status_code == 404
    assert open_meteo.call_count == 0


def test_endpoint_resolves_a_retired_id(client, open_meteo):
    open_meteo.respond(META)

    body = client.get("/api/weather/models/ecmwf_ifs04/availability").json()

    assert body["model"] == "ecmwf_ifs"
    assert open_meteo.calls[0]["url"] == "https://api.open-meteo.com/data/ecmwf_ifs025/static/meta.json"


@pytest.mark.parametrize("status", [404, 500, 503])
def test_a_failing_metadata_file_is_an_empty_answer_not_an_error(client, open_meteo, status):
    open_meteo.respond({"detail": "nope"}, status=status)

    response = client.get("/api/weather/models/icon_seamless/availability")

    assert response.status_code == 200
    assert response.json()["available_utc"] is None


def test_a_timeout_is_an_empty_answer_too(client, open_meteo):
    open_meteo.fail(httpx.ReadTimeout("slow metadata"))

    response = client.get("/api/weather/models/icon_seamless/availability")

    assert response.status_code == 200
    assert response.json()["run_utc"] is None


def test_the_answer_is_cached_for_ten_minutes(client, open_meteo):
    open_meteo.respond(META)

    first = client.get("/api/weather/models/gfs_seamless/availability").json()
    second = client.get("/api/weather/models/gfs_seamless/availability").json()

    assert first == second
    assert open_meteo.call_count == 1


def test_a_failure_is_cached_too(client, open_meteo):
    open_meteo.respond({"detail": "broken"}, status=500)

    client.get("/api/weather/models/gfs_seamless/availability")
    client.get("/api/weather/models/gfs_seamless/availability")

    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_the_cache_expires_after_ten_minutes(open_meteo, monkeypatch):
    monkeypatch.setattr("backend.app.services.model_availability.time.time", lambda: 1000.0)
    open_meteo.respond(META)

    await model_availability.availability_for("gfs_seamless")
    assert open_meteo.call_count == 1

    # Still inside the window: served from the cache.
    assert await model_availability.availability_for("gfs_seamless") is not None
    assert open_meteo.call_count == 1

    later = META | {"last_run_availability_time": (AVAILABLE + timedelta(hours=6)).timestamp()}
    open_meteo.respond(later)
    monkeypatch.setattr("backend.app.services.model_availability.time.time", lambda: 1000.0 + 601)

    refreshed = await model_availability.availability_for("gfs_seamless")

    assert open_meteo.call_count == 2
    assert refreshed is not None
    assert refreshed.available_utc == "2026-11-26T00:17:00Z"


def test_models_list_is_unchanged_and_makes_no_upstream_call(client, open_meteo):
    models = {m["id"]: m for m in client.get("/api/weather/models").json()}

    assert "available_utc" not in models["gfs_seamless"]
    assert models["gfs_seamless"]["last_run_utc"].endswith("Z")
    assert open_meteo.call_count == 0
