# Tasks: SCRUM-238

- [x] 1. Carry the cell through the service
  - `CurrentValue` with cell coordinates; parse `latitude`/`longitude` in current and hourly responses.
  - _Requirements: 2.1, 3.1, 3.3_
  - _Files: backend/app/services/currents_service.py_

- [x] 2. Return and deduplicate by cell
  - `_points_from` emits the cell coordinates, one point per cell, preserving order.
  - _Requirements: 2.1, 2.2, 2.4_
  - _Files: backend/app/services/currents_service.py_

- [x] 3. Cache the cell
  - Schema v6 adds `cell_lat`/`cell_lon`; store and read them with the value.
  - _Requirements: 2.3, 3.2_
  - _Files: backend/app/database.py, backend/app/services/currents_service.py, backend/app/models.py_

- [x] 4. Settings resolution note
  - Note under the Water Currents toggle, always visible.
  - _Requirements: 2.5_
  - _Files: frontend/src/components/MapSettingsModal.tsx_

- [x] 5. Tests and docs
  - pytest: differing cell, shared cell, null cell, cached cell, migration columns; vitest: the note.
  - _Requirements: 2.1–2.5, 3.1–3.5_
  - _Files: backend/tests/test_currents.py, backend/tests/test_database.py, frontend/src/components/MapSettingsModal.test.tsx, requirements.md_

- [x] 6. CI and manual check
  - Run the `ci-checks` skill; after deploy, check Camano Island on the paper chart and dark base.
  - _Requirements: all_

- [x] 7. Follow-up: land test for model cells (Whidbey user test)
  - Elevation lookup for unique cells, 0.5 m threshold, land cells dropped and cached empty, fail-open on lookup errors, schema v7.
  - _Requirements: 4.1–4.6_
  - _Files: backend/app/config.py, backend/app/services/currents_service.py, backend/app/database.py, backend/tests/conftest.py, backend/tests/test_currents.py, requirements.md_
