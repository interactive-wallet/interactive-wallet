import { Agent, DidsModule } from '@credo-ts/core'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { IndyVdrModule, IndyVdrAnonCredsRegistry, IndyVdrIndyDidResolver } from '@credo-ts/indy-vdr'
import { AnonCredsModule, AnonCredsDidCommCredentialFormatService, AnonCredsDidCommProofFormatService } from '@credo-ts/anoncreds'
import {
  DidCommAutoAcceptCredential,
  DidCommAutoAcceptProof,
  DidCommModule,
  DidCommHttpOutboundTransport,
  DidCommCredentialV2Protocol,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { askar } from '@openwallet-foundation/askar-shared'
import { anoncreds } from '@hyperledger/anoncreds-shared'
import { indyVdr } from '@hyperledger/indy-vdr-shared'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const INBOUND_PORT = parseInt(process.env.INBOUND_PORT ?? '3001', 10)

function loadGenesisTransactions(): string {
  const genesisPath = process.env.GENESIS_FILE_PATH ?? path.join(__dirname, '..', 'genesis.txn')
  if (!fs.existsSync(genesisPath)) {
    throw new Error(`Genesis file not found at ${genesisPath}. Run: curl http://localhost:9000/genesis -o wallet-agent/genesis.txn`)
  }
  return fs.readFileSync(genesisPath, 'utf-8')
}

export function createAgent() {
  return new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: process.env.WALLET_ID ?? 'interactive-wallet',
          key: process.env.WALLET_KEY ?? 'interactive-wallet-key-change-in-prod',
        },
      }),
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            indyNamespace: process.env.INDY_NAMESPACE ?? 'local:test',
            genesisTransactions: loadGenesisTransactions(),
            isProduction: false,
            connectOnStartup: true,
          },
        ],
      }),
      dids: new DidsModule({
        resolvers: [new IndyVdrIndyDidResolver()],
      }),
      anoncreds: new AnonCredsModule({
        anoncreds,
        registries: [new IndyVdrAnonCredsRegistry()],
      }),
      didcomm: new DidCommModule({
        endpoints: [process.env.AGENT_ENDPOINT ?? `http://localhost:${INBOUND_PORT}`],
        transports: {
          inbound: [new DidCommHttpInboundTransport({ port: INBOUND_PORT })],
          outbound: [new DidCommHttpOutboundTransport()],
        },
        connections: {
          autoAcceptConnections: true,
        },
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.Never,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [new AnonCredsDidCommCredentialFormatService()],
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
    },
  })
}

export type WalletAgent = ReturnType<typeof createAgent>
