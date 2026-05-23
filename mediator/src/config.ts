export const {
  MEDIATOR_WALLET_ID = "Mediator",
  MEDIATOR_SEED = "Mediator_00000000000000000000000",
  MEDIATOR_HTTP_PORT = "3007",
  MEDIATOR_WS_PORT = "3008",
  MEDIATOR_API_PORT = "3006",
  MEDIATOR_DOMAIN = "localhost",
  VON_URL = "http://127.0.0.1:9000",
  INDY_NAMESPACE = "local:test",
} = process.env;

if (MEDIATOR_SEED.length !== 32) {
  console.log(`MEDIATOR_SEED must be 32 characters:`, MEDIATOR_SEED);
  process.exit(1);
}

export const MEDIATOR_HTTP_ENDPOINT = `http://${MEDIATOR_DOMAIN}:${MEDIATOR_HTTP_PORT}`;
export const MEDIATOR_WS_ENDPOINT = `ws://${MEDIATOR_DOMAIN}:${MEDIATOR_WS_PORT}`;
