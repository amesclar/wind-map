# SCRUM-299 — Tasks

- [x] 1. Add the budget to the plan
  - `EXPORT_TILE_BUDGET`, `BASE_TILE_SIZE_PX`, `tilesForViewport`, `tilesPerFrame` input, refusal
    after the capture cap.
  - _Requirements: 1.1, 2.1, 2.2, 3.1_
  - _Files: `frontend/src/utils/exportRange.ts`_

- [x] 2. Measure the map and pass it to the dialog
  - `viewportTiles` from the map container on open and on resize; dialog prop; App wiring.
  - _Requirements: 1.1, 1.2_
  - _Files: `frontend/src/hooks/useMapExport.ts`, `frontend/src/components/MapExportDialog.tsx`,
    `frontend/src/App.tsx`_

- [x] 3. Tests
  - Unit tests for the helper, the 1080p/4K cases, the boundary and the skip; dialog tests for the
    refused and accepted full-day range.
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2_
  - _Files: `frontend/src/utils/exportRange.test.ts`, `frontend/src/components/MapExportDialog.test.tsx`_

- [x] 4. Record it
  - `requirements.md`'s range-mode bullet names the budget and the numbers it produces.
  - _Requirements: 3.2_
  - _Files: `requirements.md`_

- [x] 5. Verification
  - `ruff check .`, `ruff format --check .`, `pytest --cov`, `npm run lint`, `npm run typecheck`,
    `npm run test:coverage`, and the container rebuild after the merge.
