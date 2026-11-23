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
def _status_sequence(monkeypatch, statuses: list[int], retry_after: str | None = None):
    """Replace the client's GET with a sequence of statuses; returns the call count list."""
    calls: list[int] = []

    async def fake_get(self, url, **kwargs):
        calls.append(1)
        status = statuses[min(len(calls) - 1, len(statuses) - 1)]
        headers = {"Retry-After": retry_after} if retry_after and status != 200 else {}
        body = {"ok": True} if status == 200 else {"reason": "throttled"}
        return httpx.Response(status, json=body, headers=headers, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    return calls


@pytest.mark.asyncio
async def test_get_json_retries_429_with_retry_after_then_succeeds(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(client.asyncio, "sleep", fake_sleep)
    calls = _status_sequence(monkeypatch, [429, 200], retry_after="0.25")

    assert await client.get_json(FORECAST_URL, {}, retries=1) == {"ok": True}
    assert len(calls) == 2
    assert sleeps == [0.25]


@pytest.mark.asyncio
async def test_get_json_raises_after_exhausting_retries(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(client.asyncio, "sleep", fake_sleep)
    calls = _status_sequence(monkeypatch, [429], retry_after="1")

    with pytest.raises(httpx.HTTPStatusError):
        await client.get_json(FORECAST_URL, {}, retries=2)
    assert len(calls) == 3
    assert sleeps == [1, 1]


@pytest.mark.asyncio
async def test_get_json_does_not_retry_other_client_errors(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(client.asyncio, "sleep", fake_sleep)
    calls = _status_sequence(monkeypatch, [400])

    with pytest.raises(httpx.HTTPStatusError):
        await client.get_json(FORECAST_URL, {}, retries=3)
    assert len(calls) == 1
    assert sleeps == []


def test_retry_delay_falls_back_without_a_usable_header():
    request = httpx.Request("GET", FORECAST_URL)
    assert client.retry_delay(httpx.Response(429, headers={"Retry-After": "7"}, request=request), 0) == 5.0
    assert client.retry_delay(httpx.Response(429, headers={"Retry-After": "soon"}, request=request), 1) == 1.0
    assert client.retry_delay(httpx.Response(429, request=request), 3) == 4.0


@pytest.mark.asyncio
async def test_get_json_reports_invalid_json_as_http_error(monkeypatch):
    """A malformed body is an upstream failure (502 in the routers), not a 500."""

    async def fake_get(self, url, **kwargs):
        return httpx.Response(200, content=b"<html>not json", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    with pytest.raises(httpx.HTTPError):
        await client.get_json(FORECAST_URL, {})
