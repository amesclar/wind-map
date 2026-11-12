"""Database setup, migrations, and SQLite connection utilities."""

import sqlite3
import time
from typing import Generator
from backend.app.config import DATABASE_PATH, DEFAULT_LOCATION


def get_db_connection() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create locations table
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

    # Create weather_cache table
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

    conn.commit()
    conn.close()


def clean_expired_cache() -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM weather_cache WHERE expires_at < ?;", (time.time(),))
    conn.commit()
    conn.close()
