# Tasks: SCRUM-252

- [x] 1. Shared placement helper
  - `POPUP_OPTIONS`, `popupNudge`, `tipVisible`, `placePopupInView`.
  - _Requirements: 1.1, 1.2, 2.1–2.4_
  - _Files: frontend/src/utils/popupPlacement.ts_

- [x] 2. Wire all three pop-ups
  - Shared options on saved locations, wind barbs and current chevrons; placement on `popupopen`,
    after the auto-pan and after the tide block.
  - _Requirements: 1.1, 3.1, 3.2_
  - _Files: frontend/src/components/MapView.tsx, WindOverlay.tsx, CurrentOverlay.tsx_

- [x] 3. Tests
  - Geometry/options/tip unit tests; shared-option assertions at all three bind sites; placement
    wiring through the Leaflet mock (`once`, event arguments, recorded popup options).
  - _Requirements: 2.1–2.4, 3.1, 3.2, 4.1_
  - _Files: frontend/src/utils/popupPlacement.test.ts, MapView.test.tsx, WindOverlay.component.test.tsx, CurrentOverlay.test.tsx, test/leafletMock.ts_

- [x] 4. Docs
  - Requirements note and this spec.
  - _Requirements: all_
  - _Files: requirements.md, .kiro/specs/scrum-252/_

- [ ] 5. CI and merge
  - `ci-checks`, PR into `develop`, merge on green, comment the hash, delete the branch, rebuild the container.
  - _Requirements: 4.2, 4.3_
