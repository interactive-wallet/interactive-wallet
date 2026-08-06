#!/bin/bash
# Reset: wipes all agent wallets (Askar stores live INSIDE the containers), the VON ledger,
# and the RabbitMQ state (rabbitmq-data volume — stale queues/bindings otherwise survive a reset).
# Docker setup: agents store their Askar wallet in /root/.afj inside the container — there is no
# volume mount, so recreating the containers wipes the wallet. The old host-side `rm -rf ~/.afj`
# no longer applies.
#
# Rebuilds images as part of the reset (step 4) — do NOT run `docker compose build`/`up`
# yourself afterwards. Rebuilding/recreating an agent container after it already registered
# its schema/credDef on a fresh ledger wipes its local wallet (private key material) while
# the ledger keeps the write, causing "RevocStatusList registration failed" on next boot.
#
# Usage:
#   ./scripts/reset.sh            # full reset: all agents + ledger
#   ./scripts/reset.sh wallet     # only the holder wallet (keeps ledger, issuer, verifier)
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VON_URL="${VON_NETWORK_URL:-http://localhost:9000}"
SCOPE="${1:-full}"

if [ "$SCOPE" = "wallet" ]; then
  echo "=== Resetting holder wallet only ==="
  docker compose rm -sf wallet
  docker compose up -d wallet
  echo ""
  echo "=== Done ==="
  echo "The holder wallet is empty again. Re-run ./scripts/setup.sh for a fresh connection + credential."
  exit 0
fi

echo "=== 1. Stopping agents (wipes in-container Askar wallets + RabbitMQ state) ==="
docker compose down -v

echo ""
echo "=== 2. Restarting VON network (wipes ledger) ==="
cd "$ROOT/von-network"
./manage down
./manage start
cd "$ROOT"

echo ""
echo "=== 3. Waiting for VON to be ready ==="
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

# Stale host-side state files from the pre-Docker era (agents now keep state in-container).
rm -f "$ROOT/issuer-agent/issuer-state.json" "$ROOT/verifier-agent/verifier-state.json"

echo ""
echo "=== 4. Building images and starting fresh agents ==="
docker compose build
docker compose up -d

echo ""
echo "=== Reset complete ==="
echo "Issuer/Verifier register fresh DIDs on the new ledger. Next: ./scripts/setup.sh"
