# Tasks: SCRUM-228

- [x] 1. Add the model and its metadata
  - `gem_seamless` / "CMC GEM Seamless"; 6-hourly cycles, 240 h horizon.
  - _Requirements: 1.1, 1.2_
  - _Files: backend/app/config.py_

- [x] 2. Correct the guide row
  - CMC GEM horizon 16 days → 10 days, noting the 12-hourly global run inside the seamless blend.
  - _Requirements: 1.3_
  - _Files: frontend/src/assets/weather-models.md_

- [x] 3. Tests
  - Model list and metadata, table-vs-config row, 10-day window, and the 422 past 240 h.
  - _Requirements: 1.1–1.4, 2.1, 2.2, 3.1, 3.2_
  - _Files: backend/tests/test_api.py, backend/tests/test_forecast_time.py_

- [x] 4. Docs
  - Window and GEM note in `requirements.md`; selector list and window in `README.md`.
  - _Requirements: 1.1, 1.2_
  - _Files: requirements.md, README.md_

- [ ] 5. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: all_
