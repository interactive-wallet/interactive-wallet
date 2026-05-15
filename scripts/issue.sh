#!/bin/bash

CONNECTION_ID=$(curl -s http://localhost:3002/connections | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

echo "Using connection: $CONNECTION_ID"

curl -s -X POST http://localhost:3002/issue \
  -H "Content-Type: application/json" \
  -d "{
    \"connectionId\": \"$CONNECTION_ID\",
    \"vorname\": \"Max\",
    \"nachname\": \"Mustermann\",
    \"geburtsdatum\": \"1990-01-15\",
    \"fuehrerscheinklasse\": \"B\",
    \"ausstellungsdatum\": \"2024-03-01\"
  }"
