#!/usr/bin/env bash
#
# Boots an Android emulator (AVD) and runs the PeopleCore mobile app on it.
#
# By default a native development build is used (`expo run:android`), which is
# the only way to exercise the app fully (push notifications, secure storage).
# The first build compiles the native project and takes several minutes; later
# runs are fast. Pass --go to iterate quickly through Expo Go instead.
#
# Note: the Android emulator cannot reach the host as "localhost" — it uses
# 10.0.2.2 — so EXPO_PUBLIC_API_URL is pointed there automatically.
#
# Stop everything with scripts/mobile-android-stop.sh.

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

ANDROID_PACKAGE="com.peoplecore.mobile"
EXPO_GO_PACKAGE="host.exp.exponent"
# The emulator reaches the host machine through this alias, never localhost.
ANDROID_HOST_ALIAS="10.0.2.2"

AVD="${ANDROID_AVD:-}"
API_URL="${EXPO_PUBLIC_API_URL:-}"
GO_MODE=0
FRESH=0
NO_WINDOW=0

usage() {
  printf '%s\n' "Usage: scripts/mobile-android-start.sh [options]"
  printf '\n%s\n' "Boots an Android emulator and runs the PeopleCore mobile app on it."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --avd <name>          AVD to boot (default: \$ANDROID_AVD, else the first installed AVD)"
  printf '%s\n' "  --go                  Use Expo Go instead of a native development build"
  printf '%s\n' "                        (starts quickly, but push notifications are unavailable)"
  printf '%s\n' "  --api-url <url>       API the app talks to"
  printf '%s\n' "                        (default: http://$ANDROID_HOST_ALIAS:$API_PORT/api/v1)"
  printf '%s\n' "  --fresh               Delete apps/mobile/android and rebuild the native project"
  printf '%s\n' "  --headless            Boot the emulator without a window (no GPU)"
  printf '%s\n' "  -h, --help            Show this help"
  printf '\n%s\n' "Examples:"
  printf '%s\n' "  scripts/mobile-android-start.sh"
  printf '%s\n' "  scripts/mobile-android-start.sh --avd Pixel_10"
  printf '%s\n' "  scripts/mobile-android-start.sh --go       # quick iteration in Expo Go"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --avd)
    [ "$#" -ge 2 ] || die "--avd needs an AVD name"
    AVD="$2"
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
  --headless)
    NO_WINDOW=1
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
require_cmd node
require_cmd npx
require_cmd curl

ADB="$(android_tool adb)" || die "adb not found. Install the Android SDK platform-tools, or set ANDROID_HOME."
EMULATOR="$(android_tool emulator)" || die "emulator not found. Install the Android SDK emulator, or set ANDROID_HOME."
require_cmd java "install a JDK 17+ (e.g. brew install --cask temurin)"

if [ ! -d "$MOBILE_DIR" ]; then
  die "Mobile app not found at $MOBILE_DIR"
fi

# ─── Emulator discovery ──────────────────────────────────────────────────────
# Prints the installed AVDs (empty output when there are none).
available_avds() { "$EMULATOR" -list-avds 2>/dev/null | grep -v '^$' || true; }

if [ -z "$AVD" ]; then
  AVD="$(available_avds | head -1)"
  if [ -z "$AVD" ]; then
    error "No Android Virtual Device (AVD) is installed."
    printf '\n%s\n' "Create one with Android Studio (Device Manager), or from the command line:" >&2
    printf '%s\n' "  sdkmanager 'system-images;android-36;google_apis;arm64-v8a'" >&2
    printf '%s\n' "  avdmanager create avd -n Pixel_10 -k 'system-images;android-36;google_apis;arm64-v8a'" >&2
    exit 1
  fi
  info "Using AVD '$AVD' (set \$ANDROID_AVD or pass --avd to choose another)"
elif ! available_avds | grep -Fxq "$AVD"; then
  error "AVD '$AVD' does not exist."
  printf '\n%s\n' "Installed AVDs:" >&2
  available_avds | sed 's/^/  /' >&2
  exit 1
fi

# Serial of a running emulator, if any (e.g. emulator-5554).
running_emulator() {
  "$ADB" devices 2>/dev/null | grep -E '^emulator-[0-9]+[[:space:]]+device$' | head -1 | cut -f1 || true
}

wait_for_boot_completed() {
  local serial="$1" timeout="${2:-300}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if [ "$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

# Waits until a package is installed (proves build + install ran).
wait_for_package() {
  local serial="$1" package="$2" timeout="${3:-900}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if "$ADB" -s "$serial" shell pm list packages 2>/dev/null | tr -d '\r' | grep -Fq "package:$package"; then
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

# ─── Boot the emulator ───────────────────────────────────────────────────────
banner "Android emulator: $AVD"

SERIAL="$(running_emulator)"
if [ -n "$SERIAL" ]; then
  info "An emulator is already running ($SERIAL) — reusing it"
else
  info "Booting the AVD (this takes a minute the first time)…"
  EMULATOR_ARGS="-avd $AVD -no-snapshot-save -no-boot-anim"
  if [ "$NO_WINDOW" -eq 1 ]; then
    EMULATOR_ARGS="$EMULATOR_ARGS -no-window -gpu swiftshader_indirect"
  fi
  # shellcheck disable=SC2086
  start_background "emulator" "$HOME" -- "$EMULATOR" $EMULATOR_ARGS

  info "Waiting for the device to appear…"
  if ! "$ADB" wait-for-device >/dev/null 2>&1; then
    report_failure "Android emulator" "emulator" 30
    die "The emulator did not start. Check that hardware acceleration is available."
  fi

  SERIAL="$(running_emulator)"
  if [ -z "$SERIAL" ]; then
    report_failure "Android emulator" "emulator" 30
    die "The emulator did not register with adb."
  fi
  success "Emulator is up ($SERIAL)"
fi

info "Waiting for Android to finish booting…"
if wait_for_boot_completed "$SERIAL" 300; then
  success "Android booted"
else
  warn "Android did not report boot completion in time; continuing anyway"
fi

# ─── API reachability ────────────────────────────────────────────────────────
API_BASE="${API_URL:-$(mobile_env_value EXPO_PUBLIC_API_URL || true)}"
API_BASE="${API_BASE:-http://$ANDROID_HOST_ALIAS:$API_PORT/api/v1}"
# The emulator maps the host to 10.0.2.2, so probe the host directly here.
warn_if_api_down "http://localhost:$API_PORT/health"

# ─── Optional clean rebuild ──────────────────────────────────────────────────
if [ "$FRESH" -eq 1 ] && [ -d "$MOBILE_DIR/android" ]; then
  info "Removing apps/mobile/android to force a clean native build…"
  rm -rf "$MOBILE_DIR/android"
fi

# ─── Build and launch ────────────────────────────────────────────────────────
banner "Launching the app"
debug_note "the emulator reaches the API at $API_BASE"

if [ "$GO_MODE" -eq 1 ]; then
  # `expo start --android` owns the bundler: it installs Expo Go when missing
  # and opens the project, so Metro is not started separately here.
  if pid="$(read_pid "$METRO_COMPONENT")" && is_alive "$pid"; then
    if wait_for_package "$SERIAL" "$EXPO_GO_PACKAGE" 10; then
      info "Reusing the running Metro bundler (PID $pid)"
      "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW \
        -d "exp://$ANDROID_HOST_ALIAS:$METRO_PORT" >/dev/null 2>&1 ||
        warn "Could not open the deep link — open Expo Go on the emulator and pick the project."
      success "Expo Go launched"
    else
      die "A Metro bundler is already running but Expo Go is not installed on this emulator. Run scripts/mobile-android-stop.sh, then retry — expo will install Expo Go for you."
    fi
  else
    info "Mode: Expo Go (fast). Push notifications are unavailable in Expo Go."
    start_background "android" "$MOBILE_DIR" "EXPO_PUBLIC_API_URL=$API_BASE" -- npx expo start --android --port "$METRO_PORT"
    info "Waiting for Metro on port ${METRO_PORT} (expo installs Expo Go on the first run)…"
    if wait_for_port "$METRO_PORT" 300; then
      report_started "Android app (Expo Go)" "android" "emulator: $AVD ($SERIAL)"
    else
      report_failure "Expo Go" "android" 30
      die "Expo Go did not start. Run without --go to use a native development build instead."
    fi
  fi
else
  ensure_metro "$METRO_PORT" "EXPO_PUBLIC_API_URL=$API_BASE" || die "Could not start the Metro bundler."

  info "Mode: native development build — the first build takes several minutes."
  start_background "android" "$MOBILE_DIR" "EXPO_PUBLIC_API_URL=$API_BASE" -- npx expo run:android --device "$AVD" --no-bundler
  info "Waiting for the build to install the app (up to 15 minutes)…"
  if wait_for_package "$SERIAL" "$ANDROID_PACKAGE" 900; then
    success "App installed on the emulator"
  else
    report_failure "Android build" "android" 40
    die "The build did not finish. Fix the error above and run scripts/mobile-android-start.sh again."
  fi
fi

banner "Android app is running"
debug_note "emulator → $AVD ($SERIAL)"
debug_note "api      → $API_BASE"
debug_note "log      → $(log_path "android")"
debug_note "stop     → scripts/mobile-android-stop.sh"
printf '\n'
