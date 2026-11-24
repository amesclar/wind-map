"""Validation of a requested forecast hour (SCRUM-115).

One place decides what `time` values the API accepts, so the grid, the saved-location forecasts
and the point forecast cannot disagree: an hour-aligned UTC instant from the current hour to the
selected model's horizon.
"""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from backend.app.config import CURRENT_HORIZON_HOURS, model_horizon_hours
from backend.app.services.model_info import floor_hour


def _validate_hour(
    at: datetime | None,
    horizon_hours: int,
    horizon_label: str,
    now: datetime | None = None,
) -> datetime | None:
    """Shared rule: an hour-aligned UTC instant from the current hour to `horizon_hours`."""
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
    if utc < current_hour:
        raise HTTPException(
            status_code=422,
            detail="time is in the past; the forecast window starts at the current hour",
        )
    if utc > current_hour + timedelta(hours=horizon_hours):
        raise HTTPException(
            status_code=422,
            detail=f"time is beyond the {horizon_label} of {horizon_hours} hours",
        )
    return utc


def validate_forecast_time(
    at: datetime | None,
    model: str,
    now: datetime | None = None,
) -> datetime | None:
    """Return `at` as an aware UTC datetime, or raise 422 when it cannot be served."""
    return _validate_hour(at, model_horizon_hours(model), f"{model} forecast horizon", now)


def validate_current_time(
    at: datetime | None,
    now: datetime | None = None,
) -> datetime | None:
    """Currents have their own 10-day horizon, independent of the selected weather model."""
    return _validate_hour(at, CURRENT_HORIZON_HOURS, "ocean current horizon", now)


def hour_key(at: datetime | None) -> str:
    """Cache key for an hour: 'current' for live values, else the UTC hour."""
    return "current" if at is None else at.astimezone(UTC).strftime("%Y-%m-%dT%H:00")
