#!/usr/bin/env bash
#
# Restarts the PeopleCore web system: stops it, then starts it again.
#
# All options are passed through to scripts/start.sh, so:
#   scripts/restart.sh --seed          restarts and re-seeds demo data
#   scripts/restart.sh --docker        restarts the Compose stack
#   scripts/restart.sh --api-only      restarts just the API
#
# --docker is automatically forwarded to scripts/stop.sh as well.

set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

usage() {
  printf '%s\n' "Usage: scripts/restart.sh [start options]"
  printf '\n%s\n' "Stops the system, then starts it again with the same options as scripts/start.sh."
  printf '\n%s\n' "Options (passed to scripts/start.sh):"
  printf '%s\n' "  --api-only    Restart only the API"
  printf '%s\n' "  --web-only    Restart only the web UI"
  printf '%s\n' "  --docker      Restart the Docker Compose stack"
  printf '%s\n' "  --seed        Seed demo data on the way up (local mode)"
  printf '%s\n' "  --reset       Delete the local embedded database on the way up (local mode)"
  printf '%s\n' "  --no-install  Do not install dependencies when node_modules is missing"
  printf '%s\n' "  --open        Open the web UI in the browser when ready"
  printf '%s\n' "  -h, --help    Show this help"
}

for arg in "$@"; do
  case "$arg" in
  -h | --help)
    usage
    exit 0
    ;;
  esac
done

STOP_ARGS=""
for arg in "$@"; do
  if [ "$arg" = "--docker" ]; then
    STOP_ARGS="--docker"
    break
  fi
done

banner "Restarting PeopleCore"
info "Stopping…"
# shellcheck disable=SC2086
"$SCRIPTS_DIR/stop.sh" $STOP_ARGS

# Give the OS a moment to release the listening sockets.
sleep 1

info "Starting…"
"$SCRIPTS_DIR/start.sh" "$@"
