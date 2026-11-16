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
# Stage 2: Python Backend Runtime
# ==========================================
FROM python:3.11-slim AS runtime
WORKDIR /app

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    DATA_DIR=/app/data \
    DATABASE_PATH=/app/data/wind_map.db \
    STATIC_DIR=/app/static

# Create data and static directories
RUN mkdir -p /app/data /app/static

# Install python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

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

