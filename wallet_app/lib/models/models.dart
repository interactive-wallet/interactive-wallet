enum MessageStatus { pending, accepted, rejected, read }

enum CredentialStatus { valid, expired, revoked }

enum AuditEventType {
  credentialIssued,
  credentialVerified,
  connectionEstablished,
  proofVerified,
  messageSent,
  messageReceived,
}

class DIDMessage {
  final String id;
  final String senderDid;
  final String type;
  final DateTime timestamp;
  final MessageStatus status;
  final Map<String, dynamic> payload;
  final bool signatureVerified;

  const DIDMessage({
    required this.id,
    required this.senderDid,
    required this.type,
    required this.timestamp,
    required this.status,
    required this.payload,
    required this.signatureVerified,
  });
}

class Credential {
  final String id;
  final String issuerDid;
  final String type;
  final Map<String, String> claims;
  final DateTime issuedAt;
  final DateTime? expiresAt;
  final CredentialStatus status;

  const Credential({
    required this.id,
    required this.issuerDid,
    required this.type,
    required this.claims,
    required this.issuedAt,
    this.expiresAt,
    required this.status,
  });
}

class DIDConnection {
  final String id;
  final String theirDid;
  final String label;
  final DateTime connectedAt;
  final bool isActive;

  const DIDConnection({
    required this.id,
    required this.theirDid,
    required this.label,
    required this.connectedAt,
    required this.isActive,
  });
}

class AuditEvent {
  final String id;
  final String description;
  final DateTime timestamp;
  final String did;
  final AuditEventType type;
  final bool verified;
  final String hash;

  const AuditEvent({
    required this.id,
    required this.description,
    required this.timestamp,
    required this.did,
    required this.type,
    required this.verified,
    required this.hash,
  });
}
