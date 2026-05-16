import 'dotenv/config'
await import('@openwallet-foundation/askar-nodejs')

const{ createMediatorAgent } = await import('./agent.js')

async function main() {
    const agent = createMediatorAgent()
    await agent.initialize()
    console.log('[mediator] Mediator agent started...')
    console.log(`[mediator] Endpoint: ${process.env.MEDIATOR_ENDPOINT ?? 'http://localhost:3005'}`)

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