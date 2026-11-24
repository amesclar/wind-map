# SCRUM-189 automatic deployment requirements

Follows SCRUM-136, which deployed the service by hand with Cloud Build and gcloud.

## Requirements

1. WHEN a pull request is merged into `develop` THEN GitHub Actions shall build the image for `linux/amd64` and push it to `us-west1-docker.pkg.dev/wind-app-515017/wind-map/wind-map`, tagged `VERSION-<merge-sha>` and `latest`.
2. THEN the workflow shall authenticate to Google Cloud only through Workload Identity Federation, restricted to repository `amesclar/wind-map`, with no service account key or long-lived credential in GitHub.
3. THEN the deployment identity `wind-map-deployer@wind-app-515017.iam.gserviceaccount.com` shall hold `roles/artifactregistry.writer` on the repository, `roles/run.admin` on the project and `roles/iam.serviceAccountUser` on `wind-map-runner`, and nothing broader.
4. THEN `gcloud run deploy` shall keep the SCRUM-136 settings: `wind-map-runner`, `LITESTREAM_BUCKET=wind-map-litestream-wind-app-515017`, `APP_PASSWORD` from Secret Manager, port 5005, 512 MiB, `--max-instances=1 --min-instances=0 --no-cpu-throttling --allow-unauthenticated`.
5. THEN the workflow shall fail when the deployed `/api/health` does not report `status: ok`.
6. THEN it shall be runnable on demand (`workflow_dispatch`) and never run two deployments at once.
7. THEN `requirements.md` and `README.md` shall describe the automatic deployment, the keyless auth and the manual fallback.

## Acceptance criteria

- Merging this change into `develop` triggers the workflow, which completes green and deploys a revision whose `/api/health` reports `VERSION-<merge-sha>`.
- The workflow run shows no `GOOGLE_CREDENTIALS`/JSON key secret; only `id-token: write` and Workload Identity Federation.
- Basic Auth still returns 401 without credentials and 200 with the password; `/api/health` stays open.
- No manual Cloud Build or gcloud command is required for a normal merge.
