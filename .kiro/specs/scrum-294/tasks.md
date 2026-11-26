# SCRUM-294 Implementation Plan

## Tasks

- [x] 1. Add the orientation copy
  - Export `MAP_KEY_ORIENTATION` with one line per layer
  - Render the wind line with the existing `colour = temperature` note
  - Render the currents and waves lines inside their own blocks
  - _Requirements: 1.1–1.4, 1.7_
  - _Files: `frontend/src/components/MapLegend.tsx`_

- [x] 2. Put the same explanation in the key's accessible name
  - Append each orientation line after its layer's unit in the `aria-label`
  - _Requirements: 1.5_
  - _Files: `frontend/src/components/MapLegend.tsx`_

- [x] 3. Test the copy and the label
  - Wind line always present; currents and waves lines only with their rows
  - `aria-label` carries all three phrases
  - Existing glyph, range and pointer-events assertions still pass
  - _Requirements: 1.1–1.6_
  - _Files: `frontend/src/components/MapLegend.test.tsx`_

- [x] 4. Update the project requirements
  - The `MapLegend` sentence records the orientation lines and the label
  - _Files: `requirements.md`_

- [x] 5. Run the CI checks
  - `cd frontend && npm run lint && npm run typecheck && npm run test:coverage`
  - `ruff check . && ruff format --check . && pytest --cov`
  - _Requirements: all_
