# Interactive Wallet

Internet of Services Lab 2026: Self-Sovereign Identity (SSI) demo with four actors:

- **Mediator** (port 3006/3007/3008): DIDComm mediator; routes messages to the wallet, which has no public endpoint (mobile architecture)
- **Issuer** (port 3002/3003): registers as `did:indy` on the ledger, issues credentials (here: driving licence)
- **Verifier** (port 3004/3005): registers as `did:indy` on the ledger, verifies credentials
- **Holder / Wallet** (port 3000): stays deliberately anonymous (Peer-DIDs per connection, no ledger entry); connects to the mediator automatically on startup

Issuer and Verifier each have two ports: an admin port (REST for the scripts) and a DIDComm port. The mediator has three: REST API (3006), HTTP DIDComm (3007), and WebSocket DIDComm (3008).

## Architecture

The wallet has no public DIDComm endpoint (mobile architecture). All incoming messages (connection responses, credential offers, proof requests) are queued by the mediator. The mediator notifies the wallet, which picks the messages up via the PickUpV2 protocol.

- **Wallet** stores keys, credentials, and the link secret in Askar (encrypted SQLite). Frontends are display-only.
- **Issuer + Verifier** write their `did:indy` to the VON network. Schemas + CredDefs are issuer-side only.
- **Holder** writes nothing to the ledger (privacy by design, otherwise correlation across sessions would be possible).
- **DIDComm connections** are asymmetric: the institution has a public DID, the holder has a Peer-DID.

Credentials are issued as **AnonCreds ZKPs**. The verifier only sees the requested attributes, cryptographically verifiable without contacting the issuer.

## Prerequisites

All agents (mediator, issuer, verifier, wallet) run as Docker containers — the host
needs **no** Node.js/pnpm, that all happens inside the Docker builds. What must be
installed on the host:

| Tool | What for |
|---|---|
| **Docker** + **Docker Compose** (v2 plugin, `docker compose`, not the old `docker-compose`) | builds/starts all agents, RabbitMQ, docs-hub |
| **Git** | cloning + submodules (`von-network`) |
| **Flutter SDK** | the wallet app |
| **Build toolchain** for Flutter desktop — Linux: `clang`, `cmake`, `ninja`, `pkg-config`, GTK 3 headers, Mesa; macOS: Xcode command line tools | `flutter build linux` / `flutter build macos` |
| **Python 3** | JSON parsing in `scripts/*.sh` (setup/issue/verify/reissue/reverify/revoke) |
| **curl** | REST calls in `scripts/*.sh` |
| *(optional)* Linux: `wl-copy`, `xclip`, or `xsel` | the invitation URL gets copied to the clipboard automatically — without one of these three, just copy it manually from the terminal output. On macOS, the built-in `pbcopy` handles this automatically |

`scripts/start.sh` detects the operating system (`Linux`/`Darwin`) automatically and
builds the Flutter app for the matching target platform.

Installing the build toolchain:

```bash
# Ubuntu
sudo apt install clang cmake ninja-build pkg-config libgtk-3-dev libstdc++-12-dev

# Arch
sudo pacman -S --needed clang cmake ninja pkgconf gtk3 mesa

# macOS
xcode-select --install
```

`scripts/start.sh` checks for Docker, Docker Compose, Flutter, Python 3, and curl
itself on startup, and aborts with a clear error message if anything is missing.

## Initial Setup

Run once after cloning:

```bash
# Load submodules (von-network)
git submodule init
git submodule update

# Build VON Network (Indy ledger, one-time)
cd von-network && ./manage build && cd ..

# Build agents (Issuer, Mediator, Wallet, Verifier)
# build one service first to cache dependencies, then all the others
docker compose build mediator && docker compose build

# Flutter packages
cd wallet_app && flutter pub get && cd ..

# One-time: enable desktop as a Flutter target platform
flutter config --enable-linux-desktop   # Linux
flutter config --enable-macos-desktop   # macOS
```

## Starting

```bash
./scripts/start.sh
```

Starts VON Network, all agents (Docker Compose), and builds + starts the Flutter app
twice (holder window against `wallet-agent` :3000, verifier window against the
verifier role of the `wallet-agent` :3004 — same binary, see `WALLET_BASE` in
`wallet_app/lib/data/api_client.dart`).

Alternatively, step by step, e.g. to start only a single frontend:

```bash
# 1. VON Network
cd von-network && ./manage start

# 2. Agents
docker compose up

# 3. Flutter wallet app
cd wallet_app
flutter run -d linux   # or: flutter run -d macos
```

There are **two interchangeable frontends** against the same wallet-agent:

- **Flutter app**: primary UI with ledger identity display, runs natively on Linux and macOS
- **HTML reference UI** at <http://localhost:3000>, served directly by the wallet-agent, no Flutter needed, same state

## Demo Flow

### 1. `setup.sh`: Initial setup (once per VON instance)

Registers issuer **and** verifier on the ledger and issues the first credential.

```bash
./scripts/setup.sh
```

**What happens:**

1. Issuer registers DID + schema + CredDef on the ledger
2. Verifier registers its `did:indy` on the ledger
3. The script prints an OOB URL and copies it to the clipboard → paste it into the app under **Network → 🔗**
4. In the connect dialog, the wallet shows **VERIFIED IDENTITY** — the DID was resolved from the ledger
5. The script sends a driving-licence offer, the wallet shows it in the **Inbox** → **Accept**

### 2. `verify.sh`: Verification

Requires the holder to already have a driving licence.

```bash
./scripts/verify.sh
```

**What happens:**

1. The verifier's OOB URL is printed and copied → paste it into the app
2. Again: **VERIFIED IDENTITY** in the preview dialog
3. The verifier sends a proof request → shown as a yellow card in the **Inbox** → **Share Proof**
4. The script prints `isVerified: true/false` as the result

### 3. Reusing existing connections

Without a new OOB handshake:

```bash
./scripts/reissue.sh                              # new credential (defaults)
./scripts/reissue.sh "Anna" "Schmidt" "1985-06-20" "A" "2023-01-10"

./scripts/reverify.sh                             # request all attributes
./scripts/reverify.sh fuehrerscheinklasse         # only one class. Selective disclosure demo
```

### 4. `issue.sh` / `verify.sh` (with handshake)

Like `setup.sh`/`reverify.sh`, but each builds a fresh connection. Useful if you want to show several sessions in parallel.

```bash
./scripts/issue.sh
./scripts/verify.sh
```

### Auto-opening the browser

By default, the scripts do **not** open a browser. To test the HTML reference UI:

```bash
OPEN_BROWSER=1 ./scripts/setup.sh
```

## Verified-identity badge in the Flutter app

Visible in two places:

1. **Connect dialog (before connecting)**: decodes the OOB and shows whether the other party's invitation contains a ledger DID
2. **Connection list (after connecting)**: small ✓ icon next to the label, as soon as `theirDid` is a `did:indy`

The badge means: *"This identity exists on an Indy ledger, and the DIDComm handshake succeeded against the key registered there."*

## Stopping / Resetting

```bash
# Just stop, ledger data and wallet state stay
cd von-network && ./manage stop

# Full reset (ledger + all wallets)
./scripts/reset.sh
# then restart the agents and run ./scripts/setup.sh
```

## Repository Layout

```
mediator/            Credo-TS mediator agent (REST :3006, HTTP DIDComm :3007, WS :3008)
wallet-agent/        Credo-TS holder agent + REST/SSE + HTML reference UI; also contains the verifier agent + DID registration + proof verification
issuer-agent/        Credo-TS issuer agent + DID registration + credential issuance
wallet_app/          Flutter app (desktop/Android)
scripts/             Bash helpers for setup, issue, verify, reissue, reverify, reset
von-network/         Submodule: Hyperledger Indy test ledger
documentation/       Slides, sketches, whiteboard exports
```
