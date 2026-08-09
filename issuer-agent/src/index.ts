import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import {
  AnonCredsCredentialMetadataKey,
  AnonCredsRevocationRegistryDefinitionRecordMetadataKeys,
  AnonCredsRevocationRegistryDefinitionRepository,
} from "@credo-ts/anoncreds";
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
} from "./rabbitmq.js";
import { registerIssuerRoutes, type IssuerState } from "./issuer-routes.js";
import { mountSwagger } from "./swagger.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { TypedArrayEncoder } = await import("@credo-ts/core");
const { DidCommHandshakeProtocol, DidCommCredentialEventTypes, DidCommProofEventTypes } = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");

const STATE_FILE = path.join(import.meta.dirname, "..", "issuer-state.json");

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
    throw new Error("Issuer state is not initialized");
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

  const record = await repository.getByRevocationRegistryDefinitionId(
    agent.context,
    revocationRegistryDefinitionId,
  );

  const metadataKey =
    AnonCredsRevocationRegistryDefinitionRecordMetadataKeys
      .RevocationRegistryDefinitionMetadata;

  const existingMetadata = record.metadata.get(metadataKey) ?? {};

  record.metadata.set(metadataKey, {
    ...existingMetadata,

    // IndyVdrAnonCredsRegistry explicitly writes the definition
    // as ISSUANCE_BY_DEFAULT.
    issuanceType: "ISSUANCE_BY_DEFAULT",

    didIndyNamespace: INDY_NAMESPACE,
  });

  await repository.update(agent.context, record);

  console.log("[issuer-agent] Local revocation registry metadata updated", {
    revocationRegistryDefinitionId,
    issuanceType: "ISSUANCE_BY_DEFAULT",
  });
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

    const result = await agent.modules.anoncreds.getRevocationStatusList(
      revocationRegistryDefinitionId,
      timestamp,
      { useCache: false },
    );

    if (result.revocationStatusList) {
      console.log("[issuer-agent] Revocation status list readable from VON", {
        revocationRegistryDefinitionId,
        timestamp: result.revocationStatusList.timestamp,
      });

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

console.log("Issuer Agent and RabbitMQ initialized");

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
const tailsDir = path.join(os.homedir(), ".afj", "cache", "anoncreds", "tails");

fs.mkdirSync(tailsDir, { recursive: true });

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
app.use("/tails", express.static(tailsDir));

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
        attrNames: ["vorname", "nachname", "geburtsdatum", "fuehrerscheinklasse", "ausstellungsdatum", "credential_id"],
        issuerId: issuerDid,
        name: "Fuehrerschein",
        version: SCHEMA_VERSION,
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
  throw new Error("Issuer setup is incomplete: issuerDid or revocRegDefId is missing");
}

await ensureLocalRevocationRegistryMetadata(state.revocRegDefId);
await waitForRevocationStatusList(state.revocRegDefId, 15);

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

registerIssuerRoutes(
  app,
  agent,
  state,
  reserveNextRevocationIndex,
  DidCommHandshakeProtocol,
  AnonCredsCredentialMetadataKey,
);

const server = app.listen(ISSUER_API_PORT, () => {
  console.log(`[issuer-agent] REST API running on http://localhost:${ISSUER_API_PORT}`);
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`[issuer-agent] Received ${signal}, shutting down`);

  server.close();

  try {
    await closeRabbitMq();
  } catch (error) {
    console.error("[issuer-agent] RabbitMQ shutdown failed:", error);
  }

  try {
    await agent.shutdown();
  } catch (error) {
    console.error("[issuer-agent] Agent shutdown failed:", error);
  }

  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
