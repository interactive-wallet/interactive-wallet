import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  PeerDidRegistrar,
  PeerDidResolver,
} from "@credo-ts/core";
import {
  DidCommHttpOutboundTransport,
  DidCommMediatorModule,
  DidCommMessageForwardingStrategy,
  DidCommModule,
} from "@credo-ts/didcomm";
import {
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from "@credo-ts/indy-vdr";
import {
  agentDependencies,
  DidCommHttpInboundTransport,
  DidCommWsInboundTransport,
} from "@credo-ts/node";
import "@hyperledger/anoncreds-nodejs";
import { indyVdr } from "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import { NativeAskar } from "@openwallet-foundation/askar-shared";
import {
  INDY_NAMESPACE,
  MEDIATOR_HTTP_ENDPOINT,
  MEDIATOR_HTTP_PORT,
  MEDIATOR_SEED,
  MEDIATOR_WALLET_ID,
  MEDIATOR_WS_ENDPOINT,
  MEDIATOR_WS_PORT,
  VON_URL,
} from "./config.js";

const genesisTransactions = await fetch(`${VON_URL}/genesis`).then((res) =>
  res.text(),
);

export function createMediatorAgent() {
  return new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar: NativeAskar.instance,
        store: {
          id: MEDIATOR_WALLET_ID,
          key: MEDIATOR_SEED,
        },
      }),
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            indyNamespace: INDY_NAMESPACE,
            genesisTransactions,
            isProduction: false,
            connectOnStartup: true,
          },
        ],
      }),
      dids: new DidsModule({
        resolvers: [
          new IndyVdrIndyDidResolver(),
          new PeerDidResolver(),
          new KeyDidResolver(),
        ],
        registrars: [
          new IndyVdrIndyDidRegistrar(),
          new PeerDidRegistrar(),
          new KeyDidRegistrar(),
        ],
      }),
      didcomm: new DidCommModule({
        endpoints: [MEDIATOR_HTTP_ENDPOINT, MEDIATOR_WS_ENDPOINT],
        transports: {
          inbound: [
            new DidCommHttpInboundTransport({ port: +MEDIATOR_HTTP_PORT }),
            new DidCommWsInboundTransport({ port: +MEDIATOR_WS_PORT }),
          ],
          outbound: [new DidCommHttpOutboundTransport()],
        },
        mediator: {
          autoAcceptMediationRequests: true,
          messageForwardingStrategy:
            DidCommMessageForwardingStrategy.QueueAndLiveModeDelivery,
        },
        connections: {
          autoAcceptConnections: true,
        },
      }),
      // TODO redundant? needed for type inference?
      mediator: new DidCommMediatorModule({
        autoAcceptMediationRequests: true,
        messageForwardingStrategy:
          DidCommMessageForwardingStrategy.QueueAndLiveModeDelivery,
      }),
    },
  });
}
