# SCRUM-136 tasks

- [x] 1. Artifact Registry: create the `wind-map` docker repository in `us-west1`; build the image for `linux/amd64` with the commit hash and push `VERSION-hash` and `latest`.
  _Requirements: 1.1_
- [x] 2. `scripts/docker-entrypoint.sh`: create the schema after a restore that found no replica, before `litestream replicate`.
  _Requirements: 1.4_
- [x] 3. Deploy the `wind-map` service with the runner account, bucket variable and `APP_PASSWORD` secret.
  _Requirements: 1.2, 1.3_
- [x] 4. Verify Basic Auth (401/challenge, 200 with the password), the open health check, and persistence across a revision roll.
  _Requirements: 1.5–1.7_
- [x] 5. Docs: `requirements.md` deployment section, `README.md` deployment, verification and rollback.
  _Requirements: 1.8_
- [x] 6. Local CI parity, PR, merge, ticket and container rebuild.
