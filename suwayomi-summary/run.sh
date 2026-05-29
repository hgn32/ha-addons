#!/bin/sh
# Home Assistant add-on entrypoint.
# Data dir / aliases.json initialization is handled inside the Python app.
set -e

DATA_DIR="${DATA_DIR:-/config/suwayomi}"
mkdir -p "${DATA_DIR}"

export BACKUP_DIR="${BACKUP_DIR:-${DATA_DIR}}"
export ALIASES_FILE="${ALIASES_FILE:-${DATA_DIR}/aliases.json}"

echo "[suwayomi_summary] BACKUP_DIR=${BACKUP_DIR}"
echo "[suwayomi_summary] ALIASES_FILE=${ALIASES_FILE}"

# bind to 0.0.0.0 inside the container; HA Supervisor only forwards
# ingress traffic from 172.30.32.2.
exec uvicorn app.main:app --host 0.0.0.0 --port 8099
