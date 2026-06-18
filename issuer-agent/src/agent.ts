import {
  AnonCredsDidCommCredentialFormatService,
  AnonCredsDidCommProofFormatService,
  AnonCredsModule,
  AnonCredsRevocationRegistryDefinition,
  BasicTailsFileService,
} from "@credo-ts/anoncreds";
import { AgentContext } from "@credo-ts/core";
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
  ISSUER_API_PORT,
  ISSUER_DOMAIN,
  ISSUER_HTTP_ENDPOINT,
  ISSUER_HTTP_PORT,
  ISSUER_SEED,
  ISSUER_WALLET_ID,
  VON_URL,
} from "./config.js";

// Serves tails files from the local AFJ tails cache directory.
// uploadTailsFile returns the HTTP URL where Express will serve the file,
// so the holder can download it when creating a non-revocation proof.
class IssuerTailsFileService extends BasicTailsFileService {
  private readonly tailsServerBaseUrl: string;

  constructor() {
    super(); // uses AFJ default cache path (~/.afj/data/anoncreds/tails)
    this.tailsServerBaseUrl = `http://${ISSUER_DOMAIN}:${ISSUER_API_PORT}/tails`;
  }

  async uploadTailsFile(
    _agentContext: AgentContext,
    options: { revocationRegistryDefinition: AnonCredsRevocationRegistryDefinition },
  ): Promise<{ tailsFileUrl: string }> {
    const { tailsHash } = options.revocationRegistryDefinition.value;
    return { tailsFileUrl: `${this.tailsServerBaseUrl}/${tailsHash}` };
  }
}

export { IssuerTailsFileService };

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
          id: ISSUER_WALLET_ID,
          key: ISSUER_SEED,
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
        tailsFileService: new IssuerTailsFileService(),
      }),
      didcomm: new DidCommModule({
        endpoints: [ISSUER_HTTP_ENDPOINT],
        transports: {
          inbound: [
            new DidCommHttpInboundTransport({ port: +ISSUER_HTTP_PORT }),
          ],
          outbound: [
            new DidCommHttpOutboundTransport(),
            new DidCommWsOutboundTransport(),
          ],
        },
        connections: {
          autoAcceptConnections: true,
        },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.Always,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [
                new AnonCredsDidCommCredentialFormatService(),
              ],
            }),
          ],
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

export type IssuerAgent = ReturnType<typeof createAgent>;
