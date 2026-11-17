"""Weather API router: weather forecast endpoints."""

import logging
from typing import List, Dict
import httpx
from fastapi import APIRouter, HTTPException, Query, status
from backend.app.config import AVAILABLE_MODELS
from backend.app.database import db_connection
from backend.app.models import WeatherForecastResponse
from backend.app.services.weather_service import get_weather

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
    model: str = Query("best_match", description="Weather forecast model"),
    timezone: str = Query("America/Los_Angeles", description="Timezone name"),
) -> WeatherForecastResponse:
    with db_connection() as conn:
        row = conn.execute("SELECT * FROM locations WHERE id = ?;", (location_id,)).fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    try:
        return await get_weather(
            location_id=row["id"],
            location_name=row["name"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            model=model,
            timezone=timezone,
        )
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo forecast request failed for location %s", location_id)
        raise upstream_error("Failed to fetch weather forecast from Open-Meteo") from exc


@router.get("/all", response_model=List[WeatherForecastResponse])
async def get_all_locations_weather(
    model: str = Query("best_match", description="Weather forecast model"),
    timezone: str = Query("America/Los_Angeles", description="Timezone name"),
) -> List[WeatherForecastResponse]:
    with db_connection() as conn:
        rows = conn.execute("SELECT * FROM locations ORDER BY id ASC;").fetchall()

    results: List[WeatherForecastResponse] = []
    for row in rows:
        try:
            fc = await get_weather(
                location_id=row["id"],
                location_name=row["name"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                model=model,
                timezone=timezone,
            )
            results.append(fc)
        except httpx.HTTPError:
            # One failing location must not hide the others; it is logged, not swallowed.
            logger.exception("Open-Meteo forecast request failed for location %s; skipping", row["id"])
            continue
    return results


@router.get("/point", response_model=WeatherForecastResponse)
async def get_point_weather(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    model: str = Query("best_match", description="Weather forecast model"),
    timezone: str = Query("America/Los_Angeles", description="Timezone name"),
) -> WeatherForecastResponse:
    """
    Return a full forecast for an arbitrary lat/lon point (no saved location needed).
    Used by the wind grid overlay barb click to populate the drawer ephemerally.
    location_id is 0 and location_name is the formatted coordinates.
    """
    location_name = f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"
    try:
        return await get_weather(
            location_id=0,
            location_name=location_name,
            latitude=lat,
            longitude=lon,
            model=model,
            timezone=timezone,
        )
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo point forecast request failed for %s,%s", lat, lon)
        raise upstream_error("Failed to fetch point weather forecast from Open-Meteo") from exc
