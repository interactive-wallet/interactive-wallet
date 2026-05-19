import 'dotenv/config'
import express from 'express'
import cors from 'cors'
await import('@openwallet-foundation/askar-nodejs')
import { type Response } from 'express'
import { DidCommConnectionEventTypes, DidCommHandshakeProtocol } from '@credo-ts/didcomm'

const{ createMediatorAgent } = await import('./agent.js')

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3015', 10)

const sseClients = new Set<Response>()

function broadcast(type: string, data: object) {
    const msg = `data: ${JSON.stringify({ type, ...data, ts: new Date().toISOString() })}\n\n`

    for (const client of sseClients) {
        client.write(msg)
    }
}

async function main() {
    const agent = createMediatorAgent()
    await agent.initialize()

    agent.events.on('*' as any, (event: any) => {
        const type = event?.type ?? event?.metadata?.type ?? 'unknown'
        const payloadType = event?.payload?.type

        console.log('[mediator event]', {
            type,
            payloadType,
            keys: Object.keys(event ?? {}),
        })
    })

    agent.events.on(DidCommConnectionEventTypes.DidCommConnectionStateChanged, ({ payload }: any) => {
        const c = payload.connectionRecord
        broadcast('connection', { state: c.state, theirLabel: c.theirLabel ?? 'Unknown', connectionId: c.id })
    })

    console.log('[mediator] Mediator agent started...')
    console.log(`[mediator] Endpoint: ${process.env.MEDIATOR_ENDPOINT ?? 'http://localhost:3005'}`,)

    const app = express()
    app.use(cors())
    app.use(express.json())

    app.get('/health', (_req, res) => {
        res.json({status: 'ok', service: 'mediator'})
    })

    app.get('/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.flushHeaders()

        res.write(
            `data: ${JSON.stringify({
                type: 'connected',  
                ts: new Date().toISOString(),
            })}\n\n`,
        )

        sseClients.add(res)

        req.on('close', () => {
            sseClients.delete(res)
        })
    })

    app.post('/create-invitation', async (_req, res) => {
        try {
            const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
                label: process.env.MEDIATOR_LABEL ?? 'Mediator',
                autoAcceptConnection: true,
                handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
            })

            res.json({
                outOfBandRecordId: outOfBandRecord.id,
                invitationUrl: outOfBandRecord.outOfBandInvitation.toUrl({
                    domain:
                        process.env.MEDIATOR_INVITATION_DOMAIN ??
                        process.env.MEDIATOR_ENDPOINT ??
                        'http://localhost:3005',
                }),
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({
                err: message
                })
            }
    })


    app.get('/didcomm-debug', (_req, res) => {
        try {
            const didcomm = agent.modules.didcomm as any

            res.json({
            didcommKeys: Object.keys(didcomm),
            didcommPrototypeMethods: Object.getOwnPropertyNames(
                Object.getPrototypeOf(didcomm),
            ).sort(),
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({ error: message })
        }
    })

    app.get('/mediator-pickup-debug', (_req, res) => {
        try {
            const didcomm = agent.modules.didcomm as any
            const messagePickupApi = didcomm.messagePickupApi

            if (!messagePickupApi) {
            res.json({
                error: 'No messagePickupApi on didcomm module',
                didcommKeys: Object.keys(didcomm),
            })
            return
            }

            const methods = [
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(messagePickupApi)),
            ...Object.keys(messagePickupApi),
            ]

            res.json({
            messagePickupMethods: [...new Set(methods)].sort(),
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({ error: message })
        }
    })

    function getMethods(api: any) {
        if (!api) return null

        return [...new Set([
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(api)),
            ...Object.keys(api),
        ])].sort()
    }

    app.get('/mediator-module-debug', (_req, res) => {
        try {
            const didcomm = agent.modules.didcomm as any

            res.json({
            didcommKeys: Object.keys(didcomm),
            messagePickup: {
                exists: Boolean(didcomm.messagePickup),
                methods: getMethods(didcomm.messagePickup),
            },
            mediator: {
                exists: Boolean(didcomm.mediator),
                methods: getMethods(didcomm.mediator),
            },
            mediationRecipient: {
                exists: Boolean(didcomm.mediationRecipient),
                methods: getMethods(didcomm.mediationRecipient),
            },
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({ error: message })
        }
    })


    app.get('/message-pickup-api-debug', (_req, res) => {
        try {
            const api = (agent.modules.didcomm as any).messagePickup

            res.json({
            methods: [
                ...new Set([
                ...Object.getOwnPropertyNames(Object.getPrototypeOf(api)),
                ...Object.keys(api),
                ]),
            ].sort(),
            ownKeys: Object.keys(api),
            config: api.config,
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({ error: message })
        }
    })
            
    app.get('/connections', async (_req, res) => {
        try {
            const connections = await agent.modules.didcomm.connections.getAll()

            res.json(
                connections.map((conn) => ({
                    id: conn.id,
                    state: conn.state,
                    role: conn.role,
                    theirLabel: conn.theirLabel,
                    did: conn.did,
                    theirDid: conn.theirDid,
                    invitationDid: conn.invitationDid,
                    outOfBandId: conn.outOfBandId,
                    createdAt: conn.createdAt,
                }))
            )
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            res.status(500).json({
                err: message
                })
        }
    })

    app.get('/mediations', async (_req, res) => {
        res.json({
            message: 'Mediator is configured through DidCommModule',
        })
  })
    
    app.listen(ADMIN_PORT, () => {
        console.log(`[mediator] Admin API listening on port ${ADMIN_PORT}`)
    })


    process.on('SIGINT', async () => {
        console.log('[mediator] Shutting down...')
        await agent.shutdown()
        process.exit(0)
    })
}


main().catch((err) => {
    console.error('Error starting mediator agent:', err)
    process.exit(1)
})