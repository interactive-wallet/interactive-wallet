#!/bin/bash
# Setup: Issuer-DID registrieren + Credential ausstellen
# Benötigt: alle drei Agents laufen, VON Network läuft
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ISSUER="http://localhost:3002"
WALLET="http://localhost:3000"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Setup         │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Issuer DID registrieren ───────────────────────────────────────────────
echo -e "${CYN}[1/4] Issuer-DID auf VON registrieren…${NC}"
rm -f "$ROOT/issuer-agent/issuer-state.json"
SETUP=$(curl -sf -X POST "$ISSUER/setup" 2>/dev/null || echo '{"error":"Issuer nicht erreichbar"}')
if echo "$SETUP" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(1 if 'error' in d else 0)" 2>/dev/null; then
  CRED_DEF=$(echo "$SETUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['credDefId'])")
  echo -e "  ${GRN}✓${NC} CredDef: $CRED_DEF"
else
  echo -e "  ${RED}✗ Fehler:${NC} $SETUP"; exit 1
fi
echo ""

# ── 2. Einladung holen & in UI einfügen ──────────────────────────────────────
echo -e "${CYN}[2/4] Verbindung Wallet ↔ Issuer herstellen…${NC}"
INV_URL=$(curl -sf "$ISSUER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo ""
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI öffnen → URL einfügen → Verbinden  │${NC}"
echo -e "${YLW}│     http://localhost:3000                                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${BLD}Einladungs-URL:${NC}"
echo "$INV_URL"
if command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | wl-copy 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xclip -selection clipboard 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xsel --clipboard --input 2>/dev/null && echo -e "  ${GRN}✓ In Zwischenablage kopiert${NC}"
fi
echo ""
if [ "${OPEN_BROWSER:-0}" = "1" ]; then
  xdg-open "http://localhost:3000" 2>/dev/null || true
fi

echo -e "${CYN}Warte auf Verbindungsaufbau…${NC}"
for i in $(seq 1 90); do
  STATE=$(curl -sf "$ISSUER/connections" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['state'] if d else 'none')" 2>/dev/null || echo "none")
  [ "$STATE" = "completed" ] && echo -e "\r  ${GRN}✓ Verbindung aufgebaut${NC}          " && break
  printf "\r  … Status: %-30s" "$STATE (${i}s)"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout — Verbindung nicht aufgebaut${NC}" && exit 1
done
echo ""

# ── 3. Credential ausstellen ─────────────────────────────────────────────────
echo -e "${CYN}[3/4] Führerschein-Angebot senden…${NC}"
CONN=$(curl -sf "$ISSUER/connections" \
  | python3 -c "import sys,json; d=sorted([c for c in json.load(sys.stdin) if c['state']=='completed'], key=lambda x:x['createdAt'], reverse=True); print(d[0]['id'])")
curl -sf -X POST "$ISSUER/issue" \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONN\",
    \"vorname\": \"Max\",
    \"nachname\": \"Mustermann\",
    \"geburtsdatum\": \"1990-01-15\",
    \"fuehrerscheinklasse\": \"B\",
    \"ausstellungsdatum\": \"2024-03-01\"
  }" > /dev/null
echo -e "  ${GRN}✓${NC} Angebot gesendet"
echo ""

# ── 4. Warten bis User in UI akzeptiert ──────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Credential-Angebote'           │${NC}"
echo -e "${YLW}│     Klicke auf Annehmen                                 │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[4/4] Warte auf Annahme in der UI…${NC}"
for i in $(seq 1 120); do
  COUNT=$(curl -sf "$WALLET/credentials" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$COUNT" != "0" ]; then
    echo -e "\r  ${GRN}✓ Credential gespeichert!${NC}                    "
    break
  fi
  printf "\r  … warte auf UI-Aktion (${i}s)"
  sleep 1
  [ "$i" = "120" ] && echo -e "\n  ${YLW}⚠ Timeout — hast du 'Annehmen' geklickt?${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Setup abgeschlossen!${NC} Führerschein liegt im Wallet."
echo -e "  Nächster Schritt: ${BLD}./scripts/verify.sh${NC}"
