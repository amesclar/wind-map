# SCRUM-135 tasks

- [x] 1. `scripts/gcp-provision.sh`: enable the APIs, create the bucket with uniform access, public access prevention and the lifecycle rule.
  _Requirements: 1.1, 1.2_
  _Files: `scripts/gcp-provision.sh`_
- [x] 2. Secrets: `APP_PASSWORD` from a generated or supplied value without printing it, optional `CARTO_API_KEY`.
  _Requirements: 1.3, 1.4_
  _Files: `scripts/gcp-provision.sh`_
- [x] 3. Service account and IAM: `wind-map-runner`, bucket `objectAdmin`, secret `secretAccessor`.
  _Requirements: 1.5, 1.6_
  _Files: `scripts/gcp-provision.sh`_
- [x] 4. Verification by impersonation: bucket probe and secret read, with the fix-it command when impersonation is denied.
  _Requirements: 1.8_
  _Files: `scripts/gcp-provision.sh`_
- [x] 5. Docs: `requirements.md` infrastructure section and `README.md` Cloud Run section.
  _Requirements: 1.9_
  _Files: `requirements.md`, `README.md`_
- [x] 6. Run the script on `wind-app-515017`, then rerun it to prove idempotency.
  _Requirements: 1.1–1.8_
