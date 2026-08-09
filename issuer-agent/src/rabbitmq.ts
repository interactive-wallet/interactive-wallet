import { randomUUID } from "node:crypto";
import * as amqp from "amqplib";
import type { ConfirmChannel } from "amqplib";
import {
  CREDENTIAL_TYPE,
  ISSUER_ROUTING_ID,
} from "./config.js";

const EXCHANGE_NAME = "ssi.events";

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
  credentialType: string;

  issuerId: string;
  issuerRoutingId: string;

  credentialDefinitionId: string;

  revocationRegistryDefinitionId: string;
  credentialRevocationId: string;
}

function getRevocationRoutingKey(
  credentialId: string,
): string {
  return [
    "credential",
    "revoked",
    "v1",
    ISSUER_ROUTING_ID,
    CREDENTIAL_TYPE,
    credentialId,
  ].join(".");
}

export async function initializeRabbitMq(): Promise<void> {
  const url = process.env.RABBITMQ_URL;

  if (!url) {
    throw new Error(
      "RABBITMQ_URL is missing from the issuer's .env",
    );
  }

  connection = await amqp.connect(url);

  connection.on("error", (error: any) => {
    console.error(
      "RabbitMQ connection error:",
      error,
    );
  });

  connection.on("close", () => {
    console.warn(
      "RabbitMQ connection closed",
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

  console.log(
    "RabbitMQ Publisher initialized",
    {
      exchange: EXCHANGE_NAME,
    },
  );
}

export async function publishCredentialRevoked(
  input: {
    credentialId: string;

    issuerId: string;
    credentialDefinitionId: string;

    revocationRegistryDefinitionId: string;
    credentialRevocationId: string | number;
  }
): Promise<CredentialRevokedEvent> {
  if (!channel) {
    throw new Error(
      "RabbitMQ is not initialized",
    );
  }

  const currentChannel = channel;

  const event: CredentialRevokedEvent = {
    eventId:
      randomUUID(),

    type:
      "credential.revoked",

    version:
      1,

    occurredAt:
      new Date().toISOString(),

    credentialId:
      input.credentialId,

    credentialType:
      CREDENTIAL_TYPE,

    issuerId:
      input.issuerId,

    issuerRoutingId:
      ISSUER_ROUTING_ID,

    credentialDefinitionId:
      input.credentialDefinitionId,

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
    "Revocation event published to RabbitMQ",
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