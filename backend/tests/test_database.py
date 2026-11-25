"""Schema, migrations, connection handling and expired-cache cleanup (SCRUM-92)."""

import sqlite3
import time
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import database
from backend.app.database import (
    CACHE_TABLES,
    SCHEMA_VERSION,
    clean_expired_cache,
    db_connection,
    get_db_connection,
    init_db,
)
from backend.app.main import app
from backend.app.services.weather_service import get_point_forecast
from factories import insert_grid_row, upstream_error


def _is_closed(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT 1;")
        return False
    except sqlite3.ProgrammingError:
        return True


def test_db_connection_commits_and_closes():
    with db_connection() as conn:
        conn.execute("INSERT INTO locations (name, latitude, longitude) VALUES ('A', 1, 2);")
    assert _is_closed(conn)
    with db_connection() as check:
        assert check.execute("SELECT COUNT(*) AS n FROM locations WHERE name = 'A';").fetchone()["n"] == 1


def test_db_connection_rolls_back_and_closes_on_error():
    with pytest.raises(RuntimeError), db_connection() as conn:
        conn.execute("INSERT INTO locations (name, latitude, longitude) VALUES ('B', 1, 2);")
        raise RuntimeError("boom")
    assert _is_closed(conn)
    with db_connection() as check:
        assert check.execute("SELECT COUNT(*) AS n FROM locations WHERE name = 'B';").fetchone()["n"] == 0


@pytest.mark.asyncio
async def test_point_forecast_closes_connections_when_open_meteo_fails(open_meteo):
    """An upstream failure used to leak the connection opened for the cache read."""
    opened: list[sqlite3.Connection] = []
    real = database.get_db_connection

    def tracking():
        conn = real()
        opened.append(conn)
        return conn

    open_meteo.fail(upstream_error("down"))
    with patch.object(database, "get_db_connection", side_effect=tracking), pytest.raises(httpx.HTTPError):
        await get_point_forecast(48.0, -122.0)

    assert opened, "expected at least one connection"
    assert all(_is_closed(c) for c in opened)


def test_clean_expired_cache_removes_only_expired_rows_from_all_tables():
    now = time.time()
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, timezone, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', 'UTC', ?, ?, '{}'), (1, 'b', 'UTC', ?, ?, '{}');",
            (now, now - 1, now, now + 600),
        )
        for lat, expires_in in ((1, -1), (2, 600)):
            conn.execute(
                "INSERT INTO point_weather_cache "
                "(lat_key, lon_key, model, timezone, hour, cached_at, expires_at, payload_json) "
                "VALUES (?, ?, 'm', 'UTC', 'current', ?, ?, '{}');",
                (lat, lat, now, now + expires_in),
            )
        for lat, expires_in in ((1, -1), (2, 600)):
            conn.execute(
                "INSERT INTO grid_currents_cache "
                "(lat_key, lon_key, hour, cached_at, expires_at, velocity_knots, direction_deg) "
                "VALUES (?, ?, 'current', ?, ?, 1.5, 90.0);",
                (lat, lat, now, now + expires_in),
            )
        for lat, expires_in in ((1, -1), (2, 600)):
            conn.execute(
                "INSERT INTO tide_point_cache "
                "(lat_key, lon_key, hour, cached_at, expires_at, height_m) "
                "VALUES (?, ?, 'current', ?, ?, 1.2);",
                (lat, lat, now, now + expires_in),
            )
    insert_grid_row(1, 1, "m", expires_in=-1)
    insert_grid_row(2, 2, "m", expires_in=600)
    assert clean_expired_cache(now) == 5

    with db_connection() as conn:
        for table in CACHE_TABLES:
            assert conn.execute(f"SELECT COUNT(*) AS n FROM {table};").fetchone()["n"] == 1


def test_startup_cleans_expired_cache():

    with db_connection() as conn:
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, timezone, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', 'UTC', 0, 1, '{}');"
        )
    with TestClient(app):  # entering a TestClient runs the startup lifespan
        pass
    conn = get_db_connection()
    try:
        assert conn.execute("SELECT COUNT(*) AS n FROM weather_cache;").fetchone()["n"] == 0
    finally:
        conn.close()


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table';").fetchall()}


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table});").fetchall()}


def test_init_db_creates_every_table_and_sets_schema_version():
    with db_connection() as conn:
        assert {"locations", *CACHE_TABLES} <= _tables(conn)
        assert "temperature_f" in _columns(conn, "grid_weather_cache")
        assert {"cell_lat", "cell_lon"} <= _columns(conn, "grid_currents_cache")
        assert conn.execute("PRAGMA user_version;").fetchone()[0] == SCHEMA_VERSION


def test_schema_upgrade_recreates_the_currents_cache_with_cell_coordinates():
    """The currents cache gains the model cell each value came from (SCRUM-238)."""
    with db_connection() as conn:
        conn.execute("DROP TABLE grid_currents_cache;")
        conn.execute(
            "CREATE TABLE grid_currents_cache ("
            "lat_key REAL NOT NULL, lon_key REAL NOT NULL, "
            "hour TEXT NOT NULL DEFAULT 'current', cached_at REAL NOT NULL, "
            "expires_at REAL NOT NULL, velocity_knots REAL, direction_deg REAL, "
            "PRIMARY KEY (lat_key, lon_key, hour));"
        )
        conn.execute("PRAGMA user_version = 5;")

    init_db()

    with db_connection() as conn:
        assert {"cell_lat", "cell_lon"} <= _columns(conn, "grid_currents_cache")
        assert conn.execute("PRAGMA user_version;").fetchone()[0] == SCHEMA_VERSION


def test_init_db_is_idempotent_and_keeps_data():
    with db_connection() as conn:
        conn.execute("INSERT INTO locations (name, latitude, longitude) VALUES ('Keep', 1, 2);")
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, timezone, cached_at, expires_at, payload_json) "
            "VALUES (1, 'best_match', 'UTC', 0, 9999999999, '{}');"
        )
    init_db()
    with db_connection() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM locations WHERE name = 'Keep';").fetchone()["n"] == 1
        assert conn.execute("SELECT COUNT(*) AS n FROM weather_cache;").fetchone()["n"] == 1


def test_upgrade_from_unversioned_db_resets_caches_and_keeps_locations():
    """A pre-SCRUM-92 database: old grid table without temperature_f, a point forecast
    stored in weather_cache under location_id 0, and user_version 0."""
    with db_connection() as conn:
        for table in CACHE_TABLES:
            conn.execute(f"DROP TABLE {table};")
        conn.execute(
            "CREATE TABLE grid_weather_cache (lat_key REAL, lon_key REAL, model TEXT, cached_at REAL, "
            "expires_at REAL, wind_speed_knots REAL, wind_direction_deg REAL, PRIMARY KEY (lat_key, lon_key, model));"
        )
        conn.execute("INSERT INTO grid_weather_cache VALUES (48, -122, 'best_match', 0, 9999999999, 7, 90);")
        conn.execute(
            "CREATE TABLE weather_cache (id INTEGER PRIMARY KEY, location_id INTEGER, model TEXT, "
            "cached_at REAL, expires_at REAL, payload_json TEXT, UNIQUE(location_id, model));"
        )
        conn.execute("INSERT INTO weather_cache VALUES (1, 0, 'best_match', 0, 9999999999, '{}');")
        conn.execute("INSERT INTO locations (name, latitude, longitude) VALUES ('Saved', 1, 2);")
        conn.execute("PRAGMA user_version = 0;")

    init_db()

    with db_connection() as conn:
        assert conn.execute("PRAGMA user_version;").fetchone()[0] == SCHEMA_VERSION
        assert "temperature_f" in _columns(conn, "grid_weather_cache")
        for table in CACHE_TABLES:
            assert conn.execute(f"SELECT COUNT(*) AS n FROM {table};").fetchone()["n"] == 0
        assert conn.execute("SELECT COUNT(*) AS n FROM locations WHERE name = 'Saved';").fetchone()["n"] == 1


def test_foreign_keys_are_enforced():
    with pytest.raises(sqlite3.IntegrityError), db_connection() as conn:
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, timezone, cached_at, expires_at, payload_json) "
            "VALUES (999, 'best_match', 'UTC', 0, 1, '{}');"
        )


def test_upgrade_from_version_1_adds_timezone_to_forecast_cache_keys():
    with db_connection() as conn:
        conn.execute("DROP TABLE weather_cache;")
        conn.execute(
            "CREATE TABLE weather_cache (id INTEGER PRIMARY KEY, location_id INTEGER, model TEXT, "
            "cached_at REAL, expires_at REAL, payload_json TEXT, UNIQUE(location_id, model));"
        )
        conn.execute("INSERT INTO weather_cache VALUES (1, 1, 'best_match', 0, 9999999999, '{}');")
        conn.execute("PRAGMA user_version = 1;")

    init_db()

    with db_connection() as conn:
        assert conn.execute("PRAGMA user_version;").fetchone()[0] == SCHEMA_VERSION
        assert "timezone" in _columns(conn, "weather_cache")
        assert "timezone" in _columns(conn, "point_weather_cache")
        assert conn.execute("SELECT COUNT(*) AS n FROM weather_cache;").fetchone()["n"] == 0
