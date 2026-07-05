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
  AGENT_ENDPOINT,
  AGENT_ROLE,
  INBOUND_PORT,
  INDY_NAMESPACE,
  VON_URL,
  WALLET_ID,
  WALLET_KEY,
} from "./config.js";

const genesisTransactions = await fetch(`${VON_URL}/genesis`).then((response) =>
  response.text(),
);

const inboundPort =
  Number(INBOUND_PORT);

if (
  AGENT_ROLE === "verifier" &&
  (
    !Number.isInteger(inboundPort) ||
    inboundPort <= 0 ||
    inboundPort > 65535
  )
) {
  throw new Error(
    `INBOUND_PORT ist ungültig: ${INBOUND_PORT}`,
  );
}

const isVerifier =
  AGENT_ROLE === "verifier";

export function createAgent() {
  return new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar: NativeAskar.instance,
        store: {
          id: WALLET_ID,
          key: WALLET_KEY,
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
        endpoints:
          isVerifier
            ? [AGENT_ENDPOINT]
            : [],

        transports: {
          inbound:
            isVerifier
              ? [
                  new DidCommHttpInboundTransport({
                    port: +INBOUND_PORT,
                  }),
                ]
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
