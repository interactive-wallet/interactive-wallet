# Interactive Wallet

Internet of Services Lab 2026

Dieses Projekt demonstriert einen Self-Sovereign Identity (SSI) Flow mit drei Akteuren:

- **Issuer** (Port 3002/3003) — stellt Credentials aus (hier: Führerschein)
- **Holder / Wallet** (Port 3000/3001) — empfängt und speichert Credentials
- **Verifier** (Port 3004/3005) — prüft ob der Holder ein gültiges Credential besitzt

Jeder Akteur läuft als eigener Agent mit zwei Ports: einem Admin-Port (für Scripts/UI) und einem DIDComm-Port (für die Kommunikation zwischen Agents).

## Setup

Nach dem Klonen, einmalig ausführen:
```bash
# Submodules laden
git submodule init
git submodule update
# VON Network bauen (Indy Ledger)
cd von-network && ./manage build
```

## Starten

```bash
# 1. VON Network starten (Indy Ledger)
cd von-network && ./manage start

# 2. Agents starten (je ein Terminal)
cd issuer-agent && pnpm install && pnpm build && pnpm start
cd wallet-agent && pnpm install && pnpm build && pnpm start
cd verifier-agent && pnpm install && pnpm build && pnpm start
```

```bash
# VON Network stoppen
cd von-network && ./manage stop
```

## Scripts

### `setup.sh` — Kompletter Issuing-Flow (einmalig zum Setup)

Führt folgende Schritte automatisch durch:

1. Issuer registriert seinen DID auf dem Ledger und legt Schema + Credential Definition an
2. Issuer erstellt eine OOB Invitation (Link/QR)
3. Wallet empfängt die Invitation und baut eine DIDComm-Verbindung zum Issuer auf
4. Issuer stellt dem Holder einen Führerschein (AnonCreds Credential) aus
5. Wallet empfängt und speichert das Credential

```bash
./scripts/setup.sh
```

### `verify.sh` — Verification-Flow

Setzt voraus, dass `setup.sh` bereits erfolgreich durchgelaufen ist (Holder hat einen Führerschein).

1. Verifier erstellt eine OOB Invitation
2. Wallet empfängt die Invitation und baut eine DIDComm-Verbindung zum Verifier auf
3. Verifier schickt einen Proof Request an den Holder ("zeig mir deinen Führerschein")
4. Wallet antwortet automatisch mit einem kryptografischen Beweis
5. Verifier prüft den Beweis und gibt `isVerified: true/false` zurück

```bash
./scripts/verify.sh
```

### `connect.sh` — Nur Verbindung aufbauen

Baut lediglich eine DIDComm-Verbindung zwischen Wallet und Issuer auf, ohne ein Credential auszustellen. Nützlich zum Testen.

```bash
./scripts/connect.sh
```

### `issue.sh` — Nur Credential ausstellen

Stellt ein Credential über eine bereits bestehende Verbindung aus. Setzt voraus, dass `connect.sh` (oder der Connect-Schritt aus `setup.sh`) bereits ausgeführt wurde.

```bash
./scripts/issue.sh
```
