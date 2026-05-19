import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../data/wallet_repository.dart';
import '../models/api_models.dart';
import '../theme/app_theme.dart';

class _EventStyle {
  final Color color;
  final IconData icon;
  final String label;
  const _EventStyle(this.color, this.icon, this.label);
}

_EventStyle _styleFor(WalletEvent e) {
  switch (e.type) {
    case 'credential':
      return _EventStyle(
        AppColors.success,
        Icons.card_membership_rounded,
        'Credential',
      );
    case 'proof':
      return _EventStyle(
        AppColors.warning,
        Icons.policy_rounded,
        'Proof',
      );
    case 'connection':
      return _EventStyle(
        AppColors.primary,
        Icons.link_rounded,
        'Connection',
      );
    case 'system':
    case 'connected':
    case 'disconnected':
      return _EventStyle(
        AppColors.purple,
        Icons.settings_outlined,
        'System',
      );
    default:
      return _EventStyle(
        const Color(0xFF9CA3AF),
        Icons.info_outline_rounded,
        e.type,
      );
  }
}

String _describe(WalletEvent e) {
  final state = e.state;
  switch (e.type) {
    case 'system':
    case 'connected':
      return 'Live connection to wallet-agent established';
    case 'disconnected':
      return 'Live connection lost — retrying…';
    case 'connection':
      final who = e.theirLabel ?? 'unknown peer';
      switch (state) {
        case 'invitation-received':
          return 'Invitation received from $who';
        case 'request-sent':
          return 'Connection request sent to $who';
        case 'response-received':
          return 'Connection response received from $who';
        case 'completed':
          return 'DIDComm connection established with $who';
        default:
          return 'Connection with $who: $state';
      }
    case 'credential':
      switch (state) {
        case 'offer-received':
          return 'Credential offer received — awaiting approval';
        case 'request-sent':
          return 'Credential request sent';
        case 'credential-received':
          return 'Credential received — storing';
        case 'done':
          return 'Credential stored successfully';
        case 'declined':
          return 'Credential offer declined';
        default:
          return 'Credential state: $state';
      }
    case 'proof':
      switch (state) {
        case 'request-received':
          return 'Proof request received — awaiting approval';
        case 'presentation-sent':
          return 'Cryptographic proof generated and sent';
        case 'done':
          if (e.isVerified == true) return 'Verification complete — isVerified: true';
          if (e.isVerified == false) return 'Verification failed — isVerified: false';
          return 'Proof exchange complete';
        case 'abandoned':
          return 'Proof exchange abandoned';
        case 'declined':
          return 'Proof request declined';
        default:
          return 'Proof state: $state';
      }
    default:
      return 'Event: ${e.type}${state == null ? '' : ' / $state'}';
  }
}

class AuditLogScreen extends StatelessWidget {
  const AuditLogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<WalletRepository>();
    final events = repo.log;
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Audit Log'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: repo.refreshAll,
          ),
          IconButton(
            icon: const Icon(Icons.delete_sweep_rounded),
            tooltip: 'Clear log',
            onPressed: events.isEmpty ? null : repo.clearLog,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _AuditHeader(eventCount: events.length, isLive: repo.isLive),
          Expanded(
            child: events.isEmpty
                ? _EmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                    itemCount: events.length,
                    itemBuilder: (_, i) => _EventTile(
                      event: events[i],
                      isLast: i == events.length - 1,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _AuditHeader extends StatelessWidget {
  final int eventCount;
  final bool isLive;

  const _AuditHeader({required this.eventCount, required this.isLive});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final liveColor = isLive ? AppColors.success : AppColors.warning;
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: wc.border),
      ),
      child: Row(
        children: [
          Icon(
            isLive ? Icons.bolt_rounded : Icons.cloud_off_rounded,
            color: liveColor,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Live Event Stream',
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  isLive
                      ? 'Streaming events from wallet-agent via SSE'
                      : 'Reconnecting to wallet-agent…',
                  style: TextStyle(color: wc.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(
              color: liveColor.withOpacity(0.12),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: liveColor.withOpacity(0.25)),
            ),
            child: Row(
              children: [
                Icon(Icons.timeline_rounded, color: liveColor, size: 13),
                const SizedBox(width: 4),
                Text(
                  '$eventCount events',
                  style: TextStyle(
                    color: liveColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.timeline_outlined, color: wc.textTertiary, size: 56),
            const SizedBox(height: 14),
            Text(
              'Waiting for activity…',
              style: TextStyle(
                color: wc.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'DIDComm events from the wallet-agent will appear here in real time.',
              textAlign: TextAlign.center,
              style: TextStyle(color: wc.textSecondary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _EventTile extends StatelessWidget {
  final WalletEvent event;
  final bool isLast;

  const _EventTile({required this.event, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final style = _styleFor(event);
    final wc = context.wc;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 40,
            child: Column(
              children: [
                const SizedBox(height: 4),
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: style.color.withOpacity(0.13),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: style.color.withOpacity(0.3)),
                  ),
                  child: Icon(style.icon, color: style.color, size: 16),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            style.color.withOpacity(0.4),
                            wc.border,
                          ],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ),
                        borderRadius: BorderRadius.circular(1),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: wc.card,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: wc.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: style.color.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            event.state == null
                                ? style.label
                                : '${style.label} · ${event.state}',
                            style: TextStyle(
                              color: style.color,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(
                          timeago.format(event.timestamp),
                          style: TextStyle(
                              color: wc.textTertiary, fontSize: 11),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _describe(event),
                      style: TextStyle(
                        color: wc.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        height: 1.4,
                      ),
                    ),
                    if (event.isVerified != null) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Icon(
                            event.isVerified == true
                                ? Icons.check_circle_rounded
                                : Icons.cancel_rounded,
                            color: event.isVerified == true
                                ? AppColors.success
                                : AppColors.error,
                            size: 13,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            event.isVerified == true
                                ? 'Signature verified'
                                : 'Verification failed',
                            style: TextStyle(
                              color: event.isVerified == true
                                  ? AppColors.success
                                  : AppColors.error,
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
