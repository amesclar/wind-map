# Tasks: SCRUM-251

- [x] 1. Suppress the grid refresh caused by a pop-up auto-pan
  - `autopanstart`/`dragstart`/`zoomend` handling around the existing `moveend` refresh.
  - _Requirements: 2.1, 2.2, 2.3, 3.1_
  - _Files: frontend/src/hooks/useWindGrid.ts_

- [x] 2. Regression tests
  - Auto-pan `moveend` does not refetch; a later user pan does; a stray `autopanstart` does not
    swallow the next drag.
  - _Requirements: 2.1, 2.3, 3.1, 3.2_
  - _Files: frontend/src/hooks/useWindGrid.test.ts_

- [x] 3. Docs
  - Grid refresh note in `requirements.md`; this spec.
  - _Requirements: 2.2_
  - _Files: requirements.md, .kiro/specs/scrum-251/_

- [ ] 4. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: 3.4_
