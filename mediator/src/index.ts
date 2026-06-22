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
  subscribers: Record<string, true>;
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
}, 5_000);

async function checkRegistry(
  registryId: string,
): Promise<void> {
  const regState =
    subscriptions.revocations?.[registryId];

  if (!regState) {
    return;
  }

  const result =
    await agent.modules.anoncreds
      .getRevocationStatusList(
        registryId,
        Math.floor(Date.now() / 1000),
        {
          useCache: false,
        },
      );

  const statusList =
    result.revocationStatusList;

  if (!statusList) {
    throw new Error(
      `No revocation status list for ${registryId}: ` +
        JSON.stringify(
          result.resolutionMetadata,
        ),
    );
  }

  const currentState =
    JSON.stringify(
      statusList.revocationList,
    );

  if (regState.lastState === undefined) {
    regState.lastState = currentState;
    subscriptionsChanged = true;

    console.log(
      "[mediator] Revocation baseline created",
      {
        registryId,
        subscriberCount:
          Object.keys(
            regState.subscribers,
          ).length,
      },
    );

    return;
  }

  if (regState.lastState === currentState) {
    return;
  }

  regState.lastState = currentState;
  subscriptionsChanged = true;

  console.log(
    "[mediator] Revocation registry changed",
    {
      registryId,
    },
  );

  for (
    const connectionId
    of Object.keys(regState.subscribers)
  ) {
    console.log(
      "[mediator] Revocation notification for",
      {
        registryId,
        connectionId,
      },
    );

    const response = await fetch(
      "http://localhost:3000/notify-revocation",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          registryId,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "[mediator] Wallet revocation notification failed",
        {
          registryId,
          connectionId,
          status: response.status,
          response:
            await response.text(),
        },
      );
    }
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

app.post("/subscribe-revocations", async (req, res) => {
  try {
    const { holderDid, registryId } = req.body as {
      holderDid?: string;
      registryId?: string;
    };

    if (
      typeof holderDid !== "string" ||
      holderDid.trim().length === 0
    ) {
      res.status(400).json({
        error: "holderDid is required",
      });
      return;
    }

    if (
      typeof registryId !== "string" ||
      registryId.trim().length === 0
    ) {
      res.status(400).json({
        error: "registryId is required",
      });
      return;
    }

    const connections =
      await agent.modules.didcomm.connections.getAll();


    const holderConnection = connections.find(
      (connection) =>
        connection.state === "completed" &&
        connection.theirDid === holderDid,
    );

    if (!holderConnection) {
      res.status(404).json({
        error:
          "No completed mediator connection found for holderDid",
        holderDid,
      });
      return;
    }

    subscriptions.revocations ??= {};

    subscriptions.revocations[registryId] ??= {
      subscribers: {},
    };

    const registrySubscription =
      subscriptions.revocations[registryId];

    const alreadySubscribed =
      registrySubscription.subscribers[
        holderConnection.id
      ] === true;

    registrySubscription.subscribers[
      holderConnection.id
    ] = true;

    saveSubscriptionsFile();

    console.log(
      "[mediator] Revocation subscription registered",
      {
        registryId,
        holderDid,
        mediatorConnectionId:
          holderConnection.id,
        alreadySubscribed,
      },
    );

    res.json({
      status: "ok",
      registryId,
      holderDid,
      mediatorConnectionId:
        holderConnection.id,
      alreadySubscribed,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : String(err);

    res.status(500).json({
      error: message,
    });
  }
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
