"""Tests for the ocean-current service and endpoints (SCRUM-96)."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from backend.app.models import CurrentSeriesPoint
from backend.app.services.currents_service import get_grid_currents, get_point_currents
from backend.app.services.open_meteo import QuotaExceededError
from factories import upstream_error

BBOX = {"min_lat": 47.0, "max_lat": 49.0, "min_lon": -123.0, "max_lon": -121.0}
HOUR = datetime(2026, 11, 25, 12, tzinfo=UTC)


def grid_params(**overrides) -> dict:
    return {**BBOX, "cols": 2, "rows": 2, **overrides}


def hourly(days: datetime) -> datetime:
    """The UTC midnight of `days`'s day, the start of a full-day payload."""
    return days.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def current_item(velocity, direction, cell=(47.9, -124.6)):
    """One point of a `current` response; both null means land. `cell` is the model cell the
    API snapped the request to (SCRUM-238)."""
    return {
        "latitude": cell[0],
        "longitude": cell[1],
        "current": {
            "time": "2026-11-25T12:00",
            "ocean_current_velocity": velocity,
            "ocean_current_direction": direction,
        },
    }


def hourly_payload(*series, day: datetime, hours: int = 24, cells=None) -> list[dict]:
    """One response per point, with 24 hourly values from the UTC midnight of `day`.

    Each `series` item is a list of per-hour `(velocity, direction)` pairs, or None for no data.
    `cells` gives the model cell per point; the default spreads them so points stay distinct.
    """
    start = hourly(day)
    stamps = [(start + timedelta(hours=step)).strftime("%Y-%m-%dT%H:00") for step in range(hours)]
    cell_list = cells or [(round(47.0 + 0.1 * index, 3), -124.6) for index in range(len(series))]
    return [
        {
            "latitude": cell[0],
            "longitude": cell[1],
            "hourly": {
                "time": stamps,
                "ocean_current_velocity": [None if value is None else value[0] for value in point],
                "ocean_current_direction": [None if value is None else value[1] for value in point],
            },
        }
        for point, cell in zip(series, cell_list, strict=True)
    ]


def day_values(**by_hour: tuple[float, float] | None) -> list:
    """24 hourly values, mostly empty, with `by_hour` setting specific hours (e.g. h12=(1, 90))."""
    values: list = [None] * 24
    for key, value in by_hour.items():
        values[int(key[1:])] = value
    return values


# ---------------------------------------------------------------------------
# Unit: get_grid_currents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_single_point_dict_response(open_meteo):
    """The marine API returns a plain object for one point."""
    open_meteo.respond(current_item(2.4, 333.0))

    result = await get_grid_currents([(47.9, -124.6)])

    assert len(result) == 1
    assert result[0].latitude == 47.9
    assert result[0].longitude == -124.6
    assert result[0].velocity_knots == 2.4
    assert result[0].direction_deg == 333.0
    assert result[0].time is None


@pytest.mark.asyncio
async def test_chevron_uses_the_model_cell_not_the_requested_point(open_meteo):
    """A coastal point borrows its nearest sea cell; the chevron belongs on that cell (SCRUM-238)."""
    open_meteo.respond(current_item(0.9, 90.0, cell=(48.208, -122.542)))

    result = await get_grid_currents([(48.19, -122.51)])

    assert [(point.latitude, point.longitude) for point in result] == [(48.208, -122.542)]


@pytest.mark.asyncio
async def test_points_sharing_a_cell_return_one_chevron(open_meteo):
    """At high zoom several map points snap to one model cell; it is drawn once (SCRUM-238)."""
    open_meteo.respond(
        [
            current_item(0.9, 90.0, cell=(48.208, -122.542)),
            current_item(0.9, 90.0, cell=(48.208, -122.542)),
            current_item(1.4, 270.0, cell=(48.2, -122.4)),
        ]
    )

    result = await get_grid_currents([(48.19, -122.51), (48.19, -122.49), (48.18, -122.40)])

    assert [(point.latitude, point.longitude, point.velocity_knots) for point in result] == [
        (48.208, -122.542, 0.9),
        (48.2, -122.4, 1.4),
    ]


@pytest.mark.asyncio
async def test_cached_points_keep_the_cell(open_meteo):
    """A cache hit must place the chevron exactly where the live response did (SCRUM-238)."""
    open_meteo.respond(current_item(1.1, 45.0, cell=(48.208, -122.542)))
    points = [(48.19, -122.51)]

    first = await get_grid_currents(points)
    second = await get_grid_currents(points)

    assert open_meteo.call_count == 1
    assert (second[0].latitude, second[0].longitude) == (48.208, -122.542)
    assert second == first


@pytest.mark.asyncio
async def test_fetch_requests_knots_and_the_current_variables(open_meteo):
    open_meteo.respond(current_item(3.0, 350.0))

    await get_grid_currents([(47.9, -124.6)])

    params = open_meteo.last_params
    assert params["wind_speed_unit"] == "kn"
    assert params["current"] == "ocean_current_velocity,ocean_current_direction"
    assert "marine-api.open-meteo.com/v1/marine" in open_meteo.calls[0]["url"]


@pytest.mark.asyncio
async def test_land_nodes_are_dropped(open_meteo):
    """A null current (land, or outside the model domain) is absent, not zeroed."""
    open_meteo.respond([current_item(None, None), current_item(1.2, 40.0)])

    result = await get_grid_currents([(47.0, -120.5), (47.9, -124.6)])

    assert [(point.latitude, point.longitude) for point in result] == [(47.9, -124.6)]


@pytest.mark.asyncio
async def test_cache_hit_makes_no_upstream_call(open_meteo):
    open_meteo.respond([current_item(1.0, 10.0, cell=(47.9, -124.6)), current_item(2.0, 20.0, cell=(48.2, -125.0))])
    points = [(47.9, -124.6), (48.2, -125.0)]

    first = await get_grid_currents(points)
    second = await get_grid_currents(points)

    assert open_meteo.call_count == 1
    assert [point.velocity_knots for point in first] == [point.velocity_knots for point in second]


@pytest.mark.asyncio
async def test_land_points_are_cached_too(open_meteo):
    """An inland view must not call Open-Meteo on every pan."""
    open_meteo.respond(current_item(None, None))

    assert await get_grid_currents([(47.0, -120.5)]) == []
    assert await get_grid_currents([(47.0, -120.5)]) == []

    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_one_hour_request_fills_the_rest_of_the_day(open_meteo):
    open_meteo.respond(*hourly_payload(day_values(h12=(4.0, 180.0), h18=(5.5, 200.0)), day=HOUR))

    afternoon = await get_grid_currents([(47.9, -124.6)], at=HOUR)
    assert afternoon[0].velocity_knots == 4.0
    assert afternoon[0].time == "2026-11-25T12:00"
    assert open_meteo.call_count == 1

    evening = await get_grid_currents([(47.9, -124.6)], at=HOUR.replace(hour=18))

    assert open_meteo.call_count == 1  # served from the rows stored by that one response
    assert evening[0].velocity_knots == 5.5
    assert evening[0].time == "2026-11-25T18:00"


@pytest.mark.asyncio
async def test_hourly_request_sends_the_utc_day(open_meteo):
    open_meteo.respond(*hourly_payload([(1.0, 90.0)] * 24, day=HOUR))

    await get_grid_currents([(47.9, -124.6)], at=HOUR)

    params = open_meteo.last_params
    assert params["start_date"] == "2026-11-25"
    assert params["end_date"] == "2026-11-25"
    assert params["timezone"] == "UTC"
    assert params["wind_speed_unit"] == "kn"


@pytest.mark.asyncio
async def test_hourly_response_without_the_requested_hour_is_an_error(open_meteo):
    open_meteo.respond(*hourly_payload([(1.0, 90.0)] * 24, day=HOUR + timedelta(days=1)))

    with pytest.raises(httpx.HTTPError):
        await get_grid_currents([(47.9, -124.6)], at=HOUR)


@pytest.mark.asyncio
async def test_empty_input_makes_no_call(open_meteo):
    assert await get_grid_currents([]) == []
    assert open_meteo.call_count == 0


# ---------------------------------------------------------------------------
# Unit: get_point_currents
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_point_series_returns_hourly_values_and_skips_gaps(open_meteo):
    values = day_values(h12=(1.0, 90.0), h14=(2.0, 120.0), h15=(3.0, 150.0))
    open_meteo.respond(*hourly_payload(values, day=HOUR))

    points = await get_point_currents(47.9, -124.6, hours=4, now=HOUR)

    assert [point.time for point in points] == [
        "2026-11-25T12:00",
        "2026-11-25T14:00",
        "2026-11-25T15:00",
    ]
    assert [point.velocity_knots for point in points] == [1.0, 2.0, 3.0]
    assert points[0].direction_deg == 90.0
    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_point_series_is_cached(open_meteo):
    open_meteo.respond(*hourly_payload([(1.0, 90.0)] * 24, day=HOUR))

    await get_point_currents(47.9, -124.6, hours=3, now=HOUR)
    again = await get_point_currents(47.9, -124.6, hours=3, now=HOUR)

    assert open_meteo.call_count == 1
    assert len(again) == 3


@pytest.mark.asyncio
async def test_inland_point_returns_no_series_and_caches_it(open_meteo):
    open_meteo.respond(*hourly_payload([None] * 24, day=HOUR))

    assert await get_point_currents(47.0, -120.5, hours=3, now=HOUR) == []
    assert await get_point_currents(47.0, -120.5, hours=3, now=HOUR) == []

    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_point_series_across_days_fetches_one_day_at_a_time(open_meteo):
    open_meteo.respond_sequence(
        hourly_payload([(1.0, 90.0)] * 24, day=HOUR),
        hourly_payload([(2.0, 95.0)] * 24, day=HOUR + timedelta(days=1)),
    )

    points = await get_point_currents(47.9, -124.6, hours=30, now=HOUR)

    assert open_meteo.call_count == 2  # the 25th and the 26th only
    assert len(points) == 30
    assert points[-1].time == "2026-11-26T17:00"


# ---------------------------------------------------------------------------
# Integration: GET /api/currents/grid
# ---------------------------------------------------------------------------


def test_grid_endpoint_returns_points_and_echoes_the_hour(client, open_meteo):
    hour = (datetime.now(UTC) + timedelta(hours=30)).replace(minute=0, second=0, microsecond=0)
    open_meteo.respond(hourly_payload(*[[(2.0, 300.0)] * 24] * 4, day=hour))

    resp = client.get("/api/currents/grid", params=grid_params(time=iso(hour)))

    assert resp.status_code == 200
    body = resp.json()
    assert body["time"] == hour.strftime("%Y-%m-%dT%H:00")
    assert len(body["points"]) == 4
    assert body["points"][0]["velocity_knots"] == 2.0
    assert body["points"][0]["time"] == hour.strftime("%Y-%m-%dT%H:00")


def test_grid_endpoint_live_values_have_no_time(client, open_meteo):
    open_meteo.respond([current_item(2.0, 300.0, cell=(round(47.0 + 0.1 * index, 3), -124.0)) for index in range(4)])

    body = client.get("/api/currents/grid", params=grid_params()).json()

    assert body["time"] is None
    assert all(point["time"] is None for point in body["points"])


def test_grid_endpoint_drops_land_from_the_payload(client, open_meteo):
    open_meteo.respond(
        [current_item(None, None), current_item(1.5, 45.0), current_item(None, None), current_item(None, None)]
    )

    body = client.get("/api/currents/grid", params=grid_params()).json()

    assert len(body["points"]) == 1
    assert body["points"][0]["direction_deg"] == 45.0


def test_grid_endpoint_rejects_inverted_bbox(client, open_meteo):
    resp = client.get("/api/currents/grid", params=grid_params(min_lat=49.0, max_lat=47.0))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_too_many_columns(client, open_meteo):
    resp = client.get("/api/currents/grid", params=grid_params(cols=31))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_accepts_hours_beyond_the_weather_model_horizon(client, open_meteo):
    """Currents have their own 240-hour horizon, not the selected model's."""
    hour = (datetime.now(UTC) + timedelta(hours=200)).replace(minute=0, second=0, microsecond=0)
    open_meteo.respond(hourly_payload(*[[(1.0, 90.0)] * 24] * 4, day=hour))

    resp = client.get("/api/currents/grid", params=grid_params(time=iso(hour)))

    assert resp.status_code == 200
    assert open_meteo.call_count == 1


def test_grid_endpoint_rejects_past_hour(client, open_meteo):
    past = (datetime.now(UTC) - timedelta(hours=2)).replace(minute=0, second=0, microsecond=0)

    resp = client.get("/api/currents/grid", params=grid_params(time=iso(past)))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_hour_beyond_the_current_horizon(client, open_meteo):
    beyond = (datetime.now(UTC) + timedelta(hours=242)).replace(minute=0, second=0, microsecond=0)

    resp = client.get("/api/currents/grid", params=grid_params(time=iso(beyond)))

    assert resp.status_code == 422
    assert "ocean current horizon" in resp.json()["detail"]
    assert open_meteo.call_count == 0


def test_grid_endpoint_quota_returns_503_with_reset_time(client, open_meteo, monkeypatch):
    reset_at = datetime(2026, 11, 25, 0, 0, tzinfo=UTC)

    async def quota(*args, **kwargs):
        raise QuotaExceededError(
            "limit reached",
            reset_at=reset_at,
            request=httpx.Request("GET", "https://marine-api.open-meteo.com/v1/marine"),
        )

    monkeypatch.setattr("backend.app.routers.currents.get_grid_currents", quota)

    resp = client.get("/api/currents/grid", params=grid_params())

    assert resp.status_code == 503
    assert resp.json()["detail"] == {
        "code": "open_meteo_quota_exhausted",
        "message": "Open-Meteo request limit reached",
        "reset_at": reset_at.isoformat(),
    }
    assert int(resp.headers["retry-after"]) >= 0


def test_grid_endpoint_upstream_failure_is_502_without_internal_detail(client, open_meteo):
    open_meteo.fail(upstream_error("secret-host.internal"))

    resp = client.get("/api/currents/grid", params=grid_params())

    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch ocean current data from Open-Meteo"
    assert "secret-host" not in resp.text


# ---------------------------------------------------------------------------
# Integration: GET /api/currents/point
# ---------------------------------------------------------------------------


def test_point_endpoint_returns_the_series(client, open_meteo, monkeypatch):
    async def series(lat, lon):
        return [CurrentSeriesPoint(time="2026-11-25T12:00", velocity_knots=1.5, direction_deg=90.0)]

    monkeypatch.setattr("backend.app.routers.currents.get_point_currents", series)

    resp = client.get("/api/currents/point", params={"lat": 47.9, "lon": -124.6})

    assert resp.status_code == 200
    body = resp.json()
    assert body["latitude"] == 47.9
    assert body["horizon_hours"] == 240
    assert body["points"] == [{"time": "2026-11-25T12:00", "velocity_knots": 1.5, "direction_deg": 90.0}]


def test_point_endpoint_inland_returns_no_points(client, open_meteo):
    today = hourly(datetime.now(UTC))
    open_meteo.respond_sequence(
        hourly_payload([None] * 24, day=today),
        hourly_payload([None] * 24, day=today + timedelta(days=1)),
        hourly_payload([None] * 24, day=today + timedelta(days=2)),
    )

    resp = client.get("/api/currents/point", params={"lat": 47.0, "lon": -120.5})

    assert resp.status_code == 200
    assert resp.json()["points"] == []


def test_point_endpoint_rejects_invalid_coordinates(client, open_meteo):
    resp = client.get("/api/currents/point", params={"lat": 91, "lon": -120.5})

    assert resp.status_code == 422
    assert open_meteo.call_count == 0
