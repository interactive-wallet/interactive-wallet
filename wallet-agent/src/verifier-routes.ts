import { DidCommHandshakeProtocol } from "@credo-ts/didcomm";
import { Express } from "express";
import type { createAgent } from "./agent.js";
import { VERIFIER_HTTP_ENDPOINT } from "./config.js";
import type {
  IssuerCredentialConfig,
  VerifiedCredentialStore,
} from "./verifier.js";

export interface VerifierRouteDeps {
  agent: ReturnType<typeof createAgent>;
  issuerCredentialConfig: IssuerCredentialConfig;
  verifiedCredentials: VerifiedCredentialStore;
  verifierDid: string | null;
}

export function registerVerifierRoutes(
  app: Express,
  { agent, issuerCredentialConfig, verifiedCredentials, verifierDid }: VerifierRouteDeps,
) {
  // ─── Invitation ──────────────────────────────────────────────────────────
  // If /setup has run, the invitation carries the verifier's public did:indy
  // so that the holder wallet can resolve and verify it against the ledger
  // before connecting.
  /**
   * @openapi
   * /invitation:
   *   get:
   *     summary: Create the verifier's out-of-band connection invitation
   *     tags: [Verifier]
   *     responses:
   *       200:
   *         description: A new OOB invitation carrying the verifier's ledger DID (once /setup has run)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 invitationUrl: { type: string }
   *                 oobId: { type: string }
   *                 invitationDid: { type: string, nullable: true }
   *       500:
   *         description: Failed to create invitation
   */
  app.get("/invitation", async (_req, res) => {
    try {
      const oobRecord = await agent.modules.didcomm.oob.createInvitation({
        label: "CarGo Autovermietung",
        handshakeProtocols: [DidCommHandshakeProtocol.Connections],
      });
      // Inject `from` so the wallet app can show "VERIFIED IDENTITY" for the ledger DID.
      // Do NOT use invitationDid here — Credo's implicit-invitation path sets
      // autoAcceptConnection=false on the OOB record, which breaks the handshake.
      const oobJson = oobRecord.outOfBandInvitation.toJSON() as Record<
        string,
        unknown
      >;
      if (verifierDid) oobJson.from = verifierDid;
      const invitationUrl = `${VERIFIER_HTTP_ENDPOINT}?oob=${Buffer.from(JSON.stringify(oobJson)).toString("base64url")}`;
      res.json({
        invitationUrl,
        oobId: oobRecord.id,
        invitationDid: verifierDid,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Request proof ────────────────────────────────────────────────────────
  // Body: { connectionId, requestedAttributes?: string[] }
  // requestedAttributes: subset of Führerschein fields to request (default: all)

  /**
   * @openapi
   * /request-proof:
   *   post:
   *     summary: Request a Führerschein proof presentation from a connection
   *     tags: [Verifier]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [connectionId]
   *             properties:
   *               connectionId: { type: string }
   *               requestedAttributes:
   *                 type: array
   *                 items: { type: string }
   *                 description: "Subset of Führerschein fields to request (default: all)"
   *     responses:
   *       200:
   *         description: Proof request sent
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 proofExchangeId: { type: string }
   *                 state: { type: string }
   *                 nonRevocationTimestamp: { type: integer }
   *       400:
   *         description: Missing connectionId
   *       500:
   *         description: Requesting the proof failed
   */
  app.post("/request-proof", async (req, res) => {
    try {
      const { connectionId, requestedAttributes } = req.body as {
        connectionId: string;
        requestedAttributes?: string[];
      };

      if (!connectionId) {
        res.status(400).json({
          error: "Missing connectionId",
        });
        return;
      }

      const defaultAttributes = [
        "vorname",
        "nachname",
        "geburtsdatum",
        "fuehrerscheinklasse",
        "ausstellungsdatum",
      ];

      const requestedNames = [
        ...new Set([
          ...(requestedAttributes ??
            defaultAttributes),
          "credential_id",
        ]),
      ];

      const requested_attributes = {
        fuehrerschein_referent: {
          names: requestedNames,

          restrictions: [
            {
              cred_def_id:
                issuerCredentialConfig
                  .credentialDefinitionId,
              // schema_id makes the requested credential type explicit so the
              // holder UI can show "Führerschein" alongside the attributes.
              schema_id:
                issuerCredentialConfig
                  .schemaId,
            },
          ],
        },
      };

      // RFC 0441: non-revocation is requested for a single point in time,
      // not for the interval from 0 until now.
      const timestamp = Math.floor(Date.now() / 1000);

      const proofRecord = await agent.modules.didcomm.proofs.requestProof({
        connectionId,
        protocolVersion: "v2",
        proofFormats: {
          anoncreds: {
            name: "Führerschein Verification",
            version: "1.0",
            requested_attributes,
            requested_predicates: {},
            non_revoked: {
              to: timestamp,
            },
          },
        },
      });

      console.log(
        `[Verifier] Proof request sent with non-revocation timestamp ${timestamp} to connection ${connectionId}`,
      );

      res.json({
        proofExchangeId: proofRecord.id,
        state: proofRecord.state,
        nonRevocationTimestamp: timestamp,
      });
    } catch (err: unknown) {
      console.error("[Verifier] request-proof error:", err);

      const message = err instanceof Error ? err.message : String(err);

      res.status(500).json({
        error: message,
      });
    }
  });

  // ─── Get all proof exchanges ──────────────────────────────────────────────
  /**
   * @openapi
   * /proofs:
   *   get:
   *     summary: List all proof exchanges
   *     tags: [Verifier]
   *     responses:
   *       200:
   *         description: Array of proof exchange summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: string }
   *                   state: { type: string }
   *                   isVerified: { type: boolean, nullable: true }
   *                   connectionId: { type: string, nullable: true }
   *                   errorMessage: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load proof exchanges
   */
  app.get("/proofs", async (_req, res) => {
    try {
      const proofs = await agent.modules.didcomm.proofs.getAll();
      res.json(
        proofs.map((p) => ({
          id: p.id,
          state: p.state,
          isVerified: p.isVerified,
          connectionId: p.connectionId,
          errorMessage: p.errorMessage,
          createdAt: p.createdAt,
        })),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Verified credentials (drives the verifier's Wallet view) ─────────────
  // The verifier holds no AnonCreds of its own; instead it lists the credentials
  // it has verified, so the UI can show — and turn red — a credential that was
  // revoked *after* this verifier checked it. Registered here so it takes
  // precedence over the generic /credentials route in index.ts when
  // AGENT_ROLE=verifier. Revocation surfaces two ways: live via the SSE
  // `revocation` broadcast, and persistently via the `widerrufen_am` attribute
  // (set once status flips to "revoked-after-verification").
  /**
   * @openapi
   * /credentials:
   *   get:
   *     summary: List credentials this verifier has checked (verifier role)
   *     description: Overrides the generic /credentials route from index.ts when AGENT_ROLE=verifier. A credential revoked after verification carries a widerrufen_am attribute.
   *     tags: [Verifier]
   *     responses:
   *       200:
   *         description: Array of verified credentials
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   credentialId: { type: string }
   *                   schemaId: { type: string }
   *                   credentialDefinitionId: { type: string }
   *                   attributes: { type: object }
   *                   createdAt: { type: string, format: date-time }
   */
  app.get("/credentials", (_req, res) => {
    const list = Object.values(verifiedCredentials).map((rec) => ({
      credentialId: rec.credentialId,
      schemaId: rec.schemaId,
      credentialDefinitionId: rec.credentialDefinitionId,
      attributes: {
        credential_id: rec.credentialId,
        geprueft_am: rec.verifiedAt,
        ...(rec.status === "revoked-after-verification"
          ? { widerrufen_am: rec.revokedAt ?? "" }
          : {}),
      },
      createdAt: rec.verifiedAt,
    }));
    res.json(list);
  });

  // ─── Get single proof exchange ────────────────────────────────────────────
  /**
   * @openapi
   * /proofs/{id}:
   *   get:
   *     summary: Get a single proof exchange including its format data
   *     tags: [Verifier]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Proof exchange record ID
   *     responses:
   *       200:
   *         description: Proof exchange detail
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id: { type: string }
   *                 state: { type: string }
   *                 isVerified: { type: boolean, nullable: true }
   *                 connectionId: { type: string, nullable: true }
   *                 errorMessage: { type: string, nullable: true }
   *                 createdAt: { type: string, format: date-time }
   *                 formatData: { type: object, nullable: true }
   *       500:
   *         description: Failed to load proof exchange
   */
  app.get("/proofs/:id", async (req, res) => {
    try {
      const record = await agent.modules.didcomm.proofs.getById(req.params.id);
      const formatData =
        record.isVerified !== undefined
          ? await agent.modules.didcomm.proofs.getFormatData(req.params.id)
          : null;

      res.json({
        id: record.id,
        state: record.state,
        isVerified: record.isVerified,
        connectionId: record.connectionId,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
        formatData,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
