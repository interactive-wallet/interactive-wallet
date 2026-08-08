import type { Express, Response } from "express";

export function registerWalletRoutes(
  app: Express,
  agent: any,
  sseClients: Set<Response>,
  DidCommHandshakeProtocol: any,
): void {
  function broadcast(type: string, data: object) {
    const msg = `data: ${JSON.stringify({ type, ...data, ts: new Date().toISOString() })}\n\n`;
    for (const client of sseClients) {
      client.write(msg);
    }
  }

  // ─── Health ───────────────────────────────────────────────────────────────
  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Health check
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: Service is up
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status: { type: string, example: ok }
   */
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ─── SSE — live activity stream ───────────────────────────────────────────
  /**
   * @openapi
   * /events:
   *   get:
   *     summary: Server-sent events stream of live wallet activity (connections, credentials, proofs, revocations)
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: text/event-stream of JSON-encoded events
   *         content:
   *           text/event-stream:
   *             schema: { type: string }
   */
  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(
      `data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`,
    );
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  // ─── Credentials ──────────────────────────────────────────────────────────
  /**
   * @openapi
   * /credentials:
   *   get:
   *     summary: List AnonCreds credentials held by this wallet (holder role)
   *     description: In verifier role this route is overridden by verifier.ts to list verified credentials instead.
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: Array of held credentials
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { type: object }
   *       500:
   *         description: Failed to load credentials
   */
  app.get("/credentials", async (_req, res) => {
    try {
      const credentials = await agent.modules.anoncreds.getCredentials({});
      res.json(credentials);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Proof exchanges (incoming proof requests) ────────────────────────────
  /**
   * @openapi
   * /proof-exchanges:
   *   get:
   *     summary: List incoming proof requests with derived requested attributes
   *     tags: [Wallet]
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
   *                   requestedAttributes: { type: array, items: { type: string } }
   *                   credentialType: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load proof exchanges
   */
  app.get("/proof-exchanges", async (_req, res) => {
    try {
      const proofs = await agent.modules.didcomm.proofs.getAll();
      const result = await Promise.all(
        proofs.map(async (p: any) => {
          let requestedAttributes: string[] = [];
          let credentialType: string | null = null;
          try {
            const formatData = await agent.modules.didcomm.proofs.getFormatData(p.id);
            const req = formatData.request?.anoncreds;
            if (req?.requested_attributes) {
              requestedAttributes = Object.values(req.requested_attributes)
                .map((a: any) => a.name ?? a.names)
                .flat();
              // Derive the requested credential type from a restriction's
              // schema_id (e.g. ".../SCHEMA/Fuehrerschein/1.1" -> "Fuehrerschein").
              for (const group of Object.values(req.requested_attributes) as any[]) {
                const schemaId = group.restrictions?.find((r: any) => r.schema_id)?.schema_id;
                if (schemaId) {
                  const parts = String(schemaId).split("/");
                  const idx = parts.indexOf("SCHEMA");
                  credentialType = idx !== -1 && idx + 1 < parts.length ? parts[idx + 1] : String(schemaId);
                  break;
                }
              }
            }
          } catch {
            /* ignore */
          }
          return {
            id: p.id,
            state: p.state,
            isVerified: p.isVerified ?? null,
            connectionId: p.connectionId,
            requestedAttributes,
            credentialType,
            createdAt: p.createdAt,
          };
        }),
      );
      res.json(result);
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
   *     tags: [Wallet]
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
      res.json(connections.map((connection: any) => ({
        id: connection.id,
        state: connection.state,
        role: connection.role,
        theirLabel: connection.theirLabel,
        did: connection.did,
        theirDid: connection.theirDid,
        invitationDid: connection.invitationDid,
        outOfBandId: connection.outOfBandId,
        createdAt: connection.createdAt,
      })));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Credential exchanges ─────────────────────────────────────────────────
  /**
   * @openapi
   * /exchanges:
   *   get:
   *     summary: List credential exchange records
   *     tags: [Wallet]
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
   *                   errorMessage: { type: string, nullable: true }
   *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load credential exchanges
   */
  app.get("/exchanges", async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll();
      res.json(exchanges.map((e: any) => ({
        id: e.id,
        state: e.state,
        role: e.role,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt,
      })));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Receive invitation ───────────────────────────────────────────────────
  /**
   * @openapi
   * /receive-invitation:
   *   post:
   *     summary: Accept an out-of-band invitation and establish a connection
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: Connection established (or in progress)
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 oobId: { type: string }
  *                 connectionId: { type: string, nullable: true }
  *                 connectionState: { type: string, nullable: true }
   *       400:
   *         description: Missing invitationUrl
   *       500:
   *         description: Failed to process invitation
   */
  app.post("/receive-invitation", async (req, res) => {
    try {
      const { invitationUrl } = req.body as { invitationUrl: string };
      if (!invitationUrl) {
        res.status(400).json({ error: "Missing invitationUrl" });
        return;
      }
      // Detect OOB invitations where services[0] is a bare DID string.
      // In that case use receiveImplicitInvitation so the wallet sets pthid to the
      // DID itself — the issuer's ConnectionRequestHandler needs pthid to be a DID
      // to take the createFromImplicitInvitation path (Connections protocol v1).
      let invitationDid: string | null = null;
      try {
        const parsed = new URL(invitationUrl);
        const oobParam = parsed.searchParams.get("oob");
        if (oobParam) {
          const decoded = JSON.parse(Buffer.from(oobParam, "base64url").toString("utf-8"));
          const first = decoded?.services?.[0];
          if (typeof first === "string" && first.startsWith("did:")) invitationDid = first;
        }
      } catch { /* not a standard OOB URL, fall through */ }

      let outOfBandRecord: { id: string };
      let connectionRecord: { id: string; state: string } | undefined;
      if (invitationDid) {
        const result = await agent.modules.didcomm.oob.receiveImplicitInvitation({
          did: invitationDid,
          label: "Wallet",
          autoAcceptInvitation: true,
          autoAcceptConnection: true,
          handshakeProtocols: [DidCommHandshakeProtocol.Connections],
        });
        outOfBandRecord = result.outOfBandRecord;
        connectionRecord = result.connectionRecord ?? undefined;
      } else {
        const result = await agent.modules.didcomm.oob.receiveInvitationFromUrl(invitationUrl, {
          label: "Wallet",
          autoAcceptInvitation: true,
          autoAcceptConnection: true,
        });
        outOfBandRecord = result.outOfBandRecord;
        connectionRecord = result.connectionRecord ?? undefined;
      }
      res.json({
        oobId: outOfBandRecord.id,
        connectionId: connectionRecord?.id,
        connectionState: connectionRecord?.state,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /pickup-messages:
   *   post:
   *     summary: Trigger active message pickup from the mediator
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: Pickup executed
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 success: { type: boolean }
  *                 message: { type: string }
  *                 mediationRecordId: { type: string }
  *                 mediationState: { type: string }
  *                 mediationConnectionId: { type: string }
  *                 actualConnectionId: { type: string }
   *       500:
   *         description: No default mediator configured or pickup failed
   */
  app.post("/pickup-messages", async (_req, res) => {
    try {
      console.log("initiateMessagePickup");
      const defaultMediator = await agent.modules.mediationRecipient.findDefaultMediator();
      if (!defaultMediator) throw new Error("No default mediator");
      await agent.modules.mediationRecipient.initiateMessagePickup(defaultMediator);
      console.log("pickupMessages");
      const mediatorConnection = await agent.modules.mediationRecipient.findDefaultMediatorConnection();
      if (!mediatorConnection) throw new Error("No default mediator connection");
      await (agent.modules.mediationRecipient as any).messagePickupApi.pickupMessages({
        connectionId: mediatorConnection.id,
        batchSize: 10,
        protocolVersion: "v2",
      });
      res.json({
        success: true,
        message: "Pickup executed",
        mediationRecordId: defaultMediator.id,
        mediationState: defaultMediator.state,
        mediationConnectionId: defaultMediator.connectionId,
        actualConnectionId: mediatorConnection.id,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Pending credential offers ────────────────────────────────────────────
  /**
   * @openapi
   * /pending-credentials:
   *   get:
   *     summary: List credential offers awaiting a holder decision
   *     tags: [Wallet]
   *     responses:
   *       200:
   *         description: Array of pending credential offers
  *         content:
  *           application/json:
  *             schema:
  *               type: array
  *               items:
  *                 type: object
  *                 properties:
  *                   id: { type: string }
  *                   state: { type: string }
  *                   credDefId: { type: string, nullable: true }
  *                   schemaId: { type: string, nullable: true }
  *                   fromLabel: { type: string, nullable: true }
  *                   createdAt: { type: string, format: date-time }
   *       500:
   *         description: Failed to load pending offers
   */
  app.get("/pending-credentials", async (_req, res) => {
    try {
      const exchanges = await agent.modules.didcomm.credentials.getAll();
      const pending = exchanges.filter((e: any) => e.state === "offer-received");
      const result = await Promise.all(pending.map(async (e: any) => {
        let credDefId: string | null = null;
        let schemaId: string | null = null;
        let attributes: Record<string, string> = {};
        try {
          const formatData = await agent.modules.didcomm.credentials.getFormatData(e.id);
          const offer = (formatData.offer as any)?.anoncreds;
          if (offer) {
            credDefId = offer.cred_def_id ?? null;
            schemaId = offer.schema_id ?? null;
          }
        } catch { /* ignore */ }
        let fromLabel: string | null = null;
        if (e.connectionId) {
          try {
            const conn = await agent.modules.didcomm.connections.getById(e.connectionId);
            fromLabel = conn.theirLabel ?? null;
          } catch { /* ignore */ }
        }
        return { id: e.id, state: e.state, credDefId, schemaId, fromLabel, createdAt: e.createdAt };
      }));
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Accept credential offer ──────────────────────────────────────────────
  /**
   * @openapi
   * /accept-credential/{id}:
   *   post:
   *     summary: Accept a credential offer
   *     tags: [Wallet]
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         schema: { type: string }
  *         description: Credential exchange record ID
  *     responses:
  *       200:
  *         description: Offer accepted
  *       500:
  *         description: Accepting the offer failed
   */
  app.post("/accept-credential/:id", async (req, res) => {
    try {
      const record = await agent.modules.didcomm.credentials.acceptOffer({ credentialExchangeRecordId: req.params.id });
      res.json({ success: true, state: record.state });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Decline credential offer ─────────────────────────────────────────────
  /**
   * @openapi
   * /decline-credential/{id}:
   *   post:
   *     summary: Decline a credential offer
   *     tags: [Wallet]
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         schema: { type: string }
  *         description: Credential exchange record ID
  *     responses:
  *       200:
  *         description: Offer declined
  *       500:
  *         description: Declining the offer failed
   */
  app.post("/decline-credential/:id", async (req, res) => {
    try {
      await agent.modules.didcomm.credentials.declineOffer({ credentialExchangeRecordId: req.params.id });
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── Accept proof request (auto-selects credentials) ─────────────────────
  /**
   * @openapi
   * /accept-proof/{id}:
   *   post:
   *     summary: Auto-select matching credentials and accept a proof request
   *     tags: [Wallet]
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         schema: { type: string }
  *         description: Proof exchange record ID
  *     responses:
  *       200:
  *         description: Proof accepted and presentation sent
  *       500:
  *         description: Building or sending the presentation failed (e.g. revoked credential)
   */
  app.post("/accept-proof/:id", async (req, res) => {
    try {
      const selectedCredentials = await agent.modules.didcomm.proofs.selectCredentialsForRequest({ proofExchangeRecordId: req.params.id });
      const record = await agent.modules.didcomm.proofs.acceptRequest({
        proofExchangeRecordId: req.params.id,
        proofFormats: selectedCredentials.proofFormats,
      });
      res.json({ success: true, state: record.state });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Building the presentation failed — most commonly because the credential
      // has been revoked, so no valid non-revocation proof can be produced. Tell
      // the verifier via a problem report so its proof exchange fails right away
      // (→ Abandoned) instead of hanging until its re-check timeout expires.
      try {
        await agent.modules.didcomm.proofs.sendProblemReport({
          proofExchangeRecordId: req.params.id,
          description: `Presentation could not be created: ${message}`,
        });
      } catch (reportErr) {
        console.error("[wallet-agent] Failed to notify verifier after accept-proof failure", reportErr);
      }
      res.status(500).json({ error: message });
    }
  });

  // ─── Decline proof request ────────────────────────────────────────────────
  /**
   * @openapi
   * /decline-proof/{id}:
   *   post:
   *     summary: Decline a proof request
   *     tags: [Wallet]
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         schema: { type: string }
  *         description: Proof exchange record ID
  *     responses:
  *       200:
  *         description: Proof request declined
  *       500:
  *         description: Declining the request failed
   */
  app.post("/decline-proof/:id", async (req, res) => {
    try {
      await agent.modules.didcomm.proofs.declineRequest({ proofExchangeRecordId: req.params.id });
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
