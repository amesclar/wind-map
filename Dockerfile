# ==========================================
# Stage 1: Build React/Vite Frontend Assets
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Install dependencies
COPY frontend/package*.json ./
RUN npm install

# Build static assets. VERSION sits one level above the frontend sources,
# matching the repo layout that frontend/appVersion.ts expects (SCRUM-91).
COPY VERSION /VERSION
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Install Python dependencies (SCRUM-102)
# ==========================================
FROM python:3.15-alpine AS python-deps
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ==========================================
# Stage 3: Python Backend Runtime (Alpine, no build tools or test deps)
# ==========================================
FROM python:3.15-alpine AS runtime
WORKDIR /app

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DATA_DIR=/app/data \
    DATABASE_PATH=/app/data/wind_map.db \
    STATIC_DIR=/app/static

# Create data and static directories. Also (SCRUM-108): pick up Alpine security fixes that are newer
# than the base image, and remove pip, setuptools and wheel, which the app does not need at runtime
# and which the image scan flagged (vulnerable bundled copies).
RUN mkdir -p /app/data /app/static \
    && apk upgrade --no-cache \
    && pip uninstall -y pip setuptools wheel

# Copy only the installed packages (pip, wheel caches and build tooling stay behind)
COPY --from=python-deps /install /usr/local

# Copy compiled frontend from Stage 1
COPY --from=frontend-builder /build/dist /app/static

# Copy backend application and app version (SCRUM-91)
COPY backend /app/backend
COPY VERSION /app/VERSION

# Expose web server port
EXPOSE 5005

# Declare persistent data volume
VOLUME ["/app/data"]

# Run FastAPI app with Uvicorn
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "5005"]
