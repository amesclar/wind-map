# SCRUM-332 — Design

## Planner

`planExportTimes({ times, windowStart, windowEnd, tilesPerFrame }, timezone)` replaces
`planExportRange`. It de-duplicates and sorts first, so the frames always run forward, then applies the
same four refusals in the same order the old planner used — nothing chosen, not a whole hour, outside
the window, too many captures, too many tiles — with the cap checked before the budget because it is
the one the user can fix by unticking. `formatTimesSummary` lists up to four labels and elides the
rest; `formatRangeSummary` and `timeRangeHours` are gone with the interval picker.

`RANGE_PACE_MS = 750` lives here too, beside `EXPORT_TILE_BUDGET`, because both are limits on what one
export is allowed to ask a provider for.

## Dialog

`ExportTimesFields` (formerly `ExportRangeFields`) is a scrollable list of checkboxes labelled with
`formatStepLabel`, plus All/None and "`n` of `m` chosen · frames are paced at least 750 ms apart". The
dialog keeps `selectedTimes` and derives `chosenTimes` by filtering against the current window, so a
window that shifts under an open dialog cannot plan a frame outside it. The state resets to the first
three times on each opening, as the old range fields did.

`hours: plan.times` keeps the `MapExportRangeOptions` field name: these are still hour instants, and
renaming it would have touched the output naming and its tests for no behaviour.

## Loop

`RangeCaptureDeps.paceMs` is optional, defaulting to 0 so every existing test keeps its timing. The
wait sits after a frame's `onProgress`, is skipped after the last frame, and re-checks the abort
signal when it ends — a cancel during the gap returns `cancelled` with the frames so far and saves
nothing. `useMapExport` passes `RANGE_PACE_MS`.
