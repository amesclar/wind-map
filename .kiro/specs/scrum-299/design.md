# SCRUM-299 — Design

## Overview

The range plan is already a pure function with its tests, so the budget goes there: a new input
(`tilesPerFrame`), a new exported constant and helper, and one more refusal next to the capture cap.
The impure part — measuring the map — sits in `useMapExport`, which already holds the container ref.

## What changes

| File | Change |
| --- | --- |
| `frontend/src/utils/exportRange.ts` | `EXPORT_TILE_BUDGET = 3_000`, `BASE_TILE_SIZE_PX = 256`, `tilesForViewport(width, height)`, and `tilesPerFrame?` on `ExportRangeInput`; `planExportRange` refuses a range whose `hours.length * tilesPerFrame` exceeds the budget. |
| `frontend/src/hooks/useMapExport.ts` | `viewportTiles` state, measured from `mapContainerRef` when the dialog opens and again on `resize`, returned for the dialog. |
| `frontend/src/components/MapExportDialog.tsx` | New optional `viewportTiles` prop, passed through to the plan and added to its memo dependencies. |
| `frontend/src/App.tsx` | Passes `mapExport.viewportTiles`. |
| `requirements.md` | The range-mode bullet records the budget. |

## Why 3,000, and why CSS pixels

3,000 is the smallest published per-download cap among the providers priced in SCRUM-330
(OpenFreeMap's terms), so the constant is anchored to a real provider number rather than invented.
At 1920 × 1080 a frame is 8 × 5 = 40 tiles, so the 24-capture cap (960 tiles) binds long before the
budget and nothing changes for the normal case; at 3840 × 2160 a frame is 15 × 9 = 135 tiles and the
budget holds a full day to 22 captures (2,970 tiles).

The count is taken from the map's **CSS** size, not its device pixel ratio, because that is what
decides how many 256 px tiles Leaflet asks for: a 3840-pixel-wide window is 15 tiles wide whatever
the display's density. Counting device pixels would refuse exports the provider never sees.

## Correctness properties

1. `tilesForViewport(1920, 1080) === 40` and `tilesForViewport(3840, 2160) === 135`; any zero or
   negative side returns 0, which skips the check (1.1, 1.2).
2. 24 captures × 125 tiles = 3,000 is accepted; × 126 = 3,024 is refused (2.2, 2.1).
3. A refusal returns the hours with the message, as the capture cap already does, so the dialog can
   still show the plan behind the error.
4. The capture cap is checked first, so a 49-capture 4K range reports "Too many captures" (3.1).
5. With no `tilesPerFrame` (0 or absent) the plan is byte-identical to before (3.2, 3.3).

## Testing

- `frontend/src/utils/exportRange.test.ts`: the helper's arithmetic and rounding, 1080p accepted,
  4K refused with the exact message, the boundary at 3,000, the unknown-size skip, and the capture
  cap winning over the budget.
- `frontend/src/components/MapExportDialog.test.tsx`: a full-day range is refused at 135 tiles a
  frame (message shown, Export disabled) and accepted at 40 with the same hours.
