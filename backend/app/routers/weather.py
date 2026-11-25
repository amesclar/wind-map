"""Weather API router: weather forecast endpoints."""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app import locations_repo
from backend.app.dependencies import model_param, timezone_param
from backend.app.models import WeatherForecastResponse, WeatherModelInfo
from backend.app.services import nws
from backend.app.services.model_info import model_infos
from backend.app.services.time_window import validate_forecast_time
from backend.app.services.weather_service import get_location_forecast, get_point_forecast

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/weather", tags=["weather"])


def upstream_error(message: str) -> HTTPException:
    """502 for provider failures. The message is fixed; details go to the log only."""
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)


def coverage_error() -> HTTPException:
    """404 when the selected provider has no data for the location (NDFD is US only)."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="NWS NDFD covers the United States only; choose another model for this location",
    )


@router.get("/models", response_model=list[WeatherModelInfo])
def list_models() -> list[WeatherModelInfo]:
    """Selectable models with their cadence, time horizon and current/next run time (SCRUM-115)."""
    return model_infos()


TIME_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the model's horizon. "
    "Omit for current conditions.",
)


@router.get("", response_model=WeatherForecastResponse)
async def get_location_weather(
    location_id: int = Query(..., description="ID of saved location"),
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
    time: datetime | None = TIME_QUERY,
) -> WeatherForecastResponse:
    at = validate_forecast_time(time, model)
    location = locations_repo.get_location(location_id)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    try:
        return await get_location_forecast(location, model=model, timezone=timezone, at=at)
    except nws.NwsCoverageError as exc:
        raise coverage_error() from exc
    except httpx.HTTPError as exc:
        logger.exception("Weather forecast request failed for location %s", location_id)
        raise upstream_error("Failed to fetch weather forecast") from exc


@router.get("/all", response_model=list[WeatherForecastResponse])
async def get_all_locations_weather(
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
    time: datetime | None = TIME_QUERY,
) -> list[WeatherForecastResponse]:
    at = validate_forecast_time(time, model)
    results: list[WeatherForecastResponse] = []
    for location in sorted(locations_repo.list_locations(), key=lambda loc: loc.id):
        try:
            results.append(await get_location_forecast(location, model=model, timezone=timezone, at=at))
        except httpx.HTTPError:
            # One failing location must not hide the others; it is logged, not swallowed. An NDFD
            # point outside the US lands here too, so its marker shows "No data" (SCRUM-245).
            logger.exception("Forecast request failed for location %s; skipping", location.id)
            continue
    return results


@router.get("/point", response_model=WeatherForecastResponse)
async def get_point_weather(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
    time: datetime | None = TIME_QUERY,
) -> WeatherForecastResponse:
    """
    Return a full forecast for an arbitrary lat/lon point (no saved location needed).
    location_id is 0 and location_name is the formatted coordinates.
    """
    at = validate_forecast_time(time, model)
    try:
        return await get_point_forecast(lat, lon, model=model, timezone=timezone, at=at)
    except nws.NwsCoverageError as exc:
        raise coverage_error() from exc
    except httpx.HTTPError as exc:
        logger.exception("Point forecast request failed for %s,%s", lat, lon)
        raise upstream_error("Failed to fetch point weather forecast") from exc
