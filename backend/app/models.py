"""Pydantic models and schemas for API requests and responses."""

from pydantic import BaseModel, Field


class LocationBase(BaseModel):
    name: str = Field(..., description="Location name / label")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    admin1: str | None = Field(None, description="State / Province / Region")
    country: str | None = Field(None, description="Country name")


class LocationCreate(LocationBase):
    pass


class LocationResponse(LocationBase):
    id: int
    is_default: bool = False
    created_at: str | None = None


class GeocodeResult(BaseModel):
    name: str
    latitude: float
    longitude: float
    admin1: str | None = None
    country: str | None = None
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
    forecast: list[WeatherForecastPoint]
    # Hour the `current` values describe (SCRUM-115); null means live current conditions.
    valid_time: str | None = None


class GridWindPoint(BaseModel):
    """A single wind observation point for the map grid overlay."""

    latitude: float
    longitude: float
    wind_speed_knots: float
    # Gust for the same moment (SCRUM-210); null when Open-Meteo has none for the point.
    wind_gust_knots: float | None = None
    wind_direction_deg: float
    temperature_f: float | None = None
    # Forecast hour these values describe (SCRUM-115); null means current conditions.
    time: str | None = None


class CurrentPoint(BaseModel):
    """A single ocean-current observation for the map layer (SCRUM-96)."""

    latitude: float
    longitude: float
    # Speed at the surface in knots (kept in the app's speed unit); direction the water flows
    # towards in degrees, so a chevron rotates by this value directly.
    velocity_knots: float
    direction_deg: float
    # Forecast hour these values describe; null means current conditions.
    time: str | None = None


class CurrentGridResponse(BaseModel):
    """GET /api/currents/grid payload (SCRUM-96); land nodes are absent, not zeroed."""

    points: list[CurrentPoint]
    time: str | None = None


class CurrentSeriesPoint(BaseModel):
    """One hourly ocean-current value, in the app's speed unit, for a single point."""

    time: str
    velocity_knots: float
    direction_deg: float


class CurrentPointResponse(BaseModel):
    """GET /api/currents/point payload (SCRUM-96): hourly values from the current hour."""

    latitude: float
    longitude: float
    horizon_hours: int
    points: list[CurrentSeriesPoint]


class WeatherModelInfo(BaseModel):
    """One entry of GET /api/weather/models (SCRUM-115)."""

    id: str
    name: str
    # Hours between model runs, and the UTC cycle hours those runs happen at.
    update_hours: int
    update_cycles_utc: list[int]
    # Forecast hours the model covers; the grid's `time` must stay inside it.
    horizon_hours: int
    # Most recent and next cycle boundary (ISO 8601 UTC), derived from the cycle hours.
    last_run_utc: str
    next_run_utc: str
