"""Locations API router: CRUD operations for saved locations."""

import sqlite3
from typing import List
from fastapi import APIRouter, HTTPException, status
from backend.app.database import db_connection
from backend.app.models import LocationCreate, LocationResponse

router = APIRouter(prefix="/api/locations", tags=["locations"])

LOCATION_COLUMNS = "id, name, latitude, longitude, admin1, country, is_default, created_at"


def _row_to_location(row: sqlite3.Row) -> LocationResponse:
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


@router.get("", response_model=List[LocationResponse])
def list_locations() -> List[LocationResponse]:
    with db_connection() as conn:
        rows = conn.execute(
            f"SELECT {LOCATION_COLUMNS} FROM locations ORDER BY is_default DESC, id ASC;"
        ).fetchall()
    return [_row_to_location(row) for row in rows]


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def create_location(location: LocationCreate) -> LocationResponse:
    with db_connection() as conn:
        # Check if duplicate coordinate already exists within ~0.005 deg (~500m)
        existing = conn.execute(
            f"""
            SELECT {LOCATION_COLUMNS}
            FROM locations
            WHERE ABS(latitude - ?) < 0.005 AND ABS(longitude - ?) < 0.005;
            """,
            (location.latitude, location.longitude),
        ).fetchone()
        if existing:
            return _row_to_location(existing)

        cursor = conn.execute(
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
        row = conn.execute(
            f"SELECT {LOCATION_COLUMNS} FROM locations WHERE id = ?;", (cursor.lastrowid,)
        ).fetchone()
    return _row_to_location(row)


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: int):
    with db_connection() as conn:
        row = conn.execute("SELECT id FROM locations WHERE id = ?;", (location_id,)).fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Location with id {location_id} not found",
            )
        conn.execute("DELETE FROM weather_cache WHERE location_id = ?;", (location_id,))
        conn.execute("DELETE FROM locations WHERE id = ?;", (location_id,))
    return None
