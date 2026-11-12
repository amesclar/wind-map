"""Locations API router: CRUD operations for saved locations."""

from typing import List
from fastapi import APIRouter, HTTPException, status
from backend.app.database import get_db_connection
from backend.app.models import LocationCreate, LocationResponse

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=List[LocationResponse])
def list_locations() -> List[LocationResponse]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, name, latitude, longitude, admin1, country, is_default, created_at
        FROM locations
        ORDER BY is_default DESC, id ASC;
        """
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        LocationResponse(
            id=row["id"],
            name=row["name"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            admin1=row["admin1"],
            country=row["country"],
            is_default=bool(row["is_default"]),
            created_at=str(row["created_at"]) if row["created_at"] else None,
        )
        for row in rows
    ]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def create_location(location: LocationCreate) -> LocationResponse:
    conn = get_db_connection()
    cursor = conn.cursor()

    # Check if duplicate coordinate already exists within ~0.005 deg (~500m)
    cursor.execute(
        """
        SELECT id, name, latitude, longitude, admin1, country, is_default, created_at
        FROM locations
        WHERE ABS(latitude - ?) < 0.005 AND ABS(longitude - ?) < 0.005;
        """,
        (location.latitude, location.longitude),
    )
    existing = cursor.fetchone()
    if existing:
        conn.close()
        return LocationResponse(
            id=existing["id"],
            name=existing["name"],
            latitude=existing["latitude"],
            longitude=existing["longitude"],
            admin1=existing["admin1"],
            country=existing["country"],
            is_default=bool(existing["is_default"]),
            created_at=str(existing["created_at"]) if existing["created_at"] else None,
        )

    cursor.execute(
        """
        INSERT INTO locations (name, latitude, longitude, admin1, country, is_default)
        VALUES (?, ?, ?, ?, ?, 0);
        """,
        (
            location.name.strip(),
            round(location.latitude, 4),
            round(location.longitude, 4),
            location.admin1.strip() if location.admin1 else None,
            location.country.strip() if location.country else None,
        ),
    )
    new_id = cursor.lastrowid
    conn.commit()

    cursor.execute("SELECT * FROM locations WHERE id = ?;", (new_id,))
    row = cursor.fetchone()
    conn.close()

    return LocationResponse(
        id=row["id"],
        name=row["name"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        admin1=row["admin1"],
        country=row["country"],
        is_default=bool(row["is_default"]),
        created_at=str(row["created_at"]) if row["created_at"] else None,
    )


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM locations WHERE id = ?;", (location_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Location with id {location_id} not found",
        )

    cursor.execute("DELETE FROM weather_cache WHERE location_id = ?;", (location_id,))
    cursor.execute("DELETE FROM locations WHERE id = ?;", (location_id,))
    conn.commit()
    conn.close()
    return None
