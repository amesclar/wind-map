# Tasks: SCRUM-195

- [x] 1. Backend service and cache
  - `tide_service.py` window, fetch, cache, extremes; `tide_point_cache`; schema v8.
  - _Requirements: 1.1, 1.3, 1.4, 2.1–2.3_
  - _Files: backend/app/services/tide_service.py, backend/app/database.py, backend/app/models.py_

- [x] 2. Endpoint
  - `GET /api/tides/point`, hour validation, 502/503, router registration.
  - _Requirements: 1.2, 1.5_
  - _Files: backend/app/routers/tides.py, backend/app/main.py_

- [x] 3. Backend tests
  - Refinement, bracketing, flat series, land/cache, malformed payload, 200/422/502/503.
  - _Requirements: 1.3–1.5, 2.1, 2.2_
  - _Files: backend/tests/test_tides.py_

- [x] 4. Frontend block and slots
  - Types, client call, `tideBlock.ts`, slots in both pop-up builders, `popupopen` fill.
  - _Requirements: 3.1–3.6_
  - _Files: frontend/src/{types.ts,api/client.ts,utils/tideBlock.ts,components/MapView.tsx,components/WindOverlay.tsx}_

- [x] 5. Frontend tests
  - Heights, times, labels, markers, caveat, empty land, both slots.
  - _Requirements: 3.3–3.6_

- [x] 6. Docs
  - Tides section in `requirements.md`, README feature and tree, this spec.
  - _Requirements: 4.1_
  - _Files: requirements.md, README.md, .kiro/specs/scrum-195/_

- [ ] 7. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: 4.2_
