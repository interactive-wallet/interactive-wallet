import { Agent, DidsModule } from '@credo-ts/core'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { IndyVdrModule, IndyVdrAnonCredsRegistry, IndyVdrIndyDidResolver, IndyVdrIndyDidRegistrar } from '@credo-ts/indy-vdr'
import { AnonCredsModule, AnonCredsDidCommCredentialFormatService } from '@credo-ts/anoncreds'
import {
  DidCommAutoAcceptCredential,
  DidCommModule,
  DidCommHttpOutboundTransport,
  DidCommCredentialV2Protocol,
} from '@credo-ts/didcomm'
import { askar } from '@openwallet-foundation/askar-shared'
import { anoncreds } from '@hyperledger/anoncreds-shared'
import { indyVdr } from '@hyperledger/indy-vdr-shared'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const INBOUND_PORT = parseInt(process.env.INBOUND_PORT ?? '3003', 10)

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
          id: process.env.WALLET_ID ?? 'interactive-issuer',
          key: process.env.WALLET_KEY ?? 'interactive-issuer-key-change-in-prod',
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
        credentials: {
          autoAcceptCredentials: DidCommAutoAcceptCredential.Always,
          credentialProtocols: [
            new DidCommCredentialV2Protocol({
              credentialFormats: [new AnonCredsDidCommCredentialFormatService()],
            }),
          ],
        },
        proofs: false,
      }),
    },
  })
}

export type IssuerAgent = ReturnType<typeof createAgent>
