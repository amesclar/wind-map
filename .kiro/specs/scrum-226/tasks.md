# Tasks: SCRUM-226

- [x] 1. Rename the model and its metadata
  - `ecmwf_ifs` / "ECMWF IFS HRES 9 km"; metadata 6-hourly, 360 h; `MODEL_ALIASES` for the retired id.
  - _Requirements: 2.1, 2.3_
  - _Files: backend/app/config.py_

- [x] 2. Normalise the retired id
  - `model_param` maps `ecmwf_ifs04` to `ecmwf_ifs` before validation, so cache keys and upstream requests use the canonical id.
  - _Requirements: 2.2, 2.4, 3.1, 3.2, 3.3_
  - _Files: backend/app/dependencies.py_

- [x] 3. Tests
  - Model list and name, alias via `/api/weather/grid`, renamed ids in grid and forecast-time tests, table-vs-config still green.
  - _Requirements: 2.1–2.4, 3.1–3.4_
  - _Files: backend/tests/test_api.py, backend/tests/test_grid.py, backend/tests/test_forecast_time.py_

- [x] 4. Docs
  - Model list, horizon id and the one-release alias in `requirements.md`; selector list in `README.md`.
  - _Requirements: 2.1, 2.4_
  - _Files: requirements.md, README.md_

- [x] 5. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container, and check ECMWF wind is non-zero on the running app.
  - _Requirements: all_
