#!/bin/bash
# Neues Credential ausstellen (Issuer bereits eingerichtet, neue Verbindung)
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ISSUER="http://localhost:3002"
WALLET="http://localhost:3000"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIAL_STATE_FILE="$SCRIPT_DIR/.last-issued-credential.json"

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

CREDENTIAL_EXCHANGE_ID=$(printf '%s' "$ISSUE_RESP" |
  python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('credentialExchangeId', ''))
")

CREDENTIAL_ID=$(printf '%s' "$ISSUE_RESP" |
  python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('credentialId', ''))
")

if [ -z "$CREDENTIAL_EXCHANGE_ID" ] || [ -z "$CREDENTIAL_ID" ]; then
  echo -e "  ${RED}✗ Issuer hat nicht beide Credential-IDs zurückgegeben${NC}"
  echo "$ISSUE_RESP"
  exit 1
fi

echo -e "  ${GRN}✓${NC} Angebot gesendet"
echo -e "  Exchange-ID:   ${BLD}$CREDENTIAL_EXCHANGE_ID${NC}"
echo -e "  Credential-ID: ${BLD}$CREDENTIAL_ID${NC}"
echo ""

python3 - \
  "$CREDENTIAL_STATE_FILE" \
  "$CREDENTIAL_EXCHANGE_ID" \
  "$CREDENTIAL_ID" <<'PY'
import json
import sys

state_file = sys.argv[1]
exchange_id = sys.argv[2]
credential_id = sys.argv[3]

with open(state_file, "w", encoding="utf-8") as file:
    json.dump(
        {
            "credentialExchangeId": exchange_id,
            "credentialId": credential_id,
        },
        file,
        indent=2,
    )
    file.write("\n")
PY

echo -e "  ${GRN}✓ Credential-Zuordnung gespeichert${NC}"
echo -e "    $CREDENTIAL_STATE_FILE"
echo ""

# ── 3. Warten bis UI akzeptiert ──────────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Credential-Angebote' → Annehmen │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[3/3] Warte auf Annahme in der UI…${NC}"

for i in $(seq 1 120); do
  EXCHANGE_STATE=$(curl -sf "$ISSUER/credential-exchanges" |
    python3 -c "
import sys, json

exchange_id = '$CREDENTIAL_EXCHANGE_ID'
records = json.load(sys.stdin)

record = next(
    (item for item in records if item.get('id') == exchange_id),
    None
)

print(record.get('state', 'not-found') if record else 'not-found')
" 2>/dev/null || echo "error")

  if [ "$EXCHANGE_STATE" = "done" ] ||
    [ "$EXCHANGE_STATE" = "credential-issued" ]; then
    echo -e "\r  ${GRN}✓ Credential ausgestellt!${NC}                     "
    break
  fi

  if [ "$EXCHANGE_STATE" = "abandoned" ]; then
    echo ""
    echo -e "  ${RED}✗ Credential-Austausch wurde abgebrochen${NC}"
    exit 1
  fi

  printf "\r  … Status: %-25s (%ss)" "$EXCHANGE_STATE" "$i"
  sleep 1

  if [ "$i" = "120" ]; then
    echo ""
    echo -e "  ${YLW}⚠ Timeout — letzter Status: $EXCHANGE_STATE${NC}"
    exit 1
  fi
done

echo ""
echo -e "${GRN}${BLD}✓ Credential für $VORNAME $NACHNAME ausgestellt.${NC}"