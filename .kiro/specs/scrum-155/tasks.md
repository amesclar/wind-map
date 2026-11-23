# SCRUM-155 Implementation plan

- [x] 1. Add the pure range helper and its tests
  - `timeRangeHours`, `isHourAligned`, interval list, 24-capture cap and `planExportRange` with the summary line and validation messages
  - Tests: end inclusion, non-dividing interval, DST changes, window limits, invalid ranges
  - _Requirements: 1, 2, 6_
  - _Files: `frontend/src/utils/exportRange.ts`, `frontend/src/utils/exportRange.test.ts`_

- [x] 2. Extract `downloadCanvas` from `saveMapImage`
  - Save an already-composed canvas so range frames are captured once
  - _Requirements: 3, 5_
  - _Files: `frontend/src/utils/captureMap.ts`, `frontend/src/utils/captureMap.test.ts`_

- [x] 3. Add the render loop with injected I/O and its tests
  - `captureRange`: per-hour set/wait/capture, progress, cancel, `RangeCaptureError` with partial frames
  - _Requirements: 3, 4, 6_
  - _Files: `frontend/src/utils/rangeCapture.ts`, `frontend/src/utils/rangeCapture.test.ts`_

- [x] 4. Report grid readiness per hour
  - Optional `onLoaded` on `useWindGrid`, passed through `MapView` to `App`
  - _Requirements: 3_
  - _Files: `frontend/src/hooks/useWindGrid.ts`, `frontend/src/components/MapView.tsx`, `frontend/src/hooks/useWindGrid.test.ts`_

- [x] 5. Add Range mode to the export dialog and its tests
  - Mode switch, start/end/interval selects from the forecast window, summary/validation, progress + Cancel, failure + Save captured frames, range format choices and hidden file-name field
  - _Requirements: 1, 2, 4, 5_
  - _Files: `frontend/src/components/MapExportDialog.tsx`, `frontend/src/components/MapExportDialog.test.tsx`_

- [x] 6. Wire the range export in `App` and test it end to end
  - Build per-hour content and names, drive the loop, save frames, cancel, failure recovery, restore `forecastTime` in `finally`
  - _Requirements: 3, 4, 5, 6_
  - _Files: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`_

- [x] 7. Update the project docs
  - `requirements.md` and `README.md`: range selection, limits, interim per-frame downloads, ZIP/PDF deferred to SCRUM-156
  - _Requirements: 5_
  - _Files: `requirements.md`, `README.md`_

- [x] 8. Run the full check set (CI parity)
  - `ruff check .`, `ruff format --check .`, `pytest -q`, `python scripts/sync-ai-rules.py --check`
  - `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`
