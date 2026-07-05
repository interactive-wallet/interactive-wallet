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
          AGENT_ROLE === "verifier"
            ? [AGENT_ENDPOINT]
            : [],

        transports: {
          inbound:
            AGENT_ROLE === "verifier"
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
          // Holder keeps manual control (explicit "Share Proof" in the UI).
          // The verifier has no human-approval step for an incoming
          // presentation — it must auto-acknowledge it so the exchange reaches
          // `done` (otherwise it sticks at `presentation-received`, and the
          // verified-credential registration + revocation matching never run).
          autoAcceptProofs:
            AGENT_ROLE === "verifier"
              ? DidCommAutoAcceptProof.Always
              : DidCommAutoAcceptProof.Never,
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
