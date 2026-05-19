import 'dotenv/config'
import express, { type Response } from 'express'
import cors from 'cors'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

await import('@openwallet-foundation/askar-nodejs')
await import('@hyperledger/anoncreds-nodejs')
await import('@hyperledger/indy-vdr-nodejs')

const { createAgent } = await import('./agent.js')

import {
  DidCommProofEventTypes,
  DidCommCredentialEventTypes,
  DidCommConnectionEventTypes,
} from '@credo-ts/didcomm'

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3000', 10)

// SSE client registry
const sseClients = new Set<Response>()

function broadcast(type: string, data: object) {
  const msg = `data: ${JSON.stringify({ type, ...data, ts: new Date().toISOString() })}\n\n`
  for (const client of sseClients) {
    client.write(msg)
  }
}

async function main() {
  const agent = createAgent()
  await agent.initialize()
  console.log('[wallet-agent] Agent initialized')

  // AnonCreds holders need a link secret before they can accept credential offers.
  const linkSecretIds = await agent.modules.anoncreds.getLinkSecretIds()
  if (linkSecretIds.length === 0) {
    await agent.modules.anoncreds.createLinkSecret({ setAsDefault: true })
    console.log('[wallet-agent] Created default link secret')
  }

  // ─── Event listeners → SSE broadcast ─────────────────────────────────────
  agent.events.on(DidCommConnectionEventTypes.DidCommConnectionStateChanged, ({ payload }: any) => {
    const c = payload.connectionRecord
    broadcast('connection', { state: c.state, theirLabel: c.theirLabel ?? 'Unknown', connectionId: c.id })
  })

  agent.events.on(DidCommCredentialEventTypes.DidCommCredentialStateChanged, ({ payload }: any) => {
    const e = payload.credentialExchangeRecord
    broadcast('credential', { state: e.state, role: e.role, credentialId: e.id })
  })

  agent.events.on(DidCommProofEventTypes.ProofStateChanged, ({ payload }: any) => {
    const p = payload.proofRecord
    broadcast('proof', { state: p.state, isVerified: p.isVerified ?? null, proofId: p.id })
  })

  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))

  // ─── Health ───────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // ─── SSE — live activity stream ───────────────────────────────────────────
  app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`)
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })

  // ─── Credentials ──────────────────────────────────────────────────────────
  app.get('/credentials', async (_req, res) => {
    try {
      const credentials = await agent.modules.anoncreds.getCredentials({})
      res.json(credentials)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Proof exchanges (incoming proof requests) ────────────────────────────
  app.get('/proof-exchanges', async (_req, res) => {
    try {
      const proofs = await agent.modules.didcomm.proofs.getAll()
      const result = await Promise.all(
        proofs.map(async (p) => {
          let requestedAttributes: string[] = []
          try {
            const formatData = await agent.modules.didcomm.proofs.getFormatData(p.id)
            const req = formatData.request?.anoncreds
            if (req?.requested_attributes) {
              requestedAttributes = Object.values(req.requested_attributes).map((a: any) => a.name ?? a.names).flat()
            }
          } catch { /* ignore */ }
          return {
            id: p.id,
            state: p.state,
            isVerified: p.isVerified ?? null,
            connectionId: p.connectionId,
            requestedAttributes,
            createdAt: p.createdAt,
          }
        })
      )
      res.json(result)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Credential exchanges ─────────────────────────────────────────────────
  app.get('/exchanges', async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll()
      res.json(exchanges.map((e) => ({ id: e.id, state: e.state, role: e.role, errorMessage: e.errorMessage, createdAt: e.createdAt })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/connections', async (_req, res) => {
    try {
      const connections = await agent.modules.didcomm.connections.getAll()

      res.json(connections.map((connection) => ({
        id: connection.id,
        state: connection.state,
        role: connection.role,
        theirLabel: connection.theirLabel,
        did: connection.did,
        theirDid: connection.theirDid,
        invitationDid: connection.invitationDid,
        outOfBandId: connection.outOfBandId,
        createdAt: connection.createdAt,
      })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Receive invitation ───────────────────────────────────────────────────
  app.post('/receive-invitation', async (req, res) => {
    try {
      const { invitationUrl } = req.body as { invitationUrl: string }
      if (!invitationUrl) {
        res.status(400).json({ error: 'Missing invitationUrl' })
        return
      }
      const { outOfBandRecord, connectionRecord } = await agent.modules.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
        label: process.env.AGENT_LABEL ?? 'Interactive Wallet',
        autoAcceptInvitation: true,
        autoAcceptConnection: true,
      })
      res.json({ 
        oobId: outOfBandRecord.id, 
        connectionId: connectionRecord?.id, 
        connectionState: connectionRecord?.state 
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.post('/request-mediation/:connectionId', async (req, res) => {
    try {
      const connectionRecord = await agent.modules.didcomm.connections.getById(
        req.params.connectionId,
      )

      const mediationRecord = await agent.modules.mediationRecipient.requestAndAwaitGrant(connectionRecord)

      await agent.modules.mediationRecipient.setDefaultMediator(mediationRecord)
            
      res.json({ 
        mediationRecordId: mediationRecord.id, 
        state: mediationRecord.state, 
        connectionId: mediationRecord.connectionId,
        defaultMediatorSet: true, 
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Pending credential offers ────────────────────────────────────────────
  app.get('/pending-credentials', async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll()
      const pending = exchanges.filter((e) => e.state === 'offer-received')
      const result = await Promise.all(
        pending.map(async (e) => {
          let credDefId: string | null = null
          let attributes: Record<string, string> = {}
          try {
            const formatData = await agent.modules.didcomm.credentials.getFormatData(e.id)
            const offer = (formatData.offer as any)?.anoncreds
            if (offer) {
              credDefId = offer.cred_def_id ?? null
            }
          } catch { /* ignore */ }
          let fromLabel: string | null = null
          if (e.connectionId) {
            try {
              const conn = await agent.modules.didcomm.connections.getById(e.connectionId)
              fromLabel = conn.theirLabel ?? null
            } catch { /* ignore */ }
          }
          return { id: e.id, state: e.state, credDefId, fromLabel, createdAt: e.createdAt }
        })
      )
      res.json(result)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Accept credential offer ──────────────────────────────────────────────
  app.post('/accept-credential/:id', async (req, res) => {
    try {
      const record = await agent.modules.didcomm.credentials.acceptOffer({
        credentialExchangeRecordId: req.params.id,
      })
      res.json({ success: true, state: record.state })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Decline credential offer ─────────────────────────────────────────────
  app.post('/decline-credential/:id', async (req, res) => {
    try {
      await agent.modules.didcomm.credentials.declineOffer({
        credentialExchangeRecordId: req.params.id,
      })
      res.json({ success: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Accept proof request (auto-selects credentials) ─────────────────────
  app.post('/accept-proof/:id', async (req, res) => {
    try {
      const selectedCredentials = await agent.modules.didcomm.proofs.selectCredentialsForRequest({
        proofExchangeRecordId: req.params.id,
      })
      const record = await agent.modules.didcomm.proofs.acceptRequest({
        proofExchangeRecordId: req.params.id,
        proofFormats: selectedCredentials.proofFormats,
      })
      res.json({ success: true, state: record.state })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Decline proof request ────────────────────────────────────────────────
  app.post('/decline-proof/:id', async (req, res) => {
    try {
      await agent.modules.didcomm.proofs.declineRequest({
        proofExchangeRecordId: req.params.id,
      })
      res.json({ success: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.listen(ADMIN_PORT, () => {
    console.log(`[wallet-agent] REST API running on http://localhost:${ADMIN_PORT}`)
  })

  process.on('SIGINT', async () => {
    await agent.shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[wallet-agent] Fatal error:', err)
  process.exit(1)
})
