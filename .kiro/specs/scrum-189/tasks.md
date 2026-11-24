# SCRUM-189 tasks

- [x] 1. Workload Identity pool, provider restricted to `amesclar/wind-map`, deployer service account and its three role bindings.
  _Requirements: 1.2, 1.3_
- [x] 2. Workflow: amd64 build with `GIT_SHA`, tags `VERSION-<sha>` and `latest`, push to Artifact Registry.
  _Requirements: 1.1_
- [x] 3. Workflow: deploy with the SCRUM-136 settings and the health smoke test; triggers on push to `develop` and on demand; single-deployment concurrency.
  _Requirements: 1.4–1.6_
- [x] 4. Docs: `requirements.md` and `README.md` deployment section.
  _Requirements: 1.7_
- [ ] 5. Merge and confirm the workflow deploys the merge commit; verify Basic Auth and the open health check on the live URL.
  _Requirements: acceptance criteria_
