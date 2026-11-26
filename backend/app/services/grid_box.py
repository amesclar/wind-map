"""Bounding-box grid maths shared by the wind, current and wave routers (SCRUM-281, SCRUM-267).

The same two checks and the same nested point list were written three times, so a change to the
rounding or the ordering had to be made in three places.
"""

import math

from fastapi import HTTPException


def validate_bounds(min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> None:
    """Reject an inverted box with the 422 the three routers already sent."""
    if min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="min_lat must be less than max_lat")
    if min_lon >= max_lon:
        raise HTTPException(status_code=422, detail="min_lon must be less than max_lon")


def _lattice(low: float, high: float, count: int) -> list[float]:
    """`count` samples every `(high - low) / (count - 1)` degrees, on a lattice at 0 (SCRUM-267).

    The spacing the view asked for is kept; only where the samples land moves. Anchoring the
    lattice at 0 means two views of the same zoom share the coordinates they overlap in, so a pan
    asks the cache for the strip it revealed instead of refetching every point at a new
    coordinate. Taking the lattice nearest to `low` keeps the samples within half a cell of the
    box, so a pan does not leave an edge of the view bare.
    """
    step = (high - low) / (count - 1) if count > 1 else 0.0
    if step <= 0:
        return [round(low, 6) for _ in range(count)]
    first = math.floor(low / step + 0.5)  # nearest lattice line to the near edge of the box
    return [round((first + index) * step, 6) for index in range(count)]


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
    the order is part of the shared helper rather than each caller's business. Samples sit on a
    lattice anchored at 0 rather than exactly on the bbox edges (SCRUM-267): the spacing between
    them is unchanged, and panning by a fraction of a cell now reuses the coordinates it already
    fetched instead of moving every one of them.
    """
    return [(lat, lon) for lat in _lattice(min_lat, max_lat, rows) for lon in _lattice(min_lon, max_lon, cols)]
