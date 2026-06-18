import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import { AnonCredsCredentialMetadataKey } from "@credo-ts/anoncreds";
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

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { TypedArrayEncoder } = await import("@credo-ts/core");
const { DidCommHandshakeProtocol, DidCommCredentialEventTypes, DidCommProofEventTypes } = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");

const STATE_FILE = path.join(import.meta.dirname, "..", "issuer-state.json");

interface IssuerState {
  issuerDid: string;
  schemaId: string;
  credDefId: string;
  revocRegDefId: string;
}

let state: IssuerState | null = null;

try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
} catch (ignored) {}

function saveState(s: IssuerState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const agent = createAgent();
await agent.initialize();
console.log("Issuer Agent initialized");

// TODO NYM
const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
  label: "Issuer",
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

// ─── Serve tails files ────────────────────────────────────────────────────
// BasicTailsFileService stores files at ${cacheDir}/anoncreds/tails/<hash>
// IssuerTailsFileService returns http://localhost:3002/tails/<hash> as the URL
// embedded in the revoc reg def on the ledger, so the holder can download it.
const tailsDir = path.join(os.homedir(), ".afj", "data", "anoncreds", "tails");
fs.mkdirSync(tailsDir, { recursive: true });
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
  const expectedSchemaId = `${issuerDid}/anoncreds/v0/SCHEMA/Fuehrerschein/1.0`;
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
        attrNames: ["vorname", "nachname", "geburtsdatum", "fuehrerscheinklasse", "ausstellungsdatum"],
        issuerId: issuerDid,
        name: "Fuehrerschein",
        version: "1.0",
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

  state = { issuerDid, schemaId, credDefId, revocRegDefId };
  saveState(state);
} else if (!state.revocRegDefId) {
  // State exists from a previous non-revocable setup — migration not possible.
  // User must run reset.sh to enable revocation.
  console.warn("[issuer-agent] WARNING: state file exists without revocRegDefId.");
  console.warn("[issuer-agent] Run ./scripts/reset.sh to enable revocation support.");
}

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", hasSetup: state !== null });
});

// ─── Invitation ──────────────────────────────────────────────────────────
app.get("/invitation", async (_req, res) => {
  try {
    const oobRecord = await agent.modules.didcomm.oob.createInvitation({
      label: "Issuer",
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

    const credentialExchangeRecord =
      await agent.modules.didcomm.credentials.offerCredential({
        connectionId,
        protocolVersion: "v2",
        credentialFormats: {
          anoncreds: {
            credentialDefinitionId: state.credDefId,
            attributes: [
              { name: "vorname", value: vorname },
              { name: "nachname", value: nachname },
              { name: "geburtsdatum", value: geburtsdatum },
              { name: "fuehrerscheinklasse", value: fuehrerscheinklasse },
              { name: "ausstellungsdatum", value: ausstellungsdatum },
            ],
            // revocationRegistryDefinitionId and index are picked automatically
            // by Credo because the credDef was created with supportRevocation: true
          },
        },
      });

    console.log(`[issuer-agent] Credential offer sent to connection ${connectionId}`);
    res.json({
      success: true,
      message: "Führerschein credential offer sent",
      credentialExchangeId: credentialExchangeRecord.id,
    });
  } catch (err: unknown) {
    console.error("[issuer-agent] Issue error:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Revoke credential ────────────────────────────────────────────────────
// Body: { credentialExchangeId?: string }
// If no ID is given, revokes the most recently issued credential.
app.post("/revoke", async (req, res) => {
  try {
    if (!state?.revocRegDefId) {
      res.status(400).json({ error: "No revocation registry — run reset.sh and restart all agents" });
      return;
    }

    const { credentialExchangeId } = req.body as { credentialExchangeId?: string };

    let targetExchange: any;
    if (credentialExchangeId) {
      targetExchange = await agent.modules.didcomm.credentials.getById(credentialExchangeId);
    } else {
      const all = await agent.modules.didcomm.credentials.getAll();
      targetExchange = all
        .filter((e: any) => e.state === "done" && e.role === "issuer")
        .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())[0];
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
      res.status(400).json({ error: "Credential has no revocation metadata — was it issued with supportRevocation: true?" });
      return;
    }

    const revocationIndex = parseInt(meta.credentialRevocationId, 10);
    console.log(`Issuer: revoking credential index ${revocationIndex} in registry ${meta.revocationRegistryId}`);

    await agent.modules.anoncreds.updateRevocationStatusList({
      revocationStatusList: {
        revocationRegistryDefinitionId: meta.revocationRegistryId,
        revokedCredentialIndexes: [revocationIndex],
      },
      options: {},
    });

    console.log(`REVOC_REG_ENTRY written to VON Ledger ✓ (index ${revocationIndex} revoked)`);

    res.json({
      success: true,
      revokedIndex: revocationIndex,
      revocationRegistryId: meta.revocationRegistryId,
      credentialExchangeId: targetExchange.id,
    });
  } catch (err: unknown) {
    console.error("[issuer-agent] Revoke error:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── List credential exchanges ────────────────────────────────────────────
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

app.listen(ISSUER_API_PORT, () => {
  console.log(
    `[issuer-agent] REST API running on http://localhost:${ISSUER_API_PORT}`,
  );
});