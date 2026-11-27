"""Replay the wind-map's real Open-Meteo calls against a given base URL (SCRUM-236).

Every request here mirrors one the app actually makes, so the timings measure the
instance, not a synthetic query:

- ``point_forecast``     ``weather_service.fetch_forecast`` (one saved location)
- ``wind_grid_current``  ``grid_weather_service._fetch_current`` (one 150-point chunk)
- ``wind_grid_hourly``   ``grid_weather_service._fetch_hourly_day``
- ``currents_*``         ``currents_service._fetch_current`` / ``_fetch_hourly``
- ``waves_grid``         ``waves_service._fetch_wave``
- ``elevation``          ``currents_service._elevations`` (100 cells per request)
- ``wind_grid_far``      ``_fetch_hourly_day`` for a day near the model's horizon

The Puget Sound view and its 20 x 10 grid are the ones in the production request log.

Usage:
    python .kiro/specs/scrum-236/tools/replay.py --base-url http://127.0.0.1:8080 --rounds 3 \
        --out .kiro/specs/scrum-236/results/local.json

    python .kiro/specs/scrum-236/tools/replay.py --base-url https://api.open-meteo.com \
        --rounds 1 --points 40 --delay 3 --out .kiro/specs/scrum-236/results/public.json
"""

import argparse
import json
import statistics
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

BBOX = (47.4819, 48.9153, -124.9585, -120.509)  # min_lat, max_lat, min_lon, max_lon
COLS, ROWS = 20, 10
CHUNK = 150  # GRID_REQUEST_MAX_POINTS
GRID_VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "temperature_2m")
FORECAST_VARIABLES = (
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "weather_code",
    "wind_gusts_10m",
)
CURRENT_VARIABLES = ("ocean_current_velocity", "ocean_current_direction")
WAVE_VARIABLES = ("wave_height", "wave_direction", "wave_period")


def grid_points(limit: int | None = None) -> list[tuple[float, float]]:
    """The router's point list for the Puget Sound view (rows outer, cols inner)."""
    min_lat, max_lat, min_lon, max_lon = BBOX
    lat_step = (max_lat - min_lat) / (ROWS - 1)
    lon_step = (max_lon - min_lon) / (COLS - 1)
    points = [
        (round(min_lat + r * lat_step, 6), round(min_lon + c * lon_step, 6)) for r in range(ROWS) for c in range(COLS)
    ]
    return points[:limit] if limit else points


def first_chunk(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return points[: min(CHUNK, len(points))]


def coords(points: list[tuple[float, float]]) -> dict[str, str]:
    return {
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
    }


def shapes(points: list[tuple[float, float]], now: datetime) -> dict[str, tuple[str, dict[str, str]]]:
    """One entry per real app request: (path, params)."""
    chunk = first_chunk(points)
    today = now.strftime("%Y-%m-%d")
    far = (now + timedelta(days=5)).strftime("%Y-%m-%d")
    lat, lon = points[0]
    return {
        "point_forecast": (
            "/v1/forecast",
            {
                "latitude": str(lat),
                "longitude": str(lon),
                "hourly": ",".join(FORECAST_VARIABLES),
                "current": ",".join(FORECAST_VARIABLES),
                "timezone": "America/Los_Angeles",
                "forecast_days": "4",
                "wind_speed_unit": "kn",
            },
        ),
        "wind_grid_current": (
            "/v1/forecast",
            {
                **coords(chunk),
                "wind_speed_unit": "kn",
                "current": ",".join(GRID_VARIABLES),
                "forecast_days": "1",
            },
        ),
        "wind_grid_hourly": (
            "/v1/forecast",
            {
                **coords(chunk),
                "wind_speed_unit": "kn",
                "hourly": ",".join(GRID_VARIABLES),
                "start_date": today,
                "end_date": today,
                "timezone": "UTC",
            },
        ),
        "wind_grid_far": (
            "/v1/forecast",
            {
                **coords(chunk),
                "wind_speed_unit": "kn",
                "hourly": ",".join(GRID_VARIABLES),
                "start_date": far,
                "end_date": far,
                "timezone": "UTC",
            },
        ),
        "currents_current": (
            "/v1/marine",
            {
                **coords(chunk),
                "wind_speed_unit": "kn",
                "current": ",".join(CURRENT_VARIABLES),
                "forecast_days": "1",
            },
        ),
        "currents_hourly": (
            "/v1/marine",
            {
                **coords(chunk),
                "wind_speed_unit": "kn",
                "hourly": ",".join(CURRENT_VARIABLES),
                "start_date": today,
                "end_date": today,
                "timezone": "UTC",
            },
        ),
        "waves_grid": (
            "/v1/marine",
            {**coords(chunk), "current": ",".join(WAVE_VARIABLES), "forecast_days": "1"},
        ),
        "elevation": (
            "/v1/elevation",
            coords(chunk[:100]),
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--points", type=int, default=200, help="grid points to build (chunked at 150)")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--only", default="", help="comma-separated shape names")
    parser.add_argument("--label", default="")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    wanted = shapes(grid_points(args.points), now)
    if args.only:
        keep = {name.strip() for name in args.only.split(",")}
        wanted = {name: value for name, value in wanted.items() if name in keep}

    samples: dict[str, list[dict]] = {name: [] for name in wanted}
    with httpx.Client(timeout=args.timeout) as client:
        for rnd in range(args.rounds):
            for name, (path, params) in wanted.items():
                start = time.perf_counter()
                try:
                    resp = client.get(f"{args.base_url}{path}", params=params)
                    seconds = time.perf_counter() - start
                    body = resp.text
                    try:
                        points = len(json.loads(body)) if isinstance(json.loads(body), list) else 1
                    except ValueError:
                        points = 0
                    outcome = {
                        "round": rnd + 1,
                        "seconds": round(seconds, 3),
                        "status": resp.status_code,
                        "bytes": len(body),
                        "points": points,
                    }
                    if resp.status_code != 200:
                        outcome["body"] = body[:200]
                except httpx.HTTPError as exc:
                    outcome = {
                        "round": rnd + 1,
                        "seconds": round(time.perf_counter() - start, 3),
                        "status": type(exc).__name__,
                        "bytes": 0,
                        "points": 0,
                        "body": str(exc)[:200],
                    }
                samples[name].append(outcome)
                print(
                    f"round {rnd + 1} {name:20s} {outcome['status']!s:6s} {outcome['seconds']:8.3f}s "
                    f"{outcome['bytes']:7d}B {outcome.get('body', '')}",
                    flush=True,
                )
                if args.delay:
                    time.sleep(args.delay)

    summary = {}
    for name, rows in samples.items():
        ok = [row["seconds"] for row in rows if row["status"] == 200]
        summary[name] = {
            "runs": len(rows),
            "ok": len(ok),
            "median": round(statistics.median(ok), 3) if ok else None,
            "min": round(min(ok), 3) if ok else None,
            "max": round(max(ok), 3) if ok else None,
            "samples": rows,
        }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "label": args.label,
                "base_url": args.base_url,
                "points": args.points,
                "time": datetime.now(UTC).isoformat(),
                "shapes": summary,
            },
            indent=2,
        )
    )

    print("\nshape                 ok/runs  median     min      max")
    for name, row in summary.items():
        fmt = lambda value: "     -" if value is None else f"{value:6.2f}s"  # noqa: E731
        print(f"{name:20s} {row['ok']:>2}/{row['runs']:<3} {fmt(row['median'])} {fmt(row['min'])} {fmt(row['max'])}")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
