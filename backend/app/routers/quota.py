"""Open-Meteo free-tier usage (SCRUM-327): what this app has actually spent."""

from fastapi import APIRouter

from backend.app.models import OpenMeteoUsageResponse
from backend.app.services import open_meteo_usage

router = APIRouter(prefix="/api/weather/quota", tags=["quota"])


@router.get("", response_model=OpenMeteoUsageResponse)
def get_open_meteo_usage() -> OpenMeteoUsageResponse:
    """Today's charged Open-Meteo calls, the last 14 days and the latest quota headers.

    The buffer is flushed first, so the answer includes the calls made since the last batch write.
    """
    open_meteo_usage.flush()
    return OpenMeteoUsageResponse(**open_meteo_usage.summary())
