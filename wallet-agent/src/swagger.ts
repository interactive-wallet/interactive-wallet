import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";
import { EFFECTIVE_WALLET_API_PORT } from "./config.js";

const spec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Wallet Agent API",
      version: "0.1.0",
      description:
        "REST API of the wallet agent, running in either holder or verifier role (AGENT_ROLE).",
    },
    servers: [{ url: `http://localhost:${EFFECTIVE_WALLET_API_PORT}` }],
  },
  apis: ["./dist/index.js", "./dist/verifier.js"],
});

export function mountSwagger(app: Express): void {
  app.get("/docs.json", (_req, res) => res.json(spec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
}
