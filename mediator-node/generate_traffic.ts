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
  if (!mediatorDid) {
    agent.registerInboundTransport(new HttpInboundTransport({ port }));
  }

  await agent.initialize();

  if (mediatorDid) {
    console.log(`${name}: Connecting to mediator...`);
    // const connection = TODO(mediatorDid);

    const connection = await agent.connections.create({
      theirDid: mediatorDid,
    });

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
  const mediatorDid = process.argv[2];

  console.log("\n--- Starting Faber ---");
  const faber = await createAgent("Faber", 3001);

  console.log("Faber: Registering Schema and Credential Definition...");
  const faberDidResult = await faber.dids.create({
    method: "indy",
    options: { indyNamespace },
  });
  const faberDid = faberDidResult.didState.did!;
  console.log(`Faber DID created: ${faberDid}`);

  const schemaResult = await faber.modules.anoncreds.registerSchema({
    schema: {
      attrNames: ["name", "degree"],
      issuerId: faberDid,
      name: "Masters Certificate",
      version: "1.0",
    },
    options: {},
  });

  const credDefResult =
    await faber.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: {
        issuerId: faberDid,
        schemaId: schemaResult.schemaState.schemaId!,
        tag: "default",
      },
      options: { supportRevocation: false },
    });
  const credDefId =
    credDefResult.credentialDefinitionState.credentialDefinitionId!;

  console.log("\n--- Starting Alice (with Mediator) ---");
  const alice = await createAgent("Alice", 3002, mediatorDid);

  console.log("\n--- Issuing Masters Certificate to Alice ---");
  await faber.credentials.offerCredential({
    protocolVersion: "v2",
    connectionId: TODO,
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

  // TODO: alice checks mediator to receive certificate, and accepts it

  console.log("\n--- Requesting and Presenting Proof ---");
  await faber.proofs.requestProof({
    protocolVersion: "v2",
    connectionId: TODO,
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

  // TODO: alice checks mediator to receive proof request, and presents credentials

  console.log("\nSuccess: Traffic generation complete.");
  process.exit(0);
}

main().catch(console.error);
