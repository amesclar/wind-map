"""Ocean-wave router: waves for a lat/lon bounding box or a single point (SCRUM-233).

No `model` parameter: there is one wave field (Open-Meteo Marine, `best_match`), independent of
the selected weather model, with its own 240-hour horizon. Heights are metres; the UI converts.
"""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from backend.app.config import GRID_MAX_DIM, WAVES_HORIZON_HOURS, WAVES_POINT_LAND_TOLERANCE_KM
from backend.app.models import WaveGridResponse, WavePointResponse
from backend.app.routers.errors import quota_exhausted
from backend.app.services.grid_box import grid_points, validate_bounds
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.time_window import hour_key, validate_wave_time
from backend.app.services.waves_service import get_grid_waves, get_point_waves, land_tolerance_km

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/waves", tags=["waves"])

TIME_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the ocean wave "
    "horizon. Omit for current conditions.",
)


@router.get("/grid", response_model=WaveGridResponse)
async def get_wave_grid(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lon: float = Query(..., ge=-180, le=180),
    max_lon: float = Query(..., ge=-180, le=180),
    cols: int = Query(..., ge=2, le=GRID_MAX_DIM),
    rows: int = Query(..., ge=2, le=GRID_MAX_DIM),
    time: datetime | None = TIME_QUERY,
) -> WaveGridResponse:
    """Waves for a bbox grid, at the current hour or a forecast hour.

    Nodes the wave model answers with a cell too far from the request (inland) are absent from
    `points`, not drawn as flat water.
    """
    at = validate_wave_time(time)
    validate_bounds(min_lat, max_lat, min_lon, max_lon)
    points = grid_points(min_lat, max_lat, min_lon, max_lon, cols, rows)
    lat_step = (max_lat - min_lat) / (rows - 1) if rows > 1 else 0
    lon_step = (max_lon - min_lon) / (cols - 1) if cols > 1 else 0
    tolerance = land_tolerance_km(lat_step, lon_step, (min_lat + max_lat) / 2)

    try:
        found = await get_grid_waves(points, at=at, tolerance_km=tolerance)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted (%d wave points); reset at %s", len(points), exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo marine wave request failed (%d points)", len(points))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch wave data from Open-Meteo",
        ) from exc

    return WaveGridResponse(points=found, time=None if at is None else hour_key(at))


@router.get("/point", response_model=WavePointResponse)
async def get_wave_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> WavePointResponse:
    """Hourly waves for one point from the current hour; empty when it is inland."""
    try:
        points = await get_point_waves(lat, lon, tolerance_km=WAVES_POINT_LAND_TOLERANCE_KM)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted for the wave point; reset at %s", exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        # The exception type, never logger.exception: httpx's message carries the request URL, and
        # the point with it (SCRUM-253).
        logger.error("Open-Meteo marine wave request failed for the wave point: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch wave data from Open-Meteo",
        ) from exc

    return WavePointResponse(
        latitude=lat,
        longitude=lon,
        horizon_hours=WAVES_HORIZON_HOURS,
        points=points,
    )
