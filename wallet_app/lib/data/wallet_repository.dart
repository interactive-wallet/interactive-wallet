import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/api_models.dart';
import 'api_client.dart';
import 'event_stream.dart';

/// Single source of truth for everything the screens display.
///
/// Loads initial state via REST and stays in sync via SSE — mirrors the
/// connectSSE() logic in wallet-agent/public/index.html.
class WalletRepository extends ChangeNotifier {
  final ApiClient _api;
  final WalletEventStream _events;
  StreamSubscription<WalletEvent>? _eventSub;

  List<StoredCredential> credentials = const [];
  List<PendingCredentialOffer> pendingCredentials = const [];
  List<ProofExchange> proofExchanges = const [];
  List<WalletConnection> connections = const [];

  /// Log of WalletEvents in chronological order (most recent first when shown).
  final List<WalletEvent> log = [];

  /// App-level credential_id values that the backend reported as revoked via SSE.
  /// The wallet still physically holds these credentials; this only tracks the
  /// revocation status the UI should surface.
  final Set<String> revokedCredentialIds = {};

  /// True once the live stream has confirmed connectivity.
  bool isLive = false;

  /// Most recent error from a backend call, displayed transiently by the UI.
  String? lastError;

  WalletRepository({ApiClient? api, WalletEventStream? events})
      : _api = api ?? ApiClient(),
        _events = events ?? WalletEventStream();

  String get baseUrl => _api.baseUrl;

  Future<void> start() async {
    _eventSub = _events.stream.listen(_onEvent);
    await refreshAll();
  }

  Future<void> refreshAll() async {
    await Future.wait([
      _safe(() async => credentials = await _api.credentials()),
      _safe(() async => pendingCredentials = await _api.pendingCredentials()),
      _safe(() async => proofExchanges = await _api.proofExchanges()),
      _safe(() async => connections = await _api.connections()),
    ]);
    notifyListeners();
  }

  // ── Reactions to live events ─────────────────────────────────────────────

  void _onEvent(WalletEvent ev) {
    log.insert(0, ev);
    if (log.length > 500) log.removeRange(500, log.length);

    switch (ev.type) {
      case 'connected':
      case 'system':
        isLive = true;
        break;
      case 'disconnected':
        isLive = false;
        break;
      case 'connection':
        _safeUnawaited(() async => connections = await _api.connections());
        break;
      case 'credential':
        if (ev.state == 'done') {
          _safeUnawaited(() async {
            credentials = await _api.credentials();
            pendingCredentials = await _api.pendingCredentials();
          });
        } else {
          // offer-received, request-sent, credential-received, declined — refresh pending list
          _safeUnawaited(
              () async => pendingCredentials = await _api.pendingCredentials());
        }
        break;
      case 'proof':
        _safeUnawaited(
            () async => proofExchanges = await _api.proofExchanges());
        break;
      case 'revocation':
        // The backend only broadcasts revocations for credentials this wallet
        // actually holds, so we can mark it revoked without further filtering.
        if (ev.credentialId != null && ev.credentialId!.isNotEmpty) {
          revokedCredentialIds.add(ev.credentialId!);
        }
        break;
    }
    notifyListeners();
  }

  /// Whether the given stored credential has been revoked (matched via the
  /// issuer-stamped `credential_id` attribute against SSE revocation events).
  bool isCredentialRevoked(StoredCredential c) {
    // Verifier view: revocation is persisted on the record itself, so it
    // survives a refresh/restart even without a live SSE event.
    if (c.attributes.containsKey('widerrufen_am')) return true;
    final appId = c.attributes['credential_id'];
    return appId != null && revokedCredentialIds.contains(appId);
  }

  void clearLog() {
    if (log.isEmpty) return;
    log.clear();
    notifyListeners();
  }

  // ── Pending lists (derived views) ────────────────────────────────────────

  List<ProofExchange> get pendingProofs =>
      proofExchanges.where((p) => p.isPending).toList();

  List<ProofExchange> get completedProofs =>
      proofExchanges.where((p) => !p.isPending).toList();

  // ── Commands ─────────────────────────────────────────────────────────────

  Future<void> receiveInvitation(String url) =>
      _runCommand(() => _api.receiveInvitation(url));

  Future<void> acceptCredential(String id) => _runCommand(() async {
        // Optimistically remove from the pending list so the card disappears
        // immediately. SSE will reconcile shortly after.
        pendingCredentials = pendingCredentials.where((c) => c.id != id).toList();
        notifyListeners();
        await _api.acceptCredential(id);
        pendingCredentials = await _api.pendingCredentials();
      });

  Future<void> declineCredential(String id) => _runCommand(() async {
        pendingCredentials = pendingCredentials.where((c) => c.id != id).toList();
        notifyListeners();
        await _api.declineCredential(id);
        pendingCredentials = await _api.pendingCredentials();
      });

  Future<void> acceptProof(String id) => _runCommand(() async {
        proofExchanges = proofExchanges.where((p) => p.id != id).toList();
        notifyListeners();
        await _api.acceptProof(id);
        proofExchanges = await _api.proofExchanges();
      });

  Future<void> declineProof(String id) => _runCommand(() async {
        proofExchanges = proofExchanges.where((p) => p.id != id).toList();
        notifyListeners();
        await _api.declineProof(id);
        proofExchanges = await _api.proofExchanges();
      });

  Future<void> _runCommand(Future<void> Function() action) async {
    try {
      lastError = null;
      await action();
    } catch (e) {
      lastError = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> _safe(Future<void> Function() action) async {
    try {
      await action();
    } catch (e) {
      lastError = e.toString();
    }
  }

  void _safeUnawaited(Future<void> Function() action) {
    _safe(action).then((_) => notifyListeners());
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _events.close();
    _api.close();
    super.dispose();
  }
}
