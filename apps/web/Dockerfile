# syntax=docker/dockerfile:1.7
# ─── Build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace=@peoplecore/web --workspace=@peoplecore/shared --include-workspace-root

COPY packages/shared packages/shared
COPY apps/web apps/web
# `@peoplecore/shared` is consumed from its built `dist/`, so build it first.
RUN npm run build --workspace=@peoplecore/shared
RUN npm run build --workspace=@peoplecore/web

# ─── Runtime (static assets behind nginx) ────────────────────────────────────
FROM nginx:1.29-alpine AS runtime
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
