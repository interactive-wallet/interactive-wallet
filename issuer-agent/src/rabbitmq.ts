import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import type { ConfirmChannel } from "amqplib";

const EXCHANGE_NAME = "ssi.events";

const HOLDER_ID = "wallet";

const REVOCATION_QUEUE =
  `holder.${HOLDER_ID}.revocations`;

let connection:
  | Awaited<ReturnType<typeof amqp.connect>>
  | undefined;

let channel: ConfirmChannel | undefined;

export interface CredentialRevokedEvent {
  eventId: string;
  type: "credential.revoked";
  version: 1;
  occurredAt: string;

  credentialId: string;
  holderId: string;

  revocationRegistryDefinitionId: string;
  credentialRevocationId: string;
}

function getRevocationRoutingKey(
  credentialId: string,
): string {
  return `credential.revoked.${credentialId}`;
}

export async function initializeRabbitMq(): Promise<void> {
  const url = process.env.RABBITMQ_URL;

  if (!url) {
    throw new Error(
      "RABBITMQ_URL fehlt in der .env des Issuers",
    );
  }

  connection = await amqp.connect(url);

  connection.on("error", (error: any) => {
    console.error(
      "RabbitMQ-Verbindungsfehler:",
      error,
    );
  });

  connection.on("close", () => {
    console.warn(
      "RabbitMQ-Verbindung wurde geschlossen",
    );
  });

  channel =
    await connection.createConfirmChannel();

  await channel.assertExchange(
    EXCHANGE_NAME,
    "topic",
    {
      durable: true,
    },
  );

  await channel.assertQueue(
    REVOCATION_QUEUE,
    {
      durable: true,
    },
  );

  console.log(
    "RabbitMQ Publisher initialisiert",
    {
      exchange: EXCHANGE_NAME,
      queue: REVOCATION_QUEUE,
    },
  );
}

export async function registerCredentialRevocationRoute(
  credentialId: string,
): Promise<void> {
  if (!channel) {
    throw new Error(
      "RabbitMQ ist nicht initialisiert",
    );
  }

  const routingKey =
    getRevocationRoutingKey(
      credentialId,
    );


  await channel.assertQueue(
    REVOCATION_QUEUE,
    {
      durable: true,
    },
  );

  await channel.bindQueue(
    REVOCATION_QUEUE,
    EXCHANGE_NAME,
    routingKey,
  );

  console.log(
    "Credential-spezifische Revocation-Route registriert",
    {
      credentialId,
      queue: REVOCATION_QUEUE,
      routingKey,
    },
  );
}

export async function publishCredentialRevoked(
  input: {
    credentialId: string;

    revocationRegistryDefinitionId: string;
    credentialRevocationId: string | number;
  },
): Promise<CredentialRevokedEvent> {
  if (!channel) {
    throw new Error(
      "RabbitMQ ist nicht initialisiert",
    );
  }

  const currentChannel = channel;

  const event: CredentialRevokedEvent = {
    eventId: randomUUID(),
    type: "credential.revoked",
    version: 1,
    occurredAt: new Date().toISOString(),

    credentialId:
      input.credentialId,

    holderId:
      HOLDER_ID,

    revocationRegistryDefinitionId:
      input.revocationRegistryDefinitionId,

    credentialRevocationId:
      String(
        input.credentialRevocationId,
      ),
  };

  const routingKey =
    getRevocationRoutingKey(
      input.credentialId,
    );

  const publishedImmediately =
    currentChannel.publish(
      EXCHANGE_NAME,
      routingKey,

      Buffer.from(
        JSON.stringify(event),
        "utf8",
      ),

      {
        messageId:
          event.eventId,

        correlationId:
          event.credentialId,

        type:
          event.type,

        contentType:
          "application/json",

        contentEncoding:
          "utf-8",

        persistent:
          true,

        timestamp:
          Date.now(),
      },
    );


  if (!publishedImmediately) {
    await new Promise<void>(
      (resolve) => {
        currentChannel.once(
          "drain",
          resolve,
        );
      },
    );
  }

  await currentChannel.waitForConfirms();

  console.log(
    "Revocation-Event an RabbitMQ übermittelt",
    {
      eventId:
        event.eventId,

      credentialId:
        event.credentialId,

      routingKey,

      revocationRegistryDefinitionId:
        event.revocationRegistryDefinitionId,

      credentialRevocationId:
        event.credentialRevocationId,
    },
  );

  return event;
}

export async function closeRabbitMq(): Promise<void> {
  try {
    await channel?.close();
  } finally {
    channel = undefined;
  }

  try {
    await connection?.close();
  } finally {
    connection = undefined;
  }
}