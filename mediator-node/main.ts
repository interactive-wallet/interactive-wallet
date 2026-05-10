import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  AgentEventTypes,
  AgentMessageReceivedEvent,
  ConnectionsModule,
  DidsModule,
  HttpOutboundTransport,
  MediatorModule,
  PeerDidResolver,
  WsOutboundTransport,
} from "@credo-ts/core";
import {
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from "@credo-ts/indy-vdr";
import { agentDependencies, HttpInboundTransport } from "@credo-ts/node";
import { ariesAskar } from "@hyperledger/aries-askar-nodejs";
import { indyVdr } from "@hyperledger/indy-vdr-nodejs";

const { PORT = "3000" } = process.env;

const endpointUrl = `http://127.0.0.1:${PORT}`;

const vonUrl = `http://127.0.0.1:9000`;
const genesisTransactions = await fetch(`${vonUrl}/genesis`).then((res) =>
  res.text(),
);

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
    mediator: new MediatorModule({ autoAcceptMediationRequests: true }),
    dids: new DidsModule({
      registrars: [new IndyVdrIndyDidRegistrar()],
      resolvers: [new PeerDidResolver(), new IndyVdrIndyDidResolver()],
    }),
    indyVdr: new IndyVdrModule({
      indyVdr,
      networks: [
        {
          isProduction: false,
          indyNamespace: "bcovrin:test",
          genesisTransactions,
          connectOnStartup: true,
        },
      ],
    }),
  },
});

agent.registerOutboundTransport(new HttpOutboundTransport());
agent.registerOutboundTransport(new WsOutboundTransport());
agent.registerInboundTransport(new HttpInboundTransport({ port: +PORT }));

agent.events.on(
  AgentEventTypes.AgentMessageReceived,
  (data: AgentMessageReceivedEvent) => {
    console.log(`Message received:`, JSON.stringify(data));
  },
);

async function registerMediatorDid() {
  // Register the mediator on the ledger
  const mediatorDid = await agent.dids.create({
    method: "indy",
    options: { indyNamespace: "bcovrin:test" },
  });
  console.log("Mediator DID registered on ledger:", mediatorDid.didState.did);
  return mediatorDid.didState.did;
}

async function main() {
  await agent.initialize();
  console.log("Mediator running on port", PORT);
  const mediatorDid = await registerMediatorDid();
  console.log("Mediator DID:", mediatorDid);
}

main().catch(console.error);
