"""Geocode API router: search and verify locations."""

import logging
from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from backend.app.models import GeocodeResult
from backend.app.services.geocode_service import MIN_QUERY_LENGTH, search_locations

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/geocode", tags=["geocode"])


@router.get("", response_model=List[GeocodeResult])
async def geocode_query(
    q: str = Query(..., min_length=MIN_QUERY_LENGTH, description="Search term for city/location"),
    count: int = Query(10, ge=1, le=20),
) -> List[GeocodeResult]:
    try:
        return await search_locations(query=q, count=count)
    except httpx.HTTPError as exc:
        logger.exception("Open-Meteo geocoding request failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to search locations with Open-Meteo",
        ) from exc
