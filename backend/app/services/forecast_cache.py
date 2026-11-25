"""Forecast caches (SCRUM-92). One small class per cache table, both with get/put, so
the forecast service has no table-specific branching.

Keys include the timezone: hourly times are returned in the requested timezone, so a
forecast cached for one timezone must not be served for another.
"""

import json
from dataclasses import dataclass
from typing import Any, Protocol

from backend.app.config import CACHE_TTL_SECONDS
from backend.app.database import db_connection
from backend.app.units import coord_key


@dataclass(frozen=True)
class CachedForecast:
    payload: dict[str, Any]
    cached_at: float


class ForecastCache(Protocol):
    def get(self, now: float) -> CachedForecast | None: ...

    def put(self, payload: dict[str, Any], now: float) -> None: ...


def _fresh(row, now: float) -> CachedForecast | None:
    if row and row["expires_at"] > now:
        return CachedForecast(payload=json.loads(row["payload_json"]), cached_at=row["cached_at"])
    return None


@dataclass(frozen=True)
class SavedLocationCache:
    """weather_cache, keyed by (location_id, model, timezone, hour)."""

    location_id: int
    model: str
    timezone: str
    hour: str = "current"

    def get(self, now: float) -> CachedForecast | None:
        with db_connection() as conn:
            row = conn.execute(
                "SELECT payload_json, cached_at, expires_at FROM weather_cache "
                "WHERE location_id = ? AND model = ? AND timezone = ? AND hour = ?;",
                (self.location_id, self.model, self.timezone, self.hour),
            ).fetchone()
        return _fresh(row, now)

    def put(self, payload: dict[str, Any], now: float) -> None:
        with db_connection() as conn:
            conn.execute(
                """
                INSERT INTO weather_cache
                    (location_id, model, timezone, hour, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(location_id, model, timezone, hour) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (
                    self.location_id,
                    self.model,
                    self.timezone,
                    self.hour,
                    now,
                    now + CACHE_TTL_SECONDS,
                    json.dumps(payload),
                ),
            )


@dataclass(frozen=True)
class NwsGridCache:
    """nws_grid_cache, keyed by rounded coordinates (SCRUM-106).

    The grid a coordinate maps to does not move, so rows carry no expiry: a point is looked up
    through `/points` once, then every forecast request for it skips that call.
    """

    latitude: float
    longitude: float

    @property
    def key(self) -> tuple[float, float]:
        return coord_key(self.latitude, self.longitude)

    def get(self) -> tuple[str, int, int] | None:
        with db_connection() as conn:
            row = conn.execute(
                "SELECT office, grid_x, grid_y FROM nws_grid_cache WHERE lat_key = ? AND lon_key = ?;",
                self.key,
            ).fetchone()
        return None if row is None else (row["office"], int(row["grid_x"]), int(row["grid_y"]))

    def put(self, grid: tuple[str, int, int], now: float) -> None:
        office, grid_x, grid_y = grid
        with db_connection() as conn:
            conn.execute(
                """
                INSERT INTO nws_grid_cache (lat_key, lon_key, office, grid_x, grid_y, cached_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(lat_key, lon_key) DO UPDATE SET
                    office=excluded.office,
                    grid_x=excluded.grid_x,
                    grid_y=excluded.grid_y,
                    cached_at=excluded.cached_at;
                """,
                (*self.key, office, grid_x, grid_y, now),
            )


@dataclass(frozen=True)
class PointCache:
    """point_weather_cache, keyed by (rounded lat, rounded lon, model, timezone, hour)."""

    latitude: float
    longitude: float
    model: str
    timezone: str
    hour: str = "current"

    @property
    def key(self) -> tuple:
        return (*coord_key(self.latitude, self.longitude), self.model, self.timezone, self.hour)

    def get(self, now: float) -> CachedForecast | None:
        with db_connection() as conn:
            row = conn.execute(
                "SELECT payload_json, cached_at, expires_at FROM point_weather_cache "
                "WHERE lat_key = ? AND lon_key = ? AND model = ? AND timezone = ? AND hour = ?;",
                self.key,
            ).fetchone()
        return _fresh(row, now)

    def put(self, payload: dict[str, Any], now: float) -> None:
        with db_connection() as conn:
            conn.execute(
                """
                INSERT INTO point_weather_cache
                    (lat_key, lon_key, model, timezone, hour, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lat_key, lon_key, model, timezone, hour) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (*self.key, now, now + CACHE_TTL_SECONDS, json.dumps(payload)),
            )
