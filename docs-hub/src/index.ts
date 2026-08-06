import "dotenv/config";
import express from "express";
import swaggerUi from "swagger-ui-express";

// Browsers fetch these spec URLs client-side, so they must resolve from the
// user's machine (host-mapped ports), not from inside the docker network.
const ISSUER_DOCS_URL = process.env.ISSUER_DOCS_URL ?? "http://localhost:3002/docs.json";
const WALLET_DOCS_URL = process.env.WALLET_DOCS_URL ?? "http://localhost:3000/docs.json";
const VERIFIER_DOCS_URL = process.env.VERIFIER_DOCS_URL ?? "http://localhost:3004/docs.json";
const MEDIATOR_DOCS_URL = process.env.MEDIATOR_DOCS_URL ?? "http://localhost:3006/docs.json";
const DOCS_HUB_PORT = process.env.DOCS_HUB_PORT ?? "3009";

const app = express();

app.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    explorer: true,
    swaggerOptions: {
      urls: [
        { url: ISSUER_DOCS_URL, name: "Issuer Agent" },
        { url: WALLET_DOCS_URL, name: "Wallet Agent (Holder)" },
        { url: VERIFIER_DOCS_URL, name: "Wallet Agent (Verifier)" },
        { url: MEDIATOR_DOCS_URL, name: "Mediator" },
      ],
    },
  }),
);

app.listen(+DOCS_HUB_PORT, () => {
  console.log(`[docs-hub] Combined API docs running on http://localhost:${DOCS_HUB_PORT}`);
});
