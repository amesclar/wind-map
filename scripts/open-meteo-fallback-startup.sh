#!/usr/bin/env bash
# Startup script for the Open-Meteo fallback VM (SCRUM-265). Runs as root on Container-Optimized OS
# on every boot, so it removes and recreates both containers and keeps their data on the boot disk.
#
# It starts two containers:
#   open-meteo       the Open-Meteo API, pinned by digest, serving the app's request shapes from
#                    the public AWS data with a 32 GB local cache
#   open-meteo-warm  a ten-minute loop against the default Oak Harbor view, because the spike
#                    measured a 133 s first request and 30 to 80 ms once the cache is warm
set -euo pipefail

# The digest is the multi-arch index measured on 2026-11-26. Bump it on purpose and re-run the
# spike's cold/warm replay before trusting a new one.
OPEN_METEO_IMAGE="${OPEN_METEO_IMAGE:-ghcr.io/open-meteo/open-meteo@sha256:bf94e8b39761b59a91bd04bb926b3834cad00eaf71f1aa64b2fd17fbe987846a}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.16.0}"
DATA_DIR="${DATA_DIR:-/var/lib/open-meteo}"
CACHE_SIZE="${CACHE_SIZE:-32GB}"
NETWORK="wind-open-meteo"
WARM_INTERVAL_SECONDS="${WARM_INTERVAL_SECONDS:-600}"
WARM_URL="http://open-meteo:8080/v1/forecast?latitude=48.2939&longitude=-122.6064&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&wind_speed_unit=kn"

log() {
  echo "open-meteo-fallback-startup: $*"
}

# The boot disk is the cache: /var/lib is the writable part of Container-Optimized OS.
mkdir -p "$DATA_DIR"
log "cache directory $DATA_DIR, CACHE_SIZE=$CACHE_SIZE"

docker network create "$NETWORK" >/dev/null 2>&1 || true

log "starting $OPEN_METEO_IMAGE"
docker rm -f open-meteo >/dev/null 2>&1 || true
docker run -d --restart=always --name open-meteo \
  --network "$NETWORK" \
  --log-driver=json-file --log-opt max-size=50m --log-opt max-file=3 \
  -p 8080:8080 \
  -v "$DATA_DIR:/app/data" \
  -e REMOTE_DATA_DIRECTORY=https://openmeteo.s3.amazonaws.com/data/ \
  -e CACHE_SIZE="$CACHE_SIZE" \
  "$OPEN_METEO_IMAGE" >/dev/null

# The API answers before its cache is warm, so readiness is the warm loop's job. Keeping the
# default view warm means the first real fallback request does not pay the cold download.
log "starting the warm-up loop every ${WARM_INTERVAL_SECONDS}s"
docker rm -f open-meteo-warm >/dev/null 2>&1 || true
docker run -d --restart=always --name open-meteo-warm \
  --network "$NETWORK" \
  --log-driver=json-file --log-opt max-size=10m --log-opt max-file=2 \
  --entrypoint sh "$CURL_IMAGE" -c \
  "while true; do curl -fsS --max-time 180 -o /dev/null '$WARM_URL' || echo warm request failed; sleep $WARM_INTERVAL_SECONDS; done" \
  >/dev/null

log "containers started; docker logs open-meteo shows the API and docker logs open-meteo-warm the loop"
