#!/bin/bash
# Widerruft das zuletzt ausgestellte widerrufbare Credential.
#
# Optional:
#   ./scripts/revoke.sh <credentialExchangeId>
#
# Ohne Parameter wird der neueste passende Issuer-Exchange gewählt.

set -euo pipefail

GRN='\033[0;32m'
YLW='\033[1;33m'
CYN='\033[0;36m'
RED='\033[0;31m'
BLD='\033[1m'
NC='\033[0m'

ISSUER="http://localhost:3002"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIAL_STATE_FILE="$SCRIPT_DIR/.last-issued-credential.json"

EXCHANGE_ID="${1:-}"
CREDENTIAL_ID="${2:-}"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Revocation   │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Credential bestimmen ───────────────────────────────────────────────────
echo -e "${CYN}[1/2] Lade zuletzt ausgestelltes Credential…${NC}"

if [ -n "$EXCHANGE_ID" ] || [ -n "$CREDENTIAL_ID" ]; then
  if [ -z "$EXCHANGE_ID" ] || [ -z "$CREDENTIAL_ID" ]; then
    echo -e "  ${RED}✗ Bei manueller Angabe werden beide IDs benötigt${NC}"
    echo ""
    echo "Verwendung:"
    echo "  ./scripts/revoke.sh <credentialExchangeId> <credentialId>"
    exit 1
  fi
else
  if [ ! -f "$CREDENTIAL_STATE_FILE" ]; then
    echo -e "  ${RED}✗ Keine gespeicherte Credential-Zuordnung gefunden${NC}"
    echo ""
    echo "Bitte zuerst ausführen:"
    echo "  ./scripts/issue.sh"
    exit 1
  fi

  EXCHANGE_ID=$(python3 - "$CREDENTIAL_STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    data = json.load(file)

print(data.get("credentialExchangeId", ""))
PY
  )

  CREDENTIAL_ID=$(python3 - "$CREDENTIAL_STATE_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    data = json.load(file)

print(data.get("credentialId", ""))
PY
  )
fi

if [ -z "$EXCHANGE_ID" ] || [ -z "$CREDENTIAL_ID" ]; then
  echo -e "  ${RED}✗ Credential-Zuordnung ist unvollständig${NC}"
  exit 1
fi

echo -e "  ${GRN}✓${NC} Credential-Zuordnung gefunden:"
echo -e "    Exchange-ID:   ${BLD}$EXCHANGE_ID${NC}"
echo -e "    Credential-ID: ${BLD}$CREDENTIAL_ID${NC}"
echo ""

BODY=$(python3 - "$EXCHANGE_ID" "$CREDENTIAL_ID" <<'PY'
import json
import sys

print(json.dumps({
    "credentialExchangeId": sys.argv[1],
    "credentialId": sys.argv[2],
}))
PY
)

# ── 2. Credential widerrufen ──────────────────────────────────────────────────
echo -e "${CYN}[2/2] Widerrufe Credential beim Issuer…${NC}"

if ! REVOKE_RESP=$(curl -sS -X POST "$ISSUER/revoke" \
  -H "Content-Type: application/json" \
  -d "$BODY"); then

  echo -e "  ${RED}✗ Issuer wirklich nicht erreichbar${NC}"
  exit 1
fi

if printf '%s' "$REVOKE_RESP" |
  python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)

raise SystemExit(0 if data.get("success") is True else 1)
' 2>/dev/null; then

  REVOKED_IDX=$(
    printf '%s' "$REVOKE_RESP" |
      python3 -c '
import json
import sys
print(json.load(sys.stdin).get("revokedIndex", "?"))
'
  )

  REV_REG=$(
    printf '%s' "$REVOKE_RESP" |
      python3 -c '
import json
import sys
print(json.load(sys.stdin).get("revocationRegistryId", "?"))
'
  )

  RABBIT_EVENT_ID=$(
    printf '%s' "$REVOKE_RESP" |
      python3 -c '
import json
import sys
print(json.load(sys.stdin).get("rabbitMqEventId", "?"))
'
  )

  echo -e "  ${GRN}✓ Credential widerrufen${NC}"
  echo ""
  echo -e "  Credential Exchange:"
  echo -e "    ${BLD}$EXCHANGE_ID${NC}"
  echo -e "  Revocation-Index:"
  echo -e "    ${BLD}$REVOKED_IDX${NC}"
  echo -e "  Revocation Registry:"
  echo -e "    ${BLD}$REV_REG${NC}"
  echo -e "  RabbitMQ Event-ID:"
  echo -e "    ${BLD}$RABBIT_EVENT_ID${NC}"
else
  ERR=$(
    printf '%s' "$REVOKE_RESP" |
      python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
    print(data.get("error", "Unbekannter Fehler"))
except Exception:
    print("Ungültige Antwort vom Issuer")
' 2>/dev/null
  )

  echo -e "  ${RED}✗ Revocation fehlgeschlagen: $ERR${NC}"
  echo -e "  Antwort des Issuers:"
  echo "$REVOKE_RESP"
  exit 1
fi

echo ""
echo -e "${GRN}${BLD}✓ Revocation abgeschlossen.${NC}"
echo -e "  Der Widerruf wurde auf VON geschrieben."
echo -e "  Das RabbitMQ-Event wurde veröffentlicht."