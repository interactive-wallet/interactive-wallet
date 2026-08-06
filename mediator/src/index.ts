import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { MEDIATOR_API_PORT, MEDIATOR_WS_ENDPOINT } from "./config.js";
import { mountSwagger } from "./swagger.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { DidCommEventTypes, DidCommForwardMessage, DidCommHandshakeProtocol } =
  await import("@credo-ts/didcomm");
const { createMediatorAgent } = await import("./agent.js");

const agent = createMediatorAgent();
await agent.initialize();

// Wallet reachable via docker service name by default; override with WALLET_API_URL for local runs.
const WALLET_API_URL = process.env.WALLET_API_URL ?? "http://wallet:3000";

agent.events.on(DidCommEventTypes.DidCommMessageProcessed, (data) => {
  const msg = data.payload.message;
  if (msg instanceof DidCommForwardMessage) {
    console.log("push notification for:", msg.to);
    const walletPushEndpoint = `${WALLET_API_URL}/pickup-messages`;
    // Fire-and-forget, but never let a failed push crash the mediator process.
    fetch(walletPushEndpoint, { method: "POST" }).catch((err) => {
      console.warn(
        `[mediator] wallet push to ${walletPushEndpoint} failed:`,
        err?.message ?? err,
      );
    });
  }
});

console.log("Mediator agent started");

const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
  label: "Mediator",
  autoAcceptConnection: true,
  handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
});
const invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({
  domain: MEDIATOR_WS_ENDPOINT,
});
console.log("[mediator] Invitation URL:", invitationUrl);

const app = express();
app.use(cors());
app.use(express.json());
mountSwagger(app);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [Mediator]
 *     responses:
 *       200:
 *         description: Service is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * @openapi
 * /invitation:
 *   get:
 *     summary: Get the mediator's out-of-band connection invitation
 *     tags: [Mediator]
 *     responses:
 *       200:
 *         description: Invitation URL for establishing a DIDComm connection to the mediator
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitationUrl: { type: string }
 */
app.get("/invitation", (_req, res) => {
  res.json({ invitationUrl });
});

/**
 * @openapi
 * /connections:
 *   get:
 *     summary: List the mediator's DIDComm connections
 *     tags: [Mediator]
 *     responses:
 *       200:
 *         description: Array of connection summaries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   state: { type: string }
 *                   theirLabel: { type: string, nullable: true }
 *                   createdAt: { type: string, format: date-time }
 *       500:
 *         description: Failed to load connections
 */
app.get("/connections", async (_req, res) => {
  try {
    const connections = await agent.modules.didcomm.connections.getAll();
    res.json(connections.map((c) => ({ id: c.id, state: c.state, theirLabel: c.theirLabel, createdAt: c.createdAt })));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(MEDIATOR_API_PORT, () => {
  console.log(`[mediator] REST API running on http://localhost:${MEDIATOR_API_PORT}`);
});
