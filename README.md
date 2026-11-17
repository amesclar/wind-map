# Wind Map 🌬️🗺️

A standalone, minimalist dark-mode application that displays live weather forecasts and meteorological wind barbs on an interactive map.

Built with **FastAPI (Python 3.11+)** on the backend and **React + Vite + Leaflet + TailwindCSS** on the frontend, packaged in a self-contained multi-stage Docker container.

---

## Features

- **Interactive Map:** Powered by Leaflet.js with CartoDB Dark Matter tiles.
- **Meteorological Wind Barbs:** Custom SVG markers displaying wind direction and speed feathers (calm circles, 5kt half-barbs, 10kt full-barbs, 50kt pennants) with temperature-based color coding.
- **Wind Grid Overlay *(SCRUM-86, SCRUM-89)*:** A continuous grid of wind barbs covering the entire visible viewport, drawn and temperature-colored the same way as the drawer's barbs. Speed is shown by the number of barbs (5 kt half barb, 10 kt full barb, 50 kt pennant; calm is a circle). Grid density targets one barb per ~80px and auto-adjusts on pan/zoom. Toggled via Map Settings (default: on).
- **Clickable Barbs *(SCRUM-88, SCRUM-89)*:** Clicking any grid barb loads a full 48-hour forecast for that exact lat/lon into the drawer without saving it as a location — useful over open water where no place name exists. The selected barb is drawn larger with a white highlight ring and matches the drawer's leftmost barb. Clicking a saved location marker restores normal drawer behaviour.
- **48-Hour Forecast Timeline Drawer:** Collapsible bottom drawer showing 16 time slices (every 3 hours for 48 hours) with temperature and wind speed/direction. The first ("Now") slice shows Open-Meteo current conditions. Each slice also shows the wind direction in whole degrees true (e.g. `220°T`) below the wind barb and above the wind speed *(SCRUM-90)*.
- **Multiple Weather Models:** Dropdown selector supporting:
  - *Open-Meteo (Best Match)* (default)
  - *ECMWF IFS 0.4°*
  - *NOAA GFS Seamless*
  - *DWD ICON Seamless*
- **Autocomplete Location Search:** Verified geocoding lookup via Open-Meteo Geocoding API with state/region and country disambiguation.
- **Location Management:** Saved locations modal with instant selection and minus (`-`) buttons for removal.
- **Unit Customization:** One-click toggle between Imperial (°F, knots) and Metric (°C, km/h), with granular selectors for speed (knots, km/h, mph, m/s) and wind direction (barbs, cardinal directions, degrees).
- **Timezone Support:** Pacific Time by default, with quick switching across major world timezones.
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
    │   ├── components/          # MapView, WindOverlay, WindBarb, TimelineDrawer, Navbar, modals, mapTiles.ts
    │   ├── hooks/               # useMapSettings, useUnitPreferences, useLocations, useAllWeather,
    │   │                        # useDrawerForecast, useWindGrid, useLocalStorageState, useLatest
    │   ├── api/                 # Typed API client (one request() helper, ApiError)
    │   ├── utils/               # units.ts (display formatting), html.ts (escaping)
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
   (`requirements.txt` holds runtime dependencies only and is what the Docker image installs; `requirements-dev.txt` adds the test tools.)
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
| `GET`    | `/api/weather/models` | List available weather models                        |
| `GET`    | `/api/weather`        | Get 48h forecast & current conditions for a location |
| `GET`    | `/api/weather/all`    | Get current conditions for all saved locations       |
| `GET`    | `/api/weather/point`  | Get 48h forecast for an arbitrary lat/lon point (no saved location needed) |
| `GET`    | `/api/weather/grid`   | Get current wind for a lat/lon bounding box grid (powers the wind barb overlay) |
| `GET`    | `/api/geocode?q=...`  | Autocomplete search for cities & coordinates         |
| `GET`    | `/docs`               | Interactive Swagger / OpenAPI documentation          |

The weather endpoints accept `model` (one of the ids from `/api/weather/models`; anything else is a 422) and `timezone` (IANA name, default `America/Los_Angeles`). Open-Meteo failures return 502 with a short message; details are in the server log.

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
- Selected map barb matches the drawer's leftmost barb (direction, barb count and color) *(SCRUM-89)*
- `fetchWindGrid` and `fetchPointWeather` API client functions (endpoint URLs, query params, error handling)
- `MapSettingsModal` wind overlay toggle (aria-pressed state, callback direction)
- Timeline drawer rendering, empty state, stacking context isolation
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
```

Backend tests use a temporary database per test and block real Open-Meteo calls (`backend/tests/conftest.py`); use the `open_meteo` fixture to stub responses. Frontend tests share a Leaflet mock and data builders in `frontend/src/test/`.
