# SCRUM-155 Export range design

## Overview

The export dialog gains a Range mode beside the existing single-view export. The range is planned by a pure helper, then the existing on-screen Leaflet map is moved hour by hour and captured once per hour. Frames stay in memory until the run completes, so a cancel or failure never leaves partial downloads behind.

## Decision: on-screen map, not a second instance

An off-screen map would need its own tile layer, grid hook, markers and sizing inside the export dialog, duplicating `MapView` and its readiness. Moving the on-screen map instead reuses the exact tiles, barbs, colours and markers the user sees, and restoring `validTime` in a `finally` is enough to put the app back where it was. The ticket allows either; this keeps the change to the export path.

The loop waits for an explicit readiness signal rather than a fixed delay: `useWindGrid` reports the hour and points of every response it accepts, and `App` polls that report until it matches the hour it just selected. Only then does it wait for `waitForTiles` (bounded 5 s) and capture.

## Architecture

- `frontend/src/utils/exportRange.ts` — pure planning: `timeRangeHours`, `isHourAligned`, `planExportRange` (validation, 24-capture cap, summary line) and the interval list.
- `frontend/src/utils/rangeCapture.ts` — `captureRange(hours, deps)`: sets each hour, waits for the frame, captures, reports progress, honours an `AbortSignal`, and wraps failures in `RangeCaptureError` carrying the hour and the frames captured so far. All I/O (set hour, wait, capture) is injected, so the loop is tested without Leaflet or canvas.
- `frontend/src/utils/captureMap.ts` — `downloadCanvas(canvas, fileName, options)` extracted from `saveMapImage`, so the range sink can save an already-composed canvas (one capture per hour, no re-capture after the hour has been restored).
- `frontend/src/components/MapExportDialog.tsx` — mode switch, start/end/interval selects, summary and validation message, progress with Cancel, failure message with "Save captured frames", and range file naming.
- `frontend/src/App.tsx` — range export orchestration: builds the per-hour `CaptureContent` (its own header and file name), drives the loop, saves frames one at a time on success, restores `forecastTime` in `finally`, and exposes cancel and save-captured.
- `frontend/src/hooks/useWindGrid.ts` / `components/MapView.tsx` — optional `onLoaded` report with `{ validTime, points }` for the readiness signal.

## Correctness properties

1. For any valid range, `captureRange` calls `capture` exactly once per hour returned by `timeRangeHours`, in order, with that hour selected first. (Requirements 3, 6)
2. For any run, cancel or failure, `App` restores the previous `forecastTime`, and never restores it early. (Requirements 3, 4)
3. For any invalid range, `planExportRange` returns `ok: false` with a message and the dialog keeps Export disabled. (Requirement 2)
4. For any failure, no file is downloaded until the user asks to save the frames captured so far, and the message names the hour. (Requirement 4)
5. For any success, the downloaded files are one per hour, each named after the hour it shows, in PNG or JPEG. (Requirements 3, 5)

## File naming

Range frames ignore the editable single-view name: each frame is named from its own hour with `buildExportFileName({ validTime: hour, timezone, extension })`, which is also what the header shows. The dialog hides the File name field in Range mode and explains that ZIP and multi-page PDF are SCRUM-156.

## Failure and edge cases

- Grid readiness deadline: 15 s per hour, then `RangeCaptureError` naming the hour.
- Tiles: the existing 5 s `waitForTiles` deadline applies after the grid is ready.
- Cancel requested during a wait stops before the next capture; requested during a capture stops after that frame and discards all frames (nothing downloads).
- The current hour is requested as an explicit ISO hour (never `null`), so the readiness signal can match it.
- Multiple downloads may be blocked by the browser; the dialog and README note this is temporary until SCRUM-156.
