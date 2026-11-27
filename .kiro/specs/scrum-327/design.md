# SCRUM-327 — Design

## Problem

The free API is charged in weighted API calls, one per grid point, so a full view is up to 400 calls
against 10,000/day. The app caches overlaps and hours, which means the daily peak depends on how the
map is used — something the app cannot see today. Open-Meteo publishes no usage dashboard for the
free tier, so the free-versus-$29 decision was being made from an estimate.

## Approach

Open-Meteo reports the exact charge on every response, so the log stores the upstream's own number:

- `X-RateLimit-Cost` — calls charged for this HTTP request (`1.0`, `2.5`, …).
- `X-RateLimit-Limit` / `-Remaining` / `-Window` / `-Reset` — the tightest window (600/60 s,
  5,000/3,600 s, 10,000/86,400 s) and when it resets.
- A request refused for an exhausted quota carries no cost because it was not charged.

## Components

- `backend/app/services/open_meteo_usage.py` — parses the headers, buffers `UsageRow`s per attempt,
  flushes them in one transaction, prunes hourly, warns once per UTC day at 80%, and builds the
  read summary. A background task flushes every 30 s and on shutdown.
- `backend/app/services/open_meteo.py` — `get_json` records each attempt (retried attempts included)
  and takes an optional `label` so the log can tell grid from point from marine calls.
- `backend/app/database.py` — `open_meteo_usage` table, deliberately outside `CACHE_TABLE_DDL`
  (unlike a cache it cannot be refetched), plus `prune_open_meteo_usage`; `SCHEMA_VERSION` 10 → 11.
- `backend/app/routers/quota.py` — `GET /api/weather/quota`, behind the existing gate.
- `backend/app/models.py` — response models.

## Correctness properties

- P1 (1.2, 1.4): the number of logged rows equals the number of upstream attempts that carried quota
  headers, and a quota rejection logs `cost = 0`.
- P2 (2.1): no exception from parsing, buffering or writing escapes `get_json`.
- P3 (3.1, 3.2): the sum of a day's `cost` equals the calls the endpoint reports for that day, and an
  empty log answers zero and empty lists.
- P4 (3.3): at most one 80% warning is logged per UTC day.
- P5 (4.1): a schema bump keeps every usage row while recreating the cache tables.

## Out of scope

Cache TTLs, grid density, provider choice, billing, any UI, Cloud Monitoring metrics and alerting.
