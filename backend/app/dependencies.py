"""Shared request parameters for the weather routers (SCRUM-92)."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Query

from backend.app.config import DEFAULT_MODEL, DEFAULT_TIMEZONE, MODEL_ALIASES, MODEL_IDS

# Rejected names are remembered so a flood of the same bad zone costs one failed lookup, not one
# exception per request (SCRUM-271). Valid names are cheap to re-check: ZoneInfo caches them.
_REJECTED_TIMEZONES: set[str] = set()


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
    """Only real IANA zones are accepted (SCRUM-271).

    A free-form value was forwarded to Open-Meteo, so a bad one turned a client error into a 502,
    created a cache row per distinct string, and reached `ZoneInfo` unguarded in the NWS parser,
    where it raised `ZoneInfoNotFoundError` and made an NDFD forecast a 500.
    """
    if timezone in _REJECTED_TIMEZONES:
        raise HTTPException(status_code=422, detail="Unknown timezone")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError, ValueError:
        _REJECTED_TIMEZONES.add(timezone)
        raise HTTPException(status_code=422, detail="Unknown timezone") from None
    return timezone
