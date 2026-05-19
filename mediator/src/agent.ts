import { Agent, DidsModule, PeerDidResolver, KeyDidResolver } from '@credo-ts/core'
import { agentDependencies, DidCommHttpInboundTransport, DidCommWsInboundTransport } from '@credo-ts/node'
import { AskarModule } from '@credo-ts/askar'
import { DidCommHttpOutboundTransport, DidCommModule, DidCommWsOutboundTransport, DidCommMessageForwardingStrategy } from '@credo-ts/didcomm'
import { askar } from '@openwallet-foundation/askar-shared'

const MEDIATOR_HTTP_PORT = parseInt(process.env.MEDIATOR_INBOUND_PORT ?? '3005', 10)
const MEDIATOR_WS_PORT = parseInt(process.env.MEDIATOR_WS_INBOUND_PORT ?? '3006', 10)

const MEDIATOR_HTTP_ENDPOINT =
    process.env.MEDIATOR_ENDPOINT ?? `http://localhost:${MEDIATOR_HTTP_PORT}`

const MEDIATOR_WS_ENDPOINT =
    process.env.MEDIATOR_WS_ENDPOINT ?? `ws://localhost:${MEDIATOR_WS_PORT}`

export function createMediatorAgent() {
    return new Agent({
        config: {},
        dependencies: agentDependencies,
        modules: {
            askar: new AskarModule({
                askar,
                store: {
                    id: process.env.MEDIATOR_WALLET_ID ?? 'mediator-wallet-v01234-test5',
                    key: process.env.MEDIATOR_WALLET_KEY ?? 'mediator-wallet-key',
                },
            }),
            dids: new DidsModule({
                resolvers: [new PeerDidResolver(), new KeyDidResolver()],
            }),
            didcomm: new DidCommModule({
                endpoints: [MEDIATOR_HTTP_ENDPOINT, MEDIATOR_WS_ENDPOINT],
                transports: {
                    inbound: [new DidCommHttpInboundTransport({ port: MEDIATOR_HTTP_PORT }), new DidCommWsInboundTransport({ port: MEDIATOR_WS_PORT })],
                    outbound: [new DidCommHttpOutboundTransport(), new DidCommWsOutboundTransport()],
                },
                mediator: {
                    autoAcceptMediationRequests: true,
                    messageForwardingStrategy: DidCommMessageForwardingStrategy.QueueAndLiveModeDelivery,
                },
                connections: {
                    autoAcceptConnections: true,
                },
            }),
        },
    })
}