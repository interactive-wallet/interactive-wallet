import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { MEDIATOR_API_PORT, MEDIATOR_WS_ENDPOINT } from "./config.js";
import { readFileSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";

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
    const walletPushEndpoint = `http://localhost:3000/pickup-messages`; // TODO
    fetch(walletPushEndpoint, { method: "POST" });
  }
});

type RevocationSubscriptions = {
  subscribers: Record<string, unknown>;
  lastState?: string;
};

const subscriptions: { revocations?: Record<string, RevocationSubscriptions> } =
  JSON.parse(
    await readFile("subscriptions.json").then(
      (f) => f.toString(),
      () => "{}",
    ),
  );

function saveSubscriptionsFile() {
  writeFileSync("subscriptions.json", JSON.stringify(subscriptions));
}

let subscriptionsChanged = false;

setInterval(async () => {
  await Promise.all(
    Object.keys(subscriptions.revocations ?? {}).map((registryId) =>
      checkRegistry(registryId).catch(console.error),
    ),
  );
  if (subscriptionsChanged) {
    subscriptionsChanged = false;
    saveSubscriptionsFile();
  }
}, 60_000);

async function checkRegistry(registryId: string) {
  const regState = subscriptions.revocations![registryId];
  const revocStatus = await agent.modules.anoncreds.getRevocationStatusList(
    registryId,
    Date.now() / 1000,
  );
  const revokedIds = JSON.stringify(revocStatus.revocationStatusList || []);
  if (regState.lastState === revokedIds) return; // no change
  regState.lastState = revokedIds;
  subscriptionsChanged = true;
  for (const connectionId of Object.keys(regState.subscribers)) {
    console.log("revocation notification for:", { registryId, connectionId });
    const walletPushEndpoint = `http://localhost:3000/notify-revocation/${registryId}`; // TODO
    fetch(walletPushEndpoint, { method: "POST" });
  }
}

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

app.post("/subscribe-revocations", (req, res) => {
  const { connectionId, registryId } = req.body as {
    connectionId: string;
    registryId: string;
  };

  subscriptions.revocations ||= {};
  subscriptions.revocations[registryId] ||= { subscribers: {} };
  subscriptions.revocations[registryId].subscribers[connectionId] = true;

  saveSubscriptionsFile();

  res.json({ status: "ok" });
});

app.get("/connections", async (_req, res) => {
  try {
    const connections = await agent.modules.didcomm.connections.getAll();
    res.json(
      connections.map((c) => ({
        id: c.id,
        state: c.state,
        theirLabel: c.theirLabel,
        createdAt: c.createdAt,
      })),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(MEDIATOR_API_PORT, () => {
  console.log(
    `[mediator] REST API running on http://localhost:${MEDIATOR_API_PORT}`,
  );
});
