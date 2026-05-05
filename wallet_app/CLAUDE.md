# DIDComm Interactive Wallet — Flutter App

## Project Context
University project at TU Berlin (Internet of Services Lab 2026).
Real-time DIDComm v2 communication dashboard and identity wallet.
3 teams: Backend, Affinidi, and Frontend (us).

## What this app does
- Visualizes DIDComm v2 message flows in real-time
- Accept/reject credential offers, proof requests, connection invites
- Wallet with Verifiable Credentials (VCs)
- DID connections and audit log
- WebSocket for live updates (mock data for now)

## Design Requirements
- PREMIUM dark theme like Coinbase or Ledger Live
- Deep navy backgrounds (#0A0E1A)
- Cyan accent (#00D4FF), Green success (#00FF94), Red error (#FF4D6D), Yellow pending (#FFD60A)
- Clean cards with subtle borders and gradients
- Rounded corners, professional typography
- Monospace font for DIDs and technical data

## Screens
1. Dashboard — DID identity card, stats, pending actions, activity feed
2. Inbox — DIDComm messages with filter chips, type/sender/status
3. Notification Sheet — bottom sheet with Accept/Reject buttons
4. Wallet — Verifiable Credentials with claims and status
5. Connections — DID connections active/inactive
6. Audit Log — timeline with hash-chain indicator
7. Profile — own DID, statistics

## Message Types
- credentialOffer → green
- proofRequest → yellow
- connectionInvite → cyan
- trustPing → purple
- problemReport → red

## Models
- DIDMessage: id, senderDid, type, timestamp, status, payload, signatureVerified
- Credential: id, issuerDid, type, claims, issuedAt, expiresAt, status
- DIDConnection: id, theirDid, label, connectedAt, isActive
- AuditEvent: id, description, timestamp, did, type, verified

## Stack
- Flutter web + mobile
- package:timeago for timestamps
- Mock data only for now