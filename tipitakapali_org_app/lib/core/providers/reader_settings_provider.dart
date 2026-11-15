import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../utils/pali_script_converter.dart';

enum ReaderThemePreset {
  classic('classic', 'Classic', Color(0xFFF0EEE5), Color(0xFFE8E4D8), Color(0xFF141413), Color(0xFF5A5248), Color(0xFFD6CEC0), false),
  white('white', 'White', Color(0xFFFDFDFC), Color(0xFFF4F3EF), Color(0xFF1F2328), Color(0xFF57606A), Color(0xFFE2E0D5), false),
  sepia('sepia', 'Warm Sepia', Color(0xFFFBF0D9), Color(0xFFF3E4C6), Color(0xFF433422), Color(0xFF70583F), Color(0xFFDFCD9F), false),
  dark('dark', 'Dark Charcoal', Color(0xFF1E1F20), Color(0xFF28292B), Color(0xFFE4E6EB), Color(0xFFB0B3B8), Color(0xFF3A3B3C), true),
  dusk('dusk', 'Dusk', Color(0xFF282A36), Color(0xFF313444), Color(0xFFF8F8F2), Color(0xFFA9B1D6), Color(0xFF44475A), true),
  oled('oled', 'OLED Black', Color(0xFF000000), Color(0xFF111214), Color(0xFFF0F0F0), Color(0xFFA0A0A0), Color(0xFF242424), true);

  final String id;
  final String label;
  final Color background;
  final Color secondaryBackground;
  final Color textColor;
  final Color mutedTextColor;
  final Color borderColor;
  final bool isDark;

  const ReaderThemePreset(
    this.id,
    this.label,
    this.background,
    this.secondaryBackground,
    this.textColor,
    this.mutedTextColor,
    this.borderColor,
    this.isDark,
  );

  static ReaderThemePreset fromId(String? id) {
    for (final t in values) {
      if (t.id == id) return t;
    }
    return ReaderThemePreset.classic;
  }
}

enum AccentPreset {
  burgundy('burgundy', 'Burgundy', Color(0xFF8B2500)),
  saffron('saffron', 'Saffron Gold', Color(0xFFB26A00)),
  emerald('emerald', 'Forest Emerald', Color(0xFF1B6E4A)),
  indigo('indigo', 'Royal Indigo', Color(0xFF304FFE)),
  slate('slate', 'Deep Slate', Color(0xFF455A64));

  final String id;
  final String label;
  final Color color;

  const AccentPreset(this.id, this.label, this.color);

  static AccentPreset fromId(String? id) {
    for (final a in values) {
      if (a.id == id) return a;
    }
    return AccentPreset.burgundy;
  }
}

enum DictLookupTrigger {
  single('single', 'Single Click / Tap'),
  doubleTap('double', 'Double Click / Tap'),
  off('off', 'Off');

  final String id;
  final String label;

  const DictLookupTrigger(this.id, this.label);

  static DictLookupTrigger fromId(String? id) {
    for (final v in values) {
      if (v.id == id) return v;
    }
    return DictLookupTrigger.single;
  }
}

enum ReaderDisplayMode {
  stacked('stack', 'Stacked'),
  sideBySide('side', 'Side by Side');

  final String id;
  final String label;

  const ReaderDisplayMode(this.id, this.label);

  static ReaderDisplayMode fromId(String? id) {
    for (final m in values) {
      if (m.id == id) return m;
    }
    return ReaderDisplayMode.stacked;
  }
}

class ReaderSettings {
  final ReaderThemePreset themePreset;
  final AccentPreset accentPreset;
  final PaliScript paliScript;
  final DictLookupTrigger dictLookupTrigger;
  final ReaderDisplayMode displayMode;
  final double fontSize;
  final double lineHeight;
  final bool justifyText;
  final bool showPali;
  final bool sentenceMode;
  final bool showPageBreaks;
  final bool showParaNumbers;
  final bool showFootnotes;
  final String defaultEditionPage;
  final List<String> enabledTranslations;

  const ReaderSettings({
    this.themePreset = ReaderThemePreset.classic,
    this.accentPreset = AccentPreset.burgundy,
    this.paliScript = PaliScript.roman,
    this.dictLookupTrigger = DictLookupTrigger.single,
    this.displayMode = ReaderDisplayMode.stacked,
    this.fontSize = 19.0,
    this.lineHeight = 1.75,
    this.justifyText = false,
    this.showPali = true,
    this.sentenceMode = false,
    this.showPageBreaks = false,
    this.showParaNumbers = true,
    this.showFootnotes = true,
    this.defaultEditionPage = 'M',
    this.enabledTranslations = const [],
  });

  ReaderSettings copyWith({
    ReaderThemePreset? themePreset,
    AccentPreset? accentPreset,
    PaliScript? paliScript,
    DictLookupTrigger? dictLookupTrigger,
    ReaderDisplayMode? displayMode,
    double? fontSize,
    double? lineHeight,
    bool? justifyText,
    bool? showPali,
    bool? sentenceMode,
    bool? showPageBreaks,
    bool? showParaNumbers,
    bool? showFootnotes,
    String? defaultEditionPage,
    List<String>? enabledTranslations,
  }) {
    return ReaderSettings(
      themePreset: themePreset ?? this.themePreset,
      accentPreset: accentPreset ?? this.accentPreset,
      paliScript: paliScript ?? this.paliScript,
      dictLookupTrigger: dictLookupTrigger ?? this.dictLookupTrigger,
      displayMode: displayMode ?? this.displayMode,
      fontSize: fontSize ?? this.fontSize,
      lineHeight: lineHeight ?? this.lineHeight,
      justifyText: justifyText ?? this.justifyText,
      showPali: showPali ?? this.showPali,
      sentenceMode: sentenceMode ?? this.sentenceMode,
      showPageBreaks: showPageBreaks ?? this.showPageBreaks,
      showParaNumbers: showParaNumbers ?? this.showParaNumbers,
      showFootnotes: showFootnotes ?? this.showFootnotes,
      defaultEditionPage: defaultEditionPage ?? this.defaultEditionPage,
      enabledTranslations: enabledTranslations ?? this.enabledTranslations,
    );
  }

  Map<String, dynamic> toJson() => {
    'themePreset': themePreset.id,
    'accentPreset': accentPreset.id,
    'paliScript': paliScript.id,
    'dictLookupTrigger': dictLookupTrigger.id,
    'displayMode': displayMode.id,
    'fontSize': fontSize,
    'lineHeight': lineHeight,
    'justifyText': justifyText,
    'showPali': showPali,
    'sentenceMode': sentenceMode,
    'showPageBreaks': showPageBreaks,
    'showParaNumbers': showParaNumbers,
    'showFootnotes': showFootnotes,
    'defaultEditionPage': defaultEditionPage,
    'enabledTranslations': enabledTranslations,
  };

  factory ReaderSettings.fromJson(Map<String, dynamic> json) {
    return ReaderSettings(
      themePreset: ReaderThemePreset.fromId(json['themePreset']?.toString()),
      accentPreset: AccentPreset.fromId(json['accentPreset']?.toString()),
      paliScript: PaliScript.fromId(json['paliScript']?.toString()),
      dictLookupTrigger:
          DictLookupTrigger.fromId(json['dictLookupTrigger']?.toString()),
      displayMode: ReaderDisplayMode.fromId(json['displayMode']?.toString()),
      fontSize: ((json['fontSize'] as num?)?.toDouble() ?? 19.0).clamp(14.0, 32.0),
      lineHeight:
          ((json['lineHeight'] as num?)?.toDouble() ?? 1.75).clamp(1.25, 2.4),
      justifyText: json['justifyText'] as bool? ?? false,
      showPali: json['showPali'] as bool? ?? true,
      sentenceMode: json['sentenceMode'] as bool? ?? false,
      showPageBreaks: json['showPageBreaks'] as bool? ?? false,
      showParaNumbers: json['showParaNumbers'] as bool? ?? true,
      showFootnotes: json['showFootnotes'] as bool? ?? true,
      defaultEditionPage: json['defaultEditionPage']?.toString() ?? 'M',
      enabledTranslations: (json['enabledTranslations'] as List?)
              ?.map((e) => e.toString())
              .toList(growable: false) ??
          const [],
    );
  }
}

final readerSettingsProvider =
    NotifierProvider<ReaderSettingsController, ReaderSettings>(
      ReaderSettingsController.new,
    );

class ReaderSettingsController extends Notifier<ReaderSettings> {
  static const _prefKey = 'tipitaka_reader_settings_v1';
  bool _loaded = false;

  @override
  ReaderSettings build() {
    if (!_loaded) {
      _loaded = true;
      Future.microtask(_load);
    }
    return const ReaderSettings();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefKey);
      if (raw != null && raw.isNotEmpty) {
        final map = jsonDecode(raw);
        if (map is Map<String, dynamic>) {
          state = ReaderSettings.fromJson(map);
        }
      }
    } catch (_) {}
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, jsonEncode(state.toJson()));
    } catch (_) {}
  }

  void update(ReaderSettings Function(ReaderSettings current) fn) {
    state = fn(state);
    _save();
  }

  void toggleTranslationLang(String langCode) {
    final next = List<String>.from(state.enabledTranslations);
    if (next.contains(langCode)) {
      next.remove(langCode);
    } else {
      next.add(langCode);
    }
    update((s) => s.copyWith(enabledTranslations: next));
  }

  void ensureTranslationInitialized(List<String> installedLangs, String preferred) {
    if (installedLangs.isEmpty) return;
    if (state.enabledTranslations.any(installedLangs.contains)) return;
    final pick = installedLangs.contains(preferred)
        ? preferred
        : installedLangs.first;
    update((s) => s.copyWith(enabledTranslations: [pick]));
  }

  void resetDefaults() {
    state = const ReaderSettings();
    _save();
  }
}
