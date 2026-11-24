# SCRUM-134 Cloud Run Stage 1 design

## Overview

Two independent pieces of preparation for SCRUM-136: a shared-password gate in front of the app,
and Litestream in the image so the SQLite database survives Cloud Run's ephemeral instances.
Both are opt-in through environment variables, so nothing changes locally.

## Glossary

- **Shared password** — one `APP_PASSWORD` value for everybody; no accounts.
- **Replica** — the Litestream copy of the database in a private GCS bucket.
- **Entrypoint** — `scripts/docker-entrypoint.sh`, the container's PID 1.

## Architecture

### Authentication

- `backend/app/auth.py` holds everything: `parse_basic_auth` (header → password), `password_matches`
  (constant-time compare), `OPEN_PATHS` (`/api/health`) and `BasicAuthMiddleware`.
- The middleware reads `config.APP_PASSWORD` per request through `_configured_password`, so a test can
  flip it with `monkeypatch.setattr(config, "APP_PASSWORD", ...)` and a deployment can only change it
  by restarting with a different secret. Empty means no authentication.
- `backend/app/main.py` registers it after CORS, which makes it the outermost middleware: a request
  is challenged before routing, so the API and the SPA shell are both covered by construction.
- The username is ignored because one password is shared; only the password is compared. `secrets`
  compare is used, and the 401 body says only "Authentication required" — headers are never logged
  because nothing logs the request headers at all.

### Litestream

- `litestream.yml` declares one database (`/app/data/wind_map.db`) and one `gs` replica whose bucket
  is `${LITESTREAM_BUCKET}`, expanded by Litestream from the environment. Litestream 0.5 rejects the
  older `gcs` type name and the deprecated `replicas` list, so the file uses `replica:` with `type: gs`. Authentication is Google
  Application Default Credentials from the Cloud Run service account; no key material is in the image.
- The Dockerfile runtime stage downloads `litestream-0.5.18-linux-<arch>.tar.gz` for `TARGETARCH`
  (amd64 → `x86_64`, arm64 → `arm64`), verifies the pinned SHA-256 with `sha256sum -c`, and installs
  only the binary. `ca-certificates` is installed so the binary can reach the GCS endpoint.
- `scripts/docker-entrypoint.sh`:
  - `LITESTREAM_BUCKET` unset → `exec uvicorn ... --port 5005` (the old `CMD`, so local use is identical).
  - set → `litestream restore -if-db-not-exists -if-replica-exists /app/data/wind_map.db` then
    `exec litestream replicate -exec "uvicorn ..."`. The restore flags make a first deployment (no
    replica yet) succeed; Litestream stops the child and writes a final frame on SIGTERM.

## Correctness properties

- P1 (req 1, 8): with both variables unset the behaviour is byte-for-byte the old one — no 401, Uvicorn as PID 1.
- P2 (req 2–4): any path other than `/api/health` returns 401 with the challenge when the password is wrong or missing.
- P3 (req 5): `/api/health` never depends on credentials.
- P4 (req 6): the password string never reaches a log record.
- P5 (req 9): a truncated or tampered Litestream download fails the build instead of shipping.

## Files

- `backend/app/auth.py` (new), `backend/app/config.py` (`APP_PASSWORD`), `backend/app/main.py` (middleware).
- `backend/tests/test_auth.py` (new).
- `Dockerfile` (Litestream stage, entrypoint), `litestream.yml` (new), `scripts/docker-entrypoint.sh` (new).
- `requirements.md`, `README.md`.

## Out of scope

Cloud resources, the Artifact Registry image, the `gcloud run deploy` command and the end-to-end
persistence test belong to SCRUM-135 and SCRUM-136.
