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

CREDENTIAL_EXCHANGE_ID=$(echo "$ISSUE_RESP" |
  python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('credentialExchangeId', ''))
")

REVOCATION_REGISTRY_ID=$(echo "$ISSUE_RESP" |
  python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('revocationRegistryDefinitionId', ''))
")

REVOCATION_INDEX=$(echo "$ISSUE_RESP" |
  python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('revocationRegistryIndex', ''))
")

echo -e "  Revocation Registry: ${BLD}$REVOCATION_REGISTRY_ID${NC}"
echo -e "  Revocation Index: ${BLD}$REVOCATION_INDEX${NC}"

if [ -z "$CREDENTIAL_EXCHANGE_ID" ]; then
  echo -e "  ${RED}✗ Issuer hat keine Credential-Exchange-ID zurückgegeben${NC}"
  echo "$ISSUE_RESP"
  exit 1
fi

echo -e "  ${GRN}✓${NC} Angebot gesendet"
echo -e "  Exchange-ID: ${BLD}$CREDENTIAL_EXCHANGE_ID${NC}"
echo ""

# ── 3. Warten bis UI akzeptiert ──────────────────────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → 'Credential-Angebote' → Annehmen │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[3/3] Warte auf Annahme und Speicherung…${NC}"

ACCEPT_REQUEST_SENT=0
ISSUE_COMPLETED=0

for i in $(seq 1 120); do
  EXCHANGE_STATE=$(curl -sS "$ISSUER/credential-exchanges" |
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

  # Der Holder hat das Angebot angenommen, aber der Issuer muss das eigentliche Credential noch ausstellen.
  if [ "$EXCHANGE_STATE" = "request-received" ] &&
     [ "$ACCEPT_REQUEST_SENT" = "0" ]; then

    echo ""
    echo -e "  ${CYN}Holder-Anfrage empfangen — stelle Credential aus…${NC}"

    ACCEPT_RESP=$(curl -sS -X POST \
      "$ISSUER/credential-exchanges/$CREDENTIAL_EXCHANGE_ID/accept-request" \
      2>/dev/null || echo '{"success":false}')

    ACCEPT_REQUEST_SENT=1

    ACCEPT_SUCCESS=$(printf '%s' "$ACCEPT_RESP" |
      python3 -c "
import sys, json

try:
    data = json.load(sys.stdin)
    print('true' if data.get('success') else 'false')
except Exception:
    print('false')
")

    if [ "$ACCEPT_SUCCESS" = "true" ]; then
      echo -e "  ${GRN}✓${NC} Credential durch Issuer ausgestellt"
    else
      echo -e "  ${YLW}⚠ accept-request wurde nicht bestätigt; Status wird erneut geprüft${NC}"
    fi
  fi

  # Prüfen, ob genau dieses Credential im Wallet gespeichert ist.
  WALLET_HAS_CREDENTIAL=$(
    curl -sS "$WALLET/credentials" 2>/dev/null |
      REV_REG_ID="$REVOCATION_REGISTRY_ID" \
      REV_INDEX="$REVOCATION_INDEX" \
      python3 -c "
import json
import os
import sys

try:
    credentials = json.load(sys.stdin)
except Exception:
    print('false')
    raise SystemExit(0)

registry_id = os.environ.get('REV_REG_ID')
revocation_index = str(os.environ.get('REV_INDEX', ''))

found = any(
    credential.get('revocationRegistryId') == registry_id
    and str(credential.get('credentialRevocationId')) == revocation_index
    for credential in credentials
)

print('true' if found else 'false')
"
  )

  if [ "$EXCHANGE_STATE" = "done" ]; then
    echo -e "\r  ${GRN}✓ Credential angenommen und Austausch abgeschlossen!${NC}       "
    ISSUE_COMPLETED=1
    break
  fi

  if [ "$WALLET_HAS_CREDENTIAL" = "true" ]; then
    echo ""
    echo -e "  ${GRN}✓ Credential wurde im Wallet gespeichert!${NC}"

    if [ "$EXCHANGE_STATE" != "done" ]; then
      echo -e "  ${YLW}Hinweis: Issuer-Zustand ist noch '$EXCHANGE_STATE'; ACK steht noch aus.${NC}"
    fi

    ISSUE_COMPLETED=1
    break
  fi

  if [ "$EXCHANGE_STATE" = "abandoned" ]; then
    echo ""
    echo -e "  ${RED}✗ Credential-Austausch wurde abgebrochen${NC}"
    exit 1
  fi

  printf "\r  … Status: %-25s (%ss)" "$EXCHANGE_STATE" "$i"
  sleep 1
done

if [ "$ISSUE_COMPLETED" != "1" ]; then
  echo ""
  echo -e "  ${YLW}⚠ Timeout — letzter Issuer-Status: $EXCHANGE_STATE${NC}"
  exit 1
fi