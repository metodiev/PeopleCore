#!/usr/bin/env bash
#
# Stops the Android app session started by scripts/mobile-android-start.sh:
# the build process, the Metro bundler, and (by default) the emulator.

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

AVD="${ANDROID_AVD:-}"
KEEP_EMULATOR=0
KEEP_METRO=0
FORCE=0
QUIET=0

usage() {
  printf '%s\n' "Usage: scripts/mobile-android-stop.sh [options]"
  printf '\n%s\n' "Stops the Android app session (build process, Metro bundler, emulator)."
  printf '\n%s\n' "Options:"
  printf '%s\n' "  --avd <name>        AVD whose emulator should be shut down (informational)"
  printf '%s\n' "  --keep-emulator     Leave the emulator running"
  printf '%s\n' "  --keep-metro        Leave the Metro bundler running (shared with iOS)"
  printf '%s\n' "  --force             Also kill whatever holds port $METRO_PORT"
  printf '%s\n' "  --quiet             Only report problems"
  printf '%s\n' "  -h, --help          Show this help"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --avd)
    [ "$#" -ge 2 ] || die "--avd needs an AVD name"
    AVD="$2"
    shift
    ;;
  --keep-emulator)
    KEEP_EMULATOR=1
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

ADB="$(android_tool adb)" || die "adb not found. Install the Android SDK platform-tools, or set ANDROID_HOME."

# ─── Build process ───────────────────────────────────────────────────────────
# `expo run:android` (and Expo Go's `expo start`) are tracked as .run/android.pid.
if stop_component "android"; then
  announce "Android build/launch process stopped"
fi

# ─── Metro bundler ───────────────────────────────────────────────────────────
if [ "$KEEP_METRO" -eq 1 ]; then
  say "Leaving the Metro bundler running (--keep-metro)"
else
  if stop_metro "$METRO_PORT"; then :; fi
fi

# ─── Emulator ────────────────────────────────────────────────────────────────
# Serials of all running emulators (empty when none).
running_emulators() {
  "$ADB" devices 2>/dev/null | grep -E '^emulator-[0-9]+[[:space:]]' | cut -f1 || true
}

# Name of the AVD backing a running emulator (used by --avd).
avd_name_of() {
  "$ADB" -s "$1" emu avd name 2>/dev/null | head -1 | tr -d '\r' || true
}

stop_emulators() {
  local serial name found=0
  for serial in $(running_emulators); do
    name="$(avd_name_of "$serial")"
    if [ -n "$AVD" ] && [ "$name" != "$AVD" ]; then
      continue
    fi
    found=1
    say "Shutting down emulator $serial (${name:-unknown AVD})…"
    if "$ADB" -s "$serial" emu kill >/dev/null 2>&1; then
      announce "Emulator $serial shut down"
    else
      warn "Could not shut down emulator $serial — re-run with --force"
    fi
  done
  if [ "$found" -eq 0 ]; then
    if [ -n "$AVD" ]; then
      say "No running emulator matched AVD '$AVD'"
    else
      say "No Android emulator is running"
    fi
  fi
}

if [ "$KEEP_EMULATOR" -eq 1 ]; then
  say "Leaving the emulator running (--keep-emulator)"
else
  stop_emulators
fi

# ─── Leftovers ───────────────────────────────────────────────────────────────
# The emulator process is tracked in .run/emulator.pid when this repo booted it.
if stop_component "emulator"; then
  announce "Emulator process stopped"
fi

if [ "$FORCE" -eq 1 ] && port_in_use "$METRO_PORT"; then
  OWNER="$(pid_on_port "$METRO_PORT")"
  warn "Port $METRO_PORT is still held by PID ${OWNER:-unknown} — terminating"
  terminate_pid "$OWNER" || warn "Could not terminate PID ${OWNER:-unknown}"
fi

if [ "$KEEP_METRO" -eq 0 ] && port_in_use "$METRO_PORT"; then
  warn "Port $METRO_PORT is still in use — re-run with --force"
fi

printf '\n'
if [ "$KEEP_EMULATOR" -eq 0 ]; then
  announce "Android session stopped"
else
  announce "Android session stopped (emulator kept running)"
fi
printf '\n'
