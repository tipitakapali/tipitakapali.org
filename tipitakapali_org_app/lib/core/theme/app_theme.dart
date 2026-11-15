import 'package:flutter/material.dart';

/// Warm "Digital Manuscript" palette matching epitaka_app's light/dark theme.
class AppPalette {
  AppPalette._();

  static const Color lightPrimary = Color(0xFF8F4900);
  static const Color lightOnPrimary = Color(0xFFFFFFFF);
  static const Color lightPrimaryContainer = Color(0xFFFFDCC5);
  static const Color lightOnPrimaryContainer = Color(0xFF4F2600);
  static const Color lightSecondary = Color(0xFF994532);
  static const Color lightSurface = Color(0xFFFBF7F0);
  static const Color lightOnSurface = Color(0xFF221A14);
  static const Color lightOnSurfaceVariant = Color(0xFF544338);
  static const Color lightSurfaceContainer = Color(0xFFFBEBE1);
  static const Color lightSurfaceContainerHighest = Color(0xFFF0DFD6);
  static const Color lightOutlineVariant = Color(0xFFC8AD99);

  static const Color darkPrimary = Color(0xFFFFB781);
  static const Color darkOnPrimary = Color(0xFF4F2600);
  static const Color darkPrimaryContainer = Color(0xFF703800);
  static const Color darkOnPrimaryContainer = Color(0xFFFFDCC5);
  static const Color darkSecondary = Color(0xFFFFB4A3);
  static const Color darkSurface = Color(0xFF1A120C);
  static const Color darkOnSurface = Color(0xFFF0DFD6);
  static const Color darkOnSurfaceVariant = Color(0xFFDAC2B3);
  static const Color darkSurfaceContainer = Color(0xFF271E18);
  static const Color darkSurfaceContainerHighest = Color(0xFF3D332C);
  static const Color darkOutlineVariant = Color(0xFF5F5043);

  static const Color successGreen = Color(0xFF2E7D32);
}

ThemeData buildLightTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppPalette.lightPrimary,
    onPrimary: AppPalette.lightOnPrimary,
    primaryContainer: AppPalette.lightPrimaryContainer,
    onPrimaryContainer: AppPalette.lightOnPrimaryContainer,
    secondary: AppPalette.lightSecondary,
    onSecondary: Colors.white,
    secondaryContainer: Color(0xFFFFDAD2),
    onSecondaryContainer: Color(0xFF5F1A0B),
    tertiary: Color(0xFF006387),
    onTertiary: Colors.white,
    error: Color(0xFFBA1A1A),
    onError: Colors.white,
    errorContainer: Color(0xFFFFDAD6),
    onErrorContainer: Color(0xFF93000A),
    surface: AppPalette.lightSurface,
    onSurface: AppPalette.lightOnSurface,
    onSurfaceVariant: AppPalette.lightOnSurfaceVariant,
    surfaceContainer: AppPalette.lightSurfaceContainer,
    surfaceContainerHighest: AppPalette.lightSurfaceContainerHighest,
    outline: Color(0xFF796656),
    outlineVariant: AppPalette.lightOutlineVariant,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    cardTheme: CardThemeData(
      color: scheme.surfaceContainerHighest,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
    ),
  );
}

ThemeData buildDarkTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: AppPalette.darkPrimary,
    onPrimary: AppPalette.darkOnPrimary,
    primaryContainer: AppPalette.darkPrimaryContainer,
    onPrimaryContainer: AppPalette.darkOnPrimaryContainer,
    secondary: AppPalette.darkSecondary,
    onSecondary: Color(0xFF5F1A0B),
    secondaryContainer: Color(0xFF7A2E1D),
    onSecondaryContainer: Color(0xFFFFDAD2),
    tertiary: Color(0xFF7CD0FF),
    onTertiary: Color(0xFF00344A),
    error: Color(0xFFFFB4AB),
    onError: Color(0xFF690005),
    errorContainer: Color(0xFF93000A),
    onErrorContainer: Color(0xFFFFDAD6),
    surface: AppPalette.darkSurface,
    onSurface: AppPalette.darkOnSurface,
    onSurfaceVariant: AppPalette.darkOnSurfaceVariant,
    surfaceContainer: AppPalette.darkSurfaceContainer,
    surfaceContainerHighest: AppPalette.darkSurfaceContainerHighest,
    outline: Color(0xFFB59D8C),
    outlineVariant: AppPalette.darkOutlineVariant,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    cardTheme: CardThemeData(
      color: scheme.surfaceContainerHighest,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.7)),
      ),
    ),
  );
}
