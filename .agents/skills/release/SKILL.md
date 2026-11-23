---
name: release
description: Cut a wind-map release vX.Y.Z by bumping VERSION and frontend/package.json, authoring release notes, merging develop into master, and tagging. Use when the user asks to release, tag, or bump the version.
---

# Release vX.Y.Z

Rules: `.kiro/steering/release-versioning.md`. The tag must equal `v` + the contents of `VERSION`; the app displays `X.Y.Z-<short-hash>` (SCRUM-159) because the badge and `/api/health` append the hash from the `GIT_SHA` build arg, while `VERSION` and the tag stay plain semver. If the user only asks for a build to test, bump the patch digit and rebuild the container instead of cutting a release.

1. If the user did not give a version, or asks for a release without a bump, ask which version to use before doing anything.
2. Make sure a release ticket exists (create one with a story point estimate if not).
3. Branch from an up-to-date `develop`: `git checkout -b feature/SCRUM-xxx-release-X.Y.Z origin/develop`.
4. Bump both files:
   ```bash
   echo "X.Y.Z" > VERSION
   (cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
   ```
5. Author release notes in `release-notes/x-x-x.md` (e.g., `release-notes/0-4-0.md`, replacing dots with hyphens) summarizing changes since the previous release.
6. Run the `ci-checks` skill. `backend/tests/test_version.py` and `frontend/src/version.test.ts` must pass.
7. Commit `SCRUM-xxx: Bump version to X.Y.Z for release`, open `[SCRUM-xxx] Bump version to X.Y.Z for release` into `develop`, merge once checks pass, delete the branch, comment the merge hash on the ticket and mark it Done.
8. Merge `develop` into `master` through a PR (`gh pr create --base master --head develop --title "Release vX.Y.Z" --body-file release-notes/x-x-x.md`) and wait for checks.
9. Tag and publish from `master`:
   ```bash
   git fetch origin && git checkout master && git pull --ff-only
   test "v$(cat VERSION)" = "vX.Y.Z"
   gh release create vX.Y.Z --target master --title "vX.Y.Z" --notes-file release-notes/x-x-x.md
   ```
10. Comment the `master` merge hash on each included ticket (or the release ticket), mark any that are not yet Done as Done, and report the release URL.
11. Rebuild and restart the container by running `scripts/rebuild-container.sh` so the new release is running on http://localhost:5005 for user verification.
