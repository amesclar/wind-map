"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.config import APP_VERSION, CARTO_API_KEY, CORS_ORIGINS, STATIC_DIR
from backend.app.database import clean_expired_cache, init_db
from backend.app.routers import currents, geocode, grid, locations, weather
from backend.app.services import open_meteo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and default seed, then drop expired cache rows
    init_db()
    clean_expired_cache()
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

# Register API routers
app.include_router(locations.router)
app.include_router(weather.router)
app.include_router(grid.router)
app.include_router(currents.router)
app.include_router(geocode.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def get_config():
    return {
        "carto_api_key": CARTO_API_KEY,
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
