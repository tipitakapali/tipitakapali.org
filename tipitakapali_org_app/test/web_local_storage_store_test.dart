import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:tipitakapali_app/core/storage/web_local_storage_store.dart';
import 'package:tipitakapali_app/features/webview/tipitaka_webview_screen.dart';

void main() {
  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('tpo_ls_store_test_');
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  test(
    'WebLocalStorageStore persists settings across simulated quit and reopen',
    () async {
      final store1 = WebLocalStorageStore(
        explicitDirectory: tempDir,
        bootToken: 'boot-1',
      );
      await store1.ensureLoaded();
      expect(store1.entries, isEmpty);

      final settingsJson = jsonEncode({
        'paliScript': 'myanmar',
        'translationGranularity': 'sentence',
        'theme': 'sepia',
      });
      await store1.applyOperation({
        'op': 'set',
        'key': 'tipitaka_advanced_settings_v7',
        'value': settingsJson,
      });
      await store1.applyOperation({
        'op': 'set',
        'key': 'tpo_onboarding_seeded_lang_v2',
        'value': 'en',
      });

      final file = File(p.join(tempDir.path, WebLocalStorageStore.storageFileName));
      expect(file.existsSync(), isTrue);

      // Reopen a brand-new store instance pointing at the same directory.
      final store2 = WebLocalStorageStore(
        explicitDirectory: tempDir,
        bootToken: 'boot-2',
      );
      await store2.ensureLoaded();

      expect(
        store2.entries['tipitaka_advanced_settings_v7'],
        equals(settingsJson),
      );
      expect(store2.entries['tpo_onboarding_seeded_lang_v2'], equals('en'));
      final decoded = jsonDecode(
        store2.entries['tipitaka_advanced_settings_v7']!,
      ) as Map<String, dynamic>;
      expect(decoded['paliScript'], equals('myanmar'));
      expect(decoded['translationGranularity'], equals('sentence'));
    },
  );

  test(
    'WebLocalStorageStore handles batch, remove, clear, mergeMissing, and replaceAll',
    () async {
      final store = WebLocalStorageStore(explicitDirectory: tempDir);
      await store.ensureLoaded();

      await store.applyOperation({
        'op': 'batch',
        'ops': [
          {'op': 'set', 'key': 'a', 'value': '1'},
          {'op': 'set', 'key': 'b', 'value': '2'},
          {'op': 'remove', 'key': 'a'},
        ],
      });
      expect(store.entries, equals({'b': '2'}));

      // mergeMissing adds unknown keys without overwriting existing native keys.
      await store.applyOperation({
        'op': 'mergeMissing',
        'entries': {'b': 'stale', 'bookmarks': '[{"id":1}]'},
      });
      expect(store.entries, equals({'b': '2', 'bookmarks': '[{"id":1}]'}));

      // clear + set (e.g., reset settings keeping bookmarks)
      await store.applyOperation({'op': 'clear'});
      expect(store.entries, isEmpty);

      await store.applyOperation({
        'op': 'replaceAll',
        'entries': {'bookmarks': '[{"id":1}]'},
      });
      expect(store.entries, equals({'bookmarks': '[{"id":1}]'}));

      final reopened = WebLocalStorageStore(explicitDirectory: tempDir);
      await reopened.ensureLoaded();
      expect(reopened.entries, equals({'bookmarks': '[{"id":1}]'}));
    },
  );

  test('WebLocalStorageStore recovers cleanly from corrupt JSON on disk', () async {
    final file = File(p.join(tempDir.path, WebLocalStorageStore.storageFileName));
    await file.writeAsString('{corrupt json');

    final store = WebLocalStorageStore(explicitDirectory: tempDir);
    await store.ensureLoaded();
    expect(store.isLoaded, isTrue);
    expect(store.entries, isEmpty);
  });

  test('buildLocalStoragePersistenceScript encodes snapshot and hooks safely', () {
    final script = buildLocalStoragePersistenceScript(
      const {
        'tipitaka_advanced_settings_v7':
            '{"paliScript":"myanmar","translationGranularity":"sentence"}',
      },
      bootToken: 'token-123',
    );
    expect(script, contains('__tpoLsBoot=token-123'));
    expect(script, contains('tipitaka_advanced_settings_v7'));
    expect(script, contains('myanmar'));
    expect(script, contains('sentence'));
    expect(script, contains('window.Storage.prototype'));
    expect(script, contains('target === window.localStorage'));
    expect(script, contains('syncLocalStorage'));
  });

  test('WebLocalStorageStore.enableTranslationSetting preserves settings and persists across restarts', () async {
    final store = WebLocalStorageStore(explicitDirectory: tempDir);
    await store.applyOperation({
      'op': 'set',
      'key': WebLocalStorageStore.advancedSettingsKey,
      'value': jsonEncode({
        'paliScript': 'myanmar',
        'translationGranularity': 'sentence',
        'translations': {'pali': true, 'english': true},
      }),
    });

    await store.enableTranslationSetting('vietnamese');

    final reopened = WebLocalStorageStore(explicitDirectory: tempDir);
    await reopened.ensureLoaded();
    final saved = jsonDecode(
      reopened.entries[WebLocalStorageStore.advancedSettingsKey]!,
    ) as Map<String, dynamic>;
    expect(saved['paliScript'], equals('myanmar'));
    expect(saved['translationGranularity'], equals('sentence'));
    expect(saved['translations'], equals({
      'pali': true,
      'english': true,
      'vietnamese': true,
    }));
  });

  test('WebLocalStorageStore persists opened tabs, active tab, and scroll positions across restart', () async {
    final store1 = WebLocalStorageStore(explicitDirectory: tempDir, bootToken: 'b1');
    await store1.ensureLoaded();

    final savedTabs = jsonEncode([
      {
        'bookCode': 's0102m.mul',
        'title': 'Mahāvaggapāḷi',
        'nikaya': 'Dīghanikāyo',
        'currentChapterIdx': 8,
        'lastParaNum': '373',
        'viewMode': 'reader',
        'isTocView': false,
      },
      {
        'bookCode': 's0102a.att',
        'title': 'Mahāvagga-aṭṭhakathā',
        'currentChapterIdx': 4,
        'viewMode': 'reader',
        'isTocView': false,
      },
    ]);
    final savedScrolls = jsonEncode({'s0102m.mul': 1842.5, 's0102a.att': 420});

    await store1.applyOperation({
      'op': 'batch',
      'ops': [
        {'op': 'set', 'key': 'tipitaka_saved_tabs_v3', 'value': savedTabs},
        {'op': 'set', 'key': 'tipitaka_active_book_v3', 'value': 's0102a.att'},
        {'op': 'set', 'key': 'tipitaka_tab_scrolls_v3', 'value': savedScrolls},
      ],
    });

    final store2 = WebLocalStorageStore(explicitDirectory: tempDir, bootToken: 'b2');
    await store2.ensureLoaded();

    expect(store2.entries['tipitaka_saved_tabs_v3'], equals(savedTabs));
    expect(store2.entries['tipitaka_active_book_v3'], equals('s0102a.att'));
    expect(store2.entries['tipitaka_tab_scrolls_v3'], equals(savedScrolls));
  });

  test('disableTranslationSetting turns off deleted language while preserving pali and other active languages', () async {
    final store = WebLocalStorageStore(explicitDirectory: tempDir);
    await store.ensureLoaded();
    await store.applyOperation({
      'op': 'set',
      'key': WebLocalStorageStore.advancedSettingsKey,
      'value': jsonEncode({
        'translations': {'pali': false, 'vietnamese': true},
      }),
    });

    await store.disableTranslationSetting('vietnamese');

    final reopened = WebLocalStorageStore(explicitDirectory: tempDir);
    await reopened.ensureLoaded();
    final saved = jsonDecode(
      reopened.entries[WebLocalStorageStore.advancedSettingsKey]!,
    ) as Map<String, dynamic>;
    // Falls back to keeping Pali enabled if last active translation is deleted
    expect(saved['translations'], equals({
      'pali': true,
      'vietnamese': false,
    }));
  });
}
