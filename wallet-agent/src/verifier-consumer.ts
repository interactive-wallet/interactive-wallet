import * as amqp from "amqplib";
import type {
  Channel,
  ConsumeMessage,
} from "amqplib";

import {
  CREDENTIAL_TYPE,
  ISSUER_ROUTING_ID,
  RABBITMQ_URL,
  VERIFIER_ID,
} from "./config.js";

const EXCHANGE_NAME =
  "ssi.events";

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

  revocationRegistryDefinitionId:
    string;

  credentialRevocationId:
    string;
}

export interface VerifierConsumerOptions {
  trustedIssuerId: string;

  trustedCredentialDefinitionId:
    string;

  trustedRevocationRegistryDefinitionId:
    string;

  onCredentialRevoked: (
    event: CredentialRevokedEvent,
  ) => Promise<void>;
}

let connection:
  | Awaited<
      ReturnType<typeof amqp.connect>
    >
  | undefined;

let channel:
  | Channel
  | undefined;

function getVerifierQueueName():
  string {
  return [
    "verifier",
    VERIFIER_ID,
    "revocations",
  ].join(".");
}

function getRevocationBindingKey():
  string {
  return [
    "credential",
    "revoked",
    "v1",
    ISSUER_ROUTING_ID,
    CREDENTIAL_TYPE,
    "*",
  ].join(".");
}

function getExactRevocationRoutingKey(
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

function requireString(
  object: Record<string, unknown>,
  property: string,
): string {
  const value =
    object[property];

  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(
      `Event field '${property}' is missing or invalid`,
    );
  }

  return value;
}

function parseCredentialRevokedEvent(
  message: ConsumeMessage,
): CredentialRevokedEvent {
  let parsed: unknown;

  try {
    parsed =
      JSON.parse(
        message.content.toString(
          "utf8",
        ),
      );
  } catch {
    throw new Error(
      "RabbitMQ message does not contain valid JSON",
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "RabbitMQ event is not an object",
    );
  }

  const eventId =
    requireString(
      parsed,
      "eventId",
    );

  const occurredAt =
    requireString(
      parsed,
      "occurredAt",
    );

  const credentialId =
    requireString(
      parsed,
      "credentialId",
    );

  const credentialType =
    requireString(
      parsed,
      "credentialType",
    );

  const issuerId =
    requireString(
      parsed,
      "issuerId",
    );

  const issuerRoutingId =
    requireString(
      parsed,
      "issuerRoutingId",
    );

  const credentialDefinitionId =
    requireString(
      parsed,
      "credentialDefinitionId",
    );

  const revocationRegistryDefinitionId =
    requireString(
      parsed,
      "revocationRegistryDefinitionId",
    );

  const credentialRevocationId =
    requireString(
      parsed,
      "credentialRevocationId",
    );

  if (
    parsed.type !==
    "credential.revoked"
  ) {
    throw new Error(
      `Unexpected event type: ${String(
        parsed.type,
      )}`,
    );
  }

  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported event version: ${String(
        parsed.version,
      )}`,
    );
  }

  if (
    Number.isNaN(
      Date.parse(occurredAt),
    )
  ) {
    throw new Error(
      "occurredAt is not a valid timestamp",
    );
  }

  if (
    !/^[A-Za-z0-9_-]+$/.test(
      credentialId,
    )
  ) {
    throw new Error(
      "credentialId contains invalid characters",
    );
  }

  const event:
    CredentialRevokedEvent = {
    eventId,

    type:
      "credential.revoked",

    version:
      1,

    occurredAt,

    credentialId,
    credentialType,

    issuerId,
    issuerRoutingId,

    credentialDefinitionId,

    revocationRegistryDefinitionId,

    credentialRevocationId,
  };

  validateMessageConsistency(
    message,
    event,
  );

  return event;
}

function validateMessageConsistency(
  message: ConsumeMessage,
  event: CredentialRevokedEvent,
): void {
  if (
    event.issuerRoutingId !==
    ISSUER_ROUTING_ID
  ) {
    throw new Error(
      "issuerRoutingId in the event does not match the local configuration",
    );
  }

  if (
    event.credentialType !==
    CREDENTIAL_TYPE
  ) {
    throw new Error(
      "credentialType in the event does not match the local configuration",
    );
  }

  const expectedRoutingKey =
    getExactRevocationRoutingKey(
      event.credentialId,
    );

  if (
    message.fields.routingKey !==
    expectedRoutingKey
  ) {
    throw new Error(
      `Routing key does not match the event: ` +
        `${message.fields.routingKey}`,
    );
  }

  const messageType =
    message.properties.type;

  if (
    messageType &&
    messageType !== event.type
  ) {
    throw new Error(
      "RabbitMQ type property does not match the event type",
    );
  }

  const correlationId =
    message.properties.correlationId;

  if (
    correlationId &&
    correlationId !==
      event.credentialId
  ) {
    throw new Error(
      "RabbitMQ correlationId does not match credentialId",
    );
  }

  const messageId =
    message.properties.messageId;

  if (
    messageId &&
    messageId !== event.eventId
  ) {
    throw new Error(
      "RabbitMQ messageId does not match eventId",
    );
  }
}

function validateTrustedIssuer(
  event: CredentialRevokedEvent,
  options: VerifierConsumerOptions,
): void {
  if (
    event.issuerId !==
    options.trustedIssuerId
  ) {
    throw new Error(
      "Revocation event comes from an unexpected issuer DID",
    );
  }

  if (
    event.credentialDefinitionId !==
    options
      .trustedCredentialDefinitionId
  ) {
    throw new Error(
      "Revocation event uses an unexpected credential definition",
    );
  }

  if (
    event
      .revocationRegistryDefinitionId !==
    options
      .trustedRevocationRegistryDefinitionId
  ) {
    throw new Error(
      "Revocation event uses an unexpected revocation registry",
    );
  }
}

export async function initializeVerifierConsumer(
  options:
    VerifierConsumerOptions,
): Promise<void> {
  if (connection || channel) {
    throw new Error(
      "Verifier RabbitMQ consumer is already initialized",
    );
  }

  const queueName =
    getVerifierQueueName();

  const bindingKey =
    getRevocationBindingKey();

  const currentConnection =
    await amqp.connect(
      RABBITMQ_URL,
    );

  connection =
    currentConnection;

  currentConnection.on(
    "error",
    (error: unknown) => {
      console.error(
        "[Verifier RabbitMQ] connection error",
        error,
      );
    },
  );

  currentConnection.on(
    "close",
    () => {
      console.warn(
        "[Verifier RabbitMQ] connection closed",
      );
    },
  );

  const currentChannel =
    await currentConnection
      .createChannel();

  channel =
    currentChannel;

  currentChannel.on(
    "error",
    (error: unknown) => {
      console.error(
        "[Verifier RabbitMQ] channel error",
        error,
      );
    },
  );

  currentChannel.on(
    "close",
    () => {
      console.warn(
        "[Verifier RabbitMQ] channel closed",
      );
    },
  );

  await currentChannel.assertExchange(
    EXCHANGE_NAME,
    "topic",
    {
      durable: true,
    },
  );

  await currentChannel.assertQueue(
    queueName,
    {
      durable: true,
    },
  );

  await currentChannel.bindQueue(
    queueName,
    EXCHANGE_NAME,
    bindingKey,
  );

  await currentChannel.prefetch(
    10,
  );

  await currentChannel.consume(
    queueName,

    async (
      message: ConsumeMessage | null,
    ) => {
      if (!message) {
        return;
      }

      try {
        const event =
          parseCredentialRevokedEvent(
            message,
          );

        validateTrustedIssuer(
          event,
          options,
        );

        await options
          .onCredentialRevoked(
            event,
          );

        currentChannel.ack(
          message,
        );
      } catch (error) {
        console.error(
          "[Verifier RabbitMQ] could not process revocation event",
          {
            queue:
              queueName,

            routingKey:
              message.fields.routingKey,

            messageId:
              message.properties.messageId,

            error,
          },
        );

        currentChannel.nack(
          message,
          false,
          false,
        );
      }
    },

    {
      noAck: false,
    },
  );

  console.log(
    "[Verifier RabbitMQ] consumer initialized",
    {
      exchange:
        EXCHANGE_NAME,

      queue:
        queueName,

      binding:
        bindingKey,
    },
  );
}

export async function closeVerifierConsumer():
  Promise<void> {
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