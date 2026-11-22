"""Application configuration settings."""

import os
from pathlib import Path

# Paths
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data" if Path("/app/data").exists() else "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH = Path(os.getenv("DATABASE_PATH", DATA_DIR / "wind_map.db"))

STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static" if Path("/app/static").exists() else "./frontend/dist"))

# App version (SCRUM-91): single source of truth is the VERSION file in the project root
# (/app/VERSION in the container). Keep it equal to the release tag without the "v".
VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"


def read_app_version(path: Path = VERSION_FILE) -> str:
    try:
        return path.read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


APP_VERSION = read_app_version()

# Cache settings
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "1800"))  # 30 minutes


def parse_cors_origins(value: str | None) -> list[str]:
    """Comma-separated list of allowed cross-origin hosts. Empty means same-origin only."""
    return [o.strip() for o in (value or "").split(",") if o.strip()]


# CORS (SCRUM-92): the app serves its own frontend, and `npm run dev` proxies /api through
# Vite, so cross-origin access is off by default. Set CORS_ORIGINS to enable it,
# e.g. CORS_ORIGINS=http://localhost:5173
CORS_ORIGINS = parse_cors_origins(os.getenv("CORS_ORIGINS"))

# Default seeded location
DEFAULT_LOCATION = {
    "name": "Oak Harbor, WA",
    "latitude": 48.2939,
    "longitude": -122.6064,
    "admin1": "Washington",
    "country": "United States",
}

# External API endpoints
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"

# Open-Meteo HTTP client (SCRUM-92: one place for timeouts and retries)
OPEN_METEO_TIMEOUT_SECONDS = 15.0  # single-point forecast
OPEN_METEO_GRID_TIMEOUT_SECONDS = 20.0  # batched grid request (up to 900 points)
OPEN_METEO_GEOCODING_TIMEOUT_SECONDS = 5.0  # interactive search box
OPEN_METEO_RETRIES = 2  # connection retries for forecast requests
OPEN_METEO_GEOCODING_RETRIES = 0  # don't make the search box wait on retries

# Map Settings
CARTO_API_KEY = os.getenv("CARTO_API_KEY", "").strip()

# Supported weather models
AVAILABLE_MODELS = [
    {"id": "best_match", "name": "Open-Meteo (Best Match)"},
    {"id": "ecmwf_ifs04", "name": "ECMWF IFS 0.4°"},
    {"id": "gfs_seamless", "name": "NOAA GFS Seamless"},
    {"id": "icon_seamless", "name": "DWD ICON Seamless"},
]
MODEL_IDS = frozenset(m["id"] for m in AVAILABLE_MODELS)
DEFAULT_MODEL = "best_match"  # Open-Meteo picks the best model; no `models` param is sent
DEFAULT_TIMEZONE = "America/Los_Angeles"  # Pacific, per requirements

# Forecast shape: 16 slices every 3 hours = 48 hours, starting at the current hour.
FORECAST_POINTS = 16
FORECAST_STEP_HOURS = 3
# Hourly data starts at local midnight, so the last slice can be up to
# 23 + (16 - 1) * 3 = 68 hours in; 4 days (96 hours) covers that with a margin.
FORECAST_DAYS = 4
if not 23 + (FORECAST_POINTS - 1) * FORECAST_STEP_HOURS < FORECAST_DAYS * 24:
    raise ValueError("FORECAST_DAYS too small for FORECAST_POINTS and FORECAST_STEP_HOURS")

# Cache keys round coordinates to 2 decimals (~1.1 km), for point and grid caches.
COORD_CACHE_PRECISION = 2

# Wind grid limits (per axis) to prevent runaway requests.
GRID_MAX_DIM = 30

# A new location within this many degrees (~500 m) of a saved one is treated as the same.
DUPLICATE_LOCATION_RADIUS_DEG = 0.005

