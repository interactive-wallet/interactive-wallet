# Interactive Wallet

Internet of Services Lab 2026 — Self-Sovereign Identity (SSI) Demo mit drei Akteuren:

- **Issuer** (Port 3002/3003) — registriert sich als `did:indy` auf dem Ledger, stellt Credentials aus (hier: Führerschein)
- **Verifier** (Port 3004/3005) — registriert sich als `did:indy` auf dem Ledger, prüft Credentials
- **Holder / Wallet** (Port 3000/3001) — bleibt bewusst anonym (Peer-DIDs pro Verbindung, kein Ledger-Eintrag)

Jeder Akteur läuft als eigener Credo-TS-Agent mit zwei Ports: einem Admin-Port (REST + SSE für die UI/Scripts) und einem DIDComm-Port (für die Kommunikation zwischen Agents).

## Architektur

```
Flutter App ──┐                     Browser ──┐
              │ REST + SSE                    │ REST + SSE
              ▼                               ▼
       wallet-agent :3000  ◄── DIDComm ──► issuer-agent  :3002
              │                              │
              │                              ▼
              └────── DIDComm ────► verifier-agent :3004
                                             │
                              ┌──────────────┤
                              ▼              ▼
                         VON Network (Hyperledger Indy, :9000)
                         NYMs · Schemas · CredDefs
```

- **Wallet** speichert in Askar (verschlüsselte SQLite) — Keys, Credentials, Link Secret. Frontends sind nur Anzeige.
- **Issuer + Verifier** schreiben ihre `did:indy` auf das VON-Network. Schemas + CredDefs nur Issuer-seitig.
- **Holder** schreibt nichts auf den Ledger (Privacy by Design — sonst Korrelation über Sessions hinweg).
- **DIDComm-Verbindungen** sind asymmetrisch: Institution mit Public DID, Holder mit Peer-DID.

Credentials werden als **AnonCreds ZKP** ausgestellt — der Verifier sieht nur die angefragten Attribute, kryptografisch verifizierbar ohne Rückfrage beim Issuer.

## Ersteinrichtung

Nach dem Klonen einmalig ausführen:

```bash
# Submodules laden (von-network)
git submodule init
git submodule update

# Dependencies installieren
cd wallet-agent   && pnpm install && cd ..
cd issuer-agent   && pnpm install && cd ..
cd verifier-agent && pnpm install && cd ..

# Flutter-Pakete
cd wallet_app && flutter pub get && cd ..

# VON Network bauen (Indy Ledger, einmalig)
cd von-network && ./manage build && cd ..
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

# 2. Agents — je ein Terminal
cd wallet-agent   && pnpm start
cd issuer-agent   && pnpm start
cd verifier-agent && pnpm start

# 3. Flutter Wallet App
cd wallet_app
flutter run -d linux
```

Es gibt **zwei austauschbare Frontends** auf demselben wallet-agent:

- **Flutter App** — primäre UI mit Ledger-Identitätsanzeige, läuft nativ unter Linux
- **HTML Referenz-UI** unter <http://localhost:3000> — direkt vom wallet-agent ausgeliefert, kein Flutter nötig, gleicher State

## Demo-Flow

### 1. `setup.sh` — Erstmalige Einrichtung (einmalig pro VON-Instanz)

Registriert Issuer **und** Verifier auf dem Ledger und stellt das erste Credential aus.

```bash
./scripts/setup.sh
```

**Was passiert:**

1. Issuer registriert DID + Schema + CredDef auf dem Ledger
2. Verifier registriert seine `did:indy` auf dem Ledger
3. Script gibt eine OOB-URL aus und kopiert sie in die Zwischenablage → in der App unter **Network → 🔗** einfügen
4. Im Connect-Dialog zeigt die Wallet **VERIFIED IDENTITY** — die DID wurde vom Ledger aufgelöst
5. Script sendet ein Führerschein-Angebot, Wallet zeigt es in der **Inbox** → **Accept**

### 2. `verify.sh` — Verifikation

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
./scripts/reverify.sh fuehrerscheinklasse         # nur eine Klasse — Selective Disclosure Demo
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

1. **Connect-Dialog (vor Verbindung)** — dekodiert die OOB und zeigt ob die Gegenseite eine Ledger-DID enthält
2. **Connection-Liste (nach Verbindung)** — kleines ✓-Icon neben dem Label, sobald `theirDid` ein `did:indy` ist

Das Badge bedeutet: *"Diese Identität existiert auf einem Indy-Ledger und der DIDComm-Handshake hat gegen den dort registrierten Schlüssel funktioniert."* Eine Trust-Registry-Schicht (TAO/TI-Akkreditierung wie bei EBSI) ist nicht implementiert — siehe `planned.md` für die Roadmap.

## Stoppen / Zurücksetzen

```bash
# Nur stoppen — Ledger-Daten und Wallet-State bleiben
cd von-network && ./manage stop

# Komplett zurücksetzen (Ledger + alle Wallets)
./scripts/reset.sh
# danach Agents neustarten und ./scripts/setup.sh
```

## Wichtige Konfiguration

Defaults (alle überschreibbar per Environment-Variable):

| Variable | Default | Wo |
|---|---|---|
| `INDY_NAMESPACE` | `local:test` | alle Agents |
| `VON_NETWORK_URL` | `http://localhost:9000` | Issuer + Verifier |
| `ISSUER_SEED` | `00000000000000InteractiveIssuer1` (32 Bytes) | Issuer |
| `VERIFIER_SEED` | `0000000000000InteractiveVerifier` (32 Bytes) | Verifier |
| `WALLET_BASE` | `http://localhost:3000` | Flutter (`--dart-define`) |

## Repository-Layout

```
wallet-agent/        Credo-TS Holder-Agent + REST/SSE + HTML-Referenz-UI
issuer-agent/        Credo-TS Issuer-Agent + Setup-Logik + DID-Registrierung
verifier-agent/      Credo-TS Verifier-Agent + Setup-Logik + DID-Registrierung
wallet_app/          Flutter-Desktop-App (Linux)
scripts/             Bash-Helper für Setup, Issue, Verify, Reissue, Reverify, Reset
von-network/         Submodule: Hyperledger Indy Test-Ledger
documentation/       Slides, Skizzen, Whiteboard-Exporte
planned.md           Roadmap für Phase 3 (Trust Registry, etc.)
```
