# ==========================================
# Stage 1: Build React/Vite Frontend Assets
# ==========================================
FROM node:24-alpine AS frontend-builder
WORKDIR /build

# Build metadata (SCRUM-159): short commit hash appended to the displayed version.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

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
FROM python:3.14-alpine AS python-deps
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ==========================================
# Stage 3: Backend tests (SCRUM-152)
# ==========================================
# An opt-in target that is never part of the shipped image. Alpine has no bash and four backend
# tests run scripts/rebuild-container.sh through /bin/bash, so the suite needs this stage:
#   docker build --target test -t wind-map:test . && docker run --rm wind-map:test pytest --cov
# It stays before the runtime stage so a plain `docker build .` still ends on the runtime image.
FROM python:3.14-alpine AS test
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DATA_DIR=/app/data \
    DATABASE_PATH=/app/data/wind_map.db \
    STATIC_DIR=/app/static

RUN apk add --no-cache bash \
    && mkdir -p /app/data /app/static

# Test tooling pulls in the runtime pins through requirements-dev.txt
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

# The suite reads the repository itself (VERSION, frontend/package.json, the rule sources and the
# hooks), so this stage takes the whole context. .dockerignore keeps it small.
COPY . .

CMD ["pytest", "--cov"]

# ==========================================
# Stage 4: Python Backend Runtime (Alpine, no bash, build tools or test deps)
# ==========================================
FROM python:3.14-alpine AS runtime
WORKDIR /app

# Build metadata (SCRUM-159): the same short commit hash the frontend was built with, so
# `/api/health` and the navbar report the same `X.Y.Z-<hash>` version.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

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
