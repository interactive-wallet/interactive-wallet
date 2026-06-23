#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting RabbitMQ..."
cd "$ROOT" && docker compose up -d

konsole --new-tab -e bash -c "cd '$ROOT/von-network' && ./manage start; bash" &
sleep 1
konsole --new-tab -e bash -c "cd '$ROOT/mediator' && pnpm start; bash" &
konsole --new-tab -e bash -c "cd '$ROOT/issuer-agent' && pnpm start; bash" &
konsole --new-tab -e bash -c "cd '$ROOT/verifier-agent' && pnpm start; bash" &
konsole --new-tab -e bash -c "cd '$ROOT/wallet-agent' && pnpm start; bash" &

echo "All services starting in separate Konsole windows."
