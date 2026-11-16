import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/fts/fts_index_service.dart';
import 'package:tipitakapali_app/core/models/db_manifest.dart';
import 'package:tipitakapali_app/core/server/dpd_family_templates.dart';
import 'package:tipitakapali_app/core/server/tipitaka_local_server.dart';
import 'package:tipitakapali_app/core/server/tipitaka_web_api.dart';
import 'package:tipitakapali_app/core/services/github_release_service.dart';
import 'package:tipitakapali_app/core/storage/db_storage_service.dart';
import 'package:tipitakapali_app/core/utils/formatters.dart';
import 'package:tipitakapali_app/core/utils/pali_script_converter.dart';
import 'package:tipitakapali_app/features/downloads/download_controller.dart';
import 'package:tipitakapali_app/features/downloads/download_service.dart';
import 'package:tipitakapali_app/features/onboarding/onboarding_gate.dart';
import 'package:tipitakapali_app/features/onboarding/onboarding_screen.dart';
import 'package:tipitakapali_app/features/webview/tipitaka_webview_screen.dart';

Future<void> _pumpUntilFound(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 60; i++) {
    await tester.pump(const Duration(milliseconds: 50));
    if (finder.evaluate().isNotEmpty) {
      return;
    }
  }
  final container = ProviderScope.containerOf(
    tester.element(find.byType(OnboardingGate)),
  );
  final state = container.read(downloadControllerProvider);
  fail(
    'Timed out waiting for $finder. '
    'isInitializing=${state.isInitializing}, '
    'warning=${state.releaseWarning}, '
    'installed=${state.installedDbs.keys.toList()}',
  );
}

void _createSampleTipitakaDb(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute('''
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        nikaya TEXT,
        category TEXT,
        xml_filename TEXT NOT NULL,
        chapter_count INTEGER DEFAULT 0,
        meta_json TEXT
      );
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        chunk_name TEXT NOT NULL,
        anchor_id TEXT NOT NULL,
        para_index INTEGER DEFAULT 0,
        html TEXT
      );
      CREATE TABLE tree_nodes (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        parent_id INTEGER,
        node_type TEXT,
        book_code TEXT,
        chapter_index INTEGER,
        href TEXT
      );
      CREATE TABLE book_mat (
        book_code TEXT PRIMARY KEY,
        category TEXT,
        mula_code TEXT,
        mula_title TEXT,
        attha_code TEXT,
        attha_title TEXT,
        tika_code TEXT,
        tika_title TEXT
      );
      CREATE TABLE mat_chapter_map (
        source_book TEXT NOT NULL,
        source_chapter INTEGER NOT NULL,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_title TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_title TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_title TEXT,
        PRIMARY KEY (source_book, source_chapter)
      );
      CREATE TABLE book_toc (
        book_id INTEGER,
        book_code TEXT,
        item_index INTEGER,
        level INTEGER,
        type TEXT,
        rend TEXT,
        title TEXT,
        para_index INTEGER,
        para_num TEXT,
        anchor_id TEXT,
        chapter_index INTEGER
      );
      CREATE TABLE canon_paragraphs (
        global_id INTEGER PRIMARY KEY AUTOINCREMENT,
        guid TEXT UNIQUE NOT NULL,
        book_code TEXT NOT NULL,
        sub_book TEXT,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT,
        sutta_title TEXT,
        para_index INTEGER NOT NULL,
        para_num TEXT,
        para_first INTEGER,
        para_last INTEGER,
        rend TEXT,
        pali_text TEXT,
        word_count INTEGER,
        mula_guid TEXT,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_para TEXT,
        attha_guid TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_para TEXT,
        tika_guid TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_para TEXT,
        match_quality TEXT
      );
    ''');
    db.execute(
      "INSERT INTO books (code, title, nikaya, category, xml_filename, chapter_count) "
      "VALUES ('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', 'mūla', 's0101m.mul.xml', 1);",
    );
    db.execute(
      "INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html) "
      "VALUES (1, 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 'ch0', 'chap-0', 0, '');",
    );
    db.execute(
      "INSERT INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index) VALUES "
      "(1, 'Suttapiṭaka', NULL, 'category', NULL, NULL), "
      "(2, '1. Brahmajālasuttaṃ', 1, 'chapter', 's0101m.mul', 0);",
    );
    db.execute(
      "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, rend, pali_text) "
      "VALUES ('s0101m.mul:c0:n0:p5', 's0101m.mul', 0, 5, 'bodytext', 'Evaṃ me sutaṃ – ekaṃ samayaṃ bhagavā.');",
    );
  } finally {
    db.close();
  }
}

void _seedRemainingCompulsoryDbs(String dirPath) {
  const filenames = [
    'dpd_tipitakapali.db',
    'dpd_splitter_tipitakapali.db',
    'dpd_inflection_tipitakapali.db',
    'dpd_synonyms_tipitakapali.db',
    'ptsped2015ed_tipitakapali.db',
    'abhidhan_tipitakapali.db',
    'ap_bh_mw_sanskrit.db',
    'palisinh.db',
  ];
  for (final name in filenames) {
    final db = sqlite3.open(p.join(dirPath, name));
    try {
      db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY);');
      db.execute('CREATE TABLE IF NOT EXISTS misc (key TEXT, val TEXT);');
      db.execute(
        'CREATE TABLE IF NOT EXISTS synonyms (headword TEXT, body TEXT);',
      );
      db.execute('CREATE TABLE IF NOT EXISTS zmisc (key TEXT, val TEXT);');
    } finally {
      db.close();
    }
  }
}

void _createSampleFtsDb(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute(
      'CREATE VIRTUAL TABLE paragraphs_fts USING fts5('
      'book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content);',
    );
    db.execute(
      "INSERT INTO paragraphs_fts(book_code, book_title, nikaya, para_num, para_index, para_rend, content) "
      "VALUES ('s0101m.mul', 'Dīgha Nikāya', 'Dīgha', '1', 0, 'bodytext', 'Namo tassa bhagavato');",
    );
  } finally {
    db.close();
  }
}

class _FakeLocalServer extends TipitakaLocalServer {
  bool _running = false;
  final Uri _uri = Uri.parse('http://127.0.0.1:8899/');

  _FakeLocalServer({required super.api, super.explicitWebRootDir});

  @override
  bool get isRunning => _running;

  @override
  Uri? get baseUri => _running ? _uri : null;

  @override
  Future<Uri> ensureStarted() async {
    _running = true;
    return _uri;
  }

  @override
  Future<void> stop() async {
    _running = false;
  }
}

void main() {
  testWidgets(
    'OnboardingGate shows epitaka-style wizard when tipitaka.db is missing',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('tp_gate_empty_');
      addTearDown(() => tmp.deleteSync(recursive: true));
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();

      final mockClient = MockClient(
        (_) async => http.Response('{"tag_name":"db","assets":[]}', 200),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: mockClient,
                assetLoader: (_) async => bundledRaw,
              ),
            ),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.text('Welcome to TipitakaPali.org'));

      expect(find.text('Welcome to TipitakaPali.org'), findsOneWidget);
      expect(find.textContaining('Synced:'), findsNothing);
      expect(find.text('Required Databases'), findsOneWidget);
      expect(find.text('Tipiṭaka Pāḷi Text (CST)'), findsOneWidget);
      expect(find.text('Pāḷi Dictionaries (All)'), findsOneWidget);
      // Individual dictionary internals must not clutter onboarding.
      expect(find.text('Digital Pali Dictionary (DPD)'), findsNothing);
      expect(find.textContaining('Total to download'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('You can always download it later in the language menu.'),
        60,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Optional AI Translation'), findsOneWidget);
      expect(
        find.text('You can always download it later in the language menu.'),
        findsOneWidget,
      );

      await tester.scrollUntilVisible(
        find.text('AI Translation Language'),
        60,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('AI Translation Language'), findsOneWidget);
      expect(find.textContaining('AI Translation Note:'), findsOneWidget);
      // Default selection is English ('en').
      expect(find.text('🇬🇧 English (English)'), findsOneWidget);
      expect(find.text('AI English Translation'), findsOneWidget);

      // In-App FTS index card, Browse all additional packs button, and
      // pre-built FTS DB downloads must not appear on onboarding.
      expect(find.text('In-App Full-Text Search Index (FTS5)'), findsNothing);
      expect(find.textContaining('additional packs'), findsNothing);
      expect(find.text('Pali Full-Text Search Index'), findsNothing);
      expect(find.textContaining('Manifest JSON URL'), findsNothing);

      final container = ProviderScope.containerOf(
        tester.element(find.byType(OnboardingGate)),
      );
      final state = container.read(downloadControllerProvider);
      expect(state.manifest, isNotNull);
      expect(state.manifest!.core['pali_sentences']?.compulsory, isFalse);
      for (final dict in state.manifest!.dictionaries.values) {
        expect(
          dict.compulsory,
          isTrue,
          reason: 'Dictionary ${dict.id} should be compulsory on onboarding',
        );
      }
      expect(state.selectedLanguageCode, DownloadController.defaultLanguageCode);
      expect(state.manifest!.languages['en']?.translationDb.compulsory, isFalse);
      expect(state.selectedOptionalIds.contains('translation_en'), isTrue);
      expect(
        state.selectedOptionalIds.any((id) => id.startsWith('fts_')),
        isFalse,
      );

      int calcPendingBytes(DownloadCenterState s) => s.manifest!.allCatalogAssets
          .where(
            (a) =>
                a.category != DbCategory.fts &&
                (a.compulsory || s.selectedOptionalIds.contains(a.id)) &&
                !s.installedDbs.containsKey(a.filename),
          )
          .fold<int>(0, (sum, a) => sum + a.estimatedDownloadBytes);

      final enSizeBytes =
          state.manifest!.languages['en']!.translationDb.estimatedDownloadBytes;
      final viSizeBytes =
          state.manifest!.languages['vi']!.translationDb.estimatedDownloadBytes;
      final enBytes = calcPendingBytes(state);
      final baseBytes = enBytes - enSizeBytes;
      expect(baseBytes, greaterThan(0));
      expect(find.textContaining('translation_en.db'), findsOneWidget);
      expect(
        find.textContaining('Download All (${formatBytes(enBytes)})'),
        findsOneWidget,
      );

      // Switch to Vietnamese via dropdown and verify total recalculates.
      await tester.ensureVisible(find.text('🇬🇧 English (English)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('🇬🇧 English (English)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('🇻🇳 Vietnamese (Tiếng Việt)').last);
      await tester.pumpAndSettle();

      final viState = container.read(downloadControllerProvider);
      final viBytes = calcPendingBytes(viState);
      expect(viState.selectedLanguageCode, 'vi');
      expect(viState.selectedOptionalIds.contains('translation_vi'), isTrue);
      expect(viState.selectedOptionalIds.contains('translation_en'), isFalse);
      expect(viBytes, baseBytes + viSizeBytes);
      expect(
        find.textContaining('Download All (${formatBytes(viBytes)})'),
        findsOneWidget,
      );

      // Switch to "None - Pāḷi text only" and verify total download drops to baseBytes.
      await tester.tap(find.text('🇻🇳 Vietnamese (Tiếng Việt)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('None - Pāḷi text only').last);
      await tester.pumpAndSettle();

      final noneState = container.read(downloadControllerProvider);
      final noneBytes = calcPendingBytes(noneState);
      expect(noneState.selectedLanguageCode, DownloadController.noLanguageCode);
      expect(
        noneState.selectedOptionalIds.any((id) => id.startsWith('translation_')),
        isFalse,
      );
      expect(noneBytes, baseBytes);
      expect(find.text('AI English Translation'), findsNothing);
      expect(
        find.textContaining('Download All (${formatBytes(noneBytes)})'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'OnboardingGate opens TipitakaWebViewScreen cleanly without floating DB button',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('tp_gate_webview_');
      final webRoot = Directory(p.join(tmp.path, 'web_root'))..createSync();
      File(
        p.join(webRoot.path, 'index.html'),
      ).writeAsStringSync('<html><body>tipitakapali.org offline</body></html>');
      addTearDown(() => tmp.deleteSync(recursive: true));

      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      _createSampleTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
      _seedRemainingCompulsoryDbs(tmp.path);
      _createSampleFtsDb(p.join(tmp.path, 'fts_tipitaka.db'));

      final server = _FakeLocalServer(
        explicitWebRootDir: webRoot,
        api: TipitakaWebApi(
          dbDirectoryPath: tmp.path,
          dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
        ),
      );

      final mockOfflineClient = MockClient((_) async => http.Response('', 404));
      Uri? loadedUri;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: mockOfflineClient,
                assetLoader: (_) async => bundledRaw,
              ),
            ),
            tipitakaLocalServerProvider.overrideWithValue(server),
            tipitakaWebViewBuilderProvider.overrideWithValue((context, uri) {
              loadedUri = uri;
              return Center(child: Text('WebView ready: $uri'));
            }),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.textContaining('WebView ready:'));
      expect(loadedUri, isNotNull);
      expect(loadedUri!.host, '127.0.0.1');
      expect(loadedUri!.port, greaterThan(0));

      // Floating database overlay button must not be shown over the reader.
      expect(find.byIcon(Icons.storage_rounded), findsNothing);
    },
  );

  test('WebView bridge script configures scroll auto-hide for top and bottom bars', () {
    expect(tipitakaWebBridgeScript, contains('tpo-auto-hide-style'));
    expect(tipitakaWebBridgeScript, contains('tpo-bars-hidden'));
    expect(tipitakaWebBridgeScript, contains('.app-header'));
    expect(tipitakaWebBridgeScript, contains('.book-tabs-bar'));
    expect(tipitakaWebBridgeScript, contains('.content-header'));
    expect(tipitakaWebBridgeScript, contains('footer.app-footer'));
    expect(tipitakaWebBridgeScript, contains('AUTO_HIDE_THRESHOLD'));
    expect(tipitakaWebBridgeScript, contains('syncAutoHideState'));
  });

  test('WebView bridge script enables downloaded translation immediately without reload', () {
    expect(tipitakaWebBridgeScript, contains('enableDownloadedLanguageImmediately'));
    expect(tipitakaWebBridgeScript, contains('I Understand & Enable'));
    expect(tipitakaWebBridgeScript, isNot(contains('window.location.reload')));
  });

  testWidgets(
    'LanguageDownloadDialog shows DB size together with AI translation notice before downloading',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('lang_dialog_test_');
      addTearDown(() => tmp.deleteSync(recursive: true));
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final mockClient = MockClient((_) async => http.Response('{}', 404));

      bool? dialogResult;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: mockClient,
                assetLoader: (_) async => bundledRaw,
              ),
            ),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: ElevatedButton(
                  onPressed: () async {
                    dialogResult = await showDialog<bool>(
                      context: context,
                      barrierDismissible: false,
                      builder: (_) => const LanguageDownloadDialog(
                        langCode: 'vi',
                        label: 'Tiếng Việt',
                      ),
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      // Shows DB size info together with the AI-Assisted Translation Notice.
      expect(find.text('Enable Tiếng Việt'), findsOneWidget);
      expect(find.textContaining('Download size:'), findsOneWidget);
      expect(find.textContaining('translation_vi.db'), findsOneWidget);
      expect(find.text('AI-Assisted Translation Notice'), findsOneWidget);
      expect(
        find.textContaining('AI-Assisted Translation Project'),
        findsOneWidget,
      );
      expect(find.text('Download & Enable'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(dialogResult, isFalse);
    },
  );

  testWidgets(
    'PaliSentencesDownloadDialog displays database size and can be cancelled',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('pali_sent_dialog_test_');
      addTearDown(() => tmp.deleteSync(recursive: true));
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final mockClient = MockClient((_) async => http.Response('{}', 404));

      bool? dialogResult;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: mockClient,
                assetLoader: (_) async => bundledRaw,
              ),
            ),
          ],
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: ElevatedButton(
                  onPressed: () async {
                    dialogResult = await showDialog<bool>(
                      context: context,
                      barrierDismissible: false,
                      builder: (_) => const PaliSentencesDownloadDialog(),
                    );
                  },
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(find.text('Enable Sentence-by-Sentence View'), findsOneWidget);
      expect(find.textContaining('Download size:'), findsOneWidget);
      expect(find.textContaining('pali_sentences.db'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(dialogResult, isFalse);
    },
  );

  test('tipitakaWebBridgeScript hooks sentence-level download flow and icon badges', () {
    expect(tipitakaWebBridgeScript, contains('hasPaliSentences'));
    expect(tipitakaWebBridgeScript, contains('has_pali_sentences'));
    expect(tipitakaWebBridgeScript, contains('tpoSentenceBtn'));
    expect(tipitakaWebBridgeScript, contains('downloadPaliSentences'));
    expect(tipitakaWebBridgeScript, contains('hadFailedPaliSentencesFetch'));
    expect(tipitakaWebBridgeScript, contains('DOWNLOAD_ICON_SVG'));
    expect(tipitakaWebBridgeScript, contains('<svg'));
    expect(tipitakaWebBridgeScript, isNot(contains("'Download'")));
    expect(tipitakaWebBridgeScript, contains('stripAndroidStoreBadges'));
    expect(tipitakaWebBridgeScript, contains('a[href*="play.google.com"]'));
  });

  testWidgets(
    'OnboardingGate checks online manifest on startup and notifies user when installed DB has an update',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      SharedPreferences.setMockInitialValues({
        'installed_asset_meta_tipitaka.db': jsonEncode({
          'version': 1,
          'updated': '2026-11-14',
        }),
      });
      final tmp = Directory.systemTemp.createTempSync('tp_gate_update_');
      final webRoot = Directory(p.join(tmp.path, 'web_root'))..createSync();
      File(
        p.join(webRoot.path, 'index.html'),
      ).writeAsStringSync('<html><body>tipitakapali.org offline</body></html>');
      addTearDown(() => tmp.deleteSync(recursive: true));

      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      _createSampleTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
      _seedRemainingCompulsoryDbs(tmp.path);
      _createSampleFtsDb(p.join(tmp.path, 'fts_tipitaka.db'));

      final updatedManifest = jsonDecode(bundledRaw) as Map<String, dynamic>;
      ((updatedManifest['core'] as Map<String, dynamic>)['tipitaka']
          as Map<String, dynamic>)['version'] = 2;
      ((updatedManifest['core'] as Map<String, dynamic>)['tipitaka']
          as Map<String, dynamic>)['updated'] = '2026-12-01';

      final mockClient = MockClient((request) async {
        if (request.url.toString() ==
            GitHubReleaseService.defaultRawManifestUrl) {
          return http.Response(
            jsonEncode(updatedManifest),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{"tag_name":"db","assets":[]}', 404);
      });

      final server = _FakeLocalServer(
        explicitWebRootDir: webRoot,
        api: TipitakaWebApi(
          dbDirectoryPath: tmp.path,
          dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: mockClient,
                assetLoader: (_) async => bundledRaw,
              ),
            ),
            tipitakaLocalServerProvider.overrideWithValue(server),
            tipitakaWebViewBuilderProvider.overrideWithValue((context, uri) {
              return Center(child: Text('WebView ready: $uri'));
            }),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.text('Database Updates Available'));
      expect(find.text('Database Updates Available'), findsOneWidget);
      expect(find.text('Tipitaka Canon & Chapters'), findsOneWidget);
      expect(find.text('Update Now'), findsOneWidget);
      expect(find.text('Later'), findsOneWidget);

      await tester.tap(find.text('Later'));
      await tester.pumpAndSettle();
      expect(find.text('Database Updates Available'), findsNothing);
      expect(find.textContaining('WebView ready:'), findsOneWidget);
    },
  );

  testWidgets(
    'OnboardingWizardScreen clears setup cards and displays live FTS percentage when indexing',
    (tester) async {
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final manifest = DatabaseManifest.fromJson(
        jsonDecode(bundledRaw) as Map<String, dynamic>,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            downloadControllerProvider.overrideWith(
              () => _StaticDownloadController(
                DownloadCenterState(
                  isInitializing: false,
                  manifest: manifest,
                  indexingMessage: 'Indexing Pāḷi Canon (64%)...',
                  indexingStatus: const FtsIndexingStatus(
                    taskLabel: 'Pāḷi Canon',
                    filename: 'fts_tipitaka.db',
                    stage: FtsBuildStage.indexing,
                    taskIndex: 1,
                    totalTasks: 2,
                    processedRows: 640,
                    totalRows: 1000,
                    taskProgress: 0.64,
                    overallProgress: 0.32,
                    detail: 'Indexing passages...',
                  ),
                ),
              ),
            ),
          ],
          child: MaterialApp(
            home: OnboardingWizardScreen(onCompleted: () {}),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 250));

      // All setup cards & sticky download bar are cleared during FTS indexing.
      expect(find.text('Welcome to TipitakaPali.org'), findsNothing);
      expect(find.text('Required Databases'), findsNothing);
      expect(find.text('Enter Library'), findsNothing);

      // Dedicated FTS progress UI & percentage are visible.
      expect(find.text('Building Full-Text Search Index'), findsOneWidget);
      expect(find.text('32%'), findsOneWidget);
      expect(find.text('Step 1 of 2 • Pāḷi Canon'), findsOneWidget);
      expect(find.text('Indexing passages...'), findsOneWidget);
      expect(find.text('640 / 1,000'), findsOneWidget);
      expect(find.text('Read Texts'), findsOneWidget);
      expect(find.text('Index Words'), findsOneWidget);
      expect(find.text('Optimize'), findsOneWidget);
      expect(find.text('STUDY TIP 1/4'), findsOneWidget);

      await tester.tap(find.text('Next tip'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('STUDY TIP 2/4'), findsOneWidget);
    },
  );

  test(
    'resolveInstalledOnboardingLanguage and buildOnboardingTranslationSeedScript enable chosen installed language once',
    () {
      InstalledDbInfo db(String filename) => InstalledDbInfo(
        filename: filename,
        path: '/tmp/$filename',
        sizeBytes: 1024,
        modifiedAt: DateTime(2026),
        validSqlite: true,
      );

      expect(
        resolveInstalledOnboardingLanguage(
          const DownloadCenterState(
            isInitializing: false,
            selectedLanguageCode: DownloadController.noLanguageCode,
          ),
        ),
        isNull,
      );

      expect(
        resolveInstalledOnboardingLanguage(
          const DownloadCenterState(
            isInitializing: false,
            selectedLanguageCode: 'en',
          ),
        ),
        isNull,
      );

      expect(
        resolveInstalledOnboardingLanguage(
          DownloadCenterState(
            isInitializing: false,
            selectedLanguageCode: 'en',
            installedDbs: {'translation_en.db': db('translation_en.db')},
          ),
        ),
        'en',
      );

      expect(
        resolveInstalledOnboardingLanguage(
          DownloadCenterState(
            isInitializing: false,
            selectedLanguageCode: 'my_nissaya',
            installedDbs: {
              'translation_my_nissaya.db': db('translation_my_nissaya.db'),
            },
          ),
        ),
        'my_nissaya',
      );

      expect(buildOnboardingTranslationSeedScript(null), isEmpty);
      expect(buildOnboardingTranslationSeedScript('unknown_code'), isEmpty);

      final enScript = buildOnboardingTranslationSeedScript('en');
      expect(enScript, contains('tipitaka_advanced_settings_v6'));
      expect(enScript, contains('tpo_onboarding_seeded_lang_v1'));
      expect(enScript, contains('"en"'));
      expect(enScript, contains('"english"'));

      final nissayaScript = buildOnboardingTranslationSeedScript('my_nissaya');
      expect(nissayaScript, contains('"my_nissaya"'));

      expect(PaliScript.lao.webId, equals('laos'));
      expect(PaliScript.fromId('laos'), equals(PaliScript.lao));

      final scriptOnlySeed = buildOnboardingTranslationSeedScript(
        null,
        paliScript: 'myanmar',
      );
      expect(scriptOnlySeed, contains('tpo_onboarding_seeded_script_v1'));
      expect(scriptOnlySeed, contains('"myanmar"'));
      expect(scriptOnlySeed, contains('parsed.paliScript = targetScript'));

      final combinedSeed = buildOnboardingTranslationSeedScript(
        'en',
        paliScript: 'laos',
      );
      expect(combinedSeed, contains('"english"'));
      expect(combinedSeed, contains('"laos"'));

      final explicitNoneSeed = buildOnboardingTranslationSeedScript('none');
      expect(explicitNoneSeed, contains('translations.english = false'));
    },
  );

  test(
    'DownloadController persists selected Pali Display Script across restarts',
    () async {
      final tmp = await Directory.systemTemp.createTemp('tpo_script_pref_');
      addTearDown(() async {
        if (tmp.existsSync()) await tmp.delete(recursive: true);
      });
      SharedPreferences.setMockInitialValues({});
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();

      ProviderContainer makeContainer() => ProviderContainer(
        overrides: [
          dbStorageServiceProvider.overrideWithValue(
            DbStorageService(overrideDirectory: tmp),
          ),
          gitHubReleaseServiceProvider.overrideWithValue(
            GitHubReleaseService(
              client: MockClient((_) async => http.Response('{}', 404)),
              assetLoader: (_) async => bundledRaw,
            ),
          ),
        ],
      );

      final container1 = makeContainer();
      addTearDown(container1.dispose);
      await container1
          .read(downloadControllerProvider.notifier)
          .initialize(fetchRemote: false);
      expect(
        container1.read(downloadControllerProvider).selectedPaliScript,
        equals('roman'),
      );

      await container1
          .read(downloadControllerProvider.notifier)
          .setPaliScript('myanmar');
      expect(
        container1.read(downloadControllerProvider).selectedPaliScript,
        equals('myanmar'),
      );

      final container2 = makeContainer();
      addTearDown(container2.dispose);
      await container2
          .read(downloadControllerProvider.notifier)
          .initialize(fetchRemote: false);
      expect(
        container2.read(downloadControllerProvider).selectedPaliScript,
        equals('myanmar'),
      );
    },
  );

  testWidgets(
    'OnboardingWizardScreen allows selecting Pali Display Script',
    (tester) async {
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final manifest = DatabaseManifest.fromJson(
        jsonDecode(bundledRaw) as Map<String, dynamic>,
      );
      SharedPreferences.setMockInitialValues({});
      final controller = _StaticDownloadController(
        DownloadCenterState(isInitializing: false, manifest: manifest),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [downloadControllerProvider.overrideWith(() => controller)],
          child: MaterialApp(home: OnboardingWizardScreen(onCompleted: () {})),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      final scriptDropdown = find.widgetWithText(
        DropdownButton<String>,
        'Roman (Roman)',
      );
      await tester.scrollUntilVisible(scriptDropdown, 200);
      expect(find.text('Pāḷi Display Script'), findsWidgets);
      expect(scriptDropdown, findsOneWidget);

      await tester.tap(scriptDropdown);
      await tester.pump(const Duration(milliseconds: 200));

      await tester.tap(find.text('Myanmar (ဗမာစာ)').last);
      await tester.pump(const Duration(milliseconds: 200));

      expect(controller.state.selectedPaliScript, equals('myanmar'));
      expect(
        find.widgetWithText(DropdownButton<String>, 'Myanmar (ဗမာစာ)'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'OnboardingWizardScreen shows CircularProgressIndicator on disabled Download button while downloading',
    (tester) async {
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final manifest = DatabaseManifest.fromJson(
        jsonDecode(bundledRaw) as Map<String, dynamic>,
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            downloadControllerProvider.overrideWith(
              () => _StaticDownloadController(
                DownloadCenterState(
                  isInitializing: false,
                  manifest: manifest,
                  transfers: const {
                    'tipitaka': DownloadProgress(
                      assetId: 'tipitaka',
                      filename: 'tipitaka.db',
                      phase: TransferPhase.downloading,
                      bytesReceived: 1024,
                      totalBytes: 4096,
                    ),
                  },
                ),
              ),
            ),
          ],
          child: MaterialApp(home: OnboardingWizardScreen(onCompleted: () {})),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.text('Downloading...'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    },
  );

  testWidgets(
    'OnboardingGate re-opens onboarding when interrupted or required DB/FTS is invalid',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      // Simulate user killing the app before onboarding completed, AND leaving
      // an empty/corrupt fts_tipitaka.db and a corrupt compulsory dictionary DB.
      SharedPreferences.setMockInitialValues({
        'onboarding_in_progress_v1': true,
        'onboarding_completed_v1': false,
      });
      final tmp = Directory.systemTemp.createTempSync('tp_gate_interrupted_');
      addTearDown(() => tmp.deleteSync(recursive: true));
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();

      _createSampleTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
      _seedRemainingCompulsoryDbs(tmp.path);
      // Corrupt one compulsory DB so startup prunes it.
      File(p.join(tmp.path, 'dpd_splitter_tipitakapali.db'))
          .writeAsBytesSync([0, 1, 2, 3]);
      // Unpopulated FTS DB must also be pruned and prevent entering HomeShell.
      final emptyFts = sqlite3.open(p.join(tmp.path, 'fts_tipitaka.db'));
      emptyFts.execute(
        'CREATE VIRTUAL TABLE paragraphs_fts USING fts5('
        'book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content);',
      );
      emptyFts.close();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: MockClient(
                  (_) async => http.Response('{"tag_name":"db","assets":[]}', 200),
                ),
                assetLoader: (_) async => bundledRaw,
              ),
            ),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.text('Welcome to TipitakaPali.org'));
      expect(find.text('Welcome to TipitakaPali.org'), findsOneWidget);
      expect(find.byType(OnboardingWizardScreen), findsOneWidget);

      final container = ProviderScope.containerOf(
        tester.element(find.byType(OnboardingGate)),
      );
      final state = container.read(downloadControllerProvider);
      expect(state.needsOnboarding, isTrue);
      expect(state.onboardingInterrupted, isTrue);
      expect(state.installedDbs.containsKey('dpd_splitter_tipitakapali.db'), isFalse);
      expect(state.installedDbs.containsKey('fts_tipitaka.db'), isFalse);
    },
  );

  testWidgets(
    'OnboardingWizardScreen keeps download stat lines single-line without shaking on narrow phones',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final manifest = DatabaseManifest.fromJson(
        jsonDecode(bundledRaw) as Map<String, dynamic>,
      );

      Future<double> measureCardHeight(DownloadProgress progress) async {
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [
              downloadControllerProvider.overrideWith(
                () => _StaticDownloadController(
                  DownloadCenterState(
                    isInitializing: false,
                    manifest: manifest,
                    transfers: {'tipitaka': progress},
                  ),
                ),
              ),
            ],
            child: MaterialApp(home: OnboardingWizardScreen(onCompleted: () {})),
          ),
        );
        await tester.pump(const Duration(milliseconds: 50));

        final statFinder = find.textContaining('/');
        expect(statFinder, findsWidgets);
        final statWidget = tester.widget<Text>(
          find.textContaining(' / ').first,
        );
        expect(statWidget.maxLines, equals(1));
        expect(statWidget.softWrap, isFalse);
        expect(statWidget.overflow, equals(TextOverflow.ellipsis));
        expect(
          statWidget.style?.fontFeatures,
          contains(const FontFeature.tabularFigures()),
        );

        final cardBox = tester.getSize(
          find.ancestor(
            of: find.text('Tipiṭaka Pāḷi Text (CST)'),
            matching: find.byType(Container),
          ).first,
        );
        return cardBox.height;
      }

      final shortHeight = await measureCardHeight(
        const DownloadProgress(
          assetId: 'tipitaka',
          filename: 'tipitaka.db',
          phase: TransferPhase.downloading,
          bytesReceived: 1024,
          totalBytes: 4096,
          bytesPerSecond: 1024,
        ),
      );
      final longHeight = await measureCardHeight(
        const DownloadProgress(
          assetId: 'tipitaka',
          filename: 'tipitaka.db',
          phase: TransferPhase.downloading,
          bytesReceived: 999 * 1024 * 1024,
          totalBytes: 999 * 1024 * 1024,
          bytesPerSecond: 12345678,
        ),
      );

      expect(longHeight, equals(shortHeight));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'OnboardingGate stays in HomeShell when downloading a new optional translation after onboarding',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'onboarding_completed_v1': true,
        'onboarding_in_progress_v1': false,
      });
      final tmp = Directory.systemTemp.createTempSync('tp_gate_lang_dl_');
      addTearDown(() => tmp.deleteSync(recursive: true));

      final webRoot = Directory(p.join(tmp.path, 'web'))..createSync();
      File(p.join(webRoot.path, 'index.html'))
          .writeAsStringSync('<html><body>ok</body></html>');

      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      _createSampleTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
      _seedRemainingCompulsoryDbs(tmp.path);
      _createSampleFtsDb(p.join(tmp.path, 'fts_tipitaka.db'));

      final server = _FakeLocalServer(
        explicitWebRootDir: webRoot,
        api: TipitakaWebApi(
          dbDirectoryPath: tmp.path,
          dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
        ),
      );
      var webViewBuildCount = 0;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(
              DbStorageService(overrideDirectory: tmp),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: MockClient(
                  (_) async =>
                      http.Response('{"tag_name":"db","assets":[]}', 200),
                ),
                assetLoader: (_) async => bundledRaw,
              ),
            ),
            tipitakaLocalServerProvider.overrideWithValue(server),
            tipitakaWebViewBuilderProvider.overrideWithValue((context, uri) {
              webViewBuildCount++;
              return Text('WebView ready: $uri');
            }),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.textContaining('WebView ready:'));
      final initialBuilds = webViewBuildCount;
      expect(find.byType(OnboardingWizardScreen), findsNothing);

      // Simulate downloading a new optional translation DB (before its FTS
      // index exists) while inside HomeShell. OnboardingGate must NOT tear
      // down HomeShell/TipitakaWebViewScreen or bounce back to onboarding.
      final viDb = sqlite3.open(p.join(tmp.path, 'translation_vi.db'));
      try {
        viDb.execute(
          'CREATE TABLE paragraph_translations (id INTEGER PRIMARY KEY, book_code TEXT, chapter_index INTEGER, para_index INTEGER, translation_text TEXT);',
        );
      } finally {
        viDb.close();
      }

      final container = ProviderScope.containerOf(
        tester.element(find.byType(OnboardingGate)),
      );
      await container.read(downloadControllerProvider.notifier).refreshInstalled();
      await tester.pump();

      final state = container.read(downloadControllerProvider);
      expect(state.missingTranslationFtsLangs, equals(['vi']));
      expect(state.needsOnboarding, isFalse);
      expect(find.byType(OnboardingWizardScreen), findsNothing);
      expect(find.textContaining('WebView ready:'), findsOneWidget);
      expect(webViewBuildCount, equals(initialBuilds));
    },
  );

  testWidgets(
    'OnboardingGate goes directly to HomeShell when Download All and FTS indexing finish with no error',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('tp_gate_auto_enter_');
      addTearDown(() => tmp.deleteSync(recursive: true));

      final webRoot = Directory(p.join(tmp.path, 'web'))..createSync();
      File(p.join(webRoot.path, 'index.html'))
          .writeAsStringSync('<html><body>ok</body></html>');

      final sampleDbFile = File(p.join(tmp.path, '_src_tipitaka.db'));
      _createSampleTipitakaDb(sampleDbFile.path);
      final db = sqlite3.open(sampleDbFile.path);
      try {
        db.execute(
          "INSERT INTO books (code, title, xml_filename) VALUES ('mula', 'Digha', 'mula.xml');",
        );
        db.execute(
          "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text) "
          "VALUES ('mula-0-1', 'mula', 0, 1, '1', 'bodytext', 'Evam me sutam.');",
        );
      } finally {
        db.close();
      }
      final dbBytes = sampleDbFile.readAsBytesSync();
      sampleDbFile.deleteSync();
      final archive = Archive()
        ..addFile(ArchiveFile('tipitaka.db', dbBytes.length, dbBytes));
      final tipitakaZip = ZipEncoder().encode(archive);

      final manifestJson = jsonEncode({
        'version': 1,
        'releaseRepo': 'tipitakapali/tipitakapali.org',
        'releaseTag': 'db',
        'core': {
          'tipitaka': {
            'id': 'tipitaka',
            'title': 'Tipiṭaka Pāḷi Text (CST)',
            'assetName': 'tipitaka.db.zip',
            'filename': 'tipitaka.db',
            'category': 'core',
            'description': 'Core Pali canon',
            'compulsory': true,
            'size': tipitakaZip.length,
            'dbSize': dbBytes.length,
            'requiredTables': ['books', 'canon_paragraphs'],
            'url':
                'https://github.com/tipitakapali/tipitakapali.org/releases/download/db/tipitaka.db.zip',
          },
        },
        'dictionaries': <String, dynamic>{},
        'languages': <String, dynamic>{},
      });

      final storage = DbStorageService(overrideDirectory: tmp);
      final downloadClient = MockClient.streaming((request, _) async {
        if (request.url.path.endsWith('/tipitaka.db.zip')) {
          return http.StreamedResponse(
            Stream.value(tipitakaZip),
            200,
            contentLength: tipitakaZip.length,
          );
        }
        return http.StreamedResponse(
          Stream.value(utf8.encode('not found')),
          404,
        );
      });

      final server = _FakeLocalServer(
        explicitWebRootDir: webRoot,
        api: TipitakaWebApi(
          dbDirectoryPath: tmp.path,
          dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(storage),
            downloadServiceProvider.overrideWithValue(
              DownloadService(storage: storage, client: downloadClient),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: MockClient((_) async => http.Response('{}', 200)),
                assetLoader: (_) async => manifestJson,
              ),
            ),
            tipitakaLocalServerProvider.overrideWithValue(server),
            tipitakaWebViewBuilderProvider.overrideWithValue(
              (_, uri) => Text('WebView ready: $uri'),
            ),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.text('Welcome to TipitakaPali.org'));
      final downloadBtn = find.textContaining('Download All');
      expect(downloadBtn, findsOneWidget);

      await tester.tap(downloadBtn);
      await tester.pump();

      // Downloads & FTS5 indexing use Isolate.run; advance real event loop cleanly.
      final container = ProviderScope.containerOf(
        tester.element(find.byType(OnboardingGate)),
      );
      for (var i = 0; i < 80; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump();
        if (find.textContaining('WebView ready:').evaluate().isNotEmpty) {
          break;
        }
      }

      // Should go straight to HomeShell without requiring tapping "Enter Library".
      expect(find.textContaining('WebView ready:'), findsOneWidget);
      expect(find.byType(OnboardingWizardScreen), findsNothing);
      expect(find.text('Enter Library'), findsNothing);

      final state = container.read(downloadControllerProvider);
      expect(state.onboardingCompleted, isTrue);
      expect(state.needsOnboarding, isFalse);
      expect(state.installedDbs.containsKey('fts_tipitaka.db'), isTrue);
    },
  );

  testWidgets(
    'OnboardingGate stays on OnboardingWizardScreen when a selected download fails',
    (tester) async {
      SharedPreferences.setMockInitialValues({'onboarding_language_code': 'vi'});
      final tmp = Directory.systemTemp.createTempSync('tp_gate_err_stay_');
      addTearDown(() => tmp.deleteSync(recursive: true));

      final webRoot = Directory(p.join(tmp.path, 'web'))..createSync();
      File(p.join(webRoot.path, 'index.html'))
          .writeAsStringSync('<html><body>ok</body></html>');

      final sampleDbFile = File(p.join(tmp.path, '_src_tipitaka.db'));
      _createSampleTipitakaDb(sampleDbFile.path);
      final db = sqlite3.open(sampleDbFile.path);
      try {
        db.execute(
          "INSERT INTO books (code, title, xml_filename) VALUES ('mula', 'Digha', 'mula.xml');",
        );
        db.execute(
          "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text) "
          "VALUES ('mula-0-1', 'mula', 0, 1, '1', 'bodytext', 'Evam me sutam.');",
        );
      } finally {
        db.close();
      }
      final dbBytes = sampleDbFile.readAsBytesSync();
      sampleDbFile.deleteSync();
      final tipitakaZip = ZipEncoder().encode(
        Archive()..addFile(ArchiveFile('tipitaka.db', dbBytes.length, dbBytes)),
      );

      final manifestJson = jsonEncode({
        'version': 1,
        'releaseRepo': 'tipitakapali/tipitakapali.org',
        'releaseTag': 'db',
        'core': {
          'tipitaka': {
            'id': 'tipitaka',
            'title': 'Tipiṭaka Pāḷi Text (CST)',
            'assetName': 'tipitaka.db.zip',
            'filename': 'tipitaka.db',
            'category': 'core',
            'description': 'Core Pali canon',
            'compulsory': true,
            'size': tipitakaZip.length,
            'dbSize': dbBytes.length,
            'requiredTables': ['books', 'canon_paragraphs'],
            'url':
                'https://github.com/tipitakapali/tipitakapali.org/releases/download/db/tipitaka.db.zip',
          },
        },
        'dictionaries': <String, dynamic>{},
        'languages': {
          'vi': {
            'code': 'vi',
            'name': 'Vietnamese',
            'nativeName': 'Tiếng Việt',
            'translationDb': {
              'id': 'translation_vi',
              'title': 'Vietnamese Translation',
              'assetName': 'translation_vi.db.zip',
              'filename': 'translation_vi.db',
              'category': 'translation',
              'description': 'Vietnamese translation',
              'compulsory': false,
              'size': 1024,
              'dbSize': 2048,
              'url':
                  'https://github.com/tipitakapali/tipitakapali.org/releases/download/db/translation_vi.db.zip',
            },
          },
        },
      });

      final storage = DbStorageService(overrideDirectory: tmp);
      final downloadClient = MockClient.streaming((request, _) async {
        if (request.url.path.endsWith('/tipitaka.db.zip')) {
          return http.StreamedResponse(
            Stream.value(tipitakaZip),
            200,
            contentLength: tipitakaZip.length,
          );
        }
        return http.StreamedResponse(
          Stream.value(utf8.encode('not found')),
          404,
        );
      });

      final server = _FakeLocalServer(
        explicitWebRootDir: webRoot,
        api: TipitakaWebApi(
          dbDirectoryPath: tmp.path,
          dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            dbStorageServiceProvider.overrideWithValue(storage),
            downloadServiceProvider.overrideWithValue(
              DownloadService(storage: storage, client: downloadClient),
            ),
            gitHubReleaseServiceProvider.overrideWithValue(
              GitHubReleaseService(
                client: MockClient((_) async => http.Response('{}', 200)),
                assetLoader: (_) async => manifestJson,
              ),
            ),
            tipitakaLocalServerProvider.overrideWithValue(server),
            tipitakaWebViewBuilderProvider.overrideWithValue(
              (_, uri) => Text('WebView ready: $uri'),
            ),
          ],
          child: const MaterialApp(home: OnboardingGate()),
        ),
      );

      await _pumpUntilFound(tester, find.text('Welcome to TipitakaPali.org'));
      final container = ProviderScope.containerOf(
        tester.element(find.byType(OnboardingGate)),
      );
      await container
          .read(downloadControllerProvider.notifier)
          .setLanguageCode('vi');
      await tester.pump();

      await tester.tap(find.textContaining('Download All'));
      await tester.pump();
      for (var i = 0; i < 80; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump();
        final st = container.read(downloadControllerProvider);
        if (!st.isBatchInstalling &&
            !st.hasActiveTransfers &&
            !st.isIndexingFts &&
            st.releaseWarning != null) {
          break;
        }
      }

      final state = container.read(downloadControllerProvider);
      expect(state.releaseWarning, isNotNull);
      expect(state.onboardingCompleted, isFalse);
      expect(find.byType(OnboardingWizardScreen), findsOneWidget);
      expect(find.textContaining('WebView ready:'), findsNothing);
    },
  );
}

class _StaticDownloadController extends DownloadController {
  final DownloadCenterState _initial;

  _StaticDownloadController(this._initial);

  @override
  DownloadCenterState build() => _initial;

  @override
  Future<void> initialize({bool fetchRemote = true}) async {}
}
