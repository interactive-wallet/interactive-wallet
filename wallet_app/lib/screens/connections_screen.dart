import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/wallet_repository.dart';
import '../models/api_models.dart';
import '../theme/app_theme.dart';
import '../widgets/new_item_highlight.dart';

bool _isActive(WalletConnection c) => c.state == 'completed';

bool _isLedgerDid(String? did) =>
    did != null && (did.startsWith('did:indy:') || did.startsWith('did:sov:'));

class _DecodedInvitation {
  final String? label;
  final String? from;
  const _DecodedInvitation({this.label, this.from});

  bool get hasLedgerIdentity => _isLedgerDid(from);
}

_DecodedInvitation _decodeInvitation(String url) {
  try {
    final match = RegExp(r'[?&]oob=([^&]+)').firstMatch(url);
    if (match == null) return const _DecodedInvitation();
    var b64 = match.group(1)!.replaceAll('-', '+').replaceAll('_', '/');
    while (b64.length % 4 != 0) {
      b64 += '=';
    }
    final json =
        jsonDecode(utf8.decode(base64Decode(b64))) as Map<String, dynamic>;
    return _DecodedInvitation(
      label: json['label'] as String?,
      from: json['from'] as String?,
    );
  } catch (_) {
    return const _DecodedInvitation();
  }
}

String _stateLabel(String state) {
  switch (state) {
    case 'completed':
      return 'Connected';
    case 'request-sent':
    case 'request-received':
      return 'Handshake';
    case 'invitation-sent':
    case 'invitation-received':
      return 'Invited';
    case 'response-sent':
    case 'response-received':
      return 'Responding';
    case 'abandoned':
      return 'Abandoned';
    default:
      return state;
  }
}

class ConnectionsScreen extends StatelessWidget {
  const ConnectionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<WalletRepository>();
    Widget wrap(WalletConnection c) => NewItemHighlight(
          key: ValueKey('conn-${c.id}'),
          isNew: repo.consumeRecentlyChanged(c.id),
          color: AppColors.warning,
          borderRadius: BorderRadius.circular(16),
          child: _ConnectionCard(connection: c),
        );
    final connections = repo.connections;
    final active = connections.where(_isActive).toList();
    final pending = connections.where((c) => !_isActive(c)).toList();
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Network'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: repo.refreshAll,
          ),
          IconButton(
            icon: const Icon(Icons.add_link_rounded),
            tooltip: 'Add connection',
            onPressed: () => _showInvitationDialog(context, repo),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: repo.refreshAll,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            _NetworkSummary(active: active.length, total: connections.length),
            const SizedBox(height: 24),
            if (connections.isEmpty)
              _EmptyState(onAdd: () => _showInvitationDialog(context, repo))
            else ...[
              if (active.isNotEmpty) ...[
                _SectionLabel('Active Connections',
                    count: active.length, color: AppColors.success),
                const SizedBox(height: 12),
                ...active.map(wrap),
              ],
              if (pending.isNotEmpty) ...[
                const SizedBox(height: 20),
                _SectionLabel('Pending / Inactive',
                    count: pending.length, color: wc.textTertiary),
                const SizedBox(height: 12),
                ...pending.map(wrap),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

Future<void> _showInvitationDialog(
    BuildContext context, WalletRepository repo) async {
  final controller = TextEditingController();
  await showDialog<void>(
    context: context,
    builder: (ctx) => _InvitationDialog(controller: controller, repo: repo),
  );
  controller.dispose();
}

class _InvitationDialog extends StatefulWidget {
  final TextEditingController controller;
  final WalletRepository repo;

  const _InvitationDialog({required this.controller, required this.repo});

  @override
  State<_InvitationDialog> createState() => _InvitationDialogState();
}

class _InvitationDialogState extends State<_InvitationDialog> {
  _DecodedInvitation? _preview;
  String? _error;
  bool _busy = false;

  void _doPreview() {
    final url = widget.controller.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _preview = _decodeInvitation(url);
      _error = null;
    });
  }

  Future<void> _connect() async {
    final url = widget.controller.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repo.receiveInvitation(url);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return AlertDialog(
      backgroundColor: wc.card,
      title: const Text('Connect via OOB Invitation'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: widget.controller,
              maxLines: 3,
              minLines: 1,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: InputDecoration(
                hintText: 'https://…?oob=…',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              onChanged: (_) => setState(() => _preview = null),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                TextButton.icon(
                  onPressed: _busy ? null : _doPreview,
                  icon: const Icon(Icons.visibility_outlined, size: 16),
                  label: const Text('Preview'),
                ),
              ],
            ),
            if (_preview != null) ...[
              const SizedBox(height: 4),
              _PreviewBox(decoded: _preview!),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: const TextStyle(color: AppColors.error, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: _busy ? null : _connect,
          icon: _busy
              ? const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.link_rounded, size: 16),
          label: const Text('Connect'),
        ),
      ],
    );
  }
}

class _PreviewBox extends StatelessWidget {
  final _DecodedInvitation decoded;

  const _PreviewBox({required this.decoded});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final verified = decoded.hasLedgerIdentity;
    final color = verified ? AppColors.success : AppColors.warning;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                verified ? Icons.verified_rounded : Icons.warning_amber_rounded,
                color: color,
                size: 14,
              ),
              const SizedBox(width: 6),
              Text(
                verified
                    ? 'VERIFIED IDENTITY'
                    : 'LABEL ONLY · NOT LEDGER-VERIFIED',
                style: TextStyle(
                  color: color,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            decoded.label ?? 'Unknown',
            style: TextStyle(
              color: wc.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (decoded.from != null) ...[
            const SizedBox(height: 4),
            Text(
              decoded.from!,
              style: TextStyle(
                color: wc.textSecondary,
                fontSize: 10.5,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ],
          if (!verified) ...[
            const SizedBox(height: 6),
            Text(
              'The label above is self-declared by the inviter. '
              'Without a public DID, the wallet cannot verify the identity '
              'against the ledger.',
              style: TextStyle(
                color: wc.textSecondary,
                fontSize: 11,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NetworkSummary extends StatelessWidget {
  final int active;
  final int total;

  const _NetworkSummary({required this.active, required this.total});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final wc = context.wc;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: isDark
            ? LinearGradient(
                colors: [
                  AppColors.primary.withOpacity(0.15),
                  wc.card,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              )
            : LinearGradient(
                colors: [
                  AppColors.primary.withOpacity(0.12),
                  wc.card,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
        border: Border.all(color: AppColors.primary.withOpacity(0.2)),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.1),
            blurRadius: 30,
            spreadRadius: -5,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.12),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.primary.withOpacity(0.3)),
            ),
            child: const Icon(Icons.hub_rounded,
                color: AppColors.primary, size: 24),
          ),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'DID Network',
                style: TextStyle(color: wc.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 4),
              RichText(
                text: TextSpan(
                  children: [
                    TextSpan(
                      text: '$active',
                      style: const TextStyle(
                        color: AppColors.success,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    TextSpan(
                      text: ' / $total peers',
                      style: TextStyle(
                        color: wc.textSecondary,
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const Spacer(),
          _MiniGraph(active: active, total: total),
        ],
      ),
    );
  }
}

class _MiniGraph extends StatelessWidget {
  final int active;
  final int total;

  const _MiniGraph({required this.active, required this.total});

  @override
  Widget build(BuildContext context) {
    final ratio = total > 0 ? active / total : 0.0;
    return SizedBox(
      width: 48,
      height: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          CircularProgressIndicator(
            value: 1,
            strokeWidth: 4,
            color: context.wc.border,
          ),
          CircularProgressIndicator(
            value: ratio,
            strokeWidth: 4,
            color: AppColors.success,
            strokeCap: StrokeCap.round,
          ),
          Text(
            '${(ratio * 100).round()}%',
            style: TextStyle(
              color: context.wc.textPrimary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  final int count;
  final Color color;

  const _SectionLabel(this.text, {required this.count, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          text,
          style: TextStyle(
            color: context.wc.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: color.withOpacity(0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '$count',
            style: TextStyle(
                color: color, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onAdd;
  const _EmptyState({required this.onAdd});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        children: [
          Icon(Icons.hub_outlined, color: wc.textTertiary, size: 48),
          const SizedBox(height: 12),
          Text(
            'No connections yet',
            style: TextStyle(
              color: wc.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Paste an OOB invitation URL to connect to an issuer or verifier.',
            textAlign: TextAlign.center,
            style: TextStyle(color: wc.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add_link_rounded, size: 16),
            label: const Text('Add connection'),
          ),
        ],
      ),
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  final WalletConnection connection;

  const _ConnectionCard({required this.connection});

  @override
  Widget build(BuildContext context) {
    final c = connection;
    final active = _isActive(c);
    final color = active ? AppColors.success : context.wc.textTertiary;
    final wc = context.wc;
    final did = c.theirDid;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: active ? AppColors.success.withOpacity(0.2) : wc.border,
        ),
      ),
      child: Row(
        children: [
          Stack(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: color.withOpacity(0.25)),
                ),
                child: Icon(
                  Icons.account_balance_rounded,
                  color: color,
                  size: 22,
                ),
              ),
              Positioned(
                bottom: 0,
                right: 0,
                child: Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                    border: Border.all(color: wc.card, width: 2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        c.theirLabel ?? 'Unknown',
                        style: TextStyle(
                          color: wc.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (_isLedgerDid(did)) ...[
                      const SizedBox(width: 6),
                      Tooltip(
                        message: 'Ledger-verified identity',
                        child: Icon(
                          Icons.verified_rounded,
                          color: AppColors.success,
                          size: 14,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  did == null || did.isEmpty ? c.id : _shortDid(did),
                  style: TextStyle(
                    color: wc.textSecondary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: color.withOpacity(0.3)),
                ),
                child: Text(
                  _stateLabel(c.state),
                  style: TextStyle(
                    color: color,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _formatDate(c.createdAt),
                style: TextStyle(
                  color: wc.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _shortDid(String did) {
    if (did.length <= 30) return did;
    return '${did.substring(0, 16)}...${did.substring(did.length - 8)}';
  }

  String _formatDate(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }
}
