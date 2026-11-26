# Tasks: SCRUM-225

- [x] 1. Backend models keep absence
  - Nullable grid speed/direction and nullable forecast wind/temperature fields.
  - _Requirements: 2.1, 3.1_
  - _Files: backend/app/models.py_

- [x] 2. Backend parsing stops fabricating values
  - `c_to_f(None)` → `None`, `knots_to_units(None)` → `None` per unit, grid point helper nulls all three fields together.
  - _Requirements: 2.1, 3.1, 3.2, 3.3_
  - _Files: backend/app/units.py, backend/app/services/forecast_parser.py, backend/app/services/grid_weather_service.py_

- [x] 3. Caches skip all-missing frames
  - Grid store skips no-data points; forecast cache is not written when no point has wind.
  - _Requirements: 2.5, 3.4_
  - _Files: backend/app/services/grid_weather_service.py, backend/app/services/weather_service.py_

- [x] 4. Frontend types and formatting
  - Nullable grid/forecast fields; `formatSpeed`, `formatTemperature`, `formatDirection` return "No data".
  - _Requirements: 2.1, 2.3_
  - _Files: frontend/src/types.ts, frontend/src/utils/units.ts_

- [x] 5. Barbs, gradient and pop-ups skip missing points
  - Drawable-point guard, null speeds in the grid builder, "No data" in the barb pop-up.
  - _Requirements: 2.2, 2.3, 3.2_
  - _Files: frontend/src/components/WindOverlay.tsx, WindColorOverlay.tsx, frontend/src/utils/windColorScale.ts_

- [x] 6. Saved-location no-data marker and view notice
  - Circle-with-slash marker, "No data" pop-up values, model-named notice when the whole view is missing.
  - _Requirements: 2.3, 2.4, 2.6, 3.5_
  - _Files: frontend/src/components/MapView.tsx, frontend/src/App.tsx_

- [x] 7. Tests on both sides
  - Backend: null parsing, all-null frames not cached, existing behavior unchanged.
  - Frontend: formatting, barb/gradient skip, pop-ups, notice.
  - _Requirements: 2.1–2.6, 3.1–3.5_
  - _Files: backend/tests/test_grid.py, test_forecast_parser.py, test_weather.py, test_units.py; frontend/src/utils/units.test.ts, components/WindOverlay.test.tsx, components/MapView.test.tsx, utils/windColorScale.test.ts_

- [x] 8. Requirements and CI
  - Note the no-data behavior in `requirements.md`; run the `ci-checks` skill.
  - _Requirements: 2.1–2.6_
  - _Files: requirements.md_
