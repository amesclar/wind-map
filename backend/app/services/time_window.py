"""Validation of a requested forecast hour (SCRUM-115).

One place decides what `time` values the API accepts, so the grid, the saved-location forecasts
and the point forecast cannot disagree: an hour-aligned UTC instant from the current hour to the
selected model's horizon.
"""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from backend.app.config import model_horizon_hours
from backend.app.services.model_info import floor_hour


def validate_forecast_time(
    at: datetime | None,
    model: str,
    now: datetime | None = None,
) -> datetime | None:
    """Return `at` as an aware UTC datetime, or raise 422 when it cannot be served."""
    if at is None:
        return None
    if at.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="time must include a timezone offset, e.g. 2026-11-25T12:00:00Z",
        )
    utc = at.astimezone(UTC)
    if utc.minute or utc.second or utc.microsecond:
        raise HTTPException(status_code=422, detail="time must be hour-aligned")

    current_hour = floor_hour(now or datetime.now(UTC))
    horizon = model_horizon_hours(model)
    if utc < current_hour:
        raise HTTPException(
            status_code=422,
            detail="time is in the past; the forecast window starts at the current hour",
        )
    if utc > current_hour + timedelta(hours=horizon):
        raise HTTPException(
            status_code=422,
            detail=f"time is beyond the {model} forecast horizon of {horizon} hours",
        )
    return utc


def hour_key(at: datetime | None) -> str:
    """Cache key for an hour: 'current' for live values, else the UTC hour."""
    return "current" if at is None else at.astimezone(UTC).strftime("%Y-%m-%dT%H:00")
