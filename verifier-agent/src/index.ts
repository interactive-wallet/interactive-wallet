import 'dotenv/config'
import express from 'express'
import cors from 'cors'

// Native modules MUST be registered before @credo-ts/* modules are loaded.
await import('@openwallet-foundation/askar-nodejs')
await import('@hyperledger/anoncreds-nodejs')
await import('@hyperledger/indy-vdr-nodejs')

const { createAgent } = await import('./agent.js')

import { DidCommHandshakeProtocol } from '@credo-ts/didcomm'

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3004', 10)

async function main() {
  const agent = createAgent()
  await agent.initialize()
  console.log('[verifier-agent] Agent initialized')

  const app = express()
  app.use(cors())
  app.use(express.json())

  // ─── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // ─── Invitation ──────────────────────────────────────────────────────────
  app.get('/invitation', async (_req, res) => {
    try {
      const oobRecord = await agent.modules.didcomm.oob.createInvitation({
        label: process.env.AGENT_LABEL ?? 'Interactive Verifier',
        handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
      })
      res.json({
        invitationUrl: oobRecord.outOfBandInvitation.toUrl({
          domain: process.env.AGENT_ENDPOINT ?? 'http://localhost:3005',
        }),
        oobId: oobRecord.id,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Connections ─────────────────────────────────────────────────────────
  app.get('/connections', async (_req, res) => {
    try {
      const connections = await agent.modules.didcomm.connections.getAll()
      res.json(
        connections.map((c) => ({
          id: c.id,
          state: c.state,
          role: c.role,
          theirLabel: c.theirLabel,
          did: c.did,
          theirDid: c.theirDid,
          invitationDid: c.invitationDid,
          outOfBandId: c.outOfBandId,
          createdAt: c.createdAt,
        })),
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Request proof ────────────────────────────────────────────────────────
  // Body: { connectionId, requestedAttributes?: string[] }
  // requestedAttributes: subset of Führerschein fields to request (default: all)
  app.post('/request-proof', async (req, res) => {
    try {
      const { connectionId, requestedAttributes } = req.body as {
        connectionId: string
        requestedAttributes?: string[]
      }

      if (!connectionId) {
        res.status(400).json({ error: 'Missing connectionId' })
        return
      }

      const attrs = requestedAttributes ?? ['vorname', 'nachname', 'geburtsdatum', 'fuehrerscheinklasse', 'ausstellungsdatum']

      const requested_attributes: Record<string, { name: string }> = {}
      for (const attr of attrs) {
        requested_attributes[`${attr}_referent`] = { name: attr }
      }

      const proofRecord = await agent.modules.didcomm.proofs.requestProof({
        connectionId,
        protocolVersion: 'v2',
        proofFormats: {
          anoncreds: {
            name: 'Führerschein Verification',
            version: '1.0',
            requested_attributes,
            requested_predicates: {},
          },
        },
      })

      console.log(`[verifier-agent] Proof request sent to connection ${connectionId}`)
      res.json({ proofExchangeId: proofRecord.id, state: proofRecord.state })
    } catch (err: unknown) {
      console.error('[verifier-agent] request-proof error:', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Get all proof exchanges ──────────────────────────────────────────────
  app.get('/proofs', async (_req, res) => {
    try {
      const proofs = await agent.modules.didcomm.proofs.getAll()
      res.json(proofs.map((p) => ({
        id: p.id,
        state: p.state,
        isVerified: p.isVerified,
        connectionId: p.connectionId,
        errorMessage: p.errorMessage,
        createdAt: p.createdAt,
      })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Get single proof exchange ────────────────────────────────────────────
  app.get('/proofs/:id', async (req, res) => {
    try {
      const record = await agent.modules.didcomm.proofs.getById(req.params.id)
      const formatData = record.isVerified !== undefined
        ? await agent.modules.didcomm.proofs.getFormatData(req.params.id)
        : null

      res.json({
        id: record.id,
        state: record.state,
        isVerified: record.isVerified,
        connectionId: record.connectionId,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
        formatData,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.listen(ADMIN_PORT, () => {
    console.log(`[verifier-agent] REST API running on http://localhost:${ADMIN_PORT}`)
    console.log(`  GET /invitation  GET /connections  POST /request-proof  GET /proofs  GET /proofs/:id`)
  })

  process.on('SIGINT', async () => {
    await agent.shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[verifier-agent] Fatal error:', err)
  process.exit(1)
})
