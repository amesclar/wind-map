"""Pure forecast parsing (SCRUM-92 phase 4): plain dicts in, models out, no mocks."""

from backend.app.config import FORECAST_POINTS, FORECAST_STEP_HOURS
from backend.app.services.forecast_parser import parse_forecast
from factories import forecast_payload


def test_slices_start_at_current_hour_every_step():
    raw = forecast_payload(time="2026-11-12T12:15")

    parsed = parse_forecast(raw)

    assert len(parsed.points) == FORECAST_POINTS
    # Slice 0 is "now" (current block); later slices are hourly at +3h steps from 12:00.
    assert parsed.points[0].time == "2026-11-12T12:15"
    assert parsed.points[1].time == "2026-11-12T15:00"
    assert parsed.points[-1].time == "2026-11-14T09:00"  # 12:00 + 15 * 3h
    assert FORECAST_STEP_HOURS == 3


def test_first_slice_is_current_conditions():
    raw = forecast_payload(time="2026-11-12T12:15", wind_speed_10m=18.0, wind_direction_10m=250)

    parsed = parse_forecast(raw)

    assert parsed.points[0] == parsed.current
    assert (parsed.current.wind_speed_knots, parsed.current.wind_direction_deg) == (18.0, 250)
    assert parsed.points[1].wind_speed_knots == 15.0  # hourly value


def test_unknown_current_hour_starts_at_first_hourly_value():
    raw = forecast_payload(time="1999-01-01T00:00")  # not in the hourly series

    parsed = parse_forecast(raw)

    assert parsed.points[1].time == raw["hourly"]["time"][3]


def test_missing_current_time_keeps_hourly_first_slice():
    """Without a current time there is nothing to anchor "now" to: start at the first
    hourly value and don't replace slice 0."""
    raw = forecast_payload(time=None)

    parsed = parse_forecast(raw)

    assert parsed.points[0].time == raw["hourly"]["time"][0]
    assert parsed.current.time == ""


def test_short_hourly_series_yields_fewer_slices():
    raw = forecast_payload(time="2026-11-12T12:00")
    for name, series in raw["hourly"].items():
        raw["hourly"][name] = series[:20]  # 12:00 is index 12 → 12, 15, 18 fit

    parsed = parse_forecast(raw)

    assert [p.time for p in parsed.points] == [
        "2026-11-12T12:00",
        "2026-11-12T15:00",
        "2026-11-12T18:00",
    ]


def test_missing_or_short_variable_series_default_to_zero():
    raw = forecast_payload(time="2026-11-12T12:00")
    del raw["hourly"]["wind_gusts_10m"]
    raw["hourly"]["temperature_2m"] = raw["hourly"]["temperature_2m"][:14]

    parsed = parse_forecast(raw)

    assert parsed.points[1].wind_gust_knots == 0.0  # series missing
    assert parsed.points[1].temperature_c == 0.0  # index 15 past the short series
    assert parsed.points[1].wind_speed_knots == 15.0  # other values unaffected


def test_empty_response_gives_zeroed_current_and_no_slices():
    parsed = parse_forecast({})

    assert parsed.points == []
    assert parsed.current.wind_speed_knots == 0.0
