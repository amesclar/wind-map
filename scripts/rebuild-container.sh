#!/usr/bin/env bash
# Rebuild the wind-map image and restart the container (SCRUM-128, SCRUM-140).
# Kiro and Devin run this from .kiro/hooks/rebuild-wind-map.json and .devin/hooks.v1.json.
# Always exits 0 so a failed or skipped rebuild never blocks the agent.

cd "$(dirname "$0")/.." || exit 0

if [ -n "${WIND_MAP_SKIP_REBUILD:-}" ]; then
  echo "rebuild-container: skipped (WIND_MAP_SKIP_REBUILD is set)" >&2
  exit 0
fi
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "rebuild-container: skipped (Docker is not available)" >&2
  exit 0
fi

if ! docker build -q -t wind-map . >&2; then
  echo "rebuild-container: docker build failed" >&2
  exit 0
fi

docker stop wind-map >/dev/null 2>&1
docker rm wind-map >/dev/null 2>&1
carto_env=()
if [ -n "${CARTO_API_KEY:-}" ]; then
  carto_env=(-e CARTO_API_KEY)
fi
docker run -d --name wind-map -p 5005:5005 "${carto_env[@]}" -v wind_data:/app/data wind-map >/dev/null || exit 0

for _ in $(seq 1 20); do
  if curl -fsS http://localhost:5005/api/health >/dev/null 2>&1; then
    echo "rebuild-container: wind-map is running on http://localhost:5005" >&2
    exit 0
  fi
  sleep 1
done
echo "rebuild-container: container started but /api/health did not respond; see docker logs wind-map" >&2
exit 0
