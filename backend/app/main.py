"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.config import APP_VERSION, CARTO_API_KEY, CORS_ORIGINS, STATIC_DIR
from backend.app.database import clean_expired_cache, init_db
from backend.app.routers import geocode, grid, locations, weather

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and default seed, then drop expired cache rows
    init_db()
    clean_expired_cache()
    yield


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
app.include_router(geocode.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/config")
def get_config():
    return {
        "carto_api_key": CARTO_API_KEY,
    }


# Serve static frontend if available
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If specific file exists in static dir, serve it
        target_file = STATIC_DIR / full_path
        if full_path and target_file.is_file():
            return FileResponse(target_file)
        return FileResponse(STATIC_DIR / "index.html")
