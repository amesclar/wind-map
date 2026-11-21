# summary
create a standalone application that shows wind predictions on a map

# weather data
the weather data should come from open source api sources (ie. meteo, etc.) and the data should be displayed in a map

provide dropdown for weather model options with Open-Meteo as the default option

the default location should be the user's current location. if not able to determine current location, default to Oak Harbor, Washington, are 48.2939° N, 122.6064° W

the application should be able to show multiple locations at once, each marked with an icon, and the user should be able to click on an icon to see the weather predictions for that location

the web ui should have a text box allowing users to add locations - the locations should be verified and converted to lat/long before adding to location database

provide a button to list saved locations with minus sign buttons for removal

wind data should include wind speed, wind gust, and wind direction

cache weather data with 30min TTL
+ Saved locations are cached in `weather_cache` keyed by (location_id, model, timezone).
+ Ad-hoc map points (`GET /api/weather/point`, location_id 0) are cached in `point_weather_cache` keyed by (lat, lon rounded to 2 decimals, model, timezone), so different points never share a cached forecast (SCRUM-88).
+ The timezone is part of both keys (SCRUM-92) because forecast times are returned in the requested timezone; changing the timezone fetches a new forecast instead of serving one cached for another timezone. Cached responses always carry the requested point's name and coordinates. Old (0, model) rows in `weather_cache` are no longer read.

# map data
use an open-source map library (e.g., Leaflet.js with OpenStreetMap or CartoDB)
+ Support CARTO API Key via CARTO_API_KEY environment variable or in-app settings modal (removes CARTO's "API KEY REQUIRED" watermark).
+ Provide OpenStreetMap Dark mode as default keyless, watermark-free base layer.

get and use api key for map library

# location
the user should be able to select a location and see the weather predictions for that location

Typing in the search box queries https://geocoding-api.open-meteo.com/v1/search?name=... and displays a dropdown matching name, admin1 (state/region), country, allowing one-click addition with exact coordinates.

# data presentation
show 16 data points for each location starting from now and every 3 hours after that for the next 48 hours based on the user selected timezone with a default of Pacific

clicking on location should show;
+ location name
+ lat/long
+ wind speed
+ wind gust speed
+ wind direction - both cardinal (e.g. SW) and degrees
+ temperature

Wind Barb Markers: SVG wind barbs with speed feathers (knots) and temperature color-coding on the map.

Wind Grid Overlay (SCRUM-86, SCRUM-89): A continuous grid of wind barbs covering the entire visible map viewport, not just saved locations.
+ Grid density: approximately one barb per 80px at the current zoom level; grid dimensions (cols × rows) are computed from the map bounds and pixel size on each pan/zoom.
+ Data source: `GET /api/weather/grid` backend endpoint, which accepts a bounding box and grid dimensions, fetches current wind from Open-Meteo in a single batched request, and caches each grid point for 30 minutes (same TTL as location weather). No additional CARTO tile API calls are incurred — barbs are DOM elements, not tiles.
+ Barb style (SCRUM-89): the same meteorological wind barb drawing as the drawer (staff points toward the wind direction; 50 kt pennants, 10 kt full barbs, 5 kt half barbs; calm < 2 kt renders as a circle). Grid barbs use the same temperature color scale as the drawer barbs; speed is indicated by the number of barbs. If a point has no temperature, its barb falls back to green (#4ade80). No legend is shown.
+ `GET /api/weather/grid` returns `temperature_f` per point (Open-Meteo current `temperature_2m`, converted to °F and rounded to 1 decimal, same as the drawer). `grid_weather_cache` gains a nullable `temperature_f` column, added automatically to existing tables; cached rows without a temperature are refetched.
+ Selected grid point (SCRUM-89): the clicked barb is drawn larger with a white highlight ring. Its speed, direction and color match the leftmost barb of the drawer, because both use Open-Meteo "current" values.
+ Barb click (SCRUM-88): clicking a barb clears the saved-location selection, fetches `/api/weather/point` for that grid point, and the timeline drawer header shows the point's name and coordinates (e.g. "48.78°N, 121.94°W") from the point forecast. Stale in-flight saved-location forecasts cannot overwrite the barb's forecast. Saved-location selection behavior is unchanged.
+ Toggled via Map Settings modal (default: visible).
+ Hard limits of 30 cols × 30 rows prevent runaway API requests.

Drawer: Bottom timeline showing 16 time slices (every 3h for 48h) in Pacific Time by default.
+ Each slice shows temperature and wind only; relative humidity is no longer displayed in the drawer (SCRUM-97). The API still returns `humidity` in forecast points.
+ Each slice shows the wind direction in whole degrees true (e.g. "220°T", normalized to 0–359) directly below the wind barb (or direction display) and above the wind speed, regardless of the selected wind direction display (SCRUM-90).
+ The first ("Now") slice uses Open-Meteo "current" conditions rather than the top-of-hour hourly value (SCRUM-89); the remaining 15 slices are hourly values at +3h steps.

# data persistence
use a local SQLite database to store the locations and weather data

data should persist across docker container restarts

Backend: FastAPI (Python 3.11+) with SQLite caching (30min TTL), geocoding proxy, and location CRUD endpoints (GET/POST/DELETE).
+ Expired rows in all cache tables (`weather_cache`, `point_weather_cache`, `grid_weather_cache`) are deleted at startup (SCRUM-92).
+ Schema (SCRUM-92): all tables are created in `backend/app/database.py` at startup, versioned with SQLite `PRAGMA user_version`. On a version upgrade the cache tables are recreated (they only hold refetchable data); saved locations are kept. Foreign keys are enforced, so deleting a location deletes its cached forecasts.
+ `model` must be one of the ids from `GET /api/weather/models`; any other value returns 422 without calling Open-Meteo (SCRUM-92).
+ `GET /api/geocode` returns 502 when the geocoder is unavailable, instead of an empty list (SCRUM-92). The search box still shows no results in that case.
+ Settings such as the default model and timezone, forecast shape (16 slices every 3 hours), cache-key precision, grid limit, duplicate-location radius and Open-Meteo timeouts are named constants in `backend/app/config.py`.
+ DB connections are always closed, including when Open-Meteo fails; no connection is held open during Open-Meteo requests (SCRUM-92).
+ Error handling (SCRUM-92): Open-Meteo failures return 502 with a fixed message (details are logged, never returned to the client); other errors return 500. `/api/weather/all` logs and skips locations whose forecast fails.
+ CORS (SCRUM-92): off by default (the app serves its own frontend and the Vite dev server proxies `/api`). Set `CORS_ORIGINS` (comma-separated) to allow cross-origin access; credentials are never allowed.

# units
there should be a toggle between Metric and Imperial

user selects units

Temperature: Celsius or Fahrenheit (default)
Wind speed: knots (default), km/h, m/s, or mph
Wind direction: Degrees (0, 90, 180, 270, 360) or cardinal directions (N, NE, SW) or wind barbs with feathers showing direction and speed (default)
+ Preferences pop-up (SCRUM-107): timezone, temperature unit, wind speed unit and wind direction display are set in a Preferences pop-up opened from the gear icon in the top bar (reachable at every screen width). Changes apply immediately; the pop-up closes with its X and "Done" buttons.
+ All four preferences are saved in localStorage (`unit_system`, `speed_unit`, `dir_display`, `timezone`) and restored on reload. Missing or invalid stored values fall back to the defaults (°F, knots, barbs, Pacific).
+ The four preferences are independent: choosing °F or °C changes only the temperature unit, never the wind speed unit.

# ui design
use a minimalist ui

Frontend: React + Vite + Leaflet + TailwindCSS in dark minimalist style.
+ Location names and regions are HTML-escaped before being placed in map popups (SCRUM-92).
+ Map popups show wind speed, gust and temperature in the user's selected units, the same as the drawer (SCRUM-92). Formatting lives in `src/utils/units.ts`.
+ Frontend defaults (model, timezone, timezone list, map center, localStorage keys) are in `src/constants.ts`; API calls go through one `request()` helper in `src/api/client.ts` that throws `ApiError` with the HTTP status.
+ Frontend state (SCRUM-92): `App.tsx` only wires hooks together. `src/hooks/` holds settings (`useMapSettings`; `useUnitPreferences` for the temperature unit, wind speed unit and direction display; `useTimezone`; all persisted with `useLocalStorageState`), saved locations (`useLocations`), forecasts (`useAllWeather` for map markers, `useDrawerForecast` for the drawer) and the wind grid (`useWindGrid`). The drawer shows exactly one selection, a saved location or a map point; a newer forecast request cancels the previous one, and choosing the selected location again reloads it.
+ Saved-location markers are updated in place when weather, selection or units change; only added or deleted locations create or remove markers (SCRUM-92).
+ Wind grid requests are cancelled when superseded; only the latest response draws barbs, and a failed request is retried on the next pan/zoom (SCRUM-92).
+ Code quality (SCRUM-92): ESLint (`npm run lint`, TypeScript + React hooks rules, zero warnings allowed) and TypeScript `noUnusedLocals` / `noUnusedParameters`.
+ Refactoring plan and progress: `SCRUM-92-refactor-maintainability.md`.

# containerization
the application should run in a self contained docker environment, using a lightweight framework (ie. Flask, FastAPI, etc.) and a database to store the locations and weather data and open source map library to display the map and open source weather api

use node.js for frontend and python for backend

use a multi-stage Dockerfile:
+ Stage 1 (Node.js): Builds the frontend assets (e.g., Vite/React or static bundle).
+ Stage 2 (Python/FastAPI or Flask): Runs the backend API and serves the compiled static frontend files on port 5005.

+ Image size (SCRUM-102): the runtime stage uses `python:3.11-alpine` instead of `python:3.11-slim`, and Python dependencies are installed in a separate builder stage and copied into the runtime stage. The image dropped from 289 MB to 144 MB. `requirements.txt` holds runtime dependencies only; test tools (pytest, pytest-asyncio) are in `requirements-dev.txt`.
+ Pinned dependencies (SCRUM-103): `requirements.txt` and `requirements-dev.txt` are generated by `pip-compile` (Python 3.11, Alpine) from the loose top-level files `requirements.in` and `requirements-dev.in`, and pin every package, including indirect ones, with `==` so builds are reproducible. They are not edited by hand; the upgrade steps are in `README.md`. The container still runs as root so that existing `wind_data` volumes (created by the previous image) remain writable.
# quality and security checks (SCRUM-108)
GitHub Actions (`.github/workflows/ci.yml`, `codeql.yml`) runs on pull requests and pushes to `develop` and `master`:
+ Backend: `ruff check` (rules E, W, F, I, B, S, C4, SIM in `ruff.toml`), `pytest --cov` with a minimum of 97% (`.coveragerc`; baseline was 99%), and `pip-audit -r requirements.txt`.
+ Frontend: `npm run lint`, `npm run typecheck`, `npm run test:coverage` with thresholds in `frontend/vitest.config.ts` (statements 90, branches 82, functions 86, lines 91; baseline 92.5, 85.5, 89.2, 93.9), and `npm audit --omit=dev --audit-level=high`. The audit of all dependencies is informational, because the remaining advisory (picomatch, ReDoS) is in build and test tooling that is not shipped and has no non-breaking fix yet.
+ Docker: image build, a smoke test of `/api/health`, and a Trivy scan that fails on fixable HIGH or CRITICAL findings. The runtime stage runs `apk upgrade` and removes pip, setuptools and wheel, which the first scan flagged (Alpine krb5-libs, bundled `jaraco.context` and `wheel`).
+ CodeQL for Python and JavaScript/TypeScript on pull requests, pushes and weekly. Dependabot opens weekly update PRs (pip, npm, Docker, GitHub Actions) against `develop`.
+ New dev tools (`ruff`, `pytest-cov`, `pip-audit`) are in `requirements-dev.in` and pinned in `requirements-dev.txt`; `@vitest/coverage-v8` is a frontend devDependency.
+ Repository settings: secret scanning and push protection enabled. Branch protection requiring these checks is a follow-up once the pipeline has proven stable.
Docker: Multi-stage build producing a single lightweight image run via docker run -p 5005:5005 -v wind_data:/app/data wind-map

# versioning (SCRUM-91)
the app version follows the release version (semantic versioning, e.g. 0.2.0 ↔ release/tag v0.2.0)
+ Single source of truth: `VERSION` file in the project root (plain `MAJOR.MINOR.PATCH`, no "v").
+ Backend reads it for the FastAPI app version (`/docs`) and returns it from `GET /api/health` as `version`.
+ Frontend reads it at build time (Vite `__APP_VERSION__`) and shows it in the navbar as `vX.Y.Z`.
+ `frontend/package.json` `version` must match `VERSION`; tests fail if they differ.
+ For every release: update `VERSION` and `frontend/package.json` to the release number before tagging `vX.Y.Z`.

# git and code layout
locate the project in /Users/fredames/Projects/wind-map

include gitignore, dockerignore, requirements.txt, Dockerfile

workflow (SCRUM-111): every change, including documentation and steering rules, is made on a ticket branch (`feature/SCRUM-xxx-...`) created from `develop` and merged by PR; there are no direct commits to `develop` or `master`. When the user asks to "create ticket to ...", the agent creates the ticket with a full plan and waits for explicit direction before implementing it.
rules for AI coding tools (SCRUM-119, SCRUM-111): `.kiro/steering/*.md` is the single source of truth. `.config/antigravity/instructions.md`, `GEMINI.md` (project root, read by Antigravity) and `AGENTS.md` (project root, read by Devin, SCRUM-128) are generated from those files by `python scripts/sync-ai-rules.py` and must not be edited by hand; `backend/tests/test_ai_rules_sync.py` fails (and so does CI) when one is out of date or `AGENTS.md` exceeds 16 KiB.
+ Devin workflows (SCRUM-128): skills in `.agents/skills/` (`spec-workflow`, `ci-checks`, `release`, `rebuild-container`) and a `Stop` hook in `.devin/hooks.v1.json` that runs `scripts/rebuild-container.sh` (the Devin equivalent of `.kiro/hooks/rebuild-wind-map.json`; skipped when Docker is not available).
branching (SCRUM-94): work happens on ticket branches (`feature/PROJ-123-...` or `fix/PROJ-123-...`) merged into `develop`, and `develop` is merged into `master` for releases. A ticket branch is deleted locally and on GitHub as soon as it is merged into `develop` or `master`, after confirming it is fully merged. `develop` and `master` are never deleted. Rules: `.kiro/steering/commit-rules.md`.

# testing and documentation
Testing & Docs: Unit and integration tests (pytest for backend, frontend component tests) with comprehensive README.md.
+ Backend test setup (SCRUM-92): `backend/tests/conftest.py` gives every test its own temporary SQLite file (never the repo's `data/` directory, and independent of the working directory) and blocks real Open-Meteo calls; tests configure responses through the `open_meteo` fixture. Payload builders live in `backend/tests/factories.py`.
+ Frontend test setup (SCRUM-92): shared Leaflet mock (`src/test/leafletMock.ts`, used via `vi.mock('leaflet', () => import(...))`), data builders (`src/test/fixtures.ts`) and a setup file (`src/test/setup.ts`) that unmounts components after each test. Test files are type-checked by `npm run typecheck`.

# performance
the application should be respond to users request within 3 seconds 
