#!/bin/bash
# Start: brings up everything needed for the demo — VON network, all agents +
# docs-hub (docker compose), and finally both Flutter frontends (holder against
# wallet-agent :3000, verifier against verifier-agent :3004 — same binary, see
# WALLET_BASE in wallet_app/lib/data/api_client.dart).
# Works on Linux and macOS (detected via `uname`); only the Flutter build target
# and the resulting bundle path differ between the two.
# Prerequisite: initial setup from the README has already been done (von-network
# built, docker compose images built, `flutter pub get`).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VON_URL="${VON_NETWORK_URL:-http://localhost:9000}"
OS="$(uname -s)"

# Ctrl-C (or a TERM signal) tears everything this script started back down again,
# not just the two Flutter windows — docker compose and the VON network otherwise
# keep running detached in the background. Guards each step with `|| true` so one
# failing step (e.g. nothing to stop yet) doesn't abort the rest of the cleanup.
# Uses `./manage stop` / `docker compose down` (not `down -v` / `rm`), so volumes
# (ledger state, RabbitMQ data) survive — matches what `./manage start` expects to
# find next time. Full wipe is `scripts/reset.sh`, not this.
cleanup() {
  echo ""
  echo "=== Shutting down ==="
  if [ -n "${VERIFIER_PID:-}" ] || [ -n "${HOLDER_PID:-}" ]; then
    echo "Stopping Flutter frontends..."
    [ -n "${VERIFIER_PID:-}" ] && kill "$VERIFIER_PID" 2>/dev/null
    [ -n "${HOLDER_PID:-}" ] && kill "$HOLDER_PID" 2>/dev/null
    wait 2>/dev/null || true
  fi
  echo "Stopping agents + docs-hub (docker compose)..."
  (cd "$ROOT" && docker compose down) || true
  echo "Stopping VON network..."
  (cd "$ROOT/von-network" && ./manage stop) || true
  echo "Done."
  exit 0
}
trap cleanup INT TERM

# All other scripts/*.sh assume the containers this script starts are already
# up, so checking host tooling here once covers them too — see README
# "Voraussetzungen".
echo "=== 0. Checking prerequisites ==="
missing=()
command -v docker >/dev/null 2>&1 || missing+=("docker")
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  missing+=("Docker is installed but not running — start Docker Desktop / the Docker daemon")
fi
docker compose version >/dev/null 2>&1 || missing+=("docker compose (the plugin, not the old docker-compose)")
command -v flutter >/dev/null 2>&1 || missing+=("flutter")
command -v python3 >/dev/null 2>&1 || missing+=("python3 (used for JSON parsing in scripts/*.sh)")
command -v curl >/dev/null 2>&1 || missing+=("curl")
if [ "$OS" = "Darwin" ]; then
  # `xcodebuild` also exists with just the Command Line Tools installed, but that's
  # not enough for `flutter build macos` — it needs the full Xcode app. xcode-select -p
  # points at .../CommandLineTools instead of .../Xcode.app/... in that case.
  if ! command -v xcodebuild >/dev/null 2>&1; then
    missing+=("Xcode (App Store), required for 'flutter build macos'")
  elif [[ "$(xcode-select -p 2>/dev/null)" != *"Xcode.app"* ]]; then
    missing+=("the full Xcode app (App Store) — only Command Line Tools found, which is not enough for 'flutter build macos'")
  elif ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
    missing+=("Xcode license not accepted — open Xcode.app once, or run 'sudo xcodebuild -license accept'")
  fi
fi
if [ "${#missing[@]}" -gt 0 ]; then
  echo "  ERROR: missing prerequisites — see README, section \"Voraussetzungen\":"
  for m in "${missing[@]}"; do echo "    - $m"; done
  exit 1
fi
echo "  ✓ docker, docker compose, flutter, python3, curl present"

echo ""
echo "=== 1. Starting VON network ==="
cd "$ROOT/von-network" && ./manage start
cd "$ROOT"

echo ""
echo "=== 2. Waiting for VON network ==="
for i in $(seq 1 60); do
  if curl -sf "$VON_URL/genesis" -o /dev/null 2>&1; then
    echo "  VON ready after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" = "60" ]; then
    echo "  ERROR: VON did not come up within 60s"
    exit 1
  fi
done

echo ""
echo "=== 3. Starting agents + docs-hub (docker compose) ==="
docker compose up -d

echo ""
echo "=== 4. Building Flutter app ==="
# Build once instead of running `flutter run` twice in parallel: two simultaneous
# builds write into the same build/<platform>/.../debug output and make the
# native build tooling (CMake/Ninja on Linux, xcodebuild on macOS) collide.
cd "$ROOT/wallet_app"
case "$OS" in
  Darwin)
    flutter build macos --debug
    BUNDLE="$ROOT/wallet_app/build/macos/Build/Products/Debug/wallet_app.app/Contents/MacOS/wallet_app"
    ;;
  Linux)
    flutter build linux --debug
    BUNDLE="$ROOT/wallet_app/build/linux/x64/debug/bundle/wallet_app"
    ;;
  *)
    echo "  ERROR: unsupported OS $OS — only Linux and macOS are supported."
    exit 1
    ;;
esac

echo ""
echo "=== 5. Starting Flutter frontends (holder + verifier) ==="
if [ "$OS" = "Darwin" ]; then
  # macOS treats two launches of the same signed bundle (same CFBundleIdentifier) as
  # "activate the existing instance" instead of starting a second, independent
  # process, so only one window ever shows up, keeping whichever WALLET_BASE it
  # started with. Fix: make two re-signed copies with distinct bundle IDs so macOS
  # treats them as different apps. Re-signing must re-apply our entitlements
  # (DebugProfile.entitlements), since editing Info.plist after the original build
  # invalidates that build's signature.
  INSTANCES="$ROOT/wallet_app/build/macos/instances"
  ENTITLEMENTS="$ROOT/wallet_app/macos/Runner/DebugProfile.entitlements"
  rm -rf "$INSTANCES"
  mkdir -p "$INSTANCES"

  cp -R "$ROOT/wallet_app/build/macos/Build/Products/Debug/wallet_app.app" "$INSTANCES/holder.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.example.walletApp.holder" "$INSTANCES/holder.app/Contents/Info.plist"
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$INSTANCES/holder.app"

  cp -R "$ROOT/wallet_app/build/macos/Build/Products/Debug/wallet_app.app" "$INSTANCES/verifier.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.example.walletApp.verifier" "$INSTANCES/verifier.app/Contents/Info.plist"
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$INSTANCES/verifier.app"

  WALLET_BASE=http://localhost:3004 "$INSTANCES/verifier.app/Contents/MacOS/wallet_app" &
  VERIFIER_PID=$!

  WALLET_BASE=http://localhost:3000 "$INSTANCES/holder.app/Contents/MacOS/wallet_app" &
  HOLDER_PID=$!
else
  WALLET_BASE=http://localhost:3004 "$BUNDLE" &
  VERIFIER_PID=$!

  WALLET_BASE=http://localhost:3000 "$BUNDLE" &
  HOLDER_PID=$!
fi

wait "$VERIFIER_PID" "$HOLDER_PID"
