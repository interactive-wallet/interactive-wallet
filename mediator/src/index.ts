import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { MEDIATOR_API_PORT, MEDIATOR_WS_ENDPOINT } from "./config.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { DidCommEventTypes, DidCommForwardMessage, DidCommHandshakeProtocol } =
  await import("@credo-ts/didcomm");
const { createMediatorAgent } = await import("./agent.js");

const agent = createMediatorAgent();
await agent.initialize();

agent.events.on(DidCommEventTypes.DidCommMessageProcessed, (data) => {
  const msg = data.payload.message;
  if (msg instanceof DidCommForwardMessage) {
    console.log("push notification for:", msg.to);
    const walletPushEndpoint = `http://localhost:3000/pickup-messages`;
    fetch(walletPushEndpoint, { method: "POST" });
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/invitation", (_req, res) => {
  res.json({ invitationUrl });
});

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
