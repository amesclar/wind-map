# Bugfix: missing model values shown as calm wind and 32 °F (SCRUM-225)

## 1. Current Behavior (Defect)

1.1 WHEN Open-Meteo returns `null` for a grid point's wind speed, wind direction or temperature THEN the backend stores `0` knots, `0°` and `32 °F`, and the map draws a calm-looking barb and colors the gradient as a dead calm.
1.2 WHEN Open-Meteo returns `null` for a forecast point's wind speed, gust, direction or temperature THEN the response carries `0` in every unit and `32 °F`, and the location drawer and marker pop-ups display them as real values.
1.3 WHEN a whole grid or forecast frame consists of `null` values THEN it is cached like a good frame, so a temporary upstream gap keeps being served as calm wind for the cache TTL.

## 2. Expected Behavior (Correct)

2.1 WHEN Open-Meteo returns `null` for a grid point's wind speed, direction or temperature THEN the backend shall return `null` for `wind_speed_knots`, `wind_direction_deg` and `temperature_f` on that point, never `0` or `32`.
2.2 WHEN a grid point has no speed or no direction THEN the barb layer shall draw no barb for it and the color gradient shall leave it (and the cells interpolated through it) unpainted.
2.3 WHEN a grid point or forecast point has a missing value THEN its pop-up shall show "No data" instead of a number.
2.4 WHEN every grid point in the view has no wind data and a wind layer is visible THEN the map shall show a notice naming the selected model.
2.5 WHEN a fetched grid frame or forecast frame contains no wind value at all THEN the backend shall not cache it, so the next request retries the upstream source.
2.6 WHEN a saved-location forecast has no wind data THEN its marker shall show a no-data marker instead of a wind barb, and its pop-up shall read "No data".

## 3. Unchanged Behavior (Regression Prevention)

3.1 WHEN Open-Meteo returns values THEN grid and forecast responses shall keep their current shapes, units and rounding.
3.2 WHEN a point has a speed and direction but no temperature THEN the barb shall keep drawing with the fallback color (SCRUM-126).
3.3 WHEN a gust is missing THEN `wind_gust_knots` shall stay `null` and the pop-up shall leave the gust out, as before (SCRUM-210).
3.4 WHEN a frame has data THEN the existing grid and forecast caches shall keep serving it from SQLite.
3.5 WHEN the map has wind data THEN no no-data notice shall appear and all existing layers, labels and exports shall look the same.
