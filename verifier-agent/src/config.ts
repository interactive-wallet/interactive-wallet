export const {
  VERIFIER_WALLET_ID = "Verifier",
  VERIFIER_SEED = "Verifier_00000000000000000000000",
  VERIFIER_HTTP_PORT = "3005",
  VERIFIER_API_PORT = "3004",
  VERIFIER_DOMAIN = "localhost",
  VON_URL = "http://127.0.0.1:9000",
  INDY_NAMESPACE = "local:test",
} = process.env;

if (VERIFIER_SEED.length !== 32) {
  console.log(`VERIFIER_SEED must be 32 characters:`, VERIFIER_SEED);
  process.exit(1);
}

export const VERIFIER_HTTP_ENDPOINT = `http://${VERIFIER_DOMAIN}:${VERIFIER_HTTP_PORT}`;
