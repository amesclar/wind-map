# Release Versioning (SCRUM-91)

The app version must always match the release version.

- **Single source of truth:** the `VERSION` file in the project root, plain semver `MAJOR.MINOR.PATCH` with no "v" (e.g. `0.2.0`).
- **Keep in sync:** `frontend/package.json` (and `package-lock.json`) `version` must equal `VERSION`. Update both with:
  ```bash
  echo "X.Y.Z" > VERSION
  (cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
  ```
- **Never hardcode the version** in UI or API code. The backend reads `VERSION` (`backend/app/config.py` → `APP_VERSION`); the frontend gets it at build time as `__APP_VERSION__` (`frontend/appVersion.ts`, `src/version.ts`).
- **When creating a release `vX.Y.Z`:**
  1. Bump `VERSION` and `frontend/package.json` to `X.Y.Z` in a ticketed commit on a ticket branch, merged to `develop`.
  2. Fast-forward/merge `develop` into `master`.
  3. Tag and publish the release `vX.Y.Z` from `master`. The tag must equal `v` + the contents of `VERSION`.
- If asked to create a release without a version bump, ask whether to bump `VERSION` first instead of tagging a mismatched version.
- Tests (`frontend/src/version.test.ts`, `backend/tests/test_version.py`) fail if `VERSION`, `package.json`, the navbar badge, or `/api/health` disagree.
