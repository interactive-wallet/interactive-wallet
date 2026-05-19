import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../app.dart';
import '../data/wallet_repository.dart';
import '../models/api_models.dart';
import '../theme/app_theme.dart';
import 'profile_screen.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.watch<WalletRepository>();
    final wc = context.wc;
    final isDark = themeNotifier.value == ThemeMode.dark;

    final activeConns =
        repo.connections.where((c) => c.state == 'completed').length;
    final pendingCount =
        repo.pendingCredentials.length + repo.pendingProofs.length;
    final recentEvents = repo.log.take(6).toList();

    final pendingPreview = <_PendingItem>[
      ...repo.pendingCredentials.map(
        (c) => _PendingItem(
          type: 'credential',
          title: 'Credential offer',
          subtitle: c.fromLabel ?? 'Unknown issuer',
          createdAt: c.createdAt,
        ),
      ),
      ...repo.pendingProofs.map(
        (p) => _PendingItem(
          type: 'proof',
          title: 'Proof request',
          subtitle: p.requestedAttributes.isEmpty
              ? 'no attributes'
              : p.requestedAttributes.join(', '),
          createdAt: p.createdAt,
        ),
      ),
    ];

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
              child: const Icon(Icons.fingerprint,
                  color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            const Text('DID Wallet'),
          ],
        ),
        actions: [
          _LiveBadge(isLive: repo.isLive),
          const SizedBox(width: 8),
          IconButton(
            icon: Icon(isDark
                ? Icons.light_mode_rounded
                : Icons.dark_mode_rounded),
            tooltip: isDark ? 'Light mode' : 'Dark mode',
            onPressed: () {
              themeNotifier.value =
                  isDark ? ThemeMode.light : ThemeMode.dark;
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: repo.refreshAll,
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
      body: RefreshIndicator(
        onRefresh: repo.refreshAll,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
          children: [
            _IdentityCard(repo: repo),
            const SizedBox(height: 20),
            _StatsRow(
              pending: pendingCount,
              credentials: repo.credentials.length,
              connections: activeConns,
            ),
            const SizedBox(height: 28),
            _SectionHeader(title: 'Pending Actions', count: pendingCount),
            const SizedBox(height: 12),
            if (pendingPreview.isEmpty)
              _EmptyTile(label: 'No pending actions')
            else
              ...pendingPreview.take(3).map((p) => _PendingTile(item: p)),
            const SizedBox(height: 28),
            const _SectionHeader(title: 'Recent Activity'),
            const SizedBox(height: 12),
            if (recentEvents.isEmpty)
              _EmptyTile(label: 'No activity yet')
            else
              ...recentEvents.map((e) => _ActivityTile(event: e)),
          ],
        ),
      ),
    );
  }
}

class _PendingItem {
  final String type;
  final String title;
  final String subtitle;
  final DateTime createdAt;
  const _PendingItem({
    required this.type,
    required this.title,
    required this.subtitle,
    required this.createdAt,
  });
}

// ─── LIVE Badge ──────────────────────────────────────────────────────────────

class _LiveBadge extends StatelessWidget {
  final bool isLive;
  const _LiveBadge({required this.isLive});

  @override
  Widget build(BuildContext context) {
    final color = isLive ? AppColors.success : AppColors.warning;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.4), width: 0.8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: color.withOpacity(0.5), blurRadius: 5),
              ],
            ),
          ),
          const SizedBox(width: 5),
          Text(
            isLive ? 'LIVE' : 'OFFLINE',
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.0,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Identity Card ────────────────────────────────────────────────────────────

class _IdentityCard extends StatelessWidget {
  final WalletRepository repo;

  const _IdentityCard({required this.repo});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: isDark
            ? const LinearGradient(
                colors: [
                  Color(0xFF1E3A6E),
                  Color(0xFF0F1E3D),
                  Color(0xFF080C18),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                stops: [0, 0.6, 1],
              )
            : const LinearGradient(
                colors: [
                  Color(0xFF1D4ED8),
                  Color(0xFF2563EB),
                  Color(0xFF3B82F6),
                ],
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
                      'Holder Wallet',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        letterSpacing: 0.5,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Anonymous (pairwise DIDs)',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'WALLET BACKEND',
            style: TextStyle(
              color: Colors.white54,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            repo.baseUrl,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 11,
              fontFamily: 'monospace',
              letterSpacing: 0.2,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 20),
          Divider(height: 1, color: Colors.white.withOpacity(0.15)),
          const SizedBox(height: 18),
          Row(
            children: [
              _MiniStat(
                label: 'Credentials',
                value: '${repo.credentials.length}',
              ),
              _VertDivider(),
              _MiniStat(
                label: 'Connections',
                value: '${repo.connections.length}',
              ),
              _VertDivider(),
              _MiniStat(
                label: 'Proofs',
                value: '${repo.proofExchanges.length}',
              ),
            ],
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
            style: const TextStyle(color: Colors.white70, fontSize: 11),
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
  final int pending;
  final int credentials;
  final int connections;

  const _StatsRow({
    required this.pending,
    required this.credentials,
    required this.connections,
  });

  @override
  Widget build(BuildContext context) {
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
            label: 'Credentials',
            value: '$credentials',
            color: AppColors.success,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            icon: Icons.hub_outlined,
            label: 'Connections',
            value: '$connections',
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
        if (count != null && count! > 0) ...[
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
      ],
    );
  }
}

// ─── Pending tile ─────────────────────────────────────────────────────────────

class _PendingTile extends StatelessWidget {
  final _PendingItem item;

  const _PendingTile({required this.item});

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final color = item.type == 'credential'
        ? AppColors.success
        : AppColors.warning;
    final icon = item.type == 'credential'
        ? Icons.card_membership_rounded
        : Icons.policy_rounded;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.13),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: wc.textSecondary, fontSize: 11),
                ),
              ],
            ),
          ),
          Text(
            timeago.format(item.createdAt),
            style: TextStyle(color: wc.textTertiary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

// ─── Activity tile ────────────────────────────────────────────────────────────

class _ActivityTile extends StatelessWidget {
  final WalletEvent event;

  const _ActivityTile({required this.event});

  Color get _color {
    switch (event.type) {
      case 'credential':
        return AppColors.success;
      case 'proof':
        return AppColors.warning;
      case 'connection':
        return AppColors.primary;
      case 'system':
        return AppColors.purple;
      default:
        return const Color(0xFF9CA3AF);
    }
  }

  IconData get _icon {
    switch (event.type) {
      case 'credential':
        return Icons.card_membership_rounded;
      case 'proof':
        return Icons.policy_rounded;
      case 'connection':
        return Icons.link_rounded;
      case 'system':
        return Icons.settings_outlined;
      default:
        return Icons.info_outline_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final color = _color;
    final state = event.state ?? event.type;

    return Container(
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
            child: Icon(_icon, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${event.type[0].toUpperCase()}${event.type.substring(1)} · $state',
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (event.theirLabel != null)
                  Text(
                    event.theirLabel!,
                    style: TextStyle(
                      color: wc.textSecondary,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ),
          Text(
            timeago.format(event.timestamp),
            style: TextStyle(color: wc.textTertiary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _EmptyTile extends StatelessWidget {
  final String label;

  const _EmptyTile({required this.label});

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
