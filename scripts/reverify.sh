#!/bin/bash
# Neue Proof-Anfrage auf bestehender Verifier-Connection (kein OOB-Handshake)
#
# Optionale Parameter: Attribute, die abgefragt werden sollen
#   ./reverify.sh                          # alle Attribute
#   ./reverify.sh fuehrerscheinklasse      # nur die Klasse
#   ./reverify.sh vorname nachname         # nur Name
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

VERIFIER="http://localhost:3004"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Re-Verify     │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Letzte vollständige Verifier-Connection finden ────────────────────────
CONN=$(curl -sf "$VERIFIER/connections" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
done = sorted([c for c in d if c.get('state') == 'completed'], key=lambda x: x['createdAt'], reverse=True)
print(done[0]['id'] if done else '')
" 2>/dev/null || echo "")

if [ -z "$CONN" ]; then
  echo -e "  ${RED}✗ Keine fertige Verifier-Connection gefunden.${NC}"
  echo -e "  ${YLW}Tipp:${NC} erst ${BLD}bash scripts/verify.sh${NC} ausführen, dann reverify."
  exit 1
fi

echo -e "${CYN}Verwende Connection:${NC} $CONN"
echo ""

# ── 2. Proof-Request bauen ───────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  ATTRS='["vorname","nachname","geburtsdatum","fuehrerscheinklasse","ausstellungsdatum"]'
  echo -e "${CYN}Abgefragte Attribute:${NC} alle"
else
  ATTRS=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1:]))" "$@")
  echo -e "${CYN}Abgefragte Attribute:${NC} $*"
fi
echo ""

# ── 3. Anfrage absenden ──────────────────────────────────────────────────────
echo -e "${CYN}Proof-Anfrage senden…${NC}"
RESP=$(curl -sf -X POST "$VERIFIER/request-proof" \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONN\", \"requestedAttributes\": $ATTRS}")

PROOF_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('proofExchangeId',''))")
echo -e "  ${GRN}✓${NC} Anfrage gesendet (proof exchange: $PROOF_ID)"
echo ""

# ── 4. Auf Ergebnis warten ───────────────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet → Inbox → Proof teilen                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}Warte auf Verifikation…${NC}"
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
      echo -e "\r  ${GRN}✓ Verifiziert (isVerified: true)${NC}          "
    else
      echo -e "\r  ${RED}✗ Verifikation fehlgeschlagen${NC}          "
    fi
    exit 0
  fi
  if echo "$STATE" | grep -q "abandoned\|declined"; then
    echo -e "\r  ${RED}✗ Vom Holder abgelehnt/abgebrochen${NC}          "
    exit 1
  fi
  printf "\r  … warte (${i}s)"
  sleep 1
done

echo -e "\n  ${RED}✗ Timeout${NC}"
exit 1
