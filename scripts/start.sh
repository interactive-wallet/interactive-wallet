#!/bin/bash
# Start: bringt alles hoch, was für die Demo gebraucht wird — VON-Network,
# alle Agents + docs-hub (docker compose), und zuletzt beide Flutter-Frontends
# (Holder gegen wallet-agent :3000, Verifier gegen verifier-agent :3004 —
# gleiches Binary, siehe WALLET_BASE in wallet_app/lib/data/api_client.dart).
# Voraussetzung: Ersteinrichtung aus der README wurde schon einmal gemacht
# (von-network gebaut, docker compose Images gebaut, `flutter pub get`).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VON_URL="${VON_NETWORK_URL:-http://localhost:9000}"

# All other scripts/*.sh assume the containers this script starts are already
# up, so checking host tooling here once covers them too — see README
# "Voraussetzungen".
echo "=== 0. Prüfe Voraussetzungen ==="
missing=()
command -v docker >/dev/null 2>&1 || missing+=("docker")
docker compose version >/dev/null 2>&1 || missing+=("docker compose (Plugin, nicht das alte docker-compose)")
command -v flutter >/dev/null 2>&1 || missing+=("flutter")
command -v python3 >/dev/null 2>&1 || missing+=("python3 (JSON-Parsing in scripts/*.sh)")
command -v curl >/dev/null 2>&1 || missing+=("curl")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "  FEHLER: Es fehlen Voraussetzungen — siehe README, Abschnitt \"Voraussetzungen\":"
  for m in "${missing[@]}"; do echo "    - $m"; done
  exit 1
fi
echo "  ✓ docker, docker compose, flutter, python3, curl vorhanden"

echo ""
echo "=== 1. Starte VON-Network ==="
cd "$ROOT/von-network" && ./manage start
cd "$ROOT"

echo ""
echo "=== 2. Warte auf VON-Network ==="
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
echo "=== 3. Starte Agents + docs-hub (docker compose) ==="
docker compose up -d

echo ""
echo "=== 4. Baue Flutter-App ==="
# Einmal bauen statt zweimal `flutter run` parallel zu starten: zwei gleichzeitige
# Builds schreiben in dasselbe build/linux/x64/debug und lassen CMake/Ninja
# ("failed recompaction") kollidieren.
cd "$ROOT/wallet_app"
flutter build linux --debug

BUNDLE="$ROOT/wallet_app/build/linux/x64/debug/bundle/wallet_app"

echo ""
echo "=== 5. Starte Flutter-Frontends (Holder + Verifier) ==="
WALLET_BASE=http://localhost:3004 "$BUNDLE" &
VERIFIER_PID=$!

WALLET_BASE=http://localhost:3000 "$BUNDLE" &
HOLDER_PID=$!

wait "$VERIFIER_PID" "$HOLDER_PID"
