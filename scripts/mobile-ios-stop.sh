#!/usr/bin/env bash
#
# Stops the iOS Simulator app session started by scripts/mobile-ios-start.sh:
# the app build process, the Metro bundler, and (by default) the simulator.
#
# The JavaScript bundle itself needs no shutdown; it lives inside the simulator.

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

DEVICE="${IOS_SIMULATOR:-}"
KEEP_SIMULATOR=0
KEEP_METRO=0
FORCE=0
QUIET=0

usage() {
  printf '%s\n' "Usage: scripts/mobile-ios-stop.sh [options]"
  printf '\n%s\n' "Stops the iOS app session (build process, Metro bundler, simulator)."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --device <name|udid>  Simulator to shut down (default: \$IOS_SIMULATOR, else any booted iPhone)"
  printf '%s\n' "  --keep-simulator      Leave the simulator running"
  printf '%s\n' "  --keep-metro          Leave the Metro bundler running (shared with Android)"
  printf '%s\n' "  --force               Also quit the Simulator app, and kill whatever holds port $METRO_PORT"
  printf '%s\n' "  --quiet               Only report problems"
  printf '%s\n' "  -h, --help            Show this help"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --device)
    [ "$#" -ge 2 ] || die "--device needs a simulator name or UDID"
    DEVICE="$2"
    shift
    ;;
  --keep-simulator)
    KEEP_SIMULATOR=1
    ;;
  --keep-metro)
    KEEP_METRO=1
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
announce() { if [ "$QUIET" -eq 0 ]; then success "$*"; fi; }

require_cmd xcrun "install Xcode from the App Store"

# ─── Build process ───────────────────────────────────────────────────────────
# `expo run:ios` (and Expo Go's `expo start`) are tracked as .run/ios.pid.
if stop_component "ios"; then
  announce "iOS build/launch process stopped"
fi

# ─── Metro bundler ───────────────────────────────────────────────────────────
if [ "$KEEP_METRO" -eq 1 ]; then
  say "Leaving the Metro bundler running (--keep-metro)"
else
  if stop_metro "$METRO_PORT"; then :; fi
fi

# ─── Simulator ───────────────────────────────────────────────────────────────
# Finds a booted simulator matching the requested device, else any booted iPhone.
find_booted_device() {
  local wanted="$1" udid
  if [ -n "$wanted" ]; then
    case "$wanted" in
    *-*-*-*-*) printf '%s' "$wanted"; return 0 ;;
    esac
    udid="$(xcrun simctl list devices | grep -F "$wanted (" | grep "Booted" | head -1 |
      sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
    if [ -z "$udid" ]; then
      udid="$(xcrun simctl list devices available | grep -F "$wanted (" | head -1 |
        sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
    fi
    [ -n "$udid" ] || return 1
    printf '%s' "$udid"
    return 0
  fi

  udid="$(xcrun simctl list devices | grep "Booted" | grep -E 'iPhone|iPad' | head -1 |
    sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
  [ -n "$udid" ] || return 1
  printf '%s' "$udid"
}

if [ "$KEEP_SIMULATOR" -eq 1 ]; then
  say "Leaving the simulator running (--keep-simulator)"
else
  if UDID="$(find_booted_device "$DEVICE")"; then
    say "Shutting down the simulator ${UDID}…"
    if xcrun simctl shutdown "$UDID" >/dev/null 2>&1; then
      announce "Simulator shut down"
    else
      warn "Could not shut down simulator $UDID"
    fi
  else
    say "No booted simulator found"
  fi
fi

if [ "$FORCE" -eq 1 ]; then
  if osascript -e 'quit app "Simulator"' >/dev/null 2>&1; then
    announce "Simulator app closed"
  fi
  if port_in_use "$METRO_PORT"; then
    OWNER="$(pid_on_port "$METRO_PORT")"
    warn "Port $METRO_PORT is still held by PID ${OWNER:-unknown} — terminating"
    terminate_pid "$OWNER" || warn "Could not terminate PID ${OWNER:-unknown}"
  fi
fi

if port_in_use "$METRO_PORT" && [ "$KEEP_METRO" -eq 0 ]; then
  warn "Port $METRO_PORT is still in use — re-run with --force"
fi

printf '\n'
announce "iOS session stopped"
printf '\n'
