"""Geocoding service using Open-Meteo Geocoding API."""

from typing import List
import httpx
from backend.app.config import OPEN_METEO_GEOCODING_URL
from backend.app.models import GeocodeResult


async def search_locations(query: str, count: int = 10) -> List[GeocodeResult]:
    query = query.strip()
    if not query or len(query) < 2:
        return []

    params = {
        "name": query,
        "count": count,
        "language": "en",
        "format": "json",
    }

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(OPEN_METEO_GEOCODING_URL, params=params)
            response.raise_for_status()
            data = response.json()
        except Exception:
            return []

    results = []
    items = data.get("results") or []
    for item in items:
        name = item.get("name", "")
        admin1 = item.get("admin1")
        country = item.get("country")
        lat = item.get("latitude")
        lon = item.get("longitude")

        if lat is None or lon is None:
            continue

        parts = [p for p in [name, admin1, country] if p]
        display_name = ", ".join(parts)

        results.append(
            GeocodeResult(
                name=name,
                latitude=float(lat),
                longitude=float(lon),
                admin1=admin1,
                country=country,
                display_name=display_name,
            )
        )
    return results

