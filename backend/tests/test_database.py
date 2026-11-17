"""SCRUM-92 phase 1: connection handling and expired-cache cleanup."""

import sqlite3
import time
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import database
from backend.app.database import clean_expired_cache, db_connection, get_db_connection
from backend.app.main import app
from backend.app.services.grid_weather_service import _ensure_grid_cache_table
from backend.app.services.weather_service import POINT_CACHE_DDL, get_weather
from factories import insert_grid_row, upstream_error

CACHE_TABLES = ("weather_cache", "point_weather_cache", "grid_weather_cache")


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
async def test_get_weather_closes_connections_when_open_meteo_fails(open_meteo):
    """An upstream failure used to leak the connection opened for the cache read."""
    opened: list[sqlite3.Connection] = []
    real = database.get_db_connection

    def tracking():
        conn = real()
        opened.append(conn)
        return conn

    open_meteo.fail(upstream_error("down"))
    with patch.object(database, "get_db_connection", side_effect=tracking):
        with pytest.raises(httpx.HTTPError):
            await get_weather(0, "pt", 48.0, -122.0)

    assert opened, "expected at least one connection"
    assert all(_is_closed(c) for c in opened)


def test_clean_expired_cache_removes_only_expired_rows_from_all_tables():
    now = time.time()
    with db_connection() as conn:
        conn.execute(POINT_CACHE_DDL)
        _ensure_grid_cache_table(conn.cursor())
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', ?, ?, '{}'), (1, 'b', ?, ?, '{}');",
            (now, now - 1, now, now + 600),
        )
        for lat, expires_in in ((1, -1), (2, 600)):
            conn.execute(
                "INSERT INTO point_weather_cache VALUES (?, ?, 'm', ?, ?, '{}');",
                (lat, lat, now, now + expires_in),
            )
    insert_grid_row(1, 1, "m", expires_in=-1)
    insert_grid_row(2, 2, "m", expires_in=600)
    assert clean_expired_cache(now) == 3

    with db_connection() as conn:
        for table in CACHE_TABLES:
            assert conn.execute(f"SELECT COUNT(*) AS n FROM {table};").fetchone()["n"] == 1


def test_clean_expired_cache_skips_missing_tables():
    # Only weather_cache exists after init_db; must not raise for the lazily created ones.
    assert clean_expired_cache() == 0


def test_startup_cleans_expired_cache():

    with db_connection() as conn:
        conn.execute(
            "INSERT INTO weather_cache (location_id, model, cached_at, expires_at, payload_json) "
            "VALUES (1, 'a', 0, 1, '{}');"
        )
    with TestClient(app):  # entering a TestClient runs the startup lifespan
        pass
    conn = get_db_connection()
    try:
        assert conn.execute("SELECT COUNT(*) AS n FROM weather_cache;").fetchone()["n"] == 0
    finally:
        conn.close()
