import {
  AnonCredsCredentialFormatService,
  AnonCredsModule,
  AnonCredsProofFormatService,
} from "@credo-ts/anoncreds";
import { AskarModule } from "@credo-ts/askar";
import {
  Agent,
  ConnectionEventTypes,
  ConnectionsModule,
  ConnectionState,
  ConnectionStateChangedEvent,
  CredentialEventTypes,
  CredentialsModule,
  CredentialState,
  CredentialStateChangedEvent,
  DidExchangeState,
  DidsModule,
  HttpOutboundTransport,
  PeerDidResolver,
  AgentMessageReceivedEvent,
  ProofEventTypes,
  ProofsModule,
  ProofState,
  ProofStateChangedEvent,
  V2CredentialProtocol,
  V2ProofProtocol,
  WsOutboundTransport,
} from "@credo-ts/core";
import {
  IndyVdrAnonCredsRegistry,
  IndyVdrIndyDidRegistrar,
  IndyVdrIndyDidResolver,
  IndyVdrModule,
} from "@credo-ts/indy-vdr";
import { agentDependencies, HttpInboundTransport } from "@credo-ts/node";
import { anoncreds } from "@hyperledger/anoncreds-nodejs";
import { ariesAskar } from "@hyperledger/aries-askar-nodejs";
import { indyVdr } from "@hyperledger/indy-vdr-nodejs";

const indyNamespace = "bcovrin:test";
const vonUrl = `http://127.0.0.1:9000`;
const genesisTransactions = await fetch(`${vonUrl}/genesis`).then((res) =>
  res.text(),
);

async function createAgent(
  name: string,
  port: number,
  mediatorDid?: string,
) {
  const key = `key-${name}00000000000000000000000`;
  console.log(`Ensure you have registered ${key} at ${vonUrl}`);

  const agent = new Agent({
    dependencies: agentDependencies,
    config: {
      label: name,
      walletConfig: { key, id: `wallet-${name}` },
      // when using a mediator, the agent itself is not publicly reachable
      endpoints: mediatorDid ? [] : [`http://127.0.0.1:${port}`],
    },
    modules: {
      askar: new AskarModule({ ariesAskar }),
      connections: new ConnectionsModule({ autoAcceptConnections: true }),
      dids: new DidsModule({
        registrars: [new IndyVdrIndyDidRegistrar()],
        resolvers: [new PeerDidResolver(), new IndyVdrIndyDidResolver()],
      }),
      credentials: new CredentialsModule({
        credentialProtocols: [
          new V2CredentialProtocol({
            credentialFormats: [new AnonCredsCredentialFormatService()],
          }),
        ],
      }),
      proofs: new ProofsModule({
        proofProtocols: [
          new V2ProofProtocol({
            proofFormats: [new AnonCredsProofFormatService()],
          }),
        ],
      }),
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            isProduction: false,
            indyNamespace,
            genesisTransactions,
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

    console.log(`${name}: Waiting for connection to mediator...`);
    await new Promise<void>((resolve) => {
      const checkState = (event: ConnectionStateChangedEvent) => {
        if (
          event.payload.connectionRecord.id ===
            connection.connectionRecord?.id &&
          event.payload.connectionRecord.state === DidExchangeState.Completed
        ) {
          agent.events.off(
            ConnectionEventTypes.ConnectionStateChanged,
            checkState,
          );
          resolve();
        }
      };
      agent.events.on(ConnectionEventTypes.ConnectionStateChanged, checkState);
    });

    console.log(`${name}: Connected to mediator. Requesting mediation...`);
    const mediationRecord = await agent.mediationRecipient.requestAndAwaitGrant(
      connection.connectionRecord!,
    );
    await agent.mediationRecipient.setDefaultMediator(mediationRecord);
    console.log(`${name}: Mediation granted.`);
  }

  return agent;
}

async function main() {
  const mediatorInvitationUrl = process.argv[2];

  console.log("\n--- Starting Faber ---");
  const faber = await createAgent("Faber", 3001);

  console.log("Faber: Registering Schema and Credential Definition...");
  const schemaResult = await faber.modules.anoncreds.registerSchema({
    schema: {
      attrNames: ["name", "degree"],
      issuerId: "Faber",
      name: "Masters Certificate",
      version: "1.0",
    },
    options: {},
  });

  const credDefResult =
    await faber.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: {
        issuerId: "Faber",
        schemaId: schemaResult.schemaState.schemaId!,
        tag: "default",
      },
      options: { supportRevocation: false },
    });
  const credDefId =
    credDefResult.credentialDefinitionState.credentialDefinitionId!;

  console.log("\n--- Starting Alice (with Mediator) ---");
  const alice = await createAgent("Alice", 3002, mediatorInvitationUrl);

  console.log("\n--- Connecting Alice and Faber ---");
  const { outOfBandInvitation: faberInvitation } =
    await faber.oob.createInvitation();
  const { connectionRecord: aliceFaberConnection } =
    await alice.oob.receiveInvitation(faberInvitation);

  await new Promise<void>((resolve) => {
    const checkState = (event: any) => {
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

  console.log("\n--- Issuing Masters Certificate ---");
  await faber.credentials.offerCredential({
    protocolVersion: "v2",
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

  console.log("\n--- Requesting and Presenting Proof ---");
  await faber.proofs.requestProof({
    protocolVersion: "v2",
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
          console.log(
            "Alice: Received proof request, selecting credentials and presenting...",
          );
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
          console.log("Faber: Proof verified!");
          resolve();
        }
      },
    );
  });

  console.log("\nSuccess: Traffic generation complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
