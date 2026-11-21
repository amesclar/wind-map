---
name: release
description: Cut a wind-map release vX.Y.Z by bumping VERSION and frontend/package.json, merging develop into master, and tagging. Use when the user asks to release, tag, or bump the version.
---

# Release vX.Y.Z

Rules: `.kiro/steering/release-versioning.md`. The tag must equal `v` + the contents of `VERSION`.

1. If the user did not give a version, or asks for a release without a bump, ask which version to use before doing anything.
2. Make sure a release ticket exists (create one with a story point estimate if not).
3. Branch from an up-to-date `develop`: `git checkout -b feature/SCRUM-xxx-release-X.Y.Z origin/develop`.
4. Bump both files:
   ```bash
   echo "X.Y.Z" > VERSION
   (cd frontend && npm version X.Y.Z --no-git-tag-version --allow-same-version)
   ```
5. Run the `ci-checks` skill. `backend/tests/test_version.py` and `frontend/src/version.test.ts` must pass.
6. Commit `SCRUM-xxx: Bump version to X.Y.Z for release`, open `[SCRUM-xxx] Bump version to X.Y.Z for release` into `develop`, merge once checks pass, delete the branch and comment the merge hash on the ticket.
7. Merge `develop` into `master` through a PR (`gh pr create --base master --head develop`) and wait for checks.
8. Tag and publish from `master`:
   ```bash
   git fetch origin && git checkout master && git pull --ff-only
   test "v$(cat VERSION)" = "vX.Y.Z"
   gh release create vX.Y.Z --target master --generate-notes
   ```
9. Comment the `master` merge hash on each included ticket (or the release ticket) and report the release URL.
