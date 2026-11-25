# Design: SCRUM-248 — open without a details pop-up

## Overview

The startup path in `App.tsx` uses one state value, `selection`, for two different jobs: where the map should look and what the user has chosen. Startup needs only the first. Split them: a new `focus` value carries the startup target, and `selection` stays `null` until the user acts. `MapView` flies to whichever of the two exists and opens a pop-up only for a selection.

## Root cause

- `App.tsx` startup calls `setSelection({ kind: 'saved', location })` for the geolocation result, the first saved location, or the fallback after a failed add.
- `MapView.tsx`'s effect on `[selectedLocation, chartBaseRef]` calls `map.flyTo(...)` and then `markersRef.current.get(selectedLocation.id)?.marker.openPopup()`. That single effect makes startup open the pop-up, and the selected marker is also drawn with the highlight ring.

## Approach

1. `App.tsx` gains `focus: SavedLocation | null`.
   - Startup sets `focus` instead of `selection` on all three paths (position resolved, position unavailable, add failed).
   - `selectSaved` and `handleGridPointSelect` clear `focus`, so a user action always owns the map from then on.
   - `handleDeleteLocation` calls `setSelection(null)` instead of selecting the first remaining location, and clears `focus` when it points at the deleted id.
2. `MapView.tsx` accepts `focusLocation` and its fly effect uses `selectedLocation ?? focusLocation`. It opens a pop-up only when `selectedLocation` is set. The zoom rule (`CHART_MIN_ZOOM` on the paper chart, otherwise 9) and the 1.2 s flight are unchanged, so the map still lands on the user's position.
3. No backend, storage or export change: no selection is persisted, so a reload always starts unselected.

## Correctness properties

- P1 (2.1, 2.2, 2.6): a non-null `focusLocation` with no selection calls `flyTo` at the focus and never `openPopup`.
- P2 (2.3, 3.2): a non-null selection calls both `flyTo` and `openPopup`.
- P3 (2.4): deleting the selected location leaves `selection` and `focus` null, so no marker is highlighted and no pop-up opens.
- P4 (2.5): the flight zoom is `CHART_MIN_ZOOM` exactly when the paper chart is the base.

## Files

- `frontend/src/App.tsx` — `focus` state, startup, `selectSaved`, `handleGridPointSelect`, `handleDeleteLocation`, `MapView` prop.
- `frontend/src/components/MapView.tsx` — `focusLocation` prop and the combined fly effect.
- `frontend/src/App.test.tsx`, `frontend/src/components/MapView.test.tsx` — startup focus, selection, deletion.
- `requirements.md` — opening behaviour.
