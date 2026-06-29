# Interactive Wallet

Internet of Services Lab 2026: Self-Sovereign Identity (SSI) Demo mit vier Akteuren:

- **Mediator** (Port 3006/3007/3008): DIDComm-Mediator; routet Nachrichten an die Wallet, die keinen öffentlichen Endpoint hat (mobile Architektur)
- **Issuer** (Port 3002/3003): registriert sich als `did:indy` auf dem Ledger, stellt Credentials aus (hier: Führerschein)
- **Verifier** (Port 3004/3005): registriert sich als `did:indy` auf dem Ledger, prüft Credentials
- **Holder / Wallet** (Port 3000): bleibt bewusst anonym (Peer-DIDs pro Verbindung, kein Ledger-Eintrag); verbindet sich beim Start automatisch mit dem Mediator

Issuer und Verifier haben je zwei Ports: einen Admin-Port (REST für die Scripts) und einen DIDComm-Port. Der Mediator hat drei: REST-API (3006), HTTP-DIDComm (3007) und WebSocket-DIDComm (3008).

## Architektur

Die Wallet hat keinen öffentlichen DIDComm-Endpoint (mobile Architektur). Alle eingehenden Nachrichten (Connection Responses, Credential Offers, Proof Requests) werden vom Mediator zwischengespeichert. Der Mediator benachrichtigt das Wallet, welchest die Nachrichten per PickUpV2-Protokoll abholt.

- **Wallet** speichert in Askar (verschlüsselte SQLite) Keys, Credentials, Link Secret. Frontends sind nur Anzeige.
- **Issuer + Verifier** schreiben ihre `did:indy` auf das VON-Network. Schemas + CredDefs nur Issuer-seitig.
- **Holder** schreibt nichts auf den Ledger (Privacy by Design, sonst Korrelation über Sessions hinweg).
- **DIDComm-Verbindungen** sind asymmetrisch: Institution mit Public DID, Holder mit Peer-DID.

Credentials werden als **AnonCreds ZKP** ausgestellt. Der Verifier sieht nur die angefragten Attribute, kryptografisch verifizierbar ohne Rückfrage beim Issuer.

## Ersteinrichtung

Nach dem Klonen einmalig ausführen:

```bash
# Submodules laden (von-network)
git submodule init
git submodule update

# VON Network bauen (Indy Ledger, einmalig)
cd von-network && ./manage build && cd ..

# Agents bauen (Issuer, Mediator, Wallet, Verifier)
# zuerst nur ein Service, um Dependencies zu cachen, dann alle anderen Services
docker compose build mediator && docker compose build

# Flutter-Pakete
cd wallet_app && flutter pub get && cd ..
```

Für die Flutter-App unter Linux werden zusätzlich Build-Tools benötigt. Installiere `clang`, `cmake`, `ninja`, `pkg-config`, GTK 3 Headers und Mesa über deinen Paketmanager. Beispiele:

```bash
# Ubuntu
sudo apt install clang cmake ninja-build pkg-config libgtk-3-dev libstdc++-12-dev

# Arch
sudo pacman -S --needed clang cmake ninja pkgconf gtk3 mesa
```

Dann einmalig:

```bash
flutter config --enable-linux-desktop
```

## Starten

```bash
# 1. VON Network
cd von-network && ./manage start

# 2. Agents
docker compose up

# 3. Flutter Wallet App
cd wallet_app
flutter run -d linux
```

Es gibt **zwei austauschbare Frontends** auf demselben wallet-agent:

- **Flutter App**: primäre UI mit Ledger-Identitätsanzeige, läuft nativ unter Linux
- **HTML Referenz-UI** unter <http://localhost:3000>, direkt vom wallet-agent ausgeliefert, kein Flutter nötig, gleicher State

## Demo-Flow

### 1. `setup.sh`: Erstmalige Einrichtung (einmalig pro VON-Instanz)

Registriert Issuer **und** Verifier auf dem Ledger und stellt das erste Credential aus.

```bash
./scripts/setup.sh
```

**Was passiert:**

1. Issuer registriert DID + Schema + CredDef auf dem Ledger
2. Verifier registriert seine `did:indy` auf dem Ledger
3. Script gibt eine OOB-URL aus und kopiert sie in die Zwischenablage → in der App unter **Network → 🔗** einfügen
4. Im Connect-Dialog zeigt die Wallet **VERIFIED IDENTITY**, die DID wurde vom Ledger aufgelöst
5. Script sendet ein Führerschein-Angebot, Wallet zeigt es in der **Inbox** → **Accept**

### 2. `verify.sh`: Verifikation

Setzt voraus, dass der Holder einen Führerschein hat.

```bash
./scripts/verify.sh
```

**Was passiert:**

1. OOB-URL des Verifiers wird ausgegeben + kopiert → in der App einfügen
2. Auch hier: **VERIFIED IDENTITY** im Preview-Dialog
3. Verifier schickt Proof-Request → in der **Inbox** als gelbe Karte → **Share Proof**
4. Script zeigt `isVerified: true/false` als Ergebnis

### 3. Wiederverwendung bestehender Verbindungen

Ohne erneuten OOB-Handshake:

```bash
./scripts/reissue.sh                              # neues Credential (Defaults)
./scripts/reissue.sh "Anna" "Schmidt" "1985-06-20" "A" "2023-01-10"

./scripts/reverify.sh                             # alle Attribute anfragen
./scripts/reverify.sh fuehrerscheinklasse         # nur eine Klasse. Selective Disclosure Demo
```

### 4. `issue.sh` / `verify.sh` (mit Handshake)

Wie `setup.sh`/`reverify.sh`, aber baut jeweils eine neue Verbindung auf. Praktisch wenn du parallel mehrere Sessions zeigen willst.

```bash
./scripts/issue.sh
./scripts/verify.sh
```

### Browser-Auto-Open

Die Scripts öffnen standardmäßig **keinen** Browser. Für den HTML-Referenz-UI-Test:

```bash
OPEN_BROWSER=1 ./scripts/setup.sh
```

## Verified-Identity-Badge in der Flutter-App

An zwei Stellen sichtbar:

1. **Connect-Dialog (vor Verbindung)**: dekodiert die OOB und zeigt ob die Gegenseite eine Ledger-DID enthält
2. **Connection-Liste (nach Verbindung)**: kleines ✓-Icon neben dem Label, sobald `theirDid` ein `did:indy` ist

Das Badge bedeutet: *"Diese Identität existiert auf einem Indy-Ledger und der DIDComm-Handshake hat gegen den dort registrierten Schlüssel funktioniert."*

## Stoppen / Zurücksetzen

```bash
# Nur stoppen, Ledger-Daten und Wallet-State bleiben
cd von-network && ./manage stop

# Komplett zurücksetzen (Ledger + alle Wallets)
./scripts/reset.sh
# danach Agents neustarten und ./scripts/setup.sh
```

## Repository-Layout

```
mediator/            Credo-TS Mediator-Agent (REST :3006, HTTP-DIDComm :3007, WS :3008)
wallet-agent/        Credo-TS Holder-Agent + REST/SSE + HTML-Referenz-UI; beinhaltet auch Verifier-Agent + DID-Registrierung + Proof-Verifikation
issuer-agent/        Credo-TS Issuer-Agent + DID-Registrierung + Credential-Ausstellung
wallet_app/          Flutter-App (Desktop/Android)
scripts/             Bash-Helper für Setup, Issue, Verify, Reissue, Reverify, Reset
von-network/         Submodule: Hyperledger Indy Test-Ledger
documentation/       Slides, Skizzen, Whiteboard-Exporte
```
