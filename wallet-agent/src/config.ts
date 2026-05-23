export const {
  WALLET_WALLET_ID = "Wallet",
  WALLET_SEED = "Wallet_0000000000000000000000000",
  WALLET_API_PORT = "3000",
  WALLET_DOMAIN = "localhost",
  MEDIATOR_API_URL = "http://localhost:3006",
  VON_URL = "http://127.0.0.1:9000",
  INDY_NAMESPACE = "local:test",
} = process.env;

if (WALLET_SEED.length !== 32) {
  console.log(`WALLET_SEED must be 32 characters:`, WALLET_SEED);
  process.exit(1);
}
