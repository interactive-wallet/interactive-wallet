#!/bin/bash
set -e

echo "=== 1. Connect wallet to verifier ==="
INVITATION_URL=$(curl -s http://localhost:3004/invitation | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")
curl -s -X POST http://localhost:3000/receive-invitation \
  -H "Content-Type: application/json" \
  -d "{\"invitationUrl\": \"$INVITATION_URL\"}" | python3 -m json.tool

echo ""
echo "=== 2. Waiting for connection ==="
for i in $(seq 1 10); do
  STATE=$(curl -s http://localhost:3004/connections | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['state'] if d else 'none')" 2>/dev/null)
  echo "  Connection state: $STATE"
  if [ "$STATE" = "completed" ]; then break; fi
  sleep 1
done

echo ""
echo "=== 3. Request proof ==="
CONNECTION_ID=$(curl -s http://localhost:3004/connections | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  Using connection: $CONNECTION_ID"
PROOF_RESPONSE=$(curl -s -X POST http://localhost:3004/request-proof \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONNECTION_ID\"}")
echo "$PROOF_RESPONSE" | python3 -m json.tool
PROOF_ID=$(echo "$PROOF_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['proofExchangeId'])")

echo ""
echo "=== 4. Waiting for proof ==="
for i in $(seq 1 15); do
  RESULT=$(curl -s http://localhost:3004/proofs/$PROOF_ID)
  STATE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])" 2>/dev/null)
  echo "  Proof state: $STATE"
  if [ "$STATE" = "done" ]; then
    echo ""
    echo "=== 5. Result ==="
    echo "$RESULT" | python3 -m json.tool
    break
  fi
  sleep 1
done
