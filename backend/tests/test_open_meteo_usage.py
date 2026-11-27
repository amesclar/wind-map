"""Open-Meteo usage log and quota endpoint (SCRUM-327)."""

import asyncio
import logging
import sqlite3
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from backend.app import database
from backend.app.database import SCHEMA_VERSION, db_connection, init_db
from backend.app.services import open_meteo as client
from backend.app.services import open_meteo_usage as usage
from factories import FORECAST_URL

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
NOW = datetime(2026, 11, 27, 12, 0, tzinfo=UTC).timestamp()
QUOTA_HEADERS = {
    "X-RateLimit-Cost": "1.0",
    "X-RateLimit-Limit": "600.0",
    "X-RateLimit-Remaining": "598.0",
    "X-RateLimit-Window": "60",
    "X-RateLimit-Reset": "1800000060",
}


def upstream_response(headers: dict | None = None, status: int = 200, url: str = FORECAST_URL) -> httpx.Response:
    return httpx.Response(
        status_code=status,
        json={"ok": True},
        headers=headers or {},
        request=httpx.Request("GET", url),
    )


@pytest.fixture(autouse=True)
def _clean_usage(monkeypatch):
    """No test inherits another's buffer, warning day or prune clock."""
    usage._BUFFER.clear()
    monkeypatch.setattr(usage, "_warned_day", None)
    monkeypatch.setattr(usage, "_last_prune", 0.0)
    yield
    usage._BUFFER.clear()


def _seed(at: float, cost: float, endpoint: str = "grid", remaining: float | None = 900.0, status: int = 200) -> None:
    row = usage.UsageRow(at, endpoint, status, cost, 10000.0, remaining, 86400, None)
    with db_connection() as conn:
        conn.execute(usage.INSERT_SQL, row.as_sql())


def _rows() -> list[dict]:
    with db_connection() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM open_meteo_usage ORDER BY id;").fetchall()]


# ---------------------------------------------------------------------------
# Reading the headers
# ---------------------------------------------------------------------------


def test_sample_reads_the_quota_headers():
    row = usage.sample(FORECAST_URL, upstream_response(QUOTA_HEADERS), at=1_800_000_000.0)

    assert row is not None
    assert (row.cost, row.quota_limit, row.remaining) == (1.0, 600.0, 598.0)
    assert row.window_s == 60
    assert row.reset_at == 1_800_000_060.0
    assert row.status == 200
    assert row.endpoint == "forecast"
    assert row.hour == "2027-01-15T08:00"
    assert row.day == "2027-01-15"


def test_sample_is_none_without_quota_headers():
    """The static meta.json carries none, so it is not a call to log."""
    assert usage.sample(FORECAST_URL, upstream_response()) is None


def test_a_quota_rejection_is_logged_as_charged_nothing():
    """Open-Meteo does not charge a request refused because the quota is already exhausted."""
    headers = {"X-RateLimit-Limit": "600.0", "X-RateLimit-Remaining": "0.0", "X-RateLimit-Window": "60"}
    row = usage.sample(FORECAST_URL, upstream_response(headers, status=429))

    assert row is not None
    assert row.cost == 0.0
    assert row.status == 429


def test_endpoint_label_prefers_the_caller_and_otherwise_reads_the_host():
    assert usage.endpoint_label(FORECAST_URL, "grid") == "grid"
    assert usage.endpoint_label(MARINE_URL) == "marine"
    assert usage.endpoint_label("https://example.test/v1/forecast") == "other"


def test_a_response_that_cannot_be_read_is_ignored():
    class Broken:
        status_code = 200

        class headers:
            @staticmethod
            def get(name):
                raise RuntimeError("no headers")

    usage.record(FORECAST_URL, Broken())

    assert usage.buffered() == 0


# ---------------------------------------------------------------------------
# The client records every attempt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_json_records_the_attempt(monkeypatch):
    async def fake_get(self, url, **kwargs):
        return upstream_response(QUOTA_HEADERS, url=url)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    assert await client.get_json(FORECAST_URL, {}, label="grid") == {"ok": True}
    assert usage.buffered() == 1

    usage.flush()
    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["endpoint"] == "grid"
    assert rows[0]["cost"] == 1.0


@pytest.mark.asyncio
async def test_get_json_records_every_retry_attempt(monkeypatch):
    """A retried request is two upstream attempts, so the log holds two rows."""
    statuses = [429, 200]
    attempts: list[int] = []

    async def fake_sleep(seconds: float) -> None:
        return None

    async def fake_get(self, url, **kwargs):
        attempts.append(1)
        return upstream_response(QUOTA_HEADERS, status=statuses[len(attempts) - 1])

    monkeypatch.setattr(client.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    assert await client.get_json(FORECAST_URL, {}, retries=1) == {"ok": True}
    assert usage.buffered() == 2


@pytest.mark.asyncio
async def test_a_database_failure_leaves_the_forecast_alone(monkeypatch):
    async def fake_get(self, url, **kwargs):
        return upstream_response(QUOTA_HEADERS, url=url)

    def broken(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(database, "db_connection", broken)

    assert await client.get_json(FORECAST_URL, {}) == {"ok": True}
    assert usage.flush() == 0
    assert usage.buffered() == 0


# ---------------------------------------------------------------------------
# The log itself
# ---------------------------------------------------------------------------


def test_record_and_flush_write_one_row_per_attempt():
    usage.record(FORECAST_URL, upstream_response(QUOTA_HEADERS), label="grid")
    usage.record(FORECAST_URL, upstream_response({**QUOTA_HEADERS, "X-RateLimit-Cost": "1.5"}), label="point")

    assert usage.buffered() == 2
    assert usage.flush(now=NOW) == 2
    assert usage.buffered() == 0

    rows = _rows()
    assert [row["cost"] for row in rows] == [1.0, 1.5]
    assert [row["endpoint"] for row in rows] == ["grid", "point"]


def test_flush_with_nothing_buffered_is_a_no_op():
    assert usage.flush(now=NOW) == 0
    assert _rows() == []


def test_prune_drops_rows_past_the_retention():
    _seed(NOW - 91 * 86400, 5.0)
    _seed(NOW - 86400, 3.0)

    assert usage.prune(now=NOW) == 1
    assert len(_rows()) == 1


def test_summary_reports_days_hours_and_the_latest_headers():
    _seed(NOW - 3600, 10.0, remaining=700.0)
    _seed(NOW - 1800, 5.0, remaining=250.0)
    _seed(NOW - 86400, 7.0, endpoint="marine", remaining=900.0)

    result = usage.summary(now=NOW)

    assert result["daily_limit"] == 10000
    assert result["today"] == "2026-11-27"
    assert result["today_calls"] == 15.0
    assert result["today_peak_hour"] == "2026-11-27T11:00"
    assert [day["day"] for day in result["days"]] == ["2026-11-26", "2026-11-27"]
    assert result["days"][0]["calls"] == 7.0
    assert result["days"][0]["peak_hour"] == "2026-11-26T12:00"
    assert result["days"][1]["lowest_remaining"] == 250.0
    assert len(result["hours_today"]) == 1
    assert result["hours_today"][0]["requests"] == 2
    # The most recent attempt, which is the later grid call, not the older marine one.
    assert result["latest"]["endpoint"] == "grid"
    assert result["latest"]["cost"] == 5.0


def test_summary_is_empty_before_any_call():
    result = usage.summary(now=NOW)

    assert result["today_calls"] == 0.0
    assert result["today_peak_hour"] is None
    assert result["days"] == []
    assert result["hours_today"] == []
    assert result["latest"] is None


def test_the_eighty_percent_warning_is_logged_once(caplog):
    _seed(NOW - 60, 8000.0, remaining=2000.0)
    caplog.set_level(logging.WARNING)

    usage.record(FORECAST_URL, upstream_response(QUOTA_HEADERS))
    usage.flush(now=NOW)
    usage.record(FORECAST_URL, upstream_response(QUOTA_HEADERS))
    usage.flush(now=NOW + 1)

    warnings = [record for record in caplog.records if "free daily calls" in record.getMessage()]
    assert len(warnings) == 1
    assert "8001" in warnings[0].getMessage()


def test_usage_rows_survive_a_schema_upgrade():
    """Unlike a cache the log cannot be refetched, so a bump must keep it."""
    _seed(NOW - 60, 4.0)
    with db_connection() as conn:
        conn.execute("PRAGMA user_version = 10;")

    init_db()

    assert len(_rows()) == 1
    with db_connection() as conn:
        assert conn.execute("PRAGMA user_version;").fetchone()[0] == SCHEMA_VERSION


# ---------------------------------------------------------------------------
# The background flush
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_flush_loop_writes_buffered_rows(monkeypatch):
    usage.record(FORECAST_URL, upstream_response(QUOTA_HEADERS))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise asyncio.CancelledError

    monkeypatch.setattr(usage.asyncio, "sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await usage._flush_loop()

    assert usage.buffered() == 0
    assert len(_rows()) == 1


@pytest.mark.asyncio
async def test_start_and_stop_write_what_is_buffered():
    usage.record(FORECAST_URL, upstream_response(QUOTA_HEADERS))

    usage.start()
    await usage.stop()

    assert usage.buffered() == 0
    assert len(_rows()) == 1


# ---------------------------------------------------------------------------
# The read endpoint
# ---------------------------------------------------------------------------


def test_the_quota_endpoint_reports_logged_rows(client):
    now = datetime.now(UTC).timestamp()
    _seed(now - 120, 9.0)
    _seed(now - 60, 3.0, endpoint="point")

    resp = client.get("/api/weather/quota")

    assert resp.status_code == 200
    body = resp.json()
    assert body["daily_limit"] == 10000
    assert body["today_calls"] == 12.0
    assert body["days"][-1]["calls"] == 12.0
    assert body["latest"]["endpoint"] == "point"
    assert len(body["hours_today"]) >= 1


def test_the_quota_endpoint_is_empty_before_any_call(client):
    resp = client.get("/api/weather/quota")

    assert resp.status_code == 200
    body = resp.json()
    assert body["today_calls"] == 0.0
    assert body["days"] == []
    assert body["hours_today"] == []
    assert body["latest"] is None


def test_the_days_cover_the_last_fourteen_days():
    """A row from before the window is not reported, one inside it is."""
    _seed(NOW - 20 * 86400, 6.0)
    _seed(NOW - 2 * 86400, 2.0)

    result = usage.summary(now=NOW)

    assert [day["calls"] for day in result["days"]] == [2.0]


def test_a_day_without_calls_is_absent_rather_than_zeroed():
    _seed(NOW - 3 * 86400, 1.0)

    result = usage.summary(now=NOW)

    assert [day["day"] for day in result["days"]] == [
        (datetime.fromtimestamp(NOW, UTC) - timedelta(days=3)).strftime("%Y-%m-%d")
    ]
    assert result["today_calls"] == 0.0
