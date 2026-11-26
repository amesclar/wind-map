"""The shared marine cache (SCRUM-276)."""

import time

from backend.app.services import currents_service, waves_service
from backend.app.services.marine_grid import MarineSpec, read_points, read_series, store

POINT = (48.4, -122.7)
HOUR = "2026-11-25T12:00"


def test_a_value_round_trips_with_its_cell():
    spec = MarineSpec(
        table="grid_waves_cache",
        variables=("wave_height",),
        value_columns=("wave_height_m", "wave_direction_deg", "wave_period_s"),
    )
    value = waves_service.WaveValue(latitude=48.5, longitude=-122.8, height_m=1.5, direction_deg=270.0, period_s=8.0)

    store(spec, [POINT], [value], HOUR, time.time(), waves_service._unpack)

    found = read_points(spec, [POINT], HOUR, time.time(), waves_service._cached_value)
    assert found[(48.4, -122.7)] == value


def test_an_empty_row_reads_back_as_no_value():
    # An inland point is cached as an empty row, so it is not refetched on every pan.
    spec = MarineSpec(
        table="grid_currents_cache",
        variables=("ocean_current_velocity",),
        value_columns=("velocity_knots", "direction_deg"),
        params={"wind_speed_unit": "kn"},
    )

    store(spec, [POINT], [None], HOUR, time.time(), currents_service._unpack)

    found = read_points(spec, [POINT], HOUR, time.time(), currents_service._cached_value)
    assert found[(48.4, -122.7)] is None
    series = read_series(spec, *POINT, [HOUR], time.time(), currents_service._cached_value)
    assert series[HOUR] is None


def test_the_layers_no_longer_carry_their_own_cache_machinery():
    # The regression this refactor removes: a cache-key or SQL change had to be made in two files.
    shared = (
        "_read_cached_points",
        "_read_series",
        "_store",
        "_batch_params",
        "_as_list",
        "_cell",
        "_series_times",
        "_series_hour",
        "_fetch_hourly",
    )
    for module in (currents_service, waves_service):
        for name in shared:
            assert not hasattr(module, name), f"{module.__name__} still defines {name}"
