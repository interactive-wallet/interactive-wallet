import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Native modules MUST be registered before @credo-ts/* modules are loaded.
// Dynamic imports with top-level await guarantee this evaluation order.
await import('@openwallet-foundation/askar-nodejs')
await import('@hyperledger/anoncreds-nodejs')
await import('@hyperledger/indy-vdr-nodejs')

const { createAgent } = await import('./agent.js')

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT ?? '3000', 10)

async function main() {
  const agent = createAgent()
  await agent.initialize()
  console.log('[wallet-agent] Agent initialized')

  const app = express()
  app.use(cors())
  app.use(express.json())
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/credentials', async (_req, res) => {
    try {
      const credentials = await agent.modules.anoncreds.getCredentials({})
      res.json(credentials)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.get('/exchanges', async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll()
      res.json(
        exchanges.map((e) => ({
          id: e.id,
          state: e.state,
          role: e.role,
          errorMessage: e.errorMessage,
          createdAt: e.createdAt,
        }))
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

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
        connectionState: connectionRecord?.state,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: message })
    }
  })

  app.listen(ADMIN_PORT, () => {
    console.log(`[wallet-agent] REST API running on http://localhost:${ADMIN_PORT}`)
    console.log(`[wallet-agent] Health check: http://localhost:${ADMIN_PORT}/health`)
  })

  process.on('SIGINT', async () => {
    console.log('\n[wallet-agent] Shutting down...')
    await agent.shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[wallet-agent] Fatal error:', err)
  process.exit(1)
})
