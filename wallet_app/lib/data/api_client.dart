import 'dart:convert';
import 'package:http/http.dart' as http;

import '../models/api_models.dart';

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => 'ApiException($status): $message';
}

/// Thin REST client for the wallet-agent.
///
/// Base URL is configurable via --dart-define=WALLET_BASE=http://host:port
/// and defaults to http://localhost:3000 (the agent's ADMIN_PORT default).
class ApiClient {
  static const _defaultBase = String.fromEnvironment(
    'WALLET_BASE',
    defaultValue: 'http://localhost:3000',
  );

  final String baseUrl;
  final http.Client _http;

  ApiClient({String? baseUrl, http.Client? httpClient})
      : baseUrl = baseUrl ?? _defaultBase,
        _http = httpClient ?? http.Client();

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  Future<dynamic> _getJson(String path) async {
    final res = await _http.get(_u(path));
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, res.body);
    }
    return jsonDecode(res.body);
  }

  Future<dynamic> _postJson(String path, [Object? body]) async {
    final res = await _http.post(
      _u(path),
      headers: const {'Content-Type': 'application/json'},
      body: body == null ? null : jsonEncode(body),
    );
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, res.body);
    }
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  Future<List<StoredCredential>> credentials() async {
    final raw = await _getJson('/credentials') as List;
    return raw
        .cast<Map<String, dynamic>>()
        .map(StoredCredential.fromJson)
        .toList();
  }

  Future<List<PendingCredentialOffer>> pendingCredentials() async {
    final raw = await _getJson('/pending-credentials') as List;
    return raw
        .cast<Map<String, dynamic>>()
        .map(PendingCredentialOffer.fromJson)
        .toList();
  }

  Future<List<ProofExchange>> proofExchanges() async {
    final raw = await _getJson('/proof-exchanges') as List;
    return raw
        .cast<Map<String, dynamic>>()
        .map(ProofExchange.fromJson)
        .toList();
  }

  Future<List<WalletConnection>> connections() async {
    final raw = await _getJson('/connections') as List;
    return raw
        .cast<Map<String, dynamic>>()
        .map(WalletConnection.fromJson)
        .toList();
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  Future<void> receiveInvitation(String invitationUrl) async {
    await _postJson('/receive-invitation', {'invitationUrl': invitationUrl});
  }

  Future<void> acceptCredential(String id) =>
      _postJson('/accept-credential/$id').then((_) {});

  Future<void> declineCredential(String id) =>
      _postJson('/decline-credential/$id').then((_) {});

  Future<void> acceptProof(String id) =>
      _postJson('/accept-proof/$id').then((_) {});

  Future<void> declineProof(String id) =>
      _postJson('/decline-proof/$id').then((_) {});

  void close() => _http.close();
}
