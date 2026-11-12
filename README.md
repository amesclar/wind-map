# Wind Map 🌬️🗺️

A standalone, minimalist dark-mode application that displays live weather forecasts and meteorological wind barbs on an interactive map.

Built with **FastAPI (Python 3.11+)** on the backend and **React + Vite + Leaflet + TailwindCSS** on the frontend, packaged in a self-contained multi-stage Docker container.

---

## Features

- **Interactive Map:** Powered by Leaflet.js with CartoDB Dark Matter tiles.
- **Meteorological Wind Barbs:** Custom SVG markers displaying wind direction and speed feathers (calm circles, 5kt half-barbs, 10kt full-barbs, 50kt pennants) with temperature-based color coding.
- **48-Hour Forecast Timeline Drawer:** Collapsible bottom drawer showing 16 time slices (every 3 hours for 48 hours) with temperature, wind speed/direction, and relative humidity.
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
├── Dockerfile                   # Multi-stage build (Node build -> Python runtime)
├── docker-compose.yml           # Optional compose configuration
├── requirements.txt             # Python backend dependencies (FastAPI, httpx, etc.)
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application & static asset server
│   │   ├── config.py            # Configuration settings & defaults
│   │   ├── database.py          # SQLite schema, migrations & seed
│   │   ├── models.py            # Pydantic data schemas
│   │   ├── routers/             # API endpoints (locations, weather, geocode)
│   │   └── services/            # Open-Meteo forecast & geocoding services
│   └── tests/                   # Backend pytest suite (API & weather cache tests)
└── frontend/
    ├── src/
    │   ├── components/          # MapView, WindBarb, TimelineDrawer, Navbar, etc.
    │   ├── api/                 # Typed API client
    │   ├── types.ts             # TypeScript interfaces
    │   └── App.tsx              # Core state management
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

Open your browser at **[http://localhost:5005](http://localhost:5005)**.

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
   pip install -r requirements.txt
   ```
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

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check endpoint |
| `GET` | `/api/locations` | List all saved locations |
| `POST` | `/api/locations` | Save a new verified location |
| `DELETE` | `/api/locations/{id}` | Delete a saved location |
| `GET` | `/api/weather/models` | List available weather models |
| `GET` | `/api/weather` | Get 48h forecast & current conditions for a location |
| `GET` | `/api/weather/all` | Get current conditions for all saved locations |
| `GET` | `/api/geocode?q=...` | Autocomplete search for cities & coordinates |
| `GET` | `/docs` | Interactive Swagger / OpenAPI documentation |

---

## Testing

Backend test suite coverage includes:
- Health check verification
- Database seeding with default location (Oak Harbor, WA)
- Location CRUD lifecycle (create, duplicate detection, delete)
- Open-Meteo weather forecast retrieval (16 data points over 48 hours)
- 30-minute SQLite caching verification (<0.5s response time on cache hit)
- Mathematical conversion helpers (wind speed units, temperature, cardinal degrees)

Run tests locally via:
```bash
pytest backend/tests
```

