"""Open-Meteo free-tier usage log (SCRUM-327).

The free API is charged in weighted API calls, not HTTP requests: a grid view costs roughly one call
per point. Open-Meteo reports what each response was charged in `X-RateLimit-Cost`, and how much of
the tightest quota window is left in `X-RateLimit-Remaining`, so this log records the upstream's own
numbers rather than recomputing the weight formula. The per-day total is what decides whether the
free tier still fits or the $29 Standard plan has become necessary.

Logging must never cost a forecast: rows are buffered in memory and written in batches, and any
database failure is logged and dropped rather than raised to the caller.
"""

import asyncio
import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx

from backend.app import database
from backend.app.config import (
    OPEN_METEO_DAILY_CALL_LIMIT,
    OPEN_METEO_USAGE_FLUSH_ROWS,
    OPEN_METEO_USAGE_FLUSH_SECONDS,
    OPEN_METEO_USAGE_HISTORY_DAYS,
    OPEN_METEO_USAGE_RETENTION_DAYS,
    OPEN_METEO_USAGE_WARN_FRACTION,
)

logger = logging.getLogger(__name__)

COST_HEADER = "x-ratelimit-cost"
LIMIT_HEADER = "x-ratelimit-limit"
REMAINING_HEADER = "x-ratelimit-remaining"
WINDOW_HEADER = "x-ratelimit-window"
RESET_HEADER = "x-ratelimit-reset"

INSERT_SQL = (
    "INSERT INTO open_meteo_usage "
    "(at, hour, day, endpoint, status, cost, quota_limit, remaining, window_s, reset_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
)
PRUNE_SQL = "DELETE FROM open_meteo_usage WHERE at < ?;"
DAY_CALLS_SQL = "SELECT COALESCE(SUM(cost), 0) AS calls FROM open_meteo_usage WHERE day = ?;"
PRUNE_INTERVAL_SECONDS = 3600.0

# Fallback labels for a call whose caller did not name itself: (host, path prefix, label).
ENDPOINTS = (
    ("api.open-meteo.com", "/v1/elevation", "elevation"),
    ("api.open-meteo.com", "/v1/forecast", "forecast"),
    ("api.open-meteo.com", "/data/", "metadata"),
    ("marine-api.open-meteo.com", "/v1/marine", "marine"),
    ("geocoding-api.open-meteo.com", "/v1/search", "geocoding"),
)

_FLUSH_LOCK = threading.Lock()
_BUFFER: list[UsageRow] = []
_task: asyncio.Task | None = None
_warned_day: str | None = None
_last_prune = 0.0


@dataclass(frozen=True)
class UsageRow:
    """One upstream attempt: what Open-Meteo charged and what it said was left."""

    at: float
    endpoint: str
    status: int
    cost: float
    quota_limit: float | None
    remaining: float | None
    window_s: int | None
    reset_at: float | None

    @property
    def hour(self) -> str:
        return datetime.fromtimestamp(self.at, UTC).strftime("%Y-%m-%dT%H:00")

    @property
    def day(self) -> str:
        return datetime.fromtimestamp(self.at, UTC).strftime("%Y-%m-%d")

    def as_sql(self) -> tuple:
        return (
            self.at,
            self.hour,
            self.day,
            self.endpoint,
            self.status,
            self.cost,
            self.quota_limit,
            self.remaining,
            self.window_s,
            self.reset_at,
        )


def _float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def endpoint_label(url: str, label: str | None = None) -> str:
    """The caller's label, or one derived from the host and path when it named none."""
    if label:
        return label
    parts = urlsplit(url)
    for host, prefix, name in ENDPOINTS:
        if parts.hostname == host and parts.path.startswith(prefix):
            return name
    return "other"


def sample(url: str, response: httpx.Response, label: str | None = None, at: float | None = None) -> UsageRow | None:
    """The row for one attempt, or None when the response reported no quota numbers.

    A static metadata file costs nothing and carries no quota header, so it is not logged. A quota
    rejection carries the headers but no cost: Open-Meteo documents that a request refused because
    the quota is exhausted is not charged (rate-limiting guide), so it is logged as zero.
    """
    cost = _float(response.headers.get(COST_HEADER))
    limit = _float(response.headers.get(LIMIT_HEADER))
    remaining = _float(response.headers.get(REMAINING_HEADER))
    window = _float(response.headers.get(WINDOW_HEADER))
    reset = _float(response.headers.get(RESET_HEADER))
    if cost is None and limit is None and remaining is None and window is None and reset is None:
        return None
    return UsageRow(
        at=time.time() if at is None else at,
        endpoint=endpoint_label(url, label),
        status=response.status_code,
        cost=cost or 0.0,
        quota_limit=limit,
        remaining=remaining,
        window_s=None if window is None else int(window),
        reset_at=reset,
    )


def record(url: str, response: httpx.Response, label: str | None = None) -> None:
    """Buffer one upstream attempt. Never raises, whatever the response or the log holds."""
    try:
        row = sample(url, response, label)
    except Exception:
        logger.warning("Could not read the Open-Meteo quota headers", exc_info=True)
        return
    if row is None:
        return
    with _FLUSH_LOCK:
        _BUFFER.append(row)
        full = len(_BUFFER) >= OPEN_METEO_USAGE_FLUSH_ROWS
    if full:
        flush()


def buffered() -> int:
    """Rows waiting to be written."""
    with _FLUSH_LOCK:
        return len(_BUFFER)


def flush(now: float | None = None) -> int:
    """Write the buffered rows and prune old ones. Returns how many rows were written."""
    with _FLUSH_LOCK:
        rows, _BUFFER[:] = list(_BUFFER), []
    if not rows:
        return 0
    moment = time.time() if now is None else now
    try:
        with database.db_connection() as conn:
            conn.executemany(INSERT_SQL, [row.as_sql() for row in rows])
            _prune(conn, moment)
    except Exception:
        logger.warning("Could not write the Open-Meteo usage log (%d rows dropped)", len(rows), exc_info=True)
        return 0
    _warn_if_near_the_limit(moment)
    return len(rows)


def prune(now: float | None = None) -> int:
    """Delete rows past the retention window (startup and the hourly flush both call it)."""
    cutoff = (time.time() if now is None else now) - OPEN_METEO_USAGE_RETENTION_DAYS * 86400
    with database.db_connection() as conn:
        return conn.execute(PRUNE_SQL, (cutoff,)).rowcount


def _prune(conn, now: float) -> None:
    """Drop rows past the retention window, at most once an hour so a flush stays cheap."""
    global _last_prune
    if now - _last_prune < PRUNE_INTERVAL_SECONDS:
        return
    _last_prune = now
    conn.execute(PRUNE_SQL, (now - OPEN_METEO_USAGE_RETENTION_DAYS * 86400,))


def _daily_calls(day: str) -> float | None:
    try:
        with database.db_connection() as conn:
            row = conn.execute(DAY_CALLS_SQL, (day,)).fetchone()
    except Exception:
        logger.warning("Could not read today's Open-Meteo usage", exc_info=True)
        return None
    return None if row is None else float(row["calls"])


def _warn_if_near_the_limit(now: float) -> None:
    """One warning per UTC day when the day's charged calls reach the warning fraction."""
    global _warned_day
    day = datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%d")
    if _warned_day == day:
        return
    total = _daily_calls(day)
    if total is None:
        return
    if total >= OPEN_METEO_DAILY_CALL_LIMIT * OPEN_METEO_USAGE_WARN_FRACTION:
        _warned_day = day
        logger.warning(
            "Open-Meteo usage is at %.0f of the %d free daily calls (%.0f%%) for %s",
            total,
            OPEN_METEO_DAILY_CALL_LIMIT,
            100 * total / OPEN_METEO_DAILY_CALL_LIMIT,
            day,
        )


def summary(days: int = OPEN_METEO_USAGE_HISTORY_DAYS, now: float | None = None) -> dict[str, Any]:
    """Daily totals, today's hourly buckets and the latest headers, for the read endpoint."""
    moment = time.time() if now is None else now
    today = datetime.fromtimestamp(moment, UTC).strftime("%Y-%m-%d")
    first = (datetime.fromtimestamp(moment, UTC) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with database.db_connection() as conn:
        daily = conn.execute(
            "SELECT day, COALESCE(SUM(cost), 0) AS calls, COUNT(*) AS requests, MIN(remaining) AS lowest "
            "FROM open_meteo_usage WHERE day >= ? GROUP BY day ORDER BY day;",
            (first,),
        ).fetchall()
        buckets = conn.execute(
            "SELECT day, hour, COALESCE(SUM(cost), 0) AS calls, COUNT(*) AS requests "
            "FROM open_meteo_usage WHERE day >= ? GROUP BY day, hour ORDER BY day, hour;",
            (first,),
        ).fetchall()
        latest = conn.execute("SELECT * FROM open_meteo_usage ORDER BY at DESC, id DESC LIMIT 1;").fetchone()

    peaks: dict[str, dict[str, Any]] = {}
    for bucket in buckets:
        day = str(bucket["day"])
        if day not in peaks or bucket["calls"] > peaks[day]["calls"]:
            peaks[day] = {"hour": bucket["hour"], "calls": float(bucket["calls"])}
    return {
        "daily_limit": OPEN_METEO_DAILY_CALL_LIMIT,
        "today": today,
        "today_calls": float(next((row["calls"] for row in daily if row["day"] == today), 0.0)),
        "today_peak_hour": peaks.get(today, {}).get("hour"),
        "days": [
            {
                "day": row["day"],
                "calls": float(row["calls"]),
                "requests": int(row["requests"]),
                "peak_hour": peaks.get(row["day"], {}).get("hour"),
                "peak_hour_calls": peaks.get(row["day"], {}).get("calls"),
                "lowest_remaining": None if row["lowest"] is None else float(row["lowest"]),
            }
            for row in daily
        ],
        "hours_today": [
            {"hour": bucket["hour"], "calls": float(bucket["calls"]), "requests": int(bucket["requests"])}
            for bucket in buckets
            if bucket["day"] == today
        ],
        "latest": None if latest is None else _latest(latest),
    }


def _latest(row) -> dict[str, Any]:
    return {
        "at": datetime.fromtimestamp(row["at"], UTC).isoformat(),
        "endpoint": row["endpoint"],
        "status": int(row["status"]),
        "cost": float(row["cost"]),
        "quota_limit": None if row["quota_limit"] is None else float(row["quota_limit"]),
        "remaining": None if row["remaining"] is None else float(row["remaining"]),
        "window_seconds": None if row["window_s"] is None else int(row["window_s"]),
        "reset_at": None if row["reset_at"] is None else datetime.fromtimestamp(row["reset_at"], UTC).isoformat(),
    }


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(OPEN_METEO_USAGE_FLUSH_SECONDS)
        await asyncio.to_thread(flush)


def start() -> None:
    """Start the background flush (idempotent)."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_flush_loop())


async def stop() -> None:
    """Cancel the flush loop and write what is still buffered (app shutdown)."""
    global _task
    task, _task = _task, None
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await asyncio.to_thread(flush)
