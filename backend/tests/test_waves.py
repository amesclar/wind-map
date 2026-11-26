"""Tests for the ocean-wave service, land filter and endpoints (SCRUM-233)."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from backend.app.models import WaveSeriesPoint
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.waves_service import (
    distance_km,
    get_grid_waves,
    get_point_waves,
    land_tolerance_km,
)
from factories import upstream_error, upstream_status_error

BBOX = {"min_lat": 47.0, "max_lat": 49.0, "min_lon": -123.0, "max_lon": -121.0}
HOUR = datetime(2026, 11, 25, 12, tzinfo=UTC)
# Roughly 16 km from (47.6, -122.2): the nearest sea cell an inland request is snapped to.
INLAND_REQUEST = (47.6, -122.2)
INLAND_CELL = (47.708, -122.375)
# About 3 km away: a coastal point answered by the cell that covers it.
COASTAL_REQUEST = (48.19, -122.51)
COASTAL_CELL = (48.208, -122.542)


def grid_params(**overrides) -> dict:
    return {**BBOX, "cols": 2, "rows": 2, **overrides}


def hourly(days: datetime) -> datetime:
    """The UTC midnight of `days`'s day, the start of a full-day payload."""
    return days.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def wave_item(height, direction, period, cell=(47.9, -124.6), at="2026-11-25T12:00"):
    """One point of a `current` response; all null means no waves."""
    return {
        "latitude": cell[0],
        "longitude": cell[1],
        "current": {
            "time": at,
            "wave_height": height,
            "wave_direction": direction,
            "wave_period": period,
        },
    }


def hourly_payload(*series, day: datetime, hours: int = 24, cells=None) -> list[dict]:
    """One response per point, with 24 hourly values from the UTC midnight of `day`.

    Each `series` item is a list of per-hour `(height, direction, period)` triples, or None.
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
                "wave_height": [None if value is None else value[0] for value in point],
                "wave_direction": [None if value is None else value[1] for value in point],
                "wave_period": [None if value is None else value[2] for value in point],
            },
        }
        for point, cell in zip(series, cell_list, strict=True)
    ]


def day_values(**by_hour: tuple[float, float, float] | None) -> list:
    """24 hourly values, mostly empty, with `by_hour` setting specific hours."""
    values: list = [None] * 24
    for key, value in by_hour.items():
        values[int(key[1:])] = value
    return values


# ---------------------------------------------------------------------------
# Unit: land filter helpers
# ---------------------------------------------------------------------------


def test_distance_is_the_great_circle_in_km():
    assert round(distance_km(47.6, -122.2, INLAND_CELL[0], INLAND_CELL[1]), 1) == 17.8
    assert round(distance_km(48.19, -122.51, *COASTAL_CELL), 1) == 3.1


def test_land_tolerance_is_half_the_grid_spacing_with_a_floor():
    # 0.1° of latitude is about 11.1 km, so half of it is 5.6 km.
    assert round(land_tolerance_km(0.1, 0.1, 48.0), 1) == 5.6
    # A very fine grid would otherwise discard real coastal values.
    assert land_tolerance_km(0.0001, 0.0001, 48.0) == 3.0
    # Longitude shrinks with latitude; the larger axis wins.
    assert round(land_tolerance_km(0.1, 0.2, 60.0), 1) == 5.6


# ---------------------------------------------------------------------------
# Unit: get_grid_waves
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_single_point_dict_response(open_meteo):
    """The marine API returns a plain object for one point."""
    open_meteo.respond(wave_item(1.4, 280.0, 8.5))

    result = await get_grid_waves([(47.9, -124.6)])

    assert len(result) == 1
    assert result[0].latitude == 47.9
    assert result[0].longitude == -124.6
    assert result[0].height_m == 1.4
    assert result[0].direction_deg == 280.0
    assert result[0].period_s == 8.5
    assert result[0].time is None


@pytest.mark.asyncio
async def test_coastal_cell_is_kept_and_placed_on_the_cell(open_meteo):
    """A cell within the tolerance is the node's own water; the arrow sits on the cell."""
    open_meteo.respond(wave_item(0.8, 200.0, 6.0, cell=COASTAL_CELL))

    result = await get_grid_waves([COASTAL_REQUEST])

    assert [(point.latitude, point.longitude) for point in result] == [COASTAL_CELL]


@pytest.mark.asyncio
async def test_inland_snap_is_dropped_and_cached(open_meteo):
    """East of Seattle snaps 16 km away; that is not this node's water, so it is no waves."""
    open_meteo.respond(wave_item(1.2, 250.0, 7.0, cell=INLAND_CELL))

    assert await get_grid_waves([INLAND_REQUEST]) == []
    assert await get_grid_waves([INLAND_REQUEST]) == []

    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_a_coarse_grid_keeps_a_distant_cell(open_meteo):
    """Half of a 1° grid spacing is about 55 km, so a 30 km snap belongs to its node."""
    open_meteo.respond(wave_item(2.0, 300.0, 9.0, cell=(47.9, -123.5)))

    result = await get_grid_waves([(47.9, -124.0)], tolerance_km=land_tolerance_km(1.0, 1.0, 48.0))

    assert len(result) == 1


@pytest.mark.asyncio
async def test_points_sharing_a_cell_return_one_point(open_meteo):
    """Several map points can snap to one water cell; it is returned once."""
    open_meteo.respond(
        [
            wave_item(1.0, 180.0, 7.0, cell=COASTAL_CELL),
            wave_item(1.0, 180.0, 7.0, cell=COASTAL_CELL),
            wave_item(0.6, 90.0, 5.0, cell=(48.2, -122.4)),
        ]
    )

    result = await get_grid_waves([COASTAL_REQUEST, (48.19, -122.49), (48.18, -122.40)])

    assert [(point.latitude, point.longitude, point.height_m) for point in result] == [
        (*COASTAL_CELL, 1.0),
        (48.2, -122.4, 0.6),
    ]


@pytest.mark.asyncio
async def test_cached_points_keep_the_cell(open_meteo):
    """A cache hit must place the arrow exactly where the live response did."""
    open_meteo.respond(wave_item(1.1, 45.0, 8.0, cell=COASTAL_CELL))
    points = [COASTAL_REQUEST]

    first = await get_grid_waves(points)
    second = await get_grid_waves(points)

    assert open_meteo.call_count == 1
    assert second == first
    assert (second[0].latitude, second[0].longitude) == COASTAL_CELL


@pytest.mark.asyncio
async def test_forecast_hour_echoes_the_hour_and_caches_the_day(open_meteo):
    """One response carries the whole UTC day, so every hour of it is cached."""
    open_meteo.respond(*hourly_payload([(1.5, 270.0, 8.0)] * 24, day=HOUR, cells=[COASTAL_CELL]))

    result = await get_grid_waves([COASTAL_REQUEST], at=HOUR, tolerance_km=5.0)
    later = await get_grid_waves([COASTAL_REQUEST], at=HOUR + timedelta(hours=2), tolerance_km=5.0)

    assert open_meteo.call_count == 1
    assert result[0].time == "2026-11-25T12:00"
    assert later[0].time == "2026-11-25T14:00"
    assert later[0].height_m == 1.5


@pytest.mark.asyncio
async def test_point_series_returns_hourly_values_and_skips_gaps(open_meteo):
    values = day_values(h12=(1.0, 90.0, 6.0), h14=(2.0, 120.0, 7.0), h15=(3.0, 150.0, 8.0))
    open_meteo.respond(*hourly_payload(values, day=HOUR, cells=[COASTAL_CELL]))

    points = await get_point_waves(*COASTAL_REQUEST, hours=4, now=HOUR)

    assert [point.time for point in points] == [
        "2026-11-25T12:00",
        "2026-11-25T14:00",
        "2026-11-25T15:00",
    ]
    assert [point.height_m for point in points] == [1.0, 2.0, 3.0]
    assert points[0].period_s == 6.0
    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_point_series_is_cached(open_meteo):
    open_meteo.respond(*hourly_payload([(1.0, 90.0, 6.0)] * 24, day=HOUR, cells=[COASTAL_CELL]))

    await get_point_waves(*COASTAL_REQUEST, hours=3, now=HOUR)
    again = await get_point_waves(*COASTAL_REQUEST, hours=3, now=HOUR)

    assert open_meteo.call_count == 1
    assert len(again) == 3


@pytest.mark.asyncio
async def test_inland_point_returns_no_series_and_caches_it(open_meteo):
    open_meteo.respond(*hourly_payload([(1.0, 90.0, 6.0)] * 24, day=HOUR, cells=[INLAND_CELL]))

    assert await get_point_waves(*INLAND_REQUEST, hours=3, now=HOUR) == []
    assert await get_point_waves(*INLAND_REQUEST, hours=3, now=HOUR) == []

    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_point_series_across_days_fetches_one_day_at_a_time(open_meteo):
    open_meteo.respond_sequence(
        hourly_payload([(1.0, 90.0, 6.0)] * 24, day=HOUR, cells=[COASTAL_CELL]),
        hourly_payload([(2.0, 95.0, 7.0)] * 24, day=HOUR + timedelta(days=1), cells=[COASTAL_CELL]),
    )

    points = await get_point_waves(*COASTAL_REQUEST, hours=30, now=HOUR)

    assert open_meteo.call_count == 2
    assert len(points) == 30
    assert points[-1].time == "2026-11-26T17:00"


# ---------------------------------------------------------------------------
# Integration: GET /api/waves/grid
# ---------------------------------------------------------------------------


NEAR_GRID_CELLS = [(47.05, -122.95), (47.05, -121.05), (48.95, -122.95), (48.95, -121.05)]


def test_grid_endpoint_returns_points_and_echoes_the_hour(client, open_meteo):
    hour = (datetime.now(UTC) + timedelta(hours=30)).replace(minute=0, second=0, microsecond=0)
    open_meteo.respond(hourly_payload(*[[(2.0, 300.0, 9.0)] * 24] * 4, day=hour, cells=NEAR_GRID_CELLS))

    resp = client.get("/api/waves/grid", params=grid_params(time=iso(hour)))

    assert resp.status_code == 200
    body = resp.json()
    assert body["time"] == hour.strftime("%Y-%m-%dT%H:00")
    assert len(body["points"]) == 4
    assert body["points"][0]["height_m"] == 2.0
    assert body["points"][0]["time"] == hour.strftime("%Y-%m-%dT%H:00")


def test_grid_endpoint_live_values_have_no_time(client, open_meteo):
    open_meteo.respond([wave_item(2.0, 300.0, 9.0, cell=cell) for cell in NEAR_GRID_CELLS])

    body = client.get("/api/waves/grid", params=grid_params()).json()

    assert body["time"] is None
    assert all(point["time"] is None for point in body["points"])


def test_grid_endpoint_drops_inland_nodes(client, open_meteo):
    open_meteo.respond(
        [
            wave_item(None, None, None),
            wave_item(1.5, 45.0, 7.0, cell=(47.05, -120.95)),
            wave_item(1.5, 45.0, 7.0, cell=INLAND_CELL),
            wave_item(None, None, None),
        ]
    )

    body = client.get("/api/waves/grid", params=grid_params()).json()

    assert len(body["points"]) == 1
    assert body["points"][0]["direction_deg"] == 45.0


def test_grid_endpoint_rejects_inverted_bbox(client, open_meteo):
    resp = client.get("/api/waves/grid", params=grid_params(min_lat=49.0, max_lat=47.0))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_too_many_columns(client, open_meteo):
    resp = client.get("/api/waves/grid", params=grid_params(cols=31))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_accepts_hours_beyond_the_weather_model_horizon(client, open_meteo):
    hour = (datetime.now(UTC) + timedelta(hours=200)).replace(minute=0, second=0, microsecond=0)
    open_meteo.respond(hourly_payload(*[[(1.0, 90.0, 6.0)] * 24] * 4, day=hour, cells=NEAR_GRID_CELLS))

    resp = client.get("/api/waves/grid", params=grid_params(time=iso(hour)))

    assert resp.status_code == 200
    assert open_meteo.call_count == 1


def test_grid_endpoint_rejects_past_hour(client, open_meteo):
    past = (datetime.now(UTC) - timedelta(hours=2)).replace(minute=0, second=0, microsecond=0)

    resp = client.get("/api/waves/grid", params=grid_params(time=iso(past)))

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


def test_grid_endpoint_rejects_hour_beyond_the_wave_horizon(client, open_meteo):
    beyond = (datetime.now(UTC) + timedelta(hours=242)).replace(minute=0, second=0, microsecond=0)

    resp = client.get("/api/waves/grid", params=grid_params(time=iso(beyond)))

    assert resp.status_code == 422
    assert "ocean wave horizon" in resp.json()["detail"]
    assert open_meteo.call_count == 0


def test_grid_endpoint_quota_returns_503_with_reset_time(client, open_meteo, monkeypatch):
    reset_at = datetime(2026, 11, 25, 0, 0, tzinfo=UTC)

    async def quota(*args, **kwargs):
        raise QuotaExceededError(
            "limit reached",
            reset_at=reset_at,
            request=httpx.Request("GET", "https://marine-api.open-meteo.com/v1/marine"),
        )

    monkeypatch.setattr("backend.app.routers.waves.get_grid_waves", quota)

    resp = client.get("/api/waves/grid", params=grid_params())

    assert resp.status_code == 503
    assert resp.json()["detail"] == {
        "code": "open_meteo_quota_exhausted",
        "message": "Open-Meteo request limit reached",
        "reset_at": reset_at.isoformat(),
    }
    assert int(resp.headers["retry-after"]) >= 0


def test_grid_endpoint_upstream_failure_is_502_without_internal_detail(client, open_meteo):
    open_meteo.fail(upstream_error("secret-host.internal"))

    resp = client.get("/api/waves/grid", params=grid_params())

    assert resp.status_code == 502
    assert resp.json()["detail"] == "Failed to fetch wave data from Open-Meteo"
    assert "secret-host" not in resp.text


# ---------------------------------------------------------------------------
# Integration: GET /api/waves/point
# ---------------------------------------------------------------------------


def test_point_endpoint_returns_the_series(client, open_meteo, monkeypatch):
    async def series(lat, lon, **kwargs):
        return [WaveSeriesPoint(time="2026-11-25T12:00", height_m=1.5, direction_deg=90.0, period_s=8.0)]

    monkeypatch.setattr("backend.app.routers.waves.get_point_waves", series)

    resp = client.get("/api/waves/point", params={"lat": 47.9, "lon": -124.6})

    assert resp.status_code == 200
    body = resp.json()
    assert body["latitude"] == 47.9
    assert body["horizon_hours"] == 240
    assert body["points"] == [{"time": "2026-11-25T12:00", "height_m": 1.5, "direction_deg": 90.0, "period_s": 8.0}]


def test_point_endpoint_inland_returns_no_points(client, open_meteo):
    today = hourly(datetime.now(UTC))
    open_meteo.respond_sequence(
        hourly_payload([(1.0, 90.0, 6.0)] * 24, day=today, cells=[INLAND_CELL]),
        hourly_payload([(1.0, 90.0, 6.0)] * 24, day=today + timedelta(days=1), cells=[INLAND_CELL]),
        hourly_payload([(1.0, 90.0, 6.0)] * 24, day=today + timedelta(days=2), cells=[INLAND_CELL]),
    )

    resp = client.get("/api/waves/point", params={"lat": INLAND_REQUEST[0], "lon": INLAND_REQUEST[1]})

    assert resp.status_code == 200
    assert resp.json()["points"] == []


def test_point_endpoint_rejects_invalid_coordinates(client, open_meteo):
    resp = client.get("/api/waves/point", params={"lat": 91, "lon": -120.5})

    assert resp.status_code == 422
    assert open_meteo.call_count == 0


# ---------------------------------------------------------------------------
# Logging (SCRUM-253)
# ---------------------------------------------------------------------------


def test_point_endpoint_upstream_failure_logs_no_coordinates(client, open_meteo, caplog):
    open_meteo.fail(upstream_status_error("https://marine-api.open-meteo.com/v1/marine?latitude=47.9&longitude=-124.6"))

    with caplog.at_level("DEBUG", logger="backend.app.routers.waves"):
        resp = client.get("/api/waves/point", params={"lat": 47.9, "lon": -124.6})

    assert resp.status_code == 502
    # Only this router's records: httpx's own INFO line names the test URL.
    logged = "\n".join(r.getMessage() for r in caplog.records if r.name == "backend.app.routers.waves")
    assert "HTTPStatusError" in logged
    assert "47.9" not in logged
    assert "-124.6" not in logged


def test_point_endpoint_quota_logs_the_reset_time_but_not_the_point(client, open_meteo, caplog):
    open_meteo.fail(QuotaExceededError("Open-Meteo request limit reached", reset_at=None))

    with caplog.at_level("DEBUG", logger="backend.app.routers.waves"):
        resp = client.get("/api/waves/point", params={"lat": 47.9, "lon": -124.6})

    assert resp.status_code == 503
    logged = "\n".join(r.getMessage() for r in caplog.records if r.name == "backend.app.routers.waves")
    assert "quota exhausted" in logged
    assert "47.9" not in logged
