"""Database setup, migrations, and SQLite connection utilities."""

import logging
import sqlite3
import time
from contextlib import contextmanager
from typing import Iterator

from backend.app.config import DATABASE_PATH, DEFAULT_LOCATION

logger = logging.getLogger(__name__)

# Cache tables cleaned by clean_expired_cache(). Tables that don't exist yet are skipped
# (point and grid caches are still created lazily by their services; SCRUM-92 phase 3).
CACHE_TABLES = ("weather_cache", "point_weather_cache", "grid_weather_cache")


def get_db_connection() -> sqlite3.Connection:
    """Open a raw connection. Prefer `db_connection()`, which always closes it."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def db_connection() -> Iterator[sqlite3.Connection]:
    """Yield a connection that commits on success, rolls back on error, and always closes."""
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                admin1 TEXT,
                country TEXT,
                is_default BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS weather_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                location_id INTEGER NOT NULL,
                model TEXT NOT NULL,
                cached_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                payload_json TEXT NOT NULL,
                UNIQUE(location_id, model),
                FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE
            );
            """
        )

        # Seed default location if empty
        cursor.execute("SELECT COUNT(*) as count FROM locations;")
        row = cursor.fetchone()
        if row and row["count"] == 0:
            cursor.execute(
                """
                INSERT INTO locations (name, latitude, longitude, admin1, country, is_default)
                VALUES (?, ?, ?, ?, ?, 1);
                """,
                (
                    DEFAULT_LOCATION["name"],
                    DEFAULT_LOCATION["latitude"],
                    DEFAULT_LOCATION["longitude"],
                    DEFAULT_LOCATION.get("admin1"),
                    DEFAULT_LOCATION.get("country"),
                ),
            )


def clean_expired_cache(now: float | None = None) -> int:
    """Delete expired rows from every existing cache table. Returns the number of rows deleted."""
    now = time.time() if now is None else now
    deleted = 0
    with db_connection() as conn:
        existing = {
            r["name"]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table';").fetchall()
        }
        for table in CACHE_TABLES:
            if table in existing:
                # Table names come from the CACHE_TABLES constant, never from user input.
                deleted += conn.execute(f"DELETE FROM {table} WHERE expires_at < ?;", (now,)).rowcount
    if deleted:
        logger.info("Removed %d expired cache rows", deleted)
    return deleted
