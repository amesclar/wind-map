# Bugfix: the app opens with a location details pop-up (SCRUM-248)

## 1. Current Behavior (Defect)

1.1 WHEN the app loads and geolocation resolves THEN startup adds "My Current Location", selects it, and `MapView` flies there and calls `openPopup()`, so the details pop-up is on screen before the user has chosen anything.
1.2 WHEN geolocation is unavailable THEN startup selects the first saved location, so its pop-up opens on every load and reload.
1.3 WHEN the selected location is deleted THEN the first remaining location becomes selected, which under the same path opens a pop-up the user did not ask for.

## 2. Expected Behavior (Correct)

2.1 WHEN the app loads and geolocation resolves THEN the map shall centre on the user's position with no marker selected, no highlight ring and no pop-up.
2.2 WHEN geolocation is unavailable THEN the map shall centre on the first saved location, still with no selection and no pop-up.
2.3 WHEN the user clicks a grid barb, clicks a saved-location marker, chooses a location in the saved-locations list or adds one from the search box THEN that location's pop-up shall open and its marker shall be highlighted exactly as before.
2.4 WHEN the selected location is deleted THEN the selection shall be cleared: no marker is highlighted and no other location's pop-up opens.
2.5 WHEN the startup focus flies THEN it shall keep the zoom rule: 9, or `CHART_MIN_ZOOM` when the paper chart is the base.
2.6 WHEN the Leaflet map is created before geolocation resolves THEN the flight to the focus shall still move it to the user's position.

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN the app starts THEN it shall still load config, models and saved locations before resolving the position, and still add "My Current Location" on a first run.
3.2 WHEN the user selects a location THEN the map shall still fly to it at the same zoom and open its pop-up.
3.3 WHEN the leaflet map has no selection THEN its initial centre shall still fall back to the default centre (Oak Harbor).
3.4 WHEN an image or a range is exported THEN the capture shall be unchanged.
3.5 WHEN a barb is clicked THEN its own pop-up shall still open from the grid response already on the map, with no extra request.
