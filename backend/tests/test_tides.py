"""Tests for the tide service and endpoint (SCRUM-195)."""

from datetime import UTC, datetime, timedelta
from math import cos, pi

import httpx
import pytest

from backend.app.config import OPEN_METEO_MARINE_URL
from backend.app.database import db_connection
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.tide_service import (
    Height,
    derive_extremes,
    get_point_tide,
    window_hours,
)
from backend.app.services.time_window import hour_key
from factories import upstream_error, upstream_status_error

HOUR = datetime(2026, 11, 25, 12, tzinfo=UTC)
START = HOUR.replace(hour=0) - timedelta(days=1)


def stamps() -> list[str]:
    return [(START + timedelta(hours=step)).strftime("%Y-%m-%dT%H:%M") for step in range(72)]


def tide_payload(heights: list[float | None] | None = None) -> dict:
    """A 72-hour marine response covering the window around HOUR."""
    return {
        "hourly": {
            "time": stamps(),
            "sea_level_height_msl": [1.0] * 72 if heights is None else heights,
        }
    }


def sine_heights(peak_hour: float = 8.5) -> list[float]:
    """Two tides a day (12 h period) with the first high just after `peak_hour`."""
    return [round(cos(2 * pi * (step - peak_hour) / 12), 6) for step in range(72)]


def samples(heights: list[float]) -> list[Height]:
    return [Height(START + timedelta(hours=step), height) for step, height in enumerate(heights)]


# ---------------------------------------------------------------------------
# Unit: extremes
# ---------------------------------------------------------------------------


def test_window_covers_previous_selected_and_following_day():
    hours = window_hours(HOUR)
    assert len(hours) == 72
    assert hours[0] == "2026-11-24T00:00"
    assert hours[-1] == "2026-11-26T23:00"


def test_extreme_between_samples_is_refined_to_the_minute():
    last, following, after = derive_extremes(samples(sine_heights()), START + timedelta(hours=9))
    assert last is not None
    # The true high sits midway between the 08:00 and 09:00 samples.
    assert last.type == "high"
    assert last.time == "2026-11-24T08:30"
    assert last.height_m == pytest.approx(1.0, abs=0.01)
    assert following is not None and following.type == "low"
    assert after is not None and after.type == "high"
    assert after.time == "2026-11-24T20:30"


def test_last_and_next_extremes_bracket_the_selected_hour():
    last, following, after = derive_extremes(samples(sine_heights()), START + timedelta(hours=14))
    assert last is not None and last.type == "high"
    assert last.time == "2026-11-24T08:30"
    assert following is not None and following.type == "low"
    assert following.time == "2026-11-24T14:30"
    assert following.height_m < last.height_m
    assert after is not None and after.type == "high"
    assert after.time == "2026-11-24T20:30"


def test_flat_or_single_slope_series_has_no_extremes():
    flat = derive_extremes(samples([1.0] * 72), HOUR)
    assert flat == (None, None, None)
    rising = derive_extremes(samples([float(step) for step in range(72)]), HOUR)
    assert rising == (None, None, None)


def test_no_extreme_after_the_next_one_leaves_that_reading_empty():
    # One peak at 70:00, with the earlier hours deliberately flat.
    heights = [0.0] * 69 + [1.0, 2.0, 1.0]
    last, following, after = derive_extremes(samples(heights), START + timedelta(hours=69))
    assert last is None
    assert following is not None and following.type == "high"
    assert after is None


# ---------------------------------------------------------------------------
# Unit: get_point_tide
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_point_tide_returns_series_and_extremes(open_meteo):
    open_meteo.respond(tide_payload(sine_heights()))

    tide = await get_point_tide(48.4, -122.7, HOUR)

    assert tide.datum == "msl"
    assert tide.unit == "m"
    assert tide.hour == "2026-11-25T12:00"
    assert len(tide.points) == 72
    assert tide.points[0].time == "2026-11-24T00:00"
    assert tide.last_extreme is not None
    assert tide.next_extreme is not None
    assert tide.next_extreme_after is not None
    assert open_meteo.last_params["hourly"] == "sea_level_height_msl"
    assert open_meteo.last_params["start_date"] == "2026-11-24"
    assert open_meteo.last_params["end_date"] == "2026-11-26"


@pytest.mark.asyncio
async def test_inland_point_is_empty_and_cached(open_meteo):
    open_meteo.respond(tide_payload([None] * 72))

    first = await get_point_tide(47.6, -122.3, HOUR)
    second = await get_point_tide(47.6, -122.3, HOUR)

    assert first.points == []
    assert first.last_extreme is None and first.next_extreme is None
    assert second.points == []
    # The empty rows are a cached "checked, no water here": no second request.
    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_second_request_is_served_from_cache(open_meteo):
    open_meteo.respond(tide_payload(sine_heights()))

    await get_point_tide(48.4, -122.7, HOUR)
    again = await get_point_tide(48.4, -122.7, HOUR)

    assert len(again.points) == 72
    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_marine_response_without_times_is_an_upstream_error(open_meteo):
    open_meteo.respond({"hourly": {}})

    with pytest.raises(httpx.HTTPError):
        await get_point_tide(48.4, -122.7, HOUR)


# ---------------------------------------------------------------------------
# Endpoint: GET /api/tides/point
# ---------------------------------------------------------------------------


def object_hour() -> datetime:
    """Two hours ahead, so the request is inside the horizon whenever the test runs."""
    return datetime.now(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(hours=2)


def test_endpoint_returns_tide(client, open_meteo):
    at = object_hour()
    start = at.replace(hour=0) - timedelta(days=1)
    open_meteo.respond(
        {
            "hourly": {
                "time": [(start + timedelta(hours=step)).strftime("%Y-%m-%dT%H:%M") for step in range(72)],
                "sea_level_height_msl": [round(cos(2 * pi * (step - 8.5) / 12), 6) for step in range(72)],
            }
        }
    )

    response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7, "hour": at.isoformat()})

    assert response.status_code == 200
    body = response.json()
    assert body["latitude"] == 48.4
    assert body["datum"] == "msl"
    assert body["hour"] == at.strftime("%Y-%m-%dT%H:00")
    assert len(body["points"]) == 72
    assert body["last_extreme"]["type"] in {"high", "low"}
    assert body["next_extreme"]["type"] in {"high", "low"}
    assert body["next_extreme_after"]["type"] in {"high", "low"}
    assert body["next_extreme_after"]["type"] != body["next_extreme"]["type"]
    assert open_meteo.calls[0]["url"] == OPEN_METEO_MARINE_URL


def test_endpoint_over_land_returns_no_points(client, open_meteo):
    at = object_hour()
    start = at.replace(hour=0) - timedelta(days=1)
    open_meteo.respond(
        {
            "hourly": {
                "time": [(start + timedelta(hours=step)).strftime("%Y-%m-%dT%H:%M") for step in range(72)],
                "sea_level_height_msl": [None] * 72,
            }
        }
    )

    response = client.get("/api/tides/point", params={"lat": 47.6, "lon": -122.3, "hour": at.isoformat()})

    assert response.status_code == 200
    assert response.json()["points"] == []
    assert response.json()["last_extreme"] is None
    assert response.json()["next_extreme_after"] is None


def test_endpoint_rejects_a_past_hour(client):
    hour = (datetime.now(UTC) - timedelta(hours=2)).replace(minute=0, second=0, microsecond=0).isoformat()
    response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7, "hour": hour})
    assert response.status_code == 422
    assert "past" in response.json()["detail"]


def test_endpoint_rejects_bad_coordinates(client):
    response = client.get("/api/tides/point", params={"lat": 95, "lon": 0})
    assert response.status_code == 422


def test_endpoint_reports_upstream_failure(client, open_meteo):
    open_meteo.fail(upstream_error())
    response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7})
    assert response.status_code == 502
    assert "tide" in response.json()["detail"].lower()


def test_endpoint_reports_quota_exhausted(client, open_meteo):
    open_meteo.fail(QuotaExceededError("limit", reset_at=None))
    response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "open_meteo_quota_exhausted"


# ---------------------------------------------------------------------------
# Logging (SCRUM-253)
# ---------------------------------------------------------------------------


def test_upstream_failure_logs_the_exception_but_not_the_point(client, open_meteo, caplog):
    """httpx's message carries the request URL, coordinates included; the log must not."""
    open_meteo.fail(upstream_status_error("https://marine-api.open-meteo.com/v1/marine?latitude=48.4&longitude=-122.7"))

    with caplog.at_level("DEBUG", logger="backend.app.routers.tides"):
        response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7})

    assert response.status_code == 502
    assert "HTTPStatusError" in caplog.text
    assert "48.4" not in caplog.text
    assert "-122.7" not in caplog.text


def test_quota_warning_keeps_the_reset_time_but_not_the_point(client, open_meteo, caplog):
    open_meteo.fail(QuotaExceededError("limit", reset_at=None))

    with caplog.at_level("DEBUG", logger="backend.app.routers.tides"):
        response = client.get("/api/tides/point", params={"lat": 48.4, "lon": -122.7})

    assert response.status_code == 503
    assert "quota exhausted" in caplog.text
    assert "48.4" not in caplog.text
    assert "-122.7" not in caplog.text


@pytest.mark.asyncio
async def test_a_cold_window_is_one_request_for_the_whole_range(open_meteo):
    # Three contiguous missing days are a single range, so a first pop-up still costs one call.
    open_meteo.respond(tide_payload(sine_heights()))

    await get_point_tide(48.4, -122.7, HOUR)

    assert open_meteo.call_count == 1
    assert open_meteo.last_params["start_date"] == "2026-11-24"
    assert open_meteo.last_params["end_date"] == "2026-11-26"


@pytest.mark.asyncio
async def test_a_warm_window_makes_no_request(open_meteo):
    open_meteo.respond(tide_payload(sine_heights()))
    await get_point_tide(48.4, -122.7, HOUR)

    warm = await get_point_tide(48.4, -122.7, HOUR)

    assert open_meteo.call_count == 1
    assert warm.hour == "2026-11-25T12:00"


@pytest.mark.asyncio
async def test_one_missing_hour_refetches_only_its_utc_day(open_meteo):
    # An expired row used to re-request all three days and rewrite all 72 rows (SCRUM-286).
    open_meteo.respond(tide_payload(sine_heights()))
    first = await get_point_tide(48.4, -122.7, HOUR)
    with db_connection() as conn:
        conn.execute(
            "DELETE FROM tide_point_cache WHERE hour = ?",
            (hour_key(HOUR),),
        )

    again = await get_point_tide(48.4, -122.7, HOUR)

    assert open_meteo.call_count == 2
    assert open_meteo.last_params["start_date"] == "2026-11-25"
    assert open_meteo.last_params["end_date"] == "2026-11-25"
    assert [sample.height_m for sample in again.points] == [sample.height_m for sample in first.points]
