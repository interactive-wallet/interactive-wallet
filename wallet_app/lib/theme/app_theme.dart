import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  // Semantic colors — same in both themes
  static const primary = Color(0xFF3B82F6);
  static const primaryDark = Color(0xFF2563EB);
  static const success = Color(0xFF22C55E);
  static const error = Color(0xFFEF4444);
  static const warning = Color(0xFFF59E0B);
  static const purple = Color(0xFFA855F7);

  static Color messageTypeColor(String type) {
    switch (type) {
      case 'credentialOffer':
        return success;
      case 'proofRequest':
        return warning;
      case 'connectionInvite':
        return primary;
      case 'trustPing':
        return purple;
      case 'problemReport':
        return error;
      default:
        return const Color(0xFF9CA3AF);
    }
  }
}

class WalletColors extends ThemeExtension<WalletColors> {
  final Color background;
  final Color surface;
  final Color card;
  final Color cardLight;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color border;
  final Color borderLight;

  const WalletColors({
    required this.background,
    required this.surface,
    required this.card,
    required this.cardLight,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.border,
    required this.borderLight,
  });

  static const dark = WalletColors(
    background: Color(0xFF080C18),
    surface: Color(0xFF0D1226),
    card: Color(0xFF111827),
    cardLight: Color(0xFF1A2235),
    textPrimary: Color(0xFFFFFFFF),
    textSecondary: Color(0xFF9CA3AF),
    textTertiary: Color(0xFF6B7280),
    border: Color(0xFF1F2937),
    borderLight: Color(0xFF374151),
  );

  static const light = WalletColors(
    background: Color(0xFFF0F4FF),
    surface: Color(0xFFFFFFFF),
    card: Color(0xFFFFFFFF),
    cardLight: Color(0xFFF1F5F9),
    textPrimary: Color(0xFF0F172A),
    textSecondary: Color(0xFF475569),
    textTertiary: Color(0xFF94A3B8),
    border: Color(0xFFE2E8F0),
    borderLight: Color(0xFFCBD5E1),
  );

  @override
  WalletColors copyWith({
    Color? background,
    Color? surface,
    Color? card,
    Color? cardLight,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? border,
    Color? borderLight,
  }) =>
      WalletColors(
        background: background ?? this.background,
        surface: surface ?? this.surface,
        card: card ?? this.card,
        cardLight: cardLight ?? this.cardLight,
        textPrimary: textPrimary ?? this.textPrimary,
        textSecondary: textSecondary ?? this.textSecondary,
        textTertiary: textTertiary ?? this.textTertiary,
        border: border ?? this.border,
        borderLight: borderLight ?? this.borderLight,
      );

  @override
  WalletColors lerp(ThemeExtension<WalletColors>? other, double t) {
    if (other is! WalletColors) return this;
    return WalletColors(
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      card: Color.lerp(card, other.card, t)!,
      cardLight: Color.lerp(cardLight, other.cardLight, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderLight: Color.lerp(borderLight, other.borderLight, t)!,
    );
  }
}

extension BuildContextWalletColors on BuildContext {
  WalletColors get wc => Theme.of(this).extension<WalletColors>()!;
}

class AppTheme {
  AppTheme._();

  static ThemeData get darkTheme => _build(WalletColors.dark, Brightness.dark);
  static ThemeData get lightTheme => _build(WalletColors.light, Brightness.light);

  static ThemeData _build(WalletColors wc, Brightness brightness) => ThemeData(
        useMaterial3: true,
        brightness: brightness,
        scaffoldBackgroundColor: wc.background,
        extensions: [wc],
        colorScheme: ColorScheme(
          brightness: brightness,
          primary: AppColors.primary,
          onPrimary: Colors.white,
          secondary: AppColors.success,
          onSecondary: Colors.white,
          surface: wc.surface,
          onSurface: wc.textPrimary,
          error: AppColors.error,
          onError: Colors.white,
        ),
        appBarTheme: AppBarTheme(
          backgroundColor: wc.background,
          elevation: 0,
          scrolledUnderElevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: wc.textPrimary,
            fontSize: 20,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
          ),
          iconTheme: IconThemeData(color: wc.textSecondary),
        ),
        bottomNavigationBarTheme: BottomNavigationBarThemeData(
          backgroundColor: wc.surface,
          selectedItemColor: AppColors.primary,
          unselectedItemColor: wc.textTertiary,
          type: BottomNavigationBarType.fixed,
          elevation: 0,
          selectedLabelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
          unselectedLabelStyle: const TextStyle(fontSize: 11),
        ),
        floatingActionButtonTheme: const FloatingActionButtonThemeData(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 4,
        ),
        dividerTheme: DividerThemeData(color: wc.border, thickness: 1),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: wc.background,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: wc.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: wc.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
          ),
          hintStyle: TextStyle(color: wc.textTertiary, fontSize: 14),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      );
}
