"""Shared unit conversions and cache keys (SCRUM-92)."""
import pytest

from backend.app.config import COORD_CACHE_PRECISION
from backend.app.units import as_float, c_to_f, coord_key, deg_to_cardinal, knots_to_units


def test_as_float_treats_none_as_default():
    assert as_float(None) == 0.0
    assert as_float(None, 5.0) == 5.0
    assert as_float(3) == 3.0


@pytest.mark.parametrize("c, f", [(0, 32.0), (100, 212.0), (12.3, 54.1), (-40, -40.0), (None, 32.0)])
def test_c_to_f(c, f):
    assert c_to_f(c) == f


def test_knots_to_units():
    assert knots_to_units(10) == {"knots": 10.0, "kmh": 18.5, "mph": 11.5, "ms": 5.1}
    assert knots_to_units(None) == {"knots": 0.0, "kmh": 0.0, "mph": 0.0, "ms": 0.0}


@pytest.mark.parametrize(
    "deg, cardinal",
    [(0, "N"), (11.24, "N"), (11.25, "NNE"), (90, "E"), (225, "SW"), (348.75, "N"), (360, "N")],
)
def test_deg_to_cardinal(deg, cardinal):
    assert deg_to_cardinal(deg) == cardinal


def test_coord_key_rounds_to_configured_precision():
    assert COORD_CACHE_PRECISION == 2
    assert coord_key(48.2939, -122.6064) == (48.29, -122.61)
