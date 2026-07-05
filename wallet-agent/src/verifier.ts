import { TypedArrayEncoder } from "@credo-ts/core";
import {
  DidCommHandshakeProtocol,
  DidCommProofEventTypes,
  DidCommProofState,
} from "@credo-ts/didcomm";
import { Express } from "express";
import fs from "fs";
import path from "path";
import type { createAgent } from "./agent.js";
import {
  INDY_NAMESPACE,
  ISSUER_API_URL,
  VERIFIER_HTTP_ENDPOINT,
  VON_URL,
  VERIFIER_SEED,
} from "./config.js";
import {
  initializeVerifierConsumer,
} from "./verifier-consumer.js";

export async function setUpVerifier(
  app: Express,
  agent: ReturnType<typeof createAgent>,
  broadcast: (type: string, data: object) => void = () => {},
) {

  interface IssuerCredentialConfig {
  issuerDid: string;
  schemaId: string;
  credentialDefinitionId: string;
  revocationRegistryDefinitionId: string;
  }

  // The issuer's REST API may not be up yet when the verifier boots (compose
  // only orders on rabbitmq). Retry instead of crashing on ECONNREFUSED so the
  // start order between issuer and verifier no longer matters.
  async function fetchIssuerConfig(
    url: string,
    attempts = 30,
    delayMs = 2000,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
        lastError = new Error(
          `HTTP ${response.status}: ${await response.text()}`,
        );
      } catch (error) {
        lastError = error;
      }
      console.log(
        `[Verifier] Issuer config not ready at ${url} ` +
          `(attempt ${attempt}/${attempts}), retrying in ${delayMs}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(
      `Issuer credential configuration could not be loaded after ` +
        `${attempts} attempts: ` +
        (lastError instanceof Error ? lastError.message : String(lastError)),
    );
  }

  const issuerConfigResponse = await fetchIssuerConfig(
    `${ISSUER_API_URL}/public-credential-config`,
  );

  const issuerCredentialConfig =
    await issuerConfigResponse.json() as
      IssuerCredentialConfig;

  const credentialDefinitionResult =
  await agent.modules.anoncreds
    .getCredentialDefinition(
      issuerCredentialConfig
        .credentialDefinitionId,
    );

  const credentialDefinition =
    credentialDefinitionResult
      .credentialDefinition;

  if (!credentialDefinition) {
    throw new Error(
      `Credential Definition couldn't be loaded from the ledger: ` +
        issuerCredentialConfig.credentialDefinitionId,
    );
  }

  if (
    credentialDefinition.issuerId !==
    issuerCredentialConfig.issuerDid
  ) {
    throw new Error(
      "Credential Definition doesn't belong to the specified Issuer-DID",
    );
  }

  if (
    credentialDefinition.schemaId !==
    issuerCredentialConfig.schemaId
  ) {
    throw new Error(
      "Credential Definition doesn't belong to the specified Schema",
    );
  }    

  const revocationRegistryResult =
  await agent.modules.anoncreds
    .getRevocationRegistryDefinition(
      issuerCredentialConfig
        .revocationRegistryDefinitionId,
    );

  const revocationRegistryDefinition =
    revocationRegistryResult
      .revocationRegistryDefinition;

  if (!revocationRegistryDefinition) {
    throw new Error(
      `Revocation Registry could not be loaded from the ledger: ` +
        issuerCredentialConfig.revocationRegistryDefinitionId,
    );
  }

  if (
    revocationRegistryDefinition.credDefId !==
    issuerCredentialConfig.credentialDefinitionId
  ) {
    throw new Error(
      "Revocation Registry doesn't belong to the specified Credential Definition",
    );
  }

  console.log(
    "[Verifier] Issuer credential configuration verified",
    {
      issuerDid:
        issuerCredentialConfig.issuerDid,

      schemaId:
        issuerCredentialConfig.schemaId,

      credentialDefinitionId:
        issuerCredentialConfig
          .credentialDefinitionId,

      revocationRegistryDefinitionId:
        issuerCredentialConfig
          .revocationRegistryDefinitionId,
    },
  );
    
  const STATE_FILE = path.join(
    import.meta.dirname,
    "..",
    "verifier-state.json",
  );

  const VERIFIED_CREDENTIALS_FILE =
  path.join(
    import.meta.dirname,
    "..",
    "verified-credentials.json",
  );

  interface VerifiedCredentialRecord {
    credentialId: string;

    proofExchangeId: string;
    connectionId?: string;

    credentialDefinitionId: string;
    schemaId: string;

    revocationRegistryDefinitionId:
      string;

    verifiedAt: string;

    nonRevocationTimestamp: number;

    status:
      | "verified"
      | "revoked-after-verification";

    revokedAt?: string;
  }

  type VerifiedCredentialStore =
    Record<
      string,
      VerifiedCredentialRecord
    >;

  function loadVerifiedCredentials():
    VerifiedCredentialStore {
    try {
      return JSON.parse(
        fs.readFileSync(
          VERIFIED_CREDENTIALS_FILE,
          "utf-8",
        ),
      ) as VerifiedCredentialStore;
    } catch {
      return {};
    }
  }

  const verifiedCredentials =
    loadVerifiedCredentials();

  function saveVerifiedCredentials():
    void {
    fs.writeFileSync(
      VERIFIED_CREDENTIALS_FILE,

      JSON.stringify(
        verifiedCredentials,
        null,
        2,
      ),
    );
  }

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

  // ─── Setup (one-time): register verifier NYM on VON ──────────────────────
  if (!state) {
    console.log("[Verifier] Registering DID on VON...");
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
    console.log(`[Verifier] DID registered on VON: ${verifierDid}`);

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
      if (
        e instanceof Error &&
        e.constructor.name === "KeyManagementKeyExistsError"
      ) {
        console.log("[Verifier] Key already in KMS, reusing");
      } else {
        throw e;
      }
    }

    await agent.dids.import({
      did: verifierDid,
      overwrite: true,
      keys: [{ kmsKeyId, didDocumentRelativeKeyId: "#verkey" }],
    });
    console.log("[Verifier] DID imported into wallet");

    state = { verifierDid };
    saveState(state);
  }

  async function registerVerifiedCredential(
    proofExchangeId: string,
  ): Promise<void> {
    const record =
      await agent.modules.didcomm.proofs
        .getById(
          proofExchangeId,
        );

    if (
      record.state !==
        DidCommProofState.Done ||
      record.isVerified !== true
    ) {
      return;
    }

    const formatData =
      await agent.modules.didcomm.proofs
        .getFormatData(
          proofExchangeId,
        );

    const presentation =
      (formatData.presentation as any)
        ?.anoncreds ??
      formatData.presentation;

    if (!presentation) {
      throw new Error(
        "AnonCreds presentation missing",
      );
    }

    const revealedGroup =
      (presentation as any)
        ?.requested_proof
        ?.revealed_attr_groups
        ?.fuehrerschein_referent;

    if (!revealedGroup) {
      throw new Error(
        "Group fuehrerschein_referent " +
          "missing in proof's revealed attributes",
      );
    }

    const credentialId =
      revealedGroup
        ?.values
        ?.credential_id
        ?.raw;

    if (
      typeof credentialId !== "string" ||
      credentialId.length === 0
    ) {
      throw new Error(
        "The verified proof does not contain a credential_id",
      );
    }

    const subProofIndex =
      revealedGroup
        .sub_proof_index;

    if (
      typeof subProofIndex !== "number"
    ) {
      throw new Error(
        "sub_proof_index missing in the " +
          "revealed attribute group",
      );
    }

    const identifier =
      (presentation as any)
        ?.identifiers
        ?.[subProofIndex];

    if (!identifier) {
      throw new Error(
        "AnonCreds-Identifier for " +
          "used sub_proof_index missing in proof presentation",
      );
    }

    if (
      identifier.cred_def_id !==
      issuerCredentialConfig
        .credentialDefinitionId
    ) {
      throw new Error(
        "Proof using unexpected " +
          "Credential Definition",
      );
    }

    if (
      identifier.schema_id !==
      issuerCredentialConfig.schemaId
    ) {
      throw new Error(
        "Proof using unexpected Schema",
      );
    }

    if (
      identifier.rev_reg_id !==
      issuerCredentialConfig
        .revocationRegistryDefinitionId
    ) {
      throw new Error(
        "Proof verwendet eine unerwartete " +
          "Revocation Registry",
      );
    }

    if (
      typeof identifier.timestamp !==
      "number"
    ) {
      throw new Error(
        "Der Proof enthält keinen " +
          "Non-Revocation-Timestamp",
      );
    }

    const nonRevocationTimestamp =
      identifier.timestamp;

    verifiedCredentials[
      credentialId
    ] = {
      credentialId,

      proofExchangeId:
        record.id,

      connectionId:
        record.connectionId,

      credentialDefinitionId:
        identifier.cred_def_id,

      schemaId:
        identifier.schema_id,

      revocationRegistryDefinitionId:
        identifier.rev_reg_id,

      verifiedAt:
        new Date().toISOString(),

      nonRevocationTimestamp:
        identifier.timestamp,

      status:
        "verified",
    };

    saveVerifiedCredentials();

    console.log(
      "[Verifier] Credential registered for revocation notifications",
      {
        credentialId,

        proofExchangeId:
          record.id,

        credentialDefinitionId:
          identifier.cred_def_id,

        nonRevocationTimestamp,
      },
    );
  }
  
  
  // ─── proof event logging ───────────────────────────────────────
  agent.events.on(
    DidCommProofEventTypes
      .ProofStateChanged,

    ({ payload }: any) => {
      const record =
        payload.proofRecord;

      console.log(
        `[Verifier] Proof state: ${record.state}`,
      );

      if (
        record.state ===
        DidCommProofState.Abandoned
      ) {
        console.error(
          "[Verifier] Proof exchange abandoned",
          {
            proofExchangeId:
              record.id,

            errorMessage:
              record.errorMessage,
          },
        );

        return;
      }

      if (
        record.state ===
          DidCommProofState.Done &&
        record.isVerified === false
      ) {
        console.error(
          "[Verifier] Proof completed but verification failed",
          {
            proofExchangeId:
              record.id,

            errorMessage:
              record.errorMessage,
          },
        );

        return;
      }

      if (
        record.state ===
          DidCommProofState.Done &&
        record.isVerified === true
      ) {
        console.log(
          "[Verifier] Proof successfully verified",
          {
            proofExchangeId:
              record.id,
          },
        );

        void registerVerifiedCredential(
          record.id,
        ).catch(
          (error: unknown) => {
            console.error(
              "[Verifier] Failed to register verified credential",
              error,
            );
          },
        );
      }
    },
  );

  await initializeVerifierConsumer({
  trustedIssuerId:
    issuerCredentialConfig.issuerDid,

  trustedCredentialDefinitionId:
    issuerCredentialConfig
      .credentialDefinitionId,

  trustedRevocationRegistryDefinitionId:
    issuerCredentialConfig
      .revocationRegistryDefinitionId,

  onCredentialRevoked:
    async (event) => {
      const verifiedCredential =
        verifiedCredentials[
          event.credentialId
        ];

      if (!verifiedCredential) {
        console.log(
          "[Verifier] Revocation ignoriert: Credential wurde von diesem Verifier nicht geprüft",
          {
            credentialId:
              event.credentialId,

            eventId:
              event.eventId,
          },
        );

        return;
      }

      if (
        verifiedCredential
          .credentialDefinitionId !==
        event.credentialDefinitionId
      ) {
        throw new Error(
          "Credential Definition stimmt nicht mit dem gespeicherten Proof überein",
        );
      }

      if (
        verifiedCredential
          .revocationRegistryDefinitionId !==
        event
          .revocationRegistryDefinitionId
      ) {
        throw new Error(
          "Revocation Registry stimmt nicht mit dem gespeicherten Proof überein",
        );
      }

      if (
        verifiedCredential.status ===
        "revoked-after-verification"
      ) {
        console.log(
          "[Verifier] Revocation wurde bereits verarbeitet",
          {
            credentialId:
              event.credentialId,

            eventId:
              event.eventId,
          },
        );

        return;
      }

      verifiedCredential.status =
        "revoked-after-verification";

      verifiedCredential.revokedAt =
        event.occurredAt;

      saveVerifiedCredentials();

      // Surface only this relevant revocation to the verifier UI via SSE.
      broadcast("revocation", {
        state: "revoked",
        credentialId: event.credentialId,
      });

      console.log(
        "[Verifier] Verifiziertes Credential wurde nachträglich widerrufen",
        {
          credentialId:
            event.credentialId,

          eventId:
            event.eventId,

          revokedAt:
            event.occurredAt,
        },
      );
    },
});

  // === Verifier actions ====================================================

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
      const oobJson = oobRecord.outOfBandInvitation.toJSON() as Record<
        string,
        unknown
      >;
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
            },
          ],
        },
      };

      // RFC-0441: Non-Revocation wird für einen einzelnen
      // Zeitpunkt angefragt, nicht für den Zeitraum 0 bis jetzt.
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
