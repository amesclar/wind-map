#!/usr/bin/env bash
# Prepare the self-hosted Open-Meteo fallback on Compute Engine (SCRUM-265).
#
# The fallback from the SCRUM-236 spike is a small VM in us-west1 that runs the official
# Open-Meteo container against the public AWS data, warming its cache for the default view.
# Nothing here is billable until `create` is run: `plan` only prints, and `create` and `delete`
# refuse to act without `--yes`. The VM costs about $58.92 a month while it exists; `delete`
# returns the project to $0, because the disk is the instance's boot disk.
#
#   scripts/open-meteo-fallback.sh plan      # what would be created, and the cost (default)
#   scripts/open-meteo-fallback.sh status    # read-only: does it exist, and is it running?
#   scripts/open-meteo-fallback.sh create --yes
#   scripts/open-meteo-fallback.sh delete --yes
#
# Reaching it from Cloud Run needs a Serverless VPC Access connector in the same region, which
# SCRUM-266 adds; this script creates no connector and no Cloud Run change.
set -euo pipefail

PROJECT="${GCP_PROJECT:-wind-app-515017}"
REGION="${GCP_REGION:-us-west1}"
ZONE="${GCP_ZONE:-us-west1-b}"
INSTANCE="${OPEN_METEO_INSTANCE:-open-meteo-fallback}"
FIREWALL="${INSTANCE}-8080"
MACHINE="${OPEN_METEO_MACHINE:-e2-standard-2}"
DISK_GB="${OPEN_METEO_DISK_GB:-100}"
# The Serverless VPC Access connector's range (SCRUM-266). 8080 is closed to everything else,
# so an ephemeral external IP is used only for the outbound S3 download.
SOURCE_RANGES="${OPEN_METEO_SOURCE_RANGES:-10.8.0.0/28}"
STARTUP="$(
  cd "$(dirname "$0")" && pwd
)/open-meteo-fallback-startup.sh"
LABELS="app=wind-map,role=open-meteo-fallback"

# Prices are the us-west1 list prices on 2026-11-26, printed as an estimate rather than a quote.
COMPUTE_HOURLY="0.06701142"
DISK_GB_MONTH="0.10"

usage() {
  cat <<'EOF'
usage: scripts/open-meteo-fallback.sh <command>

  plan      print what create would do and the monthly cost; changes nothing (default)
  status    read-only check of the instance and the firewall rule
  create    create the VM and the firewall rule (requires --yes)
  delete    delete the VM and the firewall rule, returning the project to $0 (requires --yes)

Environment: GCP_PROJECT, GCP_REGION, GCP_ZONE, OPEN_METEO_INSTANCE, OPEN_METEO_MACHINE,
OPEN_METEO_DISK_GB, OPEN_METEO_SOURCE_RANGES.
EOF
}

monthly_cost() {
  awk -v hourly="$COMPUTE_HOURLY" -v per_gb="$DISK_GB_MONTH" -v gb="$DISK_GB" 'BEGIN {
    compute = hourly * 730
    disk = per_gb * gb
    printf "%.2f %.2f %.2f\n", compute, disk, compute + disk
  }'
}

plan() {
  read -r compute disk total < <(monthly_cost)
  cat <<EOF
Open-Meteo fallback (SCRUM-265), prepared and NOT created

  project        $PROJECT
  zone           $ZONE ($REGION)
  instance       $INSTANCE
  machine type   $MACHINE (2 vCPU, 8 GB)
  boot disk      ${DISK_GB} GB pd-balanced, also the cache (CACHE_SIZE=32GB)
  image          Container-Optimized OS, running the Open-Meteo container pinned by digest
  startup        scripts/open-meteo-fallback-startup.sh
  firewall       $FIREWALL: tcp:8080 from $SOURCE_RANGES only
  labels         $LABELS

Estimated cost while it exists (us-west1 list prices, 730 h/month):
  compute        \$$compute
  disk           \$$disk
  total          \$$total per month

Not created by this script, and not included above:
  - the Serverless VPC Access connector that lets Cloud Run reach it (SCRUM-266, about \$9/month)
  - Cloud Run to VM traffic in the same region (about \$0.01/GiB)

Nothing has been created and nothing is billing. Run:
  scripts/open-meteo-fallback.sh create --yes
EOF
}

require_gcloud() {
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "open-meteo-fallback: gcloud is not installed" >&2
    exit 1
  fi
}

require_yes() {
  local command="$1"
  shift
  for argument in "$@"; do
    if [ "$argument" = "--yes" ]; then
      return 0
    fi
  done
  echo "open-meteo-fallback: '$command' adds or removes billable Google Cloud resources; pass --yes." >&2
  plan >&2
  exit 1
}

installed() {
  gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" >/dev/null 2>&1
}

firewall_installed() {
  gcloud compute firewall-rules describe "$FIREWALL" --project="$PROJECT" >/dev/null 2>&1
}

status() {
  require_gcloud
  echo "project:  $PROJECT"
  if installed; then
    echo "instance: present"
    gcloud compute instances describe "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
      --format='value(status,networkInterfaces[0].networkIP)' | sed 's/^/          /'
  else
    echo "instance: absent (nothing is billing)"
  fi
  if firewall_installed; then
    echo "firewall: present ($FIREWALL)"
  else
    echo "firewall: absent"
  fi
}

create() {
  require_gcloud
  echo "==> APIs (Compute Engine)"
  gcloud services enable compute.googleapis.com --project="$PROJECT" --quiet

  # The firewall rule goes first, so port 8080 is never open to the internet, not even for the
  # seconds between the instance booting and the rule existing.
  echo "==> Firewall $FIREWALL (tcp:8080 from $SOURCE_RANGES)"
  if firewall_installed; then
    echo "    exists; unchanged"
  else
    gcloud compute firewall-rules create "$FIREWALL" --project="$PROJECT" \
      --direction=INGRESS --action=ALLOW --rules=tcp:8080 \
      --source-ranges="$SOURCE_RANGES" --target-tags="$INSTANCE" \
      --description="Open-Meteo fallback API, reachable only from the VPC connector (SCRUM-265)" \
      --quiet
    echo "    created"
  fi

  echo "==> Instance $INSTANCE ($MACHINE, ${DISK_GB} GB, $ZONE)"
  if installed; then
    echo "    exists; unchanged (the startup script re-runs on every boot)"
  else
    gcloud compute instances create "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
      --machine-type="$MACHINE" \
      --image-family=cos-stable --image-project=cos-cloud \
      --boot-disk-size="${DISK_GB}GB" --boot-disk-type=pd-balanced \
      --tags="$INSTANCE" --labels="$LABELS" \
      --scopes=logging-write,monitoring-write \
      --metadata-from-file=startup-script="$STARTUP" \
      --quiet
    echo "    created"
  fi

  cat <<EOF

The first request downloads the model metadata from S3 and took 133 s in the spike; the startup
script starts a ten-minute warm-up loop that does that before anything else uses it.

Check it from your machine (no public port is open, so use an IAP tunnel):
  gcloud compute ssh $INSTANCE --project=$PROJECT --zone=$ZONE --tunnel-through-iap \\
    -- -N -L 8080:localhost:8080 &
  curl -fsS 'http://127.0.0.1:8080/v1/forecast?latitude=48.2939&longitude=-122.6064&current=temperature_2m'

To stop billing again: scripts/open-meteo-fallback.sh delete --yes
EOF
}

delete() {
  require_gcloud
  echo "==> Instance $INSTANCE"
  if installed; then
    gcloud compute instances delete "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --quiet
    echo "    deleted (its 100 GB boot disk goes with it)"
  else
    echo "    absent; unchanged"
  fi

  echo "==> Firewall $FIREWALL"
  if firewall_installed; then
    gcloud compute firewall-rules delete "$FIREWALL" --project="$PROJECT" --quiet
    echo "    deleted"
  else
    echo "    absent; unchanged"
  fi
  echo
  echo "Nothing from this fallback is left billing."
}

command="${1:-plan}"
case "$command" in
  plan) plan ;;
  status) status ;;
  create) require_yes "$command" "${@:2}"; create ;;
  delete) require_yes "$command" "${@:2}"; delete ;;
  -h | --help | help) usage ;;
  *)
    echo "open-meteo-fallback: unknown command '$command'" >&2
    usage >&2
    exit 2
    ;;
esac
