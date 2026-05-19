import 'dotenv/config'
import express, { type Response } from 'express'
import cors from 'cors'
import * as path from 'path'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

await import('@openwallet-foundation/askar-nodejs')
await import('@hyperledger/anoncreds-nodejs')
await import('@hyperledger/indy-vdr-nodejs')

const { createAgent } = await import('./agent.js')

import {
  DidCommProofEventTypes,
  DidCommCredentialEventTypes,
  DidCommConnectionEventTypes,
  DidCommHandshakeProtocol,
} from '@credo-ts/didcomm'
import { Buffer } from 'buffer'

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3000', 10)

// SSE client registry
const sseClients = new Set<Response>()

function broadcast(type: string, data: object) {
  const msg = `data: ${JSON.stringify({ type, ...data, ts: new Date().toISOString() })}\n\n`
  for (const client of sseClients) {
    client.write(msg)
  }
}

function didKeyMultibaseToVerkey(publicKeyMultibase: string): string {
  if (!publicKeyMultibase.startsWith('z')) {
    throw new Error(`Unsupported multibase key: ${publicKeyMultibase}`)
  }

  const bytes = bs58.decode(publicKeyMultibase.slice(1))

  // Ed25519 multicodec prefix for did:key z6Mk...
  if (bytes[0] === 0xed && bytes[1] === 0x01) {
    return bs58.encode(bytes.slice(2))
  }

  throw new Error(`Unsupported did:key multicodec prefix: ${bytes[0]}, ${bytes[1]}`)
}

function jwkXToVerkey(x: string): string {
  return bs58.encode(Buffer.from(x, 'base64url'))
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

  app.get('/invitation', async (_req, res) => {
    try {
      const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
        label: process.env.AGENT_LABEL ?? 'Interactive Wallet',
        autoAcceptConnection: true,
        handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
      })

      res.json({
        outOfBandRecordId: outOfBandRecord.id,
        invitationUrl: outOfBandRecord.outOfBandInvitation.toUrl({
          domain: process.env.AGENT_INVITATION_DOMAIN ?? 'http://localhost:3000',
        }),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.post('/notify-keylist/:connectionId', async (req, res) => {
    try {
      // This is the Holder-side connection to Issuer/Verifier
      const targetConnection =
        await agent.modules.didcomm.connections.getById(req.params.connectionId)

      if (!targetConnection.did) {
        res.status(400).json({ error: 'Target connection has no own did' })
        return
      }

      // Resolve Holder's own peer DID for this connection
      const resolved = await agent.dids.resolve(targetConnection.did)
      const didDocument = resolved.didDocument

      if (!didDocument) {
        res.status(400).json({ error: `Could not resolve DID document for ${targetConnection.did}` })
        return
      }

      const didCommService = didDocument.service?.find((service: any) => {
        return (
          service.type === 'did-communication' ||
          service.type === 'DIDCommMessaging' ||
          service.type === 'DIDComm'
        )
      }) as any

      if (!didCommService) {
        res.status(400).json({
          error: 'No DIDComm service found on target connection DID document',
          did: targetConnection.did,
          services: didDocument.service,
        })
        return
      }

      const recipientKeyRef = didCommService.recipientKeys?.[0]

      if (!recipientKeyRef) {
        res.status(400).json({
          error: 'No recipient key found on DIDComm service',
          service: didCommService,
        })
        return
      }

      const verificationMethodId = recipientKeyRef.startsWith('#')
        ? `${targetConnection.did}${recipientKeyRef}`
        : recipientKeyRef

      const verificationMethods = [
        ...(didDocument.verificationMethod ?? []),
        ...(didDocument.authentication ?? []).filter((m: any) => typeof m === 'object'),
        ...(didDocument.keyAgreement ?? []).filter((m: any) => typeof m === 'object'),
        ...(didDocument.assertionMethod ?? []).filter((m: any) => typeof m === 'object'),
        ...(didDocument.capabilityInvocation ?? []).filter((m: any) => typeof m === 'object'),
        ...(didDocument.capabilityDelegation ?? []).filter((m: any) => typeof m === 'object'),
      ]

      const verificationMethod = verificationMethods.find((method: any) => {
        return (
          method.id === verificationMethodId ||
          method.id === recipientKeyRef ||
          method.id?.endsWith(recipientKeyRef)
        )
      }) as any

      if (!verificationMethod) {
        res.status(400).json({
          error: 'Could not find verification method for recipient key',
          did: targetConnection.did,
          recipientKeyRef,
          verificationMethodId,
          verificationMethods,
          rawDidDocument: didDocument,
        })
        return
      }

      const verkey =
        verificationMethod.publicKeyBase58 ??
        (verificationMethod.publicKeyMultibase
          ? didKeyMultibaseToVerkey(verificationMethod.publicKeyMultibase)
          : undefined)

      if (!verkey) {
        res.status(400).json({
          error: 'Verification method has no publicKeyBase58 or publicKeyMultibase',
          verificationMethod,
        })
        return
      }

      // This is the Holder-side connection to the Mediator
      const mediatorConnection =
        await agent.modules.mediationRecipient.findDefaultMediatorConnection()

      if (!mediatorConnection) {
        res.status(400).json({ error: 'No default mediator connection found' })
        return
      }

      await agent.modules.mediationRecipient.notifyKeylistUpdate(
        mediatorConnection,
        verkey,
      )

      res.json({
        success: true,
        message: 'Keylist update sent to mediator',
        targetConnectionId: targetConnection.id,
        targetTheirLabel: targetConnection.theirLabel,
        targetDid: targetConnection.did,
        mediatorConnectionId: mediatorConnection.id,
        recipientKeyRef,
        verificationMethodId,
        verkey,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.post('/register-current-routing-key', async (_req, res) => {
    try {
      const defaultMediator =
        await agent.modules.mediationRecipient.findDefaultMediator()

      if (!defaultMediator) {
        res.status(400).json({ error: 'No default mediator found' })
        return
      }

      const mediatorConnection =
        await agent.modules.mediationRecipient.findDefaultMediatorConnection()

      if (!mediatorConnection) {
        res.status(400).json({ error: 'No default mediator connection found' })
        return
      }

      const routing = await agent.modules.mediationRecipient.getRouting({
        mediatorId: defaultMediator.id,
      })

      const recipientJwk = (routing as any).recipientKey?.jwk?.jwk
      const x = recipientJwk?.x

      if (!x) {
        res.status(400).json({
          error: 'No recipientKey.jwk.jwk.x found in routing',
          routing,
        })
        return
      }

      const verkey = jwkXToVerkey(x)

      await agent.modules.mediationRecipient.notifyKeylistUpdate(
        mediatorConnection,
        verkey,
      )

      res.json({
        success: true,
        message: 'Explicit keylist update sent to mediator',
        mediationRecordId: defaultMediator.id,
        mediatorConnectionId: mediatorConnection.id,
        verkey,
        routing,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/connection-did-debug/:connectionId', async (req, res) => {
    try {
      const connection =
        await agent.modules.didcomm.connections.getById(req.params.connectionId)

      if (!connection.did) {
        res.status(400).json({ error: 'Connection has no own did' })
        return
      }

      const resolved = await agent.dids.resolve(connection.did)

      res.json({
        connectionId: connection.id,
        theirLabel: connection.theirLabel,
        did: connection.did,
        theirDid: connection.theirDid,
        didDocument: resolved.didDocument,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })


  app.post('/notify-keylist-verkey', async (req, res) => {
    try {
      const { verkey } = req.body as { verkey: string }

      if (!verkey) {
        res.status(400).json({ error: 'Missing verkey' })
        return
      }

      const mediatorConnection =
        await agent.modules.mediationRecipient.findDefaultMediatorConnection()

      if (!mediatorConnection) {
        res.status(400).json({ error: 'No default mediator connection found' })
        return
      }

      await agent.modules.mediationRecipient.notifyKeylistUpdate(
        mediatorConnection,
        verkey,
      )

      res.json({
        success: true,
        message: 'Keylist update sent to mediator',
        mediatorConnectionId: mediatorConnection.id,
        verkey,
      })
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

  app.post('/pickup-messages', async (_req, res) => {
    try {
      const defaultMediator = await agent.modules.mediationRecipient.findDefaultMediator()

      if (!defaultMediator) {
        res.status(400).json({ error: 'No default mediator found' })
        return
      }

      await agent.modules.mediationRecipient.initiateMessagePickup(defaultMediator)

      res.json({
        success: true,
        message: 'Message pickup initiated',
        mediationRecordId: defaultMediator.id,
        state: defaultMediator.state,
        connectionId: defaultMediator.connectionId,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/message-pickup-methods', (_req, res) => {
    try {
      const api = (agent.modules.mediationRecipient as any).messagePickupApi

      const methods = [
        ...Object.getOwnPropertyNames(Object.getPrototypeOf(api)),
        ...Object.keys(api),
      ]

      res.json([...new Set(methods)].sort())
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.post('/pickup-now', async (_req, res) => {
    try {
      const defaultMediator =
        await agent.modules.mediationRecipient.findDefaultMediator()

      if (!defaultMediator) {
        res.status(400).json({ error: 'No default mediator found' })
        return
      }

      const mediatorConnection =
        await agent.modules.mediationRecipient.findDefaultMediatorConnection()

      if (!mediatorConnection) {
        res.status(400).json({
          error: 'No default mediator connection found',
          mediationRecordId: defaultMediator.id,
          mediationConnectionId: defaultMediator.connectionId,
        })
        return
      }

      const messagePickupApi =
        (agent.modules.mediationRecipient as any).messagePickupApi

      const result = await messagePickupApi.pickupMessages({
        connectionId: mediatorConnection.id,
        batchSize: 10,
        protocolVersion: 'v2',
      })

      res.json({
        success: true,
        message: 'Pickup executed',
        mediationRecordId: defaultMediator.id,
        mediationState: defaultMediator.state,
        mediationConnectionId: defaultMediator.connectionId,
        actualConnectionId: mediatorConnection.id,
        result,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.post('/refresh-mediator-routing', async (_req, res) => {
    try {
      const defaultMediator =
        await agent.modules.mediationRecipient.findDefaultMediator()

      if (!defaultMediator) {
        res.status(400).json({ error: 'No default mediator found' })
        return
      }

      const routing = await agent.modules.mediationRecipient.getRouting({
        mediatorId: defaultMediator.id,
      })

      res.json({
        success: true,
        mediationRecordId: defaultMediator.id,
        mediationState: defaultMediator.state,
        routing,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/default-mediator-debug', async (_req, res) => {
    try {
      const defaultMediator =
        await agent.modules.mediationRecipient.findDefaultMediator()

      const mediatorConnection =
        await agent.modules.mediationRecipient.findDefaultMediatorConnection()

      res.json({
        defaultMediator: defaultMediator
          ? {
              id: defaultMediator.id,
              state: defaultMediator.state,
              connectionId: defaultMediator.connectionId,
            }
          : null,
        mediatorConnection: mediatorConnection
          ? {
              id: mediatorConnection.id,
              state: mediatorConnection.state,
              theirLabel: mediatorConnection.theirLabel,
              did: mediatorConnection.did,
              theirDid: mediatorConnection.theirDid,
            }
          : null,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/mediation-recipient-signatures', (_req, res) => {
    try {
      const api = agent.modules.mediationRecipient as any

      res.json({
        notifyKeylistUpdate: String(api.notifyKeylistUpdate).slice(0, 2000),
        getRouting: String(api.getRouting).slice(0, 2000),
        findDefaultMediator: String(api.findDefaultMediator).slice(0, 1000),
      })
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

  app.get('/mediation-recipient-methods', (_req, res) => {
    const api = agent.modules.mediationRecipient as any

    const methods = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(api)),
      ...Object.keys(api),
    ]

    res.json([...new Set(methods)].sort())
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
