# Design: SCRUM-251

## Root cause

Leaflet opens a marker pop-up with `autoPan: true`. Near a viewport edge it calls
`map.fire('autopanstart')` and pans the map, then `moveend` fires. `useWindGrid` listens to
`moveend` and refetches the grid for the new bounds; `WindOverlay`'s marker effect depends on
`points`, so its cleanup removes the clicked marker (and with it the open pop-up) and builds new
ones. The click therefore looks like it flashes a pop-up and closes it.

## Fix

In `frontend/src/hooks/useWindGrid.ts`:

- Track an `autoPanning` flag. `autopanstart` sets it; the next `moveend` consumes it and returns
  without calling `refresh()`.
- `dragstart` clears the flag, so an `autopanstart` that produced no `moveend` cannot swallow the
  next user pan.
- `zoomend` clears the flag and always refreshes.
- Remove all four listeners on teardown, as before.

The grid data for the few dozen pixels of auto-pan is stale until the next pan, zoom or hour
change. That is acceptable: the alternative, keeping markers keyed across grid replacements,
does not help because the auto-panned grid usually contains different coordinates anyway.

## Correctness

- 2.1/2.2: no `refresh()` means `points` identity is unchanged, so the marker effect does not run
  and the pop-up stays open; Leaflet's pan is untouched.
- 2.3/3.1: `dragstart`, `zoomend`, a later `moveend` and a later view key change all refresh.
- 3.2: the existing `lastKey` guard still prevents duplicate requests.
- 3.3: no change to the overlay, pop-up builders or the tide block.

## Files

- `frontend/src/hooks/useWindGrid.ts`
- `frontend/src/hooks/useWindGrid.test.ts`
- `requirements.md` (grid refresh note)
