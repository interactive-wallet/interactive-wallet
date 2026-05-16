import { Agent } from '@credo-ts/core'
import { agentDependencies, DidCommHttpInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { 
    DidCommHttpOutboundTransport,
    DidCommMediatorModule,
    DidCommModule,
} from '@credo-ts/didcomm'
import { askar } from '@openwallet-foundation/askar-shared'

const MEDIATOR_PORT = parseInt(process.env.MEDIATOR_INBOUND_PORT ?? '3005', 10)

const MEDIATOR_ENDPOINT = 
    process.env.MEDIATOR_ENDPOINT ?? `http://localhost:${MEDIATOR_PORT}`

export function createMediatorAgent() {
    return new Agent({
        config: {},
        dependencies: agentDependencies,
        modules: {
            askar: new AskarModule({
                askar,
                store: {
                    id: process.env.MEDIATOR_WALLET_ID ?? 'mediator-wallet',
                    key: process.env.MEDIATOR_WALLET_KEY ?? 'mediator-wallet-key',
                },
            }),
            didcomm: new DidCommModule({
                endpoints: [MEDIATOR_ENDPOINT],
                transports: {
                    inbound: [new DidCommHttpInboundTransport({ port: MEDIATOR_PORT })],
                    outbound: [new DidCommHttpOutboundTransport()],
                },
                connections: {
                    autoAcceptConnections: true,
                },
            }),
            mediator: new DidCommMediatorModule({
                autoAcceptMediationRequests: true,
            }),
        },
    })
}