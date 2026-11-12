"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.config import STATIC_DIR
from backend.app.database import init_db
from backend.app.routers import geocode, locations, weather


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite database and default seed
    init_db()
    yield


app = FastAPI(
    title="Wind Map API",
    description="Weather and wind predictions on an interactive map",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(locations.router)
app.include_router(weather.router)
app.include_router(geocode.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


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

