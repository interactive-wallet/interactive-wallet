#!/bin/bash
# Issue a new credential on an existing issuer connection (no OOB handshake)
#
# Optional parameters: ./reissue.sh "Anna" "Schmidt" "1985-06-20" "A" "2023-01-10"
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ISSUER="http://localhost:3002"
WALLET="http://localhost:3000"

VORNAME="${1:-Max}"
NACHNAME="${2:-Mustermann}"
GEBURTSDATUM="${3:-1990-01-15}"
KLASSE="${4:-B}"
AUSSTELLUNGSDATUM="${5:-2024-03-01}"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Re-Issue      │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""
echo -e "  Issuing for: ${BLD}$VORNAME $NACHNAME${NC}, class ${BLD}$KLASSE${NC}"
echo ""

# ── 1. Find the most recent completed issuer connection ──────────────────
CONN=$(curl -sf "$ISSUER/connections" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
done = sorted([c for c in d if c.get('state') == 'completed'], key=lambda x: x['createdAt'], reverse=True)
print(done[0]['id'] if done else '')
" 2>/dev/null || echo "")

if [ -z "$CONN" ]; then
  echo -e "  ${RED}✗ No completed issuer connection found.${NC}"
  echo -e "  ${YLW}Tip:${NC} run ${BLD}bash scripts/issue.sh${NC} first, then reissue."
  exit 1
fi

echo -e "${CYN}Using connection:${NC} $CONN"
echo ""

# ── 2. Send credential offer ──────────────────────────────────────────────
echo -e "${CYN}Sending credential offer…${NC}"
ISSUE_RESP=$(curl -sf -X POST "$ISSUER/issue" \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONN\",
    \"vorname\": \"$VORNAME\",
    \"nachname\": \"$NACHNAME\",
    \"geburtsdatum\": \"$GEBURTSDATUM\",
    \"fuehrerscheinklasse\": \"$KLASSE\",
    \"ausstellungsdatum\": \"$AUSSTELLUNGSDATUM\"
  }")
if [ -z "$ISSUE_RESP" ]; then
  echo -e "  ${RED}✗ Issuer returned no response for /issue${NC}"; exit 1
fi
# Save the credential mapping so revoke.sh can find it (response via argv, not stdin)
python3 - "$(dirname "$0")/.last-issued-credential.json" "$ISSUE_RESP" <<'PY'
import json, sys
path, resp = sys.argv[1], sys.argv[2]
data = json.loads(resp)
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "credentialExchangeId": data.get("credentialExchangeId", ""),
        "credentialId": data.get("credentialId", ""),
    }, f, indent=2)
PY
echo -e "  ${GRN}✓${NC} Offer sent"
echo ""

# ── 3. Wait for the UI to accept ──────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Wallet → Inbox → Accept                      │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

COUNT_BEFORE=$(curl -sf "$WALLET/credentials" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

echo -e "${CYN}Waiting for acceptance…${NC}"
for i in $(seq 1 90); do
  COUNT_NOW=$(curl -sf "$WALLET/credentials" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$COUNT_NOW" -gt "$COUNT_BEFORE" ] 2>/dev/null; then
    echo -e "\r  ${GRN}✓ Credential stored${NC}          "
    exit 0
  fi
  printf "\r  … waiting (${i}s)"
  sleep 1
done

echo -e "\n  ${RED}✗ Timeout${NC}"
exit 1
