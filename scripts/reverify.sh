#!/bin/bash
# New proof request on an existing verifier connection (no OOB handshake)
#
# Optional parameters: attributes to request
#   ./reverify.sh                          # all attributes
#   ./reverify.sh fuehrerscheinklasse      # class only
#   ./reverify.sh vorname nachname         # name only
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

VERIFIER="http://localhost:3004"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Re-Verify     │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Find the most recent completed verifier connection ────────────────
CONN=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
done = sorted([c for c in d if c.get('state') == 'completed'], key=lambda x: x['createdAt'], reverse=True)
print(done[0]['id'] if done else '')
" 2>/dev/null || echo "")

if [ -z "$CONN" ]; then
  echo -e "  ${RED}✗ No completed verifier connection found.${NC}"
  echo -e "  ${YLW}Tip:${NC} run ${BLD}bash scripts/verify.sh${NC} first, then reverify."
  exit 1
fi

echo -e "${CYN}Using connection:${NC} $CONN"
echo ""

# ── 2. Build the proof request ────────────────────────────────────────────
if [ $# -eq 0 ]; then
  ATTRS='["vorname","nachname","geburtsdatum","fuehrerscheinklasse","ausstellungsdatum"]'
  echo -e "${CYN}Requested attributes:${NC} all"
else
  ATTRS=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1:]))" "$@")
  echo -e "${CYN}Requested attributes:${NC} $*"
fi
echo ""

# ── 3. Send the request ───────────────────────────────────────────────────
echo -e "${CYN}Sending proof request…${NC}"
RESP=$(curl -sf -X POST "$VERIFIER/request-proof" \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONN\", \"requestedAttributes\": $ATTRS}")

PROOF_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('proofExchangeId',''))")
echo -e "  ${GRN}✓${NC} Request sent (proof exchange: $PROOF_ID)"
echo ""

# ── 4. Wait for the result ────────────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Wallet → Inbox → Share proof                 │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}Waiting for verification…${NC}"
for i in $(seq 1 90); do
  STATE=$(curl -sf "$VERIFIER/proofs" \
    | python3 -c "
import sys, json
for p in json.load(sys.stdin):
    if p['id'] == '$PROOF_ID':
        print(p.get('state', '?'), p.get('isVerified'))
        break
" 2>/dev/null || echo "")
  if echo "$STATE" | grep -q "done"; then
    if echo "$STATE" | grep -q "True"; then
      echo -e "\r  ${GRN}✓ Verified (isVerified: true)${NC}          "
    else
      echo -e "\r  ${RED}✗ Verification failed${NC}          "
    fi
    exit 0
  fi
  if echo "$STATE" | grep -q "abandoned\|declined"; then
    echo -e "\r  ${RED}✗ Declined/abandoned by the holder${NC}          "
    exit 1
  fi
  printf "\r  … waiting (${i}s)"
  sleep 1
done

echo -e "\n  ${RED}✗ Timeout${NC}"
exit 1
