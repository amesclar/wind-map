"""Per-model metadata (SCRUM-115): cadence, horizon and the model's run times.

The Open-Meteo Forecast API stitches the latest run of each model into one series and does not
return the run time, so it is derived from the cycle hours in the model table
(`config.MODEL_METADATA`, documented against frontend/src/assets/weather-models.md).
"""

from datetime import UTC, datetime, timedelta

from backend.app.config import AVAILABLE_MODELS, model_horizon_hours, model_metadata
from backend.app.models import WeatherModelInfo


def floor_hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def last_run_utc(cycles: list[int], now: datetime) -> datetime:
    """Most recent cycle boundary at or before `now`."""
    hour = floor_hour(now.astimezone(UTC))
    for cycle in sorted(cycles, reverse=True):
        if cycle <= hour.hour:
            return hour.replace(hour=cycle)
    return (hour - timedelta(days=1)).replace(hour=max(cycles))


def next_run_utc(cycles: list[int], now: datetime) -> datetime:
    """Next cycle boundary after `now`."""
    hour = floor_hour(now.astimezone(UTC))
    for cycle in sorted(cycles):
        if cycle > hour.hour:
            return hour.replace(hour=cycle)
    return (hour + timedelta(days=1)).replace(hour=min(cycles))


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def model_info(model_id: str, name: str, now: datetime) -> WeatherModelInfo:
    meta = model_metadata(model_id)
    cycles = [int(c) for c in meta["update_cycles_utc"]]  # type: ignore[union-attr]
    return WeatherModelInfo(
        id=model_id,
        name=name,
        update_hours=int(meta["update_hours"]),  # type: ignore[arg-type]
        update_cycles_utc=cycles,
        horizon_hours=model_horizon_hours(model_id),
        last_run_utc=iso_utc(last_run_utc(cycles, now)),
        next_run_utc=iso_utc(next_run_utc(cycles, now)),
    )


def model_infos(now: datetime | None = None) -> list[WeatherModelInfo]:
    """Every selectable model with its cadence, horizon and current/next run time."""
    moment = now or datetime.now(UTC)
    return [model_info(m["id"], m["name"], moment) for m in AVAILABLE_MODELS]
