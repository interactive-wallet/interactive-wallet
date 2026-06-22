import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import type { ConfirmChannel } from "amqplib";

const EXCHANGE_NAME = "ssi.events";

const HOLDER_ID = "wallet";

const REVOCATION_QUEUE = `holder.${HOLDER_ID}.revocations`;
const REVOCATION_ROUTING_KEY = `credential.revoked.${HOLDER_ID}`;

let connection:
  | Awaited<ReturnType<typeof amqp.connect>>
  | undefined;

let channel: ConfirmChannel | undefined;

export interface CredentialRevokedEvent {
  eventId: string;
  type: "credential.revoked";
  version: 1;
  occurredAt: string;

  holderId: string;
  revocationRegistryDefinitionId: string;
  credentialRevocationId: string;
}

export async function initializeRabbitMq(): Promise<void> {
  const url = process.env.RABBITMQ_URL;

  if (!url) {
    throw new Error(
      "RABBITMQ_URL fehlt in der .env des Issuers",
    );
  }

  connection = await amqp.connect(url);

  connection.on("error", (error) => {
    console.error("RabbitMQ-Verbindungsfehler:", error);
  });

  connection.on("close", () => {
    console.warn("RabbitMQ-Verbindung wurde geschlossen");
  });

  channel = await connection.createConfirmChannel();

  await channel.assertExchange(EXCHANGE_NAME, "topic", {
    durable: true,
  });

  await channel.assertQueue(REVOCATION_QUEUE, {
    durable: true,
  });

  await channel.bindQueue(
    REVOCATION_QUEUE,
    EXCHANGE_NAME,
    REVOCATION_ROUTING_KEY,
  );

  console.log("RabbitMQ Publisher initialisiert", {
    exchange: EXCHANGE_NAME,
    queue: REVOCATION_QUEUE,
    routingKey: REVOCATION_ROUTING_KEY,
  });
}

export async function publishCredentialRevoked(input: {
  revocationRegistryDefinitionId: string;
  credentialRevocationId: string | number;
}): Promise<CredentialRevokedEvent> {
  if (!channel) {
    throw new Error(
      "RabbitMQ ist nicht initialisiert",
    );
  }

  const event: CredentialRevokedEvent = {
    eventId: randomUUID(),
    type: "credential.revoked",
    version: 1,
    occurredAt: new Date().toISOString(),

    holderId: HOLDER_ID,
    revocationRegistryDefinitionId:
      input.revocationRegistryDefinitionId,
    credentialRevocationId:
      String(input.credentialRevocationId),
  };

  const publishedImmediately = channel.publish(
    EXCHANGE_NAME,
    REVOCATION_ROUTING_KEY,
    Buffer.from(JSON.stringify(event), "utf8"),
    {
      messageId: event.eventId,
      type: event.type,
      contentType: "application/json",
      contentEncoding: "utf-8",
      persistent: true,
      timestamp: Date.now(),
    },
  );

  if (!publishedImmediately) {
    await new Promise<void>((resolve) => {
      channel?.once("drain", resolve);
    });
  }

  await channel.waitForConfirms();

  console.log("Revocation-Event an RabbitMQ übermittelt", {
    eventId: event.eventId,
    revocationRegistryDefinitionId:
      event.revocationRegistryDefinitionId,
    credentialRevocationId:
      event.credentialRevocationId,
  });

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