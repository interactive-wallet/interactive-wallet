import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../data/wallet_repository.dart';
import '../theme/app_theme.dart';
import 'dashboard_screen.dart';
import 'inbox_screen.dart';
import 'wallet_screen.dart';
import 'connections_screen.dart';
import 'audit_log_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _selectedIndex = 0;

  static const _screens = [
    DashboardScreen(),
    InboxScreen(),
    WalletScreen(),
    ConnectionsScreen(),
    AuditLogScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    return Scaffold(
      body: Column(
        children: [
          const _RoleBanner(),
          Expanded(
            child: IndexedStack(
              index: _selectedIndex,
              children: _screens,
            ),
          ),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: wc.border, width: 0.5)),
        ),
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: (i) => setState(() => _selectedIndex = i),
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_outlined),
              activeIcon: Icon(Icons.dashboard),
              label: 'Dashboard',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.mail_outline_rounded),
              activeIcon: Icon(Icons.mail_rounded),
              label: 'Inbox',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.account_balance_wallet_outlined),
              activeIcon: Icon(Icons.account_balance_wallet),
              label: 'Wallet',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.hub_outlined),
              activeIcon: Icon(Icons.hub),
              label: 'Network',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.history_rounded),
              activeIcon: Icon(Icons.history_rounded),
              label: 'Audit',
            ),
          ],
        ),
      ),
    );
  }
}

/// Identifies which backend this window is bound to (HOLDER :3000 / VERIFIER :3004),
/// so two windows from the same build are easy to tell apart.
class _RoleBanner extends StatelessWidget {
  const _RoleBanner();

  @override
  Widget build(BuildContext context) {
    final baseUrl = context.read<WalletRepository>().baseUrl;
    final lower = baseUrl.toLowerCase();
    final String label;
    final Color color;
    if (lower.contains(':3004')) {
      label = 'VERIFIER';
      color = AppColors.warning;
    } else if (lower.contains(':3000')) {
      label = 'HOLDER';
      color = AppColors.primary;
    } else {
      label = 'WALLET';
      color = AppColors.success;
    }
    final shown = baseUrl.replaceFirst(RegExp(r'^https?://'), '');

    return Material(
      color: color.withValues(alpha: 0.12),
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: color.withValues(alpha: 0.4), width: 1),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.circle, size: 8, color: color),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                  letterSpacing: 1.5,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                shown,
                style: TextStyle(color: context.wc.textTertiary, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
