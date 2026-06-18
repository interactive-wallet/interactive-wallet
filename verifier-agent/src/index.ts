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
  VERIFIER_API_PORT,
  VERIFIER_HTTP_ENDPOINT,
  VERIFIER_SEED,
  VON_URL,
} from "./config.js";

// Native modules MUST be registered before @credo-ts/* modules are loaded.
const { TypedArrayEncoder } = await import("@credo-ts/core");
const { DidCommHandshakeProtocol, DidCommProofEventTypes, DidCommProofState } = await import("@credo-ts/didcomm");
const { createAgent } = await import("./agent.js");

const STATE_FILE = path.join(import.meta.dirname, "..", "verifier-state.json");

interface VerifierState {
  verifierDid: string;
}

let state: VerifierState | null = null;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
} catch (ignored) {}

function saveState(state: VerifierState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const agent = createAgent();
await agent.initialize();
console.log("Verifier Agent initialized");

// TODO NYM
const outOfBandRecord = await agent.modules.didcomm.oob.createInvitation({
  label: "Verifier",
  autoAcceptConnection: true,
  handshakeProtocols: [DidCommHandshakeProtocol.DidExchange],
});
const invitationUrl = outOfBandRecord.outOfBandInvitation.toUrl({
  domain: VERIFIER_HTTP_ENDPOINT,
});
console.log(invitationUrl);

const app = express();
app.use(cors());
app.use(express.json());

// ─── Setup (one-time): register verifier NYM on VON ──────────────────────
if (!state) {
  console.log("[verifier-agent] Registering DID on VON...");
  const vonResponse = await fetch(`${VON_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seed: VERIFIER_SEED,
      role: "ENDORSER",
      alias: "Interactive Verifier",
    }),
  });
  if (!vonResponse.ok)
    throw new Error(`VON registration failed: ${await vonResponse.text()}`);
  const { did: shortDid, verkey } = (await vonResponse.json()) as {
    did: string;
    verkey: string;
  };
  const verifierDid = `did:indy:${INDY_NAMESPACE}:${shortDid}`;
  console.log(`[verifier-agent] DID registered on VON: ${verifierDid}`);

  // Import private key into KMS using JWK
  const seedBuffer = Buffer.alloc(32);
  Buffer.from(VERIFIER_SEED).copy(seedBuffer);
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
      console.log("[verifier-agent] Key already in KMS, reusing");
    } else {
      throw e;
    }
  }

  await agent.dids.import({
    did: verifierDid,
    overwrite: true,
    keys: [{ kmsKeyId, didDocumentRelativeKeyId: "#verkey" }],
  });
  console.log("[verifier-agent] DID imported into wallet");

  state = { verifierDid };
  saveState(state);
}

// ─── Observer: proof event logging ───────────────────────────────────────
agent.events.on(DidCommProofEventTypes.ProofStateChanged, ({ payload }: any) => {
  const record = payload.proofRecord;
  console.log(`Proof state: ${record.state}`);
  if (record.state === DidCommProofState.Abandoned) {
    console.log("⚠️  Proof FAILED — credential may be revoked");
  }
  if (record.state === DidCommProofState.Done) {
    if (record.isVerified === true) {
      console.log("✓ Proof verified — credential is valid");
    } else if (record.isVerified === false) {
      console.log("✗ Proof done but NOT verified");
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", hasSetup: state !== null });
});

// ─── Invitation ──────────────────────────────────────────────────────────
// If /setup has run, the invitation carries the verifier's public did:indy
// so that the holder wallet can resolve and verify it against the ledger
// before connecting.
app.get("/invitation", async (_req, res) => {
  try {
    const oobRecord = await agent.modules.didcomm.oob.createInvitation({
      label: "Verifier",
      handshakeProtocols: [DidCommHandshakeProtocol.Connections],
    });
    // Inject `from` so the wallet app can show "VERIFIED IDENTITY" for the ledger DID.
    // Do NOT use invitationDid here — Credo's implicit-invitation path sets
    // autoAcceptConnection=false on the OOB record, which breaks the handshake.
    const oobJson = oobRecord.outOfBandInvitation.toJSON() as Record<string, unknown>;
    if (state?.verifierDid) oobJson.from = state.verifierDid;
    const invitationUrl = `${VERIFIER_HTTP_ENDPOINT}?oob=${Buffer.from(JSON.stringify(oobJson)).toString("base64url")}`;
    res.json({
      invitationUrl,
      oobId: oobRecord.id,
      invitationDid: state?.verifierDid ?? null,
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

// ─── Request proof ────────────────────────────────────────────────────────
// Body: { connectionId, requestedAttributes?: string[] }
// requestedAttributes: subset of Führerschein fields to request (default: all)
app.post("/request-proof", async (req, res) => {
  try {
    const { connectionId, requestedAttributes } = req.body as {
      connectionId: string;
      requestedAttributes?: string[];
    };

    if (!connectionId) {
      res.status(400).json({ error: "Missing connectionId" });
      return;
    }

    const attrs = requestedAttributes ?? [
      "vorname",
      "nachname",
      "geburtsdatum",
      "fuehrerscheinklasse",
      "ausstellungsdatum",
    ];

    const requested_attributes: Record<string, { name: string }> = {};
    for (const attr of attrs) {
      requested_attributes[`${attr}_referent`] = { name: attr };
    }

    const proofRecord = await agent.modules.didcomm.proofs.requestProof({
      connectionId,
      protocolVersion: "v2",
      proofFormats: {
        anoncreds: {
          name: "Führerschein Verification",
          version: "1.0",
          requested_attributes,
          requested_predicates: {},
          // Triggers revocation check: holder must prove credential was not revoked
          // at the time of the proof (verifier reads REVOC_REG_ENTRY from the ledger)
          non_revoked: {
            from: 0,
            to: Math.floor(Date.now() / 1000),
          },
        },
      },
    });

    console.log(`Verifier: proof request sent (non_revoked check enabled) to connection ${connectionId}`);
    res.json({ proofExchangeId: proofRecord.id, state: proofRecord.state });
  } catch (err: unknown) {
    console.error("[verifier-agent] request-proof error:", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Get all proof exchanges ──────────────────────────────────────────────
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

// ─── Get single proof exchange ────────────────────────────────────────────
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

app.listen(VERIFIER_API_PORT, () => {
  console.log(
    `[verifier-agent] REST API running on http://localhost:${VERIFIER_API_PORT}`,
  );
});
