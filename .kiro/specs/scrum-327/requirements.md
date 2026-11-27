# SCRUM-327 — Open-Meteo usage log

Feature: measure the app's own Open-Meteo free-tier usage so the free-versus-paid decision rests on
the real daily peak instead of an estimate.

## User stories

### 1. Every upstream attempt is measured (1.1–1.4)
1.1 WHEN the app makes an Open-Meteo request THEN the system shall record the response's
`X-RateLimit-Cost` as the calls charged, together with `X-RateLimit-Limit`, `-Remaining`, `-Window`
and `-Reset` when present.
1.2 WHEN one logical request is retried THEN the system shall record one row per upstream attempt.
1.3 WHEN a response carries no quota header THEN the system shall record nothing for it.
1.4 WHEN a request is refused because the quota is exhausted THEN the system shall record it with a
cost of zero.

### 2. Recording never costs a forecast (2.1–2.3)
2.1 WHEN the usage write fails THEN the system shall log a warning and still return the upstream
data or error unchanged.
2.2 WHEN rows are recorded THEN the system shall buffer them and write in batches rather than one
database write per upstream call.
2.3 WHEN the app shuts down THEN the system shall write whatever is still buffered.

### 3. The numbers are readable (3.1–3.4)
3.1 WHEN `GET /api/weather/quota` is called THEN the system shall return the daily limit, today's
charged calls and peak hour, one entry per day for the last 14 days, today's hourly buckets and the
latest quota headers seen.
3.2 WHEN a day has no logged calls THEN the system shall still return it only if it has rows; the
endpoint shall return empty lists rather than an error.
3.3 WHEN the daily total reaches 80% of 10,000 calls THEN the system shall log one warning per UTC
day.
3.4 WHEN usage rows are older than 90 days THEN the system shall delete them.

### 4. The log survives maintenance (4.1–4.2)
4.1 WHEN the database schema is upgraded THEN the system shall keep the usage rows, which cannot be
refetched like a cache.
4.2 WHEN the app starts THEN the system shall prune rows past the retention window.
