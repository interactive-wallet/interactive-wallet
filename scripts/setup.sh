#!/bin/bash
# Setup: register issuer DID + issue credential
# Requires: all agents running (mediator, issuer, verifier, wallet), VON Network running
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

# ── 1. Wait for issuer ────────────────────────────────────────────────────
echo -e "${CYN}[1/5] Waiting for issuer agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$ISSUER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … waiting (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Issuer unreachable — is it running?${NC}" && exit 1
done
# State lives inside the container (/app/issuer-state.json), not on the host — read via docker compose exec
CRED_DEF=$( (cd "$ROOT" && docker compose exec -T issuer cat /app/issuer-state.json 2>/dev/null) \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['credDefId'])" 2>/dev/null || echo "")
if [ -z "$CRED_DEF" ]; then
  echo -e "  ${RED}✗ issuer-state.json missing in container — restart the issuer agent${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} CredDef: $CRED_DEF"
echo ""

# ── 2. Wait for verifier ──────────────────────────────────────────────────
echo -e "${CYN}[2/5] Waiting for verifier agent…${NC}"
for i in $(seq 1 30); do
  if curl -sf "$VERIFIER/health" -o /dev/null 2>&1; then break; fi
  printf "\r  … waiting (${i}s)"
  sleep 1
  [ "$i" = "30" ] && echo -e "\n  ${RED}✗ Verifier unreachable — is it running?${NC}" && exit 1
done
# Verifier runs as the wallet-agent image; state lives inside the container at /app/verifier-state.json
V_DID=$( (cd "$ROOT" && docker compose exec -T verifier cat /app/verifier-state.json 2>/dev/null) \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['verifierDid'])" 2>/dev/null || echo "")
if [ -z "$V_DID" ]; then
  echo -e "  ${RED}✗ verifier-state.json missing in container — restart the verifier agent${NC}"; exit 1
fi
echo -e "  ${GRN}✓${NC} Verifier DID: $V_DID"
echo ""

# ── 3. Get invitation & paste into UI ─────────────────────────────────────
echo -e "${CYN}[3/5] Establishing wallet ↔ issuer connection…${NC}"
# Remember the count of already-completed connections — we wait for a NEW one (robust against stale leftovers).
CONN_COUNT_BEFORE=$(curl -sf "$ISSUER/connections" 2>/dev/null \
  | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c.get('state')=='completed']))" 2>/dev/null || echo "0")
INV_URL=$(curl -sf "$ISSUER/invitation" | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo ""
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Open wallet UI → paste URL → Connect         │${NC}"
echo -e "${YLW}│     http://localhost:3000                                │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${BLD}Invitation URL:${NC}"
echo "$INV_URL"
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | pbcopy 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | wl-copy 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xclip -selection clipboard 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$INV_URL" | xsel --clipboard --input 2>/dev/null && echo -e "  ${GRN}✓ Copied to clipboard${NC}"
fi
echo ""
if [ "${OPEN_BROWSER:-0}" = "1" ]; then
  { command -v open >/dev/null 2>&1 && open "http://localhost:3000"; } \
    || xdg-open "http://localhost:3000" 2>/dev/null || true
fi

echo -e "${CYN}Waiting for connection…${NC}"
for i in $(seq 1 90); do
  # Wait for a newly completed connection (count must increase) — ignores stale leftovers.
  COMPLETED=$(curl -sf "$ISSUER/connections" 2>/dev/null \
    | python3 -c "import sys,json; print(len([c for c in json.load(sys.stdin) if c.get('state')=='completed']))" 2>/dev/null || echo "0")
  if [ "$COMPLETED" -gt "$CONN_COUNT_BEFORE" ] 2>/dev/null; then
    echo -e "\r  ${GRN}✓ Connection established${NC}          "; break
  fi
  printf "\r  … waiting (${i}s)"
  sleep 1
  [ "$i" = "90" ] && echo -e "\n  ${RED}✗ Timeout — connection not established${NC}" && exit 1
done
echo ""

# ── 4. Issue credential ───────────────────────────────────────────────────
echo -e "${CYN}[4/5] Sending Führerschein offer…${NC}"
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
  echo -e "  ${RED}✗ Issuer returned no response for /issue — connection dead? Try ./scripts/reset.sh${NC}"; exit 1
fi
# Save the credential mapping so revoke.sh can find it (same as issue.sh).
# Pass the response via argv — NOT via pipe, or stdin would collide with the heredoc program.
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
echo -e "  ${GRN}✓${NC} Offer sent"
echo ""

# ── 5. Wait for the user to accept in the UI ──────────────────────────────
echo -e "${YLW}┌─────────────────────────────────────────────────────────┐${NC}"
echo -e "${YLW}│  👉 ACTION: Wallet UI → 'Credential offers'              │${NC}"
echo -e "${YLW}│     Click Accept                                         │${NC}"
echo -e "${YLW}└─────────────────────────────────────────────────────────┘${NC}"
echo ""

echo -e "${CYN}[5/5] Waiting for acceptance in the UI…${NC}"
for i in $(seq 1 120); do
  COUNT=$(curl -sf "$WALLET/credentials" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$COUNT" != "0" ]; then
    echo -e "\r  ${GRN}✓ Credential stored!${NC}                    "
    break
  fi
  printf "\r  … waiting for UI action (${i}s)"
  sleep 1
  [ "$i" = "120" ] && echo -e "\n  ${YLW}⚠ Timeout — did you click 'Accept'?${NC}" && exit 1
done

echo ""
echo -e "${GRN}${BLD}✓ Setup complete!${NC} Führerschein is in the wallet."
echo -e "  Next step: ${BLD}./scripts/verify.sh${NC}"
