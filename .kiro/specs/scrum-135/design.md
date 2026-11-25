# SCRUM-135 cloud infrastructure design

## Overview

One idempotent script, `scripts/gcp-provision.sh`, creates the three resources SCRUM-136 deploys
against: the Litestream replica bucket, the secrets Cloud Run injects, and the runtime service
account with exactly the access those two need.

## Resources

| Resource | Name | Settings |
| :--- | :--- | :--- |
| GCS bucket | `gs://wind-map-litestream-wind-app-515017` | `us-west1`, uniform bucket-level access, public access prevention enforced, abort unfinished uploads after 7 days |
| Secret | `APP_PASSWORD` | automatic replication, one generated 48-character value |
| Secret | `CARTO_API_KEY` | optional; created or updated only when a value is supplied |
| Service account | `wind-map-runner@wind-app-515017.iam.gserviceaccount.com` | `roles/storage.objectAdmin` on the bucket, `roles/secretmanager.secretAccessor` on the secrets |

## Decisions

- **Bucket suffix:** the project ID makes the name globally unique and predictable, so SCRUM-136 and
  Litestream can use it without an inventory lookup. `LITESTREAM_BUCKET` overrides it.
- **No region surprise:** the bucket lives in `us-west1` because the Cloud Run service will too, which
  keeps Litestream's writes and the service's reads in one region.
- **Shared password never leaves Secret Manager:** the script prints only the command that reads it.
  A pre-generated value can be supplied with `APP_PASSWORD=...`; otherwise `openssl rand -hex 24`
  produces one.
- **Optional CARTO key:** the map works without it, so the script does not fail when it is absent and
  never creates an empty secret.
- **Least privilege:** the runner can manage objects in one bucket and read two named secrets, nothing
  else. No key files are created; Cloud Run supplies Application Default Credentials.
- **Verification by impersonation:** `gcloud --impersonate-service-account` exercises the same IAM
  bindings the container uses, without minting a key. A write, read, delete probe on the bucket plus
  a secret read is the acceptance evidence. Impersonation needs `roles/iam.serviceAccountTokenCreator`
  on the runner, which even project Owner does not imply, so the script grants it to the operator
  before the check (retrying while the IAM change propagates) and stops with the exact command if it
  still cannot impersonate.

## Idempotency

Every step checks first (`buckets describe`, `secrets describe`, `iam service-accounts describe`) and
then applies the desired settings; `add-iam-policy-binding` is idempotent. Creating a secret is the
only step that cannot be repeated, so an existing `APP_PASSWORD` is never touched — rerunning the
script cannot lock the operator out of the deployment.

## Out of scope

The Artifact Registry image, the `gcloud run deploy` invocation, the persistence and auth checks
against the live URL, and the deployment documentation belong to SCRUM-136.
