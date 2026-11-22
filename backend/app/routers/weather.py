"""Weather API router: weather forecast endpoints."""

import logging
from typing import Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app import locations_repo
from backend.app.config import AVAILABLE_MODELS
from backend.app.dependencies import model_param, timezone_param
from backend.app.models import WeatherForecastResponse
from backend.app.services.weather_service import get_location_forecast, get_point_forecast

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather", tags=["weather"])


def upstream_error(message: str) -> HTTPException:
    """502 for Open-Meteo failures. The message is fixed; details go to the log only."""
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)


@router.get("/models")
def list_models() -> List[Dict[str, str]]:
    return AVAILABLE_MODELS


@router.get("", response_model=WeatherForecastResponse)
async def get_location_weather(
    location_id: int = Query(..., description="ID of saved location"),
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
) -> WeatherForecastResponse:
    location = locations_repo.get_location(location_id)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    try:
        return await get_location_forecast(location, model=model, timezone=timezone)
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo forecast request failed for location %s", location_id)
        raise upstream_error("Failed to fetch weather forecast from Open-Meteo") from exc


@router.get("/all", response_model=List[WeatherForecastResponse])
async def get_all_locations_weather(
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
) -> List[WeatherForecastResponse]:
    results: List[WeatherForecastResponse] = []
    for location in sorted(locations_repo.list_locations(), key=lambda loc: loc.id):
        try:
            results.append(await get_location_forecast(location, model=model, timezone=timezone))
        except httpx.HTTPError:
            # One failing location must not hide the others; it is logged, not swallowed.
            logger.exception("Open-Meteo forecast request failed for location %s; skipping", location.id)
            continue
    return results


@router.get("/point", response_model=WeatherForecastResponse)
async def get_point_weather(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
) -> WeatherForecastResponse:
    """
    Return a full forecast for an arbitrary lat/lon point (no saved location needed).
    Used by the wind grid overlay barb click to populate the drawer ephemerally.
    location_id is 0 and location_name is the formatted coordinates.
    """
    try:
        return await get_point_forecast(lat, lon, model=model, timezone=timezone)
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo point forecast request failed for %s,%s", lat, lon)
        raise upstream_error("Failed to fetch point weather forecast from Open-Meteo") from exc
