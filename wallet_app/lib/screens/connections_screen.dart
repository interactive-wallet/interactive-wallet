import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../data/mock_data.dart';
import '../models/models.dart';

class ConnectionsScreen extends StatelessWidget {
  const ConnectionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final active = MockData.connections.where((c) => c.isActive).toList();
    final inactive = MockData.connections.where((c) => !c.isActive).toList();
    final wc = context.wc;

    return Scaffold(
      backgroundColor: wc.background,
      appBar: AppBar(
        title: const Text('Network'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_link_rounded),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          _NetworkSummary(
              active: active.length, total: MockData.connections.length),
          const SizedBox(height: 24),
          _SectionLabel('Active Connections',
              count: active.length, color: AppColors.success),
          const SizedBox(height: 12),
          ...active.map((c) => _ConnectionCard(connection: c)),
          if (inactive.isNotEmpty) ...[
            const SizedBox(height: 20),
            _SectionLabel('Inactive',
                count: inactive.length,
                color: context.wc.textTertiary),
            const SizedBox(height: 12),
            ...inactive.map((c) => _ConnectionCard(connection: c)),
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

class _ConnectionCard extends StatelessWidget {
  final DIDConnection connection;

  const _ConnectionCard({required this.connection});

  @override
  Widget build(BuildContext context) {
    final c = connection;
    final color = c.isActive ? AppColors.success : context.wc.textTertiary;
    final wc = context.wc;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: wc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: c.isActive
              ? AppColors.success.withOpacity(0.2)
              : wc.border,
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
                Text(
                  c.label,
                  style: TextStyle(
                    color: wc.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  _shortDid(c.theirDid),
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
                'Connected',
                style: TextStyle(color: wc.textTertiary, fontSize: 11),
              ),
              const SizedBox(height: 2),
              Text(
                _formatDate(c.connectedAt),
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
