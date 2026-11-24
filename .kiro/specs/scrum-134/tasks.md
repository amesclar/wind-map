# SCRUM-134 tasks

- [x] 1. `backend/app/auth.py`: `parse_basic_auth`, `password_matches`, `BasicAuthMiddleware` with `OPEN_PATHS`.
  _Requirements: 2.1, 2.2, 2.5_
  _Files: `backend/app/auth.py`_
- [x] 2. Read `APP_PASSWORD` in `backend/app/config.py` and register the middleware in `backend/app/main.py`.
  _Requirements: 1.1, 4.1_
  _Files: `backend/app/config.py`, `backend/app/main.py`_
- [x] 3. Tests: open when unset, 401 with challenge on API and SPA, wrong/malformed rejected, username ignored, health open, no secrets logged.
  _Requirements: 3.1–3.6_
  _Files: `backend/tests/test_auth.py`_
- [x] 4. `litestream.yml` and `scripts/docker-entrypoint.sh` (restore + `replicate -exec`, direct Uvicorn when unset).
  _Requirements: 2.7, 2.8_
  _Files: `litestream.yml`, `scripts/docker-entrypoint.sh`_
- [x] 5. Dockerfile: Litestream built from the pinned release commit with its two flagged Go modules updated, config and entrypoint, `ENTRYPOINT` replacing `CMD`.
  _Requirements: 2.9_
  _Files: `Dockerfile`_
- [x] 6. Docs: `requirements.md` (access control, database replication) and `README.md` (the two variables).
  _Requirements: 2.10_
  _Files: `requirements.md`, `README.md`_
- [x] 7. Verification: `ruff check`, `ruff format --check`, `pytest --cov`, `docker build`, container smoke test of `/api/health` and of a 401 with `APP_PASSWORD` set.
  _Requirements: all_
