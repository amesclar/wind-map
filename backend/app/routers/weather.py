"""Weather API router: weather forecast endpoints."""

from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, status
from backend.app.config import AVAILABLE_MODELS
from backend.app.database import get_db_connection
from backend.app.models import WeatherForecastResponse
from backend.app.services.weather_service import get_weather

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/models")
def list_models() -> List[Dict[str, str]]:
    return AVAILABLE_MODELS


@router.get("", response_model=WeatherForecastResponse)
async def get_location_weather(
    location_id: int = Query(..., description="ID of saved location"),
    model: str = Query("best_match", description="Weather forecast model"),
    timezone: str = Query("America/Los_Angeles", description="Timezone name"),
) -> WeatherForecastResponse:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM locations WHERE id = ?;", (location_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    try:
        forecast = await get_weather(
            location_id=row["id"],
            location_name=row["name"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            model=model,
            timezone=timezone,
        )
        return forecast
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch weather forecast: {str(exc)}",
        )


@router.get("/all", response_model=List[WeatherForecastResponse])
async def get_all_locations_weather(
    model: str = Query("best_match", description="Weather forecast model"),
    timezone: str = Query("America/Los_Angeles", description="Timezone name"),
) -> List[WeatherForecastResponse]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM locations ORDER BY id ASC;")
    rows = cursor.fetchall()
    conn.close()

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
        except Exception:
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
    Used by the wind grid overlay chevron click to populate the drawer ephemerally.
    location_id is 0 and location_name is the formatted coordinates.
    """
    location_name = f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}, {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"
    try:
        forecast = await get_weather(
            location_id=0,
            location_name=location_name,
            latitude=lat,
            longitude=lon,
            model=model,
            timezone=timezone,
        )
        return forecast
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch point weather forecast: {str(exc)}",
        )

