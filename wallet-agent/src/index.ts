import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import cors from "cors";
import "dotenv/config";
import express, { type Response } from "express";
import path from "path";
import { AGENT_ROLE, EFFECTIVE_WALLET_API_PORT, MEDIATOR_API_URL, WALLET_DOMAIN } from "./config.js";
import { initializeHolderConsumer } from "./holder-consumer.js";
import { mountSwagger } from "./swagger.js";
import { registerWalletRoutes } from "./wallet-routes.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const {
  DidCommConnectionEventTypes,
  DidCommCredentialEventTypes,
  DidCommProofEventTypes,
  DidCommHandshakeProtocol,
} = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");
const { setUpVerifier } = await import("./verifier.js");

const agent = createAgent();
await agent.initialize();
console.log("Wallet Agent initialized");

const linkSecretIds = await agent.modules.anoncreds.getLinkSecretIds();
if (linkSecretIds.length === 0) {
  await agent.modules.anoncreds.createLinkSecret({ setAsDefault: true });
  console.log("[wallet-agent] Created default link secret");
}

// The mediator's REST API may not be up yet when the wallet boots (compose starts
// both in parallel, and the mediator first has to register its DID on the ledger).
// Retry instead of giving up after one attempt so the start order no longer matters.
async function fetchMediatorInvitation(
  url: string,
  attempts = 30,
  delayMs = 2000,
): Promise<{ invitationUrl: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return (await response.json()) as { invitationUrl: string };
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    console.log(
      `[wallet-agent] Mediator not ready at ${url} ` +
        `(attempt ${attempt}/${attempts}), retrying in ${delayMs}ms...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Mediator invitation could not be fetched after ${attempts} attempts: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

// Auto-connect to mediator on startup so all subsequent connections use mediator routing.
// The mediator is required because the wallet has no public endpoint (mobile architecture).
async function setupMediator() {
  try {
    const existing = await agent.modules.mediationRecipient.findDefaultMediator();
    if (existing) {
      console.log("[wallet-agent] Default mediator already set, reconnecting...");
      await agent.modules.mediationRecipient.initiateMessagePickup(existing);
      return;
    }

    console.log(`[wallet-agent] Fetching mediator invitation from ${MEDIATOR_API_URL}...`);
    const { invitationUrl } = await fetchMediatorInvitation(`${MEDIATOR_API_URL}/invitation`);

    const { outOfBandRecord, connectionRecord } =
      await agent.modules.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
        label: "Wallet",
        autoAcceptInvitation: true,
        autoAcceptConnection: true,
      });

    if (!connectionRecord) {
      console.warn("[wallet-agent] Mediator connection record not created");
      return;
    }

    // Wait for connection to complete (up to 15s)
    let conn = connectionRecord;
    for (let i = 0; i < 15; i++) {
      if (conn.state === "completed") break;
      await new Promise((r) => setTimeout(r, 1000));
      conn = await agent.modules.didcomm.connections.getById(connectionRecord.id);
    }
    if (conn.state !== "completed") {
      console.warn("[wallet-agent] Mediator connection did not complete in time");
      return;
    }

    const mediationRecord = await agent.modules.mediationRecipient.requestAndAwaitGrant(conn);
    await agent.modules.mediationRecipient.setDefaultMediator(mediationRecord);
    console.log("[wallet-agent] Mediator set up successfully");
    // Start active message pickup so the mediator delivers queued messages
    await agent.modules.mediationRecipient.initiateMessagePickup(mediationRecord);
    console.log("[wallet-agent] Message pickup initiated");
  } catch (err) {
    console.warn("[wallet-agent] Mediator setup failed (continuing without):", err instanceof Error ? err.message : err);
  }
}

// SSE client registry
const sseClients = new Set<Response>();

function broadcast(type: string, data: object) {
  const msg = `data: ${JSON.stringify({ type, ...data, ts: new Date().toISOString() })}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// TODO: When running wallet-agent embedded inside Flutter via nodejs_mobile_flutter,
// the process stays alive and the WS outbound transport keeps its connection open.
// In that case, switch back to DidCommMediatorPickupStrategy.Implicit in agent.ts
// and remove this polling loop — the mediator will deliver messages live over the
// persistent WebSocket instead of queuing them for pickup.
//
// PickUpV2: wallet polls mediator every 2s for queued messages.
// Implicit live-delivery doesn't work in standalone Node.js (WS closes after each send).
// (async function pickupLoop() {
//   while (true) {
//     try {
//       const mediator = await agent.modules.mediationRecipient.findDefaultMediator();
//       if (mediator) await agent.modules.mediationRecipient.initiateMessagePickup(mediator);
//     } catch { /* ignore */ }
//     await new Promise((r) => setTimeout(r, 2000));
//   }
// })();

// ─── Event listeners → SSE broadcast ─────────────────────────────────────
agent.events.on(
  DidCommConnectionEventTypes.DidCommConnectionStateChanged,
  ({ payload }: any) => {
    const c = payload.connectionRecord;
    broadcast("connection", {
      state: c.state,
      theirLabel: c.theirLabel ?? "Unknown",
      connectionId: c.id,
    });
  },
);

agent.events.on(
  DidCommCredentialEventTypes.DidCommCredentialStateChanged,
  ({ payload }: any) => {
    const e = payload.credentialExchangeRecord;
    broadcast("credential", {
      state: e.state,
      role: e.role,
      credentialId: e.id,
    });

    // autoAcceptCredentials is Never so the user keeps manual control over the
    // *offer* (accept/decline in the UI). But once that decision is made and
    // the credential itself arrives, there is no second decision left to make —
    // without an explicit acceptCredential() call here the exchange sticks at
    // `credential-received` and never reaches `done`, same class of issue as
    // the verifier's presentation-received case below. The credential is
    // already stored in the wallet at this point; this just sends the ack so
    // the exchange (and the SSE event the UI waits on) completes promptly.
    if (e.role === "holder" && e.state === "credential-received") {
      agent.modules.didcomm.credentials
        .acceptCredential({ credentialExchangeRecordId: e.id })
        .catch((err: unknown) =>
          console.warn(
            "[wallet-agent] Failed to auto-ack received credential:",
            err instanceof Error ? err.message : err,
          ),
        );
    }
  },
);

agent.events.on(
  DidCommProofEventTypes.ProofStateChanged,
  ({ payload }: any) => {
    const p = payload.proofRecord;
    broadcast("proof", {
      state: p.state,
      isVerified: p.isVerified ?? null,
      proofId: p.id,
    });
  },
);

// ─── Holder revocation consumer (HOLDER role only) ───────────────────────
// Mirror of the verifier's consumer, but filtered on wallet membership: only
// revocations of credentials THIS wallet actually holds are surfaced to the
// UI. The verifier has its own validating consumer in verifier.ts that filters
// on "did I verify this?" instead.
async function setupHolderRevocationConsumer(): Promise<void> {
  try {
    await initializeHolderConsumer({
      onCredentialRevoked: async (event) => {
        const credentials = await agent.modules.anoncreds.getCredentials({});
        // The issuer stamps the app-level credential_id as a credential attribute,
        // which is exactly what the revocation event carries as credentialId.
        const held = credentials.find(
          (c: any) => c.attributes?.credential_id === event.credentialId,
        );

        if (!held) {
          console.log(
            `[wallet-agent] Revocation ignored — credential not in this wallet: ${event.credentialId}`,
          );
          return;
        }

        broadcast("revocation", {
          state: "revoked",
          credentialId: event.credentialId,
        });
        console.log(
          `[wallet-agent] Revocation SSE broadcast for held credential — credentialId: ${event.credentialId}`,
        );
      },
    });
  } catch (err) {
    console.warn(
      "[wallet-agent] Holder revocation consumer setup failed (continuing without):",
      err instanceof Error ? err.message : err,
    );
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));
mountSwagger(app);

if (AGENT_ROLE === "verifier") {
  // The verifier's own consumer broadcasts only revocations of verified credentials.
  await setUpVerifier(app, agent, broadcast);
} else {
  await setupMediator();
  // Holder: surface revocations of its OWN credentials in the UI.
  void setupHolderRevocationConsumer();
}

registerWalletRoutes(app, agent, sseClients, DidCommHandshakeProtocol);

app.listen(
  +EFFECTIVE_WALLET_API_PORT,
  "0.0.0.0",
  () => {
    console.log(
      `REST API running on http://${WALLET_DOMAIN}:${EFFECTIVE_WALLET_API_PORT}`,
    );
  },
);
