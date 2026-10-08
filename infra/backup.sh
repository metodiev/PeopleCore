#!/bin/sh
# PeopleCore database backup with retention pruning.
# Usage:  BACKUP_DIR=/backups ./infra/backup.sh
# Cron:   0 2 * * *  /opt/peoplecore/infra/backup.sh >> /var/log/peoplecore-backup.log 2>&1
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/peoplecore-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup] dumping to ${FILE}"
pg_dump --format=custom --compress=9 --no-owner --file="${FILE}"

# Verify the dump is readable before considering it good.
pg_restore --list "${FILE}" >/dev/null

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[backup] uploading to s3://${BACKUP_S3_BUCKET}"
  aws s3 cp "${FILE}" "s3://${BACKUP_S3_BUCKET}/$(basename "${FILE}")" ${BACKUP_S3_ENDPOINT:+--endpoint-url "${BACKUP_S3_ENDPOINT}"}
fi

echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'peoplecore-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] done: $(du -h "${FILE}" | cut -f1)"
