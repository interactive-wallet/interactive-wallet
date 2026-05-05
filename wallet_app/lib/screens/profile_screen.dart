import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final validCreds =
        MockData.credentials.where((c) => c.status == CredentialStatus.valid).length;
    final activeConns = MockData.connections.where((c) => c.isActive).length;
    final pendingMsgs =
        MockData.messages.where((m) => m.status == MessageStatus.pending).length;
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Profile'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          _ProfileHeader(),
          const SizedBox(height: 24),
          _DIDCard(),
          const SizedBox(height: 24),
          _StatsGrid(
            validCreds: validCreds,
            activeConns: activeConns,
            pendingMsgs: pendingMsgs,
            totalAudit: MockData.auditEvents.length,
          ),
          const SizedBox(height: 24),
          _SectionTitle('Security'),
          const SizedBox(height: 12),
          _SecuritySettings(),
          const SizedBox(height: 24),
          _SectionTitle('About'),
          const SizedBox(height: 12),
          _AboutSection(),
        ],
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: isDark
            ? const LinearGradient(
                colors: [Color(0xFF1E2A4A), Color(0xFF111827)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              )
            : LinearGradient(
                colors: [AppColors.primary.withOpacity(0.08), wc.card],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
        border: Border.all(color: AppColors.primary.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AppColors.primary, Color(0xFF1D4ED8)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: const Center(
              child: Text(
                'AK',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Arian Kabiri',
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'TU Berlin · IoS Lab 2026',
                  style: TextStyle(color: wc.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 8),
                _ActiveBadge(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActiveBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: const BoxDecoration(
            color: AppColors.success,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 6),
        const Text(
          'Identity Active',
          style: TextStyle(
            color: AppColors.success,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _DIDCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'DECENTRALIZED IDENTIFIER',
                style: TextStyle(
                  color: wc.textTertiary,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.2,
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () {
                  Clipboard.setData(ClipboardData(text: MockData.myDid));
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: const Text('DID copied to clipboard'),
                      backgroundColor: wc.card,
                      behavior: SnackBarBehavior.floating,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  );
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: AppColors.primary.withOpacity(0.25)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.copy_rounded,
                          color: AppColors.primary, size: 13),
                      SizedBox(width: 4),
                      Text(
                        'Copy',
                        style: TextStyle(
                          color: AppColors.primary,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            MockData.myDid,
            style: TextStyle(
              color: wc.textSecondary,
              fontSize: 11,
              fontFamily: 'monospace',
              height: 1.6,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(Icons.link_rounded, color: wc.textTertiary, size: 14),
              const SizedBox(width: 6),
              Text(
                'did:peer method',
                style: TextStyle(color: wc.textTertiary, fontSize: 12),
              ),
              const Spacer(),
              const Icon(Icons.verified_rounded,
                  color: AppColors.success, size: 14),
              const SizedBox(width: 5),
              const Text(
                'Cryptographically verified',
                style:
                    TextStyle(color: AppColors.success, fontSize: 12),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatsGrid extends StatelessWidget {
  final int validCreds;
  final int activeConns;
  final int pendingMsgs;
  final int totalAudit;

  const _StatsGrid({
    required this.validCreds,
    required this.activeConns,
    required this.pendingMsgs,
    required this.totalAudit,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: [
        _StatTile('Valid Credentials', '$validCreds',
            Icons.card_membership_rounded, AppColors.success),
        _StatTile('Active Connections', '$activeConns',
            Icons.hub_rounded, AppColors.primary),
        _StatTile('Pending Messages', '$pendingMsgs',
            Icons.mark_email_unread_outlined, AppColors.warning),
        _StatTile('Audit Events', '$totalAudit', Icons.history_rounded,
            AppColors.purple),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _StatTile(this.label, this.value, this.icon, this.color);

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: wc.border),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.05), blurRadius: 16),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: color, size: 20),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: TextStyle(
                  color: color,
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                label,
                style: TextStyle(color: wc.textSecondary, fontSize: 11),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;

  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
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

class _SecuritySettings extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        children: [
          _SettingRow(
            icon: Icons.lock_outline_rounded,
            color: AppColors.success,
            label: 'Key Management',
            subtitle: 'Ed25519 · X25519',
            showDivider: true,
          ),
          _SettingRow(
            icon: Icons.security_rounded,
            color: AppColors.primary,
            label: 'Signature Verification',
            subtitle: 'Always enabled',
            showDivider: true,
          ),
          _SettingRow(
            icon: Icons.history_rounded,
            color: AppColors.purple,
            label: 'Audit Logging',
            subtitle: 'Hash-chained · Active',
            showDivider: false,
          ),
        ],
      ),
    );
  }
}

class _AboutSection extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: wc.border),
      ),
      child: Column(
        children: [
          _SettingRow(
            icon: Icons.info_outline_rounded,
            color: wc.textSecondary,
            label: 'DID Wallet',
            subtitle: 'v1.0.0 · DIDComm v2',
            showDivider: true,
          ),
          _SettingRow(
            icon: Icons.school_rounded,
            color: AppColors.primary,
            label: 'TU Berlin · IoS Lab',
            subtitle: 'Internet of Services 2026',
            showDivider: false,
          ),
        ],
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final String subtitle;
  final bool showDivider;

  const _SettingRow({
    required this.icon,
    required this.color,
    required this.label,
    required this.subtitle,
    required this.showDivider,
  });

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: wc.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: TextStyle(
                          color: wc.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded,
                  color: wc.textTertiary, size: 20),
            ],
          ),
        ),
        if (showDivider)
          Padding(
            padding: const EdgeInsets.only(left: 68),
            child: Divider(height: 1, color: wc.border),
          ),
      ],
    );
  }
}
