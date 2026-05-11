import 'dotenv/config'
import express from 'express'
import cors from 'cors'

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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
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
