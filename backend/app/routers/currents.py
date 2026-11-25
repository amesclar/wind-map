"""Ocean-current router: currents for a lat/lon bounding box or a single point (SCRUM-96).

No `model` parameter: there is one current field (MeteoFrance SMOC), independent of the selected
weather model, with its own 240-hour horizon.
"""

import logging
from datetime import UTC, datetime
from math import ceil

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from backend.app.config import CURRENT_HORIZON_HOURS, GRID_MAX_DIM
from backend.app.models import CurrentGridResponse, CurrentPointResponse
from backend.app.services.currents_service import get_grid_currents, get_point_currents
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.time_window import hour_key, validate_current_time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/currents", tags=["currents"])

TIME_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the ocean current "
    "horizon. Omit for current conditions.",
)


def quota_exhausted(exc: QuotaExceededError) -> HTTPException:
    """503 with the reset instant, matching the wind grid's quota response (SCRUM-170)."""
    detail = {
        "code": "open_meteo_quota_exhausted",
        "message": "Open-Meteo request limit reached",
        "reset_at": exc.reset_at.isoformat() if exc.reset_at else None,
    }
    headers = None
    if exc.reset_at:
        seconds = max(0, ceil((exc.reset_at - datetime.now(UTC)).total_seconds()))
        headers = {"Retry-After": str(seconds)}
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=detail,
        headers=headers,
    )


@router.get("/grid", response_model=CurrentGridResponse)
async def get_current_grid(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lon: float = Query(..., ge=-180, le=180),
    max_lon: float = Query(..., ge=-180, le=180),
    cols: int = Query(..., ge=2, le=GRID_MAX_DIM),
    rows: int = Query(..., ge=2, le=GRID_MAX_DIM),
    time: datetime | None = TIME_QUERY,
) -> CurrentGridResponse:
    """Currents for a bbox grid, at the current hour or a forecast hour.

    Land nodes and hours outside the model domain are absent from `points`.
    """
    at = validate_current_time(time)
    if min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="min_lat must be less than max_lat")
    if min_lon >= max_lon:
        raise HTTPException(status_code=422, detail="min_lon must be less than max_lon")

    lat_step = (max_lat - min_lat) / (rows - 1) if rows > 1 else 0
    lon_step = (max_lon - min_lon) / (cols - 1) if cols > 1 else 0
    points = [
        (round(min_lat + r * lat_step, 6), round(min_lon + c * lon_step, 6)) for r in range(rows) for c in range(cols)
    ]

    try:
        found = await get_grid_currents(points, at=at)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted (%d current points); reset at %s", len(points), exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo marine request failed (%d points)", len(points))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch ocean current data from Open-Meteo",
        ) from exc

    return CurrentGridResponse(points=found, time=None if at is None else hour_key(at))


@router.get("/point", response_model=CurrentPointResponse)
async def get_current_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> CurrentPointResponse:
    """Hourly currents for one point from the current hour; empty when it is inland."""
    try:
        points = await get_point_currents(lat, lon)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted for the current point; reset at %s", exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        # The exception type, never logger.exception: httpx's message carries the request URL, and
        # the point with it (SCRUM-253).
        logger.error("Open-Meteo marine request failed for the current point: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch ocean current data from Open-Meteo",
        ) from exc

    return CurrentPointResponse(
        latitude=lat,
        longitude=lon,
        horizon_hours=CURRENT_HORIZON_HOURS,
        points=points,
    )
