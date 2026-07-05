/// Data classes matching the wallet-agent REST/SSE payloads.
/// These live alongside the existing mock-oriented models in models.dart
/// until the screens are wired to the repository.
library;

DateTime _parseDate(dynamic v) =>
    v is String ? DateTime.tryParse(v) ?? DateTime.now() : DateTime.now();

/// A credential stored in the wallet. From GET /credentials.
class StoredCredential {
  final String credentialId;
  final String? schemaId;
  final String? credentialDefinitionId;
  final Map<String, String> attributes;
  final DateTime createdAt;

  const StoredCredential({
    required this.credentialId,
    required this.schemaId,
    required this.credentialDefinitionId,
    required this.attributes,
    required this.createdAt,
  });

  factory StoredCredential.fromJson(Map<String, dynamic> j) => StoredCredential(
        credentialId: (j['credentialId'] ?? j['id'] ?? '') as String,
        schemaId: j['schemaId'] as String?,
        credentialDefinitionId: j['credentialDefinitionId'] as String?,
        attributes: (j['attributes'] as Map?)?.map(
              (k, v) => MapEntry(k.toString(), v?.toString() ?? ''),
            ) ??
            const {},
        createdAt: _parseDate(j['createdAt']),
      );
}

/// An incoming credential offer awaiting accept/decline. From GET /pending-credentials.
class PendingCredentialOffer {
  final String id;
  final String? credDefId;
  final String? schemaId;
  final String? fromLabel;
  final DateTime createdAt;

  const PendingCredentialOffer({
    required this.id,
    required this.credDefId,
    required this.schemaId,
    required this.fromLabel,
    required this.createdAt,
  });

  factory PendingCredentialOffer.fromJson(Map<String, dynamic> j) =>
      PendingCredentialOffer(
        id: j['id'] as String,
        credDefId: j['credDefId'] as String?,
        schemaId: j['schemaId'] as String?,
        fromLabel: j['fromLabel'] as String?,
        createdAt: _parseDate(j['createdAt']),
      );
}

/// A proof exchange (request or completed). From GET /proof-exchanges.
class ProofExchange {
  final String id;
  final String state;
  final bool? isVerified;
  final String? connectionId;
  final List<String> requestedAttributes;
  final DateTime createdAt;

  const ProofExchange({
    required this.id,
    required this.state,
    required this.isVerified,
    required this.connectionId,
    required this.requestedAttributes,
    required this.createdAt,
  });

  bool get isPending => state == 'request-received';

  factory ProofExchange.fromJson(Map<String, dynamic> j) => ProofExchange(
        id: j['id'] as String,
        state: j['state'] as String,
        isVerified: j['isVerified'] as bool?,
        connectionId: j['connectionId'] as String?,
        requestedAttributes:
            (j['requestedAttributes'] as List? ?? const []).map((e) => e.toString()).toList(),
        createdAt: _parseDate(j['createdAt']),
      );
}

/// A DIDComm connection. From GET /connections.
class WalletConnection {
  final String id;
  final String state;
  final String? role;
  final String? theirLabel;
  final String? theirDid;
  final DateTime createdAt;

  const WalletConnection({
    required this.id,
    required this.state,
    required this.role,
    required this.theirLabel,
    required this.theirDid,
    required this.createdAt,
  });

  factory WalletConnection.fromJson(Map<String, dynamic> j) => WalletConnection(
        id: j['id'] as String,
        state: j['state'] as String,
        role: j['role'] as String?,
        theirLabel: j['theirLabel'] as String?,
        theirDid: j['theirDid'] as String?,
        createdAt: _parseDate(j['createdAt']),
      );
}

/// A single live event from SSE (/events).
class WalletEvent {
  /// One of: 'system', 'connection', 'credential', 'proof', 'revocation'.
  final String type;

  /// Protocol state at the time the event fired, e.g. 'offer-received', 'done'.
  final String? state;

  /// Human-readable label of the counterparty (connection events).
  final String? theirLabel;

  /// Proof verification result, when applicable.
  final bool? isVerified;

  /// UUID of the credential (credential and revocation events).
  final String? credentialId;

  final DateTime timestamp;
  final Map<String, dynamic> raw;

  const WalletEvent({
    required this.type,
    required this.state,
    required this.theirLabel,
    required this.isVerified,
    this.credentialId,
    required this.timestamp,
    required this.raw,
  });

  factory WalletEvent.fromJson(Map<String, dynamic> j) => WalletEvent(
        type: (j['type'] ?? 'system') as String,
        state: j['state'] as String?,
        theirLabel: j['theirLabel'] as String?,
        isVerified: j['isVerified'] as bool?,
        credentialId: j['credentialId'] as String?,
        timestamp: _parseDate(j['ts']),
        raw: j,
      );
}
