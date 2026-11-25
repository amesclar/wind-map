# Tasks: SCRUM-227

- [x] 1. Add the model and its metadata
  - `ecmwf_aifs025_single` / "ECMWF AIFS (AI)"; 6-hourly cycles 00/06/12/18 UTC, 360 h horizon.
  - _Requirements: 1.1, 1.2_
  - _Files: backend/app/config.py_

- [x] 2. Tests
  - Model list, forwarded Open-Meteo id, table-vs-config row and horizon days, and an AIFS payload without gusts.
  - _Requirements: 1.1–1.3, 2.1, 2.2, 3.1–3.3_
  - _Files: backend/tests/test_api.py, backend/tests/test_forecast_time.py, backend/tests/test_forecast_parser.py_

- [x] 3. Docs
  - Model window and the AIFS note in `requirements.md`; selector list and forecast window in `README.md`.
  - _Requirements: 1.1, 1.2, 2.1_
  - _Files: requirements.md, README.md_

- [x] 4. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: all_
