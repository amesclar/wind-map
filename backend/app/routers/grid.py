"""Grid weather router: returns wind for a lat/lon bounding box, now or at a forecast hour."""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app.config import GRID_MAX_DIM
from backend.app.dependencies import model_param
from backend.app.models import GridWindPoint
from backend.app.routers.errors import quota_exhausted
from backend.app.services.grid_box import grid_points, validate_bounds
from backend.app.services.grid_weather_service import get_grid_wind
from backend.app.services.open_meteo import QuotaExceededError
from backend.app.services.time_window import validate_forecast_time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather/grid", tags=["grid"])

# Hard limits to prevent runaway requests
MAX_COLS = GRID_MAX_DIM
MAX_ROWS = GRID_MAX_DIM

TIME_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the model's horizon. "
    "Omit for current conditions.",
)


@router.get("", response_model=list[GridWindPoint])
async def get_wind_grid(
    min_lat: float = Query(..., ge=-90, le=90),
    max_lat: float = Query(..., ge=-90, le=90),
    min_lon: float = Query(..., ge=-180, le=180),
    max_lon: float = Query(..., ge=-180, le=180),
    cols: int = Query(..., ge=2, le=MAX_COLS),
    rows: int = Query(..., ge=2, le=MAX_ROWS),
    model: str = Depends(model_param),
    time: datetime | None = TIME_QUERY,
    refresh: bool = Query(
        False,
        description="Refetch only the points cached before the model's newest published run "
        "(SCRUM-113); the rest are served from cache and the response shape is unchanged.",
    ),
) -> list[GridWindPoint]:
    at = validate_forecast_time(time, model)
    validate_bounds(min_lat, max_lat, min_lon, max_lon)
    points = grid_points(min_lat, max_lat, min_lon, max_lon, cols, rows)

    try:
        return await get_grid_wind(points, model=model, at=at, refresh=refresh)
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted (%d points); reset at %s", len(points), exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo grid request failed (%d points)", len(points))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch grid wind data from Open-Meteo",
        ) from exc
