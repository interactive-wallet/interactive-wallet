export const {
  AGENT_ROLE = "holder",
  AGENT_LABEL = "interactive-wallet-agent",

  WALLET_ID = "Wallet",
  WALLET_KEY = "",

  WALLET_API_PORT = "3000",
  INBOUND_PORT = "3001",

  WALLET_DOMAIN = "localhost",

  MEDIATOR_API_URL =
    "http://localhost:3006",

  VON_URL =
    "http://127.0.0.1:9000",

  INDY_NAMESPACE =
    "local:test",

  ISSUER_API_URL =
    "http://issuer:3002",

  RABBITMQ_URL =
    "amqp://localhost",

  ISSUER_ROUTING_ID =
    "fuehrerscheinstelle",

  CREDENTIAL_TYPE =
    "drivers-license",

  HOLDER_ID =
    "wallet",

  VERIFIER_ID =
    "autovermietung",

  VERIFIER_SEED =
    "Verifier_00000000000000000000000",
} = process.env;

if (
  AGENT_ROLE !== "holder" &&
  AGENT_ROLE !== "verifier"
) {
  throw new Error(
    "AGENT_ROLE muss 'holder' oder 'verifier' sein",
  );
}

if (!WALLET_ID) {
  throw new Error(
    "WALLET_ID fehlt",
  );
}

if (!WALLET_KEY) {
  throw new Error(
    "WALLET_KEY fehlt",
  );
}

if (
  AGENT_ROLE === "verifier" &&
  VERIFIER_SEED.length !== 32
) {
  throw new Error(
    `VERIFIER_SEED muss genau 32 Zeichen lang sein. ` +
      `Aktuell: ${VERIFIER_SEED.length}`,
  );
}

function validateRoutingSegment(
  name: string,
  value: string,
): void {
  if (
    !/^[A-Za-z0-9_-]+$/.test(
      value,
    )
  ) {
    throw new Error(
      `${name} enthält ungültige Zeichen: ${value}`,
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

export const AGENT_ENDPOINT =
  process.env.AGENT_ENDPOINT ??
  `http://${WALLET_DOMAIN}:${INBOUND_PORT}`;

export const VERIFIER_HTTP_ENDPOINT =
  AGENT_ROLE === "verifier"
    ? AGENT_ENDPOINT
    : "";

export const EFFECTIVE_WALLET_API_PORT =
  WALLET_API_PORT;