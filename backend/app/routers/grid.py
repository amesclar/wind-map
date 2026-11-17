"""Grid weather router: returns current wind for a lat/lon bounding box."""

import logging
from typing import List
import httpx
from fastapi import APIRouter, HTTPException, Query, status
from backend.app.models import GridWindPoint
from backend.app.services.grid_weather_service import get_grid_wind

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather/grid", tags=["grid"])

# Hard limits to prevent runaway requests
MAX_COLS = 30
MAX_ROWS = 30


@router.get("", response_model=List[GridWindPoint])
async def get_wind_grid(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lon: float = Query(..., ge=-180, le=180),
    max_lon: float = Query(..., ge=-180, le=180),
    cols: int = Query(..., ge=2, le=MAX_COLS),
    rows: int = Query(..., ge=2, le=MAX_ROWS),
    model: str = Query("best_match"),
) -> List[GridWindPoint]:
    if min_lat >= max_lat:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min_lat must be less than max_lat",
        )
    if min_lon >= max_lon:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="min_lon must be less than max_lon",
        )

    lat_step = (max_lat - min_lat) / (rows - 1) if rows > 1 else 0
    lon_step = (max_lon - min_lon) / (cols - 1) if cols > 1 else 0

    points = [
        (round(min_lat + r * lat_step, 6), round(min_lon + c * lon_step, 6))
        for r in range(rows)
        for c in range(cols)
    ]

    try:
        return await get_grid_wind(points, model=model)
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo grid request failed (%d points)", len(points))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch grid wind data from Open-Meteo",
        ) from exc
