# Bugfix Requirements Document

## Introduction

Fix wind chevron click functionality that updates the selected chevron icon (shows diamond) but does NOT update the timeline drawer data. The drawer continues showing "My Current Location" with the original saved location's lat/long instead of the clicked chevron's coordinates and forecast data.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN user clicks a wind chevron on the map THEN the system highlights the chevron with a diamond indicator
1.2 WHEN user clicks a wind chevron on the map THEN the system fetches point weather data from `/api/weather/point` endpoint successfully
1.3 WHEN user clicks a wind chevron on the map THEN the system calls `setSelectedWeather` with the correct forecast data
1.4 WHEN user clicks a wind chevron on the map THEN the system does NOT update the timeline drawer to show the clicked location's weather data
1.5 WHEN user clicks a wind chevron on the map THEN the system does NOT clear or update the `selectedLocation` state
1.6 WHEN user clicks a wind chevron on the map THEN the timeline drawer header continues displaying the original saved location name (e.g., "My Current Location") instead of the clicked coordinates

### Expected Behavior (Correct)

2.1 WHEN user clicks a wind chevron on the map THEN the system shall highlight the chevron with a diamond indicator
2.2 WHEN user clicks a wind chevron on the map THEN the system shall fetch point weather data from `/api/weather/point` endpoint successfully
2.3 WHEN user clicks a wind chevron on the map THEN the system shall update the timeline drawer to show the clicked location's weather data
2.4 WHEN user clicks a wind chevron on the map THEN the system shall clear the saved location selection (`selectedLocation` becomes null)
2.5 WHEN user clicks a wind chevron on the map THEN the timeline drawer header shall display the clicked coordinates in format "lat°N/lat°S, lon°W/lon°E"
2.6 WHEN user clicks a wind chevron on the map THEN the system shall enable the "Save Location" button to allow users to name and save the clicked location

### Unchanged Behavior (Regression Prevention)

3.1 WHEN user selects a saved location from the locations modal THEN the system shall clear any ephemeral chevron selection (`selectedGridPoint` becomes null)
3.2 WHEN user selects a saved location from the locations modal THEN the system shall display the saved location's name and coordinates in the timeline drawer header
3.3 WHEN user clicks a wind chevron that is already selected THEN the system shall continue to show the chevron's weather data (no unintended reset)
3.4 WHEN user clicks a wind chevron and THEN saves the location THEN the system shall add the location to saved locations with the user-provided name
3.5 WHEN saved locations exist AND no chevron is selected THEN the system shall display weather data for the first saved location on initial load

### Additional Root Cause: Point Forecast Cache Keyed by location_id

`get_weather()` in `backend/app/services/weather_service.py` caches in `weather_cache` keyed by `(location_id, model)`. `/api/weather/point` always passes `location_id=0`, so every chevron after the first receives the first point's cached payload (name, lat/lon, forecast) for the 30-minute TTL. The row also persists in the `wind_data` Docker volume.

#### Current Behavior (Defect)

1.7 WHEN user clicks a second, different wind chevron within the cache TTL THEN the system returns the first point's cached location name, coordinates, and forecast from `/api/weather/point` instead of the clicked point's data

#### Expected Behavior (Correct)

2.7 WHEN `/api/weather/point` is requested for distinct points THEN the system shall return each point's own location name, coordinates, and forecast, AND a repeated request for the same point (lat/lon rounded to 2 decimals) within the TTL shall be served from cache (`cached=True`)

#### Unchanged Behavior (Regression Prevention)

3.6 WHEN weather is requested for a saved location (`location_id != 0`) THEN the system shall continue to cache it in `weather_cache` keyed by `(location_id, model)` exactly as before
