import 'dart:async';
import 'dart:convert';

import 'package:flutter_client_sse/flutter_client_sse.dart';
import 'package:flutter_client_sse/constants/sse_request_type_enum.dart';

import '../models/api_models.dart';
import 'api_client.dart';

/// Subscribes to the wallet-agent's SSE `/events` endpoint and exposes a
/// broadcast stream of typed [WalletEvent]s.
///
/// On disconnect, the underlying client auto-attempts to reconnect with a
/// fixed backoff (matching the 3s pattern from the HTML reference UI).
class WalletEventStream {
  final String baseUrl;
  final Duration reconnectDelay;

  StreamController<WalletEvent>? _controller;
  StreamSubscription<SSEModel>? _sub;
  bool _closed = false;

  WalletEventStream({
    String? baseUrl,
    this.reconnectDelay = const Duration(seconds: 3),
  }) : baseUrl = baseUrl ?? ApiClient().baseUrl;

  Stream<WalletEvent> get stream {
    _controller ??= StreamController<WalletEvent>.broadcast(
      onListen: _connect,
      onCancel: _disconnect,
    );
    return _controller!.stream;
  }

  void _connect() {
    if (_closed) return;
    _sub = SSEClient.subscribeToSSE(
      method: SSERequestType.GET,
      url: '$baseUrl/events',
      header: const {'Accept': 'text/event-stream'},
    ).listen(
      _onEvent,
      onError: _onError,
      onDone: _onDone,
      cancelOnError: false,
    );
  }

  void _onEvent(SSEModel msg) {
    final data = msg.data;
    if (data == null || data.isEmpty) return;
    try {
      final json = jsonDecode(data) as Map<String, dynamic>;
      _controller?.add(WalletEvent.fromJson(json));
    } catch (_) {
      // Ignore malformed payloads.
    }
  }

  void _onError(Object _) => _scheduleReconnect();
  void _onDone() => _scheduleReconnect();

  void _scheduleReconnect() {
    _sub?.cancel();
    _sub = null;
    if (_closed) return;
    Future.delayed(reconnectDelay, _connect);
  }

  void _disconnect() {
    _sub?.cancel();
    _sub = null;
    SSEClient.unsubscribeFromSSE();
  }

  Future<void> close() async {
    _closed = true;
    _disconnect();
    await _controller?.close();
    _controller = null;
  }
}
