# SCRUM-88 Chevron Click Bug Fix Design

## Overview

When a user clicks a wind chevron on the map grid, the application correctly fetches and displays weather data for that grid point, but fails to update the TimelineDrawer header to show the clicked coordinates. Instead, it continues to display the old saved location name. This creates a confusing user experience where the timeline data doesn't match the displayed location header.

The fix involves clearing the `selectedLocation` state when a chevron is clicked, ensuring the TimelineDrawer header displays the grid point coordinates, and enabling the "Save Location" button for ephemeral chevron-clicked locations (where `location_id === 0`).

## Glossary

- **Bug_Condition (C)**: The condition where clicking a wind chevron updates `selectedWeather` but doesn't clear `selectedLocation`, causing the TimelineDrawer header to show the old saved location name
- **Property (P)**: When a chevron is clicked, the TimelineDrawer header should display the clicked coordinates (latitude, longitude) instead of any saved location name, and the "Save Location" button should be enabled
- **Preservation**: Existing behavior for saved locations - clicking a saved location marker or selecting from the modal should continue to show the saved location name and keep the "Save Location" button disabled
- **selectedLocation**: State variable storing the currently selected saved location (or null if a grid point is selected)
- **selectedGridPoint**: State variable storing the currently selected grid point (ephemeral, cleared when a saved location is selected)
- **location_id === 0**: Indicator that the weather data came from a grid point click (not a saved location)
- **handleChevronClick**: Function in App.tsx that fetches weather for a grid point and updates state

## Bug Details

### Bug Condition

The bug manifests when a user clicks a wind chevron on the map grid. The `handleChevronClick` function correctly:
1. Sets `selectedGridPoint` to the clicked coordinates
2. Fetches weather data via `fetchPointWeather`
3. Updates `selectedWeather` with the new weather data

However, it does NOT clear `selectedLocation`, which causes the TimelineDrawer header to display the stale saved location name instead of the clicked coordinates.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type GridWindPoint (from chevron click)
  OUTPUT: boolean
  
  RETURN selectedGridPoint IS SET
         AND selectedWeather HAS BEEN UPDATED
         AND selectedLocation IS NOT CLEARED
         AND TimelineDrawer.header.text != input.coordinates
END FUNCTION
```

### Examples

- **Example 1 (Bug Manifestation)**:
  - User has Oak Harbor (48.2939° N, 122.6064° W) selected as saved location
  - TimelineDrawer header shows: "Oak Harbor, WA • 48.29°, -122.61°"
  - User clicks a wind chevron at coordinates (48.78° N, 121.94° W)
  - Expected: TimelineDrawer header should show "48.78°N, 121.94°W"
  - Actual: TimelineDrawer header still shows "Oak Harbor, WA • 48.29°, -122.61°"
  - Weather data shown is correct (grid point data), but header is wrong

- **Example 2 (Correct Behavior After Fix)**:
  - User clicks a wind chevron at (48.78° N, 121.94° W)
  - TimelineDrawer header should show: "48.78°N, 121.94°W"
  - "Save Location" button should be enabled (because location_id === 0)
  - User can click "Save Location" to save this grid point as a new saved location

- **Edge Case (Preservation)**:
  - User clicks a saved location marker (not a chevron)
  - TimelineDrawer header should show the saved location name (e.g., "Oak Harbor, WA")
  - "Save Location" button should remain disabled (location_id !== 0)
  - selectedLocation should be set to the clicked saved location
  - selectedGridPoint should be cleared

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Clicking a saved location marker should continue to set `selectedLocation` and display the saved location name in the header
- Clicking a saved location in the modal should continue to display the saved location name
- The "Save Location" button should remain disabled when viewing saved locations (location_id !== 0)
- The TimelineDrawer should continue to show saved location details (name, coordinates) when a saved location is selected
- All existing functionality for saved locations must be completely preserved

**Scope:**
The fix should ONLY affect behaviors when a grid point (chevron) is clicked. All saved location interactions must work exactly as before.

## Hypothesized Root Cause

Based on the code analysis:

1. **Incorrect State Management in handleChevronClick**: The function sets `selectedGridPoint` but does NOT clear `selectedLocation`. This causes the TimelineDrawer header to prefer `selectedLocation?.name` over `weatherData?.location_name`.

2. **TimelineDrawer Header Logic**: The header uses `selectedLocation?.name || weatherData?.location_name`, which will always prefer `selectedLocation` if it's not null, even after a chevron click.

3. **Save Location Button Logic**: The "Save Location" button likely checks if `selectedLocation !== null` to determine if it should be enabled. When a chevron is clicked, `selectedLocation` remains set, so the button appears disabled even though the user is viewing a grid point that could be saved.

4. **Drawer Expansion Logic**: The automatic expansion on `weatherData?.location_id` may not trigger correctly because `selectedLocation` still has a value, causing the drawer to think a valid location selection exists.

## Correctness Properties

Property 1: Chevron Click Behavior

_For any_ grid point click, the fixed `handleChevronClick` function SHALL clear `selectedLocation`, set `selectedGridPoint`, fetch weather data, update `selectedWeather`, and enable the "Save Location" button when `weatherData.location_id === 0`.

**Validates: Requirements 2.1, 2.2**

Property 2: Saved Location Preservation

_For any_ saved location click (marker or modal selection), the fixed code SHALL set `selectedLocation`, clear `selectedGridPoint`, display the saved location name in the TimelineDrawer header, and keep the "Save Location" button disabled.

**Validates: Requirements 3.1, 3.2, 3.3**

## Fix Implementation

### Changes Required

**Assumption**: The root cause analysis is correct - we need to clear `selectedLocation` when handling chevron clicks.

**File**: `/Users/fredames/Projects/wind-map/frontend/src/App.tsx`

**Function**: `handleChevronClick`

**Specific Changes**:

1. **Clear selectedLocation in handleChevronClick**:
   - Add `setSelectedLocation(null)` before or after setting `selectedGridPoint`
   - This ensures the TimelineDrawer header uses `weatherData?.location_name` instead of `selectedLocation?.name`

2. **TimelineDrawer Header Logic Update** (if needed):
   - The current logic `selectedLocation?.name || weatherData?.location_name` is correct
   - No changes needed here if `selectedLocation` is properly cleared

3. **TimelineDrawer Expansion Logic**:
   - The existing `useEffect` that expands drawer on `weatherData` change should work correctly
   - Verify it triggers when weatherData changes (it uses `weatherData?.location_id, weatherData?.latitude, weatherData?.longitude` as dependencies)

4. **"Save Location" Button Logic** (likely in SavedLocationsModal or TimelineDrawer):
   - The button should be enabled when `weatherData?.location_id === 0` (grid point)
   - The button should be disabled when `weatherData?.location_id !== 0` (saved location)
   - Add a new prop or update logic to check `weatherData.location_id === 0`

**File**: `/Users/fredames/Projects/wind-map/frontend/src/components/TimelineDrawer.tsx`

**Function**: TimelineDrawer component

**Specific Changes**:

1. **Pass weatherData to determine Save Location button state**:
   - Add logic to enable "Save Location" button when `weatherData?.location_id === 0`
   - This indicates the current view is a grid point (chevron click)
   - Saved locations have `location_id !== 0`

**File**: `/Users/fredames/Projects/wind-map/frontend/src/components/SavedLocationsModal.tsx`

**Function**: Modal component (may need updates)

**Specific Changes**:

1. **Update Save Location button logic** (if button is in modal):
   - Ensure button is enabled when viewing grid point (location_id === 0)
   - Ensure button is disabled when viewing saved location (location_id !== 0)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach:
1. First, verify the bug exists on the unfixed code
2. Then, verify the fix works correctly and preserves existing behavior

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples demonstrating the bug BEFORE implementing the fix.

**Test Plan**: Write tests that simulate clicking a wind chevron and assert the TimelineDrawer header displays the correct coordinates.

**Test Cases**:
1. **Chevron Click Test** (will fail on unfixed code): Click a chevron and verify header shows grid point coordinates instead of saved location name
2. **Saved Location Test** (will pass on both): Click a saved location and verify header shows saved location name
3. **Location ID Test** (will fail on unfixed code): Verify "Save Location" button is enabled when location_id === 0
4. **Preservation Test** (will pass on both): Verify "Save Location" button is disabled when location_id !== 0

**Expected Counterexamples**:
- TimelineDrawer header shows "Oak Harbor, WA" after clicking a chevron at (48.78° N, 121.94° W)
- "Save Location" button remains disabled after clicking a grid point (location_id === 0)

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (chevron clicks), the fixed function produces the expected behavior.

**Pseudocode**:
```
FOR ALL gridPoint WHERE chevronClick(gridPoint) DO
  result := handleChevronClick(gridPoint)
  ASSERT selectedLocation === null
  ASSERT selectedGridPoint.latitude === gridPoint.latitude
  ASSERT selectedGridPoint.longitude === gridPoint.longitude
  ASSERT selectedWeather.location_id === 0
  ASSERT TimelineDrawer.header.text === gridPoint.coordinates
  ASSERT saveLocationButton.enabled === true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (saved location clicks), the fixed function preserves existing behavior.

**Pseudocode**:
```
FOR ALL savedLocation WHERE locationClick(savedLocation) DO
  result := handleSelectLocation(savedLocation)
  ASSERT selectedLocation === savedLocation
  ASSERT selectedGridPoint === null
  ASSERT selectedWeather.location_id !== 0
  ASSERT TimelineDrawer.header.text === savedLocation.name
  ASSERT saveLocationButton.enabled === false
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that saved location behavior is unchanged

### Unit Tests

**File**: `/Users/fredames/Projects/wind-map/frontend/src/App.test.tsx`

**Test Cases**:
1. **Chevron click clears selectedLocation**: Verify `selectedLocation` becomes null after chevron click
2. **Chevron click sets selectedGridPoint**: Verify `selectedGridPoint` contains clicked coordinates
3. **TimelineDrawer header shows coordinates after chevron click**: Verify the drawer shows "48.78°N, 121.94°W" instead of saved location name
4. **Save Location button enabled for grid point**: Verify button is enabled when `weatherData.location_id === 0`

**File**: `/Users/fredames/Projects/wind-map/frontend/src/components/TimelineDrawer.test.tsx`

**Test Cases**:
1. **Header displays coordinates when location_id is 0**: Render with `weatherData.location_id === 0` and verify header shows coordinates
2. **Header displays name when selectedLocation is set**: Render with both `selectedLocation` and `weatherData`, verify name takes precedence
3. **Expansion triggers on weatherData change**: Verify drawer expands when weatherData changes (including grid point clicks)

### Property-Based Tests

**File**: `/Users/fredames/Projects/wind-map/frontend/src/App.test.tsx` or new PBT file

**Test Cases**:
1. **Chevron Click Property**: For any random grid point, `handleChevronClick` should clear `selectedLocation` and set `selectedGridPoint`
2. **Saved Location Property**: For any random saved location, `handleSelectLocation` should set `selectedLocation` and clear `selectedGridPoint`
3. **Header Display Property**: TimelineDrawer header should show coordinates when `weatherData.location_id === 0`, show name otherwise
4. **Save Button Property**: "Save Location" button should be enabled when `weatherData.location_id === 0`, disabled otherwise

### Integration Tests

**File**: `/Users/fredames/Projects/wind-map/frontend/src/App.test.tsx`

**Test Cases**:
1. **Full Chevron Click Flow**: Open app, click a grid chevron, verify drawer shows grid coordinates and Save button is enabled
2. **Saved Location Flow**: Open app, verify saved location is selected, verify header shows saved name and Save button is disabled
3. **Switch Between Chevron and Saved Location**: Click a chevron, verify grid coordinates; click a saved location, verify saved name returns; verify Save button state toggles appropriately
4. **Save Location from Chevron**: Click a chevron, verify Save button is enabled, simulate clicking Save, verify new location is added to list

## Additional Root Cause: Point Forecast Cache Collision

### Bug Condition

```
FUNCTION isBugCondition(input)
  INPUT: input of type PointWeatherRequest (lat, lon, model)
  OUTPUT: boolean

  RETURN input.location_id = 0
         AND weather_cache HAS fresh row for (0, input.model)
         AND that row was stored for a different (lat, lon)
END FUNCTION
```

`get_weather()` in `backend/app/services/weather_service.py` caches in `weather_cache` keyed by `(location_id, model)`. `/api/weather/point` (`backend/app/routers/weather.py`) always passes `location_id=0`, so every chevron after the first receives the first point's payload (name, lat/lon, forecast) for the 30-minute TTL. The stale row also persists in the `wind_data` Docker volume.

### Fix Approach

- When `location_id == 0`, use a separate `point_weather_cache` table keyed by `(lat_key, lon_key, model)`, with lat/lon rounded to 2 decimals. Follow the `grid_weather_cache` pattern: `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT` upsert, and `CACHE_TTL_SECONDS`.
- The saved-location path (`location_id != 0`) keeps using `weather_cache` unchanged. Old `(0, model)` rows are no longer read; no data is deleted.

### Expected Behavior

- Distinct points return their own `location_name`, latitude, longitude, and forecast.
- A repeated request for the same rounded point within the TTL returns `cached=True`.
- Saved-location caching is unchanged.

### Testing

pytest tests in `backend/tests/test_weather.py` with Open-Meteo `httpx` mocked and a temporary SQLite database:
1. Two different points return different `location_name`/lat/lon.
2. The same point requested twice: the second response has `cached=True`.
3. Saved-location caching still works.
