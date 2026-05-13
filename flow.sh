#!/bin/bash
set -e

ISSUER_STATE="/home/ab/Uni/Master/SoSe26/InternetofServiceProject/interactive-wallet/issuer-agent/issuer-state.json"

echo "=== 0. Clearing old issuer state ==="
rm -f "$ISSUER_STATE"
echo "  Done"

echo ""
echo "=== 1. Setup issuer DID ==="
SETUP_RESPONSE=$(curl -s -X POST http://localhost:3002/setup)
echo "$SETUP_RESPONSE" | python3 -m json.tool
if echo "$SETUP_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(1 if 'error' in d else 0)"; then
  :
else
  echo ""
  echo "ERROR: Setup failed. Check issuer-agent logs. Aborting."
  exit 1
fi

echo ""
echo "=== 2. Connect wallet to issuer ==="
INVITATION_URL=$(curl -s http://localhost:3002/invitation | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")
curl -s -X POST http://localhost:3000/receive-invitation \
  -H "Content-Type: application/json" \
  -d "{\"invitationUrl\": \"$INVITATION_URL\"}" | python3 -m json.tool

echo ""
echo "=== 3. Waiting for connection to complete ==="
for i in $(seq 1 10); do
  STATE=$(curl -s http://localhost:3002/connections | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['state'] if d else 'none')" 2>/dev/null)
  echo "  Connection state: $STATE"
  if [ "$STATE" = "completed" ]; then
    break
  fi
  sleep 1
done

echo ""
echo "=== 4. Issue Führerschein ==="
CONNECTION_ID=$(curl -s http://localhost:3002/connections | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  Using connection: $CONNECTION_ID"
curl -s -X POST http://localhost:3002/issue \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"vorname\": \"Max\",
    \"nachname\": \"Mustermann\",
    \"geburtsdatum\": \"1990-01-15\",
    \"fuehrerscheinklasse\": \"B\",
    \"ausstellungsdatum\": \"2024-03-01\"
  }" | python3 -m json.tool

echo ""
echo "=== 5. Waiting for wallet to receive credential ==="
for i in $(seq 1 15); do
  COUNT=$(curl -s http://localhost:3000/credentials | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
  echo "  Credentials in wallet: $COUNT"
  if [ "$COUNT" != "0" ]; then
    break
  fi
  sleep 1
done

echo ""
echo "=== 6. Wallet credentials ==="
curl -s http://localhost:3000/credentials | python3 -m json.tool
