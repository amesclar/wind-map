---
name: rebuild-container
description: Rebuild the wind-map Docker image and restart the local container on port 5005 so the running app reflects the latest code. Use after changing app code when the user wants to see it running, or to verify the Docker build.
---

# Rebuild and restart the container

This mirrors `.kiro/hooks/rebuild-wind-map.json`. `.devin/hooks.v1.json` runs it automatically when Devin finishes a turn; run it by hand when you need the result right away:

```bash
scripts/rebuild-container.sh
```

The script builds `wind-map`, replaces the `wind-map` container, keeps data in the `wind_data` volume, passes `CARTO_API_KEY` if it is set, and waits for `GET /api/health`. It exits 0 without doing anything when Docker is not installed or not running, so it never blocks a session.

Check the result:
```bash
curl -fsS http://localhost:5005/api/health
docker logs --tail 50 wind-map
```

Set `WIND_MAP_SKIP_REBUILD=1` to turn the automatic hook off for a session.
