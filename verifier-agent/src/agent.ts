import { Agent, DidsModule } from '@credo-ts/core'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { IndyVdrModule, IndyVdrAnonCredsRegistry, IndyVdrIndyDidResolver, IndyVdrIndyDidRegistrar } from '@credo-ts/indy-vdr'
import { AnonCredsModule, AnonCredsDidCommProofFormatService } from '@credo-ts/anoncreds'
import {
  DidCommAutoAcceptProof,
  DidCommModule,
  DidCommHttpOutboundTransport,
  DidCommProofV2Protocol,
} from '@credo-ts/didcomm'
import { askar } from '@openwallet-foundation/askar-shared'
import { anoncreds } from '@hyperledger/anoncreds-shared'
import { indyVdr } from '@hyperledger/indy-vdr-shared'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INBOUND_PORT = parseInt(process.env.INBOUND_PORT ?? '3005', 10)

function loadGenesisTransactions(): string {
  const genesisPath = process.env.GENESIS_FILE_PATH
    ? path.resolve(__dirname, '..', process.env.GENESIS_FILE_PATH)
    : path.join(__dirname, '..', '..', 'wallet-agent', 'genesis.txn')

  if (!fs.existsSync(genesisPath)) {
    throw new Error(`Genesis file not found at ${genesisPath}`)
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
          id: process.env.WALLET_ID ?? 'interactive-verifier',
          key: process.env.WALLET_KEY ?? 'verifier-local-dev-key-change-prod',
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
        registrars: [new IndyVdrIndyDidRegistrar()],
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
  })
}

export type VerifierAgent = ReturnType<typeof createAgent>
