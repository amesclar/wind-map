"""Pydantic models and schemas for API requests and responses."""

from typing import Literal

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
    """One forecast slice. Wind and temperature stay null when Open-Meteo has no value
    (SCRUM-225); 0 kn or 32 °F would be displayed as a real calm."""

    time: str
    temperature_c: float | None
    temperature_f: float | None
    wind_speed_knots: float | None
    wind_speed_kmh: float | None
    wind_speed_mph: float | None
    wind_speed_ms: float | None
    wind_gust_knots: float | None
    wind_gust_kmh: float | None
    wind_gust_mph: float | None
    wind_gust_ms: float | None
    wind_direction_deg: float | None
    wind_direction_cardinal: str | None
    # Null when the provider has no value for the hour: NDFD's humidity grid can gap, and 0 %
    # would read as a real measurement (SCRUM-106). Nothing renders it today.
    humidity: float | None = None
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
    # SCRUM-225: all three stay null when Open-Meteo has no value for the point; a 0 kn /
    # 0° / 32 °F point would read as a real calm.
    wind_speed_knots: float | None
    # Gust for the same moment (SCRUM-210); null when Open-Meteo has none for the point.
    wind_gust_knots: float | None = None
    wind_direction_deg: float | None
    temperature_f: float | None = None
    # Forecast hour these values describe (SCRUM-115); null means current conditions.
    time: str | None = None


class CurrentPoint(BaseModel):
    """A single ocean-current observation for the map layer (SCRUM-96).

    The coordinates are the Marine model cell the value came from (SCRUM-238), not the map
    point that was requested: Open-Meteo snaps each request to its nearest sea cell.
    """

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


class WavePoint(BaseModel):
    """A single wave observation for the map layer (SCRUM-233).

    The coordinates are the marine model cell the value came from, not the requested map point:
    Open-Meteo snaps an inland request to its nearest sea cell.
    """

    latitude: float
    longitude: float
    # Significant wave height in metres (the API's unit); the UI converts to feet.
    height_m: float
    # Direction the waves come from in degrees, meteorological convention like wind, so the
    # frontend rotates an arrow by this + 180 to show where they travel.
    direction_deg: float
    # Peak period in seconds.
    period_s: float
    # Forecast hour these values describe; null means current conditions.
    time: str | None = None


class WaveGridResponse(BaseModel):
    """GET /api/waves/grid payload (SCRUM-233); land nodes are absent, not zeroed."""

    points: list[WavePoint]
    time: str | None = None


class WaveSeriesPoint(BaseModel):
    """One hourly wave value for a single point."""

    time: str
    height_m: float
    direction_deg: float
    period_s: float


class WavePointResponse(BaseModel):
    """GET /api/waves/point payload (SCRUM-233): hourly values from the current hour."""

    latitude: float
    longitude: float
    horizon_hours: int
    points: list[WaveSeriesPoint]


class TideSample(BaseModel):
    """One hourly sea-level sample (SCRUM-195)."""

    # UTC minute stamp, e.g. 2026-11-25T12:00.
    time: str
    # Metres above global mean sea level.
    height_m: float


class TideExtreme(BaseModel):
    """A high or low tide with its refined time and height (SCRUM-195)."""

    type: Literal["high", "low"]
    time: str
    height_m: float


class TidePointResponse(BaseModel):
    """GET /api/tides/point payload; `points` is empty over land."""

    latitude: float
    longitude: float
    # The reference the heights use: global mean sea level, not a chart datum.
    datum: str
    unit: str
    hour: str
    points: list[TideSample]
    last_extreme: TideExtreme | None = None
    next_extreme: TideExtreme | None = None
    # The extreme after the next one, so a pop-up can show a fourth reading (SCRUM-250).
    next_extreme_after: TideExtreme | None = None


class ModelAvailabilityInfo(BaseModel):
    """GET /api/weather/models/{model}/availability (SCRUM-256).

    Nulls mean the model has no single upstream run to ask about (`best_match`, the seamless
    blends, NDFD), not that the lookup failed; the UI then keeps the derived cycle clock.
    """

    model: str
    # Initialisation of the newest run, the moment it became downloadable, and when the next one
    # is expected. ISO 8601 UTC.
    run_utc: str | None = None
    available_utc: str | None = None
    next_available_utc: str | None = None


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
