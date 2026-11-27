# SCRUM-327 — Tasks

- [x] 1. Add the usage table and retention prune to the schema.
  - New `open_meteo_usage` DDL outside `CACHE_TABLE_DDL`; `SCHEMA_VERSION` 10 → 11; index on `at`;
    `prune_open_meteo_usage`.
  - _Requirements: 3.4, 4.1, 4.2_ — _Files: backend/app/database.py, backend/app/config.py_

- [x] 2. Record each upstream attempt.
  - `sample`, `record`, buffered `flush`, hourly prune, once-a-day 80% warning, background loop.
  - _Requirements: 1.1–1.4, 2.1–2.3, 3.3_ — _Files: backend/app/services/open_meteo_usage.py_

- [x] 3. Hook the one Open-Meteo choke point and label the callers.
  - `get_json(url, params, timeout, retries, label)` records every response; grid, point, marine,
    tide, geocoding and elevation pass their label.
  - _Requirements: 1.1, 1.2_ — _Files: backend/app/services/open_meteo.py and callers_

- [x] 4. Expose the read endpoint.
  - `GET /api/weather/quota`, models, router registration, startup prune and flush loop in lifespan.
  - _Requirements: 3.1, 3.2_ — _Files: backend/app/routers/quota.py, backend/app/models.py,
    backend/app/main.py_

- [x] 5. Tests.
  - Header parsing, rejection cost, retries, broken response, database failure, prune, summary,
    warning-once, endpoint shape, schema bump keeping rows.
  - _Requirements: 1.1–1.4, 2.1–2.3, 3.1–3.4, 4.1_

- [x] 6. Update the project requirements.
  - _Files: requirements.md_

- [x] 7. Verify with the CI checks (ruff, pytest --cov) and the PR checks.
