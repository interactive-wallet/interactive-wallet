#!/bin/bash

INVITATION_URL=$(curl -s http://localhost:3002/invitation | python3 -c "import sys,json; print(json.load(sys.stdin)['invitationUrl'])")

echo "Invitation URL: $INVITATION_URL"

RESULT=$(curl -s -X POST http://localhost:3000/receive-invitation \
  -H "Content-Type: application/json" \
  -d "{\"invitationUrl\": \"$INVITATION_URL\"}")

echo "Result: $RESULT"
