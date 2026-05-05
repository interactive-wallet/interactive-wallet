import '../models/models.dart';

class MockData {
  MockData._();

  static const myDid =
      'did:peer:2.Ez6LSbcP9o6Lr5j9KHYF8WiLGjbnDJ5bCzJCFKn1v7RGQNA.Vz6MkmhZsNUUj3P6a3HWxQnsPPdMFp15yBRnbX1sXm3MeUkL';

  static final _now = DateTime.now();

  static final messages = [
    DIDMessage(
      id: 'msg-001',
      senderDid:
          'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      type: 'credentialOffer',
      timestamp: _now.subtract(const Duration(minutes: 5)),
      status: MessageStatus.pending,
      payload: {
        'senderName': 'TU Berlin Registry',
        'credentialType': 'UniversityDegree',
        'issuer': 'TU Berlin',
        'purpose': 'Issuing your Master of Science degree credential',
        'claims': {'degree': 'Master of Science', 'field': 'Computer Science'},
      },
      signatureVerified: true,
    ),
    DIDMessage(
      id: 'msg-002',
      senderDid:
          'did:peer:2.Ez6LSbYX5pY7VvBaK9dMCW4vRx2eCxqz9a5mFWeBdEpAqNJ7',
      type: 'proofRequest',
      timestamp: _now.subtract(const Duration(hours: 1)),
      status: MessageStatus.pending,
      payload: {
        'senderName': 'Berlin Airport Authority',
        'proofType': 'IdentityVerification',
        'requester': 'Berlin Airport',
        'purpose': 'Age and identity verification for terminal access',
        'retentionDays': 30,
        'sharedAttributes': [
          {'key': 'dateOfBirth', 'label': 'Date of Birth'},
          {'key': 'nationality', 'label': 'Nationality'},
        ],
        'hiddenAttributes': [
          {'key': 'firstName', 'label': 'First Name'},
          {'key': 'lastName', 'label': 'Last Name'},
          {'key': 'idNumber', 'label': 'ID Number'},
          {'key': 'address', 'label': 'Address'},
        ],
      },
      signatureVerified: true,
    ),
    DIDMessage(
      id: 'msg-003',
      senderDid:
          'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: 'connectionInvite',
      timestamp: _now.subtract(const Duration(hours: 3)),
      status: MessageStatus.pending,
      payload: {
        'senderName': 'Bundesagentur für Arbeit',
        'label': 'Bundesagentur für Arbeit',
        'goal': 'Employment credential verification and job matching services',
        'retentionDays': 365,
      },
      signatureVerified: true,
    ),
    DIDMessage(
      id: 'msg-004',
      senderDid:
          'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      type: 'trustPing',
      timestamp: _now.subtract(const Duration(hours: 6)),
      status: MessageStatus.read,
      payload: {
        'senderName': 'TU Berlin Registry',
        'comment': 'Checking connection health',
      },
      signatureVerified: true,
    ),
    DIDMessage(
      id: 'msg-005',
      senderDid:
          'did:peer:2.Ez6LSn3eKXqMCzfVPhRfp7aDG5tZNwKnmBkLhFYPqxcVetR',
      type: 'problemReport',
      timestamp: _now.subtract(const Duration(days: 1)),
      status: MessageStatus.read,
      payload: {
        'senderName': 'AOK Berlin',
        'code': 'e.p.req.bad-argument',
        'comment': 'The proof presentation was invalid.',
      },
      signatureVerified: false,
    ),
    DIDMessage(
      id: 'msg-006',
      senderDid:
          'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: 'credentialOffer',
      timestamp: _now.subtract(const Duration(days: 2)),
      status: MessageStatus.accepted,
      payload: {
        'senderName': 'Bundesagentur für Arbeit',
        'credentialType': 'EmploymentCredential',
        'issuer': 'Bundesagentur für Arbeit',
        'purpose': 'Issuing your employment verification credential',
        'claims': {'position': 'Software Engineer', 'department': 'IT & Digital'},
      },
      signatureVerified: true,
    ),
    DIDMessage(
      id: 'msg-007',
      senderDid:
          'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: 'connectionInvite',
      timestamp: _now.subtract(const Duration(days: 3)),
      status: MessageStatus.rejected,
      payload: {
        'senderName': 'Unknown Entity',
        'label': 'Unknown Entity',
        'goal': 'Data collection',
      },
      signatureVerified: false,
    ),
  ];

  static final credentials = [
    Credential(
      id: 'cred-001',
      issuerDid:
          'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      type: 'UniversityDegree',
      claims: {
        'Degree': 'Master of Science',
        'Field': 'Computer Science',
        'University': 'TU Berlin',
        'Grade': '1.3',
        'Graduation Year': '2024',
      },
      issuedAt: DateTime(2024, 3, 15),
      status: CredentialStatus.valid,
    ),
    Credential(
      id: 'cred-002',
      issuerDid: 'did:web:bundesdruckerei.de',
      type: 'NationalID',
      claims: {
        'First Name': 'Arian',
        'Last Name': 'Kabiri',
        'Date of Birth': '1999-07-14',
        'Nationality': 'German',
        'ID Number': 'DE-2024-789456',
      },
      issuedAt: DateTime(2023, 6, 1),
      expiresAt: DateTime(2033, 6, 1),
      status: CredentialStatus.valid,
    ),
    Credential(
      id: 'cred-003',
      issuerDid:
          'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: 'EmploymentCredential',
      claims: {
        'Employer': 'Bundesagentur für Arbeit',
        'Position': 'Software Engineer',
        'Department': 'IT & Digital Services',
        'Start Date': '2024-04-01',
        'Employee ID': 'BA-2024-4521',
      },
      issuedAt: DateTime(2024, 4, 1),
      expiresAt: DateTime(2025, 4, 1),
      status: CredentialStatus.valid,
    ),
    Credential(
      id: 'cred-004',
      issuerDid:
          'did:peer:2.Ez6LSn3eKXqMCzfVPhRfp7aDG5tZNwKnmBkLhFYPqxcVetR',
      type: 'HealthInsurance',
      claims: {
        'Insurer': 'AOK Berlin',
        'Member Number': 'AOK-2020-123456',
        'Insurance Type': 'GKV',
        'Valid From': '2020-01-01',
      },
      issuedAt: DateTime(2020, 1, 1),
      expiresAt: DateTime(2025, 1, 1),
      status: CredentialStatus.expired,
    ),
    Credential(
      id: 'cred-005',
      issuerDid: 'did:web:kba.de',
      type: 'DriversLicense',
      claims: {
        'Category': 'B, BE',
        'Issuing Authority': 'Kraftfahrtbundesamt',
        'License Number': 'D08-2019-775412',
      },
      issuedAt: DateTime(2019, 8, 22),
      expiresAt: DateTime(2029, 8, 22),
      status: CredentialStatus.valid,
    ),
    Credential(
      id: 'cred-006',
      issuerDid:
          'did:peer:2.Ez6LSrPXnDFqSbBJzMzv8fJLqVFLUU4jqSwsb7xNJMhPbTmK',
      type: 'AirportAccessPass',
      claims: {
        'Authority': 'Berlin Airport Authority',
        'Access Zone': 'Terminal B — Airside',
        'Pass Number': 'BER-2023-4471',
        'Valid From': '2023-01-01',
      },
      issuedAt: DateTime(2023, 1, 1),
      expiresAt: DateTime(2024, 1, 1),
      status: CredentialStatus.expired,
    ),
  ];

  static final connections = [
    DIDConnection(
      id: 'conn-001',
      theirDid:
          'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      label: 'TU Berlin Registry',
      connectedAt: DateTime(2024, 3, 10),
      isActive: true,
    ),
    DIDConnection(
      id: 'conn-002',
      theirDid:
          'did:peer:2.Ez6LSbYX5pY7VvBaK9dMCW4vRx2eCxqz9a5mFWeBdEpAqNJ7',
      label: 'Berlin Airport Authority',
      connectedAt: DateTime(2023, 9, 20),
      isActive: true,
    ),
    DIDConnection(
      id: 'conn-003',
      theirDid:
          'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      label: 'Bundesagentur für Arbeit',
      connectedAt: DateTime(2024, 1, 15),
      isActive: true,
    ),
    DIDConnection(
      id: 'conn-004',
      theirDid:
          'did:peer:2.Ez6LSn3eKXqMCzfVPhRfp7aDG5tZNwKnmBkLhFYPqxcVetR',
      label: 'AOK Berlin',
      connectedAt: DateTime(2023, 11, 5),
      isActive: false,
    ),
    DIDConnection(
      id: 'conn-005',
      theirDid:
          'did:peer:2.Ez6LSrPXnDFqSbBJzMzv8fJLqVFLUU4jqSwsb7xNJMhPbTmK',
      label: 'Kraftfahrtbundesamt',
      connectedAt: DateTime(2019, 8, 22),
      isActive: true,
    ),
    DIDConnection(
      id: 'conn-006',
      theirDid: 'did:web:bundesdruckerei.de',
      label: 'Bundesdruckerei',
      connectedAt: DateTime(2023, 6, 1),
      isActive: true,
    ),
    DIDConnection(
      id: 'conn-007',
      theirDid: 'did:peer:2.Ez6LSdXoU1ZbnK3pBxGkMVnWvkQmYCFqzNsThrjMpxeTqDU',
      label: 'Deutsche Telekom AG',
      connectedAt: DateTime(2024, 4, 1),
      isActive: false,
    ),
  ];

  static final auditEvents = [
    AuditEvent(
      id: 'evt-001',
      description: 'Credential offer accepted from TU Berlin',
      timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
      did: 'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      type: AuditEventType.credentialIssued,
      verified: true,
      hash: '0x7a3fd4...b9c2e1',
    ),
    AuditEvent(
      id: 'evt-002',
      description: 'Proof presented to Berlin Airport Authority',
      timestamp: DateTime.now().subtract(const Duration(hours: 2)),
      did: 'did:peer:2.Ez6LSn3eKXqMCzfVPhRfp7aDG5tZNwKnmBkLhFYPqxcVetR',
      type: AuditEventType.proofVerified,
      verified: true,
      hash: '0x2c918e...15f7a3',
    ),
    AuditEvent(
      id: 'evt-003',
      description: 'New connection established with Bundesagentur für Arbeit',
      timestamp: DateTime.now().subtract(const Duration(hours: 5)),
      did: 'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: AuditEventType.connectionEstablished,
      verified: true,
      hash: '0xf41ac7...d2e891',
    ),
    AuditEvent(
      id: 'evt-004',
      description: 'Trust Ping sent to TU Berlin Registry',
      timestamp: DateTime.now().subtract(const Duration(days: 1)),
      did: 'did:peer:2.Ez6LSqCqLMVSdBmr4vExNEKcfanXyX9Vxp3QrFtmQ2B7NCzS',
      type: AuditEventType.messageSent,
      verified: true,
      hash: '0x89be3f...5612cd',
    ),
    AuditEvent(
      id: 'evt-005',
      description: 'Employment credential issued by Bundesagentur für Arbeit',
      timestamp: DateTime.now().subtract(const Duration(days: 2)),
      did: 'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: AuditEventType.credentialIssued,
      verified: true,
      hash: '0x3d72a1...9c4b78',
    ),
    AuditEvent(
      id: 'evt-006',
      description: 'National ID credential verified by Bundesagentur',
      timestamp: DateTime.now().subtract(const Duration(days: 5)),
      did: 'did:peer:2.Ez6LSpWz7hRc1cQ4uGnXFjYWv3Dn9tB8eSz5A2mxPqNkCuY',
      type: AuditEventType.credentialVerified,
      verified: true,
      hash: '0x5e4cb8...2197de',
    ),
  ];
}
