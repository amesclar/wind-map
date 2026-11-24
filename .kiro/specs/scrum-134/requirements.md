# SCRUM-134 Cloud Run Stage 1 requirements

Parent epic: SCRUM-133 (Deploy wind-map to Google Cloud Run with Litestream and HTTP Basic Auth).
Prepared code and container for the public deployment; no cloud resources are created here.

## Requirements

1. WHEN `APP_PASSWORD` is unset or empty THEN every route shall answer as it does today (no challenge).
2. WHEN `APP_PASSWORD` is set and a request has no `Authorization: Basic` header THEN the app shall answer `401` with `WWW-Authenticate: Basic realm="wind-map"`.
3. WHEN `APP_PASSWORD` is set and the supplied password differs THEN the app shall answer `401`; WHEN it matches THEN the request shall be served normally.
4. THEN the challenge shall apply to the API (`/api/*`) and to the static frontend (`/`, `/assets/*`), and the username shall not be checked.
5. WHEN the request is `GET /api/health` THEN it shall be served without credentials, whatever `APP_PASSWORD` is.
6. THEN the password shall be compared with `secrets.compare_digest`, and neither the password nor the `Authorization` header shall appear in any log.
7. WHEN `LITESTREAM_BUCKET` is set THEN the container shall restore `/app/data/wind_map.db` from the replica if it has none and run Uvicorn under `litestream replicate -exec`.
8. WHEN `LITESTREAM_BUCKET` is unset THEN the container shall exec Uvicorn directly, unchanged from today.
9. THEN the image shall carry the pinned Litestream binary for the target architecture, verified against its published checksum, plus `litestream.yml` and the entrypoint script.
10. THEN `requirements.md` and `README.md` shall describe the password and replication behaviour.

## Acceptance criteria

- `backend/tests/test_auth.py` covers requirements 1–6, including the open health check and the no-logging rule.
- `pytest`, `ruff check` and `ruff format --check` pass; the image builds and its smoke test (`/api/health`) passes.
- Without `APP_PASSWORD` and `LITESTREAM_BUCKET` the local container and `scripts/rebuild-container.sh` behave exactly as before.
