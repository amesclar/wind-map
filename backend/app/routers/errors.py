"""HTTP shapes shared by more than one router (SCRUM-281).

`quota_exhausted` used to live in the currents router, so the waves endpoint's response format
depended on another endpoint's module: a change in one silently changed the other.
"""

from datetime import UTC, datetime
from math import ceil

from fastapi import HTTPException, status

from backend.app.services.open_meteo import QuotaExceededError


def quota_exhausted(exc: QuotaExceededError) -> HTTPException:
    """503 with the reset instant, in the shape `parseQuotaExhausted` reads (SCRUM-170)."""
    detail = {
        "code": "open_meteo_quota_exhausted",
        "message": "Open-Meteo request limit reached",
        "reset_at": exc.reset_at.isoformat() if exc.reset_at else None,
    }
    headers = None
    if exc.reset_at:
        seconds = max(0, ceil((exc.reset_at - datetime.now(UTC)).total_seconds()))
        headers = {"Retry-After": str(seconds)}
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=detail,
        headers=headers,
    )
