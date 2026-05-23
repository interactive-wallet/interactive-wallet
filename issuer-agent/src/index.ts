import "@hyperledger/anoncreds-nodejs";
import "@hyperledger/indy-vdr-nodejs";
import "@openwallet-foundation/askar-nodejs";
import cors from "cors";
import "dotenv/config";
import express from "express";
import fs from "fs";
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
const { DidCommHandshakeProtocol } = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");

const STATE_FILE = path.join(import.meta.dirname, "..", "issuer-state.json");

interface IssuerState {
  issuerDid: string;
  schemaId: string;
  credDefId: string;
}

let state: IssuerState | null = null;

try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
} catch (ignored) {}

function saveState(state: IssuerState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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

  // kid = base58 verkey so the legacy DIDComm v1 key lookup finds it by verkey.
  // If the wallet already has this key (e.g. after a state-file-only reset), skip import.
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

  // 4. Register schema (idempotent: reuse if already on ledger)
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

  // 5. Register credential definition (idempotent: reuse if already on ledger)
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
    console.log("[issuer-agent] Registering credential definition...");
    const credDefResult = await agent.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: { issuerId: issuerDid, schemaId, tag: "default" },
      options: { supportRevocation: false },
    });
    if (credDefResult.credentialDefinitionState.state !== "finished") {
      throw new Error(`CredDef registration failed: ${JSON.stringify(credDefResult.credentialDefinitionState)}`);
    }
    credDefId = credDefResult.credentialDefinitionState.credentialDefinitionId;
    console.log(`[issuer-agent] CredDef registered: ${credDefId}`);
  }

  state = { issuerDid, schemaId, credDefId };
  saveState(state);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", hasSetup: state !== null });
});

// ─── Invitation ──────────────────────────────────────────────────────────
// If /setup has run, the invitation carries the issuer's public did:indy
// so the holder wallet can resolve and verify it against the ledger
// before accepting the connection.
app.get("/invitation", async (_req, res) => {
  try {
    const oobRecord = await agent.modules.didcomm.oob.createInvitation({
      label: "Issuer",
      autoAcceptConnection: true,
      handshakeProtocols: [DidCommHandshakeProtocol.Connections],
    });
    // Inject `from` so the wallet app can show "VERIFIED IDENTITY" for the ledger DID.
    // Do NOT use invitationDid here — Credo's implicit-invitation path sets
    // autoAcceptConnection=false on the OOB record, which breaks the handshake.
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

    if (
      !connectionId ||
      !vorname ||
      !nachname ||
      !geburtsdatum ||
      !fuehrerscheinklasse ||
      !ausstellungsdatum
    ) {
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
          },
        },
      });

    console.log(
      `[issuer-agent] Credential offer sent to connection ${connectionId}`,
    );
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

app.listen(ISSUER_API_PORT, () => {
  console.log(
    `[issuer-agent] REST API running on http://localhost:${ISSUER_API_PORT}`,
  );
});
