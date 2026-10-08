#!/usr/bin/env bash
#
# Stops the PeopleCore web system started by scripts/start.sh.
#
# Components are tracked in .run/*.pid. With --force the script also kills
# whatever holds the API/web ports, which is useful after a crash or when the
# processes were started by hand.

set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

MODE="local"
FORCE=0
QUIET=0

usage() {
  printf '%s\n' "Usage: scripts/stop.sh [options]"
  printf '\n%s\n' "Stops the PeopleCore web system."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --docker     Stop the Docker Compose stack instead of local servers"
  printf '%s\n' "  --force      Also kill any process holding port $API_PORT or $WEB_PORT"
  printf '%s\n' "  --quiet      Only report problems"
  printf '%s\n' "  -h, --help   Show this help"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --docker)
    MODE="docker"
    ;;
  --force)
    FORCE=1
    ;;
  --quiet)
    QUIET=1
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

say() { if [ "$QUIET" -eq 0 ]; then info "$*"; fi; }

stop_docker() {
  require_cmd docker "install Docker Desktop — https://www.docker.com/products/docker-desktop"

  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not reachable. Start Docker Desktop and try again."
  fi

  say "Stopping the Docker Compose stack…"
  (cd "$REPO_ROOT" && docker compose -f infra/docker-compose.yml down)
  if [ "$QUIET" -eq 0 ]; then success "Docker stack stopped (volumes preserved)"; fi
}

# Stops a tracked component, reporting what happened.
stop_tracked() {
  local label="$1" name="$2"
  if stop_component "$name"; then
    if [ "$QUIET" -eq 0 ]; then success "$label stopped"; fi
    return 0
  fi
  return 1
}

# Kills whatever holds a port (used by --force, and as a safety net).
stop_port_owner() {
  local port="$1" label="$2" pid
  pid="$(pid_on_port "$port")"
  if [ -z "$pid" ]; then
    return 1
  fi
  warn "Port $port ($label) is still held by PID $pid — terminating"
  terminate_pid "$pid" || warn "Could not terminate PID $pid"
  if [ "$QUIET" -eq 0 ]; then success "$label stopped (port $port released)"; fi
  return 0
}

# PIDs of this repo's dev servers that no PID file tracks — they survive when a
# previous script run was interrupted (or the terminal was closed).
stale_dev_pids() {
  local pid cmd
  for pid in $(pgrep -f "nest start --watch" 2>/dev/null) $(pgrep -f "node_modules/.bin/vite" 2>/dev/null); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    case "$cmd" in
    *"$REPO_ROOT"*) printf '%s\n' "$pid" ;;
    esac
  done
}

stop_local() {
  require_cmd lsof "ships with macOS; install lsof on Linux"

  local stopped=0

  if stop_tracked "web UI" "web"; then stopped=$((stopped + 1)); fi
  if stop_tracked "API" "api"; then stopped=$((stopped + 1)); fi

  # Untracked leftovers from an interrupted run are still ours — stop them too.
  local stale
  stale="$(stale_dev_pids | sort -u | tr '\n' ' ')"
  if [ -n "${stale// /}" ]; then
    local pid
    for pid in $stale; do
      warn "Stopping untracked dev process $pid"
      terminate_pid "$pid" || true
      stopped=$((stopped + 1))
    done
  fi

  if [ "$FORCE" -eq 1 ]; then
    if stop_port_owner "$WEB_PORT" "web UI"; then stopped=$((stopped + 1)); fi
    if stop_port_owner "$API_PORT" "API"; then stopped=$((stopped + 1)); fi
  fi

  if [ "$stopped" -eq 0 ]; then
    if [ "$QUIET" -eq 0 ]; then
      info "Nothing to stop — the local system is not running."
      debug_note "If a process is holding port $API_PORT or $WEB_PORT, run: scripts/stop.sh --force"
    fi
    return 0
  fi

  # A leftover port owner means something survived.
  local lingering=""
  if port_in_use "$API_PORT"; then lingering="$lingering api($API_PORT)"; fi
  if port_in_use "$WEB_PORT"; then lingering="$lingering web($WEB_PORT)"; fi
  if [ -n "$lingering" ]; then
    warn "Still listening after shutdown:$lingering"
    warn "Re-run with: scripts/stop.sh --force"
    return 1
  fi

  if [ "$QUIET" -eq 0 ]; then
    printf '\n'
    success "Local system stopped"
    printf '\n'
  fi
  return 0
}

if [ "$MODE" = "docker" ]; then
  stop_docker
else
  stop_local
fi
