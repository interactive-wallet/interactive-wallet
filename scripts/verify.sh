#!/bin/bash
# Verification: connect wallet to verifier + request proof
# Requires: setup.sh has already run successfully
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

VERIFIER="http://localhost:3004"
WALLET="http://localhost:3000"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Verification  │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Get invitation & paste into UI ─────────────────────────────────────
echo -e "${CYN}[1/3] Establishing wallet ↔ verifier connection…${NC}"
INV_URL=$(curl -sf "$VERIFIER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo ""
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Open wallet UI → paste URL → Connect         │${NC}"
echo -e "${YLW}│     http://localhost:3000                                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${BLD}Invitation URL:${NC}"
echo "$INV_URL"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | pbcopy 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | wl-copy 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xclip -selection clipboard 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xsel --clipboard --input 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
fi
echo ""
if [ "${OPEN_BROWSER:-0}" = "1" ]; then
  { command -v open >/dev/null 2>&1 && open "http://localhost:3000"; } \
    || xdg-open "http://localhost:3000" 2>/dev/null || true
fi

echo -e "${CYN}Waiting for connection…${NC}"
CONN_COUNT_BEFORE=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

for i in $(seq 1 90); do
  CONNS=$(curl -sf "$VERIFIER/connections" 2>/dev/null || echo "[]")
  COMPLETED=$(echo "$CONNS" | python3 -c "
import sys,json
d=[c for c in json.load(sys.stdin) if c['state']=='completed']
print(len(d))" 2>/dev/null || echo "0")
  if [ "$COMPLETED" -gt "$CONN_COUNT_BEFORE" ] 2>/dev/null || [ "$COMPLETED" != "0" -a "$CONN_COUNT_BEFORE" = "0" ]; then
    echo -e "\r  ${GRN}✓ Connection established${NC}          "
    break
  fi
  printf "\r  … waiting for connection (${i}s)"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout${NC}" && exit 1
done
echo ""

# ── 2. Request proof ──────────────────────────────────────────────────────
echo -e "${CYN}[2/3] Sending proof request…${NC}"
CONN=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "import sys,json; d=sorted([c for c in json.load(sys.stdin) if c['state']=='completed'], key=lambda x:x['createdAt'], reverse=True); print(d[0]['id'])")
PROOF_RESP=$(curl -sf -X POST "$VERIFIER/request-proof" \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONN\"}")
PROOF_ID=$(echo "$PROOF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['proofExchangeId'])")
echo -e "  ${GRN}✓${NC} Proof request sent"
echo ""

# ── 3. Wait for the user to share in the UI ───────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Wallet UI → 'Proof requests'                 │${NC}"
echo -e "${YLW}│     Click Share                                          │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[3/3] Waiting for proof presentation in the UI…${NC}"
for i in $(seq 1 120); do
  # There's no /proofs/:id endpoint — look the proof up by id from /proof-exchanges.
  STATE_VER=$(curl -sf "$VERIFIER/proof-exchanges" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = next((x for x in d if x.get('id') == sys.argv[1]), None)
print(p.get('state') if p else 'unknown', p.get('isVerified') if p else None)
" "$PROOF_ID" 2>/dev/null || echo "error None")
  STATE=$(echo "$STATE_VER" | awk '{print $1}')
  IS_VER=$(echo "$STATE_VER" | awk '{print $2}')
  if [ "$STATE" = "done" ]; then
    echo ""
    if [ "$IS_VER" = "True" ]; then
      echo -e "  ${GRN}${BLD}✓ isVerified: true — Führerschein valid!${NC}"
    else
      echo -e "  ${RED}✗ isVerified: $IS_VER (credential possibly revoked?)${NC}"
    fi
    break
  fi
  printf "\r  … proof status: %-25s (${i}s)" "$STATE"
  sleep 1
  [ "$i" = "120" ] && echo -e "\n  ${YLW}⚠ Timeout — did you click 'Share'?${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Verification complete.${NC}"
