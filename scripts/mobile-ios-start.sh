#!/usr/bin/env bash
#
# Boots an iOS Simulator and runs the PeopleCore mobile app on it.
#
# By default a native development build is used (`expo run:ios`), because the
# app relies on expo-notifications, which no longer works inside Expo Go. The
# first build compiles native code and takes several minutes; later runs are
# fast. Pass --go to iterate quickly through Expo Go instead.
#
# Stop everything with scripts/mobile-ios-stop.sh.

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

IOS_BUNDLE_ID="com.peoplecore.mobile"
EXPO_GO_BUNDLE_ID="host.exp.Exponent"

DEVICE="${IOS_SIMULATOR:-}"
API_URL="${EXPO_PUBLIC_API_URL:-}"
GO_MODE=0
FRESH=0

usage() {
  printf '%s\n' "Usage: scripts/mobile-ios-start.sh [options]"
  printf '\n%s\n' "Boots an iOS Simulator and runs the PeopleCore mobile app on it."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --device <name|udid>  Simulator to use (default: \$IOS_SIMULATOR, else the first iPhone)"
  printf '%s\n' "  --go                  Use Expo Go instead of a native development build"
  printf '%s\n' "                        (starts quickly, but push notifications are unavailable)"
  printf '%s\n' "  --api-url <url>       API the app talks to (default: http://localhost:4000/api/v1)"
  printf '%s\n' "  --fresh               Delete apps/mobile/ios and rebuild the native project"
  printf '%s\n' "  -h, --help            Show this help"
  printf '\n%s\n' "Examples:"
  printf '%s\n' "  scripts/mobile-ios-start.sh"
  printf '%s\n' "  scripts/mobile-ios-start.sh --device 'iPhone 17 Pro'"
  printf '%s\n' "  scripts/mobile-ios-start.sh --go          # quick iteration in Expo Go"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --device)
    [ "$#" -ge 2 ] || die "--device needs a simulator name or UDID"
    DEVICE="$2"
    shift
    ;;
  --api-url)
    [ "$#" -ge 2 ] || die "--api-url needs a value"
    API_URL="$2"
    shift
    ;;
  --go)
    GO_MODE=1
    ;;
  --fresh)
    FRESH=1
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

# ─── Requirements ────────────────────────────────────────────────────────────
require_cmd xcrun "install Xcode from the App Store"
require_cmd node
require_cmd npx
require_cmd curl

if ! xcode-select -p >/dev/null 2>&1; then
  die "Xcode command line tools are not configured. Run: xcode-select --install"
fi

if [ ! -d "$MOBILE_DIR" ]; then
  die "Mobile app not found at $MOBILE_DIR"
fi

if [ "$GO_MODE" -eq 0 ] && ! command -v pod >/dev/null 2>&1; then
  die "CocoaPods (pod) is required for a native build. Install it with 'brew install cocoapods', or run with --go."
fi

# ─── Simulator discovery ─────────────────────────────────────────────────────
# Prints the UDID of the requested device, or of the first available iPhone.
find_device_udid() {
  local wanted="$1" match udid

  if [ -n "$wanted" ]; then
    case "$wanted" in
    *-*-*-*-*) printf '%s' "$wanted"; return 0 ;;
    esac
    match="$(xcrun simctl list devices available |
      grep -F "$wanted (" |
      head -1 |
      sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
    [ -n "$match" ] || return 1
    printf '%s' "$match"
    return 0
  fi

  udid="$(xcrun simctl list devices available |
    grep -E '^[[:space:]]+iPhone .*\([0-9A-Fa-f-]{36}\)' |
    head -1 |
    sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
  if [ -z "$udid" ]; then
    udid="$(xcrun simctl list devices available |
      grep -E '\([0-9A-Fa-f-]{36}\)' |
      head -1 |
      sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"
  fi
  [ -n "$udid" ] || return 1
  printf '%s' "$udid"
}

# Human-readable name of a simulator UDID (empty when unknown).
device_name() {
  xcrun simctl list devices | grep "$1" | sed -E 's/^ *(.*) \([0-9A-Fa-f-]{36}\).*/\1/' || true
}

# Waits until an app is installed on the simulator (proves build + install ran).
wait_for_sim_app() {
  local udid="$1" bundle_id="$2" timeout="${3:-900}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if xcrun simctl get_app_container "$udid" "$bundle_id" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

if ! UDID="$(find_device_udid "$DEVICE")"; then
  error "No iOS Simulator matched '${DEVICE:-<any iPhone>}'."
  printf '\n%s\n' "Available simulators:" >&2
  xcrun simctl list devices available | grep -E "\([0-9A-Fa-f-]{36}\)" | sed 's/^/  /' >&2
  exit 1
fi
NAME="$(device_name "$UDID")"

# ─── Boot the simulator ──────────────────────────────────────────────────────
banner "iOS Simulator: ${NAME:-$UDID}"

if xcrun simctl list devices | grep "$UDID" | grep -q "Booted"; then
  info "Simulator is already booted"
else
  info "Booting the simulator…"
  xcrun simctl boot "$UDID" 2>/dev/null || true
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || warn "bootstatus reported a problem — continuing"
  success "Simulator booted"
fi

open -a Simulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null || open -a Simulator 2>/dev/null || true

# ─── API reachability ────────────────────────────────────────────────────────
API_BASE="${API_URL:-$(mobile_env_value EXPO_PUBLIC_API_URL || true)}"
API_BASE="${API_BASE:-http://localhost:4000/api/v1}"
warn_if_api_down "${API_BASE%%/api/v1*}/health"

# ─── Optional clean rebuild ──────────────────────────────────────────────────
if [ "$FRESH" -eq 1 ] && [ -d "$MOBILE_DIR/ios" ]; then
  info "Removing apps/mobile/ios to force a clean native build…"
  rm -rf "$MOBILE_DIR/ios"
fi

# ─── Build and launch ────────────────────────────────────────────────────────
banner "Launching the app"

if [ "$GO_MODE" -eq 1 ]; then
  # `expo start --ios` owns the bundler: it installs Expo Go when missing and
  # opens the project, so Metro is not started separately here.
  if pid="$(read_pid "$METRO_COMPONENT")" && is_alive "$pid"; then
    if wait_for_sim_app "$UDID" "$EXPO_GO_BUNDLE_ID" 10; then
      info "Reusing the running Metro bundler (PID $pid)"
      xcrun simctl openurl "$UDID" "exp://127.0.0.1:$METRO_PORT" >/dev/null 2>&1 ||
        warn "Could not open the deep link — open Expo Go on the simulator and pick the project."
      success "Expo Go launched"
    else
      die "A Metro bundler is already running but Expo Go is not installed on this simulator. Run scripts/mobile-ios-stop.sh, then retry — expo will install Expo Go for you."
    fi
  else
    info "Mode: Expo Go (fast). Push notifications are unavailable in Expo Go."
    start_background "ios" "$MOBILE_DIR" "EXPO_PUBLIC_API_URL=$API_BASE" -- npx expo start --ios --port "$METRO_PORT"
    info "Waiting for Metro on port ${METRO_PORT} (expo installs Expo Go on the first run)…"
    if wait_for_port "$METRO_PORT" 300; then
      report_started "iOS app (Expo Go)" "ios" "simulator: ${NAME:-$UDID}"
    else
      report_failure "Expo Go" "ios" 30
      die "Expo Go did not start. Run without --go to use a native development build instead."
    fi
  fi
else
  # The bundle is served from the host; the simulator reaches it via localhost.
  ensure_metro "$METRO_PORT" "EXPO_PUBLIC_API_URL=$API_BASE" || die "Could not start the Metro bundler."

  info "Mode: native development build — the first build takes several minutes."
  start_background "ios" "$MOBILE_DIR" "EXPO_PUBLIC_API_URL=$API_BASE" -- npx expo run:ios --device "$UDID" --no-bundler
  info "Waiting for the build to install the app (up to 15 minutes)…"
  if wait_for_sim_app "$UDID" "$IOS_BUNDLE_ID" 900; then
    success "App installed on the simulator"
  else
    report_failure "iOS build" "ios" 40
    die "The build did not finish. Fix the error above and run scripts/mobile-ios-start.sh again."
  fi
fi

banner "iOS app is running"
debug_note "simulator → ${NAME:-$UDID}"
debug_note "api       → $API_BASE"
debug_note "log       → $(log_path "ios")"
debug_note "stop      → scripts/mobile-ios-stop.sh"
printf '\n'
