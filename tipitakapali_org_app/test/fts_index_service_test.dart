import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/fts/fts_index_service.dart';
import 'package:tipitakapali_app/core/server/dpd_family_templates.dart';
import 'package:tipitakapali_app/core/server/tipitaka_web_api.dart';
import 'package:tipitakapali_app/core/services/github_release_service.dart';
import 'package:tipitakapali_app/core/storage/db_storage_service.dart';
import 'package:tipitakapali_app/features/downloads/download_controller.dart';
import 'package:tipitakapali_app/features/downloads/download_service.dart';

void _createTipitakaDb(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute('''
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        nikaya TEXT,
        category TEXT,
        xml_filename TEXT NOT NULL DEFAULT '',
        chapter_count INTEGER DEFAULT 1
      );
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        chunk_name TEXT NOT NULL DEFAULT 'ch0',
        anchor_id TEXT NOT NULL DEFAULT 'chap-0',
        para_index INTEGER DEFAULT 0,
        html TEXT DEFAULT ''
      );
      CREATE TABLE tree_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT
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
        pali_text TEXT
      );
    ''');
    db.execute(
      "INSERT INTO books (code, title, nikaya, category) "
      "VALUES ('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', 'mūla');",
    );
    db.execute(
      "INSERT INTO chapters (book_id, book_code, chapter_index, title, para_index) "
      "VALUES (1, 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 0);",
    );
    db.execute(
      "INSERT INTO canon_paragraphs "
      "(guid, book_code, chapter_index, para_index, para_num, rend, pali_text) "
      "VALUES "
      "('s0101m.mul:c0:n1:p1', 's0101m.mul', 0, 1, '1', 'bodytext', "
      "'<pb ed=\"M\" n=\"1\"/>Namo tassa <note>bhagavato</note> sammāsambuddhassa buddhoṁ.'), "
      "('s0101m.mul:c0:n2:p2', 's0101m.mul', 0, 2, '2', 'bodytext', "
      "'Buddhadhammasaṅghānam vandāmi.');",
    );
  } finally {
    db.close();
  }
}

void _createTranslationDb(
  String path, {
  required String langCode,
  required String langName,
  required String nativeName,
  required String text,
}) {
  final db = sqlite3.open(path);
  try {
    db.execute('''
      CREATE TABLE translation_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE paragraph_translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        guid TEXT,
        para_num TEXT,
        translation TEXT NOT NULL,
        sentence_count INTEGER,
        sentences_json TEXT
      );
    ''');
    db.execute(
      "INSERT INTO translation_meta (key, value) VALUES "
      "('lang_code', '$langCode'), "
      "('lang_name', '$langName'), "
      "('lang_native_name', '$nativeName'), "
      "('flag', '🌐'), "
      "('total_paragraphs', '1');",
    );
    db.execute(
      'INSERT INTO paragraph_translations '
      '(book_code, chapter_index, para_index, guid, para_num, translation) '
      'VALUES (?, 0, 1, ?, ?, ?)',
      ['s0101m.mul', 's0101m.mul:c0:n1:p1', '1', text],
    );
  } finally {
    db.close();
  }
}

void main() {
  test('FtsIndexService text cleaners mirror generate_fts.py & build_translation_fts.py', () {
    final cleanedPali = FtsIndexService.cleanParagraphText(
      '<pb ed="V" n="10"/><span class="pagebreak">P.10</span>'
      '<strong class="paranum">12</strong>Namo <note>sabba</note> buddhoṁ.',
    );
    expect(cleanedPali, 'Namo sabba buddhoṃ.');

    final cleanedTrans = FtsIndexService.cleanTranslationText(
      '<p>Kính lễ &amp; đảnh lễ <b>Đức Phật</b>&#x20;!</p>',
    );
    expect(cleanedTrans, 'Kính lễ & đảnh lễ Đức Phật !');
  });

  test('FtsIndexService builds Pali and per-language FTS5 indexes usable by TipitakaWebApi', () async {
    final tmp = Directory.systemTemp.createTempSync('tp_fts_service_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    _createTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
    _createTranslationDb(
      p.join(tmp.path, 'translation_vi.db'),
      langCode: 'vi',
      langName: 'Vietnamese',
      nativeName: 'Tiếng Việt',
      text: 'Kính lễ <b>Đức Phật</b> Bổn Sư.',
    );
    _createTranslationDb(
      p.join(tmp.path, 'translation_th.db'),
      langCode: 'th',
      langName: 'Thai',
      nativeName: 'ไทย',
      text: 'ขอนอบน้อมแด่พระผู้มีพระภาคเจ้า',
    );
    _createTranslationDb(
      p.join(tmp.path, 'translation_zh.db'),
      langCode: 'zh',
      langName: 'Chinese',
      nativeName: '中文',
      text: '礼敬世尊阿罗汉正等正觉',
    );

    final service = FtsIndexService();
    final paliProgressEvents = <FtsBuildProgress>[];
    final paliRes = await service.buildPaliFtsIndex(
      dbDirPath: tmp.path,
      onProgress: paliProgressEvents.add,
    );
    expect(paliRes.skipped, isFalse);
    expect(paliRes.indexedRows, 2);
    expect(
      paliProgressEvents.map((e) => e.stage).toSet(),
      containsAll([
        FtsBuildStage.preparing,
        FtsBuildStage.indexing,
        FtsBuildStage.optimizing,
        FtsBuildStage.compacting,
        FtsBuildStage.completed,
      ]),
    );
    expect(paliProgressEvents.last.progress, 1.0);
    for (var i = 1; i < paliProgressEvents.length; i++) {
      expect(
        paliProgressEvents[i].progress,
        greaterThanOrEqualTo(paliProgressEvents[i - 1].progress),
      );
    }

    // Calling again without force returns skipped=true.
    final paliRepeat = await service.buildPaliFtsIndex(dbDirPath: tmp.path);
    expect(paliRepeat.skipped, isTrue);

    final viRes = await service.buildTranslationFtsIndex(
      dbDirPath: tmp.path,
      langCode: 'vi',
    );
    expect(viRes.indexedRows, 1);

    final thRes = await service.buildTranslationFtsIndex(
      dbDirPath: tmp.path,
      langCode: 'th',
    );
    expect(thRes.indexedRows, 1);

    final zhRes = await service.buildTranslationFtsIndex(
      dbDirPath: tmp.path,
      langCode: 'zh',
    );
    expect(zhRes.indexedRows, 1);

    // Verify translation_meta tokenizer clauses recorded accurately.
    String readTokenize(String filename) {
      final db = sqlite3.open(p.join(tmp.path, filename));
      try {
        final rows = db.select(
          "SELECT value FROM translation_meta WHERE key = 'fts_tokenize'",
        );
        return rows.first['value'] as String;
      } finally {
        db.close();
      }
    }

    expect(readTokenize('fts_translation_vi.db'), 'unicode61 remove_diacritics 0');
    expect(
      readTokenize('fts_translation_th.db'),
      "unicode61 categories 'L* N* Mn'",
    );
    expect(readTokenize('fts_translation_zh.db'), 'trigram');

    // Verify TipitakaWebApi queries newly indexed FTS5 DBs seamlessly.
    final api = TipitakaWebApi(
      dbDirectoryPath: tmp.path,
      dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
    );
    addTearDown(api.close);

    final dbList =
        (api.getSearchDatabases().body! as Map<String, dynamic>)['databases']
            as List;
    final dbKeys = dbList.map((d) => (d as Map)['key']).toSet();
    expect(dbKeys, containsAll(['pali', 'vi', 'th', 'zh']));

    final paliSearch =
        api.search({'q': 'buddho*', 'l': 'pali'}).body! as Map<String, dynamic>;
    expect(paliSearch['total'], 1);

    final viSearch =
        api.search({'q': 'Phật', 'l': 'vi'}).body! as Map<String, dynamic>;
    expect(viSearch['total'], 1);

    final zhSearch =
        api.search({'q': '正等正觉', 'l': 'zh'}).body! as Map<String, dynamic>;
    expect(zhSearch['total'], 1);
  });

  test('DownloadController.downloadAndIndexLanguage downloads zip & indexes FTS5 in-app', () async {
    SharedPreferences.setMockInitialValues({});
    final tmp = Directory.systemTemp.createTempSync('tp_ctrl_lang_dl_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    _createTipitakaDb(p.join(tmp.path, 'tipitaka.db'));

    final sourceViPath = p.join(tmp.path, '_src_translation_vi.db');
    _createTranslationDb(
      sourceViPath,
      langCode: 'vi',
      langName: 'Vietnamese',
      nativeName: 'Tiếng Việt',
      text: 'Đảnh lễ Thế Tôn ứng cúng.',
    );
    final rawViBytes = File(sourceViPath).readAsBytesSync();
    File(sourceViPath).deleteSync();

    final archive = Archive()
      ..addFile(ArchiveFile('translation_vi.db', rawViBytes.length, rawViBytes));
    final zipBytes = ZipEncoder().encodeBytes(archive);

    final manifestJson = jsonEncode({
      'version': 1,
      'releaseRepo': 'tipitakapali/tipitakapali.org',
      'releaseTag': 'db',
      'core': {
        'tipitaka': {
          'id': 'tipitaka',
          'title': 'Pāḷi Tipiṭaka Core',
          'filename': 'tipitaka.db',
          'assetName': 'tipitaka.db.zip',
          'category': 'core',
          'compulsory': true,
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
            'filename': 'translation_vi.db',
            'assetName': 'translation_vi.db.zip',
            'category': 'translation',
            'size': zipBytes.length,
            'requiredTables': ['paragraph_translations'],
          },
        },
      },
    });

    final mockClient = MockClient.streaming((request, bodyStream) async {
      if (request.url.path.endsWith('/translation_vi.db.zip')) {
        return http.StreamedResponse(
          Stream.value(zipBytes),
          200,
          contentLength: zipBytes.length,
        );
      }
      return http.StreamedResponse(
        Stream.value(utf8.encode('not found')),
        404,
      );
    });

    final storage = DbStorageService(overrideDirectory: tmp);
    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(storage),
        downloadServiceProvider.overrideWithValue(
          DownloadService(storage: storage, client: mockClient),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            client: MockClient((_) async => http.Response('{}', 200)),
            assetLoader: (_) async => manifestJson,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);

    final ok = await controller.downloadAndIndexLanguage('vi');
    expect(ok, isTrue);

    final state = container.read(downloadControllerProvider);
    expect(state.installedDbs.containsKey('translation_vi.db'), isTrue);
    expect(state.installedDbs.containsKey('fts_translation_vi.db'), isTrue);
    expect(state.installedDbs.containsKey('fts_tipitaka.db'), isTrue);

    final api = TipitakaWebApi(
      dbDirectoryPath: tmp.path,
      dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
    );
    addTearDown(api.close);

    final searchRes =
        api.search({'q': 'Thế', 'l': 'vi'}).body! as Map<String, dynamic>;
    expect(searchRes['total'], 1);
  });

  test('downloadRequiredAndSelected defers FTS5 indexing until all downloads finish', () async {
    SharedPreferences.setMockInitialValues({});
    final tmp = Directory.systemTemp.createTempSync('tp_batch_dl_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    final srcPali = p.join(tmp.path, '_src_tipitaka.db');
    _createTipitakaDb(srcPali);
    final rawPali = File(srcPali).readAsBytesSync();
    File(srcPali).deleteSync();
    final paliZip = ZipEncoder().encodeBytes(
      Archive()..addFile(ArchiveFile('tipitaka.db', rawPali.length, rawPali)),
    );

    final srcVi = p.join(tmp.path, '_src_vi.db');
    _createTranslationDb(
      srcVi,
      langCode: 'vi',
      langName: 'Vietnamese',
      nativeName: 'Tiếng Việt',
      text: 'Nam mô Bổn Sư.',
    );
    final rawVi = File(srcVi).readAsBytesSync();
    File(srcVi).deleteSync();
    final viZip = ZipEncoder().encodeBytes(
      Archive()..addFile(ArchiveFile('translation_vi.db', rawVi.length, rawVi)),
    );

    final srcDict = p.join(tmp.path, '_src_dict.db');
    final dictDb = sqlite3.open(srcDict);
    try {
      dictDb.execute(
        'CREATE TABLE dpd_headwords (id INTEGER PRIMARY KEY, lemma_1 TEXT);',
      );
    } finally {
      dictDb.close();
    }
    final rawDict = File(srcDict).readAsBytesSync();
    File(srcDict).deleteSync();
    final dictZip = ZipEncoder().encodeBytes(
      Archive()..addFile(ArchiveFile('dpd_tipitakapali.db', rawDict.length, rawDict)),
    );

    final manifestJson = jsonEncode({
      'version': 1,
      'releaseRepo': 'tipitakapali/tipitakapali.org',
      'releaseTag': 'db',
      'core': {
        'tipitaka': {
          'id': 'tipitaka',
          'title': 'Pāḷi Tipiṭaka Core',
          'filename': 'tipitaka.db',
          'assetName': 'tipitaka.db.zip',
          'category': 'core',
          'compulsory': true,
          'size': paliZip.length,
          'requiredTables': ['books', 'canon_paragraphs'],
        },
      },
      'dictionaries': {
        'dpd': {
          'id': 'dpd',
          'title': 'Digital Pali Dictionary',
          'filename': 'dpd_tipitakapali.db',
          'assetName': 'dpd_tipitakapali.db.zip',
          'category': 'dictionary',
          'size': dictZip.length,
          'requiredTables': ['dpd_headwords'],
        },
      },
      'languages': {
        'vi': {
          'code': 'vi',
          'name': 'Vietnamese',
          'nativeName': 'Tiếng Việt',
          'translationDb': {
            'id': 'translation_vi',
            'title': 'Vietnamese Translation',
            'filename': 'translation_vi.db',
            'assetName': 'translation_vi.db.zip',
            'category': 'translation',
            'size': viZip.length,
            'requiredTables': ['paragraph_translations'],
          },
        },
      },
    });

    final downloadOrder = <String>[];
    var ftsExistedDuringLastDownload = true;
    final mockClient = MockClient.streaming((request, bodyStream) async {
      if (request.url.path.endsWith('/tipitaka.db.zip')) {
        downloadOrder.add('tipitaka.db.zip');
        return http.StreamedResponse(
          Stream.value(paliZip),
          200,
          contentLength: paliZip.length,
        );
      }
      if (request.url.path.endsWith('/dpd_tipitakapali.db.zip')) {
        downloadOrder.add('dpd_tipitakapali.db.zip');
        return http.StreamedResponse(
          Stream.value(dictZip),
          200,
          contentLength: dictZip.length,
        );
      }
      if (request.url.path.endsWith('/translation_vi.db.zip')) {
        downloadOrder.add('translation_vi.db.zip');
        ftsExistedDuringLastDownload =
            File(p.join(tmp.path, 'fts_tipitaka.db')).existsSync();
        return http.StreamedResponse(
          Stream.value(viZip),
          200,
          contentLength: viZip.length,
        );
      }
      return http.StreamedResponse(
        Stream.value(utf8.encode('not found')),
        404,
      );
    });

    final storage = DbStorageService(overrideDirectory: tmp);
    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(storage),
        downloadServiceProvider.overrideWithValue(
          DownloadService(storage: storage, client: mockClient),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            client: MockClient((_) async => http.Response('{}', 200)),
            assetLoader: (_) async => manifestJson,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);
    await controller.setLanguageCode('vi');

    var sawIdleGapAfterCompulsory = false;
    final sub = container.listen<DownloadCenterState>(
      downloadControllerProvider,
      (_, next) {
        if (next.allCompulsoryInstalled &&
            !next.isBatchInstalling &&
            !next.hasActiveTransfers &&
            !next.isIndexingFts &&
            (!next.installedDbs.containsKey('fts_tipitaka.db') ||
                !next.installedDbs.containsKey('fts_translation_vi.db'))) {
          sawIdleGapAfterCompulsory = true;
        }
      },
    );
    addTearDown(sub.close);

    await controller.downloadRequiredAndSelected();

    expect(downloadOrder, [
      'tipitaka.db.zip',
      'dpd_tipitakapali.db.zip',
      'translation_vi.db.zip',
    ]);
    expect(ftsExistedDuringLastDownload, isFalse);
    expect(sawIdleGapAfterCompulsory, isFalse);
    final state = container.read(downloadControllerProvider);
    expect(state.isBatchInstalling, isFalse);
    expect(state.isIndexingFts, isFalse);
    expect(state.installedDbs.containsKey('tipitaka.db'), isTrue);
    expect(state.installedDbs.containsKey('dpd_tipitakapali.db'), isTrue);
    expect(state.installedDbs.containsKey('translation_vi.db'), isTrue);
    expect(state.installedDbs.containsKey('fts_tipitaka.db'), isTrue);
    expect(state.installedDbs.containsKey('fts_translation_vi.db'), isTrue);

    // Seed an un-indexed English translation and an empty FTS DB to verify
    // /api/search/databases returns ONLY populated indexed DBs.
    _createTranslationDb(
      p.join(tmp.path, 'translation_en.db'),
      langCode: 'en',
      langName: 'English',
      nativeName: 'English',
      text: 'Homage to the Blessed One.',
    );
    _createTranslationDb(
      p.join(tmp.path, 'translation_fr.db'),
      langCode: 'fr',
      langName: 'French',
      nativeName: 'Français',
      text: 'Hommage au Bienheureux.',
    );
    final emptyFts = sqlite3.open(p.join(tmp.path, 'fts_translation_fr.db'));
    try {
      emptyFts.execute(
        'CREATE VIRTUAL TABLE paragraphs_fts USING fts5('
        'book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content);',
      );
    } finally {
      emptyFts.close();
    }

    final api = TipitakaWebApi(
      dbDirectoryPath: tmp.path,
      dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
    );
    addTearDown(api.close);

    final searchDbsResp = api.getSearchDatabases().body as Map<String, dynamic>;
    final searchDbIds = (searchDbsResp['databases'] as List)
        .map((e) => (e as Map)['id'].toString())
        .toList();
    expect(searchDbIds, ['fts_tipitaka.db', 'fts_translation_vi.db']);
  });

  test('updateAvailableDatabases forces FTS5 rebuild when tipitaka or translation updates', () async {
    final tmp = Directory.systemTemp.createTempSync('fts_update_rebuild_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    // Seed v1 databases & pre-existing FTS5 indexes with old text.
    final v1Pali = p.join(tmp.path, 'tipitaka.db');
    _createTipitakaDb(v1Pali);
    final v1Vi = p.join(tmp.path, 'translation_vi.db');
    _createTranslationDb(
      v1Vi,
      langCode: 'vi',
      langName: 'Vietnamese',
      nativeName: 'Tiếng Việt',
      text: 'Old Vietnamese phrase',
    );

    final ftsService = FtsIndexService();
    await ftsService.buildPaliFtsIndex(dbDirPath: tmp.path, force: true);
    await ftsService.buildTranslationFtsIndex(
      dbDirPath: tmp.path,
      langCode: 'vi',
      force: true,
    );

    // Prepare v2 zipped DBs containing brand-new text tokens.
    final v2Dir = Directory(p.join(tmp.path, 'v2_src'))..createSync();
    final v2PaliPath = p.join(v2Dir.path, 'tipitaka.db');
    _createTipitakaDb(v2PaliPath);
    final paliDbV2 = sqlite3.open(v2PaliPath);
    paliDbV2.execute(
      "UPDATE canon_paragraphs SET pali_text = 'Updated Pali dhamma token' WHERE guid = 's0101m.mul:c0:n1:p1';",
    );
    paliDbV2.close();
    final v2PaliBytes = File(v2PaliPath).readAsBytesSync();
    final v2PaliZip = ZipEncoder().encodeBytes(
      Archive()..addFile(ArchiveFile('tipitaka.db', v2PaliBytes.length, v2PaliBytes)),
    );

    final v2ViPath = p.join(v2Dir.path, 'translation_vi.db');
    _createTranslationDb(
      v2ViPath,
      langCode: 'vi',
      langName: 'Vietnamese',
      nativeName: 'Tiếng Việt',
      text: 'Updated Vietnamese translation token',
    );
    final v2ViBytes = File(v2ViPath).readAsBytesSync();
    final v2ViZip = ZipEncoder().encodeBytes(
      Archive()..addFile(ArchiveFile('translation_vi.db', v2ViBytes.length, v2ViBytes)),
    );

    final v2ManifestJson = jsonEncode({
      'version': 2,
      'releaseRepo': 'tipitakapali/tipitakapali.org',
      'releaseTag': 'db',
      'core': {
        'tipitaka': {
          'id': 'tipitaka',
          'title': 'Tipitaka Canon & Chapters',
          'filename': 'tipitaka.db',
          'assetName': 'tipitaka.db.zip',
          'category': 'core',
          'compulsory': true,
          'version': 2,
          'updated': '2026-12-01',
          'size': v2PaliZip.length,
          'url': 'https://example.invalid/v2/tipitaka.db.zip',
          'requiredTables': ['books', 'chapters', 'canon_paragraphs'],
        },
      },
      'dictionaries': {},
      'languages': {
        'vi': {
          'code': 'vi',
          'name': 'Vietnamese',
          'nativeName': 'Tiếng Việt',
          'translationDb': {
            'id': 'translation_vi',
            'title': 'Vietnamese Translation',
            'filename': 'translation_vi.db',
            'assetName': 'translation_vi.db.zip',
            'category': 'translation',
            'version': 2,
            'updated': '2026-12-01',
            'size': v2ViZip.length,
            'url': 'https://example.invalid/v2/translation_vi.db.zip',
            'requiredTables': ['paragraph_translations'],
          },
        },
      },
    });

    SharedPreferences.setMockInitialValues({
      'installed_asset_meta_tipitaka.db': jsonEncode({
        'version': 1,
        'updated': '2026-11-14',
      }),
      'installed_asset_meta_translation_vi.db': jsonEncode({
        'version': 1,
        'updated': '2026-11-14',
      }),
    });

    final mockDownloadClient = MockClient.streaming((request, _) async {
      if (request.url.path.endsWith('/tipitaka.db.zip')) {
        return http.StreamedResponse(
          Stream.value(v2PaliZip),
          200,
          contentLength: v2PaliZip.length,
        );
      }
      if (request.url.path.endsWith('/translation_vi.db.zip')) {
        return http.StreamedResponse(
          Stream.value(v2ViZip),
          200,
          contentLength: v2ViZip.length,
        );
      }
      return http.StreamedResponse(Stream.value(utf8.encode('404')), 404);
    });

    final storage = DbStorageService(overrideDirectory: tmp);
    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(storage),
        downloadServiceProvider.overrideWithValue(
          DownloadService(storage: storage, client: mockDownloadClient),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            client: MockClient((request) async {
              if (request.url.toString() ==
                  GitHubReleaseService.defaultRawManifestUrl) {
                return http.Response(v2ManifestJson, 200);
              }
              return http.Response('{"tag_name":"db","assets":[]}', 404);
            }),
            assetLoader: (_) async => v2ManifestJson,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);
    final updates = await controller.checkForDatabaseUpdates();
    expect(
      updates.map((u) => u.asset.filename).toSet(),
      equals({'tipitaka.db', 'translation_vi.db'}),
    );

    await controller.updateAvailableDatabases();

    final after = container.read(downloadControllerProvider);
    expect(after.availableUpdates, isEmpty);

    // Verify FTS5 indexes were rebuilt from the updated DBs (old content gone, new content searchable).
    final paliFtsDb = sqlite3.open(p.join(tmp.path, 'fts_tipitaka.db'));
    try {
      final newRows = paliFtsDb.select(
        "SELECT content FROM paragraphs_fts WHERE paragraphs_fts MATCH 'dhamma';",
      );
      final oldRows = paliFtsDb.select(
        "SELECT content FROM paragraphs_fts WHERE paragraphs_fts MATCH 'sammāsambuddhassa';",
      );
      expect(newRows, isNotEmpty);
      expect(newRows.first['content'], contains('Updated Pali dhamma token'));
      expect(oldRows, isEmpty);
    } finally {
      paliFtsDb.close();
    }

    final viFtsDb = sqlite3.open(p.join(tmp.path, 'fts_translation_vi.db'));
    try {
      final newRows = viFtsDb.select(
        "SELECT content FROM paragraphs_fts WHERE paragraphs_fts MATCH 'Updated';",
      );
      final oldRows = viFtsDb.select(
        "SELECT content FROM paragraphs_fts WHERE paragraphs_fts MATCH 'Old';",
      );
      expect(newRows, isNotEmpty);
      expect(oldRows, isEmpty);
    } finally {
      viFtsDb.close();
    }
  });

  test(
    'ensureMissingFtsIndexed processes core Pali FTS before translation FTS and aborts translations if Pali FTS fails',
    () async {
      SharedPreferences.setMockInitialValues({});
      final tmp = Directory.systemTemp.createTempSync('fts_order_test_');
      addTearDown(() => tmp.deleteSync(recursive: true));

      _createTipitakaDb(p.join(tmp.path, 'tipitaka.db'));
      _createTranslationDb(
        p.join(tmp.path, 'translation_en.db'),
        langCode: 'en',
        langName: 'English',
        nativeName: 'English',
        text: 'Homage to the Blessed One.',
      );
      _createTranslationDb(
        p.join(tmp.path, 'translation_vi.db'),
        langCode: 'vi',
        langName: 'Vietnamese',
        nativeName: 'Tiếng Việt',
        text: 'Kính lễ Đức Thế Tôn.',
      );

      final spy = _RecordingFtsIndexService();
      final storage = DbStorageService(overrideDirectory: tmp);
      final bundledRaw =
          File('assets/databases_manifest.json').readAsStringSync();
      final container = ProviderContainer(
        overrides: [
          dbStorageServiceProvider.overrideWithValue(storage),
          ftsIndexServiceProvider.overrideWithValue(spy),
          gitHubReleaseServiceProvider.overrideWithValue(
            GitHubReleaseService(
              client: MockClient(
                (_) async => http.Response('{"tag_name":"db","assets":[]}', 200),
              ),
              assetLoader: (_) async => bundledRaw,
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      final controller = container.read(downloadControllerProvider.notifier);
      await controller.initialize(fetchRemote: false);

      // Even if a caller runs ensureMissingFtsIndexed with forceTranslationLangs,
      // core Pali FTS MUST run first (before any translation FTS).
      await controller.ensureMissingFtsIndexed(
        forceTipitaka: true,
        forceTranslationLangs: {'en', 'vi'},
      );
      expect(spy.calls, isNotEmpty);
      expect(spy.calls.first, equals('pali'));
      expect(spy.calls.sublist(1), containsAllInOrder(['translation:en', 'translation:vi']));

      // Now simulate Pali FTS failure with missing FTS DBs: translation FTS must NOT start.
      for (final name in [
        'fts_tipitaka.db',
        'fts_translation_en.db',
        'fts_translation_vi.db',
      ]) {
        final f = File(p.join(tmp.path, name));
        if (f.existsSync()) f.deleteSync();
      }
      spy.calls.clear();
      spy.failPali = true;

      await controller.ensureMissingFtsIndexed();
      expect(spy.calls, equals(['pali']));
      expect(File(p.join(tmp.path, 'fts_translation_en.db')).existsSync(), isFalse);
      expect(File(p.join(tmp.path, 'fts_translation_vi.db')).existsSync(), isFalse);
    },
  );
}

class _RecordingFtsIndexService extends FtsIndexService {
  final List<String> calls = <String>[];
  bool failPali = false;

  @override
  Future<FtsBuildResult> buildPaliFtsIndex({
    required String dbDirPath,
    bool force = false,
    void Function(FtsBuildProgress progress)? onProgress,
  }) async {
    calls.add('pali');
    if (failPali) {
      throw StateError('Simulated core Pali FTS indexing failure');
    }
    return super.buildPaliFtsIndex(
      dbDirPath: dbDirPath,
      force: force,
      onProgress: onProgress,
    );
  }

  @override
  Future<FtsBuildResult> buildTranslationFtsIndex({
    required String dbDirPath,
    required String langCode,
    bool force = false,
    void Function(FtsBuildProgress progress)? onProgress,
  }) async {
    calls.add('translation:$langCode');
    return super.buildTranslationFtsIndex(
      dbDirPath: dbDirPath,
      langCode: langCode,
      force: force,
      onProgress: onProgress,
    );
  }
}
