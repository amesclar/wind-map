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

# Map Settings
CARTO_API_KEY = os.getenv("CARTO_API_KEY", "").strip()

# Supported weather models
AVAILABLE_MODELS = [
    {"id": "best_match", "name": "Open-Meteo (Best Match)"},
    {"id": "ecmwf_ifs04", "name": "ECMWF IFS 0.4°"},
    {"id": "gfs_seamless", "name": "NOAA GFS Seamless"},
    {"id": "icon_seamless", "name": "DWD ICON Seamless"},
]

