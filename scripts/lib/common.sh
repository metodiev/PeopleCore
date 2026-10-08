#!/usr/bin/env bash
#
# Shared helpers for the PeopleCore developer scripts.
#
# This file is sourced by the scripts in scripts/ — it is never executed
# directly. It targets bash 3.2 so it works with the shell macOS ships
# (no associative arrays, no ${var,,} case conversion, no mapfile).

# Strict mode for every script that sources this file.
set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
# Derived from this file's location so the scripts work from any directory.
COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$COMMON_LIB_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
RUN_DIR="$REPO_ROOT/.run"

# Default endpoints (kept in sync with apps/api/.env and apps/web/vite.config.ts).
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
METRO_PORT="${METRO_PORT:-8081}"

# ─── Output ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
else
  C_RESET=''
  C_BOLD=''
  C_DIM=''
  C_RED=''
  C_GREEN=''
  C_YELLOW=''
  C_BLUE=''
fi

info() { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
success() { printf '%s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
error() { printf '%s✖%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
debug_note() { printf '%s  %s%s\n' "$C_DIM" "$*" "$C_RESET"; }
die() {
  error "$*"
  exit 1
}

banner() {
  printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"
}

# ─── Requirements ────────────────────────────────────────────────────────────
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Required command '$1' not found${2:+ — $2}"
  fi
}

# Resolves a tool from PATH, falling back to the Android SDK location.
android_tool() {
  local tool="$1" sdk
  if command -v "$tool" >/dev/null 2>&1; then
    command -v "$tool"
    return 0
  fi
  sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  case "$tool" in
  adb)
    if [ -x "$sdk/platform-tools/adb" ]; then
      printf '%s' "$sdk/platform-tools/adb"
      return 0
    fi
    ;;
  emulator)
    if [ -x "$sdk/emulator/emulator" ]; then
      printf '%s' "$sdk/emulator/emulator"
      return 0
    fi
    ;;
  esac
  return 1
}

# ─── Ports & processes ───────────────────────────────────────────────────────
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# PID of the process listening on a TCP port (empty when free).
pid_on_port() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}

# Fails when a port is taken by something this project does not manage.
assert_port_free() {
  local port="$1" label="$2" owner
  if ! port_in_use "$port"; then
    return 0
  fi
  owner="$(pid_on_port "$port")"
  die "Port $port ($label) is already in use by PID ${owner:-unknown}. Run scripts/stop.sh first, or stop that process."
}

# Waits until a TCP port accepts connections.
wait_for_port() {
  local port="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if port_in_use "$port"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Waits until an HTTP endpoint answers successfully.
wait_for_http() {
  local url="$1" timeout="${2:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# ─── PID files ───────────────────────────────────────────────────────────────
pid_file() { printf '%s/%s.pid' "$RUN_DIR" "$1"; }
log_path() { printf '%s/%s.log' "$RUN_DIR" "$1"; }

ensure_run_dir() { mkdir -p "$RUN_DIR"; }

is_alive() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

write_pid() {
  ensure_run_dir
  printf '%s\n' "$2" >"$(pid_file "$1")"
}

# Prints the recorded PID; fails when there is no usable PID file.
read_pid() {
  local file pid
  file="$(pid_file "$1")"
  [ -f "$file" ] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  case "$pid" in
  *[!0-9]*) return 1 ;;
  esac
  printf '%s' "$pid"
}

# Stops a process and everything it spawned.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

# Graceful stop, then SIGKILL after `timeout` seconds. Returns 0 if it stopped.
terminate_pid() {
  local pid="$1" timeout="${2:-15}" waited=0 child
  is_alive "$pid" || return 0
  kill_tree "$pid"
  while is_alive "$pid" && [ "$waited" -lt "$timeout" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if is_alive "$pid"; then
    warn "Process $pid ignored SIGTERM — sending SIGKILL"
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill -9 "$child" 2>/dev/null || true
    done
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  is_alive "$pid" && return 1
  return 0
}

# Stops a component recorded in .run/<name>.pid.
# Returns 0 when a process was stopped, 1 when nothing was running.
stop_component() {
  local name="$1" pid
  if ! pid="$(read_pid "$name")"; then
    rm -f "$(pid_file "$name")"
    return 1
  fi
  if ! is_alive "$pid"; then
    rm -f "$(pid_file "$name")"
    return 1
  fi
  terminate_pid "$pid" || true
  rm -f "$(pid_file "$name")"
  return 0
}

# ─── Background processes ────────────────────────────────────────────────────
# Starts a command detached from this script, logging to .run/<name>.log.
#
# Usage: start_background <name> <workdir> [KEY=value ...] -- <command...>
#
# The command is `exec`-ed by a subshell so the recorded PID is the real
# process, and all three standard descriptors are redirected. Leaving them
# inherited would keep the caller's stdout pipe open for the lifetime of the
# daemon, which makes a pipeline such as `scripts/start.sh | tail` hang.
start_background() {
  local name="$1" workdir="$2"
  shift 2

  ensure_run_dir
  local log
  log="$(log_path "$name")"
  : >"$log"

  # Remaining "KEY=value" arguments up to `--` become environment variables.
  local env_args=""
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    env_args="$env_args $1"
    shift
  done
  if [ "${1:-}" = "--" ]; then shift; fi

  if [ -z "$env_args" ]; then
    (cd "$workdir" && exec nohup "$@") >"$log" 2>&1 </dev/null &
  else
    # shellcheck disable=SC2086
    (cd "$workdir" && exec env $env_args nohup "$@") >"$log" 2>&1 </dev/null &
  fi
  write_pid "$name" "$!"
  return 0
}

# Prints a short summary after a component has been started.
report_started() {
  local label="$1" name="$2" url="$3" pid
  pid="$(read_pid "$name" 2>/dev/null || true)"
  success "$label started (PID ${pid:-unknown})"
  if [ -n "$url" ]; then debug_note "→ $url"; fi
  debug_note "log: $(log_path "$name")"
}

# Prints the tail of a component log when it never came up.
report_failure() {
  local label="$1" name="$2" lines="${3:-15}" log
  log="$(log_path "$name")"
  error "$label failed to start"
  if [ -f "$log" ]; then
    printf '\n%s─── last %s lines of %s ───%s\n' "$C_DIM" "$lines" "$log" "$C_RESET" >&2
    tail -n "$lines" "$log" >&2 || true
    printf '%s────────────────────────────────%s\n\n' "$C_DIM" "$C_RESET" >&2
  fi
}

# ─── Repo state ──────────────────────────────────────────────────────────────

require_workspace_deps() {
  if [ ! -d "$REPO_ROOT/node_modules" ]; then
    info "Installing workspace dependencies…"
    (cd "$REPO_ROOT" && npm install)
  fi
}

require_shared_build() {
  if [ ! -f "$REPO_ROOT/packages/shared/dist/index.js" ]; then
    info "Building @peoplecore/shared…"
    (cd "$REPO_ROOT" && npm run build:shared)
  fi
}

require_prisma_client() {
  if [ ! -f "$REPO_ROOT/apps/api/src/generated/prisma/client.ts" ]; then
    info "Generating the Prisma client…"
    (cd "$REPO_ROOT" && npm run db:generate)
  fi
}

# ─── Mobile: shared helpers ──────────────────────────────────────────────────

MOBILE_DIR="$REPO_ROOT/apps/mobile"
METRO_COMPONENT="metro"

# Reads an Expo env var from the root/mobile .env files, if present.
mobile_env_value() {
  local key="$1" file
  for file in "$MOBILE_DIR/.env" "$REPO_ROOT/.env"; do
    if [ -f "$file" ]; then
      local value
      value="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
      if [ -n "$value" ]; then
        printf '%s' "$value"
        return 0
      fi
    fi
  done
  return 1
}

# Starts the Metro bundler in the background if it is not already running.
ensure_metro() {
  local port="$1"
  shift

  if pid="$(read_pid "$METRO_COMPONENT")" && is_alive "$pid"; then
    info "Metro bundler already running (PID $pid) — reusing it"
    return 0
  fi

  if port_in_use "$port"; then
    local owner
    owner="$(pid_on_port "$port")"
    die "Port $port (Metro) is in use by PID ${owner:-unknown} but not tracked here. Run scripts/mobile-*-stop.sh --force first."
  fi

  info "Starting the Metro bundler on port ${port}…"
  start_background "$METRO_COMPONENT" "$MOBILE_DIR" "$@" -- npx expo start --port "$port"

  if wait_for_port "$port" 120; then
    report_started "Metro" "$METRO_COMPONENT" "http://localhost:$port"
    return 0
  fi
  report_failure "Metro bundler" "$METRO_COMPONENT" 25
  return 1
}

# Stops Metro. Returns 0 when something was stopped.
stop_metro() {
  local port="$1" stopped=0
  if stop_component "$METRO_COMPONENT"; then
    success "Metro bundler stopped"
    stopped=1
  fi
  if port_in_use "$port"; then
    local owner
    owner="$(pid_on_port "$port")"
    warn "Port $port (Metro) is still held by PID ${owner:-unknown} — terminating"
    terminate_pid "$owner" || true
    stopped=1
  fi
  return $((1 - stopped))
}

# Warns when the API is not running, because the app will show network errors.
warn_if_api_down() {
  local url="$1"
  if ! curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    warn "The API is not responding at $url — the app will show network errors."
    warn "Start it with: scripts/start.sh --api-only"
  fi
}
