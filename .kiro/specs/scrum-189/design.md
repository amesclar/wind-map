# SCRUM-189 automatic deployment design

## Overview

`.github/workflows/deploy-cloud-run.yml` turns a merge into `develop` into a deployment: build the
amd64 image, push it, roll the Cloud Run service and smoke-test the result. No key material enters
GitHub; the runner exchanges its OIDC token for short-lived Google credentials.

## Identity

| Principal | Roles | Purpose |
| :--- | :--- | :--- |
| Workload Identity pool `github`, provider `github` | issuer `token.actions.githubusercontent.com`, condition `assertion.repository == 'amesclar/wind-map'` | Only this repository can request tokens |
| `wind-map-deployer@wind-app-515017.iam.gserviceaccount.com` | `roles/artifactregistry.writer` on the `wind-map` repository, `roles/run.admin` on the project, `roles/iam.serviceAccountUser` on `wind-map-runner` | Push the image, deploy the service, act as the runtime identity |
| `wind-map-runner@…` (runtime) | `storage.objectAdmin` on the replica bucket, `secretmanager.secretAccessor` on `APP_PASSWORD` | Unchanged from SCRUM-135 |

`roles/iam.workloadIdentityUser` on the deployer is bound to
`principalSet://…/attribute.repository/amesclar/wind-map`, so a fork or another repository cannot
impersonate it even if the pool is shared.

The deployer deliberately does not read the password or write to the bucket; Cloud Run mounts the
secret and Litestream uses the runner identity, so the CI identity stays deployment-only.

## Workflow

1. `actions/checkout@v4`.
2. Compute `sha = ${GITHUB_SHA::7}` and `tag = $(cat VERSION)-$sha`.
3. `google-github-actions/auth@v2` with `token_format: access_token` and the provider path.
4. `docker/login-action@v3` to `us-west1-docker.pkg.dev` with the OAuth access token.
5. `docker/setup-buildx-action@v3` and `docker/build-push-action@v6`: `linux/amd64`,
   `GIT_SHA=<sha>`, tags `tag` and `latest`, GitHub Actions layer cache.
6. `gcloud run deploy` with the SCRUM-136 flags.
7. Poll `/api/health` for `status: ok` and fail the run otherwise.

`concurrency: deploy-cloud-run` serialises merges so two rollouts cannot interleave; a merge that
lands during a deploy waits for it rather than replacing the revision underneath it.

## Why the tag carries the merge commit

`/api/health` and the navbar show `VERSION-<sha>`, and the deploy step uses the same tag the build
pushed, so the live service identifies exactly which develop commit it runs.

## Out of scope

Deploying `master` on release (releases still tag the already-deployed develop build), pull request
previews, and deleting the manual `cloudbuild.yaml` path, which stays as an emergency fallback.
