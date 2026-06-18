#!/bin/bash
# Revoke the most recently issued credential and trigger a re-verify to show the proof fails.
#
# Optional parameter: ./revoke.sh <credentialExchangeId>
# Without a parameter, the most recently issued credential is revoked.
set -e

GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; RED='\033[0;31m'; BLD='\033[1m'; NC='\033[0m'

ISSUER="http://localhost:3002"
VERIFIER="http://localhost:3004"

EXCHANGE_ID="${1:-}"

echo -e "${BLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BLD}│   Interactive Wallet — Revocation    │${NC}"
echo -e "${BLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── 1. Revoke credential ──────────────────────────────────────────────────────
echo -e "${CYN}[1/3] Widerrufe Credential beim Issuer…${NC}"

if [ -n "$EXCHANGE_ID" ]; then
  BODY="{\"credentialExchangeId\": \"$EXCHANGE_ID\"}"
  echo -e "  Exchange-ID: ${BLD}$EXCHANGE_ID${NC}"
else
  BODY="{}"
  echo -e "  (letztes ausgestelltes Credential wird widerrufen)"
fi

REVOKE_RESP=$(curl -sf -X POST "$ISSUER/revoke" \
  -H "Content-Type: application/json" \
  -d "$BODY" 2>/dev/null || echo '{"error":"Issuer nicht erreichbar"}')

if echo "$REVOKE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  REVOKED_IDX=$(echo "$REVOKE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('revokedIndex','?'))" 2>/dev/null)
  REV_REG=$(echo "$REVOKE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('revocationRegistryId','?'))" 2>/dev/null)
  echo -e "  ${GRN}✓ Widerrufen!${NC} Index ${BLD}$REVOKED_IDX${NC} in Registry:"
  echo -e "    ${BLD}$REV_REG${NC}"
else
  ERR=$(echo "$REVOKE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','Unbekannter Fehler'))" 2>/dev/null || echo "$REVOKE_RESP")
  echo -e "  ${RED}✗ Fehler: $ERR${NC}"
  exit 1
fi
echo ""

# ── 2. Show credential exchange info ─────────────────────────────────────────
echo -e "${CYN}[2/3] Warte 2 Sekunden (REVOC_REG_ENTRY muss auf Ledger propagiert sein)…${NC}"
sleep 2
echo ""

# ── 3. Re-verify to show proof fails ─────────────────────────────────────────
echo -e "${CYN}[3/3] Proof-Anfrage an bestehende Verifier-Connection senden…${NC}"
CONN=$(curl -sf "$VERIFIER/connections" 2>/dev/null \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
done = sorted([c for c in d if c.get('state') == 'completed'], key=lambda x: x['createdAt'], reverse=True)
print(done[0]['id'] if done else '')
" 2>/dev/null || echo "")

if [ -z "$CONN" ]; then
  echo -e "  ${YLW}⚠ Keine Verifier-Connection gefunden.${NC}"
  echo -e "  ${YLW}  Führe erst ${BLD}./scripts/verify.sh${NC}${YLW} aus, dann revoke erneut.${NC}"
  echo ""
  echo -e "${GRN}${BLD}✓ Credential widerrufen.${NC}"
  echo -e "  Nächster Schritt: ${BLD}./scripts/reverify.sh${NC} um zu zeigen, dass der Proof fehlschlägt."
  exit 0
fi

PROOF_RESP=$(curl -sf -X POST "$VERIFIER/request-proof" \
  -H "Content-Type: application/json" \
  -d "{\"connectionId\": \"$CONN\"}" 2>/dev/null || echo '{"error":"Verifier nicht erreichbar"}')

PROOF_ID=$(echo "$PROOF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('proofExchangeId',''))" 2>/dev/null || echo "")

if [ -z "$PROOF_ID" ]; then
  echo -e "  ${RED}✗ Proof-Anfrage fehlgeschlagen${NC}"
  exit 1
fi

echo -e "  ${GRN}✓${NC} Proof-Anfrage gesendet"
echo ""

echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 AKTION: Wallet-UI → Inbox → Proof teilen             │${NC}"
echo -e "${YLW}│     (Der Proof sollte FEHLSCHLAGEN — Credential widerrufen)│${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}Warte auf Proof-Ergebnis…${NC}"
for i in $(seq 1 90); do
  RESULT=$(curl -sf "$VERIFIER/proofs/$PROOF_ID" 2>/dev/null || echo '{"state":"error"}')
  STATE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state','?'))" 2>/dev/null || echo "?")

  if [ "$STATE" = "done" ]; then
    IS_VER=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('isVerified','null'))" 2>/dev/null)
    echo ""
    if [ "$IS_VER" = "True" ]; then
      echo -e "  ${YLW}⚠ isVerified: true — Credential scheint noch nicht widerrufen zu sein!${NC}"
      echo -e "  ${YLW}  Mögliche Ursache: Wallet hat Proof VOR der Revokation generiert.${NC}"
    else
      echo -e "  ${RED}${BLD}✗ isVerified: false — Credential ist widerrufen!${NC}"
    fi
    break
  fi

  if [ "$STATE" = "abandoned" ]; then
    echo ""
    echo -e "  ${RED}${BLD}✗ Proof abandoned — Credential ist widerrufen!${NC}"
    break
  fi

  printf "\r  … Proof-Status: %-25s (${i}s)" "$STATE"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${YLW}⚠ Timeout — hast du 'Teilen' geklickt?${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Revocation-Demo abgeschlossen.${NC}"
echo -e "  Der [OBSERVER]-Output im Issuer-/Verifier-Terminal zeigt den Ledger-Write."