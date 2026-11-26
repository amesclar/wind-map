"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app import config
from backend.app.auth import BasicAuthMiddleware
from backend.app.config import APP_VERSION, CARTO_API_KEY, CORS_ORIGINS, STATIC_DIR
from backend.app.database import clean_expired_cache, init_db
from backend.app.routers import currents, feedback, geocode, grid, locations, tides, waves, weather
from backend.app.services import open_meteo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and default seed, then drop expired cache rows
    init_db()
    clean_expired_cache()
    # NWS asks every client for a contact address (SCRUM-255): say so once at startup rather than
    # leaving it to be discovered in NOAA's traffic.
    if not config.nws_user_agent_is_custom():
        logger.warning(
            "NWS_USER_AGENT is not set: api.weather.gov asks every client for a contact address, "
            "so requests send the default %s. Set NWS_USER_AGENT to an app name and contact, "
            "e.g. 'wind-map/0.11 (you@example.com)'.",
            config.NWS_USER_AGENT,
        )
    try:
        yield
    finally:
        # Release the pooled Open-Meteo client (SCRUM-174).
        await open_meteo.close_client()


app = FastAPI(
    title="Wind Map API",
    description="Weather and wind predictions on an interactive map",
    version=APP_VERSION,
    lifespan=lifespan,
)

# CORS only when explicitly configured (CORS_ORIGINS). The API uses no cookies or auth,
# so credentials are never allowed cross-origin.
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

# Shared-password protection for the public deployment (SCRUM-134). It is a no-op while
# APP_PASSWORD is unset, and it wraps CORS because it is added last.
app.add_middleware(BasicAuthMiddleware)


def cache_control_for(path: str, content_type: str) -> str | None:
    """Cache policy for the built frontend (SCRUM-241).

    Vite names every chunk after its contents, so an asset URL never changes meaning and can be
    cached for good. The HTML shell names those chunks, so it must be revalidated: otherwise a
    tab (or a reload) can keep asking for chunk names a rebuild has removed, and the PDF export
    fails with "Failed to fetch dynamically imported module".
    """
    if path.startswith("/assets/"):
        return "public, max-age=31536000, immutable"
    if content_type.startswith("text/html"):
        return "no-cache"
    return None


@app.middleware("http")
async def static_cache_policy(request: Request, call_next):
    response = await call_next(request)
    policy = cache_control_for(request.url.path, response.headers.get("content-type", ""))
    if policy:
        response.headers["Cache-Control"] = policy
    return response


# Register API routers
app.include_router(locations.router)
app.include_router(weather.router)
app.include_router(grid.router)
app.include_router(currents.router)
app.include_router(waves.router)
app.include_router(tides.router)
app.include_router(geocode.router)
app.include_router(feedback.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def get_config():
    return {
        "carto_api_key": CARTO_API_KEY,
        # Only the on/off flag: the Jira credentials never leave the server (SCRUM-179).
        "feedback_enabled": config.feedback_enabled(),
    }


# Built once per build directory: the frontend bundle does not change while the app runs.
_FILE_INDEX: dict[Path, dict[str, Path]] = {}


def _static_file_index(static_dir: Path) -> dict[str, Path]:
    """Every file in the build, keyed by its relative POSIX path."""
    root = static_dir.resolve()
    index = _FILE_INDEX.get(root)
    if index is None:
        index = {path.relative_to(root).as_posix(): path for path in root.rglob("*") if path.is_file()}
        _FILE_INDEX[root] = index
    return index


def resolve_static_file(full_path: str, static_dir: Path = STATIC_DIR) -> Path | None:
    """The built file for `full_path`, or None when the build has no such file.

    The lookup runs over the files enumerated from the build (SCRUM-174), so the request can
    only ever name a file that is already there: `../VERSION` is not a key and falls back to
    `index.html` like any client-side route. No request path is used to build a filesystem path.
    """
    if not full_path:
        return None
    return _static_file_index(static_dir).get(full_path)


# Serve static frontend if available
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # An existing file inside the build is served as-is; everything else is the SPA shell.
        return FileResponse(resolve_static_file(full_path) or STATIC_DIR / "index.html")
