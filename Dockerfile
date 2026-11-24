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

# Litestream (SCRUM-134): the pinned static binary that replicates SQLite to a GCS bucket.
# BUILDARCH is the target architecture, so an arm64 host and the amd64 CI runner both work.
ARG LITESTREAM_VERSION="0.5.18"
ARG TARGETARCH="amd64"

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
    && apk add --no-cache ca-certificates \
    && pip uninstall -y pip setuptools wheel

# Litestream (SCRUM-134). The release tarball is verified against the published SHA-256 before the
# binary is installed, so a tampered or truncated download fails the build.
RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) LITESTREAM_ARCH=x86_64; LITESTREAM_SHA256=d3687b9fd0f2e9426bbd3da828429ff3f1dfc5c9b74d54fdf028e4ee510e7dea ;; \
        arm64) LITESTREAM_ARCH=arm64; LITESTREAM_SHA256=922a09e6a7ac67f2095571894dc6382e94e1dd4cdd9674883ddf1a8e74ab982d ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/litestream.tar.gz \
        "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${LITESTREAM_ARCH}.tar.gz"; \
    echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream; \
    chmod +x /usr/local/bin/litestream; \
    rm -f /tmp/litestream.tar.gz

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

# Litestream configuration and the entrypoint that restores the database and runs the app under
# replication when LITESTREAM_BUCKET is set (SCRUM-134).
COPY litestream.yml /etc/litestream.yml
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Starts Uvicorn, through Litestream when LITESTREAM_BUCKET is set; see the script for the two paths.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
