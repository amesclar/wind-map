# SCRUM-236 spike: self-hosting Open-Meteo

Prototype and measurement harness for the spike on the Open-Meteo limits epic (SCRUM-235).
**Archived, not production code**: the app never imports anything here. It was kept on
`spike/SCRUM-236-open-meteo-selfhost` until SCRUM-328 copied it here and deleted the branch,
so the measurements and the harness that produced them stay with the repository.

## What was measured

| Question | Where the answer comes from |
| --- | --- |
| How often do the limits bite today? | `usage.py` replays the Cloud Run request log through the app's cache rules |
| How many calls does a session cost? | `session.py` drives one real session at a locally-run app |
| How fast is a local Open-Meteo? | `replay.py` against the Docker image, cold and warm |
| How much cache does it need? | `du` of the data volume after the replays |
| Where to host, at what cost? | design note on SCRUM-236 |

## Reproducing

Start the API server (the container fetches from the public AWS S3 distribution and caches
locally, so nothing has to be synced up front):

```bash
docker volume create --name open-meteo-data
docker run -d --rm --name open-meteo \
  -v open-meteo-data:/app/data \
  -e REMOTE_DATA_DIRECTORY=https://openmeteo.s3.amazonaws.com/data/ \
  -e CACHE_SIZE=8GB \
  -p 127.0.0.1:8080:8080 ghcr.io/open-meteo/open-meteo
```

Replay the app's real request shapes, cold then warm. The cold run needs a fresh volume
(`docker rm -f open-meteo && docker volume rm open-meteo-data`, then start again):

```bash
python .kiro/specs/scrum-236/tools/replay.py --base-url http://127.0.0.1:8080 --rounds 1 \
  --label cold --out .kiro/specs/scrum-236/results/local-cold.json
python .kiro/specs/scrum-236/tools/replay.py --base-url http://127.0.0.1:8080 --rounds 3 \
  --label warm --delay 0.5 --out .kiro/specs/scrum-236/results/local-warm.json
```

Run the backend against it (the spike adds `OPEN_METEO_BASE_URL` / `OPEN_METEO_MARINE_BASE_URL`
so no call site changes) and drive a session:

```bash
PYTHONPATH=. DATA_DIR=/tmp/wm-spike-data \
  OPEN_METEO_BASE_URL=http://127.0.0.1:8080 \
  OPEN_METEO_MARINE_BASE_URL=http://127.0.0.1:8080 \
  .venv/bin/uvicorn backend.app.main:app --port 8099

python .kiro/specs/scrum-236/tools/session.py --base-url http://127.0.0.1:8099 \
  --minutes 5 --out .kiro/specs/scrum-236/results/session-local.json
```

`open_meteo.get_json` logs one `OPEN_METEO_CALL` line per upstream attempt on this branch, so
the session's real call count is the number of those lines in the server log.

Production usage comes from the Cloud Run request log:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND
  resource.labels.service_name="wind-map" AND logName:"requests"' \
  --freshness=30d --format='value(timestamp,httpRequest.requestUrl,httpRequest.status,
  httpRequest.remoteIp,httpRequest.userAgent,httpRequest.latency)' > /tmp/wm-requests.tsv

python .kiro/specs/scrum-236/tools/usage.py --input /tmp/wm-requests.tsv --locations 1 \
  --out .kiro/specs/scrum-236/results/production-usage.json
```

## Results

Measured on 2026-11-26; the full write-up lives on the ticket.

| Measurement | Result |
| --- | --- |
| Production usage (26 h of request log) | 8 browser sessions; 2 real ones cost 49 and 36 calls (25 and 19 min) |
| Quota 503s from real users | none; all five in the window came from 900-point load tests |
| Calls for one scripted session (5 min pan, 8 hours, currents, waves, point) | 62 calls, 6,515 points, 82 app requests |
| Same session again inside 30 minutes | 0 calls (the app cache absorbs it entirely) |
| Local instance, cold cache | point forecast 133 s, 150-point grid chunk 41-47 s, then 3-4 s per new area |
| Local instance, warm cache | 30-80 ms per call |
| Local instance memory | 2.25 GiB resident; 8 GB cache file preallocated |
| S3 data pulled for the replays | 298 MB |
| Scripted session, app-level latency | grid pan median 21 ms, max 106 ms (warm instance) |

## Caveats

- Measurements ran on a Mac (arm64, Docker Desktop with 8 GB) on a home connection, not on the
  target host: the cold numbers include the S3 download over that connection.
- `CACHE_SIZE=8GB` caps the local cache; a production cache would be larger.
- The public-API comparison is the app's own production latency (`usage.py`), not a fresh
  benchmark, so both numbers include the app's overhead.
- Coverage splits (`ncep_rrfs_north_america`) and the NWS provider are outside this harness;
  the observed production traffic is `best_match`.
