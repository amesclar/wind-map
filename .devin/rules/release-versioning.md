---
trigger: glob
globs: VERSION, frontend/package.json, frontend/package-lock.json, release-notes/**, Dockerfile, scripts/rebuild-container.sh, .github/workflows/**
description: Version source of truth, build hash, releases and container rebuilds.
---

<!-- Generated from .kiro/steering/release-versioning.md. Run: python scripts/sync-ai-rules.py -->

# Release Versioning (SCRUM-91, SCRUM-130, SCRUM-132)

The app version must always match the release version.

- **Single source of truth:** the `VERSION` file in the project root, plain semver `MAJOR.MINOR.PATCH` with no "v" (e.g. `0.2.0`).
- **Keep in sync:** `frontend/package.json` (and `package-lock.json`) `version` must equal `VERSION`. Update both with:
  ```bash
  echo "X.Y.Z" > VERSION
  (cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
  ```
- **Displayed version includes the build hash (SCRUM-159):** the navbar badge and `GET /api/health` show `X.Y.Z-<short-hash>` while `VERSION`, `package.json` and tags stay `X.Y.Z` / `vX.Y.Z`. User-testing builds also bump `PATCH` (no notes, no tag: not a release). Mechanics: `rebuild-container` skill.
- **Release notes:** every release needs notes covering features, fixes, performance and rules, saved as `release-notes/x-x-x.md` (dots as hyphens) and committed with the version bump.
- **Rebuild container on version bump and release (SCRUM-132):** after a version bump or a release merged to `master`, run `scripts/rebuild-container.sh` so user verification happens on http://localhost:5005.
- **Never hardcode the version** in UI or API code. The backend reads `VERSION` (`backend/app/config.py` → `APP_VERSION`); the frontend gets it at build time as `__APP_VERSION__` (`frontend/appVersion.ts`, `src/version.ts`).
- **When creating a release `vX.Y.Z`:** bump both files, write `release-notes/x-x-x.md`, merge `develop` into `master`, then publish the tag from `master` with the notes (see the `release` skill).
- If asked to create a release without a version bump, ask whether to bump `VERSION` first instead of tagging a mismatched version.
- Tests (`version.test.ts`, `test_version.py`) fail if `VERSION`, `package.json`, the badge or `/api/health` disagree, or if the version is not `X.Y.Z[-<hash>]`.
