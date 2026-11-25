"""Application configuration settings."""

import os
import re
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


# Build metadata (SCRUM-159): the short commit hash shown with the version. The image gets it as
# the GIT_SHA build arg (`scripts/rebuild-container.sh`), so a source build without a repo can
# still report which commit it came from. VERSION itself stays plain semver.
GIT_SHA_PATTERN = re.compile(r"[0-9a-f]{4,40}", re.IGNORECASE)


def read_git_sha(value: str | None = None) -> str:
    """Short commit hash from GIT_SHA, or "" when the build has none or it is malformed."""
    sha = (os.getenv("GIT_SHA", "") if value is None else value).strip()
    return sha if GIT_SHA_PATTERN.fullmatch(sha) else ""


def compose_version(version: str, sha: str) -> str:
    """`X.Y.Z-<hash>`, or plain `X.Y.Z` when there is no usable commit hash (SCRUM-159)."""
    base, hash_value = version.strip(), sha.strip()
    return f"{base}-{hash_value}" if GIT_SHA_PATTERN.fullmatch(hash_value) else base


APP_VERSION = compose_version(read_app_version(), read_git_sha())

# Cache settings
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "1800"))  # 30 minutes


def parse_cors_origins(value: str | None) -> list[str]:
    """Comma-separated list of allowed cross-origin hosts. Empty means same-origin only."""
    return [o.strip() for o in (value or "").split(",") if o.strip()]


# CORS (SCRUM-92): the app serves its own frontend, and `npm run dev` proxies /api through
# Vite, so cross-origin access is off by default. Set CORS_ORIGINS to enable it,
# e.g. CORS_ORIGINS=http://localhost:5173
CORS_ORIGINS = parse_cors_origins(os.getenv("CORS_ORIGINS"))

# Access control (SCRUM-134): the public Cloud Run deployment is protected by one shared password.
# Unset or empty disables authentication, which keeps local development, `docker run` and the
# test suite open. The value comes from Secret Manager on Cloud Run, never from the image.
APP_PASSWORD = os.getenv("APP_PASSWORD", "").strip()

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
# Ocean currents live on their own host (SCRUM-96).
OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
# Land/water test for current cells (SCRUM-238): the Marine land mask is coarser than the chart,
# so a cell it calls sea can sit on a narrow island. Elevation puts the chevron back on water.
OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
# A current cell whose centre is above this elevation is land, not water (SCRUM-238).
LAND_ELEVATION_THRESHOLD_M = 0.5

# Open-Meteo HTTP client (SCRUM-92: one place for timeouts and retries)
OPEN_METEO_TIMEOUT_SECONDS = 15.0  # single-point forecast
OPEN_METEO_GRID_TIMEOUT_SECONDS = 20.0  # batched grid request (up to 400 points)
OPEN_METEO_MARINE_TIMEOUT_SECONDS = 20.0  # batched marine request (same grid size)
OPEN_METEO_ELEVATION_TIMEOUT_SECONDS = 8.0  # batched elevation lookup for a grid's cells
OPEN_METEO_GEOCODING_TIMEOUT_SECONDS = 5.0  # interactive search box
OPEN_METEO_RETRIES = 2  # connection retries for forecast requests
OPEN_METEO_GEOCODING_RETRIES = 0  # don't make the search box wait on retries

# Map Settings
CARTO_API_KEY = os.getenv("CARTO_API_KEY", "").strip()

# Supported weather models
AVAILABLE_MODELS = [
    {"id": "best_match", "name": "Open-Meteo (Best Match)"},
    {"id": "ecmwf_ifs", "name": "ECMWF IFS HRES 9 km"},
    {"id": "ecmwf_aifs025_single", "name": "ECMWF AIFS (AI)"},
    {"id": "gfs_seamless", "name": "NOAA GFS Seamless"},
    {"id": "icon_seamless", "name": "DWD ICON Seamless"},
]
MODEL_IDS = frozenset(m["id"] for m in AVAILABLE_MODELS)
# Retired model ids are answered as their replacement for one release (SCRUM-226), so a cached
# frontend that still sends `ecmwf_ifs04` gets ECMWF values instead of a 422.
MODEL_ALIASES: dict[str, str] = {"ecmwf_ifs04": "ecmwf_ifs"}
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

# Per-model forecast metadata (SCRUM-115). The UI shows the update cadence, the time horizon and
# the derived run times, and `/api/weather/grid?time=` only accepts hours inside the selected
# model's horizon. Source of truth for the values is the model table at
# frontend/src/assets/weather-models.md (update frequency and time horizon columns); horizons are
# capped at Open-Meteo's 16-day maximum. best_match is a composite, so it uses Open-Meteo's
# documented 7-day default rather than a single model's horizon.
MODEL_METADATA: dict[str, dict[str, object]] = {
    "best_match": {"update_hours": 1, "update_cycles_utc": list(range(24)), "horizon_hours": 168},
    "ecmwf_ifs": {"update_hours": 6, "update_cycles_utc": [0, 6, 12, 18], "horizon_hours": 360},
    # AIFS (SCRUM-227) is ECMWF's AI model: 6-hourly cycles and natively 6-hourly steps, which
    # Open-Meteo interpolates to hourly, and no wind gusts at all.
    "ecmwf_aifs025_single": {"update_hours": 6, "update_cycles_utc": [0, 6, 12, 18], "horizon_hours": 360},
    "gfs_seamless": {"update_hours": 6, "update_cycles_utc": [0, 6, 12, 18], "horizon_hours": 384},
    "icon_seamless": {"update_hours": 6, "update_cycles_utc": [0, 6, 12, 18], "horizon_hours": 180},
}
if set(MODEL_METADATA) != MODEL_IDS:
    raise ValueError("MODEL_METADATA must describe every entry in AVAILABLE_MODELS")


def model_metadata(model: str) -> dict[str, object]:
    """Metadata for `model`; unknown ids fall back to the default model's entry."""
    return MODEL_METADATA.get(model, MODEL_METADATA[DEFAULT_MODEL])


def model_horizon_hours(model: str) -> int:
    return int(model_metadata(model)["horizon_hours"])


def model_horizon_days(model: str) -> int:
    """Whole days needed to cover the model's horizon (Open-Meteo caps a request at 16)."""
    return min(16, -(-model_horizon_hours(model) // 24))


# Cache keys round coordinates to 2 decimals (~1.1 km), for point and grid caches.
COORD_CACHE_PRECISION = 2

# Wind grid limits (per axis) to prevent runaway requests. Open-Meteo charges one call per point
# against 600 per minute (SCRUM-194), so 20 x 20 = 400 points leaves 200 for a pan inside the same
# window; the previous 30 x 30 = 900 could never fit and always ended in a quota 503.
GRID_MAX_DIM = 20

# Open-Meteo answers 414 Request-URI Too Large to a URL holding hundreds of coordinates (SCRUM-192),
# so a view is fetched in chunks of at most this many points (~3.3 KB per request).
GRID_REQUEST_MAX_POINTS = 150

# Ocean currents (SCRUM-96): MeteoFrance SMOC via Open-Meteo Marine covers 10 days hourly,
# which is the layer's horizon regardless of the selected weather model.
CURRENT_HORIZON_HOURS = 240

# A new location within this many degrees (~500 m) of a saved one is treated as the same.
DUPLICATE_LOCATION_RADIUS_DEG = 0.005

# In-app feedback (SCRUM-179): POST /api/feedback files a Jira issue through one service account.
# The feature is on only when the base URL, email and API token are all set; the credentials come
# from the environment or a secret store and are never returned by the API or logged.
JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "").strip().rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "").strip()
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "").strip()
JIRA_FEEDBACK_PROJECT = os.getenv("JIRA_FEEDBACK_PROJECT", "").strip() or "SCRUM"
JIRA_TIMEOUT_SECONDS = 10.0
FEEDBACK_LABEL = "in-app-feedback"
FEEDBACK_MAX_BODY_BYTES = 1_000_000  # 1 MB


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


FEEDBACK_MAX_PER_HOUR = _positive_int("FEEDBACK_MAX_PER_HOUR", 5)  # per client IP
FEEDBACK_GLOBAL_MAX_PER_HOUR = FEEDBACK_MAX_PER_HOUR * 4  # all clients together


def feedback_enabled() -> bool:
    """True when every Jira setting needed to file a ticket is present."""
    return bool(JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN)
