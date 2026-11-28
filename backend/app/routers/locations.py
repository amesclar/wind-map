"""Locations API router: the saved rows, readable and (for API clients) creatable."""

from fastapi import APIRouter, status

from backend.app import locations_repo
from backend.app.models import LocationCreate, LocationResponse

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationResponse])
def list_locations() -> list[LocationResponse]:
    return locations_repo.list_locations()


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def create_location(location: LocationCreate) -> LocationResponse:
    # A location within ~500 m of a saved one returns the saved one (still 201, unchanged API).
    return locations_repo.create_or_get_location(location)
