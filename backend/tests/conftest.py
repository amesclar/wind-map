"""Shared test setup: isolated temp database, TestClient and a strict Open-Meteo stub."""
import atexit
import os
import shutil
import tempfile
from pathlib import Path

# Must run before any `backend.app` import: config reads these at import time and creates DATA_DIR.
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="wind-map-tests-")
atexit.register(shutil.rmtree, _TEST_DATA_DIR, ignore_errors=True)
os.environ["DATA_DIR"] = _TEST_DATA_DIR
os.environ["DATABASE_PATH"] = str(Path(_TEST_DATA_DIR) / "wind_map.db")

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app import database  # noqa: E402
from backend.app.main import app  # noqa: E402
from factories import http_response  # noqa: E402


@pytest.fixture(autouse=True)
def _test_db(monkeypatch, tmp_path):
    """Give every test its own empty SQLite file with the full schema (init_db creates every table)."""
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "test.db")
    database.init_db()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class OpenMeteoStub:
    """Replaces `httpx.AsyncClient.get`. Unconfigured, any call fails the test."""

    def __init__(self):
        self.calls: list[dict] = []
        self._handler = self._unexpected

    @staticmethod
    def _unexpected():
        raise AssertionError("unexpected Open-Meteo call")

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def last_params(self) -> dict:
        return self.calls[-1]["params"]

    def respond(self, json, status: int = 200):
        """Answer every call with the same JSON body."""
        self._handler = lambda: http_response(json, status)

    def respond_sequence(self, *payloads):
        """Answer successive calls with successive JSON bodies; extra calls fail."""
        remaining = list(payloads)

        def handler():
            if not remaining:
                raise AssertionError("unexpected Open-Meteo call (sequence exhausted)")
            return http_response(remaining.pop(0))

        self._handler = handler

    def fail(self, exc: Exception):
        """Raise `exc` from every call."""

        def handler():
            raise exc

        self._handler = handler

    async def get(self, client_self, url, **kwargs):
        self.calls.append({"url": url, "params": kwargs.get("params") or {}})
        return self._handler()


@pytest.fixture(autouse=True)
def open_meteo(monkeypatch):
    """Active for every test, so no test can reach the real network by accident.
    Tests that need responses take `open_meteo` as an argument and configure it."""
    stub = OpenMeteoStub()

    async def fake_get(client_self, url, **kwargs):
        return await stub.get(client_self, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    return stub
