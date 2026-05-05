import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final valid =
        MockData.credentials.where((c) => c.status == CredentialStatus.valid).toList();
    final other =
        MockData.credentials.where((c) => c.status != CredentialStatus.valid).toList();
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Wallet'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_circle_outline_rounded),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          _WalletSummary(),
          const SizedBox(height: 24),
          _Label(text: 'Active Credentials', context: context),
          const SizedBox(height: 12),
          ...valid.map((c) => _CredentialCard(credential: c)),
          if (other.isNotEmpty) ...[
            const SizedBox(height: 20),
            _Label(text: 'Inactive Credentials', context: context),
            const SizedBox(height: 12),
            ...other.map((c) => _CredentialCard(credential: c)),
          ],
        ],
      ),
    );
  }
}

class _WalletSummary extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final valid =
        MockData.credentials.where((c) => c.status == CredentialStatus.valid).length;
    final expired =
        MockData.credentials.where((c) => c.status == CredentialStatus.expired).length;
    final revoked =
        MockData.credentials.where((c) => c.status == CredentialStatus.revoked).length;
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
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'My Credentials',
                style: TextStyle(
                  color: wc.textSecondary,
                  fontSize: 12,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Identity Wallet',
                style: TextStyle(
                  color: wc.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const Spacer(),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _SummaryBadge('$valid Valid', AppColors.success),
              const SizedBox(height: 4),
              if (expired > 0) _SummaryBadge('$expired Expired', AppColors.error),
              if (revoked > 0) _SummaryBadge('$revoked Revoked', AppColors.warning),
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

class _CredentialCard extends StatefulWidget {
  final Credential credential;

  const _CredentialCard({required this.credential});

  @override
  State<_CredentialCard> createState() => _CredentialCardState();
}

class _CredentialCardState extends State<_CredentialCard> {
  bool _expanded = false;

  Color get _accentColor {
    switch (widget.credential.status) {
      case CredentialStatus.valid:
        return AppColors.success;
      case CredentialStatus.expired:
        return AppColors.error;
      case CredentialStatus.revoked:
        return AppColors.warning;
    }
  }

  String get _statusLabel {
    switch (widget.credential.status) {
      case CredentialStatus.valid:
        return 'Valid';
      case CredentialStatus.expired:
        return 'Expired';
      case CredentialStatus.revoked:
        return 'Revoked';
    }
  }

  IconData get _typeIcon {
    switch (widget.credential.type) {
      case 'UniversityDegree':
        return Icons.school_rounded;
      case 'NationalID':
        return Icons.badge_rounded;
      case 'EmploymentCredential':
        return Icons.work_rounded;
      case 'HealthInsurance':
        return Icons.local_hospital_rounded;
      case 'DriversLicense':
        return Icons.directions_car_rounded;
      case 'AirportAccessPass':
        return Icons.flight_takeoff_rounded;
      default:
        return Icons.card_membership_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _accentColor;
    final c = widget.credential;
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
                        child: Icon(_typeIcon, color: color, size: 22),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _formatType(c.type),
                              style: TextStyle(
                                color: wc.textPrimary,
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _shortDid(c.issuerDid),
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
                          _StatusPill(label: _statusLabel, color: color),
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
                        label: 'Issued',
                        date: _formatDate(c.issuedAt),
                      ),
                      if (c.expiresAt != null) ...[
                        const SizedBox(width: 10),
                        _DateChip(
                          icon: Icons.event_busy_outlined,
                          label: 'Expires',
                          date: _formatDate(c.expiresAt!),
                          highlight: c.status == CredentialStatus.expired,
                        ),
                      ],
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
                  ...c.claims.entries
                      .map((e) => _ClaimRow(key_: e.key, value: e.value)),
                  const SizedBox(height: 12),
                  Text(
                    'ISSUER',
                    style: TextStyle(
                      color: wc.textTertiary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    c.issuerDid,
                    style: TextStyle(
                      color: wc.textSecondary,
                      fontSize: 10.5,
                      fontFamily: 'monospace',
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatType(String type) {
    return type
        .replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m.group(0)}')
        .trim();
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
  final bool highlight;

  const _DateChip({
    required this.icon,
    required this.label,
    required this.date,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    final color =
        highlight ? AppColors.error : context.wc.textTertiary;
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
