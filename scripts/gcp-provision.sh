#!/usr/bin/env bash
# Provision the Google Cloud resources Cloud Run and Litestream need (SCRUM-135).
# Idempotent: resources that already exist are left alone and an existing password is never rotated.
#
#   gcloud auth login
#   gcloud config set project wind-app-515017
#   scripts/gcp-provision.sh                      # generates the shared password
#   APP_PASSWORD='...' scripts/gcp-provision.sh   # uses the given shared password
#   CARTO_API_KEY='...' scripts/gcp-provision.sh  # also stores the optional CARTO key
#   GCP_MAP_KEY='...' scripts/gcp-provision.sh    # also stores the Google Maps key
set -euo pipefail

PROJECT="${GCP_PROJECT:-wind-app-515017}"
REGION="${GCP_REGION:-us-west1}"
BUCKET="${LITESTREAM_BUCKET:-wind-map-litestream-${PROJECT}}"
SERVICE_ACCOUNT="${RUN_SERVICE_ACCOUNT:-wind-map-runner@${PROJECT}.iam.gserviceaccount.com}"
SERVICE_ACCOUNT_ID="${SERVICE_ACCOUNT%%@*}"
PASSWORD_SECRET="APP_PASSWORD"
CARTO_SECRET="CARTO_API_KEY"
JIRA_SECRET="JIRA_API_TOKEN"
GOOGLE_SECRET="GCP_MAP_KEY"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcp-provision: gcloud is not installed" >&2
  exit 1
fi

gcloud config set project "$PROJECT" >/dev/null
echo "project:         $PROJECT"
echo "region:          $REGION"
echo "bucket:          gs://$BUCKET"
echo "service account: $SERVICE_ACCOUNT"
echo

echo "==> APIs (Cloud Storage, Secret Manager)"
gcloud services enable storage.googleapis.com secretmanager.googleapis.com \
  --project="$PROJECT" --quiet

echo "==> Bucket gs://$BUCKET"
if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists; applying the bucket settings"
else
  gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --quiet
  echo "    created in $REGION"
fi
gcloud storage buckets update "gs://$BUCKET" --project="$PROJECT" \
  --uniform-bucket-level-access --public-access-prevention --quiet
# Nothing is public and unfinished Litestream uploads are dropped instead of kept forever.
lifecycle="$(mktemp)"
probe=""
trap 'rm -f "$lifecycle" ${probe:+"$probe"}' EXIT
cat >"$lifecycle" <<'JSON'
{"lifecycle":{"rule":[{"action":{"type":"AbortIncompleteMultipartUpload"},"condition":{"age":7}}]}}
JSON
gcloud storage buckets update "gs://$BUCKET" --project="$PROJECT" --lifecycle-file="$lifecycle" --quiet
echo "    uniform access, public access prevention, 7-day abort of unfinished uploads"

echo "==> Secret $PASSWORD_SECRET"
if gcloud secrets describe "$PASSWORD_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists; the stored password is unchanged"
else
  password="${APP_PASSWORD:-$(openssl rand -hex 24)}"
  printf '%s' "$password" | gcloud secrets create "$PASSWORD_SECRET" --project="$PROJECT" \
    --replication-policy="automatic" --data-file=- --quiet >/dev/null
  unset password
  echo "    created; read it with: gcloud secrets versions access latest --secret=$PASSWORD_SECRET --project=$PROJECT"
fi

echo "==> Secret $CARTO_SECRET (optional)"
if [ -n "${CARTO_API_KEY:-}" ]; then
  if gcloud secrets describe "$CARTO_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$CARTO_API_KEY" | gcloud secrets versions add "$CARTO_SECRET" \
      --project="$PROJECT" --data-file=- --quiet >/dev/null
    echo "    exists; added the supplied value as a new version"
  else
    printf '%s' "$CARTO_API_KEY" | gcloud secrets create "$CARTO_SECRET" --project="$PROJECT" \
      --replication-policy="automatic" --data-file=- --quiet >/dev/null
    echo "    created"
  fi
elif gcloud secrets describe "$CARTO_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists; unchanged (no CARTO_API_KEY supplied)"
else
  echo "    skipped: no CARTO_API_KEY supplied, the app keeps using the OpenStreetMap tiles"
fi

echo "==> Secret $JIRA_SECRET (optional)"
if [ -n "${JIRA_API_TOKEN:-}" ]; then
  if gcloud secrets describe "$JIRA_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$JIRA_API_TOKEN" | gcloud secrets versions add "$JIRA_SECRET" \
      --project="$PROJECT" --data-file=- --quiet >/dev/null
    echo "    exists; added the supplied value as a new version"
  else
    printf '%s' "$JIRA_API_TOKEN" | gcloud secrets create "$JIRA_SECRET" \
      --project="$PROJECT" --replication-policy="automatic" --data-file=- --quiet >/dev/null
    echo "    created"
  fi
elif gcloud secrets describe "$JIRA_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists; unchanged (no JIRA_API_TOKEN supplied)"
else
  echo "    skipped: no JIRA_API_TOKEN supplied, in-app feedback stays off"
fi

echo "==> Secret $GOOGLE_SECRET (optional)"
if [ -n "${GCP_MAP_KEY:-}" ]; then
  if gcloud secrets describe "$GOOGLE_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$GCP_MAP_KEY" | gcloud secrets versions add "$GOOGLE_SECRET" \
      --project="$PROJECT" --data-file=- --quiet >/dev/null
    echo "    exists; added the supplied value as a new version"
  else
    printf '%s' "$GCP_MAP_KEY" | gcloud secrets create "$GOOGLE_SECRET" --project="$PROJECT" \
      --replication-policy="automatic" --data-file=- --quiet >/dev/null
    echo "    created"
  fi
elif gcloud secrets describe "$GOOGLE_SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists; unchanged (no GCP_MAP_KEY supplied)"
else
  echo "    skipped: no GCP_MAP_KEY supplied, the Google Satellite layer stays hidden"
fi

echo "==> Service account $SERVICE_ACCOUNT"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$PROJECT" >/dev/null 2>&1; then
  echo "    exists"
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" --project="$PROJECT" \
    --display-name="wind-map Cloud Run runner" --quiet
  echo "    created"
fi

echo "==> IAM"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project="$PROJECT" \
  --member="serviceAccount:$SERVICE_ACCOUNT" --role="roles/storage.objectAdmin" --quiet >/dev/null
echo "    roles/storage.objectAdmin on gs://$BUCKET"
for secret in "$PASSWORD_SECRET" "$CARTO_SECRET" "$JIRA_SECRET" "$GOOGLE_SECRET"; do
  if gcloud secrets describe "$secret" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$secret" --project="$PROJECT" \
      --member="serviceAccount:$SERVICE_ACCOUNT" \
      --role="roles/secretmanager.secretAccessor" --quiet >/dev/null
    echo "    roles/secretmanager.secretAccessor on $secret"
  fi
done

# The operator needs to act as the runner to run the verification below; this is not
# access the deployed container uses.
echo "==> Impersonation (verification only)"
caller="$(gcloud config get-value account 2>/dev/null)"
case "$caller" in
  *.gserviceaccount.com) caller_member="serviceAccount:$caller" ;;
  *@*) caller_member="user:$caller" ;;
  *) caller_member="" ;;
esac
if [ -n "$caller_member" ] && gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --project="$PROJECT" --member="$caller_member" \
  --role="roles/iam.serviceAccountTokenCreator" --quiet >/dev/null 2>&1; then
  echo "    $caller_member can impersonate the service account"
else
  echo "    could not grant $caller impersonation; the verification below reports if it is needed"
fi

echo "==> Verification as $SERVICE_ACCOUNT (impersonation)"
probe="$(mktemp)"
echo "wind-map storage probe $(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$probe"
uploaded=""
output=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  # A new IAM binding takes up to a minute to propagate, so retry before giving up.
  if output="$(gcloud storage cp "$probe" "gs://$BUCKET/_provision-check.txt" --project="$PROJECT" \
    --impersonate-service-account="$SERVICE_ACCOUNT" --quiet 2>&1 | tail -n 1)"; then
    uploaded="yes"
    break
  fi
  if [ "$attempt" -lt 10 ]; then
    sleep 6
  fi
done
if [ "$uploaded" != "yes" ]; then
  echo "$output" >&2
  cat >&2 <<EOF

Verification could not impersonate the service account. A new IAM binding can take a minute to
propagate, so run the script again first. If it keeps failing, grant the binding:

  gcloud iam service-accounts add-iam-policy-binding $SERVICE_ACCOUNT \\
    --project=$PROJECT --member="$caller_member" \\
    --role=roles/iam.serviceAccountTokenCreator
EOF
  exit 1
fi
gcloud storage cat "gs://$BUCKET/_provision-check.txt" --project="$PROJECT" \
  --impersonate-service-account="$SERVICE_ACCOUNT" >/dev/null
gcloud storage rm "gs://$BUCKET/_provision-check.txt" --project="$PROJECT" \
  --impersonate-service-account="$SERVICE_ACCOUNT" --quiet
echo "    bucket: wrote, read and deleted a probe object"
gcloud secrets versions access latest --secret="$PASSWORD_SECRET" --project="$PROJECT" \
  --impersonate-service-account="$SERVICE_ACCOUNT" >/dev/null
echo "    secrets: read $PASSWORD_SECRET"

echo
echo "Cloud Run (SCRUM-136, SCRUM-190) needs:"
echo "  --service-account=$SERVICE_ACCOUNT"
echo "  --set-env-vars=LITESTREAM_BUCKET=$BUCKET"
echo "  --set-secrets=APP_PASSWORD=${PASSWORD_SECRET}:latest,CARTO_API_KEY=${CARTO_SECRET}:latest,JIRA_API_TOKEN=${JIRA_SECRET}:latest,GCP_MAP_KEY=${GOOGLE_SECRET}:latest"
echo "  (in-app feedback also needs JIRA_BASE_URL and JIRA_EMAIL; the workflow sets all of it)"
echo "  (GCP_MAP_KEY enables the Google Satellite basemap; without it the option stays hidden)"
