# Artifact Appendix

Paper title: **Transparent SSI Wallet**

## Description
This artifact is part of the masters project "Transparent SSI Wallet" done in the "Internet of Services Lab" 2026.

Most identity wallets just ask the user to tap a button — without really telling them what is about to happen or what just did. This project takes a different approach: the wallet should show its work. The user can see what is being asked of them before they agree, what is happening behind the scenes while it happens, and what was done after it is over.

To achieve this, we built a wallet agent on top of DIDComm and AnonCreds, connected to a local VON Indy ledger. A ledger watcher subscribes to ledger events and republishes them as push notifications through a hierarchical message broker, so only the wallets that care about a specific DID actually get notified. The wallet UI surfaces two transparency channels: an on-request view that explains what is about to happen before a decision, and a behind-the-scenes live log that records every cryptographic operation in a hash-chained audit trail.

### Security/Privacy Issues and Ethical Concerns

This is a proof of concept. It is not hardened for production use and should not be used with real personal data during evaluation.

## Basic Requirements

### Hardware Requirements

Can run on a normal laptop. Keep in mind that VON Network and every agent run as Docker containers, so a very weak machine might struggle.

<!-- TODO: add specs of the machine we tested on for the "Reproduced" badge -->

### Software Requirements

1. **OS:** We tested on Arch Linux (kernel 7.0.12) and Ubuntu 24.04; other modern Linux distributions should work too. macOS is also supported (`scripts/start.sh` detects the OS and builds the Flutter app accordingly). Windows is not supported because of how VON Network and the DIDComm agents work.
2. **OS packages (only needed for the Flutter UI):** Linux: `clang`, `cmake`, `ninja`, `pkg-config`, GTK 3 headers, Mesa. macOS: Xcode command line tools.
   - Ubuntu: `sudo apt install clang cmake ninja-build pkg-config libgtk-3-dev libstdc++-12-dev`
   - Arch: `sudo pacman -S --needed clang cmake ninja pkgconf gtk3 mesa`
   - macOS: `xcode-select --install`
3. **Docker + Docker Compose (v2 plugin):** 29.6.0 — every agent (mediator, wallet, verifier, issuer), docs-hub, RabbitMQ and VON Network run as containers. No Node.js/pnpm needed on the host — dependency installs happen inside the Docker builds.
4. **Python 3** and **curl** — used by `scripts/*.sh` (setup/issue/verify/reissue/reverify/revoke) to parse JSON responses and drive the agents' REST APIs.
5. No ML models needed.
6. No datasets needed.
7. **Flutter (optional):** The wallet also has an HTML reference UI, so Flutter is not strictly required. If you want the Flutter app, you need Flutter 3.x with `flutter config --enable-linux-desktop` (Linux) or `flutter config --enable-macos-desktop` (macOS).

### Estimated Time and Storage Consumption

- **First-time setup:** about 10 minutes of your time, ~5 minutes for the VON Network Docker build (one-time).
- **Per run:** ~5 minutes to get everything started and run through the demo.
- **Disk space:** ~2GB for Docker images (dependency installs happen inside the builds, nothing extra on the host).

## Environment

### Set up the environment

> The `README.md` has a more detailed guide with troubleshooting tips and OS-specific instructions.

```bash
git clone git@github.com:interactive-wallet/interactive-wallet.git
cd interactive-wallet

# Load submodules
git submodule init && git submodule update

# Build VON Network — only needed once, takes ~5 minutes
cd von-network && ./manage build && cd ..

# Build agent images (mediator, wallet, verifier, issuer all live in
# mediator/, wallet-agent/, issuer-agent/ — the verifier is a role of the
# wallet-agent image, not a separate service)
docker compose build mediator && docker compose build

# Set up environment variables
cp .env.example .env
```

Start everything with one command:

```bash
./scripts/start.sh
```

This brings up VON Network, all agents via Docker Compose, and the Flutter app.
Equivalent step by step, if you want the pieces separately:

```bash
cd von-network && ./manage start              # Indy Ledger
docker compose up -d                          # Mediator, Wallet, Verifier, Issuer, docs-hub, RabbitMQ
```

### Testing the Environment

Check that all agents are running:

```bash
curl http://localhost:3002/health   # Issuer
curl http://localhost:3004/health   # Verifier
curl http://localhost:3000/health   # Wallet
curl http://localhost:3006/health   # Mediator
```

All should return `{"status":"ok"}`. Then run:

```bash
./scripts/setup.sh
```

If it completes all 5 steps and a Führerschein credential shows up in the wallet at `http://localhost:3000`, everything is working.

## Artifact Evaluation

### Main Results and Claims

#### Main Result 1: A Wallet That Shows Its Work

The wallet gives the user visibility into what is happening at every step — before, during, and after a credential interaction. Before agreeing to share a credential, the user sees who is asking, what attributes they want, and what they will be used for. During and after the flow, a live behind-the-scenes log records every cryptographic operation in plain language, hash-chained for tamper-evidence. Credential lifecycle events (issuance, verification, revocation) are pushed to the wallet via a hierarchical broker so the user does not have to check manually.

#### Main Result 2: Privacy-Preserving Verification with ZKP

Verification uses AnonCreds zero-knowledge proofs. The verifier only sees what was actually requested (selective disclosure), and the issuer is never involved in the verification step.

<!-- TODO: add references to specific sections/figures in the paper once it is finalized -->

### Experiments

#### Experiment 1: Credential Issuance and Notification
- Time: ~5 human-minutes + ~1 compute-minute

```bash
./scripts/setup.sh
```

The script sets up a connection between wallet and issuer, sends a Führerschein credential offer, and waits for the holder to accept it in the UI at `http://localhost:3000`. Once accepted, the holder gets notified. Supports [Main Result 1](#main-result-1-a-wallet-that-shows-its-work).

#### Experiment 2: Verification with Selective Disclosure
- Time: ~3 human-minutes + ~1 compute-minute

```bash
./scripts/verify.sh
```

The verifier requests specific attributes (e.g. `fuehrerscheinklasse`) and gets back `isVerified: true`. The issuer is not contacted at any point. Supports [Main Result 2](#main-result-2-privacy-preserving-verification-with-zkp).

#### Experiment 3: Revocation and Notification
- Time: ~2 human-minutes + ~1 compute-minute

```bash
./scripts/revoke.sh
```

The credential is revoked on the ledger and a revocation event is pushed to RabbitMQ. The verifier gets notified automatically. Supports [Main Result 1](#main-result-1-a-wallet-that-shows-its-work).

<!-- TODO: add notification latency numbers once we have measured them -->

## Limitations

The whole notification system goes through a central RabbitMQ broker. That means you have to trust whoever runs it — which is a problem for a system that is supposed to give users control over their own data. This is a known trade-off in this prototype and not something we solved here.

We also only tested with a small number of credentials. The revocation registry is hardcoded to a maximum of 100. How the system behaves under real load is unknown.

## Notes on Reusability

The main idea of this artifact — that parties can be notified about credential events without polling — can be used as a starting point for other SSI projects. A few things that could be built on top:

- **Better privacy for notifications:** Right now RabbitMQ sees everything. A next step would be to replace it with something decentralized, like DIDComm-based push messages directly between agents, or at least encrypt the event payloads.
- **Other credential types:** Swapping out the Führerschein for a different credential only requires changing the schema in the issuer agent — the rest of the system stays the same.
- **Mobile:** The wallet agent runs on Credo-TS, which also has a React Native wrapper. So moving to a real mobile app would not require rewriting the backend.
- **Scaling:** The 100-credential limit and RabbitMQ throughput are the two main bottlenecks. Both can be improved without touching the overall architecture.
