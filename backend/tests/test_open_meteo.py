"""Shared Open-Meteo client (SCRUM-92)."""
import httpx
import pytest

from backend.app.services import open_meteo as client
from factories import FORECAST_URL


def test_forecast_params_omit_models_for_best_match():
    assert client.forecast_params("best_match") == {"wind_speed_unit": "kn"}


def test_forecast_params_include_models_otherwise():
    assert client.forecast_params("gfs_seamless") == {"wind_speed_unit": "kn", "models": "gfs_seamless"}


@pytest.mark.asyncio
async def test_get_json_returns_decoded_body_and_sends_params(open_meteo):
    open_meteo.respond({"ok": True})

    assert await client.get_json(FORECAST_URL, {"a": 1}) == {"ok": True}
    assert open_meteo.calls[0]["url"] == FORECAST_URL
    assert open_meteo.last_params == {"a": 1}


@pytest.mark.asyncio
async def test_get_json_raises_for_error_status(open_meteo):
    open_meteo.respond({"reason": "bad"}, status=400)

    with pytest.raises(httpx.HTTPStatusError):
        await client.get_json(FORECAST_URL, {})


@pytest.mark.asyncio
async def test_get_json_reports_invalid_json_as_http_error(monkeypatch):
    """A malformed body is an upstream failure (502 in the routers), not a 500."""

    async def fake_get(self, url, **kwargs):
        return httpx.Response(200, content=b"<html>not json", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    with pytest.raises(httpx.HTTPError):
        await client.get_json(FORECAST_URL, {})
