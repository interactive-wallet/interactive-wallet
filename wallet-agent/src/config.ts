export const {
  AGENT_ROLE = "holder",

  AGENT_LABEL = "interactive-wallet-agent",
  AGENT_ENDPOINT = "http://localhost:3001",

  WALLET_ID = "Wallet",
  WALLET_KEY = "interactive-wallet-key-change-in-prod",

  WALLET_API_PORT = "3000",
  ADMIN_PORT,
  INBOUND_PORT = "3001",

  HOLDER_DIDCOMM_MODE = "onboarding",

  WALLET_DOMAIN = "localhost",
  MEDIATOR_API_URL = "http://localhost:3006",

  VON_URL = "http://127.0.0.1:9000",
  INDY_NAMESPACE = "local:test",
  ISSUER_API_URL = "http://issuer:3002",

  RABBITMQ_URL = "amqp://localhost",
  ISSUER_ROUTING_ID = "fuehrerscheinstelle",
  CREDENTIAL_TYPE = "drivers-license",

  HOLDER_ID = "wallet",
  VERIFIER_ID = "autovermietung",

  VERIFIER_SEED = "Verifier_00000000000000000000000",
} = process.env;

if (
  AGENT_ROLE !== "holder" &&
  AGENT_ROLE !== "verifier"
) {
  throw new Error(
    "AGENT_ROLE must be 'holder' or 'verifier'",
  );
}

if (VERIFIER_SEED.length !== 32) {
  // console.log(
  //   "VERIFIER_SEED must be 32 characters:",
  //   VERIFIER_SEED,
  // );

  process.exit(1);
}

function validateRoutingSegment(
  name: string,
  value: string,
): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(
      `${name} contains invalid characters: ${value}. ` +
        "Allowed are letters, digits, _ and -.",
    );
  }
}

validateRoutingSegment(
  "ISSUER_ROUTING_ID",
  ISSUER_ROUTING_ID,
);

validateRoutingSegment(
  "CREDENTIAL_TYPE",
  CREDENTIAL_TYPE,
);

validateRoutingSegment(
  "HOLDER_ID",
  HOLDER_ID,
);

validateRoutingSegment(
  "VERIFIER_ID",
  VERIFIER_ID,
);

// Kept for backward compatibility with existing code:
export const VERIFIER_HTTP_ENDPOINT =
  AGENT_ENDPOINT;

// ADMIN_PORT alias, in case index.ts still uses WALLET_API_PORT:
export const EFFECTIVE_WALLET_API_PORT =
  ADMIN_PORT ?? WALLET_API_PORT;