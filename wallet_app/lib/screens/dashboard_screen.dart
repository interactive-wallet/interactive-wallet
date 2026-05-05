import 'dart:async';
import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;
import '../app.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';
import '../utils/message_utils.dart';
import '../widgets/notification_sheet.dart';
import 'profile_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  int _simMsgCounter = 0;
  Timer? _liveTimer;

  @override
  void initState() {
    super.initState();
    _liveTimer = Timer.periodic(const Duration(seconds: 90), (_) {
      if (!mounted) return;
      final types = ['credentialOffer', 'connectionInvite', 'trustPing'];
      final type = types[_simMsgCounter % types.length];
      _simMsgCounter++;
      final color = AppColors.messageTypeColor(type);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              Icon(messageIcon(type), color: color, size: 16),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'New ${messageTitle(type)} received',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),
          backgroundColor: context.wc.card,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12)),
          action: SnackBarAction(
            label: 'View',
            textColor: AppColors.primary,
            onPressed: () {},
          ),
        ),
      );
    });
  }

  @override
  void dispose() {
    _liveTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pending =
        MockData.messages.where((m) => m.status == MessageStatus.pending).toList();
    final recent = MockData.messages.take(5).toList();
    final wc = context.wc;
    final isDark = themeNotifier.value == ThemeMode.dark;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.primary, Color(0xFF1D4ED8)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Icon(Icons.fingerprint, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            const Text('DID Wallet'),
          ],
        ),
        actions: [
          const _LiveIndicator(),
          const SizedBox(width: 8),
          IconButton(
            icon: Icon(isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded),
            tooltip: isDark ? 'Light mode' : 'Dark mode',
            onPressed: () => setState(() {
              themeNotifier.value =
                  isDark ? ThemeMode.light : ThemeMode.dark;
            }),
          ),
          IconButton(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.notifications_outlined, size: 24),
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: AppColors.warning,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ],
            ),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ProfileScreen()),
        ),
        tooltip: 'Profile',
        child: const Icon(Icons.person_rounded),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
        children: [
          _IdentityCard(),
          const SizedBox(height: 20),
          _StatsRow(),
          const SizedBox(height: 28),
          _SectionHeader(title: 'Pending Actions', count: pending.length),
          const SizedBox(height: 12),
          if (pending.isEmpty)
            _EmptyState(label: 'No pending actions')
          else
            ...pending.map((m) => _PendingCard(message: m)),
          const SizedBox(height: 28),
          const _SectionHeader(title: 'Recent Activity'),
          const SizedBox(height: 12),
          ...recent.map((m) => _ActivityRow(message: m)),
        ],
      ),
    );
  }
}

// ─── LIVE Indicator ───────────────────────────────────────────────────────────

class _LiveIndicator extends StatefulWidget {
  const _LiveIndicator();

  @override
  State<_LiveIndicator> createState() => _LiveIndicatorState();
}

class _LiveIndicatorState extends State<_LiveIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _pulse;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      duration: const Duration(milliseconds: 1400),
      vsync: this,
    )..repeat(reverse: true);
    _pulse = Tween<double>(begin: 0.3, end: 1.0).animate(
      CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulse,
      builder: (_, __) {
        final opacity = 0.06 + 0.12 * _pulse.value;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.success.withOpacity(opacity),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
                color: AppColors.success.withOpacity(0.4), width: 0.8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: AppColors.success
                      .withOpacity(0.5 + 0.5 * _pulse.value),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.success.withOpacity(0.5 * _pulse.value),
                      blurRadius: 5,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 5),
              Text(
                'LIVE',
                style: TextStyle(
                  color: AppColors.success,
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─── Identity Card ────────────────────────────────────────────────────────────

class _IdentityCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: isDark
            ? const LinearGradient(
                colors: [Color(0xFF1E3A6E), Color(0xFF0F1E3D), Color(0xFF080C18)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: [0, 0.6, 1],
              )
            : const LinearGradient(
                colors: [Color(0xFF1D4ED8), Color(0xFF2563EB), Color(0xFF3B82F6)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: [0, 0.5, 1],
              ),
        border: Border.all(
          color: AppColors.primary.withOpacity(0.25),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.2),
            blurRadius: 40,
            spreadRadius: -5,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: Colors.white.withOpacity(0.3)),
                ),
                child: const Icon(Icons.fingerprint,
                    color: Colors.white, size: 24),
              ),
              const SizedBox(width: 13),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'My Identity',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        letterSpacing: 0.5,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Arian Kabiri',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              _StatusBadge(),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'DECENTRALIZED IDENTIFIER',
            style: TextStyle(
              color: Colors.white54,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            MockData.myDid,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 10.5,
              fontFamily: 'monospace',
              letterSpacing: 0.2,
              height: 1.5,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 20),
          Divider(height: 1, color: Colors.white.withOpacity(0.15)),
          const SizedBox(height: 18),
          Row(
            children: [
              _MiniStat(
                label: 'Credentials',
                value: '${MockData.credentials.length}',
              ),
              _VertDivider(),
              _MiniStat(
                label: 'Connections',
                value: '${MockData.connections.length}',
              ),
              _VertDivider(),
              _MiniStat(
                label: 'Messages',
                value: '${MockData.messages.length}',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withOpacity(0.3)),
      ),
      child: const Row(
        children: [
          Icon(Icons.circle, color: Color(0xFF4ADE80), size: 6),
          SizedBox(width: 5),
          Text(
            'Active',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;

  const _MiniStat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class _VertDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 30,
      color: Colors.white.withOpacity(0.2),
    );
  }
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

class _StatsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final pending =
        MockData.messages.where((m) => m.status == MessageStatus.pending).length;
    final valid =
        MockData.credentials.where((c) => c.status == CredentialStatus.valid).length;
    final active = MockData.connections.where((c) => c.isActive).length;

    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.mark_email_unread_outlined,
            label: 'Pending',
            value: '$pending',
            color: AppColors.warning,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            icon: Icons.verified_user_outlined,
            label: 'Valid Creds',
            value: '$valid',
            color: AppColors.success,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            icon: Icons.hub_outlined,
            label: 'Active',
            value: '$active',
            color: AppColors.primary,
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

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
          BoxShadow(
            color: color.withOpacity(0.06),
            blurRadius: 20,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 12),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: 26,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(color: wc.textSecondary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

// ─── Section Header ───────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  final int? count;

  const _SectionHeader({required this.title, this.count});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: wc.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.warning.withOpacity(0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              '$count',
              style: const TextStyle(
                color: AppColors.warning,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
        const Spacer(),
        Text(
          'See all',
          style: TextStyle(color: AppColors.primary, fontSize: 13),
        ),
      ],
    );
  }
}

// ─── Pending Card ─────────────────────────────────────────────────────────────

class _PendingCard extends StatelessWidget {
  final DIDMessage message;

  const _PendingCard({required this.message});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.messageTypeColor(message.type);
    final wc = context.wc;
    return GestureDetector(
      onTap: () => showNotificationSheet(context, message),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: wc.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withOpacity(0.25)),
          boxShadow: [
            BoxShadow(color: color.withOpacity(0.07), blurRadius: 20),
          ],
        ),
        child: Column(
          children: [
            if (!message.signatureVerified)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.08),
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                  border: Border(
                      bottom: BorderSide(
                          color: AppColors.error.withOpacity(0.2))),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_rounded,
                        color: AppColors.error, size: 12),
                    const SizedBox(width: 5),
                    Text(
                      'SIGNATURE INVALID',
                      style: TextStyle(
                        color: AppColors.error,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.13),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(messageIcon(message.type), color: color, size: 22),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          messageTitle(message.type),
                          style: TextStyle(
                            color: wc.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          truncateDid(message.senderDid),
                          style: TextStyle(
                            color: wc.textSecondary,
                            fontSize: 11,
                            fontFamily: 'monospace',
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
                              size: 11,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              message.signatureVerified
                                  ? 'Signature verified'
                                  : 'Signature INVALID',
                              style: TextStyle(
                                color: message.signatureVerified
                                    ? AppColors.success
                                    : AppColors.error,
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        timeago.format(message.timestamp),
                        style: TextStyle(color: wc.textTertiary, fontSize: 11),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withOpacity(0.13),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'Pending',
                          style: TextStyle(
                            color: AppColors.warning,
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
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

// ─── Activity Row ─────────────────────────────────────────────────────────────

class _ActivityRow extends StatelessWidget {
  final DIDMessage message;

  const _ActivityRow({required this.message});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.messageTypeColor(message.type);
    final wc = context.wc;
    return GestureDetector(
      onTap: () => showNotificationSheet(context, message),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: wc.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: wc.border),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(messageIcon(message.type), color: color, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    messageTitle(message.type),
                    style: TextStyle(
                      color: wc.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    truncateDid(message.senderDid),
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
                Text(
                  timeago.format(message.timestamp),
                  style: TextStyle(color: wc.textTertiary, fontSize: 11),
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
                      size: 12,
                    ),
                    const SizedBox(width: 3),
                    _StatusChip(status: message.status),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final MessageStatus status;

  const _StatusChip({required this.status});

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
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        label,
        style: TextStyle(
            color: color, fontSize: 10, fontWeight: FontWeight.w500),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String label;

  const _EmptyState({required this.label});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Container(
      padding: const EdgeInsets.all(24),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: wc.border),
      ),
      child: Text(
        label,
        style: TextStyle(color: wc.textTertiary, fontSize: 14),
      ),
    );
  }
}
