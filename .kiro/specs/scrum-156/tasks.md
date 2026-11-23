# SCRUM-156 implementation plan

- [x] 1. Extract `downloadBlob` from `downloadCanvas` so outputs share the download path
  - _Files: `frontend/src/utils/captureMap.ts`_

- [x] 2. Add model-led archive naming
  - `buildRangeArchiveName` in `mapExport.ts`: first hour + frame count + `.zip`/`.pdf`
  - _Files: `frontend/src/utils/mapExport.ts`, `frontend/src/utils/mapExport.test.ts`_

- [x] 3. Add the range output module
  - `saveRangeImages`: per-hour names, direct download for one hour, lazy `fflate` ZIP (store, level 0)
  - `saveRangePdf`: lazy `jspdf`, `addPage()` after the first, `fitToPage`, JPEG quality 0.9, one `save()`
  - _Files: `frontend/src/utils/rangeOutput.ts`, `frontend/src/utils/rangeOutput.test.ts`_

- [x] 4. Wire the dialog
  - Range formats PNG/JPEG/PDF, page size/orientation for PDF in either mode, range options carry them, updated hint text
  - _Files: `frontend/src/components/MapExportDialog.tsx`, `frontend/src/components/MapExportDialog.test.tsx`_

- [x] 5. Wire `App`
  - Completed range → `saveRangePdf` or `saveRangeImages`; no per-frame downloads; "Save captured frames" builds a ZIP/single image; PDF failures recover as PNG
  - _Files: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`_

- [x] 6. Update docs
  - Range output formats, ZIP contents, PDF pagination, memory note, lazy chunks
  - _Files: `requirements.md`, `README.md`_

- [x] 7. Full check set
  - `ruff check .`, `ruff format --check .`, `pytest -q`, `python scripts/sync-ai-rules.py --check`
  - `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, `npm audit --omit=dev`
