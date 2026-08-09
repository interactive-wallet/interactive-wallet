import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/wallet_repository.dart';
import '../models/api_models.dart';
import '../theme/app_theme.dart';
import '../widgets/new_item_highlight.dart';

const _attrLabels = <String, String>{
  'vorname': 'Vorname',
  'nachname': 'Nachname',
  'geburtsdatum': 'Geburtsdatum',
  'fuehrerscheinklasse': 'Klasse',
  'ausstellungsdatum': 'Ausgestellt am',
  'credential_id': 'Credential-ID',
  'geprueft_am': 'Geprüft am',
  'widerrufen_am': 'Widerrufen am',
};

String _schemaName(String? schemaId) {
  if (schemaId == null || schemaId.isEmpty) return 'Credential';
  final parts = schemaId.split('/');
  final idx = parts.indexOf('SCHEMA');
  final name =
      (idx != -1 && idx + 1 < parts.length) ? parts[idx + 1] : schemaId.split(':').last;
  switch (name.toLowerCase()) {
    case 'fuehrerschein':
    case 'driverslicense':
      return 'Führerschein';
    default:
      return name;
  }
}

String _issuerDidFromCredDef(String? credDefId) {
  if (credDefId == null || credDefId.isEmpty) return '';
  final idx = credDefId.indexOf('/anoncreds/');
  return idx > 0 ? credDefId.substring(0, idx) : credDefId;
}

IconData _iconForSchema(String name) {
  switch (name.toLowerCase()) {
    case 'fuehrerschein':
    case 'führerschein':
    case 'driverslicense':
      return Icons.directions_car_rounded;
    case 'universitydegree':
      return Icons.school_rounded;
    case 'nationalid':
      return Icons.badge_rounded;
    case 'healthinsurance':
      return Icons.local_hospital_rounded;
    default:
      return Icons.card_membership_rounded;
  }
}

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<WalletRepository>();
    final credentials = repo.credentials;
    final isVerifier = repo.isVerifier;
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: Text(isVerifier ? 'Checked Credentials' : 'Wallet'),
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
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            _WalletSummary(
              count: credentials.length,
              isLive: repo.isLive,
              isVerifier: isVerifier,
            ),
            const SizedBox(height: 24),
            if (credentials.isEmpty)
              _EmptyState(isVerifier: isVerifier)
            else ...[
              _Label(
                text: isVerifier ? 'Verified Credentials' : 'Active Credentials',
                context: context,
              ),
              const SizedBox(height: 12),
              ...credentials.map((c) => NewItemHighlight(
                    key: ValueKey('cred-${c.credentialId}'),
                    isNew: repo.consumeRecentlyChanged(c.credentialId),
                    color: AppColors.warning,
                    borderRadius: BorderRadius.circular(18),
                    child: _CredentialCard(
                      credential: c,
                      revoked: repo.isCredentialRevoked(c),
                    ),
                  )),
            ],
          ],
        ),
      ),
    );
  }
}

class _WalletSummary extends StatelessWidget {
  final int count;
  final bool isLive;
  final bool isVerifier;

  const _WalletSummary({
    required this.count,
    required this.isLive,
    this.isVerifier = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final wc = context.wc;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: isDark
            ? const LinearGradient(
                colors: [Color(0xFF0F2A1A), Color(0xFF0A1A10), Color(0xFF080C18)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: [0, 0.5, 1],
              )
            : LinearGradient(
                colors: [
                  AppColors.success.withOpacity(0.15),
                  wc.card,
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
        border: Border.all(color: AppColors.success.withOpacity(0.2)),
        boxShadow: [
          BoxShadow(
            color: AppColors.success.withOpacity(0.1),
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
              color: AppColors.success.withOpacity(0.12),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.success.withOpacity(0.3)),
            ),
            child: const Icon(
              Icons.account_balance_wallet_rounded,
              color: AppColors.success,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isVerifier ? 'Verified by me' : 'My Credentials',
                  style: TextStyle(
                    color: wc.textSecondary,
                    fontSize: 12,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isVerifier ? 'Checked Credentials' : 'Identity Wallet',
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _SummaryBadge(
                isVerifier ? '$count Checked' : '$count Stored',
                AppColors.success,
              ),
              const SizedBox(height: 4),
              _SummaryBadge(
                isLive ? 'Live' : 'Offline',
                isLive ? AppColors.success : AppColors.warning,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SummaryBadge extends StatelessWidget {
  final String label;
  final Color color;

  const _SummaryBadge(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _Label extends StatelessWidget {
  final String text;
  final BuildContext context;

  const _Label({required this.text, required this.context});

  @override
  Widget build(_) {
    return Text(
      text,
      style: TextStyle(
        color: context.wc.textPrimary,
        fontSize: 16,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isVerifier;

  const _EmptyState({this.isVerifier = false});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        children: [
          Icon(Icons.inbox_rounded, color: wc.textTertiary, size: 48),
          const SizedBox(height: 12),
          Text(
            isVerifier ? 'No verified credentials yet' : 'No credentials yet',
            style: TextStyle(
              color: wc.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            isVerifier
                ? 'Request a proof to see verified credentials here.'
                : 'Accept a credential offer to see it here.',
            textAlign: TextAlign.center,
            style: TextStyle(color: wc.textSecondary, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _CredentialCard extends StatefulWidget {
  final StoredCredential credential;
  final bool revoked;

  const _CredentialCard({required this.credential, this.revoked = false});

  @override
  State<_CredentialCard> createState() => _CredentialCardState();
}

class _CredentialCardState extends State<_CredentialCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.revoked ? AppColors.error : AppColors.success;
    final c = widget.credential;
    final schema = _schemaName(c.schemaId);
    final issuerDid = _issuerDidFromCredDef(c.credentialDefinitionId);
    final wc = context.wc;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withOpacity(0.25)),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.06), blurRadius: 20),
        ],
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Container(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(13),
                          border: Border.all(color: color.withOpacity(0.25)),
                        ),
                        child: Icon(_iconForSchema(schema), color: color, size: 22),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              schema,
                              style: TextStyle(
                                color: wc.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _shortDid(issuerDid),
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
                          _StatusPill(
                            label: widget.revoked ? 'REVOKED' : 'AnonCreds',
                            color: color,
                          ),
                          const SizedBox(height: 6),
                          Icon(
                            _expanded
                                ? Icons.keyboard_arrow_up_rounded
                                : Icons.keyboard_arrow_down_rounded,
                            color: wc.textTertiary,
                            size: 20,
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      _DateChip(
                        icon: Icons.calendar_today_outlined,
                        label: 'Received',
                        date: _formatDate(c.createdAt),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (_expanded) ...[
            Container(height: 1, color: context.wc.border),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'CLAIMS',
                    style: TextStyle(
                      color: wc.textTertiary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 12),
                  ...c.attributes.entries.map(
                    (e) => _ClaimRow(
                      key_: _attrLabels[e.key] ?? e.key,
                      value: e.value,
                    ),
                  ),
                  if (c.credentialDefinitionId != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      'CRED DEF',
                      style: TextStyle(
                        color: wc.textTertiary,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      c.credentialDefinitionId!,
                      style: TextStyle(
                        color: wc.textSecondary,
                        fontSize: 10.5,
                        fontFamily: 'monospace',
                        height: 1.5,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _shortDid(String did) {
    if (did.length <= 30) return did;
    return '${did.substring(0, 16)}...${did.substring(did.length - 8)}';
  }

  String _formatDate(DateTime dt) {
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }
}

class _StatusPill extends StatelessWidget {
  final String label;
  final Color color;

  const _StatusPill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(7),
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

class _DateChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String date;

  const _DateChip({
    required this.icon,
    required this.label,
    required this.date,
  });

  @override
  Widget build(BuildContext context) {
    final color = context.wc.textTertiary;
    return Row(
      children: [
        Icon(icon, color: color, size: 12),
        const SizedBox(width: 5),
        Text('$label $date', style: TextStyle(color: color, fontSize: 11)),
      ],
    );
  }
}

class _ClaimRow extends StatelessWidget {
  final String key_;
  final String value;

  const _ClaimRow({required this.key_, required this.value});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              key_,
              style: TextStyle(color: wc.textSecondary, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: wc.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
