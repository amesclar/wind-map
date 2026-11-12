"""Geocode API router: search and verify locations."""

from typing import List
from fastapi import APIRouter, Query
from backend.app.models import GeocodeResult
from backend.app.services.geocode_service import search_locations

router = APIRouter(prefix="/api/geocode", tags=["geocode"])


@router.get("", response_model=List[GeocodeResult])
async def geocode_query(
    q: str = Query(..., min_length=2, description="Search term for city/location"),
    count: int = Query(10, ge=1, le=20),
) -> List[GeocodeResult]:
    return await search_locations(query=q, count=count)
