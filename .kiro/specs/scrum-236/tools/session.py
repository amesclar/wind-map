"""Drive one measured map session against a running wind-map backend (SCRUM-236).

The sequence is the one the ticket describes: open the app, pan and zoom around Puget
Sound, step through the forecast hours, then turn on the currents and waves layers. Every
request here is one the frontend makes for the same action, with the same grid size
(``useWindGrid``: about one barb per 80 px, capped at 20 per axis -> 18 x 11 on a 1440 x 900
map) and the same production-style view box.

The point is not the UI: it is the count of upstream Open-Meteo calls and the app-level
latency for a session, so the numbers can be compared with the free tier's budget.

Usage:
    python .kiro/specs/scrum-236/tools/session.py --base-url http://127.0.0.1:8099 \
        --minutes 5 --pan-interval 5 --out .kiro/specs/scrum-236/results/session-local.json
"""

import argparse
import json
import statistics
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

COLS, ROWS = 18, 11
SPAN_LAT, SPAN_LON = 0.72, 1.44  # a zoom-9 Puget Sound view
CENTRES = [
    (48.15, -122.75),  # San Juan / Whidbey
    (48.35, -122.95),  # Strait of Juan de Fuca
    (48.05, -122.55),  # Port Townsend / Admiralty Inlet
    (47.85, -122.55),  # Everett / Possession Sound
    (47.60, -122.45),  # Seattle / Puget Sound
    (47.40, -122.40),  # Tacoma
    (47.75, -122.90),  # Hood Canal
    (48.20, -123.40),  # west of Whidbey, open strait
]


def view(index: int) -> dict[str, float | int]:
    """A bbox for pan step `index`, wrapping through the centres above."""
    lat, lon = CENTRES[index % len(CENTRES)]
    drift = ((index // len(CENTRES)) % 3 - 1) * 0.1
    return {
        "min_lat": round(lat - SPAN_LAT / 2 + drift, 4),
        "max_lat": round(lat + SPAN_LAT / 2 + drift, 4),
        "min_lon": round(lon - SPAN_LON / 2, 4),
        "max_lon": round(lon + SPAN_LON / 2, 4),
        "cols": COLS,
        "rows": ROWS,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8099")
    parser.add_argument("--minutes", type=float, default=5.0, help="length of the pan/zoom phase")
    parser.add_argument("--pan-interval", type=float, default=5.0, help="seconds between views")
    parser.add_argument("--model", default="best_match")
    parser.add_argument("--timezone", default="America/Los_Angeles")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    pans = max(1, int(args.minutes * 60 / args.pan_interval))
    midnight = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    hours = [midnight + timedelta(hours=3 * step) for step in range(8)]
    calls: list[dict] = []

    def call(name: str, path: str, params: dict | None = None) -> dict:
        started = time.perf_counter()
        try:
            resp = httpx.get(f"{args.base_url}{path}", params=params or {}, timeout=300.0)
            seconds = time.perf_counter() - started
            record = {
                "name": name,
                "path": path,
                "status": resp.status_code,
                "seconds": round(seconds, 3),
                "bytes": len(resp.content),
                "params": params or {},
            }
            if resp.status_code != 200:
                record["body"] = resp.text[:200]
        except httpx.HTTPError as exc:
            record = {
                "name": name,
                "path": path,
                "status": type(exc).__name__,
                "seconds": round(time.perf_counter() - started, 3),
                "bytes": 0,
                "params": params or {},
                "body": str(exc)[:200],
            }
        calls.append(record)
        print(
            f"{record['name']:22s} {record['status']!s:5s} {record['seconds']:7.3f}s {record['bytes']:7d}B",
            flush=True,
        )
        return record

    # Opening the app.
    call("config", "/api/config")
    call("locations", "/api/locations")
    call("models", "/api/weather/models")
    call("weather_all", "/api/weather/all", {"model": args.model, "timezone": args.timezone})
    call("grid_current", "/api/weather/grid", {**view(0), "model": args.model})

    # Pan and zoom around Puget Sound for the session's pan phase.
    started = time.monotonic()
    for index in range(1, pans + 1):
        target = started + index * args.pan_interval
        remaining = target - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        call("grid_pan", "/api/weather/grid", {**view(index), "model": args.model})

    # Step through the forecast hours on the last view.
    box = view(pans)
    for moment in hours:
        stamp = moment.strftime("%Y-%m-%dT%H:%M:%SZ")
        call("grid_hour", "/api/weather/grid", {**box, "model": args.model, "time": stamp})

    # Turn the currents layer on, then the waves layer.
    for index in range(4):
        call("currents_grid", "/api/currents/grid", view(pans + index))
    for index in range(4):
        call("waves_grid", "/api/waves/grid", view(pans + index))

    # A barb click: the pop-up's point forecast.
    call(
        "point_forecast",
        "/api/weather/point",
        {"lat": box["min_lat"], "lon": box["min_lon"], "model": args.model, "timezone": args.timezone},
    )

    summary: dict[str, dict] = {}
    for record in calls:
        row = summary.setdefault(record["name"], {"count": 0, "ok": 0, "seconds": []})
        row["count"] += 1
        if record["status"] == 200:
            row["ok"] += 1
            row["seconds"].append(record["seconds"])
    for row in summary.values():
        seconds = row.pop("seconds")
        row["median"] = round(statistics.median(seconds), 3) if seconds else None
        row["max"] = round(max(seconds), 3) if seconds else None

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "base_url": args.base_url,
                "model": args.model,
                "pans": pans,
                "time": datetime.now(UTC).isoformat(),
                "summary": summary,
                "calls": calls,
            },
            indent=2,
        )
    )
    print("\nname                   count ok  median      max")
    for name, row in summary.items():
        median = "-" if row["median"] is None else f"{row['median']:6.2f}s"
        print(f"{name:22s} {row['count']:5d} {row['ok']:2d} {median} {row['max']:7.2f}s")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
