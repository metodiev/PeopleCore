# syntax=docker/dockerfile:1.7
# ─── Build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts --workspace=@peoplecore/api --workspace=@peoplecore/shared --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace=@peoplecore/shared
RUN npx prisma generate --schema apps/api/prisma/schema.prisma || (cd apps/api && npx prisma generate)
RUN npm run build --workspace=@peoplecore/api

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl curl tini && \
    addgroup -S peoplecore && adduser -S peoplecore -G peoplecore

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts --workspace=@peoplecore/api --workspace=@peoplecore/shared --include-workspace-root && \
    npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/api/src apps/api/src
# The seeder (RUN_SEED=true) loads TypeScript sources through Node type stripping
# and the runtime imports `@peoplecore/shared` from its built output.
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/api/docker-entrypoint.sh apps/api/docker-entrypoint.sh

RUN chmod +x apps/api/docker-entrypoint.sh && chown -R peoplecore:peoplecore /app
USER peoplecore
WORKDIR /app/apps/api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
