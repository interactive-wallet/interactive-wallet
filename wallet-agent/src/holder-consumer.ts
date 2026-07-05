import * as amqp from "amqplib";
import type { Channel, ConsumeMessage } from "amqplib";

import {
  CREDENTIAL_TYPE,
  HOLDER_ID,
  ISSUER_ROUTING_ID,
  RABBITMQ_URL,
} from "./config.js";

const EXCHANGE_NAME = "ssi.events";

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

export interface HolderConsumerOptions {
  onCredentialRevoked: (event: CredentialRevokedEvent) => Promise<void>;
}

let connection:
  | Awaited<ReturnType<typeof amqp.connect>>
  | undefined;
let channel: Channel | undefined;

// Same structured topic as the verifier: grouping by issuer + credential type,
// with the concrete credentialId as the last (wildcard-matched) segment.
function getHolderQueueName(): string {
  return ["holder", HOLDER_ID, "revocations"].join(".");
}

function getRevocationBindingKey(): string {
  return ["credential", "revoked", "v1", ISSUER_ROUTING_ID, CREDENTIAL_TYPE, "*"].join(".");
}

function getExactRevocationRoutingKey(credentialId: string): string {
  return ["credential", "revoked", "v1", ISSUER_ROUTING_ID, CREDENTIAL_TYPE, credentialId].join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(object: Record<string, unknown>, property: string): string {
  const value = object[property];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Event-Feld '${property}' fehlt oder ist ungültig`);
  }
  return value;
}

function parseCredentialRevokedEvent(message: ConsumeMessage): CredentialRevokedEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content.toString("utf8"));
  } catch {
    throw new Error("RabbitMQ-Nachricht enthält kein gültiges JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("RabbitMQ-Event ist kein Objekt");
  }

  const eventId = requireString(parsed, "eventId");
  const occurredAt = requireString(parsed, "occurredAt");
  const credentialId = requireString(parsed, "credentialId");
  const credentialType = requireString(parsed, "credentialType");
  const issuerId = requireString(parsed, "issuerId");
  const issuerRoutingId = requireString(parsed, "issuerRoutingId");
  const credentialDefinitionId = requireString(parsed, "credentialDefinitionId");
  const revocationRegistryDefinitionId = requireString(parsed, "revocationRegistryDefinitionId");
  const credentialRevocationId = requireString(parsed, "credentialRevocationId");

  if (parsed.type !== "credential.revoked") {
    throw new Error(`Unerwarteter Eventtyp: ${String(parsed.type)}`);
  }
  if (parsed.version !== 1) {
    throw new Error(`Nicht unterstützte Eventversion: ${String(parsed.version)}`);
  }
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("occurredAt ist kein gültiger Zeitstempel");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(credentialId)) {
    throw new Error("credentialId enthält ungültige Zeichen");
  }

  const event: CredentialRevokedEvent = {
    eventId,
    type: "credential.revoked",
    version: 1,
    occurredAt,
    credentialId,
    credentialType,
    issuerId,
    issuerRoutingId,
    credentialDefinitionId,
    revocationRegistryDefinitionId,
    credentialRevocationId,
  };

  validateMessageConsistency(message, event);
  return event;
}

function validateMessageConsistency(message: ConsumeMessage, event: CredentialRevokedEvent): void {
  if (event.issuerRoutingId !== ISSUER_ROUTING_ID) {
    throw new Error("issuerRoutingId im Event stimmt nicht mit der lokalen Konfiguration überein");
  }
  if (event.credentialType !== CREDENTIAL_TYPE) {
    throw new Error("credentialType im Event stimmt nicht mit der lokalen Konfiguration überein");
  }
  const expectedRoutingKey = getExactRevocationRoutingKey(event.credentialId);
  if (message.fields.routingKey !== expectedRoutingKey) {
    throw new Error(`Routing-Key stimmt nicht mit dem Event überein: ${message.fields.routingKey}`);
  }
  const messageType = message.properties.type;
  if (messageType && messageType !== event.type) {
    throw new Error("RabbitMQ type property stimmt nicht mit dem Eventtyp überein");
  }
  const correlationId = message.properties.correlationId;
  if (correlationId && correlationId !== event.credentialId) {
    throw new Error("RabbitMQ correlationId stimmt nicht mit credentialId überein");
  }
  const messageId = message.properties.messageId;
  if (messageId && messageId !== event.eventId) {
    throw new Error("RabbitMQ messageId stimmt nicht mit eventId überein");
  }
}

export async function initializeHolderConsumer(options: HolderConsumerOptions): Promise<void> {
  if (connection || channel) {
    throw new Error("Holder RabbitMQ Consumer ist bereits initialisiert");
  }

  const queueName = getHolderQueueName();
  const bindingKey = getRevocationBindingKey();

  const currentConnection = await amqp.connect(RABBITMQ_URL);
  connection = currentConnection;

  currentConnection.on("error", (error: unknown) => {
    console.error("[Holder RabbitMQ] Verbindungsfehler", error);
  });
  currentConnection.on("close", () => {
    console.warn("[Holder RabbitMQ] Verbindung geschlossen");
  });

  const currentChannel = await currentConnection.createChannel();
  channel = currentChannel;

  currentChannel.on("error", (error: unknown) => {
    console.error("[Holder RabbitMQ] Channel-Fehler", error);
  });
  currentChannel.on("close", () => {
    console.warn("[Holder RabbitMQ] Channel geschlossen");
  });

  await currentChannel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
  await currentChannel.assertQueue(queueName, { durable: true });
  await currentChannel.bindQueue(queueName, EXCHANGE_NAME, bindingKey);
  await currentChannel.prefetch(10);

  await currentChannel.consume(
    queueName,
    async (message: ConsumeMessage | null) => {
      if (!message) return;
      try {
        const event = parseCredentialRevokedEvent(message);
        await options.onCredentialRevoked(event);
        currentChannel.ack(message);
      } catch (error) {
        console.error("[Holder RabbitMQ] Revocation-Event konnte nicht verarbeitet werden", {
          queue: queueName,
          routingKey: message.fields.routingKey,
          messageId: message.properties.messageId,
          error,
        });
        currentChannel.nack(message, false, false);
      }
    },
    { noAck: false },
  );

  console.log("[Holder RabbitMQ] Consumer initialisiert", {
    exchange: EXCHANGE_NAME,
    queue: queueName,
    binding: bindingKey,
  });
}

export async function closeHolderConsumer(): Promise<void> {
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
