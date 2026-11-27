# SCRUM-332 — Tasks

- [x] `exportRange.ts`: `planExportTimes`, `formatTimesSummary`, `RANGE_PACE_MS`; drop the interval
      planner and its helpers.
- [x] `ExportTimesFields.tsx` (checkbox list, All/None, count and pace note); delete the old fields.
- [x] `MapExportDialog`: `selectedTimes` state, window-filtered chosen times, new plan and props.
- [x] `rangeCapture`: `paceMs` gap between frames, skipped after the last and abort-aware.
- [x] `useMapExport` passes `RANGE_PACE_MS`.
- [x] Tests: planner (order, de-duplication, refusals, cap, budget boundary), pacing with fake timers
      including a cancel mid-gap, dialog (ticking, gaps, All/None, empty selection, cap, 4K budget), and
      the App range wiring with timeouts that allow the pace.
- [x] `requirements.md`.
