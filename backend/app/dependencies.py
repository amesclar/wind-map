"""Shared request parameters for the weather routers (SCRUM-92)."""

from fastapi import HTTPException, Query

from backend.app.config import DEFAULT_MODEL, DEFAULT_TIMEZONE, MODEL_ALIASES, MODEL_IDS


def model_param(
    model: str = Query(DEFAULT_MODEL, description="Weather forecast model (see /api/weather/models)"),
) -> str:
    """Only models listed by /api/weather/models are accepted. Anything else would be
    passed to Open-Meteo and would create a new cache key per value. A retired id is answered
    as its replacement while an old frontend may still send it (SCRUM-226)."""
    model = MODEL_ALIASES.get(model, model)
    if model not in MODEL_IDS:
        raise HTTPException(
            status_code=422,  # literal: the status constant's name differs across Starlette versions
            detail=f"Unknown model. Use one of: {', '.join(sorted(MODEL_IDS))}",
        )
    return model


def timezone_param(
    timezone: str = Query(DEFAULT_TIMEZONE, description="IANA timezone name"),
) -> str:
    return timezone
