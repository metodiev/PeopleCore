#!/usr/bin/env bash
#
# Starts the PeopleCore web system (API + web UI).
#
# Two modes:
#   • local (default) — runs the API (embedded PostgreSQL) and Vite dev server
#     as background processes, no Docker required.
#   • docker (--docker) — brings up the full Compose stack (PostgreSQL, Redis,
#     MinIO, API, web behind nginx).
#
# Processes started here are tracked in .run/ and stopped by scripts/stop.sh.

set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

MODE="local"
START_API=1
START_WEB=1
SEED=0
RESET_DB=0
INSTALL=1
OPEN_BROWSER=0

usage() {
  printf '%s\n' "Usage: scripts/start.sh [options]"
  printf '\n%s\n' "Starts the PeopleCore web system (API + web UI)."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --api-only        Start only the API"
  printf '%s\n' "  --web-only        Start only the web UI"
  printf '%s\n' "  --docker          Use the Docker Compose stack instead of local servers"
  printf '%s\n' "  --seed            Seed demo data before starting (local mode)"
  printf '%s\n' "  --reset           Delete the local embedded database first (local mode)"
  printf '%s\n' "  --no-install      Do not install dependencies when node_modules is missing"
  printf '%s\n' "  --open            Open the web UI in the default browser when ready"
  printf '%s\n' "  -h, --help        Show this help"
  printf '\n%s\n' "Examples:"
  printf '%s\n' "  scripts/start.sh                 # API + web, local mode"
  printf '%s\n' "  scripts/start.sh --seed          # …and load the Acme demo data"
  printf '%s\n' "  scripts/start.sh --api-only      # just the API on :$API_PORT"
  printf '%s\n' "  scripts/start.sh --docker        # full stack with real PostgreSQL"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --api-only)
    START_WEB=0
    ;;
  --web-only)
    START_API=0
    ;;
  --docker)
    MODE="docker"
    ;;
  --seed)
    SEED=1
    ;;
  --reset)
    RESET_DB=1
    ;;
  --no-install)
    INSTALL=0
    ;;
  --open)
    OPEN_BROWSER=1
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    error "Unknown option: $1"
    printf '\n'
    usage
    exit 1
    ;;
  esac
  shift
done

# ─── Docker mode ─────────────────────────────────────────────────────────────
start_docker() {
  require_cmd docker "install Docker Desktop — https://www.docker.com/products/docker-desktop"

  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. Start Docker Desktop and try again."
  fi

  for var in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY; do
    if [ -z "$(eval "printf '%s' \"\${$var:-}\"")" ]; then
      warn "$var is not set — the stack requires it (see .env.example)"
    fi
  done

  banner "Starting the Docker Compose stack"
  info "Building and starting PostgreSQL, Redis, MinIO, API and web…"
  (cd "$REPO_ROOT" && docker compose -f infra/docker-compose.yml up -d --build)

  info "Waiting for the API to become ready (this can take a minute on a cold build)…"
  if wait_for_http "http://localhost:$API_PORT/health/ready" 180; then
    success "API is ready"
  else
    warn "API did not report ready in time — check: docker compose -f infra/docker-compose.yml logs api"
  fi

  banner "PeopleCore is running"
  debug_note "web          → http://localhost:8080"
  debug_note "api          → http://localhost:$API_PORT/api/v1"
  debug_note "minio console→ http://localhost:9001"
  debug_note "logs         → docker compose -f infra/docker-compose.yml logs -f"
  debug_note "stop         → scripts/stop.sh --docker"
  printf '\n'
}

# ─── Local mode ──────────────────────────────────────────────────────────────
start_local_api() {
  assert_port_free "$API_PORT" "API"

  if [ "$RESET_DB" -eq 1 ]; then
    local data_dir
    data_dir="$(grep -E '^PGLITE_DATA_DIR=' "$REPO_ROOT/apps/api/.env" 2>/dev/null | cut -d= -f2- || true)"
    data_dir="${data_dir:-./.pgdata}"
    info "Resetting the embedded database at apps/api/${data_dir}…"
    rm -rf "$REPO_ROOT/apps/api/$data_dir"
  fi

  if [ "$SEED" -eq 1 ]; then
    banner "Seeding demo data"
    (cd "$REPO_ROOT" && npm run db:seed)
  fi

  banner "Starting the API"
  start_background "api" "$REPO_ROOT" -- npm run dev:api

  info "Waiting for the API on port ${API_PORT}…"
  if wait_for_http "http://localhost:$API_PORT/health" 120; then
    report_started "API" "api" "http://localhost:$API_PORT/api/v1  ·  docs: http://localhost:$API_PORT/api/docs"
  else
    report_failure "API" "api" 25
    die "Fix the error above, then run scripts/start.sh again."
  fi
}

start_local_web() {
  assert_port_free "$WEB_PORT" "web"

  banner "Starting the web UI"
  start_background "web" "$REPO_ROOT" -- npm run dev:web

  info "Waiting for the web UI on port ${WEB_PORT}…"
  if wait_for_port "$WEB_PORT" 90; then
    report_started "web" "web" "http://localhost:$WEB_PORT"
  else
    report_failure "web" "web" 25
    die "Fix the error above, then run scripts/start.sh again."
  fi
}

start_local() {
  require_cmd node "install Node.js 22+ — https://nodejs.org"
  require_cmd npm
  require_cmd curl
  require_cmd lsof "ships with macOS; install lsof on Linux"

  if [ "$INSTALL" -eq 1 ]; then
    require_workspace_deps
  elif [ ! -d "$REPO_ROOT/node_modules" ]; then
    die "node_modules is missing. Run 'npm install' or drop --no-install."
  fi
  require_shared_build
  require_prisma_client

  if [ "$START_API" -eq 1 ]; then start_local_api; fi
  if [ "$START_WEB" -eq 1 ]; then start_local_web; fi

  banner "PeopleCore is running"
  if [ "$START_API" -eq 1 ]; then
    debug_note "api       → http://localhost:$API_PORT/api/v1"
    debug_note "api docs  → http://localhost:$API_PORT/api/docs"
  fi
  if [ "$START_WEB" -eq 1 ]; then
    debug_note "web       → http://localhost:$WEB_PORT"
    debug_note "sign in   → admin@acme.test / Demo-Passw0rd!23 (after scripts/start.sh --seed)"
  fi
  debug_note "logs      → $RUN_DIR/"
  debug_note "stop      → scripts/stop.sh"
  debug_note "restart   → scripts/restart.sh"
  printf '\n'

  if [ "$OPEN_BROWSER" -eq 1 ] && [ "$START_WEB" -eq 1 ]; then
    case "$(uname -s)" in
    Darwin) open "http://localhost:$WEB_PORT" ;;
    Linux) xdg-open "http://localhost:$WEB_PORT" >/dev/null 2>&1 || true ;;
    esac
  fi
}

if [ "$MODE" = "docker" ]; then
  start_docker
else
  start_local
fi
