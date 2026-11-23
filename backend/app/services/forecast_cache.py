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
    """weather_cache, keyed by (location_id, model, timezone)."""

    location_id: int
    model: str
    timezone: str

    def get(self, now: float) -> CachedForecast | None:
        with db_connection() as conn:
            row = conn.execute(
                "SELECT payload_json, cached_at, expires_at FROM weather_cache "
                "WHERE location_id = ? AND model = ? AND timezone = ?;",
                (self.location_id, self.model, self.timezone),
            ).fetchone()
        return _fresh(row, now)

    def put(self, payload: dict[str, Any], now: float) -> None:
        with db_connection() as conn:
            conn.execute(
                """
                INSERT INTO weather_cache (location_id, model, timezone, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(location_id, model, timezone) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (self.location_id, self.model, self.timezone, now, now + CACHE_TTL_SECONDS, json.dumps(payload)),
            )


@dataclass(frozen=True)
class PointCache:
    """point_weather_cache, keyed by (rounded lat, rounded lon, model, timezone)."""

    latitude: float
    longitude: float
    model: str
    timezone: str

    @property
    def key(self) -> tuple:
        return (*coord_key(self.latitude, self.longitude), self.model, self.timezone)

    def get(self, now: float) -> CachedForecast | None:
        with db_connection() as conn:
            row = conn.execute(
                "SELECT payload_json, cached_at, expires_at FROM point_weather_cache "
                "WHERE lat_key = ? AND lon_key = ? AND model = ? AND timezone = ?;",
                self.key,
            ).fetchone()
        return _fresh(row, now)

    def put(self, payload: dict[str, Any], now: float) -> None:
        with db_connection() as conn:
            conn.execute(
                """
                INSERT INTO point_weather_cache (lat_key, lon_key, model, timezone, cached_at, expires_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(lat_key, lon_key, model, timezone) DO UPDATE SET
                    cached_at=excluded.cached_at,
                    expires_at=excluded.expires_at,
                    payload_json=excluded.payload_json;
                """,
                (*self.key, now, now + CACHE_TTL_SECONDS, json.dumps(payload)),
            )
