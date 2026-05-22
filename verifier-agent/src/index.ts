import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// Native modules MUST be registered before @credo-ts/* modules are loaded.
await import('@openwallet-foundation/askar-nodejs')
await import('@hyperledger/anoncreds-nodejs')
await import('@hyperledger/indy-vdr-nodejs')

const { createAgent } = await import('./agent.js')

import { TypedArrayEncoder } from '@credo-ts/core'
import { DidCommHandshakeProtocol } from '@credo-ts/didcomm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(__dirname, '..', 'verifier-state.json')
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3004', 10)
const VON_NETWORK_URL = process.env.VON_NETWORK_URL ?? 'http://localhost:9000'
const INDY_NAMESPACE = process.env.INDY_NAMESPACE ?? 'local:test'
const VERIFIER_SEED = process.env.VERIFIER_SEED ?? '0000000000000InteractiveVerifier'

if (Buffer.byteLength(VERIFIER_SEED, 'utf8') !== 32) {
  throw new Error(`VERIFIER_SEED must be exactly 32 bytes, got ${Buffer.byteLength(VERIFIER_SEED, 'utf8')}`)
}

interface VerifierState {
  verifierDid: string
}

function loadState(): VerifierState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return null
}

function saveState(state: VerifierState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function main() {
  const agent = createAgent()
  await agent.initialize()
  console.log('[verifier-agent] Agent initialized')

  const app = express()
  app.use(cors())
  app.use(express.json())

  // ─── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    const state = loadState()
    res.json({ status: 'ok', hasSetup: state !== null })
  })

  // ─── State ───────────────────────────────────────────────────────────────
  app.get('/state', (_req, res) => {
    const state = loadState()
    if (!state) {
      res.json({ setup: false, message: 'Run POST /setup to register a public verifier DID' })
      return
    }
    res.json({ setup: true, ...state })
  })

  // ─── Setup (one-time): register verifier NYM on VON ──────────────────────
  app.post('/setup', async (_req, res) => {
    try {
      const existing = loadState()
      if (existing) {
        res.json({ message: 'Already set up', ...existing })
        return
      }

      console.log('[verifier-agent] Registering DID on VON...')
      const vonResponse = await fetch(`${VON_NETWORK_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: VERIFIER_SEED, role: 'ENDORSER', alias: 'Interactive Verifier' }),
      })
      if (!vonResponse.ok) throw new Error(`VON registration failed: ${await vonResponse.text()}`)
      const { did: shortDid, verkey } = await vonResponse.json() as { did: string; verkey: string }
      const verifierDid = `did:indy:${INDY_NAMESPACE}:${shortDid}`
      console.log(`[verifier-agent] DID registered on VON: ${verifierDid}`)

      // Import private key into KMS using JWK
      const seedBuffer = Buffer.alloc(32)
      Buffer.from(VERIFIER_SEED).copy(seedBuffer)
      const pubKeyBytes = TypedArrayEncoder.fromBase58(verkey)

      const { keyId: kmsKeyId } = await agent.kms.importKey({
        privateJwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: Buffer.from(pubKeyBytes).toString('base64url'),
          d: seedBuffer.toString('base64url'),
        },
      })

      await agent.dids.import({
        did: verifierDid,
        overwrite: true,
        keys: [{ kmsKeyId, didDocumentRelativeKeyId: '#verkey' }],
      })
      console.log('[verifier-agent] DID imported into wallet')

      const state: VerifierState = { verifierDid }
      saveState(state)
      res.json({ message: 'Setup complete', ...state })
    } catch (err: unknown) {
      console.error('[verifier-agent] Setup error:', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Invitation ──────────────────────────────────────────────────────────
  // If /setup has run, the invitation carries the verifier's public did:indy
  // so that the holder wallet can resolve and verify it against the ledger
  // before connecting.
  app.get('/invitation', async (_req, res) => {
    try {
      const state = loadState()
      const oobRecord = await agent.modules.didcomm.oob.createInvitation({
        label: process.env.AGENT_LABEL ?? 'Interactive Verifier',
        invitationDid: state?.verifierDid,
        handshakeProtocols: [DidCommHandshakeProtocol.Connections],
      })
      res.json({
        invitationUrl: oobRecord.outOfBandInvitation.toUrl({
          domain: process.env.AGENT_ENDPOINT ?? 'http://localhost:3005',
        }),
        oobId: oobRecord.id,
        invitationDid: state?.verifierDid ?? null,
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
    console.log(`  POST /setup  GET /invitation  GET /connections  POST /request-proof  GET /proofs`)
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
