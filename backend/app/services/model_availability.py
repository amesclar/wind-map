"""Open-Meteo model publication times (SCRUM-256).

`/api/weather/models` derives run times from cycle hours (SCRUM-115): the model's *initialisation*
time, which is hours before the run can actually be downloaded. Each model's `meta.json` is the
only place Open-Meteo says when a run became available, so the run line and the refresh gate prefer
it and fall back to the cycle when a model has no such file.

Only models with a single upstream run are listed in `MODEL_AVAILABILITY_IDS`: `best_match` and
the seamless blends are composites, and GEM's metadata has been frozen since 2026-05-26. A model
with no id is a supported answer (`None`), not a failure.

This never sits on a forecast's request path: a 3-second timeout, no retries, and a ten-minute
cache that remembers failures too, so a frozen or broken file costs one request per ten minutes.
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from backend.app.config import (
    MODEL_AVAILABILITY_CACHE_SECONDS,
    MODEL_AVAILABILITY_IDS,
    MODEL_AVAILABILITY_TIMEOUT_SECONDS,
    MODEL_AVAILABILITY_URL,
    model_metadata,
)
from backend.app.services import open_meteo
from backend.app.services.model_info import last_run_utc


@dataclass(frozen=True)
class Availability:
    """The newest run of one model: when it initialised, when it published, and the next one."""

    run_utc: str
    available_utc: str
    next_available_utc: str | None


def meta_model(model: str) -> str | None:
    """The Open-Meteo metadata name for an app model id, or None when it has no single run."""
    return MODEL_AVAILABILITY_IDS.get(model)


def _iso(seconds: object) -> str | None:
    """Unix seconds from the metadata file as an ISO 8601 UTC instant, or None when unusable."""
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds <= 0:
        return None
    return datetime.fromtimestamp(float(seconds), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_meta(data: object) -> Availability | None:
    """Read one `meta.json` body.

    A body without both the initialisation and the availability time is no answer rather than a
    partial one: half a pair would let the UI claim a publication time it does not have.
    """
    if not isinstance(data, dict):
        return None
    run = _iso(data.get("last_run_initialisation_time"))
    available = _iso(data.get("last_run_availability_time"))
    if run is None or available is None:
        return None

    interval = data.get("update_interval_seconds")
    next_available = None
    if isinstance(interval, (int, float)) and not isinstance(interval, bool) and interval > 0:
        # Rounded to the second like the other two: this is an estimate, and the UI says so.
        next_available = _iso(float(data["last_run_availability_time"]) + float(interval))
    return Availability(run_utc=run, available_utc=available, next_available_utc=next_available)


# Model id → (fetched at, answer). Failures are stored as None for the same window, so an
# unreachable or frozen endpoint cannot be retried on every request.
_CACHE: dict[str, tuple[float, Availability | None]] = {}


def reset_cache() -> None:
    """Drop every cached answer; tests use it, and a fresh process starts empty."""
    _CACHE.clear()


async def availability_for(model: str, now: float | None = None) -> Availability | None:
    """Publication times for `model`, or None when it has no readable metadata file."""
    meta = meta_model(model)
    if meta is None:
        return None

    moment = time.time() if now is None else now
    cached = _CACHE.get(model)
    if cached is not None and cached[0] + MODEL_AVAILABILITY_CACHE_SECONDS > moment:
        return cached[1]

    answer: Availability | None
    try:
        data = await open_meteo.get_json(
            MODEL_AVAILABILITY_URL.format(model=meta),
            {},
            # No retries: this is a freshness hint, so a slow upstream must not slow a request.
            timeout=MODEL_AVAILABILITY_TIMEOUT_SECONDS,
            retries=0,
        )
        answer = parse_meta(data)
    except httpx.HTTPError:
        answer = None

    _CACHE[model] = (moment, answer)
    return answer


def _parse_iso(stamp: str) -> datetime | None:
    try:
        return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError:
        return None


async def refresh_clock(model: str) -> datetime | None:
    """The newest run the source has published, for the refresh gate (SCRUM-113).

    `available_utc` is the accurate signal. The derived cycle is the fallback, and it is the only
    clock the composites and GEM have; using it there keeps the gate exactly as truthful as the
    run line the user is reading. A model with no metadata file and no cycle clock is `None`.
    """
    found = await availability_for(model)
    if found is not None:
        available = _parse_iso(found.available_utc)
        if available is not None:
            return available

    meta = model_metadata(model)
    if meta is None:
        return None
    cycles = [int(c) for c in meta["update_cycles_utc"]]  # type: ignore[arg-type]
    return last_run_utc(cycles, datetime.now(UTC))
