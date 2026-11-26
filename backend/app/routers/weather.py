"""Weather API router: weather forecast endpoints."""

import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.app import locations_repo
from backend.app.config import MODEL_ALIASES, MODEL_IDS
from backend.app.dependencies import model_param, timezone_param
from backend.app.models import ModelAvailabilityInfo, WeatherForecastResponse, WeatherModelInfo
from backend.app.routers.errors import quota_exhausted
from backend.app.services import model_availability, nws
from backend.app.services.model_info import model_infos
from backend.app.services.open_meteo import QuotaExceededError
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


@router.get("/models/{model}/availability", response_model=ModelAvailabilityInfo)
async def get_model_availability(model: str) -> ModelAvailabilityInfo:
    """When the model's newest run was published and when the next one is due (SCRUM-256).

    Nulls mean "no usable metadata for this model": composites and GEM have no file to read, and
    an upstream outage is an empty answer rather than an error, because this is a freshness hint
    on top of the derived cycle, never the forecast itself.
    """
    resolved = MODEL_ALIASES.get(model, model)
    if resolved not in MODEL_IDS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown model: {model}")

    found = await model_availability.availability_for(resolved)
    return ModelAvailabilityInfo(
        model=resolved,
        run_utc=found.run_utc if found else None,
        available_utc=found.available_utc if found else None,
        next_available_utc=found.next_available_utc if found else None,
    )


TIME_QUERY = Query(
    None,
    description="Forecast hour (ISO 8601 with offset, hour-aligned) up to the model's horizon. "
    "Omit for current conditions.",
)

REFRESH_QUERY = Query(
    False,
    description="Refetch only cached rows older than the model's newest published run (SCRUM-113). "
    "Rows already newer than that run are served from cache, so a repeat click costs no call.",
)


@router.get("", response_model=WeatherForecastResponse)
async def get_location_weather(
    location_id: int = Query(..., description="ID of saved location"),
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
    time: datetime | None = TIME_QUERY,
    refresh: bool = REFRESH_QUERY,
) -> WeatherForecastResponse:
    at = validate_forecast_time(time, model)
    location = locations_repo.get_location(location_id)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    try:
        return await get_location_forecast(location, model=model, timezone=timezone, at=at, refresh=refresh)
    except nws.NwsCoverageError as exc:
        raise coverage_error() from exc
    except QuotaExceededError as exc:
        # Before the generic handler: the quota error subclasses httpx.HTTPError, and an exhausted
        # upstream is a 503 with its reset time, not a 502 (SCRUM-278).
        logger.warning("Open-Meteo quota exhausted for location %s; reset at %s", location_id, exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        logger.exception("Weather forecast request failed for location %s", location_id)
        raise upstream_error("Failed to fetch weather forecast") from exc


@router.get("/all", response_model=list[WeatherForecastResponse])
async def get_all_locations_weather(
    model: str = Depends(model_param),
    timezone: str = Depends(timezone_param),
    time: datetime | None = TIME_QUERY,
    refresh: bool = REFRESH_QUERY,
) -> list[WeatherForecastResponse]:
    at = validate_forecast_time(time, model)
    results: list[WeatherForecastResponse] = []
    for location in sorted(locations_repo.list_locations(), key=lambda loc: loc.id):
        try:
            results.append(
                await get_location_forecast(location, model=model, timezone=timezone, at=at, refresh=refresh)
            )
        except QuotaExceededError as exc:
            # The quota is global, not per location: abort the loop rather than answer 200 with
            # locations silently missing (SCRUM-278).
            logger.warning("Open-Meteo quota exhausted; aborting the all-locations fetch")
            raise quota_exhausted(exc) from exc
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
    refresh: bool = REFRESH_QUERY,
) -> WeatherForecastResponse:
    """
    Return a full forecast for an arbitrary lat/lon point (no saved location needed).
    location_id is 0 and location_name is the formatted coordinates.
    """
    at = validate_forecast_time(time, model)
    try:
        return await get_point_forecast(lat, lon, model=model, timezone=timezone, at=at, refresh=refresh)
    except nws.NwsCoverageError as exc:
        raise coverage_error() from exc
    except QuotaExceededError as exc:
        logger.warning("Open-Meteo quota exhausted for the point; reset at %s", exc.reset_at)
        raise quota_exhausted(exc) from exc
    except httpx.HTTPError as exc:
        # The exception type, never logger.exception: httpx's message carries the request URL, and
        # the point with it (SCRUM-253).
        logger.error("Point forecast request failed: %s", type(exc).__name__)
        raise upstream_error("Failed to fetch point weather forecast") from exc
