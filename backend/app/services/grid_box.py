"""Bounding-box grid maths shared by the wind, current and wave routers (SCRUM-281).

The same two checks and the same nested point list were written three times, so a change to the
rounding or the ordering had to be made in three places.
"""

from fastapi import HTTPException


def validate_bounds(min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> None:
    """Reject an inverted box with the 422 the three routers already sent."""
    if min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="min_lat must be less than max_lat")
    if min_lon >= max_lon:
        raise HTTPException(status_code=422, detail="min_lon must be less than max_lon")


def grid_points(
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
    cols: int,
    rows: int,
) -> list[tuple[float, float]]:
    """The bbox as a row-major list of (lat, lon), rounded to 6 decimals.

    Row-major (each latitude, every longitude in order) is the contract the overlays rely on, so
    the order is part of the shared helper rather than each caller's business.
    """
    lat_step = (max_lat - min_lat) / (rows - 1) if rows > 1 else 0
    lon_step = (max_lon - min_lon) / (cols - 1) if cols > 1 else 0
    return [
        (round(min_lat + r * lat_step, 6), round(min_lon + c * lon_step, 6)) for r in range(rows) for c in range(cols)
    ]
