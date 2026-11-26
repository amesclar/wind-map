"""Google Maps Platform Map Tiles API session management (SCRUM-311).

Provides session creation and in-memory caching for Google 2D hybrid map tiles.
Google Map Tiles API tokens are valid for 14 days; we cache them for up to 13 days
to avoid unnecessary upstream quota consumption while ensuring tokens do not expire in-flight.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

from backend.app import config

logger = logging.getLogger(__name__)

GOOGLE_MAPS_ATTRIBUTION = '&copy; <a href="https://www.google.com/maps">Google</a>'
GOOGLE_MAPS_ATTRIBUTION_TEXT = "© Google"


@dataclass
class GoogleMapsSession:
    session: str
    expiry: int
    tile_url: str
    attribution: str
    cached_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "session": self.session,
            "expiry": self.expiry,
            "tile_url": self.tile_url,
            "attribution": self.attribution,
        }


_cached_session: GoogleMapsSession | None = None


def clear_session_cache() -> None:
    """Clear in-memory session cache (used primarily in tests)."""
    global _cached_session
    _cached_session = None


def is_session_valid(session: GoogleMapsSession | None, now: float | None = None) -> bool:
    """Check if the session exists and has not passed its cache TTL or upstream expiry."""
    if session is None:
        return False
    current_time = time.time() if now is None else now
    # Check cache TTL (13 days)
    if current_time - session.cached_at >= config.GOOGLE_MAPS_SESSION_CACHE_TTL_SECONDS:
        return False
    # Check upstream expiry timestamp with a 1-hour safety margin
    return current_time < session.expiry - 3600


async def request_google_maps_session(api_key: str | None = None) -> GoogleMapsSession:
    """Request a new hybrid map session token from Google Map Tiles API."""
    key = (api_key or config.GCP_MAP_KEY).strip()
    if not key:
        raise ValueError("Google Maps API key not configured (GCP_MAP_KEY)")

    url = f"{config.GOOGLE_MAPS_CREATE_SESSION_URL}?key={key}"
    # Map Tiles has no "hybrid" mapType (sending it is a 400 INVALID_ARGUMENT). The hybrid theme is
    # satellite imagery with the roadmap layer drawn on top, not a separate overlay.
    payload = {
        "mapType": "satellite",
        "layerTypes": ["layerRoadmap"],
        "overlay": False,
        "language": "en-US",
        "region": "US",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()

    session_token = data.get("session")
    if not session_token:
        raise ValueError("Google Maps API returned a response without a session token")

    # Expiry is a string unix timestamp or int
    expiry_val = data.get("expiry")
    try:
        expiry = int(expiry_val) if expiry_val is not None else int(time.time() + 14 * 24 * 3600)
    except ValueError, TypeError:
        expiry = int(time.time() + 14 * 24 * 3600)

    tile_url = f"https://tile.googleapis.com/v1/2dtiles/{{z}}/{{x}}/{{y}}?session={session_token}&key={key}"

    return GoogleMapsSession(
        session=session_token,
        expiry=expiry,
        tile_url=tile_url,
        attribution=GOOGLE_MAPS_ATTRIBUTION,
        cached_at=time.time(),
    )


async def get_google_maps_session(api_key: str | None = None) -> GoogleMapsSession:
    """Return an active Google Maps session, creating one or returning from cache."""
    global _cached_session

    if is_session_valid(_cached_session):
        return _cached_session  # type: ignore[return-value]

    session = await request_google_maps_session(api_key)
    _cached_session = session
    return session
