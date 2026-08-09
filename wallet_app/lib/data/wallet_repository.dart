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
  // Bottom-nav tab indices, mirrored from MainShell's screen order — used to
  // drive the "new activity" dot without MainShell needing to know how each
  // list is diffed.
  static const int tabDashboard = 0;
  static const int tabInbox = 1;
  static const int tabWallet = 2;
  static const int tabConnections = 3;
  static const int tabAudit = 4;

  final ApiClient _api;
  final WalletEventStream _events;
  StreamSubscription<WalletEvent>? _eventSub;
  Timer? _pollTimer;

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

  // ── New-activity tracking ────────────────────────────────────────────────
  //
  // Diff-based rather than tied to SSE payload ids: the backend uses
  // different id schemes for exchange records vs. stored credentials, so
  // comparing "which ids are in the list now that weren't before" is the one
  // approach that works uniformly for every list, whether it changed because
  // of an SSE event or the fallback poll below.

  final Set<String> _knownCredentialIds = {};
  final Set<String> _knownPendingCredentialIds = {};
  final Set<String> _knownPendingProofIds = {};
  final Set<String> _knownConnectionIds = {};
  bool _seeded = false;

  /// Ids that appeared since the owning tab was last viewed — consumed once
  /// by the card widget that renders them, to drive a one-shot fade-out
  /// highlight border.
  final Set<String> _recentlyChangedIds = {};

  /// Tab indices with unseen changes — drives the navbar dot.
  final Set<int> unseenTabs = {};

  /// The tab currently on screen; changes there are highlighted but don't
  /// set the dot, since the user is already looking at them.
  int visibleTabIndex = tabDashboard;

  WalletRepository({ApiClient? api, WalletEventStream? events})
      : _api = api ?? ApiClient(),
        _events = events ?? WalletEventStream();

  String get baseUrl => _api.baseUrl;

  /// True when this window is bound to the verifier agent (:3004). Used to
  /// relabel the credential view ("Checked Credentials") since the verifier
  /// holds no AnonCreds itself — it lists what it has verified.
  bool get isVerifier => _api.baseUrl.contains(':3004');

  Future<void> start() async {
    _eventSub = _events.stream.listen(_onEvent);
    await refreshAll();
    // Belt-and-suspenders: SSE should keep everything live, but a dropped
    // connection that silently fails to reconnect shouldn't force a manual
    // page reload before new data shows up.
    _pollTimer = Timer.periodic(const Duration(seconds: 15), (_) => refreshAll());
  }

  Future<void> refreshAll() async {
    await Future.wait([
      _safe(() async => credentials = await _api.credentials()),
      _safe(() async => pendingCredentials = await _api.pendingCredentials()),
      _safe(() async => proofExchanges = await _api.proofExchanges()),
      _safe(() async => connections = await _api.connections()),
    ]);
    _diffAndMark();
    notifyListeners();
  }

  void _diffAndMark() {
    _diff(credentials.map((c) => c.credentialId).toSet(), _knownCredentialIds,
        tabWallet);
    _diff(pendingCredentials.map((c) => c.id).toSet(),
        _knownPendingCredentialIds, tabInbox);
    _diff(pendingProofs.map((p) => p.id).toSet(), _knownPendingProofIds,
        tabInbox);
    _diff(connections.map((c) => c.id).toSet(), _knownConnectionIds,
        tabConnections);
    // First pass just seeds the known-id sets — nothing was actually "new".
    _seeded = true;
  }

  void _diff(Set<String> current, Set<String> known, int tabIndex) {
    if (_seeded) {
      final added = current.difference(known);
      if (added.isNotEmpty) {
        _recentlyChangedIds.addAll(added);
        if (tabIndex != visibleTabIndex) unseenTabs.add(tabIndex);
      }
    }
    known
      ..clear()
      ..addAll(current);
  }

  /// Called once by the card widget that renders [id] on its first build —
  /// returns true exactly once per new item, to trigger the fade-out
  /// highlight border without replaying it on subsequent rebuilds.
  bool consumeRecentlyChanged(String id) => _recentlyChangedIds.remove(id);

  /// Marks [tabIndex] as currently on screen: clears its dot and stops new
  /// changes there from setting it again until the user navigates away.
  void setVisibleTab(int tabIndex) {
    visibleTabIndex = tabIndex;
    markTabSeen(tabIndex);
  }

  void markTabSeen(int tabIndex) {
    if (unseenTabs.remove(tabIndex)) notifyListeners();
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
        _safeUnawaited(() async {
          proofExchanges = await _api.proofExchanges();
          // On the verifier, a verified presentation is what adds an entry to
          // /credentials (there's no separate "credential" event for that
          // role) — refetch so the Verified tab picks it up without a
          // manual reload.
          if (ev.isVerified == true) {
            credentials = await _api.credentials();
          }
        });
        break;
      case 'revocation':
        // The backend only broadcasts revocations for credentials this wallet
        // actually holds (holder) or has verified (verifier), so we can mark
        // it revoked without further filtering.
        final appId = ev.credentialId;
        if (appId != null && appId.isNotEmpty) {
          revokedCredentialIds.add(appId);
        }
        _safeUnawaited(() async {
          // Verifier stores the revoked flag on the record itself
          // (`widerrufen_am`), so its card only turns red once /credentials
          // is refetched — do that for both roles rather than special-casing.
          credentials = await _api.credentials();
          if (appId != null) {
            for (final c in credentials) {
              if (c.attributes['credential_id'] == appId) {
                _recentlyChangedIds.add(c.credentialId);
                if (tabWallet != visibleTabIndex) unseenTabs.add(tabWallet);
              }
            }
          }
        });
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
    _safe(action).then((_) {
      _diffAndMark();
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _eventSub?.cancel();
    _events.close();
    _api.close();
    super.dispose();
  }
}
