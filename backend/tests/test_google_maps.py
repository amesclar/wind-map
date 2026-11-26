"""Tests for Google Maps session endpoint and service (SCRUM-311)."""

import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.app import config
from backend.app.services import google_maps


@pytest.fixture(autouse=True)
def _reset_cache():
    google_maps.clear_session_cache()
    yield
    google_maps.clear_session_cache()


def test_google_session_missing_key(client, monkeypatch):
    monkeypatch.setattr(config, "GCP_MAP_KEY", "")
    response = client.get("/api/map/google-session")
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_google_session_success(client, monkeypatch):
    monkeypatch.setattr(config, "GCP_MAP_KEY", "test-gcp-key")

    mock_resp = httpx.Response(
        200,
        json={
            "session": "test-session-token-12345",
            "expiry": str(int(time.time() + 14 * 24 * 3600)),
            "tileWidth": 256,
            "tileHeight": 256,
            "imageFormat": "png",
        },
        request=httpx.Request("POST", "https://tile.googleapis.com/v1/createSession"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        response = client.get("/api/map/google-session")
        assert response.status_code == 200
        data = response.json()
        assert data["session"] == "test-session-token-12345"
        assert "session=test-session-token-12345" in data["tile_url"]
        assert "key=test-gcp-key" in data["tile_url"]
        assert "Google" in data["attribution"]
        assert mock_post.await_count == 1

        # Second request should be served from memory cache without upstream call
        response2 = client.get("/api/map/google-session")
        assert response2.status_code == 200
        assert response2.json()["session"] == "test-session-token-12345"
        assert mock_post.await_count == 1


def test_google_session_upstream_status_error(client, monkeypatch):
    monkeypatch.setattr(config, "GCP_MAP_KEY", "test-gcp-key")

    mock_resp = httpx.Response(
        403,
        json={"error": {"message": "API key invalid"}},
        request=httpx.Request("POST", "https://tile.googleapis.com/v1/createSession"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
        response = client.get("/api/map/google-session")
        assert response.status_code == 502
        assert "403" in response.json()["detail"]


def test_google_session_upstream_network_error(client, monkeypatch):
    monkeypatch.setattr(config, "GCP_MAP_KEY", "test-gcp-key")

    with patch(
        "httpx.AsyncClient.post",
        new_callable=AsyncMock,
        side_effect=httpx.ConnectError("Network unreachable"),
    ):
        response = client.get("/api/map/google-session")
        assert response.status_code == 502
        assert "Failed to connect" in response.json()["detail"]


def test_config_reports_google_satellite_enabled(client, monkeypatch):
    monkeypatch.setattr(config, "GCP_MAP_KEY", "")
    resp = client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json()["google_satellite_enabled"] is False

    monkeypatch.setattr(config, "GCP_MAP_KEY", "active-key")
    resp2 = client.get("/api/config")
    assert resp2.status_code == 200
    assert resp2.json()["google_satellite_enabled"] is True


def test_session_validity():
    now = time.time()
    valid_session = google_maps.GoogleMapsSession(
        session="token",
        expiry=int(now + 14 * 24 * 3600),
        tile_url="url",
        attribution="attrib",
        cached_at=now,
    )
    assert google_maps.is_session_valid(valid_session, now) is True

    # Expired via 13-day TTL
    expired_ttl = google_maps.GoogleMapsSession(
        session="token",
        expiry=int(now + 14 * 24 * 3600),
        tile_url="url",
        attribution="attrib",
        cached_at=now - (13 * 24 * 3600 + 1),
    )
    assert google_maps.is_session_valid(expired_ttl, now) is False

    # Expired upstream
    expired_upstream = google_maps.GoogleMapsSession(
        session="token",
        expiry=int(now + 1800),  # within 1 hour margin
        tile_url="url",
        attribution="attrib",
        cached_at=now,
    )
    assert google_maps.is_session_valid(expired_upstream, now) is False
