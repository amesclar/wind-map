"""Database schema, migrations, and SQLite connection utilities.

All tables are defined here (SCRUM-92). Services assume they exist.
"""

import logging
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager

from backend.app.config import DATABASE_PATH, DEFAULT_LOCATION, OPEN_METEO_USAGE_RETENTION_DAYS

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
#   9 → 10 (SCRUM-233): ocean-wave grid cache, keyed by point and hour like the currents.
#  10 → 11 (SCRUM-327): the Open-Meteo usage log, which is kept across upgrades.
SCHEMA_VERSION = 11

# How long a writer waits for another connection's lock before SQLite raises "database is locked"
# (SCRUM-274). Five seconds matches the driver default but is now explicit and documented.
BUSY_TIMEOUT_MS = 5000

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

# Ocean waves (SCRUM-233), keyed like the currents cache. A NULL height records a point that was
# checked and has no waves there (inland or outside the wave model), so an inland view is not
# refetched on every request. The cell is stored because a coastal request is snapped to water.
GRID_WAVES_CACHE_DDL = """
CREATE TABLE IF NOT EXISTS grid_waves_cache (
    lat_key            REAL NOT NULL,
    lon_key            REAL NOT NULL,
    hour               TEXT NOT NULL DEFAULT 'current',
    cached_at          REAL NOT NULL,
    expires_at         REAL NOT NULL,
    wave_height_m      REAL,
    wave_direction_deg REAL,
    wave_period_s      REAL,
    cell_lat           REAL,
    cell_lon           REAL,
    PRIMARY KEY (lat_key, lon_key, hour)
);
"""

# Open-Meteo free-tier usage log (SCRUM-327): one row per upstream attempt, with the charge and
# quota numbers Open-Meteo reported. It is deliberately outside CACHE_TABLE_DDL: unlike a cache it
# cannot be refetched, so a schema bump must keep it (nws_grid_cache is kept for the same reason).
OPEN_METEO_USAGE_DDL = """
CREATE TABLE IF NOT EXISTS open_meteo_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          REAL NOT NULL,
    hour        TEXT NOT NULL,
    day         TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    status      INTEGER NOT NULL,
    cost        REAL NOT NULL DEFAULT 0,
    quota_limit REAL,
    remaining   REAL,
    window_s    INTEGER,
    reset_at    REAL
);
"""

# Pruning deletes by `at`, so the oldest rows are found without scanning the whole log.
OPEN_METEO_USAGE_INDEX_DDL = "CREATE INDEX IF NOT EXISTS idx_open_meteo_usage_at ON open_meteo_usage(at);"

CACHE_TABLE_DDL = {
    "weather_cache": WEATHER_CACHE_DDL,
    "point_weather_cache": POINT_CACHE_DDL,
    "grid_weather_cache": GRID_CACHE_DDL,
    "grid_currents_cache": GRID_CURRENTS_CACHE_DDL,
    "grid_waves_cache": GRID_WAVES_CACHE_DDL,
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
    # WAL lets a reader and a writer work at the same time (SCRUM-274): without it the loser of a
    # concurrent write waited out the default 5 s and then failed with "database is locked". The
    # busy timeout keeps the wait bounded when a writer really is in the way. Litestream replicates
    # a WAL database the same way it replicates a rollback journal one.
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS};")
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
    # grid_waves_cache is new in 9 → 10, so dropping it is harmless; the loop also covers it.
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
        conn.execute(OPEN_METEO_USAGE_DDL)
        conn.execute(OPEN_METEO_USAGE_INDEX_DDL)
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


def prune_open_meteo_usage(now: float | None = None) -> int:
    """Delete usage rows older than the retention window (SCRUM-327). Returns rows deleted."""
    cutoff = (time.time() if now is None else now) - OPEN_METEO_USAGE_RETENTION_DAYS * 86400
    with db_connection() as conn:
        return conn.execute("DELETE FROM open_meteo_usage WHERE at < ?;", (cutoff,)).rowcount


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
