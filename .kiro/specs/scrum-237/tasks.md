# Tasks: SCRUM-237

- [x] 1. Tier table and outline
  - Opaque palette (pale ice, cyan, white, pink), `CURRENT_TIER_OUTLINE`, drop `opacity`.
  - _Requirements: 2.2, 2.5_
  - _Files: frontend/src/utils/currentTiers.ts_

- [x] 2. Draw the outline on every base
  - Two groups per glyph (dark rim, fill); remove the `halo` option and its props.
  - _Requirements: 2.1_
  - _Files: frontend/src/components/WaterCurrentChevron.tsx, CurrentOverlay.tsx, MapView.tsx_

- [x] 3. Legend
  - Opaque swatches with the same outline.
  - _Requirements: 2.4_
  - _Files: frontend/src/components/CurrentLegend.tsx_

- [x] 4. Contrast test
  - WCAG ratio for every tier against dark, OSM and chart water and the gradient at 0–25 kn at 0.55 and 0.35; fill vs outline.
  - _Requirements: 2.3_
  - _Files: frontend/src/utils/currentTiers.test.ts, components/WaterCurrentChevron.test.ts, components/CurrentLegend.test.tsx_

- [x] 5. Requirements and verification
  - Ocean-currents and paper-chart lines; `ci-checks`; PR into `develop`, merge, comment the hash, rebuild the container.
  - _Requirements: all_
  - _Files: requirements.md_
