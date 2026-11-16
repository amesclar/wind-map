# Implementation Plan

## Overview

This task list addresses SCRUM-88: Chevron click bug fix. The bug occurs when clicking a wind grid point chevron on the map - the timeline drawer retains the `selectedLocation` state, causing the header to display the wrong name instead of the weather data's location name.

## Tasks

- [x] 1. Update `handleChevronClick` in `App.tsx` to clear `selectedLocation` when a chevron is clicked
  - Add `setSelectedLocation(null)` before `setSelectedWeather` in `handleChevronClick`
  - This ensures the drawer header shows `weatherData.location_name` instead of `selectedLocation?.name`
  - _Requirements: Bug Fix - Chevron click should not retain saved location state_
  - _Files to modify: `frontend/src/App.tsx` (lines 218-230)_

- [x] 2. Enable "Save Location" button for chevron-clicked locations
  - In `TimelineDrawer.tsx`, modify the `isSaveLocationDisabled` logic (if it exists)
  - Check `weatherData.location_id === 0` to enable saving for grid points (chevron clicks)
  - _Requirements: Bug Fix - Save Location button should work for ephemeral grid points_
  - _Files to modify: `frontend/src/components/TimelineDrawer.tsx`_

- [x] 3. Add unit test for chevron click behavior
  - Test that clicking a chevron calls `setSelectedWeather` with point weather data
  - Test that `selectedLocation` is cleared (set to null) when chevron is clicked
  - Test that drawer header shows coordinates after click instead of saved location name
  - _Files to modify: `frontend/src/App.test.tsx` or create new test file_
  - _Test file: `frontend/src/components/MapSettingsModal.test.tsx` (reference pattern)_

- [x] 4. Add regression test for saved location behavior
  - Test that explicitly saved locations still work correctly
  - Test that drawer shows saved location name for saved locations (not coordinates)
  - Test that `selectedLocation` is NOT cleared when selecting a saved location
  - Verify no regression in existing functionality after chevron fix
  - _Files to modify: `frontend/src/App.test.tsx` or create new test file_

- [x] 5. Run verification
  - Run `npm run test -- --run` for frontend tests
  - Run `pytest` for backend tests
  - Confirm all tests pass before marking complete
  - _Verification commands:_
    ```bash
    # Frontend tests
    cd frontend && npm run test -- --run
    
    # Backend tests
    pytest
    ```

- [x] 6. Cache point forecasts by coordinates instead of location_id
  - When `location_id == 0`, use a separate `point_weather_cache` table keyed by `(lat_key, lon_key, model)`, with lat/lon rounded to 2 decimals, same pattern as `grid_weather_cache` (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT` upsert, `CACHE_TTL_SECONDS`)
  - Saved-location caching path unchanged; old `(0, model)` `weather_cache` rows are simply no longer read (no data deletion)
  - Add pytest tests (Open-Meteo httpx mocked, temp SQLite): two different points return different `location_name`/lat/lon; same point twice gives `cached=True` on the second call; saved-location caching still works
  - Update root `requirements.md`
  - Run `pytest` and `cd frontend && npm run test -- --run` (both must exit 0)
  - Rebuild and restart the wind-map container, then verify two different `/api/weather/point` requests return different `location_name`
  - _Requirements: 1.7, 2.7, 3.6_
  - _Files: `backend/app/services/weather_service.py`, `backend/tests/test_weather.py`, `requirements.md`_

## Notes

- The bug affects the interaction between saved locations and ephemeral grid point selection
- Tasks 3 and 4 should ensure the fix doesn't break existing saved location functionality
- All tests must pass before marking the task complete per quality-gates policy
