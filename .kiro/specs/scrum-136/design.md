# SCRUM-136 deployment design

## Overview

Build the existing image for Cloud Run's architecture, push it to Artifact Registry, run it as the
single-instance `wind-map` service with the SCRUM-135 resources, and prove that both the password
gate and Litestream restore work on the live URL.

## Pipeline

```text
docker buildx build --platform linux/amd64 --build-arg GIT_SHA=<hash>
  → us-west1-docker.pkg.dev/wind-app-515017/wind-map/wind-map:<VERSION>-<hash> and :latest
  → gcloud run deploy wind-map --region=us-west1 --port=5005 ...
```

- Local Docker is arm64, so the build must target `linux/amd64` explicitly; `TARGETARCH` is then
  `amd64` for the Litestream stage and the pushed manifest is what Cloud Run can run.
- The image carries the commit hash, so `/api/health` on the live service reports the same
  `X.Y.Z-<hash>` as the navbar.

## Service settings

| Setting | Value | Why |
| :--- | :--- | :--- |
| Port | `5005` | The entrypoint and image fix this port |
| Service account | `wind-map-runner@wind-app-515017.iam.gserviceaccount.com` | Bucket and secret access only |
| Memory / CPU | `512Mi`, `1` | Small SQLite workload |
| Instances | `--min-instances=0 --max-instances=1` | One writer, scale to zero when idle |
| CPU | `--no-cpu-throttling` | Litestream keeps replicating between requests |
| Ingress auth | `--allow-unauthenticated` | The app's Basic Auth is the gate, not IAM |
| Env | `LITESTREAM_BUCKET=wind-map-litestream-wind-app-515017` | Replica location |
| Secret | `APP_PASSWORD=APP_PASSWORD:latest` | Shared password, never in the image |

`CARTO_API_KEY` is not deployed because no key exists; the map falls back to the OpenStreetMap
tiles. The command to add it later is in the README.

## First start

Litestream's restore leaves a fresh instance with no database when no replica exists yet. The
entrypoint therefore runs `init_db()` after the restore when the file is still missing, so
`litestream replicate` watches a valid SQLite file from the first moment. On later instances the
restore recreates the file and this step is skipped.

## Verification

1. `curl` the URL: `/api/health` 200 without credentials; `/` and `/api/locations` 401 with
   `WWW-Authenticate: Basic realm="wind-map"`; `/` 200 with the password from Secret Manager.
2. Create a location through `POST /api/locations` with the password.
3. Replace the instance by updating a revision-level environment variable (new revision, empty
   disk). Litestream must restore the database from GCS and `GET /api/locations` must still return
   the location.
4. Inspect the revision logs for the restore line and for Litestream errors.

## Rollback

Traffic switching between revisions (`gcloud run services update-traffic --to-revisions=...`) or
redeploying the previous image tag; both are documented in the README.

## Out of scope

CI/CD automation of the deploy (the image is pushed manually for now), a custom domain, and a
CARTO key.
