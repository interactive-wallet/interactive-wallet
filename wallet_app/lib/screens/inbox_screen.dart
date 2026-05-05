import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';
import '../utils/message_utils.dart';
import '../widgets/notification_sheet.dart';

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  String _filter = 'All';

  static const _filters = [
    'All',
    'credentialOffer',
    'proofRequest',
    'connectionInvite',
    'trustPing',
    'problemReport',
  ];

  static const _filterLabels = {
    'All': 'All',
    'credentialOffer': 'Credentials',
    'proofRequest': 'Proofs',
    'connectionInvite': 'Invites',
    'trustPing': 'Pings',
    'problemReport': 'Problems',
  };

  List<DIDMessage> get _filtered {
    if (_filter == 'All') return MockData.messages;
    return MockData.messages.where((m) => m.type == _filter).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final pendingCount =
        MockData.messages.where((m) => m.status == MessageStatus.pending).length;
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Inbox'),
            const SizedBox(width: 10),
            if (pendingCount > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.warning.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$pendingCount',
                  style: const TextStyle(
                    color: AppColors.warning,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune_rounded),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _FilterBar(
            filters: _filters,
            labels: _filterLabels,
            selected: _filter,
            onSelect: (f) => setState(() => _filter = f),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Text(
                      'No messages',
                      style: TextStyle(
                          color: wc.textTertiary, fontSize: 15),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                    itemCount: filtered.length,
                    itemBuilder: (_, i) =>
                        _MessageCard(message: filtered[i]),
                  ),
          ),
        ],
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  final List<String> filters;
  final Map<String, String> labels;
  final String selected;
  final ValueChanged<String> onSelect;

  const _FilterBar({
    required this.filters,
    required this.labels,
    required this.selected,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return SizedBox(
      height: 52,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        itemCount: filters.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final f = filters[i];
          final isSelected = f == selected;
          final color =
              f == 'All' ? AppColors.primary : AppColors.messageTypeColor(f);

          return GestureDetector(
            onTap: () => onSelect(f),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color:
                    isSelected ? color.withOpacity(0.18) : wc.card,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isSelected
                      ? color.withOpacity(0.5)
                      : wc.border,
                ),
              ),
              child: Text(
                labels[f] ?? f,
                style: TextStyle(
                  color: isSelected ? color : wc.textSecondary,
                  fontSize: 13,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  final DIDMessage message;

  const _MessageCard({required this.message});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.messageTypeColor(message.type);
    final isPending = message.status == MessageStatus.pending;
    final wc = context.wc;

    return GestureDetector(
      onTap: () => showNotificationSheet(context, message),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: wc.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isPending ? color.withOpacity(0.3) : wc.border,
          ),
        ),
        child: Column(
          children: [
            // Invalid signature warning banner
            if (!message.signatureVerified)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.08),
                  borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(16)),
                  border: Border(
                    bottom: BorderSide(
                        color: AppColors.error.withOpacity(0.2)),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_rounded,
                        color: AppColors.error, size: 13),
                    const SizedBox(width: 6),
                    Text(
                      '⚠ SIGNATURE INVALID — Cannot verify authenticity',
                      style: TextStyle(
                        color: AppColors.error,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            IntrinsicHeight(
              child: Row(
                children: [
                  Container(
                    width: 4,
                    decoration: BoxDecoration(
                      color: color,
                      borderRadius: message.signatureVerified
                          ? const BorderRadius.horizontal(
                              left: Radius.circular(16))
                          : const BorderRadius.only(
                              bottomLeft: Radius.circular(16)),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(messageIcon(message.type),
                                        color: color, size: 12),
                                    const SizedBox(width: 4),
                                    Text(
                                      messageTitle(message.type),
                                      style: TextStyle(
                                        color: color,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Spacer(),
                              Text(
                                timeago.format(message.timestamp),
                                style: TextStyle(
                                  color: wc.textTertiary,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Icon(Icons.person_outline,
                                  color: wc.textTertiary, size: 14),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  truncateDid(message.senderDid),
                                  style: TextStyle(
                                    color: wc.textSecondary,
                                    fontSize: 11.5,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              _PayloadPreview(payload: message.payload),
                              const Spacer(),
                              _StatusPill(status: message.status),
                            ],
                          ),
                          const SizedBox(height: 8),
                          // Explicit signature row
                          Row(
                            children: [
                              Icon(
                                message.signatureVerified
                                    ? Icons.verified_rounded
                                    : Icons.cancel_rounded,
                                color: message.signatureVerified
                                    ? AppColors.success
                                    : AppColors.error,
                                size: 13,
                              ),
                              const SizedBox(width: 5),
                              Text(
                                message.signatureVerified
                                    ? 'Signature verified'
                                    : 'Signature INVALID',
                                style: TextStyle(
                                  color: message.signatureVerified
                                      ? AppColors.success
                                      : AppColors.error,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PayloadPreview extends StatelessWidget {
  final Map<String, dynamic> payload;

  const _PayloadPreview({required this.payload});

  String get _preview {
    final entry =
        payload.entries.where((e) => e.value is String && e.key != 'senderName').firstOrNull;
    if (entry == null) return '';
    return '${entry.key}: ${entry.value}';
  }

  @override
  Widget build(BuildContext context) {
    return Text(
      _preview,
      style: TextStyle(color: context.wc.textSecondary, fontSize: 12),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final MessageStatus status;

  const _StatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    Color color;
    String label;

    switch (status) {
      case MessageStatus.pending:
        color = AppColors.warning;
        label = 'Pending';
      case MessageStatus.accepted:
        color = AppColors.success;
        label = 'Accepted';
      case MessageStatus.rejected:
        color = AppColors.error;
        label = 'Rejected';
      case MessageStatus.read:
        color = context.wc.textTertiary;
        label = 'Read';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
            color: color, fontSize: 11, fontWeight: FontWeight.w500),
      ),
    );
  }
}
