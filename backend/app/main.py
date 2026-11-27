"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app import config
from backend.app.auth import BasicAuthMiddleware
from backend.app.config import APP_VERSION, CARTO_API_KEY, CORS_ORIGINS, STATIC_DIR
from backend.app.database import clean_expired_cache, init_db
from backend.app.routers import currents, feedback, geocode, grid, locations, maps, quota, tides, waves, weather
from backend.app.services import land_mask, open_meteo, open_meteo_usage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and default seed, then drop expired cache rows
    init_db()
    clean_expired_cache()
    # Drop usage rows past the retention window, then batch the new ones in the background (SCRUM-327).
    open_meteo_usage.prune()
    open_meteo_usage.start()
    # Inflate the 1 km land mask before the first wave request needs it (SCRUM-273), off the loop.
    await land_mask.preload()
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
        # Write the buffered usage rows, then release the pooled client (SCRUM-174, SCRUM-327).
        await open_meteo_usage.stop()
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


# The cheap defences for a single-page app behind one shared password (SCRUM-272). The policy
# lists what the app actually loads: its own bundle and hashed assets, inline style attributes
# (Leaflet and the Vite build both set them), tiles and upstream services over https, and the
# blob:/data: URLs the map export's canvas work uses.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    # `same-origin` strips the Referer from the cross-origin tile requests the keyless base layers
    # make, and the OpenStreetMap tile usage policy requires one (it forbids a restrictive policy
    # outright); the volunteer servers answer such tiles with "Access blocked" (SCRUM-288). This
    # sends only the origin, never the path, to other hosts.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' https:; "
        "worker-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


# Register API routers
app.include_router(locations.router)
app.include_router(weather.router)
app.include_router(grid.router)
app.include_router(quota.router)
app.include_router(currents.router)
app.include_router(waves.router)
app.include_router(tides.router)
app.include_router(geocode.router)
app.include_router(feedback.router)
app.include_router(maps.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def get_config():
    return {
        "carto_api_key": CARTO_API_KEY,
        # Only the on/off flag: the Jira credentials never leave the server (SCRUM-179).
        "feedback_enabled": config.feedback_enabled(),
        "google_satellite_enabled": bool(config.GCP_MAP_KEY),
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


def is_api_path(full_path: str) -> bool:
    """Whether a path belongs to the API namespace: `/api` itself or anything under it."""
    return full_path == "api" or full_path.startswith("api/")


def spa_response(full_path: str, static_dir: Path = STATIC_DIR):
    """Answer one request from the build, or with JSON when it names a missing API route.

    The catch-all route matches every path, so without the API branch an unknown endpoint would
    answer the SPA shell with 200: a typo would look like a working route, clients would parse
    HTML as JSON, and monitoring would never see the 404 (SCRUM-277). Every other path keeps the
    shell so client-side routes such as `/map` still load.
    """
    if is_api_path(full_path):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return FileResponse(resolve_static_file(full_path, static_dir) or static_dir / "index.html")


# Serve static frontend if available
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return spa_response(full_path)
