import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import "dotenv/config";
import { MEDIATOR_WS_ENDPOINT } from "./config.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { DidCommEventTypes, DidCommForwardMessage, DidCommHandshakeProtocol } =
  await import("@credo-ts/didcomm");
const { createMediatorAgent } = await import("./agent.js");

const agent = createMediatorAgent();
await agent.initialize();

agent.events.on(DidCommEventTypes.DidCommMessageProcessed, (data) => {
  const msg = data.payload.message;
  if (msg instanceof DidCommForwardMessage) {
    console.log("TODO push notification for:", msg.to);
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
console.log(invitationUrl);
