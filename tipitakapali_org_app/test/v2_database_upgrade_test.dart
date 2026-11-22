import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/models/db_manifest.dart';
import 'package:tipitakapali_app/core/server/dpd_family_templates.dart';
import 'package:tipitakapali_app/core/server/tipitaka_local_server.dart';
import 'package:tipitakapali_app/core/server/tipitaka_web_api.dart';
import 'package:tipitakapali_app/core/services/bold_definition_index_service.dart';
import 'package:tipitakapali_app/core/services/github_release_service.dart';
import 'package:tipitakapali_app/core/services/tipitaka_repository.dart';
import 'package:tipitakapali_app/core/storage/db_storage_service.dart';
import 'package:tipitakapali_app/features/downloads/download_controller.dart';

List<int> _zlibText(String value) => zlib.encode(utf8.encode(value));

void _createTipitakaV2Fixtures(String dirPath) {
  final corePath = p.join(dirPath, 'tipitaka.db');
  final core = sqlite3.open(corePath);
  try {
    core.execute('''
      CREATE TABLE site_metadata (key TEXT PRIMARY KEY, value TEXT);
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
      CREATE TABLE mat_para_map (
        source_book TEXT NOT NULL,
        sub_book TEXT,
        source_chapter INTEGER,
        source_para TEXT NOT NULL,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_para TEXT,
        mula_title TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_para TEXT,
        attha_title TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_para TEXT,
        tika_title TEXT,
        match_quality TEXT
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
      CREATE TABLE pali_sentences (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        line_id INTEGER NOT NULL,
        sentence TEXT NOT NULL
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
    core.execute(
      "INSERT INTO books (code, title, nikaya, category, xml_filename, chapter_count) "
      "VALUES ('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', 'mūla', 's0101m.mul.xml', 1);",
    );
    core.execute(
      "INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html) VALUES "
      "(1, 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 'ch0', 'chap-0', 0, '<p class=\"bodytext\" data-para=\"1\">Evaṃ me sutaṃ.</p>');",
    );
    core.execute(
      "INSERT INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index) VALUES "
      "(1, 'Suttapiṭaka', NULL, 'category', NULL, NULL), "
      "(2, '1. Brahmajālasuttaṃ', 1, 'chapter', 's0101m.mul', 0);",
    );
    core.execute(
      "INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES "
      "('s0101m.mul', 0, 0, 1, 'Evaṃ me sutaṃ.');",
    );
    core.execute(
      "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text) VALUES "
      "('s0101m.mul:c0:n0:p0', 's0101m.mul', 0, 0, '1', 'bodytext', 'Evaṃ me sutaṃ.');",
    );
  } finally {
    core.close();
  }
}

void _createUnifiedDictV2(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute('''
      CREATE TABLE dict_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE dict_entries (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL,
        word TEXT NOT NULL,
        folded TEXT NOT NULL,
        defi_z BLOB NOT NULL
      );
      CREATE TABLE dict_synonyms (
        synonym TEXT NOT NULL,
        word TEXT NOT NULL,
        PRIMARY KEY (synonym, word)
      ) WITHOUT ROWID;
      CREATE TABLE dict_inflections (
        key TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        html_z BLOB NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX idx_dict_entries_word ON dict_entries(word, source_id);
      CREATE INDEX idx_dict_entries_suggest_folded
        ON dict_entries(folded, source_id, word) WHERE source_id IN (0, 2);
    ''');
    db.execute(
      "INSERT INTO dict_meta (key, value) VALUES ('format', '2');",
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [
        1,
        0,
        'paṭicca',
        'paticca',
        _zlibText('<div class="dpd"><p>ind. dependent on; grounded on</p></div>'),
      ],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [
        2,
        0,
        'paṭiccasamuppāda',
        'paticcasamuppada',
        _zlibText('<div class="dpd"><p>masc. dependent origination</p></div>'),
      ],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [
        3,
        0,
        'nibbāna',
        'nibbana',
        _zlibText('<span class=p1w>nibbāna</span><div class="dpd"><p>nt. blowing out</p></div>'),
      ],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [
        4,
        0,
        '##tipitakapalidpdfeedback',
        '##tipitakapalidpdfeedback',
        _zlibText('<div>DPD Feedback Help</div>'),
      ],
    );
    // Splitter short text payload (<48 bytes stored as TEXT in V2 builds).
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [5, 1, 'paṭiccasamuppādo', 'paticcasamuppado', 'paṭicca+samuppādo'],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [6, 2, 'nibbāna', 'nibbana', _zlibText('<b>Nibbāna</b> PTS extinction')],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [7, 3, 'nibbāna', 'nibbana', _zlibText('<p class="definition">Abhidhan Burma</p>')],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [
        8,
        4,
        'nibbāna',
        'nibbana',
        _zlibText('<section class=PSD><h1><span class=psdW>නිබ්බාන</span></h1></section>'),
      ],
    );
    db.execute(
      'INSERT INTO dict_entries (id, source_id, word, folded, defi_z) VALUES (?, ?, ?, ?, ?)',
      [9, 5, 'abaddha', 'abaddha', _zlibText('<section class=MWS>unbound</section>')],
    );
    db.execute(
      "INSERT INTO dict_synonyms (synonym, word) VALUES ('nibbānassa', 'nibbāna');",
    );
    db.execute(
      'INSERT INTO dict_inflections (key, word, html_z) VALUES (?, ?, ?)',
      [
        'nibbāna_1',
        'nibbāna',
        _zlibText(
          '<p class="heading">nibbāna nt</p>'
          '<table><tr><th>nom</th><td>nibbānaṃ<br>nibbānāni</td></tr></table>',
        ),
      ],
    );
  } finally {
    db.close();
  }
}

void _createTranslationV2(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute('''
      CREATE TABLE translation_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE chapter_trans_pack (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        data_z BLOB NOT NULL,
        PRIMARY KEY (book_code, chapter_index)
      );
    ''');
    db.execute(
      "INSERT INTO translation_meta (key, value) VALUES "
      "('language', 'en'), ('name', 'English'), ('native_name', 'English'), ('flag', '🇬🇧');",
    );
    final pack = jsonEncode([
      [
        0,
        '1',
        '<b>Thus</b> have I heard.',
        [
          [1, 'Thus have I heard.'],
        ],
      ],
    ]);
    db.execute(
      'INSERT INTO chapter_trans_pack (book_code, chapter_index, data_z) VALUES (?, ?, ?)',
      ['s0101m.mul', 0, _zlibText(pack)],
    );
  } finally {
    db.close();
  }
}

void _createBoldDefinitionsV2(String dirPath) {
  final tipiSize = File(p.join(dirPath, 'tipitaka.db')).lengthSync();
  final db = sqlite3.open(p.join(dirPath, 'bold_definitions.db'));
  try {
    db.execute('''
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE bold_definitions (
        id INTEGER PRIMARY KEY,
        book_code TEXT,
        book_title TEXT,
        category TEXT,
        chapter_index INTEGER,
        para_index INTEGER,
        line_id INTEGER,
        para_num TEXT,
        word TEXT,
        plain TEXT,
        ending TEXT,
        sentence_html TEXT,
        before_html TEXT,
        after_html TEXT
      );
      CREATE TABLE chapter_links (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        paragraphs_z BLOB NOT NULL,
        PRIMARY KEY (book_code, chapter_index)
      );
    ''');
    db.execute(
      "INSERT INTO meta (key, value) VALUES "
      "('schema_version', '4'), "
      "('chapter_links_compressed', '1'), "
      "('source_size', '$tipiSize');",
    );
    db.execute(
      "INSERT INTO bold_definitions "
      "(id, book_code, book_title, category, chapter_index, para_index, line_id, para_num, word, plain, ending, sentence_html, before_html, after_html) "
      "VALUES (1, 's0101a.att', 'Sīlakkhandhavagga-aṭṭhakathā', 'aṭṭhakathā', 0, 0, 1, '1', 'nibbāna', 'nibbana', 'nti', '<b>Nibbānanti</b> parinibbānaṃ.', '', '');",
    );
    final linksJson = jsonEncode({
      '0': [
        {
          'word': 'evaṃ',
          'links': [
            {'b': 's0101a.att', 'c': 0, 'p': 0},
          ],
        },
      ],
    });
    db.execute(
      'INSERT INTO chapter_links (book_code, chapter_index, paragraphs_z) VALUES (?, ?, ?)',
      ['s0101m.mul', 0, _zlibText(linksJson)],
    );
  } finally {
    db.close();
  }
}

void _createValidFtsDb(String path) {
  final db = sqlite3.open(path);
  try {
    db.execute('CREATE TABLE paragraphs_fts (book_code TEXT, content TEXT);');
    db.execute("INSERT INTO paragraphs_fts VALUES ('s0101m.mul', 'Evaṃ me sutaṃ.');");
  } finally {
    db.close();
  }
}

Future<({int statusCode, String body})> _httpGet(Uri baseUri, String path) async {
  final client = HttpClient();
  try {
    final target = baseUri.resolve(path.startsWith('/') ? path.substring(1) : path);
    final req = await client.getUrl(target);
    final resp = await req.close();
    final body = await utf8.decodeStream(resp);
    return (statusCode: resp.statusCode, body: body);
  } finally {
    client.close(force: true);
  }
}

void main() {
  test('bundled V2 manifest sets db-v2 tag and marks dictionaries.db compulsory', () async {
    final raw = await File('assets/databases_manifest_v2.json').readAsString();
    final manifest = DatabaseManifest.fromJsonString(raw);
    expect(manifest.releaseTag, 'db-v2');
    expect(manifest.core['tipitaka']?.compulsory, isTrue);
    expect(manifest.dictionaries['bold_definitions']?.compulsory, isTrue);
    expect(manifest.dictionaries['dictionaries']?.compulsory, isTrue);
    expect(manifest.languages['en']?.translationDb.compulsory, isFalse);
  });

  test('TipitakaWebApi and TipitakaLocalServer serve V2 dictionaries, suggest, chapter_trans_pack, and paragraphs_z', () async {
    final tmp = Directory.systemTemp.createTempSync('tp_v2_srv_');
    addTearDown(() => tmp.deleteSync(recursive: true));
    final webRoot = Directory(p.join(tmp.path, 'web'))..createSync();
    File(p.join(webRoot.path, 'index.html')).writeAsStringSync('<html></html>');

    _createTipitakaV2Fixtures(tmp.path);
    _createUnifiedDictV2(p.join(tmp.path, 'dictionaries.db'));
    _createTranslationV2(p.join(tmp.path, 'translation_en.db'));
    _createBoldDefinitionsV2(tmp.path);
    _createValidFtsDb(p.join(tmp.path, 'fts_tipitaka.db'));

    expect(BoldDefinitionIndexService.isUpToDate(tmp.path), isTrue);

    final api = TipitakaWebApi(
      dbDirectoryPath: tmp.path,
      dpdFamilyTemplates: DpdFamilyTemplates(familyCompounds: const {}),
    );
    final server = TipitakaLocalServer(
      preferredPort: 0,
      explicitWebRootDir: webRoot,
      useBackgroundIsolate: false,
      aiUpstreamBaseUri: Uri.parse('http://127.0.0.1:1'),
      api: api,
    );
    final uri = await server.ensureStarted();
    addTearDown(server.dispose);

    // 1. Dictionary lookup across all 6 sources + synonym expansion + ## misc.
    final nibbRes = await _httpGet(uri, '/api/dict/lookup?w=${Uri.encodeQueryComponent('nibbānassa')}');
    expect(nibbRes.statusCode, 200);
    final nibbJson = jsonDecode(nibbRes.body) as Map<String, dynamic>;
    expect(nibbJson['synonyms'], contains('nibbāna'));
    expect(nibbJson['counts']['dpd'], 1);
    expect(nibbJson['counts']['pts'], 1);
    expect(nibbJson['counts']['abd'], 1);
    expect(nibbJson['counts']['psd'], 1);

    final splitRes = await _httpGet(uri, '/api/dict/lookup?w=${Uri.encodeQueryComponent('paṭiccasamuppādo')}');
    expect((jsonDecode(splitRes.body)['counts'] as Map)['splitter'], 1);

    final sansRes = await _httpGet(uri, '/api/dict/lookup?w=abaddha');
    expect((jsonDecode(sansRes.body)['counts'] as Map)['sans'], 1);

    final miscRes = await _httpGet(uri, '/api/dict/lookup?w=${Uri.encodeQueryComponent('##tipitakapalidpdfeedback')}');
    expect((jsonDecode(miscRes.body)['counts'] as Map)['dpd'], 1);

    // 2. Inflection by dict_inflections.key.
    final infRes = await _httpGet(uri, '/api/dict/inf?w=nibb%C4%81na_1');
    expect(infRes.statusCode, 200);
    final infJson = jsonDecode(infRes.body) as Map<String, dynamic>;
    expect(infJson['word'], 'nibbāna');
    expect(infJson['html'], contains('nibbānaṃ'));

    // 3. /api/dict/suggest with ASCII folded, Myanmar, and Sinhala inputs.
    final suggestAscii = await _httpGet(uri, '/api/dict/suggest?q=paticca&limit=10');
    expect(suggestAscii.statusCode, 200);
    final suggList = (jsonDecode(suggestAscii.body)['suggestions'] as List).cast<Map<String, dynamic>>();
    expect(suggList.map((s) => s['word']), contains('paṭicca'));
    expect(suggList.first['preview'], contains('dependent'));

    final suggestMm = await _httpGet(uri, '/api/dict/suggest?q=${Uri.encodeQueryComponent('ပဋိစ္စ')}');
    expect(
      (jsonDecode(suggestMm.body)['suggestions'] as List).map((e) => e['word']),
      contains('paṭicca'),
    );

    final suggestSi = await _httpGet(uri, '/api/dict/suggest?q=${Uri.encodeQueryComponent('පටිච්ච')}');
    expect(
      (jsonDecode(suggestSi.body)['suggestions'] as List).map((e) => e['word']),
      contains('paṭicca'),
    );

    // 4. V2 translation_en.db (bundle, raw, detailed, guid, ai sentences).
    final bundleRes = await _httpGet(
      uri,
      '/api/book/s0101m.mul/chapter/0/bundle?lang=en&sentences=1&links=1',
    );
    expect(bundleRes.statusCode, 200);
    final bundleJson = jsonDecode(bundleRes.body) as Map<String, dynamic>;
    expect(bundleJson['translations']['en']['0'], '<b>Thus</b> have I heard.');
    expect(bundleJson['sentences']['en']['0'][0]['translation'], 'Thus have I heard.');
    expect(bundleJson['links']['0'][0]['word'], 'evaṃ');

    final detailedRes = await _httpGet(
      uri,
      '/api/book/s0101m.mul/chapter/0/translation?lang=en&detailed=1',
    );
    expect(detailedRes.statusCode, 200);
    expect(
      jsonDecode(detailedRes.body)['paragraphs']['0']['translations']['en']['text'],
      '<b>Thus</b> have I heard.',
    );

    final guidRes = await _httpGet(uri, '/api/translation/guid/s0101m.mul:c0:n0:p0?lang=en');
    expect(guidRes.statusCode, 200);
    expect(jsonDecode(guidRes.body)['translations']['en']['text'], '<b>Thus</b> have I heard.');

    final aiSentRes = await _httpGet(
      uri,
      '/api/ai/sentences?book_code=s0101m.mul&chapter_index=0&para_index=0&langs=en',
    );
    expect(aiSentRes.statusCode, 200);
    final aiSentJson = jsonDecode(aiSentRes.body) as Map<String, dynamic>;
    expect(aiSentJson['translations']['en'][0]['translation'], 'Thus have I heard.');
  });

  test('DictionaryRepository and TipitakaRepository read V2 dictionaries.db and chapter_trans_pack', () {
    final tmp = Directory.systemTemp.createTempSync('tp_v2_repo_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    _createTipitakaV2Fixtures(tmp.path);
    final dictPath = p.join(tmp.path, 'dictionaries.db');
    _createUnifiedDictV2(dictPath);
    final transPath = p.join(tmp.path, 'translation_en.db');
    _createTranslationV2(transPath);
    final paliSentPath = p.join(tmp.path, 'pali_sentences.db');
    final paliSentDb = sqlite3.open(paliSentPath);
    try {
      paliSentDb.execute('''
        CREATE TABLE pali_sentences (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          sentence TEXT NOT NULL,
          PRIMARY KEY (book_code, chapter_index, para_index, line_id)
        );
      ''');
      paliSentDb.execute(
        "INSERT INTO pali_sentences VALUES ('s0101m.mul', 0, 0, 1, 'Evaṃ me sutaṃ.');",
      );
    } finally {
      paliSentDb.close();
    }

    final dictRepo = DictionaryRepository();
    final lookup = dictRepo.lookup(
      'nibbānassa',
      DictionaryDbPaths(unifiedDictDbPath: dictPath),
    );
    expect(lookup.synonyms, contains('nibbāna'));
    expect(lookup.countFor(DictSource.dpd), 1);
    expect(lookup.countFor(DictSource.pts), 1);
    expect(lookup.countFor(DictSource.abd), 1);
    expect(lookup.countFor(DictSource.psd), 1);

    final inf = dictRepo.lookupInflection(
      null,
      'declension_nibbāna_1',
      unifiedDictDbPath: dictPath,
    );
    expect(inf, isNotNull);
    expect(inf!.word, 'nibbāna');
    expect(inf.rows.first.last.forms, contains('nibbānaṃ'));

    final tipiRepo = TipitakaRepository();
    final directEntries = tipiRepo.lookupWord(
      rawWord: 'nibbānassa',
      unifiedDictDbPath: dictPath,
    );
    expect(directEntries.any((e) => e.source == DictSource.dpd), isTrue);

    final chapter = tipiRepo.loadChapter(
      p.join(tmp.path, 'tipitaka.db'),
      rawBookCode: 's0101m.mul0',
      translationDbPath: transPath,
      translationLangCode: 'en',
      paliSentencesDbPath: paliSentPath,
    );
    expect(chapter.paragraphs.single.translationText, 'Thus have I heard.');
    expect(
      chapter.paragraphs.single.sentences.single.translationsByLang['en'],
      'Thus have I heard.',
    );
  });

  test('DbStorageService accepts both V2 chapter_trans_pack and V1 paragraph_translations', () async {
    final tmp = Directory.systemTemp.createTempSync('tp_v2_store_');
    addTearDown(() => tmp.deleteSync(recursive: true));
    final v2Trans = p.join(tmp.path, 'translation_en.db');
    _createTranslationV2(v2Trans);
    final v1Trans = p.join(tmp.path, 'translation_vi.db');
    final viDb = sqlite3.open(v1Trans);
    try {
      viDb.execute('CREATE TABLE paragraph_translations (id INTEGER PRIMARY KEY);');
      viDb.execute('INSERT INTO paragraph_translations VALUES (1);');
    } finally {
      viDb.close();
    }
    final corrupt = p.join(tmp.path, 'translation_fr.db');
    File(corrupt).writeAsBytesSync([0, 1, 2]);

    final storage = DbStorageService(overrideDirectory: tmp);
    final invalid = await storage.findInvalidInstalledDatabases(
      compulsoryChecks: const [],
      installedEntries: [
        (filename: 'translation_en.db', path: v2Trans),
        (filename: 'translation_vi.db', path: v1Trans),
        (filename: 'translation_fr.db', path: corrupt),
      ],
    );
    expect(invalid, equals(['translation_fr.db']));
  });

  test('DownloadController Option A keeps V1 users reading, surfaces dictionaries.db update, and cleans legacy dicts after install', () async {
    SharedPreferences.setMockInitialValues({
      'onboarding_completed_v1': true,
      'onboarding_in_progress_v1': false,
      'installed_asset_meta_dpd_tipitakapali.db': '{"version":1,"updated":"2026-11-14"}',
      'installed_asset_meta_ptsped2015ed_tipitakapali.db': '{"version":1,"updated":"2026-11-14"}',
    });

    final tmp = Directory.systemTemp.createTempSync('tp_v2_optA_');
    addTearDown(() => tmp.deleteSync(recursive: true));
    final dbDir = Directory(p.join(tmp.path, 'dbs'))..createSync(recursive: true);

    _createTipitakaV2Fixtures(dbDir.path);
    _createValidFtsDb(p.join(dbDir.path, 'fts_tipitaka.db'));
    _createBoldDefinitionsV2(dbDir.path);

    // Seed legacy V1 dictionary DBs (minimum valid SQLite files).
    for (final legacy in const [
      'dpd_tipitakapali.db',
      'dpd_synonyms_tipitakapali.db',
      'ptsped2015ed_tipitakapali.db',
    ]) {
      final db = sqlite3.open(p.join(dbDir.path, legacy));
      try {
        db.execute('CREATE TABLE misc (key TEXT, val TEXT);');
      } finally {
        db.close();
      }
    }

    // Build a valid V2 dictionaries.db outside dbDir to import later.
    final importDictPath = p.join(tmp.path, 'import_dictionaries.db');
    _createUnifiedDictV2(importDictPath);
    final importBytes = await File(importDictPath).readAsBytes();
    final importSha = await DbStorageService.computeFileSha256(importDictPath);

    final tipitakaSha = await DbStorageService.computeFileSha256(
      p.join(dbDir.path, 'tipitaka.db'),
    );
    final boldSha = await DbStorageService.computeFileSha256(
      p.join(dbDir.path, 'bold_definitions.db'),
    );

    final v2ManifestJson = jsonEncode({
      'version': 1,
      'releaseRepo': 'tipitakapali/tipitakapali.org',
      'releaseTag': 'db-v2',
      'core': {
        'tipitaka': {
          'id': 'tipitaka',
          'filename': 'tipitaka.db',
          'assetName': 'tipitaka.db.zip',
          'title': 'Tipitaka',
          'category': 'core',
          'compulsory': true,
          'version': 2,
          'updated': '2026-11-17',
          'checksum': tipitakaSha,
          'dbSize': File(p.join(dbDir.path, 'tipitaka.db')).lengthSync(),
          'requiredTables': ['books', 'chapters', 'tree_nodes', 'canon_paragraphs'],
        },
      },
      'dictionaries': {
        'bold_definitions': {
          'id': 'bold_definitions',
          'filename': 'bold_definitions.db',
          'assetName': 'bold_definitions.db.zip',
          'title': 'Bold Definitions',
          'category': 'dictionary',
          'compulsory': true,
          'version': 2,
          'updated': '2026-11-21',
          'checksum': boldSha,
          'dbSize': File(p.join(dbDir.path, 'bold_definitions.db')).lengthSync(),
          'requiredTables': ['bold_definitions', 'chapter_links', 'meta'],
        },
        'dictionaries': {
          'id': 'dictionaries',
          'filename': 'dictionaries.db',
          'assetName': 'dictionaries.db.zip',
          'title': 'Unified Dictionaries (V2)',
          'category': 'dictionary',
          'compulsory': true,
          'version': 1,
          'updated': '2026-11-21',
          'checksum': importSha,
          'dbSize': importBytes.length,
          'requiredTables': ['dict_meta', 'dict_entries', 'dict_synonyms', 'dict_inflections'],
        },
      },
      'languages': <String, dynamic>{},
    });

    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(
          DbStorageService(overrideDirectory: dbDir),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            client: MockClient((_) async => http.Response('', 404)),
            assetLoader: (_) async => v2ManifestJson,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);

    final before = container.read(downloadControllerProvider);
    expect(before.allCompulsoryInstalled, isTrue);
    expect(before.needsOnboarding, isFalse);
    expect(before.installedDbs.containsKey('dictionaries.db'), isFalse);
    expect(before.installedDbs.containsKey('dpd_tipitakapali.db'), isTrue);
    expect(
      before.availableUpdates.map((u) => u.asset.filename),
      contains('dictionaries.db'),
    );

    await controller.importLocalArchiveOrDb(
      localPath: importDictPath,
      targetAsset: before.manifest!.dictionaries['dictionaries']!,
    );

    final after = container.read(downloadControllerProvider);
    expect(after.installedDbs.containsKey('dictionaries.db'), isTrue);
    expect(after.installedDbs.containsKey('dpd_tipitakapali.db'), isFalse);
    expect(after.installedDbs.containsKey('dpd_synonyms_tipitakapali.db'), isFalse);
    expect(after.installedDbs.containsKey('ptsped2015ed_tipitakapali.db'), isFalse);
    expect(after.availableUpdates, isEmpty);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('installed_asset_meta_dpd_tipitakapali.db'), isNull);
    expect(prefs.getString('installed_asset_meta_ptsped2015ed_tipitakapali.db'), isNull);
    expect(prefs.getString('installed_asset_meta_dictionaries.db'), isNotNull);
  });
}
