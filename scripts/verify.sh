#!/bin/bash
# Verification: Wallet mit Verifier verbinden + Proof anfordern
# Benötigt: setup.sh bereits erfolgreich durchgelaufen
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

VERIFIER="http://localhost:3004"
WALLET="http://localhost:3000"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Verifikation  │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Einladung holen & in UI einfügen ──────────────────────────────────────
echo -e "${CYN}[1/3] Verbindung Wallet ↔ Verifier herstellen…${NC}"
INV_URL=$(curl -sf "$VERIFIER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo ""
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI öffnen → URL einfügen → Verbinden  │${NC}"
echo -e "${YLW}│     http://localhost:3000                                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${BLD}Einladungs-URL:${NC}"
echo "$INV_URL"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | pbcopy 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | wl-copy 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xclip -selection clipboard 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xsel --clipboard --input 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
fi
echo ""
if [ "${OPEN_BROWSER:-0}" = "1" ]; then
  { command -v open >/dev/null 2>&1 && open "http://localhost:3000"; } \
    || xdg-open "http://localhost:3000" 2>/dev/null || true
fi

echo -e "${CYN}Warte auf Verbindungsaufbau…${NC}"
CONN_COUNT_BEFORE=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

for i in $(seq 1 90); do
  CONNS=$(curl -sf "$VERIFIER/connections" 2>/dev/null || echo "[]")
  COMPLETED=$(echo "$CONNS" | python3 -c "
import sys,json
d=[c for c in json.load(sys.stdin) if c['state']=='completed']
print(len(d))" 2>/dev/null || echo "0")
  if [ "$COMPLETED" -gt "$CONN_COUNT_BEFORE" ] 2>/dev/null || [ "$COMPLETED" != "0" -a "$CONN_COUNT_BEFORE" = "0" ]; then
    echo -e "\r  ${GRN}✓ Verbindung aufgebaut${NC}          "
    break
  fi
  printf "\r  … warte auf Verbindung (${i}s)"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout${NC}" && exit 1
done
echo ""

# ── 2. Proof anfordern ────────────────────────────────────────────────────────
echo -e "${CYN}[2/3] Proof-Anfrage senden…${NC}"
CONN=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "import sys,json; d=sorted([c for c in json.load(sys.stdin) if c['state']=='completed'], key=lambda x:x['createdAt'], reverse=True); print(d[0]['id'])")
PROOF_RESP=$(curl -sf -X POST "$VERIFIER/request-proof" \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONN\"}")
PROOF_ID=$(echo "$PROOF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['proofExchangeId'])")
echo -e "  ${GRN}✓${NC} Proof-Anfrage gesendet"
echo ""

# ── 3. Warten bis User in UI teilt ───────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Proof-Anfragen'                │${NC}"
echo -e "${YLW}│     Klicke auf Teilen                                   │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[3/3] Warte auf Proof-Präsentation in der UI…${NC}"
for i in $(seq 1 120); do
  # Es gibt keinen /proofs/:id Endpunkt — den Proof per id aus /proof-exchanges suchen.
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
      echo -e "  ${GRN}${BLD}✓ isVerified: true — Führerschein gültig!${NC}"
    else
      echo -e "  ${RED}✗ isVerified: $IS_VER (Credential evtl. widerrufen?)${NC}"
    fi
    break
  fi
  printf "\r  … Proof-Status: %-25s (${i}s)" "$STATE"
  sleep 1
  [ "$i" = "120" ] && echo -e "\n  ${YLW}⚠ Timeout — hast du 'Teilen' geklickt?${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Verifikation abgeschlossen.${NC}"
