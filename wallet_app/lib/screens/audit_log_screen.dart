import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';

class AuditLogScreen extends StatelessWidget {
  const AuditLogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Audit Log'),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list_rounded),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _AuditHeader(),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              itemCount: MockData.auditEvents.length,
              itemBuilder: (_, i) => _AuditEventTile(
                event: MockData.auditEvents[i],
                isLast: i == MockData.auditEvents.length - 1,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AuditHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
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
          const Icon(Icons.lock_outline_rounded,
              color: AppColors.primary, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Hash-Chained Audit Trail',
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  'All events are cryptographically verified',
                  style: TextStyle(color: wc.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.success.withOpacity(0.12),
              borderRadius: BorderRadius.circular(8),
              border:
                  Border.all(color: AppColors.success.withOpacity(0.25)),
            ),
            child: Row(
              children: [
                const Icon(Icons.verified_rounded,
                    color: AppColors.success, size: 13),
                const SizedBox(width: 4),
                Text(
                  '${MockData.auditEvents.length} events',
                  style: const TextStyle(
                    color: AppColors.success,
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

class _AuditEventTile extends StatelessWidget {
  final AuditEvent event;
  final bool isLast;

  const _AuditEventTile({required this.event, required this.isLast});

  Color get _typeColor {
    switch (event.type) {
      case AuditEventType.credentialIssued:
        return AppColors.success;
      case AuditEventType.credentialVerified:
        return AppColors.primary;
      case AuditEventType.connectionEstablished:
        return AppColors.purple;
      case AuditEventType.proofVerified:
        return AppColors.warning;
      case AuditEventType.messageSent:
      case AuditEventType.messageReceived:
        return const Color(0xFF9CA3AF);
    }
  }

  IconData get _typeIcon {
    switch (event.type) {
      case AuditEventType.credentialIssued:
        return Icons.card_membership_rounded;
      case AuditEventType.credentialVerified:
        return Icons.verified_user_rounded;
      case AuditEventType.connectionEstablished:
        return Icons.link_rounded;
      case AuditEventType.proofVerified:
        return Icons.policy_rounded;
      case AuditEventType.messageSent:
        return Icons.send_rounded;
      case AuditEventType.messageReceived:
        return Icons.move_to_inbox_rounded;
    }
  }

  String get _typeLabel {
    switch (event.type) {
      case AuditEventType.credentialIssued:
        return 'Credential Issued';
      case AuditEventType.credentialVerified:
        return 'Credential Verified';
      case AuditEventType.connectionEstablished:
        return 'Connection';
      case AuditEventType.proofVerified:
        return 'Proof Verified';
      case AuditEventType.messageSent:
        return 'Message Sent';
      case AuditEventType.messageReceived:
        return 'Message Received';
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _typeColor;
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
                    color: color.withOpacity(0.13),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: color.withOpacity(0.3)),
                  ),
                  child: Icon(_typeIcon, color: color, size: 16),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            color.withOpacity(0.4),
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
                            color: color.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            _typeLabel,
                            style: TextStyle(
                              color: color,
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
                      event.description,
                      style: TextStyle(
                        color: wc.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Icon(Icons.fingerprint,
                            color: wc.textTertiary, size: 12),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            _shortDid(event.did),
                            style: TextStyle(
                              color: wc.textSecondary,
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 3),
                          decoration: BoxDecoration(
                            color: wc.background,
                            borderRadius: BorderRadius.circular(5),
                            border: Border.all(color: wc.border),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.tag_rounded,
                                  color: wc.textTertiary, size: 10),
                              const SizedBox(width: 3),
                              Text(
                                event.hash,
                                style: TextStyle(
                                  color: wc.textTertiary,
                                  fontSize: 10,
                                  fontFamily: 'monospace',
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Spacer(),
                        if (event.verified)
                          Row(
                            children: [
                              const Icon(Icons.check_circle_rounded,
                                  color: AppColors.success, size: 13),
                              const SizedBox(width: 4),
                              const Text(
                                'Verified',
                                style: TextStyle(
                                  color: AppColors.success,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _shortDid(String did) {
    if (did.length <= 30) return did;
    return '${did.substring(0, 16)}...${did.substring(did.length - 8)}';
  }
}
