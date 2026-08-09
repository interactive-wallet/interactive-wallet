import type { Express } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ISSUER_HTTP_ENDPOINT } from "./config.js";
import { publishCredentialRevoked } from "./rabbitmq.js";

export interface IssuerState {
  issuerDid: string;
  schemaId: string;
  credDefId: string;
  revocRegDefId: string;

  // Index of the next free slot in the revocation registry;
  // the registry supports a maximum of 100 credentials.
  nextRevocationIndex?: number;
}

interface IssuedCredentialRecord {
  credentialId: string;
  credentialExchangeId: string;
  connectionId: string;
  credentialDefinitionId: string;
  revocationRegistryDefinitionId: string;
  credentialRevocationId: string;
  createdAt: string;
  status: "offered" | "revoked";
  revokedAt?: string;
}

type IssuedCredentialStore = Record<string, IssuedCredentialRecord>;

const ISSUED_CREDENTIALS_FILE = path.join(
  import.meta.dirname,
  "..",
  "issued-credentials.json",
);

function loadIssuedCredentials(): IssuedCredentialStore {
  try {
    return JSON.parse(
      fs.readFileSync(ISSUED_CREDENTIALS_FILE, "utf-8"),
    ) as IssuedCredentialStore;
  } catch {
    return {};
  }
}

const issuedCredentials = loadIssuedCredentials();

function saveIssuedCredentials(): void {
  fs.writeFileSync(
    ISSUED_CREDENTIALS_FILE,
    JSON.stringify(issuedCredentials, null, 2),
  );
}

export function registerIssuerRoutes(
  app: Express,
  agent: any,
  state: IssuerState,
  reserveNextRevocationIndex: () => number,
  DidCommHandshakeProtocol: any,
  AnonCredsCredentialMetadataKey: any,
): void {
  // ─── Health ─────────────────────────────────────────────────────────────
  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Health check
   *     tags: [Issuer]
   *     responses:
   *       200:
   *         description: Service status and whether one-time ledger setup has completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status: { type: string, example: ok }
   *                 hasSetup: { type: boolean }
   */
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", hasSetup: state !== null });
  });

  // ─── Invitation ─────────────────────────────────────────────────────────
  /**
   * @openapi
   * /invitation:
   *   get:
   *     summary: Create an out-of-band connection invitation
   *     tags: [Issuer]
   *     responses:
   *       200:
   *         description: A new OOB invitation from the issuer
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 invitationUrl: { type: string }
   *                 invitation: { type: object }
   *                 oobId: { type: string }
   *                 invitationDid: { type: string, nullable: true }
   *       500:
   *         description: Failed to create invitation
   */
  app.get("/invitation", async (_req, res) => {
    try {
      const oobRecord = await agent.modules.didcomm.oob.createInvitation({
        label: "Führerscheinstelle",
        autoAcceptConnection: true,
        handshakeProtocols: [DidCommHandshakeProtocol.Connections],
      });
      const oobJson = oobRecord.outOfBandInvitation.toJSON() as Record<string, unknown>;
      if (state?.issuerDid) oobJson.from = state.issuerDid;
      const invitationUrl = `${ISSUER_HTTP_ENDPOINT}?oob=${Buffer.from(JSON.stringify(oobJson)).toString("base64url")}`;
      res.json({
        invitationUrl,
        invitation: oobJson,
        oobId: oobRecord.id,
        invitationDid: state?.issuerDid ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Connections ────────────────────────────────────────────────────────
  /**
   * @openapi
   * /connections:
   *   get:
   *     summary: List DIDComm connections
   *     tags: [Issuer]
   *     responses:
   *       200:
   *         description: Array of connection summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: string }
   *                   state: { type: string }
   *                   role: { type: string }
   *                   theirLabel: { type: string, nullable: true }
   *                   did: { type: string, nullable: true }
   *                   theirDid: { type: string, nullable: true }
   *                   invitationDid: { type: string, nullable: true }
   *                   outOfBandId: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load connections
   */
  app.get("/connections", async (_req, res) => {
    try {
      const connections = await agent.modules.didcomm.connections.getAll();
      res.json(
        connections.map((connection: any) => ({
          id: connection.id,
          state: connection.state,
          role: connection.role,
          theirLabel: connection.theirLabel,
          did: connection.did,
          theirDid: connection.theirDid,
          invitationDid: connection.invitationDid,
          outOfBandId: connection.outOfBandId,
          createdAt: connection.createdAt,
        })),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Issue Führerschein (AnonCreds) ────────────────────────────────────
  /**
   * @openapi
   * /issue:
   *   post:
   *     summary: Issue a Führerschein (driving license) AnonCreds credential to a connection
   *     tags: [Issuer]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [connectionId]
   *             properties:
   *               connectionId: { type: string }
   *               vorname: { type: string, default: Anna }
   *               nachname: { type: string, default: Schmidt }
   *               geburtsdatum: { type: string, default: "1985-06-20" }
   *               fuehrerscheinklasse: { type: string, default: A }
   *               ausstellungsdatum: { type: string, default: "2023-01-10" }
   *     responses:
   *       200:
   *         description: Credential offer sent
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 message: { type: string }
   *                 credentialExchangeId: { type: string }
   *                 revocationRegistryDefinitionId: { type: string }
   *                 revocationRegistryIndex: { type: integer }
   *                 credentialId: { type: string }
   *       400:
   *         description: Missing required fields or issuer not set up yet
   *       500:
   *         description: Issuance failed
   */
  app.post("/issue", async (req, res) => {
    try {
      if (!state) {
        res.status(400).json({ error: "Not set up yet, please try again later" });
        return;
      }

      const {
        connectionId,
        vorname = "Anna",
        nachname = "Schmidt",
        geburtsdatum = "1985-06-20",
        fuehrerscheinklasse = "A",
        ausstellungsdatum = "2023-01-10",
      } = req.body as {
        connectionId: string;
        vorname: string;
        nachname: string;
        geburtsdatum: string;
        fuehrerscheinklasse: string;
        ausstellungsdatum: string;
      };

      if (!connectionId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const credentialId = uuidv4();
      const revocationRegistryIndex = reserveNextRevocationIndex();

      console.log(
        `[issuer-agent] Reserving revocation index ` +
          `${revocationRegistryIndex} in registry ` +
          `${state.revocRegDefId}`,
      );

      const credentialExchangeRecord = await agent.modules.didcomm.credentials.offerCredential({
        connectionId,
        protocolVersion: "v2",
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: state.credDefId,
            revocationRegistryDefinitionId: state.revocRegDefId,
            revocationRegistryIndex,
            attributes: [
              { name: "vorname", value: vorname },
              { name: "nachname", value: nachname },
              { name: "geburtsdatum", value: geburtsdatum },
              { name: "fuehrerscheinklasse", value: fuehrerscheinklasse },
              { name: "ausstellungsdatum", value: ausstellungsdatum },
              { name: "credential_id", value: credentialId },
            ],
          },
        },
      });

      issuedCredentials[credentialId] = {
        credentialId,
        credentialExchangeId: credentialExchangeRecord.id,
        connectionId,
        credentialDefinitionId: state.credDefId,
        revocationRegistryDefinitionId: state.revocRegDefId,
        credentialRevocationId: String(revocationRegistryIndex),
        createdAt: new Date().toISOString(),
        status: "offered",
      };
      saveIssuedCredentials();

      console.log(`[issuer-agent] Credential offer sent to connection ${connectionId}`);
      res.json({
        success: true,
        message: "Führerschein credential offer sent",
        credentialExchangeId: credentialExchangeRecord.id,
        revocationRegistryDefinitionId: state.revocRegDefId,
        revocationRegistryIndex,
        credentialId,
      });
    } catch (err: unknown) {
      console.error("[issuer-agent] Issue error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Public Credential Config ───────────────────────────────────────────
  /**
   * @openapi
   * /public-credential-config:
   *   get:
   *     summary: Get the issuer's public credential configuration
   *     tags: [Issuer]
   *     responses:
   *       200:
   *         description: Issuer DID, schema, credential definition, and revocation registry IDs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 issuerDid: { type: string }
   *                 schemaId: { type: string }
   *                 credentialDefinitionId: { type: string }
   *                 revocationRegistryDefinitionId: { type: string }
   *       503:
   *         description: Issuer credential configuration is incomplete
   */
  app.get("/public-credential-config", (_req, res) => {
    if (!state?.issuerDid || !state.schemaId || !state.credDefId || !state.revocRegDefId) {
      res.status(503).json({ error: "Issuer credential configuration is incomplete" });
      return;
    }

    res.json({
      issuerDid: state.issuerDid,
      schemaId: state.schemaId,
      credentialDefinitionId: state.credDefId,
      revocationRegistryDefinitionId: state.revocRegDefId,
    });
  });

  // ─── Revoke credential ──────────────────────────────────────────────────
  /**
   * @openapi
   * /revoke:
   *   post:
   *     summary: Revoke a previously issued credential
   *     tags: [Issuer]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [credentialId]
   *             properties:
   *               credentialId: { type: string }
   *     responses:
   *       200:
   *         description: Credential revoked and event published to RabbitMQ
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 revokedIndex: { type: integer }
   *                 revocationRegistryId: { type: string }
   *                 credentialExchangeId: { type: string }
   *                 rabbitMqEventId: { type: string }
   *       400:
   *         description: Missing credentialId or no revocation registry configured
   *       404:
   *         description: Unknown credentialId
   *       409:
   *         description: Credential already revoked, not yet issued, or metadata mismatch
   *       500:
   *         description: Revocation failed
   */
  app.post("/revoke", async (req, res) => {
    try {
      if (!state?.revocRegDefId) {
        res.status(400).json({ error: "No revocation registry — run reset.sh and restart all agents" });
        return;
      }

      const { credentialId } = req.body as { credentialId?: string };

      if (!credentialId) {
        res.status(400).json({ error: "credentialId is required" });
        return;
      }

      const issuedCredential = issuedCredentials[credentialId];

      if (!issuedCredential) {
        res.status(404).json({ error: "Unknown credentialId" });
        return;
      }

      if (issuedCredential.status === "revoked") {
        res.status(409).json({
          error: "Credential is already revoked",
          revokedAt: issuedCredential.revokedAt,
        });
        return;
      }

      const credentialExchangeId = issuedCredential.credentialExchangeId;
      const targetExchange = await agent.modules.didcomm.credentials.getById(credentialExchangeId);

      const revocableStates = ["credential-issued", "done"];

      if (!revocableStates.includes(targetExchange.state) || targetExchange.role !== "issuer") {
        res.status(409).json({
          error: "Credential wurde noch nicht ausgestellt",
          state: targetExchange.state,
          role: targetExchange.role,
          allowedStates: revocableStates,
        });
        return;
      }

      if (!targetExchange) {
        res.status(404).json({ error: "No issued credential found to revoke" });
        return;
      }

      const meta = targetExchange.metadata.get(AnonCredsCredentialMetadataKey) as {
        credentialRevocationId?: string;
        revocationRegistryId?: string;
      } | null;

      if (!meta?.credentialRevocationId || !meta?.revocationRegistryId) {
        res.status(400).json({
          error: "Credential has no revocation metadata — was it issued with supportRevocation: true?",
        });
        return;
      }

      if (meta.credentialRevocationId !== issuedCredential.credentialRevocationId) {
        res.status(409).json({
          error: "Credential revocation index mismatch",
          stored: issuedCredential.credentialRevocationId,
          credo: meta.credentialRevocationId,
        });
        return;
      }

      if (meta.revocationRegistryId !== issuedCredential.revocationRegistryDefinitionId) {
        res.status(409).json({
          error: "Revocation registry mismatch",
          stored: issuedCredential.revocationRegistryDefinitionId,
          credo: meta.revocationRegistryId,
        });
        return;
      }

      const revocationIndex = parseInt(meta.credentialRevocationId, 10);
      console.log(`Issuer: revoking credential index ${revocationIndex} in registry ${meta.revocationRegistryId}`);

      const revocationResult = await agent.modules.anoncreds.updateRevocationStatusList({
        revocationStatusList: {
          revocationRegistryDefinitionId: meta.revocationRegistryId,
          revokedCredentialIndexes: [revocationIndex],
        },
        options: {},
      });

      if (revocationResult.revocationStatusListState.state !== "finished") {
        throw new Error(
          `Revocation on VON failed: ${JSON.stringify(revocationResult.revocationStatusListState)}`,
        );
      }

      console.log(
        `REVOC_REG_ENTRY written to VON Ledger ✓ ` +
          `(index ${revocationIndex} revoked)`,
      );

      // Only publish to RabbitMQ once VON has confirmed the revocation.
      const rabbitMqEvent = await publishCredentialRevoked({
        credentialId,
        issuerId: state.issuerDid,
        credentialDefinitionId: issuedCredential.credentialDefinitionId,
        revocationRegistryDefinitionId: meta.revocationRegistryId,
        credentialRevocationId: meta.credentialRevocationId,
      });

      issuedCredential.status = "revoked";
      issuedCredential.revokedAt = new Date().toISOString();
      saveIssuedCredentials();

      res.json({
        success: true,
        revokedIndex: revocationIndex,
        revocationRegistryId: meta.revocationRegistryId,
        credentialExchangeId: targetExchange.id,
        rabbitMqEventId: rabbitMqEvent.eventId,
      });
    } catch (err: unknown) {
      console.error("[issuer-agent] Revoke error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── List credential exchanges ──────────────────────────────────────────
  /**
   * @openapi
   * /credential-exchanges:
   *   get:
   *     summary: List credential exchange records
   *     tags: [Issuer]
   *     responses:
   *       200:
   *         description: Array of credential exchange summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: string }
   *                   state: { type: string }
   *                   role: { type: string }
   *                   connectionId: { type: string, nullable: true }
   *                   credentialRevocationId: { type: string, nullable: true }
   *                   revocationRegistryId: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load credential exchanges
   */
  app.get("/credential-exchanges", async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll();
      const result = exchanges.map((e: any) => {
        const meta = e.metadata.get(AnonCredsCredentialMetadataKey) as {
          credentialRevocationId?: string;
          revocationRegistryId?: string;
        } | null;
        return {
          id: e.id,
          state: e.state,
          role: e.role,
          connectionId: e.connectionId,
          credentialRevocationId: meta?.credentialRevocationId ?? null,
          revocationRegistryId: meta?.revocationRegistryId ?? null,
          createdAt: e.createdAt,
        };
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /credential-exchanges/{id}/accept-request:
   *   post:
   *     summary: Accept a pending credential request
   *     tags: [Issuer]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Credential exchange record ID
   *     responses:
   *       200:
   *         description: Request accepted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 credentialExchangeId: { type: string }
   *                 state: { type: string }
   *       400:
   *         description: Credential exchange is not in state 'request-received'
   *       500:
   *         description: Accepting the request failed
   */
  app.post("/credential-exchanges/:id/accept-request", async (req, res) => {
    try {
      const credentialExchangeId = req.params.id;
      const record = await agent.modules.didcomm.credentials.getById(credentialExchangeId);

      if (record.state !== "request-received") {
        res.status(400).json({
          error:
            `Credential Exchange hat Zustand '${record.state}', ` +
            `erwartet wurde 'request-received'`,
        });
        return;
      }

      const updatedRecord = await agent.modules.didcomm.credentials.acceptRequest({
        credentialExchangeRecordId: credentialExchangeId,
      });

      res.json({
        success: true,
        credentialExchangeId: updatedRecord.id,
        state: updatedRecord.state,
      });
    } catch (error: unknown) {
      console.error("[issuer-agent] acceptRequest failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  });
}
