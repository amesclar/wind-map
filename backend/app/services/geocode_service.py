"""Geocoding service using the Open-Meteo Geocoding API."""

from backend.app.config import (
    OPEN_METEO_GEOCODING_RETRIES,
    OPEN_METEO_GEOCODING_TIMEOUT_SECONDS,
    OPEN_METEO_GEOCODING_URL,
)
from backend.app.models import GeocodeResult
from backend.app.services import open_meteo

MIN_QUERY_LENGTH = 2


async def search_locations(query: str, count: int = 10) -> list[GeocodeResult]:
    """Search places by name. Returns [] for short queries or no matches.
    Raises httpx.HTTPError when the geocoder is unavailable (SCRUM-92: the router
    reports that as 502, so it isn't confused with "no matches")."""
    query = query.strip()
    if len(query) < MIN_QUERY_LENGTH:
        return []

    params = {"name": query, "count": count, "language": "en", "format": "json"}
    data = await open_meteo.get_json(
        OPEN_METEO_GEOCODING_URL,
        params,
        timeout=OPEN_METEO_GEOCODING_TIMEOUT_SECONDS,
        retries=OPEN_METEO_GEOCODING_RETRIES,
    )

    results = []
    for item in data.get("results") or []:
        lat = item.get("latitude")
        lon = item.get("longitude")
        if lat is None or lon is None:
            continue

        name = item.get("name", "")
        admin1 = item.get("admin1")
        country = item.get("country")
        results.append(
            GeocodeResult(
                name=name,
                latitude=float(lat),
                longitude=float(lon),
                admin1=admin1,
                country=country,
                display_name=", ".join(p for p in (name, admin1, country) if p),
            )
        )
    return results
