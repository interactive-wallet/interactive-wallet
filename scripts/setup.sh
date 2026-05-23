#!/bin/bash
# Setup: Issuer-DID registrieren + Credential ausstellen
# Benötigt: alle Agents laufen (mediator, issuer, verifier, wallet), VON Network läuft
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIATOR="http://localhost:3006"
ISSUER="http://localhost:3002"
VERIFIER="http://localhost:3004"
WALLET="http://localhost:3000"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Setup         │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Issuer bereit warten ──────────────────────────────────────────────────
echo -e "${CYN}[1/6] Warte auf Issuer-Agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$ISSUER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … warte (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Issuer nicht erreichbar — ist er gestartet?${NC}" && exit 1
done
CRED_DEF=$(python3 -c "import json; d=json.load(open('$ROOT/issuer-agent/issuer-state.json')); print(d['credDefId'])" 2>/dev/null || echo "")
if [ -z "$CRED_DEF" ]; then
  echo -e "  ${RED}✗ issuer-state.json fehlt — Issuer-Agent neu starten${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} CredDef: $CRED_DEF"
echo ""

# ── 2. Verifier bereit warten ─────────────────────────────────────────────────
echo -e "${CYN}[2/6] Warte auf Verifier-Agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$VERIFIER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … warte (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Verifier nicht erreichbar — ist er gestartet?${NC}" && exit 1
done
V_DID=$(python3 -c "import json; d=json.load(open('$ROOT/verifier-agent/verifier-state.json')); print(d['verifierDid'])" 2>/dev/null || echo "")
if [ -z "$V_DID" ]; then
  echo -e "  ${RED}✗ verifier-state.json fehlt — Verifier-Agent neu starten${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} Verifier-DID: $V_DID"
echo ""

# ── 3. Einladung holen & in UI einfügen ──────────────────────────────────────
echo -e "${CYN}[3/5] Verbindung Wallet ↔ Issuer herstellen…${NC}"
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

# ── 5. Credential ausstellen ─────────────────────────────────────────────────
echo -e "${CYN}[4/5] Führerschein-Angebot senden…${NC}"
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

# ── 6. Warten bis User in UI akzeptiert ──────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Credential-Angebote'           │${NC}"
echo -e "${YLW}│     Klicke auf Annehmen                                 │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[5/5] Warte auf Annahme in der UI…${NC}"
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
