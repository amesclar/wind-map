# Design: no fabricated values for missing model data (SCRUM-225)

## Overview

Open-Meteo omits values it has none of. The parsers turned every omission into a number (`as_float(None) == 0`, `c_to_f(None) == 32`) because the response models required floats. On a marine map that reads as a dead calm: the most dangerous wrong answer. The fix makes absence explicit end to end: nullable models, parsing that keeps `None`/`null`, cache writes that skip all-missing frames, and a frontend that skips missing points instead of drawing them and writes "No data" wherever a value would be shown.

## Root cause

- `backend/app/services/grid_weather_service.py` (`_point_from_current`, `_point_from_hourly`) used `as_float` / `c_to_f`, so `None` became `0.0` / `32.0`.
- `backend/app/services/forecast_parser.py` (`build_weather_point`) did the same for every forecast field.
- `backend/app/models.py` required `float` on `GridWindPoint` and `WeatherForecastPoint`, so there was nowhere to put the absence.
- The frontend treated every grid point as drawable and every value as a number.

## Fix

1. **Models** (`backend/app/models.py`): `GridWindPoint.wind_speed_knots` and `wind_direction_deg` become `float | None`; every wind and temperature field of `WeatherForecastPoint` becomes nullable (humidity and weather code are unchanged).
2. **Parsing** (`backend/app/units.py`, `forecast_parser.py`): `c_to_f(None)` returns `None`; `knots_to_units(None)` returns `None` in every unit; `wind_direction_cardinal` is `None` when the direction is.
3. **Grid points** (`grid_weather_service.py`): one helper builds a point; a missing speed, direction or temperature nulls all three together, so no consumer can pair a real speed with a fabricated temperature. `_store_points` skips no-data points, and since `_read_cached_points` only reads rows with a temperature, an all-missing frame is never served from cache (requirement 2.5).
4. **Forecast cache** (`weather_service.py`): a parsed frame with no wind speed anywhere (current and slices) is returned but not stored.
5. **Frontend formatting** (`utils/units.ts`): `formatSpeed`, `formatTemperature` and `formatDirection` return `NO_DATA` ("No data") for a null input instead of `Math.round(null)` → 0.
6. **Barbs and gradient** (`WindOverlay.tsx`, `windColorScale.ts`): a point is drawable only with a numeric speed and direction; missing points are filtered before decluttering, and `buildWindGrid` accepts null speeds. Bilinear interpolation already returns null when any of its four corners is missing, so the gradient never paints across a gap.
7. **Pop-ups** (`WindOverlay.tsx`, `MapView.tsx`): the barb pop-up and the saved-location pop-up show "No data"; a saved location whose forecast has no wind gets a no-data marker (circle with a slash) rather than a calm barb.
8. **Notice** (`MapView.tsx`): when a wind layer is visible, the view has points and none of them has wind data, a "No data from <model> for this area" notice appears. `App.tsx` passes the model's display name.

## Files

- `backend/app/models.py`
- `backend/app/units.py`
- `backend/app/services/forecast_parser.py`
- `backend/app/services/grid_weather_service.py`
- `backend/app/services/weather_service.py`
- `backend/tests/test_grid.py`, `test_forecast_parser.py`, `test_weather.py`, `test_units.py`
- `frontend/src/types.ts`
- `frontend/src/utils/units.ts`, `utils/windColorScale.ts`
- `frontend/src/components/WindOverlay.tsx`, `WindColorOverlay.tsx`, `MapView.tsx`
- `frontend/src/App.tsx`
- `frontend/src/utils/units.test.ts`, `components/WindOverlay.test.tsx`, `components/MapView.test.tsx`, `utils/windColorScale.test.ts`
- `requirements.md`

## Correctness properties

- P1 (2.1): for a point whose upstream speed, direction or temperature is null, each of the three fields is `None`/`null`; no consumer sees 0 or 32.
- P2 (2.2): no barb marker is created for a point without speed and direction; `interpolateWindSpeed` returns null for any cell touching a missing corner.
- P3 (2.3, 2.4, 2.6): every displayed value for missing data is "No data"; the notice appears exactly when the frame is entirely missing and a wind layer is on.
- P4 (2.5): an all-missing frame triggers a new upstream request on the next call.
