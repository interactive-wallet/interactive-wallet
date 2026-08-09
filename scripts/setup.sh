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
echo -e "${CYN}[1/5] Warte auf Issuer-Agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$ISSUER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … warte (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Issuer nicht erreichbar — ist er gestartet?${NC}" && exit 1
done
# State liegt im Container (/app/issuer-state.json), nicht auf dem Host — per docker compose exec lesen
CRED_DEF=$( (cd "$ROOT" && docker compose exec -T issuer cat /app/issuer-state.json 2>/dev/null) \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['credDefId'])" 2>/dev/null || echo "")
if [ -z "$CRED_DEF" ]; then
  echo -e "  ${RED}✗ issuer-state.json im Container fehlt — Issuer-Agent neu starten${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} CredDef: $CRED_DEF"
echo ""

# ── 2. Verifier bereit warten ─────────────────────────────────────────────────
echo -e "${CYN}[2/5] Warte auf Verifier-Agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$VERIFIER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … warte (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Verifier nicht erreichbar — ist er gestartet?${NC}" && exit 1
done
# Verifier läuft als wallet-agent-Image; State liegt im Container unter /app/verifier-state.json
V_DID=$( (cd "$ROOT" && docker compose exec -T verifier cat /app/verifier-state.json 2>/dev/null) \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verifierDid'])" 2>/dev/null || echo "")
if [ -z "$V_DID" ]; then
  echo -e "  ${RED}✗ verifier-state.json im Container fehlt — Verifier-Agent neu starten${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} Verifier-DID: $V_DID"
echo ""

# ── 3. Einladung holen & in UI einfügen ──────────────────────────────────────
echo -e "${CYN}[3/5] Verbindung Wallet ↔ Issuer herstellen…${NC}"
# Anzahl bereits completed Connections merken — wir warten auf eine NEUE (robust gegen alte Leichen).
CONN_COUNT_BEFORE=$(curl -sf "$ISSUER/connections" 2>/dev/null \
  | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c.get('state')=='completed']))" 2>/dev/null || echo "0")
INV_URL=$(curl -sf "$ISSUER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

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
for i in $(seq 1 90); do
  # Auf eine NEU completed Connection warten (Anzahl muss steigen) — ignoriert alte Leichen.
  COMPLETED=$(curl -sf "$ISSUER/connections" 2>/dev/null \
    | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c.get('state')=='completed']))" 2>/dev/null || echo "0")
  if [ "$COMPLETED" -gt "$CONN_COUNT_BEFORE" ] 2>/dev/null; then
    echo -e "\r  ${GRN}✓ Verbindung aufgebaut${NC}          "; break
  fi
  printf "\r  … warte (${i}s)"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout — Verbindung nicht aufgebaut${NC}" && exit 1
done
echo ""

# ── 4. Credential ausstellen ─────────────────────────────────────────────────
echo -e "${CYN}[4/5] Führerschein-Angebot senden…${NC}"
CONN=$(curl -sf "$ISSUER/connections" \
  | python3 -c "import sys,json; d=sorted([c for c in json.load(sys.stdin) if c['state']=='completed'], key=lambda x:x['createdAt'], reverse=True); print(d[0]['id'])")
ISSUE_RESP=$(curl -sf -X POST "$ISSUER/issue" \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONN\",
    \"vorname\": \"Max\",
    \"nachname\": \"Mustermann\",
    \"geburtsdatum\": \"1990-01-15\",
    \"fuehrerscheinklasse\": \"B\",
    \"ausstellungsdatum\": \"2024-03-01\"
  }")
if [ -z "$ISSUE_RESP" ]; then
  echo -e "  ${RED}✗ Issuer lieferte keine Antwort auf /issue — Verbindung tot? Versuche ./scripts/reset.sh${NC}"; exit 1
fi
# Credential-Zuordnung speichern, damit revoke.sh sie findet (wie issue.sh).
# Antwort per argv übergeben — NICHT per Pipe, sonst kollidiert stdin mit dem Heredoc-Programm.
python3 - "$ROOT/scripts/.last-issued-credential.json" "$ISSUE_RESP" <<'PY'
import json, sys
path, resp = sys.argv[1], sys.argv[2]
data = json.loads(resp)
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "credentialExchangeId": data.get("credentialExchangeId", ""),
        "credentialId": data.get("credentialId", ""),
    }, f, indent=2)
PY
echo -e "  ${GRN}✓${NC} Angebot gesendet"
echo ""

# ── 5. Warten bis User in UI akzeptiert ──────────────────────────────────────
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
