import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsDidCommProofFormatService,
  AnonCredsModule,
  BasicTailsFileService,
} from "@credo-ts/anoncreds";
import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  DidsModule,
  KeyDidResolver,
  PeerDidResolver,
} from "@credo-ts/core";
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommCredentialV2Protocol,
  DidCommHttpOutboundTransport,
  DidCommMediationRecipientModule,
  DidCommMediatorPickupStrategy,
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
import "@hyperledger/anoncreds-nodejs";
import { NativeAnoncreds } from "@hyperledger/anoncreds-shared";
import "@hyperledger/indy-vdr-nodejs";
import { indyVdr } from "@hyperledger/indy-vdr-shared";
import "@openwallet-foundation/askar-nodejs";
import { NativeAskar } from "@openwallet-foundation/askar-shared";
import {
  INDY_NAMESPACE,
  VERIFIER_HTTP_ENDPOINT,
  VERIFIER_HTTP_PORT,
  VON_URL,
  WALLET_ID,
  WALLET_SEED,
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
        askar: NativeAskar.instance,
        store: {
          id: WALLET_ID,
          key: WALLET_SEED,
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
        registrars: [new IndyVdrIndyDidRegistrar()],
      }),
      anoncreds: new AnonCredsModule({
        anoncreds: NativeAnoncreds.instance,
        registries: [new IndyVdrAnonCredsRegistry()],
        tailsFileService: new BasicTailsFileService(),
      }),
      didcomm: new DidCommModule({
        endpoints: VERIFIER_HTTP_PORT ? [VERIFIER_HTTP_ENDPOINT] : [],
        transports: {
          inbound: VERIFIER_HTTP_PORT
            ? [new DidCommHttpInboundTransport({ port: +VERIFIER_HTTP_PORT })]
            : [],
          outbound: [
            new DidCommHttpOutboundTransport(),
            new DidCommWsOutboundTransport(),
          ],
        },
        connections: {
          autoAcceptConnections: true,
        },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.Never,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [
                new AnonCredsDidCommCredentialFormatService(),
              ],
            }),
          ],
        },
        proofs: {
          autoAcceptProofs: DidCommAutoAcceptProof.Never,
          proofProtocols: [
            new DidCommProofV2Protocol({
              proofFormats: [new AnonCredsDidCommProofFormatService()],
            }),
          ],
        },
      }),
      mediationRecipient: new DidCommMediationRecipientModule({
        mediatorPickupStrategy: DidCommMediatorPickupStrategy.PickUpV2,
      }),
    },
  });
}

export type WalletAgent = ReturnType<typeof createAgent>;
