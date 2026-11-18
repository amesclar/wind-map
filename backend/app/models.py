"""Pydantic models and schemas for API requests and responses."""

from typing import List, Optional

from pydantic import BaseModel, Field


class LocationBase(BaseModel):
    name: str = Field(..., description="Location name / label")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    admin1: Optional[str] = Field(None, description="State / Province / Region")
    country: Optional[str] = Field(None, description="Country name")


class LocationCreate(LocationBase):
    pass


class LocationResponse(LocationBase):
    id: int
    is_default: bool = False
    created_at: Optional[str] = None


class GeocodeResult(BaseModel):
    name: str
    latitude: float
    longitude: float
    admin1: Optional[str] = None
    country: Optional[str] = None
    display_name: str


class WeatherForecastPoint(BaseModel):
    time: str
    temperature_c: float
    temperature_f: float
    wind_speed_knots: float
    wind_speed_kmh: float
    wind_speed_mph: float
    wind_speed_ms: float
    wind_gust_knots: float
    wind_gust_kmh: float
    wind_gust_mph: float
    wind_gust_ms: float
    wind_direction_deg: float
    wind_direction_cardinal: str
    humidity: float
    weather_code: int


# location_id reported for ad-hoc map points (not a saved location).
POINT_LOCATION_ID = 0


class WeatherForecastResponse(BaseModel):
    location_id: int  # POINT_LOCATION_ID for ad-hoc map points
    location_name: str
    latitude: float
    longitude: float
    model: str
    timezone: str
    cached: bool
    cached_at: float
    current: WeatherForecastPoint
    forecast: List[WeatherForecastPoint]


class GridWindPoint(BaseModel):
    """A single wind observation point for the map grid overlay."""
    latitude: float
    longitude: float
    wind_speed_knots: float
    wind_direction_deg: float
    temperature_f: Optional[float] = None

