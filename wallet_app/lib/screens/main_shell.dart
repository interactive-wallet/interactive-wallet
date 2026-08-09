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
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<WalletRepository>().setVisibleTab(_selectedIndex);
    });
  }

  void _selectTab(int i) {
    setState(() => _selectedIndex = i);
    context.read<WalletRepository>().setVisibleTab(i);
  }

  @override
  Widget build(BuildContext context) {
    final wc = context.wc;
    final repo = context.watch<WalletRepository>();
    final isVerifier = repo.isVerifier;
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
          onTap: _selectTab,
          items: [
            const BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_outlined),
              activeIcon: Icon(Icons.dashboard),
              label: 'Dashboard',
            ),
            BottomNavigationBarItem(
              icon: _NavIcon(
                icon: Icons.mail_outline_rounded,
                showDot: repo.unseenTabs.contains(WalletRepository.tabInbox),
              ),
              activeIcon: _NavIcon(
                icon: Icons.mail_rounded,
                showDot: repo.unseenTabs.contains(WalletRepository.tabInbox),
              ),
              label: 'Inbox',
            ),
            BottomNavigationBarItem(
              icon: _NavIcon(
                icon: isVerifier
                    ? Icons.verified_user_outlined
                    : Icons.account_balance_wallet_outlined,
                showDot: repo.unseenTabs.contains(WalletRepository.tabWallet),
              ),
              activeIcon: _NavIcon(
                icon: isVerifier
                    ? Icons.verified_user
                    : Icons.account_balance_wallet,
                showDot: repo.unseenTabs.contains(WalletRepository.tabWallet),
              ),
              label: isVerifier ? 'Verified' : 'Wallet',
            ),
            BottomNavigationBarItem(
              icon: _NavIcon(
                icon: Icons.hub_outlined,
                showDot:
                    repo.unseenTabs.contains(WalletRepository.tabConnections),
              ),
              activeIcon: _NavIcon(
                icon: Icons.hub,
                showDot:
                    repo.unseenTabs.contains(WalletRepository.tabConnections),
              ),
              label: 'Network',
            ),
            const BottomNavigationBarItem(
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

/// Small yellow dot overlaid on a nav icon when its tab has unseen activity.
class _NavIcon extends StatelessWidget {
  final IconData icon;
  final bool showDot;

  const _NavIcon({required this.icon, required this.showDot});

  @override
  Widget build(BuildContext context) {
    return Badge(
      isLabelVisible: showDot,
      backgroundColor: AppColors.warning,
      smallSize: 9,
      child: Icon(icon),
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
