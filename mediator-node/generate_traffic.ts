import {
  Agent,
  HttpOutboundTransport,
  WsOutboundTransport,
  ConnectionsModule,
  CredentialState,
  ProofState,
  ConnectionEventTypes,
  CredentialEventTypes,
  ProofEventTypes,
  ConnectionState,
  MediatorModule,
  AgentEventTypes,
  ConnectionStateChangedEvent,
  CredentialStateChangedEvent,
  ProofStateChangedEvent,
  DidsModule,
} from "@credo-ts/core";
import { agentDependencies, HttpInboundTransport } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { ariesAskar } from "@hyperledger/aries-askar-nodejs";
import { AnonCredsModule } from "@credo-ts/anoncreds";
import { anoncreds } from "@hyperledger/anoncreds-nodejs";
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from "@credo-ts/indy-vdr";
import { indyVdr } from "@hyperledger/indy-vdr-nodejs";

async function createAgent(
  name: string,
  port: number,
  mediatorInvitationUrl?: string,
) {
  const agent = new Agent({
    dependencies: agentDependencies,
    config: {
      label: name,
      walletConfig: {
        id: `wallet-${name}`,
        key: `key-${name}`.padEnd(32, "0"),
      },
      endpoints: mediatorInvitationUrl ? [] : [`http://localhost:${port}`],
    },
    modules: {
      askar: new AskarModule({ ariesAskar }),
      connections: new ConnectionsModule({ autoAcceptConnections: true }),
      dids: new DidsModule({
        registrars: [new IndyVdrIndyDidRegistrar()],
        resolvers: [new IndyVdrIndyDidResolver()],
      }),
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            isProduction: false,
            indyNamespace: "bcovrin:test",
            genesisTransactions: "<genesis transactions>",
            connectOnStartup: true,
          },
        ],
      }),
      anoncreds: new AnonCredsModule({
        registries: [new IndyVdrAnonCredsRegistry()],
        anoncreds,
      }),
    },
  });

  agent.registerOutboundTransport(new HttpOutboundTransport());
  agent.registerOutboundTransport(new WsOutboundTransport());
  if (!mediatorInvitationUrl) {
    agent.registerInboundTransport(new HttpInboundTransport({ port }));
  }

  await agent.initialize();

  if (mediatorInvitationUrl) {
    console.log(`${name}: Connecting to mediator...`);
    const outOfBandInvitation = await agent.oob.parseInvitation(
      mediatorInvitationUrl,
    );
    const connection = await agent.oob.receiveInvitation(outOfBandInvitation);

    // Wait for connection to be completed
    await new Promise<void>((resolve) => {
      const checkState = (event: ConnectionStateChangedEvent) => {
        if (
          event.payload.connectionRecord.id ===
            connection.connectionRecord?.id &&
          event.payload.connectionRecord.state === ConnectionState.Complete
        ) {
          agent.events.off(
            ConnectionEventTypes.ConnectionStateChanged,
            checkState,
          );
          resolve();
        }
      };
      agent.events.on(ConnectionStateChangedEvent, checkState);
    });

    console.log(`${name}: Requesting mediation...`);
    const mediationRecord = await agent.mediationRecipient.requestAndAwaitGrant(
      connection.connectionRecord!,
    );
    await agent.mediationRecipient.setDefaultMediator(mediationRecord);
    console.log(`${name}: Mediation granted and set as default.`);
  }

  return agent;
}

async function run() {
  const mediatorPort = 3000;

  console.log("--- Starting Local Mediator ---");
  const mediator = new Agent({
    dependencies: agentDependencies,
    config: {
      label: "Mediator",
      walletConfig: {
        id: "wallet-mediator-traffic",
        key: "mediator_00000000000000000000000",
      },
      endpoints: [`http://localhost:${mediatorPort}`],
    },
    modules: {
      askar: new AskarModule({ ariesAskar }),
      connections: new ConnectionsModule({ autoAcceptConnections: true }),
      mediator: new MediatorModule({ autoAcceptMediationRequests: true }),
    },
  });
  mediator.registerOutboundTransport(new HttpOutboundTransport());
  mediator.registerOutboundTransport(new WsOutboundTransport());
  mediator.registerInboundTransport(
    new HttpInboundTransport({ port: mediatorPort }),
  );

  mediator.events.on(AgentEventTypes.AgentMessageReceived, (data) => {
    // @ts-ignore
    console.log(
      `[MEDIATOR LOG] Message received: ${(data.payload as any).message.type}`,
    );
  });

  await mediator.initialize();
  const invitation = await mediator.oob.createInvitation({
    multiUseInvitation: true,
  });
  const mediatorInvitation = invitation.outOfBandInvitation.toUrl({
    domain: `http://localhost:${mediatorPort}`,
  });
  console.log(`Mediator invitation: ${mediatorInvitation}`);

  // 2. Setup Faber (Issuer)
  console.log("\n--- Starting Faber ---");
  const faber = await createAgent("Faber", 3001);

  // 3. Create Schema and Cred Def for Faber
  console.log("Faber: Registering Schema and Credential Definition...");
  const schemaResult = await faber.modules.anoncreds.registerSchema({
    schema: {
      attrNames: ["name", "degree"],
      issuerId: "did:indy:local:Faber",
      name: "Masters Certificate",
      version: "1.0",
    },
    options: {},
  });

  const credDefResult =
    await faber.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: {
        issuerId: "did:indy:local:Faber",
        schemaId: schemaResult.schemaState.schemaId!,
        tag: "default",
      },
      options: {},
    });
  const credDefId =
    credDefResult.credentialDefinitionState.credentialDefinitionId!;

  // 4. Setup Alice (Holder) - using the mediator
  console.log("\n--- Starting Alice (with Mediator) ---");
  const alice = await createAgent("Alice", 3002, mediatorInvitation);

  // 5. Connect Alice and Faber
  console.log("\n--- Connecting Alice and Faber ---");
  const { outOfBandInvitation: faberInvitation } =
    await faber.oob.createInvitation();
  const { connectionRecord: aliceFaberConnection } =
    await alice.oob.receiveInvitation(faberInvitation);

  await new Promise<void>((resolve) => {
    const checkState = (event: ConnectionStateChangedEvent) => {
      if (
        event.payload.connectionRecord.id === aliceFaberConnection?.id &&
        event.payload.connectionRecord.state === ConnectionState.Complete
      ) {
        alice.events.off(
          ConnectionEventTypes.ConnectionStateChanged,
          checkState,
        );
        resolve();
      }
    };
    alice.events.on(ConnectionEventTypes.ConnectionStateChanged, checkState);
  });
  const faberAliceConnection = (
    await faber.connections.findAllByOutOfBandId(faberInvitation.id)
  )[0];
  console.log("Alice and Faber connected.");

  // 6. Faber issues Credential
  console.log("\n--- Issuing Masters Certificate ---");
  await faber.credentials.offerCredential({
    connectionId: faberAliceConnection.id,
    credentialFormats: {
      anoncreds: {
        attributes: [
          { name: "name", value: "Alice" },
          { name: "degree", value: "Computer Science" },
        ],
        credentialDefinitionId: credDefId,
      },
    },
  });

  await new Promise<void>((resolve) => {
    alice.events.on(
      CredentialEventTypes.CredentialStateChanged,
      async (event: CredentialStateChangedEvent) => {
        if (
          event.payload.credentialRecord.state === CredentialState.OfferReceived
        ) {
          console.log("Alice: Received offer, accepting...");
          await alice.credentials.acceptOffer({
            credentialRecordId: event.payload.credentialRecord.id,
          });
        }
        if (
          event.payload.credentialRecord.state ===
          CredentialState.CredentialReceived
        ) {
          console.log("Alice: Credential received!");
          resolve();
        }
      },
    );
  });

  // 7. Faber requests Proof
  console.log("\n--- Requesting and Presenting Proof ---");
  await faber.proofs.requestProof({
    connectionId: faberAliceConnection.id,
    proofFormats: {
      anoncreds: {
        name: "Proof of Masters",
        version: "1.0",
        requested_attributes: {
          degree: {
            name: "degree",
            restrictions: [{ cred_def_id: credDefId }],
          },
        },
      },
    },
  });

  await new Promise<void>((resolve) => {
    alice.events.on(
      ProofEventTypes.ProofStateChanged,
      async (event: ProofStateChangedEvent) => {
        if (event.payload.proofRecord.state === ProofState.RequestReceived) {
          console.log("Alice: Received proof request, presenting...");
          const retrieval = await alice.proofs.selectCredentialsForRequest({
            proofRecordId: event.payload.proofRecord.id,
          });
          await alice.proofs.acceptRequest({
            proofRecordId: event.payload.proofRecord.id,
            proofFormats: retrieval.proofFormats,
          });
        }
        if (
          event.payload.proofRecord.state === ProofState.PresentationReceived
        ) {
          console.log("Faber: Proof received and verified!");
          resolve();
        }
      },
    );
  });

  console.log("\nSuccess: Traffic generation complete.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
