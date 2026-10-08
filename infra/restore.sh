#!/bin/sh
# Restore a PeopleCore backup.
#   PGHOST=localhost PGUSER=peoplecore PGPASSWORD=… ./infra/restore.sh backups/peoplecore-20260101T020000Z.dump
set -eu
FILE="${1:?usage: restore.sh <dump-file>}"

echo "[restore] verifying ${FILE}"
pg_restore --list "${FILE}" >/dev/null

echo "[restore] stopping application writes is recommended before continuing"
echo "[restore] restoring into ${PGDATABASE:-peoplecore} on ${PGHOST:-localhost}"
pg_restore --clean --if-exists --no-owner --dbname="${PGDATABASE:-peoplecore}" "${FILE}"

echo "[restore] done — run \`npx prisma migrate deploy\` to apply any newer migrations"
