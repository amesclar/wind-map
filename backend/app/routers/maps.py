"""Map API router: map session tokens and provider endpoints (SCRUM-311)."""

import logging

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from backend.app.services.google_maps import get_google_maps_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/map", tags=["map"])


class GoogleSessionResponse(BaseModel):
    session: str
    expiry: int
    tile_url: str
    attribution: str


@router.get("/google-session", response_model=GoogleSessionResponse)
async def google_session() -> GoogleSessionResponse:
    """Return a Google Map Tiles API session token and tile URL template.

    Caches the session token for up to 13 days to protect API quotas.
    Returns 503 if GCP_MAP_KEY is not configured on the server.
    """
    try:
        session_obj = await get_google_maps_session()
        return GoogleSessionResponse(
            session=session_obj.session,
            expiry=session_obj.expiry,
            tile_url=session_obj.tile_url,
            attribution=session_obj.attribution,
        )
    except ValueError as exc:
        logger.warning("Google Maps session requested but key is not configured: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Maps API key not configured",
        ) from exc
    except httpx.HTTPStatusError as exc:
        logger.error("Google Maps API returned error status: %s", exc.response.status_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Map Tiles API request failed: {exc.response.status_code}",
        ) from exc
    except httpx.HTTPError as exc:
        logger.error("Google Maps API request network error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to connect to Google Map Tiles API",
        ) from exc
