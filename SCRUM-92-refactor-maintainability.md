# SCRUM-92: Maintainability review and refactoring plan

**Scope.** A review of the backend (about 980 lines of app code, 990 of tests) and the frontend (about 2,000 lines of source, 1,260 of tests) at `develop` / `v0.2.0`. No code has changed. Line numbers refer to the current files.

**Overall.** The code works and is well tested at the feature level. The maintenance cost comes from four places:
1. Database access and cache logic repeated in every service.
2. `App.tsx` holding all state and data fetching.
3. Formatting and API defaults copied across files.
4. Test setup (fixtures, mocks, environment) copied into each test file.

None of this needs a rewrite. Each item below can be done as a small, behavior-preserving change.

---

## Progress

| Phase | Status | Branch |
|---|---|---|
| 1. Fixes and guard rails | ✅ Done | `feature/SCRUM-92-refactor-phase-1` |
| 2. Test foundations | ✅ Done | `feature/SCRUM-92-refactor-phase-2` (built on phase 1) |
| 3. Backend structure | ✅ Done | `feature/SCRUM-92-refactor-phase-3` |
| 4. Backend service split | ✅ Done (B3; B7 not started) | `feature/SCRUM-92-refactor-phase-4` |
| 5a. Frontend: API client and formatters (F4, F3) | ✅ Done | `feature/SCRUM-92-refactor-phase-5a` |
| 5b. Frontend: App hooks, selection, Leaflet layers (F1, F2, F5) | ✅ Done | `feature/SCRUM-92-refactor-phase-5b` (built on 5a) |

### Phase 1: what was done

| Item | Change | Tests |
|---|---|---|
| A. Popup escaping | New `frontend/src/utils/html.ts` (`escapeHtml`). MapView escapes the location name, region and direction text in popups. | `utils/html.test.ts`; `components/MapView.test.tsx` checks that a name containing `<img onerror>` stays plain text |
| B. DB connections | New `db_connection()` context manager in `database.py`: commits on success, rolls back on error, always closes. All call sites use it (`init_db`, locations and weather routers, `weather_service`, `grid_weather_service`). The cache read and write each use a short connection, so none is held open during the Open-Meteo request. | `tests/test_database.py`: commit and close; rollback and close on error; every connection closed when Open-Meteo fails |
| B2 (part). Row mapping | `locations.py` uses one `_row_to_location()` helper instead of three copies. | Existing location tests |
| C. Error handling | Weather and grid routers catch `httpx.HTTPError` only, log with `logger.exception`, and return a fixed 502 message. Other errors become 500. `/api/weather/all` logs each skipped location. Logging is configured in `main.py`. | `test_weather.py`, `test_grid.py`: 502 without internal detail; a code bug gives 500; skipped locations are logged |
| D. Duplicate fetches | The model/timezone effect skips its mount run, since `init()` already loads all weather. Adding a location relies on the selection effect, and only reloads explicitly when it's already selected. Adding a location now also clears a selected grid barb. | `App.test.tsx`: all-weather fetched once on load; a new location fetched once; a timezone change still refreshes |
| E. Marker rebuilds | MapView reads `onSelectLocation` through a ref, so it's no longer a marker-effect dependency. | `App.test.tsx`: a speed-unit change doesn't recreate markers |
| F. Grid fetch cancel | `fetchWindGrid` accepts `{ signal }`. WindOverlay passes it, drops aborted or stale responses, logs failures, and forgets the failed key so the viewport is retried. | `components/WindOverlay.component.test.tsx`: signal aborted on unmount; stale response ignored; retry after failure. `client.test.ts`: signal forwarded |
| G. Cache cleanup | `clean_expired_cache()` now covers all three cache tables (skipping ones not created yet) and runs at startup. The first container start removed 5,033 expired rows. | `test_database.py`: only expired rows removed; missing tables skipped; runs on startup |
| H. CORS | CORS is off unless `CORS_ORIGINS` is set (comma-separated). Credentials are never allowed. | `test_api.py`: no CORS headers for a foreign origin; origin parsing |
| F6. Chevron names | `onChevronClick` → `onGridPointSelect`, `handleChevronClick` → `handleGridPointSelect`, `onChevronClickRef` → `onGridPointSelectRef`; comments and test names updated. | Existing tests |
| F7. Tooling | ESLint 9 flat config (`frontend/eslint.config.js`) with typescript-eslint and the React hooks rules. `npm run lint` fails on any warning. `noUnusedLocals` and `noUnusedParameters` are on. Fixed: unused `err` (AutocompleteDropdown), unused `Settings` and `MapTileLayer` imports (Navbar), and missing deps in WindOverlay's icon effect. The drawer's auto-expand effect is now keyed on a derived `placeKey`. | `npm run lint`, `tsc` |
| B9. Dead code | Removed unused imports: `Generator` (database), `datetime` (models), `json` (grid service), `Path` (main), `Any` (weather router). `pyflakes backend/app` is clean. | — |

**Deviations and notes:**
- **Deferred hook warnings.** Four `react-hooks/exhaustive-deps` warnings are suppressed inline, each with a reason, because they mark intended behavior that phase 5 replaces:
  - two effects in `App.tsx` (to `useForecast`, F1);
  - the one-time map creation in `MapView.tsx`;
  - the `refresh` listener in `WindOverlay.tsx` (to `useWindGrid`, F5).
- **Geocoder.** Its `len(query) < 2` check is kept as a service-level guard. Its broad `except` is left for B6 in phase 3.
- **Point and grid cache tables** are still created lazily, which is B1 in phase 3.
- **Dev tooling.** `pyflakes` was installed in the local `.venv` only. ESLint packages are frontend devDependencies; they don't affect the Docker image's runtime stage.

**Results:** backend 61 passed (was 48). Frontend 85 passed (was 74). `npm run lint` and `tsc` are clean. The Docker image builds and runs.

### Phase 2: what was done

| Item | Change |
|---|---|
| B8. Backend fixtures | New `backend/tests/conftest.py`. It points `DATA_DIR`/`DATABASE_PATH` at a temp directory before the app is imported, and gives each test its own SQLite file through `monkeypatch`, replacing the three DROP TABLE fixtures. It also provides one `client` fixture, and a `grid_cache_table` fixture that uses the app's own DDL instead of a copy. |
| B8. Network guard | An autouse `open_meteo` stub replaces `httpx.AsyncClient.get` in every test. Unconfigured, any call fails with "unexpected Open-Meteo call". Tests use `.respond()`, `.respond_sequence()` and `.fail()`, and inspect `.calls`, `.call_count` and `.last_params`. |
| B8. Factories | New `backend/tests/factories.py`: `forecast_payload`, `grid_item`, `grid_payload`, `http_response`, `upstream_error`, `insert_grid_row`. |
| B8. Weak tests | Removed the `dur2 < 0.2` timing assertion. Removed the no-op `weather_cache` wipe, and each point now asserts `cached is False`. Cache-hit tests assert Open-Meteo wasn't called again, instead of relying on "no patch active". |
| B8. Geocoder tests | New `test_geocode.py` (14 tests): result mapping, skipping items without coordinates, short queries, current failure behavior (`[]`), and the router's 422 limits. |
| F8. Leaflet mock | New `frontend/src/test/leafletMock.ts`, used by `App`, `TimelineDrawer`, `MapView` and `WindOverlay.component` tests via `vi.mock('leaflet', () => import('./test/leafletMock'))`. It records markers (`markerAt`, `createdMarkers`, `marker.fire('click')`, `popupHtml`) and maps (`currentMap()`, `map.bounds`, `map.fire('moveend')`). The four copies of "load the grid and click a barb" in `App.test.tsx` are one `clickGridPoint()` helper. |
| F8. Fixtures | New `frontend/src/test/fixtures.ts`: `makePoint`, `makeForecast`, `makeLocation`. |
| F8. Setup and config | New `src/test/setup.ts` registers `cleanup()` once, and the manual `cleanup()` calls are removed. `vitest.config.ts` now uses `mergeConfig` with `vite.config.ts` instead of repeating its plugins and `define` (F7). |
| F7 (part). Test type-checking | New `tsconfig.test.json` and an `npm run typecheck` script that checks both app and test files. It found 4 errors, now fixed. One was a real test bug: `TimelineDrawer.test` used the direction display `'degrees'`, but the valid value is `'deg'`, so that case only passed because "degrees" is the fallback branch. |
| F8. Coverage gaps | New tests for `AutocompleteDropdown` (debounce, min length, click and Enter, failure, click outside), `SavedLocationsModal` (list, empty state, select, delete, close) and `Navbar` (counts, buttons, selects, unit toggle). There's also a MapView test that a new click handler neither rebuilds markers nor goes stale. |

**Notes:**
- **Racy test fixed.** The "add location by typing" test checked Miami's forecast as soon as the header changed, before the forecast had loaded. It now waits for both, and passed 5 runs in a row.
- **Test patch point.** The backend stub still patches `httpx.AsyncClient.get`; B4 (phase 3) adds a shared client to patch instead. Only `conftest.py` will need to change.
- **Config files not type-checked.** `vite.config.ts`, `vitest.config.ts` and `appVersion.ts` still sit outside `typecheck`. This is small and left for phase 5.
- **New dev dependency.** `@types/node` was added as a frontend devDependency, for test files that use `node:fs`.

**Results:** backend 75 passed (61 kept, 14 new), and the suite also passes when run from another directory, from each file alone, and without touching `data/`. Test code went from 1,201 to 1,104 lines despite the new tests. Frontend 103 passed (was 85). `lint` and `typecheck` are clean.

### Phase 3: what was done

| Item | Change | Tests |
|---|---|---|
| B1. One schema | `database.py` defines all four tables. `init_db` creates them, and services no longer run DDL or `PRAGMA table_info`/`ALTER TABLE` per request. `PRAGMA user_version` (`SCHEMA_VERSION = 1`) drives migrations: on upgrade the three cache tables are dropped and recreated, and `locations` is kept. That removes the old grid table without `temperature_f`, and old point rows stored in `weather_cache` under `location_id 0`. | `test_database.py`: every table and the version are created; `init_db` is idempotent and keeps data; an unversioned old DB is upgraded with locations kept and caches reset |
| B2. Repository and FK | New `locations_repo.py` (`list_locations`, `get_location`, `create_or_get_location`, `delete_location`). The locations and weather routers no longer contain SQL. `PRAGMA foreign_keys = ON` on every connection, so deleting a location cascades to its `weather_cache` rows and the manual delete is gone. | `test_api.py`: cascade delete, 404 on unknown delete and weather, near-duplicate returns the existing location. `test_database.py`: foreign keys enforced |
| B4. Shared client | New `services/open_meteo.py`: `get_json(url, params, timeout, retries)` and `forecast_params(model)` (the `wind_speed_unit` and `models` rule). Forecast, grid and geocoding all use it, and invalid JSON is raised as an `httpx` error (502, not 500). | `test_open_meteo.py` |
| B4. Units and cache keys | New `units.py`: `as_float`, `c_to_f`, `knots_to_units`, `deg_to_cardinal`, `coord_key`. These replace the two °C→°F copies, the two cache-key functions and precision constants, and the doubled knots conversions in `build_weather_point`. The grid cache is written with one `executemany`. | `test_units.py`; existing forecast and grid tests |
| B5. Settings and validation | `config.py` has named constants: `DEFAULT_MODEL`, `DEFAULT_TIMEZONE`, `FORECAST_POINTS`/`FORECAST_STEP_HOURS`/`FORECAST_DAYS` (with an import-time check that they fit), `COORD_CACHE_PRECISION`, `GRID_MAX_DIM`, `DUPLICATE_LOCATION_RADIUS_DEG`, and Open-Meteo timeouts and retries. New `dependencies.py` validates `model` against `/api/weather/models` on all four weather endpoints (422, no upstream call). | `test_weather.py`: unknown model gives 422 on every endpoint; every listed model is accepted |
| B6. Error policy | The geocoder no longer swallows failures. The service raises, and `/api/geocode` returns 502 with a fixed message and logs the error. The search box behaves as before, since the client already treats non-OK as "no results". A grid response with the wrong number of points is now an upstream error instead of being silently truncated. | `test_geocode.py`: raises on outage or 5xx; router 502 without internal detail |

**Notes:**
- **API changes, all intentional and documented in `requirements.md` and `README.md`:**
  - An unknown `model` returns 422 (before: forwarded to Open-Meteo, then 502).
  - Geocoder outages return 502 (before: 200 with `[]`).
- **Migration on the real data volume.** The container upgraded from version 0 to 1 once. All 8 saved locations were kept, the caches were reset, and a restart didn't migrate again.
- **`/api/weather/all`** still fetches locations one after another. Running them in parallel is a performance change, not maintainability, so it's left out.
- **Test patch point.** The test stub still patches `httpx.AsyncClient.get`. Every call now goes through `open_meteo.get_json`, so that one function is the only place that touches httpx.

**Results:** backend 109 passed (was 75; 34 new). Frontend 103 passed, unchanged. `pyflakes backend` is clean.

### Phase 4: what was done

`get_weather` was a 168-line function doing six jobs with an `is_point` flag. It is now four small pieces:

| Piece | File | What it does |
|---|---|---|
| `parse_forecast(raw) -> ParsedForecast` | `services/forecast_parser.py` | Pure: Open-Meteo dict in, current conditions plus 16 slices out. It replaces the seven parallel `hourly_x[idx] if idx < len(hourly_x) else 0` lines with one `_at(series, idx)` helper and a loop over `FORECAST_VARIABLES`. `build_weather_point` moved here. |
| `SavedLocationCache` / `PointCache` | `services/forecast_cache.py` | One class per cache table, each with `get(now)` and `put(payload, now)`. They replace the two near-identical SELECT/UPSERT pairs. |
| `fetch_forecast(lat, lon, model, tz)` | `services/weather_service.py` | HTTP only, through the shared client. |
| `get_location_forecast(location, …)` / `get_point_forecast(lat, lon, …)` | `services/weather_service.py` | Pick the cache and identity, then run cache → fetch → parse → store (`_get_forecast`). The routers call these instead of passing the magic `location_id=0`, and the point display name (`point_name`) moved out of the router. `POINT_LOCATION_ID` names the `0`. |

**Bug found and fixed: timezone missing from cache keys.**
- **Problem.** Both forecast caches were keyed without the timezone, but Open-Meteo returns times in the requested timezone. After a timezone change, the drawer showed the previous timezone's times for up to 30 minutes.
- **Fix.** Both keys now include the timezone (`SCHEMA_VERSION = 2`, so the caches reset on upgrade).
- **Evidence.** The new test fails on `develop` for both saved locations and map points. Live, switching Pacific → Tokyo now returns Tokyo times, and repeating the request is a cache hit.

**Also changed:** a saved-location cache hit now reports the location's current name. Before, it used the name stored with the cached payload.

**Correction to the review:** B3 said `curr.get("time", "")[:13]` raises `TypeError` when `time` is `None`. It doesn't, because the old code checked `curr.get("time")` first. The new parser test covers that case without claiming a fix.

**Tests:**
- `test_forecast_parser.py` (7 tests, no mocks): start at the current hour; 3-hour steps; slice 0 is the current conditions; unknown or missing current time; short series; missing variables; empty response.
- `test_weather.py`: the timezone keys, and the cache hit reporting the current name.
- `test_database.py`: the upgrade from schema version 1 to 2.

**Not done: B7** (moving SQLite calls off the event loop, and batching grid cache reads). Current traffic doesn't need it; it can be its own change if wanted.

**Results:** backend 120 passed (was 109). Frontend 103 passed. `pyflakes backend` is clean. The container upgraded the real volume from 1 to 2 once, and all 8 locations were kept.

### Phase 5a: what was done

| Item | Change | Tests |
|---|---|---|
| F4. Request helper | `api/client.ts`: one `request<T>(path, errorMessage, { params, init, signal })` replaces eleven fetch → `!res.ok` → `json()` copies. Errors are `ApiError` with `.status`, and a 204 isn't parsed. Every fetch accepts `{ signal }`. The client file is about 30 lines shorter. | `client.test.ts`: `ApiError` status, POST body, 204, plus the existing URL and error-message tests (messages kept the same) |
| F4. Error policy (documented) | `searchGeocode` returns `[]` for short queries and for API errors, including the backend's new 502, but lets network errors and aborts through. `fetchAppConfig` returns `{}` on any failure so the app still starts. | `client.test.ts`: 502 gives `[]`, query trimmed and encoded, config failure gives `{}` |
| F4. Shared defaults | New `src/constants.ts`: `DEFAULT_MODEL`, `DEFAULT_TIMEZONE`, `TIMEZONES` (moved from Navbar), `FORECAST_STEP_HOURS`, `DEFAULT_MAP_CENTER`/`ZOOM`, `STORAGE_KEYS`. The repeated `'best_match'`/`'America/Los_Angeles'` literals in App and the client are gone. | Existing tests |
| F4. Types | `GridWindPoint` (re-exported from the client for compatibility) and `SelectedGridPoint` moved to `types.ts`. `SelectedGridPoint` is now `Pick<GridWindPoint, 'latitude' \| 'longitude'>`, dropping its unused `wind_speed_knots`. New `NewLocation` and `AppConfig` types. | `tsc`, typecheck |
| F3. Formatters | New `src/utils/units.ts`: `formatSpeed(pt, 'speed' \| 'gust', unit)` (one table-driven function replacing the drawer's two four-way switches), `formatTemperature`, `formatDegreesTrue` (moved from TimelineDrawer), `formatDirection`, `formatSliceTime`. | `utils/units.test.ts` (12 tests) |
| F3. Drawer | TimelineDrawer uses the formatters. The cardinal and degrees branches share one compass block. "16 data points (3h intervals)" and `index * 3` come from the data and `FORECAST_STEP_HOURS`. | Existing drawer tests |
| F3. Popups follow units | MapView takes `unitSystem` and `speedUnit` and builds popups with the same formatters, instead of hardcoded `kt`/`°F`. Popups rebuild when units change. | `App.test.tsx`: popup switches to km/h and °C after the unit toggle |

**Correction to the review:** F3 said `formatPointTime` "ignores the app's timezone setting". It doesn't: Open-Meteo returns wall-clock times without an offset in the requested timezone, and parsing and formatting them in the browser's zone keeps that wall-clock time. `formatSliceTime` keeps that behavior, drops the try/catch that could never trigger, and returns the input for an invalid date. A test pins the wall-clock behavior.

**Test changes:** the "markers aren't rebuilt" test now changes the direction display instead of the speed unit, since popups now depend on the speed unit.

**Results:** frontend 120 passed (was 103). Backend 120 passed. `lint` and `typecheck` are clean, and the container builds and serves the app.

### Phase 5b: what was done

| Item | Change | Tests |
|---|---|---|
| F1. Settings hooks | `useLocalStorageState(key, parse, serialize)` replaces three hand-written initialisers and three "set state and write localStorage" handlers, and tolerates disabled storage. `useMapSettings()` covers the tile layer (an unknown stored value falls back to OSM dark), the CARTO key and the overlay. A server-provided key applies for the session only, as before, and never overrides the user's key. `useUnitPreferences()` covers the unit toggle. | `hooks/useSettings.test.ts` (9 tests) |
| F1. Data hooks | `useLocations()` handles load, add ("first" for current location, "last" for search) and remove. `useAllWeather(model, tz)` is one effect for the map markers, which removes the phase 1 "skip the first run" workaround. `useDrawerForecast(selection, model, tz, { refreshToken })` is one effect keyed on selection, model, timezone and the refresh token. It replaces the `weatherRequestRef` counter, two effects with suppressed lint warnings, and the explicit reload calls in three handlers. A newer request aborts the previous one, so outdated responses are dropped and the HTTP request is cancelled. | `hooks/useForecast.test.ts` (9), `hooks/useLocations.test.ts` (4) |
| F1. App.tsx | 348 → 214 lines; it only wires the hooks to the components. Startup is one readable sequence (config → models → locations → position), with geolocation wrapped in a promise. | Existing `App.test.tsx`, plus new tests: choosing the selected location again reloads it; deleting the selected location selects the next one |
| F2. One selection | `Selection = { kind: 'saved', location } \| { kind: 'point', latitude, longitude }` replaces `selectedLocation` plus `selectedGridPoint` plus the "clear one when setting the other" rules. Both values are derived from it. | Existing SCRUM-88/89 tests |
| F5. Saved-location markers | MapView updates markers in place by location id (`setIcon`, `setPopupContent`, `setLatLng`). Only added or deleted locations create or remove markers, and all markers are removed on unmount. The icon and popup builders are pure, exported functions. The tile layer comes from `mapTiles.ts` (`tileLayerConfig`) instead of three branches, and the effect now removes its layer on cleanup. | `MapView.test.tsx`: in-place update, delete, unmount. `mapTiles.test.ts` |
| F5. Wind grid | New `hooks/useWindGrid.ts` handles fetching, deduplication, abort and retry. The `refresh` listener is defined inside the effect, so its lint suppression is gone. WindOverlay only draws: each point is stored with its marker (no index pairing), and selection changes update icons without recreating markers. `useLatest` replaces the hand-written callback refs. | `WindOverlay.component.test.tsx` (unchanged, still passing), `gridDimensions` test |

**Notes:**
- **Lint suppressions:** 4 → 2. The two left are run-once effects (startup, and creating the Leaflet map), each with its reason.
- **Mutation checks:** I broke each of these in turn: the drawer's stale-response guard, the same-location reload, the in-place marker update, the session-only server key, and the grid abort on cleanup. Each made at least one test fail.
- **Test fixes:** two tests checked the drawer's forecast as soon as the header changed. They now wait for the forecast, which arrives a moment later; this is the same race as phase 2's Miami test. Call assertions now include the `{ signal }` argument.
- **Not done:**
  - Changing `generateWindBarbSvg` to an options object would touch every call site and test for little gain.
  - Type-checking the config files (`vite.config.ts` and others) is still open.
  - B7 is optional.

**Results:** frontend 147 passed (was 120). Backend 120 passed. `lint` and `typecheck` are clean. The container builds and serves the app with no errors in its log.

---

## Fix first: correctness and safety issues found during the review

These are small, and they are bugs or risks rather than style.

| # | Where | Problem | Size |
|---|---|---|---|
| A | `MapView.tsx:158-173` | Location `name`, `admin1` and `country` are put into the popup HTML without escaping. A geocoder result containing markup would run as HTML. | S |
| B | `database.py:9-13`, all callers | DB connections are closed by hand and never in `finally`. Any exception, including an Open-Meteo timeout in `get_weather` or `get_grid_wind`, leaks the connection. | S–M |
| C | `routers/weather.py:46-50, 104-108`, `grid.py:47-51` | `except Exception` turns every error, including programming bugs and `sqlite3` errors, into "502 Bad Gateway". It puts `str(exc)` in the response, and nothing is logged. | S |
| D | `App.tsx:163-169` and `init()` | On page load, all-locations weather is fetched twice: once by `init()` and once by the model/timezone effect, which also runs on mount. Adding a location fetches its forecast twice: the explicit call plus the `selectedLocation?.id` effect. | S |
| E | `App.tsx:181` and `MapView.tsx:179` | `handleSelectLocation` is a new function on every render. It is in MapView's marker effect dependencies, so every App render removes and rebuilds every saved-location marker and popup. | S |
| F | `WindOverlay.tsx:129-137` | The `AbortController` is never passed to `fetchWindGrid`, so it aborts nothing. A slow grid response can overwrite a newer one. A failed fetch is swallowed, and it isn't retried for the same viewport. | S |
| G | `database.py:74`, all cache tables | `clean_expired_cache()` has no callers, and it only knows `weather_cache` anyway. The `point_weather_cache` and `grid_weather_cache` tables grow without limit. | S |
| H | `main.py:30-36` | CORS is set to `allow_origins=["*"]` with `allow_credentials=True` unconditionally, although it's commented "for development". | S |

---

## Backend refactors

### B1. One place for the database schema (M)
- **Problem.**
  - `init_db` creates only `locations` and `weather_cache`.
  - `point_weather_cache` is created inside `get_weather` on every point request (`weather_service.py:102`).
  - `grid_weather_cache` is created inside `get_grid_wind` on every grid request, followed by a `PRAGMA table_info` check and an `ALTER TABLE` (`grid_weather_service.py:41-62`).
  - The test fixture in `test_grid.py:56-75` keeps a copy of that DDL.
- **Refactor.**
  - Move all DDL into `database.py`, or a new `schema.py`.
  - Track a schema version with `PRAGMA user_version`. The cache tables can simply be dropped and recreated on a version change.
  - Services then assume the tables exist.
- **Payoff.** You read one file to see the schema, there's no DDL on the request path, and the tests use `init_db()`.

### B2. Context-managed DB access, plus a small repository for locations (S–M)
- **Connections.** Change `get_db_connection()` into a context manager that commits or rolls back and always closes (fixes B above).
- **Location row mapping.** `locations.py` builds `LocationResponse` from a row the same way three times (lines 25-34, 56-65, 87-96). One `_row_to_location()` helper replaces all three.
- **Shared queries.** A `locations_repo.py` with `list`, `get`, `find_near`, `create` and `delete` removes direct SQL from `routers/weather.py` and `locations.py`.
- **Cascade delete.** `weather_cache` declares `ON DELETE CASCADE`, but foreign keys are never turned on (`PRAGMA foreign_keys`). That's why `delete_location` deletes cache rows by hand. Turn the pragma on and drop the manual delete.

### B3. Split `get_weather` (168 lines) (M)
`weather_service.py:85-252` does six jobs in one function: the cache lookup (two backends selected by an `is_point` flag), building request params, the HTTP fetch, parsing, building the 16 slices, and the cache write. Split it into:
- **`open_meteo.fetch_forecast(lat, lon, model, tz)`:** the HTTP request only.
- **`parse_forecast(raw) -> (current, points)`:** pure, and easy to unit-test without mocking HTTP.
- **A small cache interface** with `get(key)` and `put(key, payload)`, implemented by `SavedLocationCache` and `PointCache`. This removes the two near-identical SELECT/UPSERT pairs and the magic `location_id == 0` sentinel from the service.

### B4. Shared Open-Meteo client, unit conversion and cache-key helpers (S–M)
| Duplicated | Locations |
|---|---|
| `httpx.AsyncClient` setup with different timeouts and retries (15 s/2, 20 s/2, 5 s/0) | `weather_service.py:150`, `grid_weather_service.py:137`, `geocode_service.py:21` |
| `if model and model != "best_match": params["models"] = model` and `"wind_speed_unit": "kn"` | `weather_service.py:147`, `grid_weather_service.py:134` |
| °C→°F conversion (a comment says the two must match, but nothing enforces it) | `weather_service.py:58`, `grid_weather_service.py:20` |
| Cache key rounding and precision constant | `_point_cache_key` + `POINT_CACHE_PRECISION`, and `_cache_key` + `CACHE_PRECISION` |
| Knots → km/h, mph and m/s conversions, written once for wind and again for gusts | `weather_service.py:59-64` |

**Refactor.**
- **`services/open_meteo.py`:** one client with shared timeouts and retries, plus a `base_params(model)` helper.
- **`units.py`:** `c_to_f`, `knots_to_units` and `deg_to_cardinal`.
- **Cache key:** one `coord_key()` helper with a single precision constant.

### B5. Constants and validation in `config.py` (S)
- **Repeated defaults.** `"best_match"` is repeated in 8 places and `"America/Los_Angeles"` in 5.
- **Forecast shape.** It's hardcoded as `16`, `3` and `forecast_days: 4`. These are coupled, but nothing ties them together.
- **Other literals.** The grid limit `30` is in the router, and the 500 m duplicate-location radius `0.005` is inline.
- **Fix.** Move all of these into named settings.
- **Validate `model`** against `AVAILABLE_MODELS` with a `Literal` or `Enum`. Today any string passes through to Open-Meteo and creates new cache keys.

### B6. Error handling and logging (S)
- **Specific exceptions.** Catch `httpx.HTTPError` only, add `logger.exception`, and return fixed messages. Let other errors become 500 (fixes C above).
- **Consistent upstream failures.** `get_all_locations_weather` silently drops failed locations (`except Exception: continue`). The geocoder returns `[]` on any upstream failure, so the UI can't tell "no matches" from "service down". Pick one policy.
- **Logging.** Add the `logging` module; there's no logging anywhere today.

### B7. Non-blocking DB calls in async routes (M, optional)
- **Problem.** The async weather and grid paths run synchronous `sqlite3` calls on the event loop. A full 30×30 grid does up to 900 single-row SELECTs and 900 INSERTs.
- **Quick fix.** Batch them into one query and `executemany`, and run DB work with `asyncio.to_thread`.
- **Full fix.** `aiosqlite`, but it isn't needed at current traffic.

### B8. Test structure (M)
- **Fixtures.** There is no `conftest.py`. The DB setup and teardown fixture is copied into three files with subtle differences: `test_grid` never drops `point_weather_cache`, so state leaks between files. The `client` fixture is copied three times.
- **Environment at import.** Env vars are set at import time in four files, with relative paths into the real `data/` directory. Whichever file imports first wins.
- **Mock boilerplate.** `httpx.Response(... request=httpx.Request(...))` is written out about 10 times, and `patch("httpx.AsyncClient.get")` about 25 times.
- **Refactor.**
  - A `conftest.py` with a `tmp_path` database, `client`, and a `mock_open_meteo(payload)` fixture.
  - A `tests/factories.py` for Open-Meteo payloads.
  - Patch the shared client from B4 instead of httpx globally.
- **Estimated saving.** About 150–200 lines of test code.
- **Weak tests to fix along the way:**
  - The wall-clock assertion `dur2 < 0.2` (`test_weather.py:126`).
  - A cache wipe that deletes from the wrong table and does nothing (`test_weather.py:164-169`).
  - Cache-hit tests that rely on "no patch active", so a regression would make a real network call.
- **Missing tests.** There are no tests for the geocoder.

### B9. Dead code (S)
- **Unused imports.** `Generator` (`database.py`), `datetime` (`models.py`) and `json` (`grid_weather_service.py`).
- **Unused function.** `clean_expired_cache` should either be wired to startup or a periodic task, or deleted.
- **Redundant validation.** The geocoder repeats the router's `min_length=2` check.

---

## Frontend refactors

### F1. Split `App.tsx` (348 lines) into hooks (M)
- **Problem.** `App.tsx` holds about 17 `useState` calls across four concerns: data, query parameters, display preferences and map settings. It also holds a 58-line `init()` effect and the request-ordering logic.
- **Suggested hooks:**
  - **`useLocalStorageState(key, default, parse)`:** replaces three hand-written initialisers and three "set state and write localStorage" handlers. Storage keys are currently string literals in 6 places.
  - **`useMapSettings()`:** tile layer, CARTO key and overlay visibility.
  - **`useUnitPreferences()`:** unit system, speed unit and direction display.
  - **`useLocations()`:** the location list, add, delete, and choosing a new selection after a delete.
  - **`useForecast(model, timezone)`:** `weatherMap`, `selectedWeather`, loading state and the stale-response guard. The guard is currently copied into `loadWeatherForLocation` and `handleChevronClick`; one `runDrawerRequest(fetcher)` helper replaces both.
- **Payoff.** Each concern can be tested alone, `App.tsx` drops to wiring only, and fixes D and E fall out naturally.

### F2. One "selection" model (M)
- **Problem.** The drawer header falls back between `selectedLocation` and `weatherData` (`TimelineDrawer.tsx:128-137`). That's because a grid-point click sets `selectedLocation = null` and keeps a separate `selectedGridPoint`.
- **Refactor.** Use one discriminated union, `{ kind: 'saved', location } | { kind: 'point', lat, lon }`. This removes the fallbacks and the "clear one when setting the other" rules spread across handlers.

### F3. Shared formatters (`units.ts`) (S–M)
- **Speed and gust.** `getSpeedDisplay` and `getGustDisplay` (`TimelineDrawer.tsx:78-104`) are the same four-way switch. Replace them with one table-driven `formatSpeed(pt, 'speed' | 'gust', unit)`.
- **Hardcoded units.** The map popup hardcodes `kt` and `°F` (`MapView.tsx:122-131`), so it ignores the user's unit settings.
- **Formatter location.** Temperature formatting and `formatDegreesTrue` live in component files.
- **Direction display.** The `cardinal` and `degrees` branches are the same JSX with a different label.
- **Timezone bug.** `formatPointTime` ignores the app's timezone setting and formats in the browser's zone, which is a real mismatch. It also has a `try/catch` that can never trigger.

### F4. API client cleanup (S)
- **Repeated fetch pattern.** Eleven functions repeat `fetch` → `if (!res.ok) throw new Error(...)` → `res.json()`. A `request<T>(path, { params, signal })` helper removes about 40 lines and adds `AbortSignal` support (fixes F above).
- **Error detail.** Errors carry no HTTP status, so callers can't tell a 404 from a network failure.
- **Shared defaults.** Defaults are repeated 7 times across `client.ts` and `App.tsx`. Move them to `constants.ts`, with the timezone list from `Navbar.tsx`.
- **Type placement.** Move `GridWindPoint` (now in `client.ts`) and `SelectedGridPoint` (now in `WindOverlay.tsx`) to `types.ts`. Name the inline `AppConfig` and `NewLocation` types.

### F5. Leaflet layers (M)
- **MapView markers.** MapView deletes and recreates every saved-location marker on any change. Update the existing markers by id instead (`setIcon`, `setPopupContent`).
- **WindOverlay structure.** Split it into a `useWindGrid(map, model, visible)` hook (fetch, deduplicate, abort) and a marker layer. Today `refresh` is a plain function closing over props, registered with `map.on` and kept correct by the effect's re-run, not by its dependencies.
- **Index pairing.** `markersRef` and `pointsRef` are paired by array index. Store `{ point, marker }` pairs instead.
- **Barb icon helpers.** The three icon builders (`generateWindBarbSvg` with 6 positional arguments, MapView's icon and `buildGridBarbIcon`) should move to the WindBarb module with an options object. Make `tempF` optional instead of the `hasTemp ? tempF : 0` workaround.
- **Tile layer table.** The three tile-layer branches repeat the attribution and `maxZoom`. Use a `TILE_LAYERS` table.

### F6. Leftover "chevron" names (S, mechanical)
SCRUM-89 replaced the chevrons, but the old names remain:
- `onChevronClick`, `handleChevronClick` and `onChevronClickRef` in `WindOverlay.tsx`, `MapView.tsx` and `App.tsx`.
- Comments in `App.tsx` and `TimelineDrawer.tsx`.

Rename to `onGridPointSelect` and `handleGridPointSelect`. Leave the lucide `ChevronUp` and `ChevronDown` icons alone.

### F7. Tooling (S to add, M to clear what it finds)
- **Lint and format.** There's no ESLint or Prettier and no `lint` script. `eslint-plugin-react-hooks` (`exhaustive-deps`) would have flagged items D, E and F5.
- **Unused-code checks.** `noUnusedLocals` and `noUnusedParameters` are off.
- **Test type-checking.** `tsconfig.json` excludes `*.test.ts(x)`, so tests are never type-checked. Add a `tsconfig.test.json` and a `typecheck` script.
- **Duplicate config.** `vitest.config.ts` repeats `vite.config.ts`. Use `mergeConfig`.

### F8. Test structure (S)
- **Leaflet mock.** It's pasted into `App.test.tsx` and `TimelineDrawer.test.tsx`, and the drawer copy lacks `setIcon`. Move it to `src/test/leafletMock.ts`; your workspace rule asks for a proper Leaflet mock, and this satisfies it once.
- **Forecast builders.** Move them to `src/test/fixtures.ts` (`makePoint`, `makeForecast`).
- **Setup file.** A vitest setup file can register `cleanup()` once instead of in each file.
- **Coverage gaps.** There are no tests for Navbar, SavedLocationsModal, AutocompleteDropdown (its debounced search), or WindOverlay's effect logic, which is the riskiest code.

---

## Suggested phasing

| Phase | Items | Risk | Notes |
|---|---|---|---|
| 1. Fixes and guard rails | A–H, F6, F7 (lint plus `noUnusedLocals`), B9 | Low | Small PRs. Lint surfaces the remaining dependency bugs. |
| 2. Test foundations | B8, F8 | Low | Makes the later refactors safe and cheaper to test. |
| 3. Backend structure | B1, B2, B4, B5, B6 | Medium | One shared client, schema and helpers. No API change. |
| 4. Backend service split | B3, then B7 if wanted | Medium | `parse_forecast` gets fast pure unit tests. |
| 5. Frontend structure | F4, F3, F1, then F2 and F5 | Medium | F1 and F2 change state flow, so keep the existing integration tests green at each step. |

**Not recommended now.** Reshaping `WeatherForecastPoint`'s flat unit fields (`wind_speed_kmh`, `wind_gust_mph` and so on) into nested objects would simplify formatting, but it's a breaking API change for both sides. It's only worth doing alongside a planned API version.
