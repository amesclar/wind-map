"""Unit conversions and cache-key rounding shared by the weather services (SCRUM-92)."""

from backend.app.config import COORD_CACHE_PRECISION

KNOTS_TO_KMH = 1.852
KNOTS_TO_MPH = 1.15078
KNOTS_TO_MS = 0.514444

CARDINALS = (
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
)


def as_float(value: float | None, default: float = 0.0) -> float:
    """Open-Meteo returns null for missing values; treat them as `default`."""
    return default if value is None else float(value)


def as_optional_float(value: float | None) -> float | None:
    """Keep a missing value missing, where 0 would be a lie (an unknown gust is not calm)."""
    return None if value is None else float(value)


def c_to_f(temp_c: float | None) -> float | None:
    """°C → °F rounded to 1 decimal; a missing temperature stays missing (SCRUM-225).

    Used by both the drawer forecast and the map grid, so their colors always agree.
    """
    if temp_c is None:
        return None
    return round(float(temp_c) * 9.0 / 5.0 + 32.0, 1)


def knots_to_units(knots: float | None) -> dict[str, float | None]:
    """Knots → every display unit, rounded to 1 decimal. A missing speed stays None in every
    unit (SCRUM-225); 0 would claim calm."""
    if knots is None:
        return {"knots": None, "kmh": None, "mph": None, "ms": None}
    k = float(knots)
    return {
        "knots": round(k, 1),
        "kmh": round(k * KNOTS_TO_KMH, 1),
        "mph": round(k * KNOTS_TO_MPH, 1),
        "ms": round(k * KNOTS_TO_MS, 1),
    }


def deg_to_cardinal(deg: float) -> str:
    """Degrees → one of 16 compass points (N, NNE, ... NNW)."""
    return CARDINALS[int((deg + 11.25) / 22.5) % 16]


def coord_key(lat: float, lon: float) -> tuple[float, float]:
    """Cache key for a coordinate: rounded to COORD_CACHE_PRECISION decimals."""
    return (round(lat, COORD_CACHE_PRECISION), round(lon, COORD_CACHE_PRECISION))
