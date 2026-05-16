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
const STATE_FILE = path.join(__dirname, '..', 'issuer-state.json')
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3002', 10)
const VON_NETWORK_URL = process.env.VON_NETWORK_URL ?? 'http://localhost:9000'
const INDY_NAMESPACE = process.env.INDY_NAMESPACE ?? 'local:test'
const ISSUER_SEED = process.env.ISSUER_SEED ?? '0000000000000InteractiveIssuer1'

interface IssuerState {
  issuerDid: string
  schemaId: string
  credDefId: string
}

function loadState(): IssuerState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return null
}

function saveState(state: IssuerState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

async function main() {
  const agent = createAgent()
  await agent.initialize()
  console.log('[issuer-agent] Agent initialized')

  const app = express()
  app.use(cors())
  app.use(express.json())

  // ─── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    const state = loadState()
    res.json({ status: 'ok', initialized: true, hasSetup: state !== null })
  })

  // ─── State ───────────────────────────────────────────────────────────────
  app.get('/state', (_req, res) => {
    const state = loadState()
    if (!state) {
      res.json({ setup: false, message: 'Run POST /setup first' })
      return
    }
    res.json({ setup: true, ...state })
  })

  // ─── Setup (one-time) ────────────────────────────────────────────────────
  app.post('/setup', async (_req, res) => {
    try {
      const existing = loadState()
      if (existing) {
        res.json({ message: 'Already set up', ...existing })
        return
      }

      // 1. Register DID on VON
      console.log('[issuer-agent] Registering DID on VON...')
      const vonResponse = await fetch(`${VON_NETWORK_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: ISSUER_SEED, role: 'ENDORSER', alias: 'Interactive Issuer' }),
      })
      if (!vonResponse.ok) throw new Error(`VON registration failed: ${await vonResponse.text()}`)
      const { did: shortDid, verkey } = await vonResponse.json() as { did: string; verkey: string }
      const issuerDid = `did:indy:${INDY_NAMESPACE}:${shortDid}`
      console.log(`[issuer-agent] DID registered on VON: ${issuerDid}`)

      // 2. Import private key into KMS using JWK
      const seedBuffer = Buffer.alloc(32)
      Buffer.from(ISSUER_SEED).copy(seedBuffer)
      const pubKeyBytes = TypedArrayEncoder.fromBase58(verkey)

      const { keyId: kmsKeyId } = await agent.kms.importKey({
        privateJwk: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: Buffer.from(pubKeyBytes).toString('base64url'),
          d: seedBuffer.toString('base64url'),
        },
      })

      // 3. Import DID into agent wallet
      await agent.dids.import({
        did: issuerDid,
        overwrite: true,
        keys: [{ kmsKeyId, didDocumentRelativeKeyId: '#verkey' }],
      })
      console.log('[issuer-agent] DID imported into wallet')

      // 4. Register schema
      console.log('[issuer-agent] Registering schema...')
      const schemaResult = await agent.modules.anoncreds.registerSchema({
        schema: {
          attrNames: ['vorname', 'nachname', 'geburtsdatum', 'fuehrerscheinklasse', 'ausstellungsdatum'],
          issuerId: issuerDid,
          name: 'Fuehrerschein',
          version: '1.0',
        },
        options: { endorserMode: 'internal', endorserDid: issuerDid },
      })
      if (schemaResult.schemaState.state !== 'finished') {
        throw new Error(`Schema registration failed: ${JSON.stringify(schemaResult.schemaState)}`)
      }
      const schemaId = schemaResult.schemaState.schemaId
      console.log(`[issuer-agent] Schema registered: ${schemaId}`)

      // 5. Register credential definition
      console.log('[issuer-agent] Registering credential definition...')
      const credDefResult = await agent.modules.anoncreds.registerCredentialDefinition({
        credentialDefinition: { issuerId: issuerDid, schemaId, tag: 'default' },
        options: { endorserMode: 'internal', endorserDid: issuerDid, supportRevocation: false },
      })
      if (credDefResult.credentialDefinitionState.state !== 'finished') {
        throw new Error(`CredDef registration failed: ${JSON.stringify(credDefResult.credentialDefinitionState)}`)
      }
      const credDefId = credDefResult.credentialDefinitionState.credentialDefinitionId
      console.log(`[issuer-agent] CredDef registered: ${credDefId}`)

      const state: IssuerState = { issuerDid, schemaId, credDefId }
      saveState(state)
      res.json({ message: 'Setup complete', ...state })
    } catch (err: unknown) {
      console.error('[issuer-agent] Setup error:', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Invitation ──────────────────────────────────────────────────────────
  app.get('/invitation', async (_req, res) => {
    try {
      const oobRecord = await agent.modules.didcomm.oob.createInvitation({
        label: process.env.AGENT_LABEL ?? 'Interactive Issuer',
        handshakeProtocols: [DidCommHandshakeProtocol.Connections],
      })
      res.json({
        invitationUrl: oobRecord.outOfBandInvitation.toUrl({
          domain: process.env.AGENT_ENDPOINT ?? 'http://localhost:3003',
        }),
        invitation: oobRecord.outOfBandInvitation.toJSON(),
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
      res.json(connections.map((c) => ({ id: c.id, state: c.state, theirLabel: c.theirLabel, createdAt: c.createdAt })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Exchanges ───────────────────────────────────────────────────────────
  app.get('/exchanges', async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll()
      res.json(exchanges.map((e) => ({ id: e.id, state: e.state, role: e.role, errorMessage: e.errorMessage, createdAt: e.createdAt })))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  // ─── Issue Führerschein (AnonCreds) ──────────────────────────────────────
  app.post('/issue', async (req, res) => {
    try {
      const state = loadState()
      if (!state) {
        res.status(400).json({ error: 'Not set up yet. Call POST /setup first.' })
        return
      }

      const { connectionId, vorname, nachname, geburtsdatum, fuehrerscheinklasse, ausstellungsdatum } = req.body as {
        connectionId: string
        vorname: string
        nachname: string
        geburtsdatum: string
        fuehrerscheinklasse: string
        ausstellungsdatum: string
      }

      if (!connectionId || !vorname || !nachname || !geburtsdatum || !fuehrerscheinklasse || !ausstellungsdatum) {
        res.status(400).json({ error: 'Missing required fields' })
        return
      }

      const credentialExchangeRecord = await agent.modules.didcomm.credentials.offerCredential({
        connectionId,
        protocolVersion: 'v2',
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: state.credDefId,
            attributes: [
              { name: 'vorname', value: vorname },
              { name: 'nachname', value: nachname },
              { name: 'geburtsdatum', value: geburtsdatum },
              { name: 'fuehrerscheinklasse', value: fuehrerscheinklasse },
              { name: 'ausstellungsdatum', value: ausstellungsdatum },
            ],
          },
        },
      })

      console.log(`[issuer-agent] Credential offer sent to connection ${connectionId}`)
      res.json({ success: true, message: 'Führerschein credential offer sent', credentialExchangeId: credentialExchangeRecord.id })
    } catch (err: unknown) {
      console.error('[issuer-agent] Issue error:', err)
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.listen(ADMIN_PORT, () => {
    console.log(`[issuer-agent] REST API running on http://localhost:${ADMIN_PORT}`)
    console.log(`  POST /setup  GET /invitation  GET /connections  POST /issue`)
  })

  process.on('SIGINT', async () => {
    await agent.shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[issuer-agent] Fatal error:', err)
  process.exit(1)
})
