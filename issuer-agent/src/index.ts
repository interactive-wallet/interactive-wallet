import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import {
  AnonCredsCredentialMetadataKey,
  AnonCredsRevocationRegistryDefinitionRecordMetadataKeys,
  AnonCredsRevocationRegistryDefinitionRepository,
} from "@credo-ts/anoncreds";
import { v4 as uuidv4 } from "uuid"; // L
import cors from "cors";
import "dotenv/config";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import {
  INDY_NAMESPACE,
  ISSUER_API_PORT,
  ISSUER_HTTP_ENDPOINT,
  ISSUER_SEED,
  VON_URL,
} from "./config.js";

import {
  closeRabbitMq,
  initializeRabbitMq,
  publishCredentialRevoked,
} from "./rabbitmq.js";
import { mountSwagger } from "./swagger.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { TypedArrayEncoder } = await import("@credo-ts/core");
const { DidCommHandshakeProtocol, DidCommCredentialEventTypes, DidCommProofEventTypes } = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");

const STATE_FILE = path.join(import.meta.dirname, "..", "issuer-state.json");

const ISSUED_CREDENTIALS_FILE =
  path.join(
    import.meta.dirname,
    "..",
    "issued-credentials.json",
  );

interface IssuedCredentialRecord {
  credentialId: string;
  credentialExchangeId: string;

  connectionId: string;

  credentialDefinitionId: string;

  revocationRegistryDefinitionId:
    string;

  credentialRevocationId:
    string;

  createdAt: string;

  status:
    | "offered"
    | "revoked";

  revokedAt?: string;
}

type IssuedCredentialStore =
  Record<
    string,
    IssuedCredentialRecord
  >;

function loadIssuedCredentials():
  IssuedCredentialStore {
  try {
    return JSON.parse(
      fs.readFileSync(
        ISSUED_CREDENTIALS_FILE,
        "utf-8",
      ),
    ) as IssuedCredentialStore;
  } catch {
    return {};
  }
}

const issuedCredentials =
  loadIssuedCredentials();

function saveIssuedCredentials():
  void {
  fs.writeFileSync(
    ISSUED_CREDENTIALS_FILE,
    JSON.stringify(
      issuedCredentials,
      null,
      2,
    ),
  );
}

interface IssuerState {
  issuerDid: string;
  schemaId: string;
  credDefId: string;
  revocRegDefId: string;
  
  // Next free spot in registry
  // Registry created with max num 100
  nextRevocationIndex?: number;
}

let state: IssuerState | null = null;

try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
} catch (ignored) {}

function saveState(s: IssuerState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const MAXIMUM_CREDENTIAL_NUMBER = 100;

function reserveNextRevocationIndex(): number {
  if (!state) {
    throw new Error(
      "Issuer state is not initialized",
    );
  }

  const index = state.nextRevocationIndex ?? 1;

  if (index > MAXIMUM_CREDENTIAL_NUMBER) {
    throw new Error(
      `Revocation Registry ist voll. ` +
        `Maximal ${MAXIMUM_CREDENTIAL_NUMBER} Credentials möglich.`,
    );
  }

  state.nextRevocationIndex = index + 1;
  saveState(state);

  return index;
}

const agent = createAgent();
await agent.initialize();
await initializeRabbitMq();

async function ensureLocalRevocationRegistryMetadata(
  revocationRegistryDefinitionId: string,
): Promise<void> {
  const repository = agent.dependencyManager.resolve(
    AnonCredsRevocationRegistryDefinitionRepository,
  );

  const record =
    await repository.getByRevocationRegistryDefinitionId(
      agent.context,
      revocationRegistryDefinitionId,
    );

  const metadataKey =
    AnonCredsRevocationRegistryDefinitionRecordMetadataKeys
      .RevocationRegistryDefinitionMetadata;

  const existingMetadata =
    record.metadata.get(metadataKey) ?? {};

  record.metadata.set(metadataKey, {
    ...existingMetadata,

    // IndyVdrAnonCredsRegistry schreibt die Definition
    // ausdrücklich als ISSUANCE_BY_DEFAULT.
    issuanceType: "ISSUANCE_BY_DEFAULT",

    didIndyNamespace: INDY_NAMESPACE,
  });

  await repository.update(agent.context, record);

  console.log(
    "[issuer-agent] Local revocation registry metadata updated",
    {
      revocationRegistryDefinitionId,
      issuanceType: "ISSUANCE_BY_DEFAULT",
    },
  );
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForRevocationStatusList(
  revocationRegistryDefinitionId: string,
  attempts = 15,
): Promise<void> {
  let lastResolutionMetadata: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);

    const result =
      await agent.modules.anoncreds.getRevocationStatusList(
        revocationRegistryDefinitionId,
        timestamp,
        {
          useCache: false,
        },
      );

    if (result.revocationStatusList) {
      console.log(
        "[issuer-agent] Revocation status list readable from VON",
        {
          revocationRegistryDefinitionId,
          timestamp:
            result.revocationStatusList.timestamp,
        },
      );

      return;
    }

    lastResolutionMetadata = result.resolutionMetadata;

    console.warn(
      `[issuer-agent] Revocation status list not readable ` +
        `(attempt ${attempt}/${attempts})`,
      result.resolutionMetadata,
    );

    await sleep(1_000);
  }

  throw new Error(
    `Revocation status list is still not readable: ${JSON.stringify(
      lastResolutionMetadata,
    )}`,
  );
}

console.log("Issuer Agent and RabbitMQinitialized");

// TODO NYM
const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
  label: "Führerscheinstelle",
  autoAcceptConnection: true,
  handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
});
const invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({
  domain: ISSUER_HTTP_ENDPOINT,
});
console.log(invitationUrl);

const app = express();
app.use(cors());
app.use(express.json());
mountSwagger(app);

// ─── Serve tails files ────────────────────────────────────────────────────
// BasicTailsFileService stores files at ${cacheDir}/anoncreds/tails/<hash>
// IssuerTailsFileService returns http://localhost:3002/tails/<hash> as the URL
// embedded in the revoc reg def on the ledger, so the holder can download it.
const tailsDir = path.join(
  os.homedir(),
  ".afj",
  "cache",
  "anoncreds",
  "tails",
);

fs.mkdirSync(tailsDir, {
  recursive: true,
});

/**
 * @openapi
 * /tails/{hash}:
 *   get:
 *     summary: Download a tails file for the revocation registry
 *     tags: [Issuer]
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tails file contents
 *       404:
 *         description: File not found
 */
app.use(
  "/tails",
  express.static(tailsDir),
);

// ─── Setup (one-time) ────────────────────────────────────────────────────
if (!state) {
  // 1. Register DID on VON
  console.log("[issuer-agent] Registering DID on VON...");
  const vonResponse = await fetch(`${VON_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seed: ISSUER_SEED,
      role: "ENDORSER",
      alias: "Interactive Issuer",
    }),
  });
  if (!vonResponse.ok)
    throw new Error(`VON registration failed: ${await vonResponse.text()}`);
  const { did: shortDid, verkey } = (await vonResponse.json()) as {
    did: string;
    verkey: string;
  };
  const issuerDid = `did:indy:${INDY_NAMESPACE}:${shortDid}`;
  console.log(`[issuer-agent] DID registered on VON: ${issuerDid}`);

  // 2. Import private key into KMS using JWK
  const seedBuffer = Buffer.alloc(32);
  Buffer.from(ISSUER_SEED).copy(seedBuffer);
  const pubKeyBytes = TypedArrayEncoder.fromBase58(verkey);

  let kmsKeyId: string = verkey;
  try {
    const result = await agent.kms.importKey({
      privateJwk: {
        kty: "OKP",
        crv: "Ed25519",
        kid: verkey,
        x: Buffer.from(pubKeyBytes).toString("base64url"),
        d: seedBuffer.toString("base64url"),
      },
    });
    kmsKeyId = result.keyId;
  } catch (e: unknown) {
    if (e instanceof Error && e.constructor.name === "KeyManagementKeyExistsError") {
      console.log("[issuer-agent] Key already in KMS, reusing");
    } else {
      throw e;
    }
  }

  // 3. Import DID into agent wallet
  await agent.dids.import({
    did: issuerDid,
    overwrite: true,
    keys: [{ kmsKeyId, didDocumentRelativeKeyId: "#verkey" }],
  });
  console.log("[issuer-agent] DID imported into wallet");

  // 4. Register schema
  const SCHEMA_VERSION = "1.1";
  const expectedSchemaId = `${issuerDid}/anoncreds/v0/SCHEMA/Fuehrerschein/${SCHEMA_VERSION}`;
  const schemaLookup = await agent.modules.anoncreds.getSchema(expectedSchemaId);
  let schemaId: string;
  let schemaSeqNo: number | undefined;

  if (schemaLookup.schema) {
    console.log("[issuer-agent] Schema already on ledger, reusing");
    schemaId = schemaLookup.schemaId;
    schemaSeqNo = (schemaLookup.schemaMetadata as { indyLedgerSeqNo?: number }).indyLedgerSeqNo;
  } else {
    console.log("[issuer-agent] Registering schema...");
    const schemaResult = await agent.modules.anoncreds.registerSchema({
      schema: {
        attrNames: ["vorname", "nachname", "geburtsdatum", "fuehrerscheinklasse", "ausstellungsdatum", "credential_id"], // L
        issuerId: issuerDid,
        name: "Fuehrerschein",
        version: SCHEMA_VERSION, // L
      },
      options: {},
    });
    if (schemaResult.schemaState.state !== "finished") {
      throw new Error(`Schema registration failed: ${JSON.stringify(schemaResult.schemaState)}`);
    }
    schemaId = schemaResult.schemaState.schemaId;
    schemaSeqNo = (schemaResult.schemaMetadata as { indyLedgerSeqNo?: number }).indyLedgerSeqNo;
    console.log(`[issuer-agent] Schema registered: ${schemaId}`);
  }

  // 5. Register credential definition WITH revocation support
  const expectedCredDefId = schemaSeqNo !== undefined
    ? `${issuerDid}/anoncreds/v0/CLAIM_DEF/${schemaSeqNo}/default`
    : undefined;
  const credDefLookup = expectedCredDefId
    ? await agent.modules.anoncreds.getCredentialDefinition(expectedCredDefId)
    : null;
  let credDefId: string;

  if (credDefLookup?.credentialDefinition) {
    console.log("[issuer-agent] CredDef already on ledger, reusing");
    credDefId = credDefLookup.credentialDefinitionId;
  } else {
    console.log("[issuer-agent] Registering credential definition (supportRevocation: true)...");
    const credDefResult = await agent.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: { issuerId: issuerDid, schemaId, tag: "default" },
      options: { supportRevocation: true },
    });
    if (credDefResult.credentialDefinitionState.state !== "finished") {
      throw new Error(`CredDef registration failed: ${JSON.stringify(credDefResult.credentialDefinitionState)}`);
    }
    credDefId = credDefResult.credentialDefinitionState.credentialDefinitionId;
    console.log(`[issuer-agent] CredDef registered: ${credDefId}`);
  }

  // 6. Register revocation registry definition
  console.log("[issuer-agent] Registering revocation registry definition...");
  const revRegDefResult = await agent.modules.anoncreds.registerRevocationRegistryDefinition({
    revocationRegistryDefinition: {
      issuerId: issuerDid,
      credentialDefinitionId: credDefId,
      tag: "default",
      maximumCredentialNumber: 100,
    },
    options: {},
  });
  if (revRegDefResult.revocationRegistryDefinitionState.state !== "finished") {
    throw new Error(`RevocRegDef registration failed: ${JSON.stringify(revRegDefResult.revocationRegistryDefinitionState)}`);
  }
  const revocRegDefId = revRegDefResult.revocationRegistryDefinitionState.revocationRegistryDefinitionId;
  const localTailsLocation = (revRegDefResult.revocationRegistryDefinitionMetadata as { localTailsLocation?: string }).localTailsLocation;
  console.log(`[issuer-agent] RevocRegDef registered: ${revocRegDefId}`);
  console.log(`REVOC_REG_DEF written to VON Ledger ✓ (tails: ${localTailsLocation})`);

  // 7. Register initial revocation status list (all credentials active)
  console.log("[issuer-agent] Registering initial revocation status list...");
  const statusListResult = await agent.modules.anoncreds.registerRevocationStatusList({
    revocationStatusList: {
      issuerId: issuerDid,
      revocationRegistryDefinitionId: revocRegDefId,
    },
    options: {},
  });
  if (statusListResult.revocationStatusListState.state !== "finished") {
    throw new Error(`RevocStatusList registration failed: ${JSON.stringify(statusListResult.revocationStatusListState)}`);
  }
  console.log("REVOC_REG_ENTRY (initial) written to VON Ledger ✓");

  state = { issuerDid, schemaId, credDefId, revocRegDefId, nextRevocationIndex: 1 };
  saveState(state);
} else if (!state.revocRegDefId) {
  // State exists from a previous non-revocable setup — migration not possible.
  // User must run reset.sh to enable revocation.
  console.warn("[issuer-agent] WARNING: state file exists without revocRegDefId.");
  console.warn("[issuer-agent] Run ./scripts/reset.sh to enable revocation support.");
}

if (!state?.issuerDid || !state.revocRegDefId) {
  throw new Error(
    "Issuer setup is incomplete: issuerDid or revocRegDefId is missing",
  );
}

await ensureLocalRevocationRegistryMetadata(
  state.revocRegDefId,
);

await waitForRevocationStatusList(
  state.revocRegDefId,
  15,
);

// ─── Observer: credential and proof event logging ─────────────────────────
agent.events.on(DidCommCredentialEventTypes.DidCommCredentialStateChanged, ({ payload }: any) => {
  const record = payload.credentialExchangeRecord;
  console.log(`Credential state: ${record.state} (role: ${record.role})`);

  if (record.state === "done" && record.role === "issuer") {
    const meta = record.metadata.get(AnonCredsCredentialMetadataKey) as {
      credentialRevocationId?: string;
      revocationRegistryId?: string;
    } | null;
    if (meta?.credentialRevocationId) {
      console.log(`Credential issued — revocation index: ${meta.credentialRevocationId} in registry: ${meta.revocationRegistryId}`);
    }
  }
});

agent.events.on(DidCommProofEventTypes.ProofStateChanged, ({ payload }: any) => {
  const record = payload.proofRecord;
  console.log(`Proof state: ${record.state}`);
});

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

// ─── Invitation ──────────────────────────────────────────────────────────
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

// ─── Connections ──────────────────────────────────────────────────────────
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
      connections.map((connection) => ({
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

// ─── Issue Führerschein (AnonCreds) ──────────────────────────────────────
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

    const revocationRegistryIndex =
      reserveNextRevocationIndex();

    console.log(
      `[issuer-agent] Reserving revocation index ` +
        `${revocationRegistryIndex} in registry ` +
        `${state.revocRegDefId}`,
    );

    const credentialExchangeRecord =
      await agent.modules.didcomm.credentials.offerCredential({
        connectionId,
        protocolVersion: "v2",

        credentialFormats: {
          anoncreds: {
            credentialDefinitionId:
              state.credDefId,

            revocationRegistryDefinitionId:
              state.revocRegDefId,

            revocationRegistryIndex,

            attributes: [
              {
                name: "vorname",
                value: vorname,
              },
              {
                name: "nachname",
                value: nachname,
              },
              {
                name: "geburtsdatum",
                value: geburtsdatum,
              },
              {
                name: "fuehrerscheinklasse",
                value: fuehrerscheinklasse,
              },
              {
                name: "ausstellungsdatum",
                value: ausstellungsdatum,
              },
              { name: "credential_id", value: credentialId }, // L
            ],
          },
        },
      });

      issuedCredentials[
        credentialId
      ] = {
        credentialId,

        credentialExchangeId:
          credentialExchangeRecord.id,

        connectionId,

        credentialDefinitionId:
          state.credDefId,

        revocationRegistryDefinitionId:
          state.revocRegDefId,

        credentialRevocationId:
          String(
            revocationRegistryIndex,
          ),

        createdAt:
          new Date().toISOString(),

        status:
          "offered",
      };

      saveIssuedCredentials();

      console.log(`[issuer-agent] Credential offer sent to connection ${connectionId}`);
      res.json({
        success: true,
        message: "Führerschein credential offer sent",
        credentialExchangeId:
          credentialExchangeRecord.id,
        revocationRegistryDefinitionId:
          state.revocRegDefId,
        revocationRegistryIndex,
        credentialId, // L
      });
    } catch (err: unknown) {
      console.error("[issuer-agent] Issue error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
});

// ─── Public Credential Config ────────────────────────────────────────────

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
  if (
    !state?.issuerDid ||
    !state.schemaId ||
    !state.credDefId ||
    !state.revocRegDefId
  ) {
    res.status(503).json({
      error: "Issuer credential configuration is incomplete",
    });
    return;
  }

  res.json({
    issuerDid: state.issuerDid,
    schemaId: state.schemaId,
    credentialDefinitionId: state.credDefId,
    revocationRegistryDefinitionId:
      state.revocRegDefId,
  });
});

// ─── Revoke credential ────────────────────────────────────────────────────
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

    const {
      credentialId,
    } = req.body as {
      credentialId?: string;
    };

    if (!credentialId) {
      res.status(400).json({
        error:
          "credentialId is required",
      });

      return;
    }

    const issuedCredential =
      issuedCredentials[
        credentialId
      ];

    if (!issuedCredential) {
      res.status(404).json({
        error:
          "Unknown credentialId",
      });

      return;
    }

    if (
      issuedCredential.status ===
      "revoked"
    ) {
      res.status(409).json({
        error:
          "Credential is already revoked",

        revokedAt:
          issuedCredential.revokedAt,
      });

      return;
    }

    const credentialExchangeId =
      issuedCredential
        .credentialExchangeId;

    const targetExchange =
      await agent.modules.didcomm.credentials.getById(
        credentialExchangeId,
      );

    const revocableStates = [
      "credential-issued",
      "done",
    ];

    if (
      !revocableStates.includes(
        targetExchange.state,
      ) ||
      targetExchange.role !== "issuer"
    ) {
      res.status(409).json({
        error:
          "Credential wurde noch nicht ausgestellt",

        state:
          targetExchange.state,

        role:
          targetExchange.role,

        allowedStates:
          revocableStates,
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

    if (
      !meta?.credentialRevocationId || !meta?.revocationRegistryId
    ) {
      res.status(400).json({ 
        error: 
          "Credential has no revocation metadata — was it issued with supportRevocation: true?" 
      });
      return;
    }

    if (
      meta.credentialRevocationId !==
      issuedCredential
        .credentialRevocationId
    ) {
      res.status(409).json({
        error:
          "Credential revocation index mismatch",

        stored:
          issuedCredential
            .credentialRevocationId,

        credo:
          meta.credentialRevocationId,
      });

      return;
    }

    if (
      meta.revocationRegistryId !==
      issuedCredential
        .revocationRegistryDefinitionId
    ) {
      res.status(409).json({
        error:
          "Revocation registry mismatch",

        stored:
          issuedCredential
            .revocationRegistryDefinitionId,

        credo:
          meta.revocationRegistryId,
      });

      return;
    }

    const revocationIndex = parseInt(meta.credentialRevocationId, 10);
    console.log(`Issuer: revoking credential index ${revocationIndex} in registry ${meta.revocationRegistryId}`);

    const revocationResult =
      await agent.modules.anoncreds.updateRevocationStatusList({
        revocationStatusList: {
          revocationRegistryDefinitionId:
            meta.revocationRegistryId,
          revokedCredentialIndexes: [revocationIndex],
        },
        options: {},
      });

    if (
      revocationResult.revocationStatusListState.state !==
      "finished"
    ) {
      throw new Error(
        `Revocation on VON failed: ${JSON.stringify(
          revocationResult.revocationStatusListState,
        )}`,
      );
    }

    console.log(
      `REVOC_REG_ENTRY written to VON Ledger ✓ ` +
        `(index ${revocationIndex} revoked)`,
    );

// VON confirms revocation, sending to RabbitMQ
    const rabbitMqEvent =
      await publishCredentialRevoked({
        credentialId,

        issuerId:
          state.issuerDid,

        credentialDefinitionId:
          issuedCredential
            .credentialDefinitionId,

        revocationRegistryDefinitionId:
          meta.revocationRegistryId,

        credentialRevocationId:
          meta.credentialRevocationId,
      });

      issuedCredential.status =
        "revoked";

      issuedCredential.revokedAt =
        new Date().toISOString();

      saveIssuedCredentials();

    res.json({
      success: true,
      revokedIndex: revocationIndex,
      revocationRegistryId:
        meta.revocationRegistryId,
      credentialExchangeId:
        targetExchange.id,
      rabbitMqEventId:
        rabbitMqEvent.eventId,
    });
  } catch (err: unknown) {
    console.error("[issuer-agent] Revoke error:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── List credential exchanges ────────────────────────────────────────────
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
app.post(
  "/credential-exchanges/:id/accept-request",
  async (req, res) => {
    try {
      const credentialExchangeId = req.params.id;

      const record =
        await agent.modules.didcomm.credentials.getById(
          credentialExchangeId,
        );

      if (record.state !== "request-received") {
        res.status(400).json({
          error:
            `Credential Exchange hat Zustand '${record.state}', ` +
            `erwartet wurde 'request-received'`,
        });

        return;
      }

      const updatedRecord =
        await agent.modules.didcomm.credentials.acceptRequest({
          credentialExchangeRecordId:
            credentialExchangeId,
        });

      res.json({
        success: true,
        credentialExchangeId:
          updatedRecord.id,
        state:
          updatedRecord.state,
      });
    } catch (error: unknown) {
      console.error(
        "[issuer-agent] acceptRequest failed:",
        error,
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      res.status(500).json({
        success: false,
        error: message,
      });
    }
  },
);

const server = app.listen(
  ISSUER_API_PORT,
  () => {
    console.log(
      `[issuer-agent] REST API running on ` +
        `http://localhost:${ISSUER_API_PORT}`,
    );
  },
);

let isShuttingDown = false;

async function shutdown(
  signal: string,
): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(
    `[issuer-agent] Received ${signal}, shutting down`,
  );

  server.close();

  try {
    await closeRabbitMq();
  } catch (error) {
    console.error(
      "[issuer-agent] RabbitMQ shutdown failed:",
      error,
    );
  }

  try {
    await agent.shutdown();
  } catch (error) {
    console.error(
      "[issuer-agent] Agent shutdown failed:",
      error,
    );
  }

  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});