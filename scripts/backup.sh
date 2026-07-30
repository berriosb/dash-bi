#!/usr/bin/env bash
set -euo pipefail

# Automated backup script for dash-bi PostgreSQL database
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dashbi}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CONTAINER_NAME="${POSTGRES_CONTAINER:-dashbi-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-dashbi}"
POSTGRES_DB="${POSTGRES_DB:-dashbi}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/dashbi_${TIMESTAMP}.dump"

echo "[$(date -Iseconds)] Starting PostgreSQL backup to ${BACKUP_FILE}..."

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker exec -t "$CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_FILE"
else
  echo "Error: Container ${CONTAINER_NAME} is not running." >&2
  exit 1
fi

echo "[$(date -Iseconds)] Backup complete. Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "dashbi_*.dump" -mtime +"$RETENTION_DAYS" -delete || true

echo "[$(date -Iseconds)] Backup job successfully finished."
