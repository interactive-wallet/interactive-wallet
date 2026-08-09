export const {
  ISSUER_WALLET_ID = "Issuer",
  ISSUER_SEED = "Issuer_0000000000000000000000000",
  ISSUER_HTTP_PORT = "3003",
  ISSUER_API_PORT = "3002",
  ISSUER_DOMAIN = "localhost",
  VON_URL = "http://127.0.0.1:9000",
  INDY_NAMESPACE = "local:test",

  ISSUER_ROUTING_ID = "fuehrerscheinstelle",
  CREDENTIAL_TYPE = "drivers-license",
} = process.env;

if (ISSUER_SEED.length !== 32) {
  // console.log(`ISSUER_SEED must be 32 characters:`, ISSUER_SEED);
  process.exit(1);
}

export const ISSUER_HTTP_ENDPOINT = `http://${ISSUER_DOMAIN}:${ISSUER_HTTP_PORT}`;

