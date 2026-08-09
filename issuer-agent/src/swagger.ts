import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { Express } from "express";
import { ISSUER_API_PORT } from "./config.js";

const spec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Issuer Agent API",
      version: "0.1.0",
      description: "REST API of the Führerschein (driving license) credential issuer agent.",
    },
    servers: [{ url: `http://localhost:${ISSUER_API_PORT}` }],
  },
  apis: ["./dist/index.js", "./dist/issuer-routes.js"],
});

export function mountSwagger(app: Express): void {
  app.get("/docs.json", (_req, res) => res.json(spec));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
}
