import * as amqp from "amqplib";
import type {
  Channel,
  ConsumeMessage,
} from "amqplib";
import fs from "node:fs";
import path from "node:path";

import type {
  WalletAgent,
} from "./agent.js";

import {
  CREDENTIAL_TYPE,
  HOLDER_ID,
  ISSUER_ROUTING_ID,
  RABBITMQ_URL,
} from "./config.js";

const EXCHANGE_NAME =
  "ssi.events";

const DATA_DIRECTORY =
  path.join(
    import.meta.dirname,
    "..",
    "data",
  );

const STATUS_FILE =
  path.join(
    DATA_DIRECTORY,
    "holder-revocations.json",
  );

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

interface StoredAnonCredsCredential {
  credentialId: string;

  attributes:
    Record<string, string>;

  schemaId: string;

  credentialDefinitionId:
    string;

  revocationRegistryId?:
    string;

  credentialRevocationId?:
    string;
}

export interface HolderRevocationRecord {
  credentialId: string;

  localCredentialId: string;

  credentialDefinitionId:
    string;

  revocationRegistryDefinitionId:
    string;

  credentialRevocationId:
    string;

  status:
    "revoked";

  eventId: string;

  occurredAt: string;

  confirmedAt: string;

  ledgerTimestamp:
    number;
}

type HolderRevocationStore =
  Record<
    string,
    HolderRevocationRecord
  >;

export interface HolderConsumerOptions {
  agent: WalletAgent;

  onCredentialRevoked?: (
    record:
      HolderRevocationRecord,

    event:
      CredentialRevokedEvent,
  ) => Promise<void> | void;
}

let connection:
  | Awaited<
      ReturnType<typeof amqp.connect>
    >
  | undefined;

let channel:
  | Channel
  | undefined;

function loadRevocationStore():
  HolderRevocationStore {
  try {
    return JSON.parse(
      fs.readFileSync(
        STATUS_FILE,
        "utf8",
      ),
    ) as HolderRevocationStore;
  } catch {
    return {};
  }
}

const revocationStore =
  loadRevocationStore();

function saveRevocationStore():
  void {
  fs.mkdirSync(
    DATA_DIRECTORY,
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    STATUS_FILE,
    JSON.stringify(
      revocationStore,
      null,
      2,
    ),
  );
}

export function getHolderRevocationStatuses():
  HolderRevocationRecord[] {
  return Object.values(
    revocationStore,
  );
}

function getQueueName():
  string {
  return [
    "holder",
    HOLDER_ID,
    "revocations",
  ].join(".");
}

function getBindingKey():
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

function getExactRoutingKey(
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
  object:
    Record<string, unknown>,

  property:
    string,
): string {
  const value =
    object[property];

  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(
      `Event property '${property}' is missing or invalid`,
    );
  }

  return value;
}

function parseCredentialRevokedEvent(
  message:
    ConsumeMessage,
): CredentialRevokedEvent {
  let parsed:
    unknown;

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

  if (
    parsed.version !== 1
  ) {
    throw new Error(
      `Unsupported event version: ${String(
        parsed.version,
      )}`,
    );
  }

  const event:
    CredentialRevokedEvent = {
    eventId:
      requireString(
        parsed,
        "eventId",
      ),

    type:
      "credential.revoked",

    version:
      1,

    occurredAt:
      requireString(
        parsed,
        "occurredAt",
      ),

    credentialId:
      requireString(
        parsed,
        "credentialId",
      ),

    credentialType:
      requireString(
        parsed,
        "credentialType",
      ),

    issuerId:
      requireString(
        parsed,
        "issuerId",
      ),

    issuerRoutingId:
      requireString(
        parsed,
        "issuerRoutingId",
      ),

    credentialDefinitionId:
      requireString(
        parsed,
        "credentialDefinitionId",
      ),

    revocationRegistryDefinitionId:
      requireString(
        parsed,
        "revocationRegistryDefinitionId",
      ),

    credentialRevocationId:
      requireString(
        parsed,
        "credentialRevocationId",
      ),
  };

  validateEvent(
    message,
    event,
  );

  return event;
}

function validateEvent(
  message:
    ConsumeMessage,

  event:
    CredentialRevokedEvent,
): void {
  if (
    Number.isNaN(
      Date.parse(
        event.occurredAt,
      ),
    )
  ) {
    throw new Error(
      "Event occurredAt is not a valid timestamp",
    );
  }

  if (
    !/^[A-Za-z0-9_-]+$/.test(
      event.credentialId,
    )
  ) {
    throw new Error(
      "Event credentialId contains invalid characters",
    );
  }

  if (
    event.issuerRoutingId !==
    ISSUER_ROUTING_ID
  ) {
    throw new Error(
      "Event issuerRoutingId does not match local configuration",
    );
  }

  if (
    event.credentialType !==
    CREDENTIAL_TYPE
  ) {
    throw new Error(
      "Event credentialType does not match local configuration",
    );
  }

  const expectedRoutingKey =
    getExactRoutingKey(
      event.credentialId,
    );

  if (
    message.fields.routingKey !==
    expectedRoutingKey
  ) {
    throw new Error(
      `Unexpected routing key: ${message.fields.routingKey}`,
    );
  }

  const messageId =
    message.properties.messageId;

  if (
    messageId &&
    messageId !==
      event.eventId
  ) {
    throw new Error(
      "RabbitMQ messageId does not match eventId",
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

  const messageType =
    message.properties.type;

  if (
    messageType &&
    messageType !==
      event.type
  ) {
    throw new Error(
      "RabbitMQ type does not match event type",
    );
  }
}

async function findLocalCredential(
  agent:
    WalletAgent,

  externalCredentialId:
    string,
): Promise<
  StoredAnonCredsCredential | undefined
> {
  const credentials =
    await agent.modules.anoncreds
      .getCredentials({}) as
      StoredAnonCredsCredential[];

  const matches =
    credentials.filter(
      (credential) =>
        credential.attributes
          ?.credential_id ===
        externalCredentialId,
    );

  if (
    matches.length > 1
  ) {
    throw new Error(
      `Multiple local credentials use credential_id ${externalCredentialId}`,
    );
  }

  return matches[0];
}

function validateLocalCredential(
  credential:
    StoredAnonCredsCredential,

  event:
    CredentialRevokedEvent,
): void {
  if (
    credential
      .credentialDefinitionId !==
    event.credentialDefinitionId
  ) {
    throw new Error(
      "Event credential definition does not match local credential",
    );
  }

  if (
    credential
      .revocationRegistryId !==
    event
      .revocationRegistryDefinitionId
  ) {
    throw new Error(
      "Event revocation registry does not match local credential",
    );
  }

  if (
    String(
      credential
        .credentialRevocationId,
    ) !==
    event.credentialRevocationId
  ) {
    throw new Error(
      "Event credential revocation id does not match local credential",
    );
  }
}

function sleep(
  milliseconds:
    number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

async function confirmRevocationOnLedger(
  agent:
    WalletAgent,

  event:
    CredentialRevokedEvent,

  attempts =
    10,
): Promise<number> {
  const revocationIndex =
    Number(
      event.credentialRevocationId,
    );

  if (
    !Number.isInteger(
      revocationIndex,
    ) ||
    revocationIndex < 0
  ) {
    throw new Error(
      `Invalid credential revocation id: ${event.credentialRevocationId}`,
    );
  }

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    const timestamp =
      Math.floor(
        Date.now() / 1000,
      );

    const result =
      await agent.modules.anoncreds
        .getRevocationStatusList(
          event
            .revocationRegistryDefinitionId,

          timestamp,

          {
            useCache:
              false,
          },
        );

    const statusList =
      result.revocationStatusList;

    if (statusList) {
      const status =
        statusList.revocationList[
          revocationIndex
        ];

      if (
        status === undefined
      ) {
        throw new Error(
          `Revocation index ${revocationIndex} is outside the status list`,
        );
      }

      if (
        Number(status) === 1
      ) {
        return statusList.timestamp;
      }
    }

    if (
      attempt < attempts
    ) {
      await sleep(
        1_000,
      );
    }
  }

  throw new Error(
    `Ledger did not confirm revocation index ${event.credentialRevocationId}`,
  );
}

async function handleCredentialRevoked(
  options:
    HolderConsumerOptions,

  event:
    CredentialRevokedEvent,
): Promise<void> {
  const localCredential =
    await findLocalCredential(
      options.agent,
      event.credentialId,
    );

  if (!localCredential) {
    console.log(
      "[Holder RabbitMQ] Event ignored because credential is not stored locally",
      {
        credentialId:
          event.credentialId,

        eventId:
          event.eventId,
      },
    );

    return;
  }

  validateLocalCredential(
    localCredential,
    event,
  );

  const existingRecord =
    revocationStore[
      event.credentialId
    ];

  if (
    existingRecord?.status ===
    "revoked"
  ) {
    console.log(
      "[Holder RabbitMQ] Revocation event was already processed",
      {
        credentialId:
          event.credentialId,

        eventId:
          event.eventId,
      },
    );

    return;
  }

  const ledgerTimestamp =
    await confirmRevocationOnLedger(
      options.agent,
      event,
    );

  const record:
    HolderRevocationRecord = {
    credentialId:
      event.credentialId,

    localCredentialId:
      localCredential
        .credentialId,

    credentialDefinitionId:
      localCredential
        .credentialDefinitionId,

    revocationRegistryDefinitionId:
      event
        .revocationRegistryDefinitionId,

    credentialRevocationId:
      event
        .credentialRevocationId,

    status:
      "revoked",

    eventId:
      event.eventId,

    occurredAt:
      event.occurredAt,

    confirmedAt:
      new Date().toISOString(),

    ledgerTimestamp,
  };

  revocationStore[
    event.credentialId
  ] = record;

  saveRevocationStore();

  console.log(
    "[Holder RabbitMQ] Credential revocation confirmed and stored",
    record,
  );

  try {
    await options
      .onCredentialRevoked?.(
        record,
        event,
      );
  } catch (error) {
    console.error(
      "[Holder RabbitMQ] Local notification failed",
      error,
    );
  }
}

export async function initializeHolderConsumer(
  options:
    HolderConsumerOptions,
): Promise<void> {
  if (
    connection ||
    channel
  ) {
    throw new Error(
      "Holder RabbitMQ consumer is already initialized",
    );
  }

  const queueName =
    getQueueName();

  const bindingKey =
    getBindingKey();

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
        "[Holder RabbitMQ] Connection error",
        error,
      );
    },
  );

  currentConnection.on(
    "close",
    () => {
      console.warn(
        "[Holder RabbitMQ] Connection closed",
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
        "[Holder RabbitMQ] Channel error",
        error,
      );
    },
  );

  currentChannel.on(
    "close",
    () => {
      console.warn(
        "[Holder RabbitMQ] Channel closed",
      );
    },
  );

  await currentChannel
    .assertExchange(
      EXCHANGE_NAME,
      "topic",
      {
        durable: true,
      },
    );

  await currentChannel
    .assertQueue(
      queueName,
      {
        durable: true,
      },
    );

  await currentChannel
    .bindQueue(
      queueName,
      EXCHANGE_NAME,
      bindingKey,
    );

  await currentChannel
    .prefetch(
      10,
    );

  await currentChannel.consume(
    queueName,

    async (
      message:
        ConsumeMessage | null,
    ) => {
      if (!message) {
        return;
      }

      try {
        const event =
          parseCredentialRevokedEvent(
            message,
          );

        await handleCredentialRevoked(
          options,
          event,
        );

        currentChannel.ack(
          message,
        );
      } catch (error) {
        console.error(
          "[Holder RabbitMQ] Event processing failed",
          {
            queue:
              queueName,

            routingKey:
              message.fields
                .routingKey,

            messageId:
              message.properties
                .messageId,

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
    "[Holder RabbitMQ] Consumer initialized",
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

export async function closeHolderConsumer():
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