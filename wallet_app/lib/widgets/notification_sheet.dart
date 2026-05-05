import 'package:flutter/material.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../utils/message_utils.dart';

void showNotificationSheet(BuildContext context, DIDMessage message) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => NotificationSheet(message: message),
  );
}

class NotificationSheet extends StatefulWidget {
  final DIDMessage message;

  const NotificationSheet({super.key, required this.message});

  @override
  State<NotificationSheet> createState() => _NotificationSheetState();
}

class _NotificationSheetState extends State<NotificationSheet> {
  bool _logExpanded = false;
  bool _actionTaken = false;
  bool _wasAccepted = false;
  final _followUpCtrl = TextEditingController();
  bool _followUpSent = false;

  DIDMessage get _msg => widget.message;

  @override
  void dispose() {
    _followUpCtrl.dispose();
    super.dispose();
  }

  void _handleAction(bool accept) {
    setState(() {
      _actionTaken = true;
      _wasAccepted = accept;
    });
  }

  List<_LogEntry> get _activityLog {
    final short = _msg.senderDid.length > 24
        ? '${_msg.senderDid.substring(0, 24)}...'
        : _msg.senderDid;
    final sigOk = _msg.signatureVerified;
    switch (_msg.type) {
      case 'proofRequest':
        final hidden = (_msg.payload['hiddenAttributes'] as List?)
                ?.map((a) => (a as Map)['label'] as String)
                .join(', ') ??
            'none';
        return [
          _LogEntry('DID resolved: $short'),
          _LogEntry('DID Document fetched from did:peer ledger'),
          _LogEntry(
              'Schema loaded: ${_msg.payload['proofType'] ?? 'proof schema'}'),
          _LogEntry(
            sigOk ? 'Signature verified ✓' : 'Signature verification FAILED ✗',
            isError: !sigOk,
          ),
          _LogEntry('Available credentials scanned — NationalID matched'),
          _LogEntry('Selective proof prepared — NOT revealing: $hidden'),
        ];
      case 'credentialOffer':
        return [
          _LogEntry('DID resolved: $short'),
          _LogEntry('Issuer DID Document fetched'),
          _LogEntry('Credential schema loaded from ledger'),
          _LogEntry(
            sigOk ? 'Issuer signature verified ✓' : 'Issuer signature INVALID ✗',
            isError: !sigOk,
          ),
          _LogEntry('W3C Verifiable Credential format confirmed'),
          _LogEntry('Credential ready for storage in wallet'),
        ];
      case 'connectionInvite':
        return [
          _LogEntry('DID Document retrieved'),
          _LogEntry('DID method validated (did:peer)'),
          _LogEntry('Encryption keys extracted (X25519)'),
          _LogEntry(
            sigOk ? 'Invite signature valid ✓' : 'Invite signature INVALID ✗',
            isError: !sigOk,
          ),
          _LogEntry('No prior connection with this DID found'),
        ];
      default:
        return [
          _LogEntry('DID resolved: $short'),
          _LogEntry(
            sigOk ? 'Message authenticated ✓' : 'Authentication FAILED ✗',
            isError: !sigOk,
          ),
          _LogEntry('Message processed'),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = AppColors.messageTypeColor(_msg.type);
    final wc = context.wc;

    return Container(
      constraints:
          BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.92),
      decoration: BoxDecoration(
        color: wc.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(
          top: BorderSide(color: wc.border, width: 0.5),
          left: BorderSide(color: wc.border, width: 0.5),
          right: BorderSide(color: wc.border, width: 0.5),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 6),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: wc.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                  20, 12, 20, MediaQuery.of(context).padding.bottom + 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  _SheetHeader(message: _msg, color: color),
                  const SizedBox(height: 20),

                  // Invalid signature warning banner
                  if (!_msg.signatureVerified) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.error.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: AppColors.error.withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning_rounded,
                              color: AppColors.error, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '⚠ SIGNATURE INVALID — Cannot verify authenticity of this message',
                              style: TextStyle(
                                color: AppColors.error,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Transparency Window 1
                  if (_showTransparency) ...[
                    _TransparencyWindow1(message: _msg),
                    const SizedBox(height: 12),
                  ],

                  // Transparency Window 2 — Collapsible activity log
                  _CollapsibleLog(
                    entries: _activityLog,
                    expanded: _logExpanded,
                    onToggle: () =>
                        setState(() => _logExpanded = !_logExpanded),
                  ),
                  const SizedBox(height: 20),

                  // Action buttons or status
                  if (_actionTaken || _msg.status != MessageStatus.pending)
                    _StatusBanner(
                        accepted: _actionTaken
                            ? _wasAccepted
                            : _msg.status == MessageStatus.accepted)
                  else
                    _ActionRow(onAccept: () => _handleAction(true),
                        onReject: () => _handleAction(false)),

                  // Follow-up message
                  if (_actionTaken || _msg.status != MessageStatus.pending) ...[
                    const SizedBox(height: 20),
                    _FollowUpField(
                      controller: _followUpCtrl,
                      sent: _followUpSent,
                      onSend: () {
                        if (_followUpCtrl.text.trim().isEmpty) return;
                        setState(() => _followUpSent = true);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: const Text('Follow-up message sent'),
                            backgroundColor: context.wc.card,
                            behavior: SnackBarBehavior.floating,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  bool get _showTransparency => ['credentialOffer', 'proofRequest', 'connectionInvite']
      .contains(_msg.type);
}

// ─── Header ──────────────────────────────────────────────────────────────────

class _SheetHeader extends StatelessWidget {
  final DIDMessage message;
  final Color color;

  const _SheetHeader({required this.message, required this.color});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Row(
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            color: color.withOpacity(0.15),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: color.withOpacity(0.3)),
          ),
          child: Icon(messageIcon(message.type), color: color, size: 26),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                messageTitle(message.type),
                style: TextStyle(
                  color: wc.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
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
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ─── Transparency Window 1 ────────────────────────────────────────────────────

class _TransparencyWindow1 extends StatelessWidget {
  final DIDMessage message;

  const _TransparencyWindow1({required this.message});

  String get _senderName =>
      message.payload['senderName'] as String? ??
      message.payload['label'] as String? ??
      'Unknown Sender';

  String get _purpose {
    return message.payload['purpose'] as String? ??
        message.payload['goal'] as String? ??
        message.payload['comment'] as String? ??
        'Not specified';
  }

  String get _retention {
    final days = message.payload['retentionDays'];
    if (days == null) {
      switch (message.type) {
        case 'credentialOffer':
          return 'Stored in your wallet — you control deletion';
        case 'connectionInvite':
          return 'Kept until you disconnect';
        default:
          return 'Not specified';
      }
    }
    return '$days days · then permanently deleted';
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section header
          Container(
            width: double.infinity,
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.08),
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(16)),
              border: Border(
                  bottom: BorderSide(
                      color: AppColors.primary.withOpacity(0.2))),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline_rounded,
                    color: AppColors.primary, size: 14),
                const SizedBox(width: 7),
                Text(
                  'TRANSPARENCY REPORT',
                  style: TextStyle(
                    color: AppColors.primary,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // WHO
                _TSection(
                  icon: Icons.person_pin_outlined,
                  title: 'WHO IS ASKING',
                  child: _WhoCard(
                      senderName: _senderName,
                      senderDid: message.senderDid,
                      trusted: message.signatureVerified),
                ),
                const SizedBox(height: 14),
                // WHAT
                _TSection(
                  icon: Icons.list_alt_rounded,
                  title: message.type == 'credentialOffer'
                      ? 'WHAT YOU WILL RECEIVE'
                      : 'WHAT WILL BE DISCLOSED',
                  child: _WhatCard(message: message),
                ),
                const SizedBox(height: 14),
                // WHY
                _TSection(
                  icon: Icons.help_outline_rounded,
                  title: 'WHY THEY NEED IT',
                  child: _SimpleInfoCard(
                    text: _purpose,
                    icon: Icons.info_outline_rounded,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 14),
                // HOW LONG
                _TSection(
                  icon: Icons.access_time_rounded,
                  title: 'HOW LONG THEY KEEP IT',
                  child: _SimpleInfoCard(
                    text: _retention,
                    icon: Icons.delete_outline_rounded,
                    color: AppColors.warning,
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

class _TSection extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget child;

  const _TSection({
    required this.icon,
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, color: wc.textTertiary, size: 12),
            const SizedBox(width: 5),
            Text(
              title,
              style: TextStyle(
                color: wc.textTertiary,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.1,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

class _WhoCard extends StatelessWidget {
  final String senderName;
  final String senderDid;
  final bool trusted;

  const _WhoCard({
    required this.senderName,
    required this.senderDid,
    required this.trusted,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final trustColor = trusted ? AppColors.success : AppColors.error;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: wc.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: trustColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.account_balance_rounded,
                    color: trustColor, size: 18),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      senderName,
                      style: TextStyle(
                        color: wc.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Row(
                      children: [
                        Icon(
                          trusted
                              ? Icons.verified_rounded
                              : Icons.cancel_rounded,
                          color: trustColor,
                          size: 11,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          trusted ? 'Verified issuer' : 'Unverified — proceed with caution',
                          style: TextStyle(
                            color: trustColor,
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            truncateDid(senderDid),
            style: TextStyle(
              color: wc.textTertiary,
              fontSize: 10,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

class _WhatCard extends StatelessWidget {
  final DIDMessage message;

  const _WhatCard({required this.message});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    if (message.type == 'proofRequest') {
      final shared = (message.payload['sharedAttributes'] as List?) ?? [];
      final hidden = (message.payload['hiddenAttributes'] as List?) ?? [];
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: wc.background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: wc.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ...shared.map((a) => _DisclosureRow(
                  label: (a as Map)['label'] as String,
                  shared: true,
                )),
            if (hidden.isNotEmpty) ...[
              const SizedBox(height: 4),
              Divider(height: 1, color: wc.border),
              const SizedBox(height: 4),
            ],
            ...hidden.map((a) => _DisclosureRow(
                  label: (a as Map)['label'] as String,
                  shared: false,
                )),
          ],
        ),
      );
    } else if (message.type == 'credentialOffer') {
      final claims = message.payload['claims'] as Map? ?? {};
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: wc.background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: wc.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ...claims.entries.map((e) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      const Icon(Icons.add_circle_rounded,
                          color: AppColors.success, size: 14),
                      const SizedBox(width: 8),
                      Text(
                        '${e.key}',
                        style: TextStyle(
                          color: wc.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${e.value}',
                        style: TextStyle(
                          color: wc.textPrimary,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      );
    } else {
      return _SimpleInfoCard(
        text: message.payload['goal'] as String? ??
            message.payload['label'] as String? ??
            'Establish a DIDComm connection',
        icon: Icons.link_rounded,
        color: AppColors.primary,
      );
    }
  }
}

class _DisclosureRow extends StatelessWidget {
  final String label;
  final bool shared;

  const _DisclosureRow({required this.label, required this.shared});

  @override
  Widget build(BuildContext context) {
    final color = shared ? AppColors.success : AppColors.error;
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        children: [
          Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(
              color: color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(
              shared ? Icons.check_rounded : Icons.close_rounded,
              color: color,
              size: 13,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: context.wc.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Text(
            shared ? 'will be shared' : 'will NOT be shared',
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _SimpleInfoCard extends StatelessWidget {
  final String text;
  final IconData icon;
  final Color color;

  const _SimpleInfoCard({
    required this.text,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: wc.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: wc.border),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 14),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: wc.textPrimary,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Transparency Window 2 — Activity Log ────────────────────────────────────

class _CollapsibleLog extends StatelessWidget {
  final List<_LogEntry> entries;
  final bool expanded;
  final VoidCallback onToggle;

  const _CollapsibleLog({
    required this.entries,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: onToggle,
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              color: Colors.transparent,
              child: Row(
                children: [
                  Icon(Icons.terminal_rounded,
                      color: wc.textTertiary, size: 14),
                  const SizedBox(width: 8),
                  Text(
                    'BEHIND THE SCENES',
                    style: TextStyle(
                      color: wc.textTertiary,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    expanded ? 'Hide' : 'Show',
                    style: TextStyle(
                      color: AppColors.primary,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    expanded
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.primary,
                    size: 16,
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeInOut,
            child: expanded
                ? Column(
                    children: [
                      Divider(height: 1, color: wc.border),
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          children: entries
                              .map((e) => _LogRow(entry: e))
                              .toList(),
                        ),
                      ),
                    ],
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _LogEntry {
  final String text;
  final bool isError;

  const _LogEntry(this.text, {this.isError = false});
}

class _LogRow extends StatelessWidget {
  final _LogEntry entry;

  const _LogRow({required this.entry});

  @override
  Widget build(BuildContext context) {
    final color = entry.isError ? AppColors.error : AppColors.success;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                color: color.withOpacity(0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                entry.isError ? Icons.close_rounded : Icons.check_rounded,
                color: color,
                size: 9,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              entry.text,
              style: TextStyle(
                color: entry.isError
                    ? AppColors.error
                    : context.wc.textSecondary,
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight:
                    entry.isError ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Action Row ───────────────────────────────────────────────────────────────

class _ActionRow extends StatelessWidget {
  final VoidCallback onAccept;
  final VoidCallback onReject;

  const _ActionRow({required this.onAccept, required this.onReject});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _ActionButton(
            label: 'Reject',
            color: AppColors.error,
            onTap: onReject,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _ActionButton(
            label: 'Accept',
            color: AppColors.success,
            filled: true,
            onTap: onAccept,
          ),
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final Color color;
  final bool filled;
  final VoidCallback onTap;

  const _ActionButton({
    required this.label,
    required this.color,
    this.filled = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 52,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: filled ? color : color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(14),
          border: filled ? null : Border.all(color: color.withOpacity(0.4)),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: filled ? Colors.white : color,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

// ─── Status Banner ────────────────────────────────────────────────────────────

class _StatusBanner extends StatelessWidget {
  final bool accepted;

  const _StatusBanner({required this.accepted});

  @override
  Widget build(BuildContext context) {
    final color = accepted ? AppColors.success : AppColors.error;
    final label = accepted ? 'Accepted' : 'Rejected';
    final icon =
        accepted ? Icons.check_circle_outline : Icons.cancel_outlined;

    return Container(
      height: 52,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Follow-up Message ────────────────────────────────────────────────────────

class _FollowUpField extends StatelessWidget {
  final TextEditingController controller;
  final bool sent;
  final VoidCallback onSend;

  const _FollowUpField({
    required this.controller,
    required this.sent,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.send_rounded, color: wc.textTertiary, size: 12),
            const SizedBox(width: 6),
            Text(
              'SEND FOLLOW-UP',
              style: TextStyle(
                color: wc.textTertiary,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.1,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (sent)
          Container(
            width: double.infinity,
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.success.withOpacity(0.08),
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: AppColors.success.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                const Icon(Icons.check_circle_rounded,
                    color: AppColors.success, size: 16),
                const SizedBox(width: 8),
                Text(
                  'Follow-up message sent',
                  style: TextStyle(
                    color: AppColors.success,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          )
        else
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  style: TextStyle(color: wc.textPrimary, fontSize: 14),
                  decoration: const InputDecoration(
                    hintText: 'Send a follow-up DIDComm message…',
                  ),
                  maxLines: 1,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => onSend(),
                ),
              ),
              const SizedBox(width: 10),
              GestureDetector(
                onTap: onSend,
                child: Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.send_rounded,
                      color: Colors.white, size: 20),
                ),
              ),
            ],
          ),
      ],
    );
  }
}
