#!/bin/sh
set -e

echo "[entrypoint] PeopleCore API starting (NODE_ENV=${NODE_ENV:-production}, driver=${DATABASE_DRIVER:-postgres})"

if [ "${DATABASE_DRIVER:-postgres}" = "postgres" ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations…"
  npx prisma migrate deploy --schema prisma/schema.prisma
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data…"
  node --experimental-strip-types prisma/seed.ts || echo "[entrypoint] Seeding failed (ignored)"
fi

exec "$@"
