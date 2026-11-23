"""Database schema, migrations, and SQLite connection utilities.

All tables are defined here (SCRUM-92). Services assume they exist.
"""

import logging
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager

from backend.app.config import DATABASE_PATH, DEFAULT_LOCATION

logger = logging.getLogger(__name__)

# Bump when a table definition below changes. Cache tables are dropped and recreated on
# upgrade (they only hold data that is refetched within 30 minutes). Changes to
# `locations` need an explicit, data-preserving step in `_migrate`.
#   0 → 1 (SCRUM-92): all tables created here; grid cache has temperature_f.
#   1 → 2 (SCRUM-92): forecast caches keyed by timezone too.
SCHEMA_VERSION = 2

LOCATIONS_DDL = """
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

# Forecast cache for saved locations, keyed by (location_id, model, timezone).
WEATHER_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS weather_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    timezone TEXT NOT NULL,
    cached_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(location_id, model, timezone),
    FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE
);
"""

# Forecast cache for ad-hoc map points (grid barb clicks), keyed by rounded
# coordinates, model and timezone.
POINT_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS point_weather_cache (
    lat_key      REAL NOT NULL,
    lon_key      REAL NOT NULL,
    model        TEXT NOT NULL,
    timezone     TEXT NOT NULL,
    cached_at    REAL NOT NULL,
    expires_at   REAL NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (lat_key, lon_key, model, timezone)
);
"""

# Current wind and temperature for wind-grid points, keyed by rounded coordinates.
GRID_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS grid_weather_cache (
    lat_key            REAL NOT NULL,
    lon_key            REAL NOT NULL,
    model              TEXT NOT NULL,
    cached_at          REAL NOT NULL,
    expires_at         REAL NOT NULL,
    wind_speed_knots   REAL NOT NULL,
    wind_direction_deg REAL NOT NULL,
    temperature_f      REAL,
    PRIMARY KEY (lat_key, lon_key, model)
);
"""

CACHE_TABLE_DDL = {
    "weather_cache": WEATHER_CACHE_DDL,
    "point_weather_cache": POINT_CACHE_DDL,
    "grid_weather_cache": GRID_CACHE_DDL,
}
CACHE_TABLES = tuple(CACHE_TABLE_DDL)


def get_db_connection() -> sqlite3.Connection:
    """Open a raw connection. Prefer `db_connection()`, which always closes it."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    # Off by default in SQLite; needed for weather_cache's ON DELETE CASCADE.
    conn.execute("PRAGMA foreign_keys = ON;")
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


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version;").fetchone()[0]
    if version >= SCHEMA_VERSION:
        return
    # Cache tables may predate the current definitions (e.g. a grid cache without
    # temperature_f, or point rows stored in weather_cache under location_id 0).
    for table in CACHE_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table};")
    logger.info("Database schema upgraded from version %d to %d; caches reset", version, SCHEMA_VERSION)


def init_db() -> None:
    with db_connection() as conn:
        _migrate(conn)
        conn.execute(LOCATIONS_DDL)
        for ddl in CACHE_TABLE_DDL.values():
            conn.execute(ddl)
        # PRAGMA values can't be bound as parameters; SCHEMA_VERSION is a constant int.
        conn.execute(f"PRAGMA user_version = {int(SCHEMA_VERSION)};")

        # Seed default location if empty
        row = conn.execute("SELECT COUNT(*) AS count FROM locations;").fetchone()
        if row and row["count"] == 0:
            conn.execute(
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
    """Delete expired rows from every cache table. Returns the number of rows deleted."""
    now = time.time() if now is None else now
    deleted = 0
    with db_connection() as conn:
        for table in CACHE_TABLES:
            # Table names come from the CACHE_TABLES constant, never from user input.
            deleted += conn.execute(f"DELETE FROM {table} WHERE expires_at < ?;", (now,)).rowcount  # noqa: S608
    if deleted:
        logger.info("Removed %d expired cache rows", deleted)
    return deleted
