#!/bin/bash
# Neues Credential ausstellen (Issuer bereits eingerichtet, neue Verbindung)
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ISSUER="http://localhost:3002"
WALLET="http://localhost:3000"

# Optionale Parameter: ./issue.sh "Anna" "Schmidt" "1985-06-20" "A" "2023-01-10"
VORNAME="${1:-Max}"
NACHNAME="${2:-Mustermann}"
GEBURTSDATUM="${3:-1990-01-15}"
KLASSE="${4:-B}"
AUSSTELLUNGSDATUM="${5:-2024-03-01}"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Issue          │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""
echo -e "  Ausstellen für: ${BLD}$VORNAME $NACHNAME${NC}, Klasse ${BLD}$KLASSE${NC}"
echo ""

# ── 1. Neue Einladung holen ───────────────────────────────────────────────────
echo -e "${CYN}[1/3] Neue Verbindung zum Issuer herstellen…${NC}"
INV_URL=$(curl -sf "$ISSUER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo ""
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → URL einfügen → Verbinden         │${NC}"
echo -e "${YLW}│     http://localhost:3000                                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${BLD}Einladungs-URL:${NC}"
echo "$INV_URL"
echo ""
xdg-open "http://localhost:3000" 2>/dev/null || true

CONN_COUNT_BEFORE=$(curl -sf "$ISSUER/connections" \
  | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c['state']=='completed']))" 2>/dev/null || echo "0")

echo -e "${CYN}Warte auf Verbindungsaufbau…${NC}"
for i in $(seq 1 90); do
  COMPLETED=$(curl -sf "$ISSUER/connections" \
    | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c['state']=='completed']))" 2>/dev/null || echo "0")
  if [ "$COMPLETED" -gt "$CONN_COUNT_BEFORE" ] 2>/dev/null; then
    echo -e "\r  ${GRN}✓ Verbindung aufgebaut${NC}          "; break
  fi
  printf "\r  … warte (${i}s)"; sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout${NC}" && exit 1
done
echo ""

# ── 2. Credential ausstellen ─────────────────────────────────────────────────
echo -e "${CYN}[2/3] Führerschein-Angebot senden…${NC}"
CONN=$(curl -sf "$ISSUER/connections" \
  | python3 -c "import sys,json; d=sorted([c for c in json.load(sys.stdin) if c['state']=='completed'], key=lambda x:x['createdAt'], reverse=True); print(d[0]['id'])")
curl -sf -X POST "$ISSUER/issue" \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONN\",
    \"vorname\": \"$VORNAME\",
    \"nachname\": \"$NACHNAME\",
    \"geburtsdatum\": \"$GEBURTSDATUM\",
    \"fuehrerscheinklasse\": \"$KLASSE\",
    \"ausstellungsdatum\": \"$AUSSTELLUNGSDATUM\"
  }" > /dev/null
echo -e "  ${GRN}✓${NC} Angebot gesendet"
echo ""

# ── 3. Warten bis UI akzeptiert ──────────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Credential-Angebote' → Annehmen │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

COUNT_BEFORE=$(curl -sf "$WALLET/credentials" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

echo -e "${CYN}[3/3] Warte auf Annahme in der UI…${NC}"
for i in $(seq 1 120); do
  COUNT=$(curl -sf "$WALLET/credentials" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$COUNT" -gt "$COUNT_BEFORE" ] 2>/dev/null; then
    echo -e "\r  ${GRN}✓ Credential gespeichert!${NC}                    "; break
  fi
  printf "\r  … warte auf UI-Aktion (${i}s)"; sleep 1
  [ "$i" = "120" ] && echo -e "\n  ${YLW}⚠ Timeout${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Credential für $VORNAME $NACHNAME ausgestellt.${NC}"
