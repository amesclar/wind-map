# Design: place chevrons at the Marine model cell (SCRUM-238)

## Overview

The Open-Meteo Marine API (MeteoFrance SMOC, cells about 6 x 9 km here) snaps every requested coordinate to its nearest sea cell and returns that cell's `latitude`/`longitude` with the value. The service threw those coordinates away and labelled the value with the requested point, so a point on a narrow island received the current of the passage beside it and a chevron was drawn on land. The fix carries the cell through parsing, caching and the response, and deduplicates by cell.

## Root cause

`backend/app/services/currents_service.py` built `CurrentPoint(latitude=lat, longitude=lon, ...)` from the requested coordinates (`_points_from`), and the cache only stored the rounded request keys. The API's per-item `latitude`/`longitude` were never read.

## Fix

1. **Value carries its cell:** a frozen `CurrentValue(latitude, longitude, velocity_knots, direction_deg)` replaces the `(velocity, direction)` tuple.
2. **Parsing:** `_fetch_current` and `_fetch_hourly` read each item's `latitude`/`longitude` (falling back to the requested point when the API omits them) and attach the cell to every value for that item.
3. **Response:** `_points_from` emits the cell's coordinates and keeps one point per cell (`(lat, lon)` rounded to 6 decimals), preserving request order.
4. **Cache:** `grid_currents_cache` gains nullable `cell_lat`/`cell_lon`; `_store` writes them and `_read_cached_points` uses them, so cached responses place chevrons identically. `SCHEMA_VERSION` goes 5 → 6; the cache tables are recreated on upgrade, the established mechanism for refetchable data.
5. **Pop-up:** it already prints `CurrentPoint.latitude`/`longitude`, so it now shows the cell without a frontend change.
6. **Settings:** `MapSettingsModal` adds the resolution note under the Water Currents toggle, always visible.

## Files

- `backend/app/models.py` (docstring: coordinates are the cell)
- `backend/app/services/currents_service.py`
- `backend/app/database.py` (schema v6, cell columns)
- `backend/tests/test_currents.py`, `backend/tests/test_database.py`
- `frontend/src/components/MapSettingsModal.tsx`, `MapSettingsModal.test.tsx`
- `requirements.md`

## Correctness properties

- P1 (2.1, 2.6): a point whose response cell differs from the request returns the cell's coordinates, and the pop-up reads them.
- P2 (2.2): two requested points with the same cell produce one `CurrentPoint`.
- P3 (2.3): a second call served from the cache returns the same cell coordinates as the first.
- P4 (2.4): null values are still absent.
- P5 (2.5): the settings note is present whether the layer is on or off.
