"""SCRUM-92 phase 1: connection handling and expired-cache cleanup."""

import os
import sqlite3
import time

import pytest

os.environ["DATABASE_PATH"] = "./data/test_wind_map.db"
os.environ["DATA_DIR"] = "./data"

from unittest.mock import patch

import httpx

from backend.app import database
from backend.app.database import clean_expired_cache, db_connection, get_db_connection, init_db
from backend.app.services.weather_service import get_weather

CACHE_TABLES = ("weather_cache", "point_weather_cache", "grid_weather_cache")


@pytest.fixture(autouse=True)
def fresh_db():
    with db_connection() as conn:
        for table in (*CACHE_TABLES, "locations"):
            conn.execute(f"DROP TABLE IF EXISTS {table};")
    init_db()
    yield
    with db_connection() as conn:
        for table in (*CACHE_TABLES, "locations"):
            conn.execute(f"DROP TABLE IF EXISTS {table};")


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
    with pytest.raises(RuntimeError):
        with db_connection() as conn:
            conn.execute("INSERT INTO locations (name, latitude, longitude) VALUES ('B', 1, 2);")
            raise RuntimeError("boom")
    assert _is_closed(conn)
    with db_connection() as check:
        assert check.execute("SELECT COUNT(*) AS n FROM locations WHERE name = 'B';").fetchone()["n"] == 0


@pytest.mark.asyncio
async def test_get_weather_closes_connections_when_open_meteo_fails():
    """An upstream failure used to leak the connection opened for the cache read."""
    opened: list[sqlite3.Connection] = []
    real = database.get_db_connection

    def tracking():
        conn = real()
        opened.append(conn)
        return conn

    error = httpx.ConnectError("down", request=httpx.Request("GET", "https://api.open-meteo.com"))
    with patch.object(database, "get_db_connection", side_effect=tracking), \
         patch("httpx.AsyncClient.get", side_effect=error):
        with pytest.raises(httpx.HTTPError):
            await get_weather(0, "pt", 48.0, -122.0)

    assert opened, "expected at least one connection"
    assert all(_is_closed(c) for c in opened)


def test_clean_expired_cache_removes_only_expired_rows_from_all_tables():
    now = time.time()
    with db_connection() as conn:
        conn.execute(
            "CREATE TABLE point_weather_cache (lat_key REAL, lon_key REAL, model TEXT, "
            "cached_at REAL, expires_at REAL, payload_json TEXT);"
        )
        conn.execute(
            "CREATE TABLE grid_weather_cache (lat_key REAL, lon_key REAL, model TEXT, "
            "cached_at REAL, expires_at REAL, wind_speed_knots REAL, wind_direction_deg REAL);"
        )
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', ?, ?, '{}'), (1, 'b', ?, ?, '{}');",
            (now, now - 1, now, now + 600),
        )
        for table in ("point_weather_cache", "grid_weather_cache"):
            extra = ", 0, 0" if table == "grid_weather_cache" else ", '{}'"
            conn.execute(f"INSERT INTO {table} VALUES (1, 1, 'm', ?, ?{extra});", (now, now - 1))
            conn.execute(f"INSERT INTO {table} VALUES (2, 2, 'm', ?, ?{extra});", (now, now + 600))

    assert clean_expired_cache(now) == 3

    with db_connection() as conn:
        for table in CACHE_TABLES:
            assert conn.execute(f"SELECT COUNT(*) AS n FROM {table};").fetchone()["n"] == 1


def test_clean_expired_cache_skips_missing_tables():
    # Only weather_cache exists after init_db; must not raise for the lazily created ones.
    assert clean_expired_cache() == 0


def test_startup_cleans_expired_cache():
    from fastapi.testclient import TestClient
    from backend.app.main import app

    with db_connection() as conn:
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', 0, 1, '{}');"
        )
    with TestClient(app):
        pass
    conn = get_db_connection()
    try:
        assert conn.execute("SELECT COUNT(*) AS n FROM weather_cache;").fetchone()["n"] == 0
    finally:
        conn.close()
