import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../data/wallet_repository.dart';
import '../models/api_models.dart';
import '../theme/app_theme.dart';

const _attrLabels = <String, String>{
  'vorname': 'Vorname',
  'nachname': 'Nachname',
  'geburtsdatum': 'Geburtsdatum',
  'fuehrerscheinklasse': 'Klasse',
  'ausstellungsdatum': 'Ausgestellt am',
};

/// Derives a human title for a credential offer from its schema id — the
/// cred-def id has no schema name (only `.../CLAIM_DEF/<seqNo>/<tag>`, which is
/// why it used to read "v0"). Known schemas get a prettified label.
String _offerTitle(String? schemaId) {
  if (schemaId == null || schemaId.isEmpty) return 'Credential Offer';
  final parts = schemaId.split('/');
  final idx = parts.indexOf('SCHEMA');
  final name = (idx != -1 && idx + 1 < parts.length)
      ? parts[idx + 1]
      : schemaId.split(':').last;
  switch (name.toLowerCase()) {
    case 'fuehrerschein':
    case 'driverslicense':
      return 'Führerschein';
    default:
      return name;
  }
}

/// Prettifies a raw schema name (e.g. "Fuehrerschein") for display.
String _prettyType(String? raw) {
  if (raw == null || raw.isEmpty) return 'Credential';
  switch (raw.toLowerCase()) {
    case 'fuehrerschein':
    case 'driverslicense':
      return 'Führerschein';
    default:
      return raw;
  }
}

enum _Filter { all, credentials, proofs }

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  _Filter _filter = _Filter.all;

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<WalletRepository>();
    final wc = context.wc;
    final pendingCreds = repo.pendingCredentials;
    final pendingProofs = repo.pendingProofs;
    final totalPending = pendingCreds.length + pendingProofs.length;

    final showCreds =
        _filter == _Filter.all || _filter == _Filter.credentials;
    final showProofs = _filter == _Filter.all || _filter == _Filter.proofs;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Inbox'),
            const SizedBox(width: 10),
            if (totalPending > 0)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.warning.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$totalPending',
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
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: repo.refreshAll,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: repo.refreshAll,
        child: Column(
          children: [
            _FilterBar(
              selected: _filter,
              onSelect: (f) => setState(() => _filter = f),
              credCount: pendingCreds.length,
              proofCount: pendingProofs.length,
            ),
            const SizedBox(height: 4),
            Expanded(
              child: totalPending == 0
                  ? _EmptyState()
                  : ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      children: [
                        if (showCreds)
                          ...pendingCreds.map(
                            (c) => _CredentialOfferCard(
                              offer: c,
                              onAccept: () => repo.acceptCredential(c.id),
                              onDecline: () => repo.declineCredential(c.id),
                            ),
                          ),
                        if (showProofs)
                          ...pendingProofs.map(
                            (p) => _ProofRequestCard(
                              proof: p,
                              onAccept: () => repo.acceptProof(p.id),
                              onDecline: () => repo.declineProof(p.id),
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

class _FilterBar extends StatelessWidget {
  final _Filter selected;
  final ValueChanged<_Filter> onSelect;
  final int credCount;
  final int proofCount;

  const _FilterBar({
    required this.selected,
    required this.onSelect,
    required this.credCount,
    required this.proofCount,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        children: [
          _Chip(
            label: 'All',
            count: credCount + proofCount,
            selected: selected == _Filter.all,
            color: AppColors.primary,
            onTap: () => onSelect(_Filter.all),
            wc: wc,
          ),
          const SizedBox(width: 8),
          _Chip(
            label: 'Credentials',
            count: credCount,
            selected: selected == _Filter.credentials,
            color: AppColors.success,
            onTap: () => onSelect(_Filter.credentials),
            wc: wc,
          ),
          const SizedBox(width: 8),
          _Chip(
            label: 'Proofs',
            count: proofCount,
            selected: selected == _Filter.proofs,
            color: AppColors.warning,
            onTap: () => onSelect(_Filter.proofs),
            wc: wc,
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  final dynamic wc;

  const _Chip({
    required this.label,
    required this.count,
    required this.selected,
    required this.color,
    required this.onTap,
    required this.wc,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? color.withOpacity(0.18) : wc.card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? color.withOpacity(0.5) : wc.border,
          ),
        ),
        child: Row(
          children: [
            Text(
              label,
              style: TextStyle(
                color: selected ? color : wc.textSecondary,
                fontSize: 13,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
            if (count > 0) ...[
              const SizedBox(width: 6),
              Text(
                '$count',
                style: TextStyle(
                  color: selected ? color : wc.textTertiary,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ],
        ),
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
            Icon(Icons.inbox_outlined, color: wc.textTertiary, size: 56),
            const SizedBox(height: 14),
            Text(
              'No pending items',
              style: TextStyle(
                color: wc.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Credential offers and proof requests will appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: wc.textSecondary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _CredentialOfferCard extends StatefulWidget {
  final PendingCredentialOffer offer;
  final Future<void> Function() onAccept;
  final Future<void> Function() onDecline;

  const _CredentialOfferCard({
    required this.offer,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  State<_CredentialOfferCard> createState() => _CredentialOfferCardState();
}

class _CredentialOfferCardState extends State<_CredentialOfferCard> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final color = AppColors.success;
    final o = widget.offer;
    final title = _offerTitle(o.schemaId);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [BoxShadow(color: color.withOpacity(0.06), blurRadius: 20)],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.13),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.card_membership_rounded,
                      color: color, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: wc.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Credential Offer · from ${o.fromLabel ?? "Unknown"}',
                        style: TextStyle(color: wc.textSecondary, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                _Badge(label: 'Offer', color: color),
              ],
            ),
            if (o.credDefId != null) ...[
              const SizedBox(height: 10),
              Text(
                o.credDefId!,
                style: TextStyle(
                  color: wc.textTertiary,
                  fontSize: 10.5,
                  fontFamily: 'monospace',
                  height: 1.4,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(Icons.schedule, color: wc.textTertiary, size: 12),
                const SizedBox(width: 4),
                Text(
                  timeago.format(o.createdAt),
                  style: TextStyle(color: wc.textTertiary, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _run(widget.onDecline),
                    icon: const Icon(Icons.close_rounded, size: 16),
                    label: const Text('Decline'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: BorderSide(color: AppColors.error.withOpacity(0.3)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : () => _run(widget.onAccept),
                    icon: _busy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.check_rounded, size: 16),
                    label: const Text('Accept'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.success,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ProofRequestCard extends StatefulWidget {
  final ProofExchange proof;
  final Future<void> Function() onAccept;
  final Future<void> Function() onDecline;

  const _ProofRequestCard({
    required this.proof,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  State<_ProofRequestCard> createState() => _ProofRequestCardState();
}

class _ProofRequestCardState extends State<_ProofRequestCard> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final color = AppColors.warning;
    final p = widget.proof;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [BoxShadow(color: color.withOpacity(0.06), blurRadius: 20)],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.13),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.policy_rounded, color: color, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Proof Request',
                        style: TextStyle(
                          color: wc.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'Verifier wants to verify attributes',
                        style: TextStyle(color: wc.textSecondary, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                _Badge(label: 'Request', color: color),
              ],
            ),
            const SizedBox(height: 12),
            if (p.credentialType != null) ...[
              Text(
                'CREDENTIAL',
                style: TextStyle(
                  color: wc.textTertiary,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.directions_car_rounded, size: 16, color: color),
                  const SizedBox(width: 6),
                  Text(
                    _prettyType(p.credentialType),
                    style: TextStyle(
                      color: wc.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
            ],
            Text(
              'REQUESTED ATTRIBUTES',
              style: TextStyle(
                color: wc.textTertiary,
                fontSize: 10,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 8),
            if (p.requestedAttributes.isEmpty)
              Text(
                'none',
                style: TextStyle(color: wc.textTertiary, fontSize: 12),
              )
            else
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: p.requestedAttributes
                    .map((a) => Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 9, vertical: 4),
                          decoration: BoxDecoration(
                            color: color.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: color.withOpacity(0.25)),
                          ),
                          child: Text(
                            _attrLabels[a] ?? a,
                            style: TextStyle(
                              color: color,
                              fontSize: 11,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ))
                    .toList(),
              ),
            const SizedBox(height: 14),
            Row(
              children: [
                Icon(Icons.schedule, color: wc.textTertiary, size: 12),
                const SizedBox(width: 4),
                Text(
                  timeago.format(p.createdAt),
                  style: TextStyle(color: wc.textTertiary, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _run(widget.onDecline),
                    icon: const Icon(Icons.close_rounded, size: 16),
                    label: const Text('Decline'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.error,
                      side: BorderSide(color: AppColors.error.withOpacity(0.3)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : () => _run(widget.onAccept),
                    icon: _busy
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.share_rounded, size: 16),
                    label: const Text('Share Proof'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.warning,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
            color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
