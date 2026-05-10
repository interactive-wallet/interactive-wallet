import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  AgentEventTypes,
  ConnectionsModule,
  HttpOutboundTransport,
  MediatorModule,
  WsOutboundTransport,
} from "@credo-ts/core";
import { agentDependencies, HttpInboundTransport } from "@credo-ts/node";
// @ts-ignore
import { ariesAskar } from "@openwallet-foundation/askar-nodejs";

const { PORT = "3000" } = process.env;

const endpointUrl = `http://localhost:${PORT}`;

const agent = new Agent({
  dependencies: agentDependencies,
  config: {
    label: "mediator",
    walletConfig: {
      id: "wallet-id-mediator",
      key: "mediator_00000000000000000000000",
    },
    endpoints: [endpointUrl],
  },
  modules: {
    askar: new AskarModule({ ariesAskar }),
    connections: new ConnectionsModule({
      autoAcceptConnections: true,
    }),
    mediator: new MediatorModule({
      autoAcceptMediationRequests: true,
    }),
  },
});

agent.registerOutboundTransport(new HttpOutboundTransport());
agent.registerOutboundTransport(new WsOutboundTransport());
agent.registerInboundTransport(new HttpInboundTransport({ port: +PORT }));

agent.events.on(AgentEventTypes.AgentMessageReceived, (data) => {
  console.log(`[MEDIATOR LOG] Message received: ${data.message.type}`);
});

async function createInvitation() {
  const mediatorOutOfBandRecord = await agent.oob.createInvitation({
    multiUseInvitation: true,
  });
  const mediatorInvitationUrl =
    mediatorOutOfBandRecord.outOfBandInvitation.toUrl({ domain: endpointUrl });
  return mediatorInvitationUrl;
}

async function main() {
  await agent.initialize();
  console.log("Mediator running on port", PORT);
  console.log("Invitation:", await createInvitation());
}

main().catch(console.error);
