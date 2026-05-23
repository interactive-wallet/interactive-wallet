#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VON_URL="${VON_NETWORK_URL:-http://localhost:9000}"

echo "=== 1. Restarting VON network (wipes ledger) ==="
cd "$ROOT/von-network"
./manage down
./manage start

echo ""
echo "=== 2. Waiting for VON to be ready ==="
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
echo "=== 3. Refreshing genesis.txn ==="
curl -s "$VON_URL/genesis" -o "$ROOT/wallet-agent/genesis.txn"
echo "  Wrote $ROOT/wallet-agent/genesis.txn"

echo ""
echo "=== 4. Deleting wallet stores ==="
rm -rf "$HOME/.afj/data/wallet/Issuer"
rm -rf "$HOME/.afj/data/wallet/Wallet"
rm -rf "$HOME/.afj/data/wallet/Verifier"
rm -rf "$HOME/.afj/data/wallet/Mediator"
echo "  Done"

echo ""
echo "=== 5. Deleting agent state files ==="
rm -f "$ROOT/issuer-agent/issuer-state.json"
rm -f "$ROOT/verifier-agent/verifier-state.json"
echo "  Done"

echo ""
echo "=== Reset complete ==="
echo "Next: restart all agents (mediator, issuer, verifier, wallet), then run ./scripts/setup.sh"
