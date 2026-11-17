"""Geocoder service and /api/geocode router tests."""
import pytest

from backend.app.config import OPEN_METEO_GEOCODING_URL
from backend.app.services.geocode_service import search_locations
from factories import upstream_error


def _geo_item(name="Seattle", lat=47.6062, lon=-122.3321, admin1="Washington", country="United States"):
    return {"name": name, "latitude": lat, "longitude": lon, "admin1": admin1, "country": country}


@pytest.mark.asyncio
async def test_results_are_mapped_with_joined_display_name(open_meteo):
    open_meteo.respond({"results": [_geo_item()]})

    results = await search_locations("Seattle")

    assert len(results) == 1
    r = results[0]
    assert (r.name, r.latitude, r.longitude) == ("Seattle", 47.6062, -122.3321)
    assert (r.admin1, r.country) == ("Washington", "United States")
    assert r.display_name == "Seattle, Washington, United States"
    assert open_meteo.calls[0]["url"] == OPEN_METEO_GEOCODING_URL
    assert open_meteo.last_params["name"] == "Seattle"
    assert open_meteo.last_params["count"] == 10


@pytest.mark.asyncio
async def test_display_name_omits_missing_parts(open_meteo):
    open_meteo.respond({"results": [_geo_item(name="Monaco", admin1=None, country="Monaco")]})

    results = await search_locations("Monaco")

    assert results[0].display_name == "Monaco, Monaco"
    assert results[0].admin1 is None


@pytest.mark.asyncio
async def test_items_missing_latitude_or_longitude_are_skipped(open_meteo):
    open_meteo.respond(
        {
            "results": [
                _geo_item(name="NoLat", lat=None),
                _geo_item(name="NoLon", lon=None),
                _geo_item(name="Ok"),
            ]
        }
    )

    results = await search_locations("anything")

    assert [r.name for r in results] == ["Ok"]


@pytest.mark.asyncio
async def test_zero_coordinates_are_valid_not_skipped(open_meteo):
    open_meteo.respond({"results": [_geo_item(name="Null Island", lat=0, lon=0)]})

    results = await search_locations("Null")

    assert (results[0].latitude, results[0].longitude) == (0.0, 0.0)


@pytest.mark.asyncio
async def test_response_without_results_key_returns_empty_list(open_meteo):
    open_meteo.respond({"generationtime_ms": 0.5})

    assert await search_locations("zzzz") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["", " ", "a", " a "])
async def test_query_shorter_than_two_chars_returns_empty_without_http_call(open_meteo, query):
    assert await search_locations(query) == []
    assert open_meteo.call_count == 0


@pytest.mark.asyncio
async def test_upstream_failure_returns_empty_list(open_meteo):
    """Current behaviour: a geocoder outage is swallowed and reported as 'no results'."""
    open_meteo.fail(upstream_error())

    assert await search_locations("Seattle") == []
    assert open_meteo.call_count == 1


@pytest.mark.asyncio
async def test_upstream_http_error_status_returns_empty_list(open_meteo):
    """Current behaviour: a 5xx from the geocoder is swallowed and reported as 'no results'."""
    open_meteo.respond({"error": True}, status=503)

    assert await search_locations("Seattle") == []


def test_router_returns_results(client, open_meteo):
    open_meteo.respond({"results": [_geo_item()]})

    resp = client.get("/api/geocode", params={"q": "Seattle", "count": 5})

    assert resp.status_code == 200
    assert resp.json()[0]["display_name"] == "Seattle, Washington, United States"
    assert open_meteo.last_params["count"] == 5


def test_router_rejects_query_shorter_than_two_chars(client, open_meteo):
    assert client.get("/api/geocode", params={"q": "a"}).status_code == 422
    assert client.get("/api/geocode").status_code == 422
    assert open_meteo.call_count == 0


def test_router_rejects_count_out_of_range(client, open_meteo):
    assert client.get("/api/geocode", params={"q": "Seattle", "count": 0}).status_code == 422
    assert client.get("/api/geocode", params={"q": "Seattle", "count": 21}).status_code == 422
    assert open_meteo.call_count == 0
