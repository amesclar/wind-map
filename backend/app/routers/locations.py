"""Locations API router: CRUD operations for saved locations."""

from typing import List

from fastapi import APIRouter, HTTPException, status

from backend.app import locations_repo
from backend.app.models import LocationCreate, LocationResponse

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=List[LocationResponse])
def list_locations() -> List[LocationResponse]:
    return locations_repo.list_locations()


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def create_location(location: LocationCreate) -> LocationResponse:
    # A location within ~500 m of a saved one returns the saved one (still 201, unchanged API).
    return locations_repo.create_or_get_location(location)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int):
    if not locations_repo.delete_location(location_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )
    return None
