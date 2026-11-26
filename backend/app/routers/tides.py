"""Tide router (SCRUM-195): sea level and the nearest high/low for one point.

No `model` parameter: tides come from the Marine API and do not depend on the selected weather
model. The horizon is the ocean-current horizon (10 days) because it is the same model series.
"""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from backend.app.models import TidePointResponse
from backend.app.routers.currents import quota_exhausted
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.tide_service import get_point_tide
from backend.app.services.time_window import validate_current_time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tides", tags=["tides"])

HOUR_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the ocean-current "
    "horizon. Omit for the current hour.",
)


@router.get("/point", response_model=TidePointResponse)
async def get_tide_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    hour: datetime | None = HOUR_QUERY,
) -> TidePointResponse:
    """Tide height and the nearest high/low for one point; empty over land."""
    at = validate_current_time(hour)
    try:
        return await get_point_tide(lat, lon, at)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted for the tide point; reset at %s", exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        # The exception type, never logger.exception: httpx's message carries the request URL, and
        # the point with it (SCRUM-253).
        logger.error("Open-Meteo marine request failed for the tide point: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch tide data from Open-Meteo",
        ) from exc
