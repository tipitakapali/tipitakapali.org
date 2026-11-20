import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Persists WebView `localStorage` entries on native disk so user choices
/// (`tipitaka_advanced_settings_v7`, tabs, bookmarks, history, etc.) survive
/// app termination and localhost port changes across all platforms —
/// especially macOS and iOS where `WKWebView` flushes `localStorage` lazily.
class WebLocalStorageStore {
  static const String storageFileName = 'web_local_storage.json';

  /// Huge regenerable corpus caches already served in <1ms by local SQLite;
  /// keeping them out of `web_local_storage.json` shrinks snapshots from
  /// ~500 KB to a few KB and eliminates WebView boot/scroll serialization lag.
  static bool isTransientCacheKey(String key) =>
      key.startsWith('tipitaka_tree_cache_') ||
      key.startsWith('tipitaka_books_cache_');

  final Directory? explicitDirectory;
  final Future<Directory> Function()? resolveDirectory;

  /// Unique per-instance launch token used with `window.name` so in-session
  /// page reloads preserve live in-memory `localStorage` (e.g. after settings
  /// reset) while fresh app launches restore the persisted snapshot.
  final String bootToken;

  final Map<String, String> _entries = <String, String>{};
  String? _filePath;
  bool _loaded = false;
  Future<void>? _loadFuture;
  Future<void> _writeChain = Future<void>.value();

  WebLocalStorageStore({
    this.explicitDirectory,
    this.resolveDirectory,
    String? bootToken,
  }) : bootToken =
           bootToken ?? DateTime.now().microsecondsSinceEpoch.toString();

  bool get isLoaded => _loaded;

  Map<String, String> get entries => UnmodifiableMapView(_entries);

  Future<void> ensureLoaded() {
    if (_loaded) return Future<void>.value();
    return _loadFuture ??= _loadInternal();
  }

  Future<void> _loadInternal() async {
    try {
      final path = await _resolveFilePath();
      if (path != null) {
        final file = File(path);
        if (file.existsSync()) {
          final raw = await file.readAsString();
          if (raw.trim().isNotEmpty) {
            final decoded = jsonDecode(raw);
            if (decoded is Map) {
              _entries.clear();
              decoded.forEach((key, value) {
                if (key == null || value == null) return;
                final k = key.toString();
                if (isTransientCacheKey(k)) return;
                _entries[k] = value.toString();
              });
            }
          }
        }
      }
    } catch (e, st) {
      debugPrint('WebLocalStorageStore load skipped/recovered: $e\n$st');
    } finally {
      _loaded = true;
    }
  }

  Future<String?> _resolveFilePath() async {
    if (_filePath != null) return _filePath;
    Directory? dir = explicitDirectory;
    if (dir == null && resolveDirectory != null) {
      dir = await resolveDirectory!();
    }
    if (dir == null) {
      try {
        dir = await getApplicationSupportDirectory();
      } on MissingPluginException {
        return null;
      } on UnimplementedError {
        return null;
      }
    }
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    _filePath = p.join(dir.path, storageFileName);
    return _filePath;
  }

  /// Applies a bridge operation sent from the WebView (`set`, `remove`,
  /// `clear`, `batch`, `mergeMissing`, `replaceAll`) and flushes synchronously
  /// to disk so rapid app termination (e.g. `Cmd+Q`) cannot drop edits.
  Future<bool> applyOperation(dynamic payload) async {
    await ensureLoaded();
    if (payload is! Map) return false;
    final op = payload['op']?.toString();
    var changed = false;

    switch (op) {
      case 'set':
        changed = _applySet(payload['key'], payload['value']);
        break;
      case 'remove':
        changed = _applyRemove(payload['key']);
        break;
      case 'clear':
        changed = _applyClear();
        break;
      case 'batch':
        final ops = payload['ops'];
        if (ops is List) {
          for (final item in ops) {
            if (item is! Map) continue;
            switch (item['op']?.toString()) {
              case 'set':
                if (_applySet(item['key'], item['value'])) changed = true;
                break;
              case 'remove':
                if (_applyRemove(item['key'])) changed = true;
                break;
              case 'clear':
                if (_applyClear()) changed = true;
                break;
            }
          }
        }
        break;
      case 'mergeMissing':
        final rawEntries = payload['entries'];
        if (rawEntries is Map) {
          rawEntries.forEach((k, v) {
            if (k == null || v == null) return;
            final key = k.toString();
            if (isTransientCacheKey(key)) return;
            if (!_entries.containsKey(key)) {
              _entries[key] = v.toString();
              changed = true;
            }
          });
        }
        break;
      case 'replaceAll':
        final rawEntries = payload['entries'];
        if (rawEntries is Map) {
          final next = <String, String>{};
          rawEntries.forEach((k, v) {
            if (k == null || v == null) return;
            final key = k.toString();
            if (isTransientCacheKey(key)) return;
            next[key] = v.toString();
          });
          if (!mapEquals(_entries, next)) {
            _entries
              ..clear()
              ..addAll(next);
            changed = true;
          }
        }
        break;
    }

    if (changed) {
      await _persistAsync();
    }
    return changed;
  }

  static const String advancedSettingsKey = 'tipitaka_advanced_settings_v7';

  /// Marks [settingsKey] (e.g. `'vietnamese'`, `'english'`) enabled in
  /// `tipitaka_advanced_settings_v7.translations` and persists immediately so
  /// newly downloaded languages stay remembered across restarts.
  Future<void> enableTranslationSetting(String settingsKey) async {
    final trimmed = settingsKey.trim();
    if (trimmed.isEmpty) return;
    await ensureLoaded();

    Map<String, dynamic> parsed = <String, dynamic>{};
    final raw = _entries[advancedSettingsKey];
    if (raw != null && raw.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          parsed = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {}
    }

    final rawTranslations = parsed['translations'];
    final translations = rawTranslations is Map
        ? Map<String, dynamic>.from(rawTranslations)
        : <String, dynamic>{};
    if (!translations.containsKey('pali')) {
      translations['pali'] = true;
    }
    translations[trimmed] = true;
    parsed['translations'] = translations;

    if (_applySet(advancedSettingsKey, jsonEncode(parsed))) {
      await _persistAsync();
    }
  }

  /// Marks [settingsKey] (e.g. `'vietnamese'`, `'english'`) disabled in
  /// `tipitaka_advanced_settings_v7.translations` and persists immediately.
  Future<void> disableTranslationSetting(String settingsKey) async {
    final trimmed = settingsKey.trim();
    if (trimmed.isEmpty || trimmed == 'pali') return;
    await ensureLoaded();

    final raw = _entries[advancedSettingsKey];
    if (raw == null || raw.trim().isEmpty) return;

    Map<String, dynamic> parsed = <String, dynamic>{};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        parsed = Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      return;
    }

    final rawTranslations = parsed['translations'];
    final translations = rawTranslations is Map
        ? Map<String, dynamic>.from(rawTranslations)
        : <String, dynamic>{};
    translations[trimmed] = false;
    final hasAnyEnabled = translations.values.any((v) => v == true);
    if (!hasAnyEnabled) {
      translations['pali'] = true;
    }
    parsed['translations'] = translations;

    if (_applySet(advancedSettingsKey, jsonEncode(parsed))) {
      await _persistAsync();
    }
  }

  bool _applySet(dynamic rawKey, dynamic rawValue) {
    if (rawKey == null || rawValue == null) return false;
    final key = rawKey.toString();
    if (isTransientCacheKey(key)) return false;
    final value = rawValue.toString();
    if (_entries[key] == value) return false;
    _entries[key] = value;
    return true;
  }

  bool _applyRemove(dynamic rawKey) {
    if (rawKey == null) return false;
    return _entries.remove(rawKey.toString()) != null;
  }

  bool _applyClear() {
    if (_entries.isEmpty) return false;
    _entries.clear();
    return true;
  }

  /// Serialized non-blocking atomic disk write so scroll-settled `localStorage`
  /// updates never stall the Flutter UI thread on synchronous `fsync`.
  Future<void> _persistAsync() {
    final path = _filePath;
    if (path == null) return Future<void>.value();
    final encodedSnapshot = jsonEncode(_entries);
    _writeChain = _writeChain.catchError((_) {}).then((_) async {
      try {
        final file = File(path);
        if (!file.parent.existsSync()) {
          await file.parent.create(recursive: true);
        }
        final tmp = File('$path.tmp');
        await tmp.writeAsString(encodedSnapshot, flush: false);
        await tmp.rename(path);
      } catch (e, st) {
        debugPrint('WebLocalStorageStore persist failed: $e\n$st');
      }
    });
    return _writeChain;
  }

  /// Atomically writes the current entries map to disk with `flush: true`.
  void persistSync() {
    final path = _filePath;
    if (path == null) return;
    try {
      final file = File(path);
      if (!file.parent.existsSync()) {
        file.parent.createSync(recursive: true);
      }
      final tmp = File('$path.tmp');
      tmp.writeAsStringSync(jsonEncode(_entries), flush: true);
      tmp.renameSync(path);
    } catch (e, st) {
      debugPrint('WebLocalStorageStore persist failed: $e\n$st');
    }
  }
}

final webLocalStorageStoreProvider = Provider<WebLocalStorageStore>((ref) {
  return WebLocalStorageStore();
});
