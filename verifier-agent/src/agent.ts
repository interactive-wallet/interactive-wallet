import {
  AnonCredsDidCommProofFormatService,
  AnonCredsModule,
} from "@credo-ts/anoncreds";
import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  DidsModule,
  KeyDidResolver,
  PeerDidResolver,
} from "@credo-ts/core";
import {
  DidCommAutoAcceptProof,
  DidCommHttpOutboundTransport,
  DidCommModule,
  DidCommProofV2Protocol,
  DidCommWsOutboundTransport,
} from "@credo-ts/didcomm";
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from "@credo-ts/indy-vdr";
import { agentDependencies, DidCommHttpInboundTransport } from "@credo-ts/node";
import { NativeAnoncreds } from "@hyperledger/anoncreds-shared";
import { indyVdr } from "@hyperledger/indy-vdr-shared";
import { askar } from "@openwallet-foundation/askar-shared";
import {
  INDY_NAMESPACE,
  VERIFIER_HTTP_ENDPOINT,
  VERIFIER_HTTP_PORT,
  VERIFIER_SEED,
  VERIFIER_WALLET_ID,
  VON_URL,
} from "./config.js";

const genesisTransactions = await fetch(`${VON_URL}/genesis`).then((res) =>
  res.text(),
);

export function createAgent() {
  return new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: VERIFIER_WALLET_ID,
          key: VERIFIER_SEED,
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
          new KeyDidResolver(),
          new PeerDidResolver(),
        ],
        registrars: [new IndyVdrIndyDidRegistrar()],
      }),
      anoncreds: new AnonCredsModule({
        anoncreds: NativeAnoncreds.instance,
        registries: [new IndyVdrAnonCredsRegistry()],
      }),
      didcomm: new DidCommModule({
        endpoints: [VERIFIER_HTTP_ENDPOINT],
        transports: {
          inbound: [
            new DidCommHttpInboundTransport({ port: +VERIFIER_HTTP_PORT }),
          ],
          outbound: [
            new DidCommHttpOutboundTransport(),
            new DidCommWsOutboundTransport(),
          ],
        },
        connections: {
          autoAcceptConnections: true,
        },
        proofs: {
          autoAcceptProofs: DidCommAutoAcceptProof.Always,
          proofProtocols: [
            new DidCommProofV2Protocol({
              proofFormats: [new AnonCredsDidCommProofFormatService()],
            }),
          ],
        },
      }),
    },
  });
}

export type VerifierAgent = ReturnType<typeof createAgent>;
