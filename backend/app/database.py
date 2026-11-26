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
#   2 → 3 (SCRUM-115): every cache row is keyed by the forecast hour too ('current' = live).
#   3 → 4 (SCRUM-96): ocean-current grid cache, keyed by hour like the wind grid.
#   4 → 5 (SCRUM-210): the wind grid cache keeps the gust too, so barb pop-ups show it.
#   5 → 6 (SCRUM-238): the currents cache keeps the model cell each value came from.
#   6 → 7 (SCRUM-238): cached current cells are re-checked against elevation, so land rows go.
#   7 → 8 (SCRUM-195): sea-level cache for tide pop-ups, keyed by point and hour.
#   8 → 9 (SCRUM-106): long-lived NWS grid mapping, so a coordinate's grid is looked up once.
SCHEMA_VERSION = 9

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

# Forecast cache for saved locations, keyed by (location_id, model, timezone, hour).
WEATHER_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS weather_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    timezone TEXT NOT NULL,
    hour TEXT NOT NULL DEFAULT 'current',
    cached_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(location_id, model, timezone, hour),
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
    hour         TEXT NOT NULL DEFAULT 'current',
    cached_at    REAL NOT NULL,
    expires_at   REAL NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (lat_key, lon_key, model, timezone, hour)
);
"""

# Wind and temperature for wind-grid points, keyed by rounded coordinates and forecast hour
# ('current' for live values, else the UTC hour — SCRUM-115).
GRID_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS grid_weather_cache (
    lat_key            REAL NOT NULL,
    lon_key            REAL NOT NULL,
    model              TEXT NOT NULL,
    hour               TEXT NOT NULL DEFAULT 'current',
    cached_at          REAL NOT NULL,
    expires_at         REAL NOT NULL,
    wind_speed_knots   REAL NOT NULL,
    wind_gust_knots    REAL,
    wind_direction_deg REAL NOT NULL,
    temperature_f      REAL,
    PRIMARY KEY (lat_key, lon_key, model, hour)
);
"""

# Ocean-current velocity and direction for grid points and point series, keyed by rounded
# coordinates and forecast hour. A row with NULL values records that the point was checked and
# has no current there (land, or outside the SMOC domain), so an inland view is not refetched
# on every request (SCRUM-96).
GRID_CURRENTS_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS grid_currents_cache (
    lat_key        REAL NOT NULL,
    lon_key        REAL NOT NULL,
    hour           TEXT NOT NULL DEFAULT 'current',
    cached_at      REAL NOT NULL,
    expires_at     REAL NOT NULL,
    velocity_knots REAL,
    direction_deg  REAL,
    -- The Marine model cell the value came from (SCRUM-238): Open-Meteo snaps a requested
    -- point to its nearest sea cell, and the chevron is drawn here instead of on land.
    cell_lat       REAL,
    cell_lon       REAL,
    PRIMARY KEY (lat_key, lon_key, hour)
);
"""

# Sea level for a point, keyed by rounded coordinates and forecast hour (SCRUM-195). A row with a
# NULL height records that the point was checked and has no water there (inland or outside the
# SMOC domain), so an inland pop-up is not refetched every time.
TIDE_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS tide_point_cache (
    lat_key   REAL NOT NULL,
    lon_key   REAL NOT NULL,
    hour      TEXT NOT NULL,
    cached_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    height_m  REAL,
    PRIMARY KEY (lat_key, lon_key, hour)
);
"""

# NWS `/points` mapping: which forecast office and grid cell a coordinate belongs to (SCRUM-106).
# It has no expiry — a coordinate's grid does not move — so it is deliberately outside
# CACHE_TABLE_DDL: `clean_expired_cache` sweeps rows by `expires_at`, and dropping it on every
# schema bump would throw away mappings that are still correct.
NWS_GRID_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS nws_grid_cache (
    lat_key   REAL NOT NULL,
    lon_key   REAL NOT NULL,
    office    TEXT NOT NULL,
    grid_x    INTEGER NOT NULL,
    grid_y    INTEGER NOT NULL,
    cached_at REAL NOT NULL,
    PRIMARY KEY (lat_key, lon_key)
);
"""

CACHE_TABLE_DDL = {
    "weather_cache": WEATHER_CACHE_DDL,
    "point_weather_cache": POINT_CACHE_DDL,
    "grid_weather_cache": GRID_CACHE_DDL,
    "grid_currents_cache": GRID_CURRENTS_CACHE_DDL,
    "tide_point_cache": TIDE_CACHE_DDL,
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
    # nws_grid_cache is not in that list on purpose: its rows stay correct across upgrades.
    for table in CACHE_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table};")
    logger.info("Database schema upgraded from version %d to %d; caches reset", version, SCHEMA_VERSION)


def init_db() -> None:
    with db_connection() as conn:
        _migrate(conn)
        conn.execute(LOCATIONS_DDL)
        for ddl in CACHE_TABLE_DDL.values():
            conn.execute(ddl)
        conn.execute(NWS_GRID_CACHE_DDL)
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
