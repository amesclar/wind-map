"""Estimate the Open-Meteo calls behind the app's production traffic (SCRUM-236).

The app caches every point for 30 minutes, so the same request does not always cost the same.
This script replays the Cloud Run request log through the app's own cache rules -- the cache
keys, the 30-minute TTL, the 150-point request chunking -- and reports the upstream calls each
real browser session cost, instead of counting HTTP requests and calling it usage.

Input is the tab-separated export:

    gcloud logging read 'resource::type="cloud_run_revision" ...' --format='value(timestamp,
    httpRequest.requestUrl,httpRequest.status,httpRequest.remoteIp,httpRequest.userAgent,
    httpRequest.latency)' > requests.tsv

Usage:
    python .kiro/specs/scrum-236/tools/usage.py --input /tmp/wm-requests-lat.txt \
        --out .kiro/specs/scrum-236/results/production-usage.json --locations 1
"""

import argparse
import collections
import datetime as dt
import json
import math
import statistics
import urllib.parse
from pathlib import Path

CACHE_TTL_SECONDS = 1800
GRID_REQUEST_MAX_POINTS = 150
ELEVATION_BATCH_SIZE = 100
SESSION_GAP_SECONDS = 1800
FREE_TIER_DAILY_CALLS = 10_000
FREE_TIER_PER_MINUTE = 600


def is_browser(ua: str) -> bool:
    return "Mozilla" in ua and "bot" not in ua.lower()


def parse_latency(value: str) -> float | None:
    try:
        return float(value.rstrip("s"))
    except ValueError:
        return None


def read_rows(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) < 6:
            continue
        stamp, url, status, ip, ua, latency = parts[:6]
        try:
            moment = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        parsed = urllib.parse.urlsplit(url)
        rows.append(
            {
                "time": moment,
                "path": parsed.path,
                "query": dict(urllib.parse.parse_qsl(parsed.query)),
                "status": status,
                "ip": ip,
                "ua": ua,
                "latency": parse_latency(latency),
            }
        )
    rows.sort(key=lambda row: row["time"])
    return rows


def grid_points(query: dict[str, str]) -> list[tuple[float, float]]:
    """The router's point list for a bbox request."""
    try:
        min_lat, max_lat = float(query["min_lat"]), float(query["max_lat"])
        min_lon, max_lon = float(query["min_lon"]), float(query["max_lon"])
        cols, rows = int(query["cols"]), int(query["rows"])
    except KeyError, ValueError:
        return []
    lat_step = (max_lat - min_lat) / (rows - 1) if rows > 1 else 0.0
    lon_step = (max_lon - min_lon) / (cols - 1) if cols > 1 else 0.0
    return [
        (round(min_lat + r * lat_step, 6), round(min_lon + c * lon_step, 6)) for r in range(rows) for c in range(cols)
    ]


def key_of(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 2), round(lon, 2))


def sessions(rows: list[dict]) -> list[list[dict]]:
    """Browser traffic split into sessions: same IP, no gap longer than 30 minutes."""
    per_ip: dict[str, list[dict]] = collections.defaultdict(list)
    for row in rows:
        if is_browser(row["ua"]):
            per_ip[row["ip"]].append(row)
    found = []
    for entries in per_ip.values():
        current: list[dict] = []
        previous = None
        for row in entries:
            if previous is not None and row["time"] - previous > SESSION_GAP_SECONDS:
                found.append(current)
                current = []
            current.append(row)
            previous = row["time"]
        if current:
            found.append(current)
    return sorted(found, key=lambda session: session[0]["time"])


def simulate(session: list[dict], locations: int) -> dict:
    """Upstream calls the app would make for this session, following its cache rules."""
    cache: dict[tuple, float] = {}
    calls = 0
    points_charged = 0
    per_endpoint: dict[str, dict] = collections.defaultdict(lambda: {"requests": 0, "calls": 0})

    def fresh(key: tuple, now: float) -> bool:
        expiry = cache.get(key)
        return expiry is not None and expiry > now

    def store(key: tuple, now: float) -> None:
        cache[key] = now + CACHE_TTL_SECONDS

    for row in session:
        now = row["time"]
        path = row["path"]
        query = row["query"]
        per_endpoint[path]["requests"] += 1

        if path == "/api/weather/grid":
            points = grid_points(query)
            if not points:
                continue
            model = query.get("model", "best_match")
            hour = query.get("time", "current")
            missing = []
            for lat, lon in points:
                key = ("grid", model, hour, *key_of(lat, lon))
                if fresh(key, now):
                    continue
                missing.append((lat, lon))
                store(key, now)
            if missing:
                chunks = math.ceil(len(missing) / GRID_REQUEST_MAX_POINTS)
                calls += chunks
                points_charged += len(missing)
                per_endpoint[path]["calls"] += chunks

        elif path in {"/api/currents/grid", "/api/waves/grid"}:
            points = grid_points(query)
            if not points:
                continue
            hour = query.get("time", "current")
            missing = []
            for lat, lon in points:
                key = ("marine", hour, *key_of(lat, lon))
                if fresh(key, now):
                    continue
                missing.append((lat, lon))
                store(key, now)
            if missing:
                # One marine request for the whole list; currents also look cells up by elevation.
                endpoint_calls = 1
                if path == "/api/currents/grid":
                    endpoint_calls += math.ceil(len(missing) / ELEVATION_BATCH_SIZE)
                calls += endpoint_calls
                points_charged += len(missing)
                per_endpoint[path]["calls"] += endpoint_calls

        elif path == "/api/weather/all":
            model = query.get("model", "best_match")
            hour = query.get("time", "current")
            timezone = query.get("timezone", "America/Los_Angeles")
            for location_id in range(1, locations + 1):
                key = ("weather", "location", location_id, model, timezone, hour)
                if fresh(key, now):
                    continue
                store(key, now)
                calls += 1
                points_charged += 1
                per_endpoint[path]["calls"] += 1

        elif path == "/api/weather/point":
            model = query.get("model", "best_match")
            hour = query.get("time", "current")
            try:
                key = ("weather", "point", key_of(float(query["lat"]), float(query["lon"])), model, hour)
            except KeyError, ValueError:
                continue
            if not fresh(key, now):
                store(key, now)
                calls += 1
                points_charged += 1
                per_endpoint[path]["calls"] += 1

    return {
        "start": dt.datetime.fromtimestamp(session[0]["time"], dt.UTC).isoformat(),
        "ip": session[0]["ip"],
        "minutes": round((session[-1]["time"] - session[0]["time"]) / 60, 1),
        "requests": len(session),
        "calls": calls,
        "points_charged": points_charged,
        "endpoints": {path: dict(values) for path, values in per_endpoint.items()},
    }


def latencies(rows: list[dict]) -> dict[str, dict]:
    """App-level latency per endpoint, split into fast (cache hit) and slow (upstream) runs."""
    by_path: dict[str, list[float]] = collections.defaultdict(list)
    for row in rows:
        if row["status"] == "200" and row["latency"] is not None:
            by_path[row["path"]].append(row["latency"])
    result = {}
    for path, values in sorted(by_path.items()):
        values.sort()
        result[path] = {
            "count": len(values),
            "median": round(statistics.median(values), 3),
            "p90": round(values[min(len(values) - 1, int(len(values) * 0.9))], 3),
            "max": round(values[-1], 3),
            "under_0_2s": sum(1 for value in values if value < 0.2),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--locations", type=int, default=1, help="saved locations /api/weather/all fetches")
    args = parser.parse_args()

    rows = read_rows(Path(args.input))
    found = sessions(rows)
    results = [simulate(session, args.locations) for session in found]
    totals = sum(row["calls"] for row in results)

    payload = {
        "input": args.input,
        "requests": len(rows),
        "window": {
            "from": dt.datetime.fromtimestamp(rows[0]["time"], dt.UTC).isoformat(),
            "to": dt.datetime.fromtimestamp(rows[-1]["time"], dt.UTC).isoformat(),
        },
        "sessions": len(results),
        "calls_total": totals,
        "points_total": sum(row["points_charged"] for row in results),
        "sessions_in": results,
        "latency": latencies(rows),
        "notes": [
            "Calls are simulated through the app's own cache rules (30-minute TTL, rounded point keys).",
            "Coverage splits for regional models are not modelled; the observed traffic is best_match.",
            "One currents view also pays one elevation request per 100 points (SCRUM-238).",
            f"Free tier: {FREE_TIER_DAILY_CALLS} calls/day and {FREE_TIER_PER_MINUTE}/minute per IP.",
        ],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))

    start, end = payload["window"]["from"][:16], payload["window"]["to"][:16]
    print(f"window {start} .. {end}  requests={len(rows)}  sessions={len(results)}")
    print(f"{'start':17s} {'min':>5s} {'req':>4s} {'calls':>6s} {'points':>7s}")
    for row in results:
        print(
            f"{row['start'][:16]:17s} {row['minutes']:5.1f} {row['requests']:4d} "
            f"{row['calls']:6d} {row['points_charged']:7d}"
        )
    if results:
        print(
            f"calls per session: median {statistics.median([r['calls'] for r in results]):.0f}, "
            f"max {max(r['calls'] for r in results)}"
        )
    print("\nlatency (s) by endpoint")
    for path, row in payload["latency"].items():
        print(
            f"{path:24s} n={row['count']:3d} median={row['median']:.3f} p90={row['p90']:.3f} "
            f"max={row['max']:.3f} fast={row['under_0_2s']}"
        )
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
