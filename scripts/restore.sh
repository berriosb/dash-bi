#!/usr/bin/env bash
set -euo pipefail

# Database restore script for dash-bi PostgreSQL database
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path-to-dump-file>"
  exit 1
fi

DUMP_FILE="$1"
CONTAINER_NAME="${POSTGRES_CONTAINER:-dashbi-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-dashbi}"
POSTGRES_DB="${POSTGRES_DB:-dashbi}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Error: Dump file $DUMP_FILE does not exist." >&2
  exit 1
fi

echo "[$(date -Iseconds)] Restoring PostgreSQL database from ${DUMP_FILE}..."

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker exec -i "$CONTAINER_NAME" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$DUMP_FILE"
else
  echo "Error: Container ${CONTAINER_NAME} is not running." >&2
  exit 1
fi

echo "[$(date -Iseconds)] Restore complete."
