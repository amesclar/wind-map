# Wind Map 🌬️🗺️

A standalone, minimalist dark-mode application that displays live weather forecasts and meteorological wind barbs on an interactive map.

Built with **FastAPI (Python 3.14)** on the backend and **React + Vite + Leaflet + TailwindCSS** on the frontend, packaged in a self-contained multi-stage Docker container.

---

## Features

- **Interactive Map:** Powered by Leaflet.js with CartoDB Dark Matter tiles.
- **Meteorological Wind Barbs:** Custom SVG markers displaying wind direction and speed feathers (calm circles, 5kt half-barbs, 10kt full-barbs, 50kt pennants) with temperature-based color coding.
- **Wind Grid Overlay *(SCRUM-86, SCRUM-89)*:** A continuous grid of wind barbs covering the entire visible viewport, drawn and temperature-colored the same way as the saved-location barbs. Speed is shown by the number of barbs (5 kt half barb, 10 kt full barb, 50 kt pennant; calm is a circle). Grid density targets one barb per ~80px and auto-adjusts on pan/zoom. Toggled via Map Settings (default: on).
- **Wind Color Gradient *(SCRUM-121, SCRUM-122, SCRUM-123, SCRUM-124)*:** A smooth color field for wind speed drawn under the barbs, from the same grid fetch the barbs use, with bilinear interpolation and the legend's exact color stops (0 kt purple → 5 blue → 10 green → 15 yellow → 20 orange → 25 red → 40/45 dark red → 50+ gray). A full-width legend above the map attribution labels the scale in your speed unit, and barbs gain a dark halo so their temperature colors stay readable. Toggled separately from the barbs in Map Settings (default: off).
- **Clickable Barbs *(SCRUM-88, SCRUM-89, SCRUM-126)*:** Clicking any grid barb selects it — drawn larger with a white highlight ring — and opens a small pop-up with that point's wind speed, direction and temperature in your units, without saving it as a location and without another request — useful over open water where no place name exists. Clicking a saved location marker switches back to that location's highlight and pop-up.
- **Forecast Time Selector *(SCRUM-127)*:** a bar under the map names the selected model with its update cadence, time horizon and last/next run time (for example `NOAA GFS Seamless · every 6 h · 16 days · run 12:00 UTC (next 18:00)`), and runs a track from now to that horizon with day labels, a "now" marker and a handle that moves in 1-hour steps. Drag or click the track, use the arrows, the keyboard (←/→ step, Home/End jump, Space plays) or play-pause (3 hours per tick, waiting for each step's data); Now returns to live values. Moving it redraws the barbs, the saved-location markers and the colour gradient for that hour, and both pop-ups name it. The selected hour is memory-only: the app opens at "now".
- **Map export *(SCRUM-116, SCRUM-117)*:** the **Save** button in the top bar opens an export dialog for the view on screen — PNG or JPEG at 2x (with a quality choice for JPEG), or a single-page PDF on Letter or A4 in portrait or landscape, fitted to the page with its aspect ratio kept. Every file carries a header (the hour shown in your timezone and in UTC, the model and its run, the capture time), a legend (wind-barb feathers for calm/5/10/50 in your speed unit and the barb temperature colours) and a footer (units, the base-map attribution and the app version). Leaflet controls and pop-ups are left out, the dialog previews the file name (named after the hour, e.g. `wind-map_2026-11-18_1400PST.pdf`), and the capture library and jsPDF load only when you export.
- **Forecast-time data *(SCRUM-115)*:** the weather endpoints accept an hour-aligned `time` for any hour from now up to the selected model's horizon (7 days for Open-Meteo Best Match, 15 for ECMWF IFS, 16 for NOAA GFS, 7.5 for DWD ICON), and `/api/weather/models` reports each model's update cadence, horizon and last/next run time. `MapView` and the grid hook take the resulting `validTime`, which the selector above sets; without a selection the app shows current conditions.
- **Multiple Weather Models:** Dropdown selector supporting:
  - *Open-Meteo (Best Match)* (default)
  - *ECMWF IFS 0.4°*
  - *NOAA GFS Seamless*
  - *DWD ICON Seamless*
- **Autocomplete Location Search:** Verified geocoding lookup via Open-Meteo Geocoding API with state/region and country disambiguation.
- **Location Management:** Saved locations modal with instant selection and minus (`-`) buttons for removal.
- **Preferences Pop-up *(SCRUM-107)*:** A gear icon in the top bar opens Preferences: timezone, temperature (°F / °C), wind speed (knots, km/h, mph, m/s) and wind direction display (barbs, cardinal directions, degrees). Each setting is independent (°F/°C changes only the temperature unit) and is saved in the browser, so it survives a reload.
- **Timezone Support:** Pacific Time by default, with quick switching across major world timezones from Preferences.
- **SQLite Persistence & Caching:** Forecast data is cached locally for 30 minutes (TTL) to ensure rapid response times (<3s SLA) and minimize external API calls.
- **Default / Fallback Location:** Automatically attempts browser geolocation; defaults to Oak Harbor, Washington (`48.2939° N, 122.6064° W`) if permission is denied or on fresh launch.

---

## Architecture

```
wind-map/
├── Dockerfile                   # Multi-stage build (Node build -> Python deps -> Alpine runtime)
├── docker-compose.yml           # Optional compose configuration
├── requirements.txt             # Python backend dependencies (FastAPI, httpx, etc.)
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application & static asset server
│   │   ├── config.py            # Settings & named constants (defaults, forecast shape, limits, timeouts)
│   │   ├── database.py          # All table definitions, versioned migrations (PRAGMA user_version) & seed
│   │   ├── locations_repo.py    # Data access for saved locations
│   │   ├── dependencies.py      # Shared query params (model validation, timezone)
│   │   ├── units.py             # Unit conversions & cache-key rounding
│   │   ├── models.py            # Pydantic data schemas
│   │   ├── routers/             # API endpoints (locations, weather, grid, geocode)
│   │   └── services/            # open_meteo.py (shared HTTP client); weather_service.py (cache → fetch → parse → store),
│   │                            # forecast_parser.py (pure parsing), forecast_cache.py (saved-location & point caches);
│   │                            # grid & geocoding services
│   └── tests/                   # Backend pytest suite (conftest.py fixtures, factories.py builders)
└── frontend/
    ├── src/
    │   ├── components/          # MapView, WindOverlay, WindBarb, ForecastTimeSelector, Navbar, modals,
    │   │                        # MapExportControl, mapTiles.ts
    │   ├── hooks/               # useMapSettings, useUnitPreferences, useTimezone, useLocations, useAllWeather,
    │   │                        # useWindGrid, useLocalStorageState, useLatest
    │   ├── api/                 # Typed API client (one request() helper, ApiError)
    │   ├── utils/               # units.ts (display formatting), forecastWindow.ts (selector maths),
    │   │                        # mapExport.ts (image header/legend/name), captureMap.ts (canvas capture),
    │   │                        # modelGuide.ts (model table), html.ts (escaping)
    │   ├── test/                # Shared Leaflet mock, fixtures, test setup
    │   ├── constants.ts         # Defaults, timezone list, storage keys
    │   ├── types.ts             # TypeScript interfaces
    │   └── App.tsx              # Wires the hooks to the components
    ├── package.json             # React, Leaflet, TailwindCSS, Vite
    └── vite.config.ts           # Dev proxy configuration
```

---

## Quick Start with Docker

### 1. Build the Docker Image

```bash
docker build -t wind-map .
```

### 2. Run the Container with Persistent Storage

```bash
docker run -d -p 5005:5005 -v wind_data:/app/data --name wind-map wind-map
```

*(Optional: Pass your free CARTO API key to unlock watermark-free CARTO Dark Matter)*:
```bash
docker run -d -p 5005:5005 -e CARTO_API_KEY="$CARTO_API_KEY" -v wind_data:/app/data --name wind-map wind-map
```

Open your browser at **[http://localhost:5005](http://localhost:5005)**.

---

### Map Layers & CARTO API Key

- **OpenStreetMap Dark (Default):** Clean, high-contrast dark theme that requires **no API key** and has no watermarks.
- **CARTO Dark Matter:** CARTO requires a free API key to remove their *"API KEY REQUIRED"* watermark.
  1. Visit **[carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)** to get an instant free key (up to 5 million requests/month).
  2. Click the **Map** button in the app's top bar to paste and save your key directly in the UI, or pass it via `CARTO_API_KEY` environment variable.

To stop the container:
```bash
docker stop wind-map && docker rm wind-map
```

---

## Local Development Setup

Requires **Node 24** (`frontend/package.json` `engines`) and **Python 3.14** — the same versions CI and the Docker image use.

### Backend (Python)

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements-dev.txt
   ```
   (`requirements.txt` holds pinned runtime dependencies only and is what the Docker image installs; `requirements-dev.txt` adds the pinned test tools.)

#### Updating Python dependencies
`requirements.txt` and `requirements-dev.txt` are generated and pinned with `==`, so every build installs the same versions, and the top-level `requirements.in` and `requirements-dev.in` are pinned to exact versions too: no `>=` ranges, so a rebuild never resolves something newer than what was tested. Do not edit the generated files by hand. To add or upgrade a package, change the exact version in `requirements.in` (runtime) or `requirements-dev.in` (tests), then regenerate in the same Python and OS as the Docker image, run the tests, and commit all changed files:
```bash
docker run --rm -v "$PWD":/w -w /w python:3.14-alpine sh -c \
  "pip install -q pip-tools && \
   pip-compile -q --strip-extras --annotation-style=line -o requirements.txt requirements.in && \
   pip-compile -q --strip-extras --annotation-style=line -o requirements-dev.txt requirements-dev.in"
```
To upgrade everything to the latest allowed versions, add `--upgrade` to both `pip-compile` commands.
3. Run backend tests:
   ```bash
   pytest backend/tests
   ```
4. Start development backend server:
   ```bash
   uvicorn backend.app.main:app --reload --port 5005
   ```

### Frontend (Node.js)

1. Navigate to `frontend/`:
   ```bash
   cd frontend
   npm install
   ```
2. Start Vite development server:
   ```bash
   npm run dev
   ```
3. Open **http://localhost:5173** (API requests are automatically proxied to port 5005).

Cross-origin API access is off by default. If you call the API from another origin, set `CORS_ORIGINS` (comma-separated), e.g. `CORS_ORIGINS=http://localhost:3000`.

---

## REST API Reference

| Method   | Endpoint              | Description                                          |
| -------- | --------------------- | ---------------------------------------------------- |
| `GET`    | `/api/health`         | Health check endpoint                                |
| `GET`    | `/api/locations`      | List all saved locations                             |
| `POST`   | `/api/locations`      | Save a new verified location                         |
| `DELETE` | `/api/locations/{id}` | Delete a saved location                              |
| `GET`    | `/api/weather/models` | List models with update cadence, horizon and run times |
| `GET`    | `/api/weather`        | Get 48h forecast & current conditions for a location |
| `GET`    | `/api/weather/all`    | Get current conditions (or one forecast hour) for all saved locations |
| `GET`    | `/api/weather/point`  | Get 48h forecast for an arbitrary lat/lon point (no saved location needed) |
| `GET`    | `/api/weather/grid`   | Get wind for a lat/lon bounding box grid, now or at a forecast hour (powers the barb overlay) |
| `GET`    | `/api/geocode?q=...`  | Autocomplete search for cities & coordinates         |
| `GET`    | `/docs`               | Interactive Swagger / OpenAPI documentation          |

The weather endpoints accept `model` (one of the ids from `/api/weather/models`; anything else is a 422) and `timezone` (IANA name, default `America/Los_Angeles`). Open-Meteo failures return 502 with a short message; details are in the server log.

`/api/weather`, `/api/weather/all`, `/api/weather/point` and `/api/weather/grid` also accept an optional `time` *(SCRUM-115)*: an ISO 8601, hour-aligned instant with an offset (e.g. `2026-11-23T12:00:00Z`). It must fall between the current hour and the selected model's horizon; otherwise the response is 422 with a message naming the limit. Omit it for live `current` conditions, which is what the app still requests. With `time`, `current` describes that hour (and `valid_time` repeats it), grid points carry their hour in `time`, and both the grid and forecast caches are keyed by hour.

---

## Versioning

The app version follows the release version *(SCRUM-91)*. The `VERSION` file in the project root (e.g. `0.2.0`) is the single source of truth: the backend reports it from `GET /api/health` and the API docs, and the navbar shows it as `v0.2.0`. For each release `vX.Y.Z`, update `VERSION` and `frontend/package.json` to `X.Y.Z` before tagging:

```bash
echo "X.Y.Z" > VERSION
(cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
```

Tests fail if the two files disagree.

---

## Testing

Backend test suite coverage includes:
- Health check verification
- Database seeding with default location (Oak Harbor, WA)
- Location CRUD lifecycle (create, duplicate detection, delete)
- Open-Meteo weather forecast retrieval (16 data points over 48 hours)
- 30-minute SQLite caching verification (<0.5s response time on cache hit)
- Mathematical conversion helpers (wind speed units, temperature, cardinal degrees)
- Point weather endpoint — arbitrary lat/lon forecast with correct N/S/E/W name formatting and coordinate validation
- Wind grid endpoint — bounding box grid generation, per-point caching, batch Open-Meteo fetch, bbox/dimension validation

Frontend test suite coverage includes:
- Wind barb SVG generation (feather counts, pennants, calm circles, direction encoding, temperature color, label rendering)
- Grid wind barb SVG and marker icons (temperature color with green fallback, barb counts by speed, calm circle, rotation, selected highlight ring) *(SCRUM-89)*
- Barb pop-up values in the chosen units, and the barb highlight clearing when a saved location is picked *(SCRUM-126)*
- Forecast window maths (steps, snapping, day marks, labels) and the selector's arrows, keyboard, Now and play behaviour with the model metadata *(SCRUM-127)*
- Both pop-ups naming the selected forecast hour, and the whole map moving when it changes *(SCRUM-127)*
- Image header, footer and file name (local and UTC time, model, units, attribution, version), the legend in each speed unit, and the captured composition *(SCRUM-116)*
- `fetchWindGrid` and `fetchPointWeather` API client functions (endpoint URLs, query params, error handling)
- `MapSettingsModal` wind overlay toggle (aria-pressed state, callback direction)
- `PreferencesModal` controls, close buttons, and saved preferences restored on reload *(SCRUM-107)*
- Map stacking context isolation, selected-marker highlight and pop-ups in the chosen units
- Full App integration: initial load, location selection via modal, map marker click, autocomplete add


Run tests locally via:

```bash
# Backend
pytest backend/tests

# Frontend
cd frontend && npm run test -- --run

# Frontend lint (TypeScript + React hooks rules, zero warnings)
cd frontend && npm run lint

# Frontend type check, including test files
cd frontend && npm run typecheck

# Backend suite inside the Docker test stage (SCRUM-152), which adds the bash that the
# shipped image omits; a plain `docker build .` still produces the runtime image
docker build --target test -t wind-map:test . && docker run --rm wind-map:test pytest --cov
```

Backend tests use a temporary database per test and block real Open-Meteo calls (`backend/tests/conftest.py`); use the `open_meteo` fixture to stub responses. Frontend tests share a Leaflet mock and data builders in `frontend/src/test/`.

## Quality and Security Checks (SCRUM-108)

GitHub Actions runs these on every pull request to `develop` or `master` and on pushes to those branches (`.github/workflows/`):

| Check | What it does | Run locally |
| :--- | :--- | :--- |
| Ruff | Python lint, including security and `UP` pyupgrade rules, and formatting (`ruff.toml`) | `ruff check . && ruff format --check .` |
| pytest coverage | Backend tests; fails below the threshold in `.coveragerc` | `pytest --cov` |
| pip-audit | Known vulnerabilities in `requirements.txt` | `pip-audit -r requirements.txt` |
| ESLint, `tsc` | Frontend lint and type-check | `cd frontend && npm run lint && npm run typecheck` |
| Vitest coverage | Frontend tests; fails below the thresholds in `frontend/vitest.config.ts` | `cd frontend && npm run test:coverage` |
| `npm audit` | Fails on high or critical advisories in production dependencies; the full audit is informational | `cd frontend && npm audit --omit=dev` |
| Docker build, smoke test, Trivy | Builds the image, checks `/api/health`, fails on fixable HIGH or CRITICAL vulnerabilities | `docker build -t wind-map:ci .` |
| CodeQL | Static analysis for Python and JavaScript/TypeScript (also weekly) | runs on GitHub |
| Dependabot | Weekly update PRs for pip, npm, Docker and GitHub Actions (target `develop`) | runs on GitHub |

Coverage thresholds were set a little below the baseline when added (backend 99%, frontend about 92% statements), so CI fails on a real drop. Raise them as coverage improves.

Ruff enforces lint and formatting (SCRUM-109): `ruff check .` includes the `UP` pyupgrade rules, and `ruff format --check .` fails on unformatted Python. Both run in CI. The formatting-only commit is listed in `.git-blame-ignore-revs`, so `git blame` skips it once that file is configured in your clone (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).
