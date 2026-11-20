import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/server/dpd_family_templates.dart';
import 'package:tipitakapali_app/core/server/tipitaka_local_server.dart';
import 'package:tipitakapali_app/core/server/tipitaka_web_api.dart';
import 'package:tipitakapali_app/core/services/bold_definition_index_service.dart';

Future<({int statusCode, String contentType, String body})> _httpGet(
  Uri baseUri,
  String pathAndQuery,
) async {
  final client = HttpClient();
  try {
    final target = baseUri.resolve(
      pathAndQuery.startsWith('/') ? pathAndQuery.substring(1) : pathAndQuery,
    );
    final req = await client.getUrl(target);
    final resp = await req.close();
    final body = await utf8.decodeStream(resp);
    return (
      statusCode: resp.statusCode,
      contentType: resp.headers.contentType?.mimeType ?? '',
      body: body,
    );
  } finally {
    client.close(force: true);
  }
}

Future<({int statusCode, String contentType, String body})> _httpPostJson(
  Uri baseUri,
  String pathAndQuery,
  Object payload,
) async {
  final client = HttpClient();
  try {
    final target = baseUri.resolve(
      pathAndQuery.startsWith('/') ? pathAndQuery.substring(1) : pathAndQuery,
    );
    final req = await client.postUrl(target);
    req.headers.contentType = ContentType.json;
    req.write(jsonEncode(payload));
    final resp = await req.close();
    final body = await utf8.decodeStream(resp);
    return (
      statusCode: resp.statusCode,
      contentType: resp.headers.contentType?.mimeType ?? '',
      body: body,
    );
  } finally {
    client.close(force: true);
  }
}

void _seedTestDatabases(String dbDir) {
  // 1. tipitaka.db
  final core = sqlite3.open(p.join(dbDir, 'tipitaka.db'));
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
      "VALUES ('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', 'mūla', 's0101m.mul.xml', 2);",
    );
    core.execute(
      "INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html) VALUES "
      "(1, 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 'ch0', 'chap-0', 0, '<p class=\"bodytext\" data-para=\"1\">Evaṃ me sutaṃ.</p>'), "
      "(1, 's0101m.mul', 1, '2. Sāmaññaphalasuttaṃ', 'ch1', 'chap-1', 1, '<p class=\"bodytext\" data-para=\"2\">Tena samayena.</p>');",
    );
    core.execute(
      "INSERT INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index) VALUES "
      "(1, 'Suttapiṭaka', NULL, 'category', NULL, NULL), "
      "(2, '1. Brahmajālasuttaṃ', 1, 'chapter', 's0101m.mul', 0);",
    );
    core.execute(
      "INSERT INTO book_toc (book_id, book_code, item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index) VALUES "
      "(1, 's0101m.mul', 0, 1, 'sutta', 'title', '1. Brahmajālasuttaṃ', 0, '1', 'chap-0', 0);",
    );
    core.execute(
      "INSERT INTO book_mat (book_code, category, mula_code, mula_title, attha_code, attha_title) VALUES "
      "('s0101m.mul', 'mūla', 's0101m.mul', 'Sīlakkhandhavaggapāḷi', 's0101a.att', 'Sīlakkhandhavagga-aṭṭhakathā');",
    );
    core.execute(
      "INSERT INTO mat_chapter_map (source_book, source_chapter, mula_book, mula_chapter, mula_title, attha_book, attha_chapter, attha_title) VALUES "
      "('s0101m.mul', 0, 's0101m.mul', 0, 'Brahmajālasuttaṃ', 's0101a.att', 0, 'Brahmajālasuttavaṇṇanā');",
    );
    core.execute(
      "INSERT INTO mat_para_map (source_book, source_chapter, source_para, attha_book, attha_chapter, attha_para, attha_title) VALUES "
      "('s0101m.mul', 0, '1', 's0101a.att', 0, '1', 'Brahmajālasuttavaṇṇanā');",
    );
    core.execute(
      "INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES "
      "('s0101m.mul', 0, 0, 1, 'Evaṃ me sutaṃ.');",
    );
    core.execute(
      "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text) VALUES "
      "('s0101m.mul:c0:n0:p1', 's0101m.mul', 0, 0, '1', 'bodytext', 'Evaṃ me sutaṃ.');",
    );
  } finally {
    core.close();
  }

  // 2. translation_en.db
  final trans = sqlite3.open(p.join(dbDir, 'translation_en.db'));
  try {
    trans.execute('''
      CREATE TABLE translation_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE paragraph_translations (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        guid TEXT,
        para_num TEXT,
        translation TEXT,
        sentence_count INTEGER,
        sentences_json TEXT
      );
    ''');
    trans.execute(
      "INSERT INTO translation_meta (key, value) VALUES "
      "('language', 'en'), ('name', 'English'), ('native_name', 'English'), ('flag', '🇬🇧');",
    );
    trans.execute(
      "INSERT INTO paragraph_translations (book_code, chapter_index, para_index, guid, para_num, translation, sentence_count, sentences_json) VALUES "
      "('s0101m.mul', 0, 0, 's0101m.mul:c0:n0:p1', '1', 'Thus have I heard.', 1, '[\"Thus have I heard.\"]');",
    );
  } finally {
    trans.close();
  }

  // 3. fts_tipitaka.db (using regular table or FTS5 fallback)
  final fts = sqlite3.open(p.join(dbDir, 'fts_tipitaka.db'));
  try {
    fts.execute('''
      CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
        book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content
      );
    ''');
    fts.execute(
      "INSERT INTO paragraphs_fts (book_code, book_title, nikaya, para_num, para_index, para_rend, content) VALUES "
      "('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', '1', 0, 'bodytext', 'Evaṃ me sutaṃ bhagavā.');",
    );
  } finally {
    fts.close();
  }

  // 4. dpd_tipitakapali.db
  final dpd = sqlite3.open(p.join(dbDir, 'dpd_tipitakapali.db'));
  try {
    dpd.execute('''
      CREATE TABLE bhz (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, defi TEXT NOT NULL);
      CREATE TABLE misc (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, defi TEXT NOT NULL);
    ''');
    dpd.execute(
      'INSERT INTO bhz (word, defi) VALUES (?, ?)',
      [
        'bhagavant',
        '@{"id":1,"lemma":"bhagavant","family_compounds":["bhagavant"]}'
            '@<section class=dp9><span class=p1w>bhagavant 1</span>'
            '<div class=dpd><p>masc. <b>Blessed One</b></p>'
            '<div>bhagavant_fc</div><p><a href="L#1@">Feedback</a></p>'
            '</div><div class=footer>DPD entry</div></section>',
      ],
    );
    dpd.execute(
      'INSERT INTO misc (word, defi) VALUES (?, ?)',
      ['evaṃ', '<section class=dp9><p>ind. thus, so</p></section>'],
    );
  } finally {
    dpd.close();
  }

  // 4b. dpd_inflection_tipitakapali.db
  final infDb = sqlite3.open(p.join(dbDir, 'dpd_inflection_tipitakapali.db'));
  try {
    infDb.execute(
      'CREATE TABLE bhz (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, defi TEXT NOT NULL);',
    );
    infDb.execute(
      'INSERT INTO bhz (word, defi) VALUES (?, ?)',
      ['bhagavant', '<table><tr><th>nom sg</th><td>bhagavā</td></tr></table>'],
    );
  } finally {
    infDb.close();
  }

  // 5. dpd_synonyms_tipitakapali.db
  final syn = sqlite3.open(p.join(dbDir, 'dpd_synonyms_tipitakapali.db'));
  try {
    syn.execute(
      'CREATE TABLE bhz (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, synonym TEXT);',
    );
    syn.execute(
      'INSERT INTO bhz (word, synonym) VALUES (?, ?)',
      ['bhagavant', 'bhagavā'],
    );
  } finally {
    syn.close();
  }

  // 6. dpd_splitter_tipitakapali.db
  final split = sqlite3.open(p.join(dbDir, 'dpd_splitter_tipitakapali.db'));
  try {
    split.execute(
      'CREATE TABLE evz (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, defi TEXT NOT NULL);',
    );
    split.execute(
      'INSERT INTO evz (word, defi) VALUES (?, ?)',
      ['evaṃme', 'evaṃ + me'],
    );
  } finally {
    split.close();
  }
}

void main() {
  late Directory tmpDir;
  late Directory webRoot;
  late TipitakaLocalServer server;
  late Uri baseUri;

  setUpAll(() async {
    tmpDir = Directory.systemTemp.createTempSync('tp_local_server_test_');
    webRoot = Directory(p.join(tmpDir.path, 'web_root'))..createSync();
    Directory(p.join(webRoot.path, '_next', 'static')).createSync(recursive: true);
    File(p.join(webRoot.path, 'index.html'))
        .writeAsStringSync('<!doctype html><html><body>OK</body></html>');
    File(p.join(webRoot.path, '_next', 'static', 'app.js'))
        .writeAsStringSync('console.log("tipitakapali offline");');

    _seedTestDatabases(tmpDir.path);

    final familyTemplates = DpdFamilyTemplates(
      familyCompounds: {
        'bhagavant': {
          'data': [
            ['bhagavant', 'adj', 'fortunate, blessed', '√bhaj'],
          ],
        },
      },
    );

    server = TipitakaLocalServer(
      preferredPort: 0,
      explicitWebRootDir: webRoot,
      aiUpstreamBaseUri: Uri.parse('http://127.0.0.1:1'),
      api: TipitakaWebApi(
        dbDirectoryPath: tmpDir.path,
        dpdFamilyTemplates: familyTemplates,
      ),
    );
    baseUri = await server.ensureStarted();
  });

  tearDownAll(() async {
    await server.dispose();
    tmpDir.deleteSync(recursive: true);
  });

  test('serves static web bundle, MIME types, and SPA fallback for /book and /chapter', () async {
    final root = await _httpGet(baseUri, '/');
    expect(root.statusCode, 200);
    expect(root.contentType, 'text/html');
    expect(root.body, contains('OK'));

    final js = await _httpGet(baseUri, '/_next/static/app.js');
    expect(js.statusCode, 200);
    expect(js.contentType, 'application/javascript');
    expect(js.body, contains('tipitakapali offline'));

    final spaBook = await _httpGet(baseUri, '/book/s0101m.mul');
    expect(spaBook.statusCode, 200);
    expect(spaBook.contentType, 'text/html');

    final spaChapter = await _httpGet(baseUri, '/chapter/s0101m.mul/0');
    expect(spaChapter.statusCode, 200);
    expect(spaChapter.contentType, 'text/html');

    final spaTranslation = await _httpGet(baseUri, '/translation/vi/s0101m.mul');
    expect(spaTranslation.statusCode, 200);
    expect(spaTranslation.contentType, 'text/html');

    // Static Cloudflare JSON endpoints must 404 so api.js uses live SQLite API endpoints
    final staticJson = await _httpGet(baseUri, '/api/book/s0101m.mul/mat_para_map.json');
    expect(staticJson.statusCode, 404);
  });

  test('serves core Tipitaka tree, book, buffered chapters, TOC, MAT, and MAT jump routes', () async {
    final health = await _httpGet(baseUri, '/api/health');
    expect(health.statusCode, 200);
    expect(jsonDecode(health.body)['status'], 'healthy');

    final tree = await _httpGet(baseUri, '/api/tree');
    expect(tree.statusCode, 200);
    final treeData = jsonDecode(tree.body) as List;
    expect(treeData.first['text'], 'Suttapiṭaka');
    expect((treeData.first['children'] as List).first['book_code'], 's0101m.mul');

    final books = await _httpGet(baseUri, '/api/books');
    expect(books.statusCode, 200);
    expect((jsonDecode(books.body)['books'] as List).length, 1);

    final tocOnly = await _httpGet(baseUri, '/api/book/s0101m.mul?tocOnly=true');
    expect(tocOnly.statusCode, 200);
    final tocOnlyJson = jsonDecode(tocOnly.body) as Map<String, dynamic>;
    expect(tocOnlyJson['toc'], hasLength(1));
    expect(tocOnlyJson['html'], '');
    expect(tocOnlyJson['chapters_data'], isEmpty);

    final buffered = await _httpGet(baseUri, '/api/book/s0101m.mul?chapter=0&buffer=0');
    expect(buffered.statusCode, 200);
    final bufferedJson = jsonDecode(buffered.body) as Map<String, dynamic>;
    expect(bufferedJson['chapters_data']['0'], contains('Evaṃ me sutaṃ'));
    expect(bufferedJson['chapters_data']['1'], isNull);

    final ch0 = await _httpGet(baseUri, '/api/book/s0101m.mul/chapter/0');
    expect(ch0.statusCode, 200);
    expect(jsonDecode(ch0.body)['html'], contains('Evaṃ me sutaṃ'));

    final matJump = await _httpGet(baseUri, '/api/book/s0101m.mul/mat_jump?chapter=0&para=1');
    expect(matJump.statusCode, 200);
    final jumpJson = jsonDecode(matJump.body) as Map<String, dynamic>;
    expect(jumpJson['attha']['book'], 's0101a.att');
    expect(jumpJson['attha']['para'], '1');
  });

  test('serves translations, FTS5 search, DPD dictionary lookup with family templates, and inflections', () async {
    final langs = await _httpGet(baseUri, '/api/translations');
    expect(langs.statusCode, 200);
    final langsJson = jsonDecode(langs.body) as Map<String, dynamic>;
    expect((langsJson['available'] as List).first['code'], 'en');
    expect(langsJson['has_pali_sentences'], isFalse);

    final trCh0 = await _httpGet(baseUri, '/api/book/s0101m.mul/chapter/0/translation?lang=en');
    expect(trCh0.statusCode, 200);
    expect(
      (jsonDecode(trCh0.body)['translations'] as Map)['en']['0'],
      'Thus have I heard.',
    );

    final searchDbs = await _httpGet(baseUri, '/api/search/databases');
    expect(searchDbs.statusCode, 200);
    expect((jsonDecode(searchDbs.body)['databases'] as List).first['id'], 'fts_tipitaka.db');

    final searchRes = await _httpGet(
      baseUri,
      '/api/search?q=${Uri.encodeQueryComponent('evaṃ')}&db=fts_tipitaka.db',
    );
    expect(searchRes.statusCode, 200);
    final searchJson = jsonDecode(searchRes.body) as Map<String, dynamic>;
    expect(searchJson['total'], greaterThanOrEqualTo(1));
    expect((searchJson['results'] as List).first['book_code'], 's0101m.mul');

    final dictRes = await _httpGet(
      baseUri,
      '/api/dict/lookup?w=${Uri.encodeQueryComponent('bhagavā')}',
    );
    expect(dictRes.statusCode, 200);
    final dictJson = jsonDecode(dictRes.body) as Map<String, dynamic>;
    expect(dictJson['hasResults'], isTrue);
    final firstHtml = (dictJson['dpd'] as List).first['html'] as String;
    expect(firstHtml, contains('Blessed One'));
    expect(firstHtml, contains('fortunate, blessed'));
    expect(firstHtml, contains('https://docs.google.com/forms/'));
    expect(firstHtml, contains('class="dpd-footer"'));

    final splitRes = await _httpGet(
      baseUri,
      '/api/dict/lookup?w=${Uri.encodeQueryComponent('evaṃme')}',
    );
    expect(splitRes.statusCode, 200);
    final splitJson = jsonDecode(splitRes.body) as Map<String, dynamic>;
    expect(splitJson['hasResults'], isTrue);
    final splitHtml = (splitJson['splitter'] as List).first['html'] as String;
    expect(splitHtml, contains('evaṃ'));
    expect(splitHtml, contains('dec-plus'));

    final infRes = await _httpGet(baseUri, '/api/dict/inf?w=bhagavant');
    expect(infRes.statusCode, 200);
    expect(jsonDecode(infRes.body)['html'], contains('nom sg'));
  });

  test('serves pali_sentences, pali_sentences.json, has_pali_sentences, and sentence_translations fallback', () async {
    final sentDb = sqlite3.open(p.join(tmpDir.path, 'pali_sentences.db'));
    try {
      sentDb.execute('''
        CREATE TABLE pali_sentences (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          sentence TEXT NOT NULL
        );
      ''');
      sentDb.execute(
        "INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES "
        "('s0101m.mul', 0, 0, 0, 'Evaṃ me sutaṃ.');",
      );
    } finally {
      sentDb.close();
    }

    final viDb = sqlite3.open(p.join(tmpDir.path, 'translation_vi.db'));
    try {
      viDb.execute('''
        CREATE TABLE translation_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE paragraph_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          guid TEXT,
          para_num TEXT,
          translation TEXT,
          sentence_count INTEGER,
          sentences_json TEXT
        );
        CREATE TABLE sentence_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          translation TEXT
        );
      ''');
      viDb.execute(
        "INSERT INTO translation_meta (key, value) VALUES "
        "('language', 'vi'), ('name', 'Vietnamese'), ('native_name', 'Tiếng Việt');",
      );
      viDb.execute(
        "INSERT INTO paragraph_translations (book_code, chapter_index, para_index, guid, para_num, translation, sentence_count, sentences_json) VALUES "
        "('s0101m.mul', 0, 0, 's0101m.mul:c0:n0:p1', '1', 'Tôi đã nghe như vầy.', 1, NULL);",
      );
      viDb.execute(
        "INSERT INTO sentence_translations (book_code, chapter_index, para_index, line_id, translation) VALUES "
        "('s0101m.mul', 0, 0, 0, 'Tôi đã nghe như vầy.');",
      );
    } finally {
      viDb.close();
    }

    server.api.invalidateDatabases();

    final langsAfter = await _httpGet(baseUri, '/api/translations');
    expect(langsAfter.statusCode, 200);
    final langsJson = jsonDecode(langsAfter.body) as Map<String, dynamic>;
    expect(langsJson['has_pali_sentences'], isTrue);

    final paliSent = await _httpGet(baseUri, '/api/book/s0101m.mul/pali_sentences');
    expect(paliSent.statusCode, 200);
    final paliSentJson = jsonDecode(paliSent.body) as Map<String, dynamic>;
    expect(paliSentJson['chapters']['0']['0'][0]['text'], 'Evaṃ me sutaṃ.');

    final paliSentJsonRoute = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/pali_sentences.json',
    );
    expect(paliSentJsonRoute.statusCode, 200);
    expect(
      jsonDecode(paliSentJsonRoute.body)['chapters']['0']['0'][0]['text'],
      'Evaṃ me sutaṃ.',
    );

    final multiSent = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/chapter/0/translation?lang=en%2Cvi&sentences=1',
    );
    expect(multiSent.statusCode, 200);
    final multiJson = jsonDecode(multiSent.body) as Map<String, dynamic>;
    expect(multiJson['sentences']['en']['0'], ['Thus have I heard.']);
    expect(multiJson['sentences']['vi']['0'], [
      {'line_id': 0, 'translation': 'Tôi đã nghe như vầy.'},
    ]);
  });

  test('serves Ani citation quickview and tool endpoints offline', () async {
    final core = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
    try {
      core.execute(
        "UPDATE canon_paragraphs SET chapter_title = '1. Brahmajālasuttaṃ', "
        "sutta_title = 'Brahmajālasuttaṃ' WHERE guid = 's0101m.mul:c0:n0:p1';",
      );
      core.execute(
        "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, rend, pali_text) VALUES "
        "('s0101m.mul:c0:n1:p2', 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 'Brahmajālasuttaṃ', 1, '2', 'bodytext', 'Tena samayena bhagavā.');",
      );
    } finally {
      core.close();
    }

    final transVi = sqlite3.open(p.join(tmpDir.path, 'translation_vi.db'));
    try {
      transVi.execute('''
        CREATE TABLE IF NOT EXISTS translation_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS paragraph_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          guid TEXT,
          para_num TEXT,
          translation TEXT,
          sentence_count INTEGER,
          sentences_json TEXT
        );
        CREATE TABLE IF NOT EXISTS sentence_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          translation TEXT
        );
      ''');
      transVi.execute(
        "DELETE FROM paragraph_translations WHERE book_code = 's0101m.mul' AND chapter_index = 0 AND para_index = 0;",
      );
      transVi.execute(
        "INSERT INTO paragraph_translations (book_code, chapter_index, para_index, guid, para_num, translation, sentence_count, sentences_json) VALUES "
        "('s0101m.mul', 0, 0, 's0101m.mul:c0:n0:p1', '1', 'Tôi đã nghe như vầy.', 1, NULL);",
      );
      transVi.execute(
        "DELETE FROM sentence_translations WHERE book_code = 's0101m.mul' AND chapter_index = 0 AND para_index = 0;",
      );
      transVi.execute(
        "INSERT INTO sentence_translations (book_code, chapter_index, para_index, line_id, translation) VALUES "
        "('s0101m.mul', 0, 0, 1, 'Tôi đã nghe như vầy.');",
      );
    } finally {
      transVi.close();
    }
    server.api.invalidateDatabases();

    // 1. Canonical CitationQuickviewModal paragraph lookup
    final paraRes = await _httpGet(
      baseUri,
      '/api/ai/paragraph_content?book=s0101m.mul&chapter=0&start=0&end=1&langs=en,vi',
    );
    expect(paraRes.statusCode, 200);
    final paraJson = jsonDecode(paraRes.body) as Map<String, dynamic>;
    expect(paraJson['success'], isTrue);
    expect(paraJson['count'], 2);
    final first = (paraJson['passages'] as List).first as Map<String, dynamic>;
    expect(first['book_code'], 's0101m.mul');
    expect(first['book_title'], 'Sīlakkhandhavaggapāḷi');
    expect(first['pali'], 'Evaṃ me sutaṃ.');
    expect(first['translations']['en'], 'Thus have I heard.');
    expect(first['translations']['vi'], 'Tôi đã nghe như vầy.');
    expect(first['citation_ref'], '[s0101m.mul:c0:p0]');

    // 2. Short alias (dn1) + para_num fallback (para 1 when start=1)
    final aliasRes = await _httpGet(
      baseUri,
      '/api/ai/paragraph_content?book=dn1&chapter=0&start=0&end=0&langs=en',
    );
    expect(aliasRes.statusCode, 200);
    final aliasJson = jsonDecode(aliasRes.body) as Map<String, dynamic>;
    expect(aliasJson['success'], isTrue);
    expect((aliasJson['passages'] as List).first['pali'], 'Evaṃ me sutaṃ.');

    // 3. Sentence-level citation lookup (/api/ai/sentences)
    final sentRes = await _httpGet(
      baseUri,
      '/api/ai/sentences?book=s0101m.mul&chapter=0&para_index=0&langs=en,vi',
    );
    expect(sentRes.statusCode, 200);
    final sentJson = jsonDecode(sentRes.body) as Map<String, dynamic>;
    expect(sentJson['success'], isTrue);
    expect(sentJson['book_code'], 's0101m.mul');
    expect((sentJson['pali_sentences'] as List).first['sentence'], 'Evaṃ me sutaṃ.');
    expect(sentJson['translations']['en'], [
      {'line_id': 1, 'translation': 'Thus have I heard.'},
    ]);
    expect(sentJson['translations']['vi'], [
      {'line_id': 1, 'translation': 'Tôi đã nghe như vầy.'},
    ]);

    // 4. Fallback to canon_paragraphs when pali_sentences has no rows for para 1
    final sentFallbackRes = await _httpGet(
      baseUri,
      '/api/ai/sentences?book=s0101m.mul&chapter=0&para_index=1&langs=en',
    );
    expect(sentFallbackRes.statusCode, 200);
    final sentFallbackJson =
        jsonDecode(sentFallbackRes.body) as Map<String, dynamic>;
    expect(sentFallbackJson['success'], isTrue);
    expect(
      (sentFallbackJson['pali_sentences'] as List).first['sentence'],
      'Tena samayena bhagavā.',
    );

    // 5. Tools, books, batch paragraphs, and POST /api/ai/tool-call
    final toolsRes = await _httpGet(baseUri, '/api/ai/tools');
    expect(toolsRes.statusCode, 200);
    expect((jsonDecode(toolsRes.body)['tools'] as List), isNotEmpty);

    final booksRes = await _httpGet(baseUri, '/api/ai/books');
    expect(booksRes.statusCode, 200);
    expect(jsonDecode(booksRes.body)['success'], isTrue);
    expect(jsonDecode(booksRes.body)['count'], 1);

    final batchRes = await _httpPostJson(
      baseUri,
      '/api/ai/paragraph_content_batch',
      {
        'ranges': [
          {'book_code': 's0101m.mul', 'chapter_index': 0, 'para_start': 0, 'para_end': 0},
        ],
      },
    );
    expect(batchRes.statusCode, 200);
    expect(jsonDecode(batchRes.body)['count'], 1);

    final toolCallRes = await _httpPostJson(baseUri, '/api/ai/tool-call', {
      'name': 'get_sentences',
      'args': {'book_code': 'dn1', 'chapter_index': 0, 'para_index': 0, 'line_id': 1},
    });
    expect(toolCallRes.statusCode, 200);
    final toolCallJson = jsonDecode(toolCallRes.body) as Map<String, dynamic>;
    expect(toolCallJson['success'], isTrue);
    expect((toolCallJson['pali_sentences'] as List).single['line_id'], 1);
  });

  test('proxies AI requests to online tipitakapali.org upstream first', () async {
    final upstream = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final seenRequests = <String>[];
    final sub = upstream.listen((req) async {
      final body = await utf8.decodeStream(req);
      seenRequests.add('${req.method} ${req.uri.path}?${req.uri.query}|$body');
      req.response.statusCode = 200;
      req.response.headers.contentType = ContentType.json;
      if (req.uri.path == '/api/ai/paragraph_content') {
        req.response.write(jsonEncode({
          'success': true,
          'source': 'online-upstream',
          'count': 1,
          'passages': [
            {
              'book_code': req.uri.queryParameters['book'],
              'pali': 'Online canon text',
            },
          ],
        }));
      } else {
        req.response.write(jsonEncode({
          'success': true,
          'source': 'online-upstream',
        }));
      }
      await req.response.close();
    });

    final proxyServer = TipitakaLocalServer(
      preferredPort: 0,
      explicitWebRootDir: webRoot,
      aiUpstreamBaseUri: Uri.parse('http://127.0.0.1:${upstream.port}'),
      api: server.api,
    );
    try {
      final proxyUri = await proxyServer.ensureStarted();

      final getRes = await _httpGet(
        proxyUri,
        '/api/ai/paragraph_content?book=mn1&chapter=0&start=1&end=1&langs=en',
      );
      expect(getRes.statusCode, 200);
      final getJson = jsonDecode(getRes.body) as Map<String, dynamic>;
      expect(getJson['source'], 'online-upstream');
      expect((getJson['passages'] as List).single['book_code'], 'mn1');

      final postRes = await _httpPostJson(proxyUri, '/api/ai/tool-call', {
        'name': 'search_sections',
        'args': {'query': 'satipatthana'},
      });
      expect(postRes.statusCode, 200);
      expect(jsonDecode(postRes.body)['source'], 'online-upstream');
      expect(seenRequests.length, 2);
      expect(seenRequests[1], contains('POST /api/ai/tool-call?'));
      expect(seenRequests[1], contains('"name":"search_sections"'));
    } finally {
      await proxyServer.stop();
      await sub.cancel();
      await upstream.close(force: true);
    }
  });

  test('serves GET /api/links/preview and batched POST /api/links/previews', () async {
    final batchRes = await _httpPostJson(baseUri, '/api/links/previews', {
      'items': [
        {
          'key': 'p1',
          'book': 's0101m.mul',
          'chapter': 0,
          'paraIndex': 0,
          'word': 'evaṃ',
        },
      ],
      'langs': ['en'],
    });
    expect(batchRes.statusCode, 200);
    final batchJson = jsonDecode(batchRes.body) as Map<String, dynamic>;
    final results = batchJson['results'] as Map<String, dynamic>;
    expect(results.containsKey('p1'), isTrue);
    final p1 = results['p1'] as Map<String, dynamic>;
    expect(p1['book_code'], 's0101m.mul');
    expect((p1['lines'] as List).any((l) => l['is_target'] == true), isTrue);
  });

  test('serves per-chapter pali_sentences route and ?chapter= query filter', () async {
    final chapRes = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/chapter/0/pali_sentences',
    );
    expect(chapRes.statusCode, 200);
    final chapJson = jsonDecode(chapRes.body) as Map<String, dynamic>;
    expect(chapJson['book_code'], 's0101m.mul');
    expect(chapJson['chapter_index'], 0);
    expect((chapJson['chapters']['0']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');
    expect((chapJson['paragraphs']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');

    final filteredRes = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/pali_sentences?chapter=0',
    );
    expect(filteredRes.statusCode, 200);
    final filteredJson = jsonDecode(filteredRes.body) as Map<String, dynamic>;
    expect(filteredJson['chapter_index'], 0);
    expect((filteredJson['chapters']['0']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');
  });

  test('serves single-roundtrip /api/book/:code/chapter/:idx/bundle with and without html', () async {
    final withHtml = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/chapter/0/bundle?lang=en&sentences=1&pali_sentences=1&links=1&includeHtml=1',
    );
    expect(withHtml.statusCode, 200);
    final fullJson = jsonDecode(withHtml.body) as Map<String, dynamic>;
    expect(fullJson['book_code'], 's0101m.mul');
    expect(fullJson['chapter_index'], 0);
    expect(fullJson['html'], contains('Evaṃ me sutaṃ.'));
    expect(fullJson['translations']['en']['0'], 'Thus have I heard.');
    expect((fullJson['sentences']['en']['0'] as List).first, 'Thus have I heard.');
    expect((fullJson['pali_sentences']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');
    expect(fullJson['links'], isA<Map<String, dynamic>>());

    final withoutHtml = await _httpGet(
      baseUri,
      '/api/book/s0101m.mul/chapter/0/bundle?lang=en&sentences=1&pali_sentences=1&links=1&includeHtml=0',
    );
    expect(withoutHtml.statusCode, 200);
    final liteJson = jsonDecode(withoutHtml.body) as Map<String, dynamic>;
    expect(liteJson.containsKey('html'), isFalse);
    expect(liteJson['translations']['en']['0'], 'Thus have I heard.');
    expect((liteJson['pali_sentences']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');
    expect(liteJson['links'], isA<Map<String, dynamic>>());
  });

  test('runs HTTP router in background Isolate when useBackgroundIsolate is true', () async {
    final bgServer = TipitakaLocalServer(
      preferredPort: 0,
      explicitWebRootDir: webRoot,
      useBackgroundIsolate: true,
      aiUpstreamBaseUri: Uri.parse('http://127.0.0.1:1'),
      api: TipitakaWebApi(
        dbDirectoryPath: tmpDir.path,
        dpdFamilyTemplates: DpdFamilyTemplates(),
      ),
    );
    try {
      final bgUri = await bgServer.ensureStarted();
      final health = await _httpGet(bgUri, '/api/health');
      expect(health.statusCode, 200);
      expect(jsonDecode(health.body)['status'], 'healthy');

      final bundle = await _httpGet(
        bgUri,
        '/api/book/s0101m.mul/chapter/0/bundle?includeHtml=0&lang=en&pali_sentences=1&links=1',
      );
      expect(bundle.statusCode, 200);
      final bundleJson = jsonDecode(bundle.body) as Map<String, dynamic>;
      expect(bundleJson['translations']['en']['0'], 'Thus have I heard.');
      expect((bundleJson['pali_sentences']['0'] as List).first['text'], 'Evaṃ me sutaṃ.');

      await bgServer.invalidateDatabases();
      final afterInvalidate = await _httpGet(
        bgUri,
        '/api/book/s0101m.mul/chapter/0/pali_sentences',
      );
      expect(afterInvalidate.statusCode, 200);
      expect(
        (jsonDecode(afterInvalidate.body)['chapters']['0']['0'] as List).first['text'],
        'Evaṃ me sutaṃ.',
      );
    } finally {
      await bgServer.dispose();
    }
  });

  test(
    'getChapterLinks and bundle short-circuit when bold index is missing/stale without blocking or caching empty {}',
    () async {
      final isolatedDir = Directory.systemTemp.createTempSync(
        'tipitaka_links_race_test_',
      );
      final buildCompleter = Completer<BoldDefinitionBuildResult>();
      var ensureBuiltCalls = 0;

      final fakeBoldService = _ControlledBoldDefinitionIndexService(
        onEnsureBuilt: (dirPath) {
          ensureBuiltCalls++;
          return buildCompleter.future;
        },
      );

      try {
        _seedTestDatabases(isolatedDir.path);
        // Add a commentary chapter with a bold definition for 'evaṃ' and
        // link metadata on s0101m.mul so real links exist once
        // bold_definitions.db is built.
        final core = sqlite3.open(p.join(isolatedDir.path, 'tipitaka.db'));
        try {
          core.execute(
            "UPDATE chapters SET html = '<p class=\"bodytext\" data-pindex=\"0\" data-para=\"1\">Evaṃ me sutaṃ.</p>' "
            "WHERE book_code = 's0101m.mul' AND chapter_index = 0;",
          );
          core.execute(
            "UPDATE canon_paragraphs SET attha_book = 's0101a.att', attha_chapter = 0, attha_para = '1' "
            "WHERE book_code = 's0101m.mul' AND chapter_index = 0 AND para_index = 0;",
          );
          core.execute(
            "INSERT INTO books (code, title, nikaya, category, xml_filename, chapter_count, meta_json) "
            "VALUES ('s0101a.att', 'Sumaṅgalavilāsinī', 'digha', 'aṭṭhakathā', 's0101a.att.xml', 1, '{}');",
          );
          final attBookId = core.lastInsertRowId;
          core.execute(
            "INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html) "
            "VALUES (?, 's0101a.att', 0, 'Nidānavaṇṇanā', 'ch0', 'ch0', 0, "
            "'<p class=\"bodytext\" data-pindex=\"0\" data-para=\"1\"><strong class=\"bld\">Eva</strong>nti ādi vuttaṃ.</p>');",
            [attBookId],
          );
          core.execute(
            "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text, mula_book, mula_chapter, mula_para) VALUES "
            "('s0101a.att:c0:n0:p1', 's0101a.att', 0, 0, '1', 'bodytext', 'Evanti ādi vuttaṃ.', 's0101m.mul', 0, '1');",
          );
        } finally {
          core.close();
        }

        expect(
          BoldDefinitionIndexService.isUpToDate(isolatedDir.path),
          isFalse,
        );

        final raceApi = TipitakaWebApi(
          dbDirectoryPath: isolatedDir.path,
          dpdFamilyTemplates: DpdFamilyTemplates(),
          boldDefinitionService: fakeBoldService,
        );

        // 1. Cold startup before warmUpIndexes has been called: must return
        // empty {} with warming_up: true immediately without blocking on
        // ensureBuilt(), and kick off background warmUpIndexes() exactly once.
        final sw = Stopwatch()..start();
        final coldLinks = await raceApi.getChapterLinks('s0101m.mul', 0);
        sw.stop();
        expect(sw.elapsedMilliseconds, lessThan(500));
        expect(coldLinks.statusCode, 200);
        final coldJson = coldLinks.body as Map<String, dynamic>;
        expect(coldJson['paragraphs'], isEmpty);
        expect(coldJson['warming_up'], isTrue);
        expect(ensureBuiltCalls, 1);

        // 2. Subsequent bundle request with links=1 while warm-up is still in
        // flight must also return empty {} with links_warming_up: true
        // immediately without spawning a duplicate build.
        final coldBundle = await raceApi.getChapterBundle('s0101m.mul', 0, {
          'includeHtml': '0',
          'links': '1',
        });
        expect(coldBundle.statusCode, 200);
        final coldBundleJson = coldBundle.body as Map<String, dynamic>;
        expect(coldBundleJson['links'], isEmpty);
        expect(coldBundleJson['links_warming_up'], isTrue);
        expect(ensureBuiltCalls, 1);

        // 3. Complete the real build and finish warm-up; subsequent
        // getChapterLinks must NOT serve a cached empty {}, must omit
        // warming_up, and must return real links from bold_definitions.db.
        final realBuild = BoldDefinitionIndexService.buildSync(
          dbDirPath: isolatedDir.path,
          force: true,
        );
        buildCompleter.complete(realBuild);
        await raceApi.warmUpIndexes();

        final warmLinks = await raceApi.getChapterLinks('s0101m.mul', 0);
        expect(warmLinks.statusCode, 200);
        final warmJson = warmLinks.body as Map<String, dynamic>;
        expect(warmJson['warming_up'], isNull);
        final paragraphs = warmJson['paragraphs'] as Map<String, dynamic>;
        expect(paragraphs, isNotEmpty);

        raceApi.close();
      } finally {
        if (isolatedDir.existsSync()) {
          isolatedDir.deleteSync(recursive: true);
        }
      }
    },
  );

  test(
    'failed or empty bold index warm-up backs off until invalidated instead of retry-storming',
    () async {
      final isolatedDir = Directory.systemTemp.createTempSync(
        'tipitaka_links_cooldown_test_',
      );
      var ensureBuiltCalls = 0;
      final failingBoldService = _ControlledBoldDefinitionIndexService(
        onEnsureBuilt: (dirPath) async {
          ensureBuiltCalls++;
          throw StateError('simulated disk full');
        },
      );
      try {
        _seedTestDatabases(isolatedDir.path);
        final cooldownApi = TipitakaWebApi(
          dbDirectoryPath: isolatedDir.path,
          dpdFamilyTemplates: DpdFamilyTemplates(),
          boldDefinitionService: failingBoldService,
        );

        final first = await cooldownApi.getChapterLinks('s0101m.mul', 0);
        expect((first.body as Map<String, dynamic>)['warming_up'], isTrue);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(ensureBuiltCalls, 1);

        // Second request within cooldown must NOT re-trigger ensureBuilt.
        final second = await cooldownApi.getChapterLinks('s0101m.mul', 1);
        expect((second.body as Map<String, dynamic>)['warming_up'], isTrue);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(ensureBuiltCalls, 1);

        // After invalidateDatabases() (e.g. fresh DB download), cooldown resets
        // and the next request retries warm-up.
        cooldownApi.invalidateDatabases();
        final third = await cooldownApi.getChapterLinks('s0101m.mul', 0);
        expect((third.body as Map<String, dynamic>)['warming_up'], isTrue);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(ensureBuiltCalls, 2);

        cooldownApi.close();
      } finally {
        if (isolatedDir.existsSync()) {
          isolatedDir.deleteSync(recursive: true);
        }
      }
    },
  );

  test(
    'background isolate controlPort handles invalidate and links non-blockingly during warmUpIndexes',
    () async {
      final isolatedDir = Directory.systemTemp.createTempSync(
        'tipitaka_isolate_warmup_test_',
      );
      _seedTestDatabases(isolatedDir.path);
      final bgServer = TipitakaLocalServer(
        preferredPort: 0,
        explicitWebRootDir: webRoot,
        useBackgroundIsolate: true,
        aiUpstreamBaseUri: Uri.parse('http://127.0.0.1:1'),
        api: TipitakaWebApi(
          dbDirectoryPath: isolatedDir.path,
          dpdFamilyTemplates: DpdFamilyTemplates(),
        ),
      );
      try {
        final bgUri = await bgServer.ensureStarted();
        final warmUpFuture = bgServer.warmUpIndexes();

        // Immediately send controlPort 'invalidate' and HTTP '/links' without
        // waiting for warmUpIndexes to finish.
        final sw = Stopwatch()..start();
        await bgServer.invalidateDatabases();
        final linksResp = await _httpGet(
          bgUri,
          '/api/book/s0101m.mul/chapter/0/links',
        );
        sw.stop();

        expect(linksResp.statusCode, 200);
        expect(
          jsonDecode(linksResp.body)['paragraphs'],
          isA<Map<String, dynamic>>(),
        );
        expect(sw.elapsedMilliseconds, lessThan(4000));

        await warmUpFuture;
      } finally {
        await bgServer.dispose();
        if (isolatedDir.existsSync()) {
          isolatedDir.deleteSync(recursive: true);
        }
      }
    },
  );
}

class _ControlledBoldDefinitionIndexService extends BoldDefinitionIndexService {
  final Future<BoldDefinitionBuildResult> Function(String dbDirPath)
      onEnsureBuilt;

  _ControlledBoldDefinitionIndexService({required this.onEnsureBuilt});

  @override
  Future<BoldDefinitionBuildResult> ensureBuilt({
    required String dbDirPath,
    bool force = false,
  }) {
    return onEnsureBuilt(dbDirPath);
  }
}
