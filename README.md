# Interactive Wallet

Internet of Services Lab 2026

Dieses Projekt demonstriert einen Self-Sovereign Identity (SSI) Flow mit drei Akteuren:

- **Issuer** (Port 3002/3003) — stellt Credentials aus (hier: Führerschein)
- **Holder / Wallet** (Port 3000/3001) — empfängt und speichert Credentials
- **Verifier** (Port 3004/3005) — prüft ob der Holder ein gültiges Credential besitzt

Jeder Akteur läuft als eigener Agent mit zwei Ports: einem Admin-Port (für Scripts/UI) und einem DIDComm-Port (für die Kommunikation zwischen Agents).

Dieses Projekt demonstriert einen Self-Sovereign Identity (SSI) Flow mit drei Akteuren:

- **Issuer** (Port 3002/3003) — stellt Credentials aus (hier: Führerschein)
- **Holder / Wallet** (Port 3000/3001) — empfängt und speichert Credentials, UI unter `http://localhost:3000`
- **Verifier** (Port 3004/3005) — prüft ob der Holder ein gültiges Credential besitzt

Jeder Akteur läuft als eigener Agent mit zwei Ports: einem Admin-Port (für Scripts/UI) und einem DIDComm-Port (für die Kommunikation zwischen Agents).

## Ersteinrichtung

Nach dem Klonen, einmalig ausführen:

```bash
# Submodules laden
git submodule init
git submodule update

# Dependencies installieren (in jedem Agent-Verzeichnis)
cd wallet-agent && pnpm install && cd ..
cd issuer-agent && pnpm install && cd ..
cd verifier-agent && pnpm install && cd ..

# VON Network bauen (Indy Ledger, einmalig)
cd von-network && ./manage build
```

## Starten

```bash
# 1. VON Network starten
cd von-network && ./manage start

# 2. Agents starten — je ein Terminal, build ist bereits integriert
cd wallet-agent && pnpm start
cd issuer-agent && pnpm start
cd verifier-agent && pnpm start
```

Die Wallet-UI ist erreichbar unter: **http://localhost:3000**

## Stoppen

```bash
# Nur stoppen — Ledger-Daten bleiben erhalten
cd von-network && ./manage stop

# Komplett zurücksetzen (löscht alle Ledger-Daten)
cd von-network && ./manage down
```

> **Wichtig:** `stop` + `start` behält alle registrierten DIDs, Schemas und CredDefs.  
> Nach `down` muss `setup.sh` erneut ausgeführt werden.

## Demo-Flow

### 1. `setup.sh` — Erstmalige Einrichtung (einmalig pro VON-Instanz)

Registriert den Issuer auf dem Ledger und stellt das erste Credential aus.

**Was passiert:**
1. Issuer registriert DID, Schema und Credential Definition auf dem Ledger
2. Skript gibt eine **Einladungs-URL** aus → in der Wallet-UI unter "Verbinden" einfügen → Verbindung bestätigen
3. Issuer sendet ein Führerschein-Angebot
4. In der Wallet-UI: **Credential-Angebote → Annehmen**

```bash
./scripts/setup.sh
```

### 2. `verify.sh` — Verifikation

Setzt voraus, dass der Holder einen Führerschein in der Wallet hat.

**Was passiert:**
1. Skript gibt eine **Verifier-Einladungs-URL** aus → in der Wallet-UI einfügen → Verbindung bestätigen
2. Verifier sendet eine Proof-Anfrage
3. In der Wallet-UI: **Proof-Anfragen → Teilen**
4. Skript zeigt das Ergebnis: `isVerified: true/false`

```bash
./scripts/verify.sh
```

### 3. `issue.sh` — Weiteres Credential ausstellen

Stellt ein weiteres Credential aus (neue Verbindung, kein erneuter Setup nötig). Unterstützt optionale Parameter.

```bash
./scripts/issue.sh
# oder mit eigenen Werten:
./scripts/issue.sh "Anna" "Schmidt" "1985-06-20" "A" "2023-01-10"
```

## Architektur

```
Wallet-UI (Browser)
      │ REST
      ▼
wallet-agent :3000 ◄──── DIDComm ────► issuer-agent :3002
      │                                      │
      │                                      ▼
      └──────── DIDComm ──────► verifier-agent :3004
                                             │
                              ┌──────────────┤
                              ▼              ▼
                         VON Network (Hyperledger Indy, :9000)
                         DIDs · Schemas · CredDefs
```

Credentials werden als **AnonCreds ZKP** ausgestellt — der Verifier sieht nur die angefragten Attribute, kryptographisch verifizierbar ohne Rückfrage beim Issuer.
