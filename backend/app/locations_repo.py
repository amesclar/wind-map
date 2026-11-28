"""Data access for saved locations (SCRUM-92). Routers use these instead of raw SQL."""

import sqlite3

from backend.app.config import DUPLICATE_LOCATION_RADIUS_DEG
from backend.app.database import db_connection
from backend.app.models import LocationCreate, LocationResponse

_COLUMNS = "id, name, latitude, longitude, admin1, country, is_default, created_at"


def _to_location(row: sqlite3.Row) -> LocationResponse:
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


def list_locations() -> list[LocationResponse]:
    """Default location first, then in creation order."""
    with db_connection() as conn:
        rows = conn.execute(f"SELECT {_COLUMNS} FROM locations ORDER BY is_default DESC, id ASC;").fetchall()
    return [_to_location(r) for r in rows]


def get_location(location_id: int) -> LocationResponse | None:
    with db_connection() as conn:
        row = conn.execute(f"SELECT {_COLUMNS} FROM locations WHERE id = ?;", (location_id,)).fetchone()
    return _to_location(row) if row else None


def create_or_get_location(location: LocationCreate) -> LocationResponse:
    """Save a location, or return the existing one within DUPLICATE_LOCATION_RADIUS_DEG."""
    radius = DUPLICATE_LOCATION_RADIUS_DEG
    with db_connection() as conn:
        existing = conn.execute(
            f"""
            SELECT {_COLUMNS} FROM locations
            WHERE ABS(latitude - ?) < ? AND ABS(longitude - ?) < ?;
            """,
            (location.latitude, radius, location.longitude, radius),
        ).fetchone()
        if existing:
            return _to_location(existing)

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
        row = conn.execute(f"SELECT {_COLUMNS} FROM locations WHERE id = ?;", (cursor.lastrowid,)).fetchone()
    return _to_location(row)
