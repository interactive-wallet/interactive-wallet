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

EXCHANGE_ID="${1:-}"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Revocation   │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Credential Exchange bestimmen ─────────────────────────────────────────
echo -e "${CYN}[1/2] Suche widerrufbares Credential…${NC}"

if [ -z "$EXCHANGE_ID" ]; then
  if ! EXCHANGES=$(curl -sS "$ISSUER/credential-exchanges"); then
    echo -e "  ${RED}✗ Issuer nicht erreichbar${NC}"
    exit 1
  fi

  EXCHANGE_ID=$(
    printf '%s' "$EXCHANGES" |
      python3 -c '
import json
import sys

try:
    records = json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)

if not isinstance(records, list):
    print("")
    raise SystemExit(0)

candidates = [
    record
    for record in records
    if record.get("role") == "issuer"
    and record.get("state") in ("credential-issued", "done")
    and record.get("credentialRevocationId")
    and record.get("revocationRegistryId")
]

candidates.sort(
    key=lambda record: record.get("createdAt", ""),
    reverse=True,
)

print(candidates[0].get("id", "") if candidates else "")
'
  )

  if [ -z "$EXCHANGE_ID" ]; then
    echo -e "  ${RED}✗ Kein widerrufbares Credential gefunden${NC}"
    echo ""
    echo -e "  Benötigt wird ein Issuer-Exchange mit:"
    echo -e "    state: ${BLD}credential-issued${NC} oder ${BLD}done${NC}"
    echo -e "    vorhandener Revocation-Metadata"
    exit 1
  fi

  echo -e "  ${GRN}✓${NC} Neuesten widerrufbaren Exchange gefunden:"
else
  echo -e "  ${GRN}✓${NC} Angegebenen Exchange verwenden:"
fi

echo -e "    ${BLD}$EXCHANGE_ID${NC}"
echo ""

BODY=$(
  python3 -c '
import json
import sys

print(json.dumps({
    "credentialExchangeId": sys.argv[1]
}))
' "$EXCHANGE_ID"
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

  echo -e "  ${GRN}✓ Credential widerrufen${NC}"
  echo ""
  echo -e "  Credential Exchange:"
  echo -e "    ${BLD}$EXCHANGE_ID${NC}"
  echo -e "  Revocation-Index:"
  echo -e "    ${BLD}$REVOKED_IDX${NC}"
  echo -e "  Revocation Registry:"
  echo -e "    ${BLD}$REV_REG${NC}"
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