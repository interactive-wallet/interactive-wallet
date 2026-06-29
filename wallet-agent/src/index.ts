import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import * as amqp from "amqplib";
import cors from "cors";
import "dotenv/config";
import express, { type Response } from "express";
import path from "path";
import { MEDIATOR_API_URL, VERIFIER_HTTP_PORT, WALLET_API_PORT, WALLET_DOMAIN } from "./config.js";

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
    const resp = await fetch(`${MEDIATOR_API_URL}/invitation`);
    if (!resp.ok) {
      console.warn(`[wallet-agent] Mediator not reachable (${resp.status}), continuing without mediator`);
      return;
    }
    const { invitationUrl } = await resp.json() as { invitationUrl: string };

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

// ─── RabbitMQ revocation consumer ────────────────────────────────────────
async function setupRabbitMqConsumer(): Promise<void> {
  const { RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_URL } = process.env;
  const url =
    RABBITMQ_URL ??
    (RABBITMQ_USER && RABBITMQ_PASSWORD
      ? `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672`
      : null);

  if (!url) {
    console.log("[wallet-agent] RabbitMQ not configured — revocation SSE notifications disabled");
    return;
  }

  try {
    const conn = await amqp.connect(url);
    const ch = await conn.createChannel();
    const REVOCATION_QUEUE = "holder.wallet.revocations";
    await ch.assertQueue(REVOCATION_QUEUE, { durable: true });
    ch.consume(REVOCATION_QUEUE, (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString("utf-8")) as { credentialId?: string };
        broadcast("revocation", {
          state: "revoked",
          credentialId: event.credentialId ?? null,
        });
        console.log(`[wallet-agent] [OBSERVER] Revocation SSE broadcast — credentialId: ${event.credentialId}`);
      } catch {
        // ignore malformed messages
      }
      ch.ack(msg);
    });
    console.log("[wallet-agent] RabbitMQ consumer started on queue:", REVOCATION_QUEUE);
  } catch (err) {
    console.warn(
      "[wallet-agent] RabbitMQ consumer setup failed (continuing without):",
      err instanceof Error ? err.message : err,
    );
  }
}

void setupRabbitMqConsumer();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, "..", "public")));

if (VERIFIER_HTTP_PORT) {
  await setUpVerifier(app, agent);
} else {
  await setupMediator();
}

// ─── Health ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── SSE — live activity stream ───────────────────────────────────────────
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(
    `data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`,
  );
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ─── Credentials ──────────────────────────────────────────────────────────
app.get("/credentials", async (_req, res) => {
  try {
    const credentials = await agent.modules.anoncreds.getCredentials({});
    res.json(credentials);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Proof exchanges (incoming proof requests) ────────────────────────────
app.get("/proof-exchanges", async (_req, res) => {
  try {
    const proofs = await agent.modules.didcomm.proofs.getAll();
    const result = await Promise.all(
      proofs.map(async (p) => {
        let requestedAttributes: string[] = [];
        try {
          const formatData = await agent.modules.didcomm.proofs.getFormatData(
            p.id,
          );
          const req = formatData.request?.anoncreds;
          if (req?.requested_attributes) {
            requestedAttributes = Object.values(req.requested_attributes)
              .map((a: any) => a.name ?? a.names)
              .flat();
          }
        } catch {
          /* ignore */
        }
        return {
          id: p.id,
          state: p.state,
          isVerified: p.isVerified ?? null,
          connectionId: p.connectionId,
          requestedAttributes,
          createdAt: p.createdAt,
        };
      }),
    );
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Connections ──────────────────────────────────────────────────────────
app.get("/connections", async (_req, res) => {
  try {
    const connections = await agent.modules.didcomm.connections.getAll();

    res.json(
      connections.map((connection) => ({
        id: connection.id,
        state: connection.state,
        role: connection.role,
        theirLabel: connection.theirLabel,
        did: connection.did,
        theirDid: connection.theirDid,
        invitationDid: connection.invitationDid,
        outOfBandId: connection.outOfBandId,
        createdAt: connection.createdAt,
      })),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Credential exchanges ─────────────────────────────────────────────────
app.get("/exchanges", async (_req, res) => {
  try {
    const exchanges = await agent.modules.didcomm.credentials.getAll();
    res.json(
      exchanges.map((e) => ({
        id: e.id,
        state: e.state,
        role: e.role,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt,
      })),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Receive invitation ───────────────────────────────────────────────────
app.post("/receive-invitation", async (req, res) => {
  try {
    const { invitationUrl } = req.body as { invitationUrl: string };
    if (!invitationUrl) {
      res.status(400).json({ error: "Missing invitationUrl" });
      return;
    }
    // Detect OOB invitations where services[0] is a bare DID string.
    // In that case use receiveImplicitInvitation so the wallet sets pthid to the
    // DID itself — the issuer's ConnectionRequestHandler needs pthid to be a DID
    // to take the createFromImplicitInvitation path (Connections protocol v1).
    let invitationDid: string | null = null;
    try {
      const parsed = new URL(invitationUrl);
      const oobParam = parsed.searchParams.get("oob");
      if (oobParam) {
        const decoded = JSON.parse(Buffer.from(oobParam, "base64url").toString("utf-8"));
        const first = decoded?.services?.[0];
        if (typeof first === "string" && first.startsWith("did:")) {
          invitationDid = first;
        }
      }
    } catch { /* not a standard OOB URL, fall through */ }

    let outOfBandRecord: { id: string };
    let connectionRecord: { id: string; state: string } | undefined;

    if (invitationDid) {
      const result = await agent.modules.didcomm.oob.receiveImplicitInvitation({
        did: invitationDid,
        label: "Wallet",
        autoAcceptInvitation: true,
        autoAcceptConnection: true,
        handshakeProtocols: [DidCommHandshakeProtocol.Connections],
      });
      outOfBandRecord = result.outOfBandRecord;
      connectionRecord = result.connectionRecord ?? undefined;
    } else {
      const result = await agent.modules.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
        label: "Wallet",
        autoAcceptInvitation: true,
        autoAcceptConnection: true,
      });
      outOfBandRecord = result.outOfBandRecord;
      connectionRecord = result.connectionRecord ?? undefined;
    }

    res.json({
      oobId: outOfBandRecord.id,
      connectionId: connectionRecord?.id,
      connectionState: connectionRecord?.state,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/pickup-messages", async (_req, res) => {
  try {
    console.log("initiateMessagePickup");

    const defaultMediator =
      await agent.modules.mediationRecipient.findDefaultMediator();
    if (!defaultMediator) throw new Error("No default mediator");

    await agent.modules.mediationRecipient.initiateMessagePickup(
      defaultMediator,
    );

    console.log("pickupMessages");

    const mediatorConnection =
      await agent.modules.mediationRecipient.findDefaultMediatorConnection();
    if (!mediatorConnection) throw new Error("No default mediator connection");

    await (
      agent.modules.mediationRecipient as any
    ).messagePickupApi.pickupMessages({
      connectionId: mediatorConnection.id,
      batchSize: 10,
      protocolVersion: "v2",
    });

    res.json({
      success: true,
      message: "Pickup executed",
      mediationRecordId: defaultMediator.id,
      mediationState: defaultMediator.state,
      mediationConnectionId: defaultMediator.connectionId,
      actualConnectionId: mediatorConnection.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Pending credential offers ────────────────────────────────────────────
app.get("/pending-credentials", async (_req, res) => {
  try {
    const exchanges = await agent.modules.didcomm.credentials.getAll();
    const pending = exchanges.filter((e) => e.state === "offer-received");
    const result = await Promise.all(
      pending.map(async (e) => {
        let credDefId: string | null = null;
        let attributes: Record<string, string> = {};
        try {
          const formatData =
            await agent.modules.didcomm.credentials.getFormatData(e.id);
          const offer = (formatData.offer as any)?.anoncreds;
          if (offer) {
            credDefId = offer.cred_def_id ?? null;
          }
        } catch {
          /* ignore */
        }
        let fromLabel: string | null = null;
        if (e.connectionId) {
          try {
            const conn = await agent.modules.didcomm.connections.getById(
              e.connectionId,
            );
            fromLabel = conn.theirLabel ?? null;
          } catch {
            /* ignore */
          }
        }
        return {
          id: e.id,
          state: e.state,
          credDefId,
          fromLabel,
          createdAt: e.createdAt,
        };
      }),
    );
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Accept credential offer ──────────────────────────────────────────────
app.post("/accept-credential/:id", async (req, res) => {
  try {
    const record = await agent.modules.didcomm.credentials.acceptOffer({
      credentialExchangeRecordId: req.params.id,
    });
    res.json({ success: true, state: record.state });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Decline credential offer ─────────────────────────────────────────────
app.post("/decline-credential/:id", async (req, res) => {
  try {
    await agent.modules.didcomm.credentials.declineOffer({
      credentialExchangeRecordId: req.params.id,
    });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Accept proof request (auto-selects credentials) ─────────────────────
app.post("/accept-proof/:id", async (req, res) => {
  try {
    const selectedCredentials =
      await agent.modules.didcomm.proofs.selectCredentialsForRequest({
        proofExchangeRecordId: req.params.id,
      });
    const record = await agent.modules.didcomm.proofs.acceptRequest({
      proofExchangeRecordId: req.params.id,
      proofFormats: selectedCredentials.proofFormats,
    });
    res.json({ success: true, state: record.state });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Decline proof request ────────────────────────────────────────────────
app.post("/decline-proof/:id", async (req, res) => {
  try {
    await agent.modules.didcomm.proofs.declineRequest({
      proofExchangeRecordId: req.params.id,
    });
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(+WALLET_API_PORT, '0.0.0.0', () => {
  console.log(`REST API running on http://${WALLET_DOMAIN}:${WALLET_API_PORT}`);
});
