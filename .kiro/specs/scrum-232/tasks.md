# Tasks: SCRUM-232

- [x] 1. Remove the button, prop and modal
  - Navbar button/prop/asset import, App state and modal element.
  - _Requirements: 1.1, 1.2_
  - _Files: frontend/src/components/Navbar.tsx, frontend/src/App.tsx_

- [x] 2. Delete the guide files
  - Modal, its test, `modelGuide.ts` and test, `weather-models.md`, `refresh-icon.png`.
  - _Requirements: 1.2, 3.3_

- [x] 3. Make config the source of truth
  - Per-model doc-page comments in `MODEL_METADATA`; test asserts configured values directly.
  - _Requirements: 3.1, 3.2_
  - _Files: backend/app/config.py, backend/app/services/model_info.py, backend/tests/test_forecast_time.py_

- [x] 4. Tests
  - Navbar has no guide button, order feedback · export · gear, footer line unaffected.
  - _Requirements: 1.1, 1.2, 2.1_

- [x] 5. Docs
  - Requirements guide section replaced, window source and toolbar order updated; README feature list and tree.
  - _Requirements: 3.3_
  - _Files: requirements.md, README.md_

- [ ] 6. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: all_
