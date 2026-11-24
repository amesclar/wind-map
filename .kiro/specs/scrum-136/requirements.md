# SCRUM-136 deployment requirements

Parent epic: SCRUM-133, stage 3. Uses the image preparation of SCRUM-134, the authentication gate of
SCRUM-134 and the cloud resources of SCRUM-135.

## Requirements

1. THEN the image for the deployment shall be built for `linux/amd64` (Cloud Run's architecture) with the release commit hash, and stored in Artifact Registry as both `0.9.3-<hash>` and `latest`.
2. THEN the Cloud Run service `wind-map` shall run in `us-west1` with `--port 5005`, `--memory 512Mi`, `--max-instances 1`, `--min-instances 0`, `--no-cpu-throttling` and `--allow-unauthenticated`.
3. THEN it shall run as `wind-map-runner@wind-app-515017.iam.gserviceaccount.com` with `LITESTREAM_BUCKET=wind-map-litestream-wind-app-515017` and `APP_PASSWORD` mounted from Secret Manager.
4. WHEN a new instance starts with no local database THEN the entrypoint shall restore the replica, and when no replica exists yet it shall create the schema before Litestream starts replicating.
5. THEN the public URL shall answer `401` with `WWW-Authenticate: Basic realm="wind-map"` for a missing or wrong password on both the SPA and the API.
6. THEN the same URL shall serve the app with the correct password, and `GET /api/health` shall answer without credentials.
7. WHEN a location is created and the service is replaced by a new revision THEN the location shall still be listed, proving the database was restored from GCS.
8. THEN `requirements.md` and `README.md` shall document deployment, configuration, the single-writer architecture and rollback.

## Acceptance criteria

- `gcloud run services describe wind-map --region us-west1` shows the image, the runner service account, the bucket variable and the `APP_PASSWORD` secret.
- `curl -i` without credentials returns `401` + `WWW-Authenticate`; with them returns the SPA; `/api/health` returns 200 without credentials.
- A location created before an instance replacement is still returned by `GET /api/locations` afterwards.
- Litestream logs show a restore from the bucket on the new instance.
- `ruff`, `pytest --cov`, frontend lint/typecheck/`test:coverage` pass locally; CI is green before merge.
