# SCRUM-135 cloud infrastructure requirements

Parent epic: SCRUM-133. Stage 2 provisions the Google Cloud resources that stage 1 (SCRUM-134) already expects.

## Requirements

1. WHEN the provisioning script runs THEN it shall create the private bucket `gs://wind-map-litestream-wind-app-515017` in `us-west1` when it does not exist.
2. THEN the bucket shall use uniform bucket-level access, enforce public access prevention, and abort incomplete multipart uploads after 7 days.
3. WHEN `APP_PASSWORD` is not in Secret Manager THEN the script shall create it from a generated 48-character password, or from `APP_PASSWORD` when that variable is set, and shall never print the value.
4. WHEN `CARTO_API_KEY` is supplied THEN the script shall store it in Secret Manager; without it the optional secret is left alone and the app keeps using the OpenStreetMap tiles.
5. THEN the script shall create the service account `wind-map-runner@wind-app-515017.iam.gserviceaccount.com`.
6. THEN that service account shall hold `roles/storage.objectAdmin` on the bucket and `roles/secretmanager.secretAccessor` on each secret it must read.
7. WHEN the script runs again THEN it shall create no duplicates, not fail on existing resources and not rotate an existing password.
8. THEN it shall verify the service account by impersonation: write, read and delete a probe object in the bucket, and read `APP_PASSWORD`; for that check alone it may grant the operator `roles/iam.serviceAccountTokenCreator` on the runner.
9. THEN `requirements.md` and `README.md` shall document the resources, the script and the values Cloud Run receives.

## Acceptance criteria

- `scripts/gcp-provision.sh` completes on `wind-app-515017` and prints every resource it created or kept.
- A second run changes nothing and exits 0 (idempotency).
- `gs://wind-map-litestream-wind-app-515017` exists in `us-west1` with uniform access and public access prevention, and is empty of probe objects.
- The service account can write to the bucket and read `APP_PASSWORD` while impersonated, which is the access Litestream and Cloud Run use.
- The password is only in Secret Manager, never in the repository or the terminal output.
