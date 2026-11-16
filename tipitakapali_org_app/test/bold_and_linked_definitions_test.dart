import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/fts/fts_index_service.dart';
import 'package:tipitakapali_app/core/server/dpd_family_templates.dart';
import 'package:tipitakapali_app/core/server/tipitaka_local_server.dart';
import 'package:tipitakapali_app/core/server/tipitaka_web_api.dart';
import 'package:tipitakapali_app/core/services/bold_definition_index_service.dart';
import 'package:tipitakapali_app/core/services/linked_definition_service.dart';

Future<({int statusCode, String body})> _httpGet(
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
    return (statusCode: resp.statusCode, body: body);
  } finally {
    client.close(force: true);
  }
}

void _seedTipitakaFixture(String dbDir, {bool withOptionalDbs = true}) {
  final core = sqlite3.open(p.join(dbDir, 'tipitaka.db'));
  try {
    core.execute('''
      CREATE TABLE books (
        code TEXT PRIMARY KEY,
        title TEXT,
        nikaya TEXT,
        category TEXT,
        tree_json TEXT
      );
      CREATE TABLE chapters (
        book_code TEXT,
        chapter_index INTEGER,
        title TEXT,
        html TEXT,
        PRIMARY KEY (book_code, chapter_index)
      );
      CREATE TABLE canon_paragraphs (
        book_code TEXT,
        chapter_index INTEGER,
        para_index INTEGER,
        para_num TEXT,
        para_first INTEGER,
        para_last INTEGER,
        pali_text TEXT,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_para TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_para TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_para TEXT
      );
    ''');

    core.execute(
      "INSERT INTO books (code, title, nikaya, category, tree_json) VALUES "
      "('s0101m.mul', 'Brahmajālasutta', 'digha', 'mūla', '[]'),"
      "('s0101a.att', 'Brahmajālasutta-aṭṭhakathā', 'digha', 'aṭṭhakathā', '[]'),"
      "('s0101t.tik', 'Brahmajālasutta-ṭīkā', 'digha', 'ṭīkā', '[]');",
    );

    // Mūla chapter with multiple sentences, plus a bold term inside Mūla
    const mulaHtml =
        '<p class="chapter" data-pindex="0">1. Brahmajālasuttaṃ</p>'
        '<p class="bodytext" data-pindex="1" data-para="1">'
        '<strong class="paranum">1</strong><span class="dot">.</span> '
        'Evaṃ me sutaṃ. Ekaṃ samayaṃ <strong class="bld">bhagavā</strong> hoti viharati.'
        '</p>'
        '<p class="bodytext" data-pindex="2" data-para="2">'
        '<strong class="paranum">2</strong><span class="dot">.</span> '
        'Nibbānaṃ paramaṃ sukhaṃ.'
        '</p>';

    // Aṭṭhakathā chapter with:
    // - sandhi eva + nti -> evaṃ
    // - short sentence (< 100 chars) preceded/followed by context lines
    // - ending vowel difference (`hotīti` vs `hoti`)
    // - missing data-para on pindex=3 resolved via canon_paragraphs
    const atthaHtml =
        '<p class="bodytext" data-pindex="0" data-para="0">Nidānakathā ādi.</p>'
        '<p class="bodytext" data-pindex="1" data-para="1">'
        '<strong class="paranum">1</strong><span class="dot">.</span> '
        'Nidānakathā ādi. <strong class="bld">Eva</strong>nti ādi vuttaṃ. Pacchā vākyaṃ.'
        '</p>'
        '<p class="bodytext" data-pindex="2" data-para="1">'
        '<strong class="bld">Bhagavā</strong>ti garu saddho, '
        'yo sabbadhammānaṃ pāraṃ gato sabbalokābhibhūti attho.'
        '</p>'
        '<p class="bodytext" data-pindex="3">'
        '<strong class="bld">Hotī</strong>ti bhavati sambhavati.'
        '</p>'
        '<p class="bodytext" data-pindex="4" data-para="2">'
        '<strong class="bld">Nibbāna</strong>nti rāgakkhayo dosakkhayo mohakkhayo.'
        '</p>';

    // Ṭīkā chapter defining sutaṃ
    const tikaHtml =
        '<p class="bodytext" data-pindex="0" data-para="1">'
        '<strong class="paranum">1</strong><span class="dot">.</span> '
        '<strong class="bld">Suta</strong>nti sotaviññāṇena gahitaṃ.'
        '</p>';

    core.execute(
      'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
      ['s0101m.mul', 0, 'Brahmajālasutta', mulaHtml],
    );
    core.execute(
      'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
      ['s0101a.att', 0, 'Brahmajālasutta-aṭṭhakathā', atthaHtml],
    );
    core.execute(
      'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
      ['s0101t.tik', 0, 'Brahmajālasutta-ṭīkā', tikaHtml],
    );

    core.execute(
      'INSERT INTO canon_paragraphs '
      '(book_code, chapter_index, para_index, para_num, para_first, para_last, pali_text, mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para) '
      'VALUES '
      "('s0101m.mul', 0, 1, '1', 1, 1, 'Evaṃ me sutaṃ. Ekaṃ samayaṃ bhagavā hoti viharati.', 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
      "('s0101m.mul', 0, 2, '2', 2, 2, 'Nibbānaṃ paramaṃ sukhaṃ.', 's0101m.mul', 0, '2', 's0101a.att', 0, '2', NULL, NULL, NULL),"
      "('s0101a.att', 0, 1, '1', 1, 1, 'Nidānakathā ādi. Evanti ādi vuttaṃ. Pacchā vākyaṃ.', 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
      "('s0101a.att', 0, 2, '1', 1, 1, 'Bhagavāti garu saddho, yo sabbadhammānaṃ pāraṃ gato sabbalokābhibhūti attho.', 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
      "('s0101a.att', 0, 3, '1', 1, 1, 'Hotīti bhavati sambhavati.', 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
      "('s0101a.att', 0, 4, '2', 2, 2, 'Nibbānanti rāgakkhayo dosakkhayo mohakkhayo.', 's0101m.mul', 0, '2', 's0101a.att', 0, '2', NULL, NULL, NULL),"
      "('s0101t.tik', 0, 0, '1', 1, 1, 'Sutanti sotaviññāṇena gahitaṃ.', 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');",
    );
  } finally {
    core.close();
  }

  if (!withOptionalDbs) return;

  final ps = sqlite3.open(p.join(dbDir, 'pali_sentences.db'));
  try {
    ps.execute('''
      CREATE TABLE pali_sentences (
        book_code TEXT,
        chapter_index INTEGER,
        para_index INTEGER,
        line_id INTEGER,
        sentence TEXT
      );
    ''');
    ps.execute(
      'INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES '
      "('s0101m.mul', 0, 1, 1, 'Evaṃ me sutaṃ.'),"
      "('s0101m.mul', 0, 1, 2, 'Ekaṃ samayaṃ bhagavā hoti viharati.'),"
      "('s0101a.att', 0, 1, 1, 'Evanti ādi vuttaṃ.');",
    );
  } finally {
    ps.close();
  }

  final transEn = sqlite3.open(p.join(dbDir, 'translation_en.db'));
  try {
    transEn.execute('''
      CREATE TABLE translation_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE paragraph_translations (
        book_code TEXT,
        chapter_index INTEGER,
        para_index INTEGER,
        guid TEXT,
        para_num TEXT,
        translation TEXT,
        sentence_count INTEGER,
        sentences_json TEXT
      );
    ''');
    transEn.execute(
      "INSERT INTO translation_meta (key, value) VALUES ('name', 'English');",
    );
    transEn.execute(
      'INSERT INTO paragraph_translations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        's0101a.att',
        0,
        1,
        's0101a.att:c0:n1:p1',
        '1',
        'Thus it was said at the beginning.',
        1,
        jsonEncode(['Thus it was said at the beginning.']),
      ],
    );
    transEn.execute(
      'INSERT INTO paragraph_translations VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        's0101m.mul',
        0,
        1,
        's0101m.mul:c0:n1:p1',
        '1',
        'Thus have I heard. At one time the Blessed One was staying.',
        2,
        jsonEncode(['Thus have I heard.', 'At one time the Blessed One was staying.']),
      ],
    );
  } finally {
    transEn.close();
  }
}

void main() {
  group('BoldDefinitionIndexService & LinkedDefinitionService', () {
    late Directory tmpDir;
    late Directory webRoot;

    setUp(() {
      tmpDir = Directory.systemTemp.createTempSync('bold_linked_test_');
      webRoot = Directory(p.join(tmpDir.path, 'web'))..createSync();
      File(p.join(webRoot.path, 'index.html')).writeAsStringSync('<html></html>');
    });

    tearDown(() {
      try {
        tmpDir.deleteSync(recursive: true);
      } catch (_) {}
    });

    test('builds bold_definitions.db from tipitaka.db with sandhi, context, and idempotence', () async {
      _seedTipitakaFixture(tmpDir.path);
      final service = BoldDefinitionIndexService();

      final first = await service.ensureBuilt(dbDirPath: tmpDir.path);
      expect(first.skipped, isFalse);
      expect(first.indexedRows, greaterThanOrEqualTo(5));
      expect(File(p.join(tmpDir.path, BoldDefinitionIndexService.dbFilename)).existsSync(), isTrue);

      // Second call skips rebuild cleanly
      final second = await service.ensureBuilt(dbDirPath: tmpDir.path);
      expect(second.skipped, isTrue);
      expect(second.indexedRows, first.indexedRows);

      // Lookup sandhi `evaṃ` -> matches `<strong class="bld">Eva</strong>nti`
      final evamRes = await service.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'evaṃ',
        enabledLangs: const ['en'],
      );
      expect(evamRes.results, isNotEmpty);
      final evamHit = evamRes.results.first;
      expect(evamHit.word, 'evaṃ');
      expect(evamHit.ending, 'ti');
      expect(evamHit.bookCode, 's0101a.att');
      expect(evamHit.category, 'aṭṭhakathā');
      // Short sentence (< 100 chars) includes surrounding context sentences
      expect(evamHit.beforeHtml, contains('Nidānakathā'));
      expect(evamHit.afterHtml, contains('Pacchā vākyaṃ'));
      // Translation enrichment
      expect(evamHit.translations['en'], 'Thus it was said at the beginning.');
      // MAT sibling metadata
      expect(evamHit.mat?['mula']?['book_code'], 's0101m.mul');
      expect(evamHit.mat?['tika']?['book_code'], 's0101t.tik');

      // Diacritic-folded fallback (`nibbana` -> `nibbānaṃ`)
      final nibbanaRes = await service.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'nibbana',
      );
      expect(nibbanaRes.results.any((r) => r.word == 'nibbānaṃ'), isTrue);

      // Category sorting: Aṭṭhakathā precedes Mūla for `bhagavā`
      final bhagavaRes = await service.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'bhagavā',
      );
      expect(bhagavaRes.results.length, 2);
      expect(bhagavaRes.results.first.category, 'aṭṭhakathā');
      expect(bhagavaRes.results.last.category, 'mūla');

      // Missing data-para on pindex 3 in HTML fell back to canon_paragraphs para_num = '1'
      final hotiRes = await service.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'hoti',
      );
      expect(hotiRes.results.any((r) => r.word == 'hotī' && r.paraNum == '1'), isTrue);

      // Empty/punctuation-only query returns empty without throwing
      final emptyRes = await service.lookup(dbDirPath: tmpDir.path, rawWord: '...!!');
      expect(emptyRes.results, isEmpty);
    });

    test('LinkedDefinitionService resolves forward (M->A/T), reverse (A->M), and contextual preview', () async {
      _seedTipitakaFixture(tmpDir.path);
      final boldService = BoldDefinitionIndexService();
      await boldService.ensureBuilt(dbDirPath: tmpDir.path);
      final linkedService = LinkedDefinitionService(boldService: boldService);

      // Forward links for Mūla chapter 0
      final mulaLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101m.mul',
        chapterIndex: 0,
      );
      final paragraphs = mulaLinks['paragraphs'] as Map<String, dynamic>;
      expect(paragraphs.containsKey('1'), isTrue);

      final p1 = paragraphs['1'] as Map<String, dynamic>;
      final byLine = p1['by_line'] as Map<String, dynamic>;
      // Line 1: "Evaṃ me sutaṃ." -> matches `evaṃ` (aṭṭhakathā) & `sutaṃ` (ṭīkā)
      final line1 = (byLine['1'] as List).cast<Map<String, dynamic>>();
      expect(line1.any((l) => l['word'] == 'evaṃ' && l['target_book'] == 's0101a.att' && l['is_source'] == false), isTrue);
      expect(line1.any((l) => l['word'] == 'sutaṃ' && l['target_book'] == 's0101t.tik' && l['is_source'] == false), isTrue);

      // Line 2: "Ekaṃ samayaṃ bhagavā hoti viharati." -> matches `bhagavā` and vowel-variant `hotī`
      final line2 = (byLine['2'] as List).cast<Map<String, dynamic>>();
      expect(line2.any((l) => l['word'] == 'bhagavā' && l['target_book'] == 's0101a.att'), isTrue);
      expect(line2.any((l) => l['word'] == 'hotī' && l['target_book'] == 's0101a.att'), isTrue);

      // Reverse links for Aṭṭhakathā chapter 0 -> links back to Mūla (`is_source: true`)
      final atthaLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        chapterIndex: 0,
      );
      final atthaP1 = (atthaLinks['paragraphs'] as Map)['1'] as Map<String, dynamic>;
      final atthaAll = (atthaP1['all'] as List).cast<Map<String, dynamic>>();
      expect(atthaAll.any((l) => l['word'] == 'evaṃ' && l['target_book'] == 's0101m.mul' && l['is_source'] == true), isTrue);

      // Preview for Aṭṭhakathā para 1 highlighting `evaṃ` + English translation
      final preview = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        paraNum: '1',
        word: 'evaṃ',
        enabledLangs: const ['en'],
      );
      expect(preview, isNotNull);
      expect(preview!.bookCode, 's0101a.att');
      expect(preview.lines.any((l) => l.isTarget && l.paliHtml.contains('<b>')), isTrue);
      expect(preview.lines.any((l) => l.isTarget && l.translations['en'] == 'Thus it was said at the beginning.'), isTrue);

      // Missing book returns null gracefully
      final missing = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 'does_not_exist.mul',
      );
      expect(missing, isNull);
    });

    test('works gracefully when optional pali_sentences.db and translation DBs are missing', () async {
      _seedTipitakaFixture(tmpDir.path, withOptionalDbs: false);
      final boldService = BoldDefinitionIndexService();
      await boldService.ensureBuilt(dbDirPath: tmpDir.path);
      final linkedService = LinkedDefinitionService(boldService: boldService);

      final boldRes = await boldService.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'evaṃ',
        enabledLangs: const ['en'],
      );
      expect(boldRes.results, isNotEmpty);
      expect(boldRes.results.first.translations, isEmpty);

      // Without pali_sentences.db, links still resolve at paragraph level under line '0' / 'all'
      final links = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101m.mul',
        chapterIndex: 0,
      );
      final p1 = (links['paragraphs'] as Map)['1'] as Map<String, dynamic>;
      expect((p1['all'] as List).isNotEmpty, isTrue);

      final preview = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        paraIndex: 1,
        word: 'evaṃ',
      );
      expect(preview, isNotNull);
      expect(preview!.lines, isNotEmpty);
    });

    test('TipitakaLocalServer HTTP routes serve bold_def, chapter links, and link preview', () async {
      _seedTipitakaFixture(tmpDir.path);
      final api = TipitakaWebApi(
        dbDirectoryPath: tmpDir.path,
        dpdFamilyTemplates: DpdFamilyTemplates(),
      );
      final server = TipitakaLocalServer(
        api: api,
        preferredPort: 0,
        explicitWebRootDir: webRoot,
      );
      final baseUri = await server.ensureStarted();
      try {
        // Warm up bold_definitions.db
        await api.warmUpIndexes();

        // 1. /api/dict/lookup?dict=bold_def
        final boldResp = await _httpGet(
          baseUri,
          '/api/dict/lookup?w=${Uri.encodeQueryComponent('evaṃ')}&dict=bold_def&langs=en',
        );
        expect(boldResp.statusCode, 200);
        final boldJson = jsonDecode(boldResp.body) as Map<String, dynamic>;
        expect(boldJson['hasResults'], isTrue);
        final boldResults = boldJson['results'] as List;
        expect(boldResults, isNotEmpty);
        expect((boldResults.first as Map)['translations']['en'], 'Thus it was said at the beginning.');

        // 2. /api/dict/lookup?dict=all includes bold_def
        final allResp = await _httpGet(
          baseUri,
          '/api/dict/lookup?w=bhagava&dict=all',
        );
        expect(allResp.statusCode, 200);
        final allJson = jsonDecode(allResp.body) as Map<String, dynamic>;
        expect(allJson['counts']['bold_def'], greaterThanOrEqualTo(1));
        expect(allJson['bold_def'], isA<List>());

        // 3. /api/book/:code/chapter/:chap/links
        final linksResp = await _httpGet(
          baseUri,
          '/api/book/s0101m.mul/chapter/0/links',
        );
        expect(linksResp.statusCode, 200);
        final linksJson = jsonDecode(linksResp.body) as Map<String, dynamic>;
        expect(linksJson['book_code'], 's0101m.mul');
        expect((linksJson['paragraphs'] as Map)['1'], isNotNull);

        // 4. /api/links/preview
        final previewResp = await _httpGet(
          baseUri,
          '/api/links/preview?book=s0101a.att&paraNum=1&word=${Uri.encodeQueryComponent('evaṃ')}&langs=en',
        );
        expect(previewResp.statusCode, 200);
        final previewJson = jsonDecode(previewResp.body) as Map<String, dynamic>;
        expect(previewJson['book_code'], 's0101a.att');
        expect(previewJson['lines'], isNotEmpty);

        // 5. Missing target returns 404
        final notFoundResp = await _httpGet(
          baseUri,
          '/api/links/preview?book=nonexistent.mul&paraNum=1',
        );
        expect(notFoundResp.statusCode, 404);
      } finally {
        await server.dispose();
      }
    });

    test('isolates cross-chapter para_num collisions, handles quotes before nti, matches sandhi line, and resolves para ranges', () async {
      _seedTipitakaFixture(tmpDir.path);
      final db = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        db.execute(
          "INSERT INTO books (code, title, nikaya, category, tree_json) VALUES "
          "('abh01m.mul', 'Dhammasaṅgaṇī', 'abhidhamma', 'mūla', '[]'),"
          "('abh01a.att', 'Atthasālinī', 'abhidhamma', 'aṭṭhakathā', '[]');",
        );
        db.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            'abh01m.mul',
            0,
            'Ch0',
            '<p class="bodytext" data-pindex="1">Kusalā dhammā.</p>',
          ],
        );
        db.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            'abh01m.mul',
            1,
            'Ch1',
            '<p class="bodytext" data-pindex="10">Kusalā dhammā cittaṃ.</p>',
          ],
        );
        db.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            'abh01a.att',
            0,
            'AttCh0',
            '<p class="bodytext" data-pindex="1" data-para="1"><strong class="bld">Kusalā</strong>ti anavajjā.</p>',
          ],
        );
        db.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            'abh01a.att',
            1,
            'AttCh1',
            '<p class="bodytext" data-pindex="20" data-para="1"><strong class="bld">Kusalā</strong>ti ārogyā. '
            '<strong class="bld">‘‘Vutta</strong>’’nti bhāsitaṃ.</p>'
            '<p class="bodytext" data-pindex="21" data-para="32-33"><strong class="bld">Citta</strong>nti ārammaṇaṃ.</p>',
          ],
        );
        db.execute(
          'INSERT INTO canon_paragraphs '
          '(book_code, chapter_index, para_index, para_num, para_first, para_last, pali_text, mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para) '
          'VALUES '
          "('abh01m.mul', 0, 1, '1', 1, 1, 'Kusalā dhammā.', 'abh01m.mul', 0, '1', 'abh01a.att', 0, '1', NULL, NULL, NULL),"
          "('abh01m.mul', 1, 10, '1', 1, 1, 'Kusalā dhammā cittaṃ.', 'abh01m.mul', 1, '1', 'abh01a.att', 1, '1', NULL, NULL, NULL),"
          "('abh01a.att', 0, 1, '1', 1, 1, 'Kusalāti anavajjā.', 'abh01m.mul', 0, '1', 'abh01a.att', 0, '1', NULL, NULL, NULL),"
          "('abh01a.att', 1, 20, '1', 1, 1, 'Kusalāti ārogyā. Vuttanti bhāsitaṃ.', 'abh01m.mul', 1, '1', 'abh01a.att', 1, '1', NULL, NULL, NULL),"
          "('abh01a.att', 1, 21, '32-33', 32, 33, 'Cittanti ārammaṇaṃ.', 'abh01m.mul', 1, '1', 'abh01a.att', 1, '32-33', NULL, NULL, NULL);",
        );
      } finally {
        db.close();
      }

      // Multi-sentence pali_sentences for s0101a.att pindex=1 where `Evanti` is on line 2
      final ps = sqlite3.open(p.join(tmpDir.path, 'pali_sentences.db'));
      try {
        ps.execute('DELETE FROM pali_sentences WHERE book_code = ?', ['s0101a.att']);
        ps.execute(
          'INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES '
          "('s0101a.att', 0, 1, 1, 'Nidānakathā ādi.'),"
          "('s0101a.att', 0, 1, 2, 'Evanti ādi vuttaṃ.'),"
          "('s0101a.att', 0, 1, 3, 'Pacchā vākyaṃ.');",
        );
      } finally {
        ps.close();
      }

      final boldService = BoldDefinitionIndexService();
      await boldService.ensureBuilt(dbDirPath: tmpDir.path, force: true);
      final linkedService = LinkedDefinitionService(boldService: boldService);

      // 1. Quote before nti (`‘‘Vutta’’nti` -> word='vuttaṃ', ending='ti')
      final vuttaRes = await boldService.lookup(dbDirPath: tmpDir.path, rawWord: 'vuttaṃ');
      expect(vuttaRes.results.any((r) => r.word == 'vuttaṃ' && r.ending == 'ti'), isTrue);

      // 2. Cross-chapter para_num='1' isolation: abh01m.mul ch=1 links to abh01a.att ch=1 (NOT ch=0)
      final ch1Links = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 'abh01m.mul',
        chapterIndex: 1,
      );
      final p10All = ((ch1Links['paragraphs'] as Map)['10'] as Map)['all'] as List;
      final kusalaLink = p10All.cast<Map<String, dynamic>>().firstWhere((l) => l['word'] == 'kusalā');
      expect(kusalaLink['target_chapter'], 1);
      expect(kusalaLink['target_para_index'], 20);

      // 3. Reverse link line matching with `nti` sandhi puts `evaṃ` on line 2 (`Evanti ādi vuttaṃ.`), not line 1
      final atthaLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        chapterIndex: 0,
      );
      final atthaByLine = ((atthaLinks['paragraphs'] as Map)['1'] as Map)['by_line'] as Map<String, dynamic>;
      expect(atthaByLine.containsKey('2'), isTrue);
      expect(
        (atthaByLine['2'] as List).cast<Map<String, dynamic>>().any((l) => l['word'] == 'evaṃ' && l['is_source'] == true),
        isTrue,
      );

      // 4. Range para_num ('32-33') resolves when querying paraNum='32'
      final rangePreview = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 'abh01a.att',
        chapterIndex: 1,
        paraNum: '32',
        word: 'cittaṃ',
      );
      expect(rangePreview, isNotNull);
      expect(rangePreview!.targetParaIndex, 21);

      // 5. Stale bold_definitions.db is detected and rebuilt after invalidateDatabases() + warmUpIndexes()
      final api = TipitakaWebApi(
        dbDirectoryPath: tmpDir.path,
        dpdFamilyTemplates: DpdFamilyTemplates(),
      );
      final pre = await api.lookupDict('mettaṃ', dictType: 'bold_def');
      expect((pre.body as Map)['hasResults'], isFalse);

      // Mutate tipitaka.db to add a new bold entry and ensure size/mtime change
      final db2 = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        db2.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            'abh01a.att',
            2,
            'AttCh2',
            '<p class="bodytext" data-pindex="99" data-para="99">'
            '<strong class="bld">Metta</strong>nti hitasukhūpasaṃhāro. '
            '${'Padavaṇṇanā ' * 400}</p>',
          ],
        );
      } finally {
        db2.close();
      }
      api.invalidateDatabases();
      await api.warmUpIndexes();
      final post = await api.lookupDict('mettaṃ', dictType: 'bold_def');
      expect((post.body as Map)['hasResults'], isTrue);
      api.close();
    });

    test('supports size-optimized unified tipitaka.db (meta_z, html_z, chapter_text_pack, no pali_sentences.db)', () async {
      final optDb = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        optDb.execute('''
          CREATE TABLE site_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE books (
            id INTEGER PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            nikaya TEXT,
            category TEXT,
            xml_filename TEXT,
            chapter_count INTEGER,
            meta_json TEXT,
            meta_z BLOB
          );
          CREATE TABLE chapters (
            id INTEGER PRIMARY KEY,
            book_id INTEGER NOT NULL,
            book_code TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            title TEXT,
            chunk_name TEXT,
            anchor_id TEXT,
            para_index INTEGER,
            html TEXT,
            html_z BLOB
          );
          CREATE TABLE book_toc (
            book_id INTEGER, book_code TEXT, item_index INTEGER, level INTEGER,
            type TEXT, rend TEXT, title TEXT, para_index INTEGER, para_num TEXT,
            anchor_id TEXT, chapter_index INTEGER
          );
          CREATE TABLE book_mat (
            book_code TEXT PRIMARY KEY, category TEXT, mula_code TEXT, mula_title TEXT,
            attha_code TEXT, attha_title TEXT, tika_code TEXT, tika_title TEXT
          );
          CREATE TABLE tree_nodes (
            id INTEGER PRIMARY KEY, text TEXT NOT NULL, parent_id INTEGER,
            node_type TEXT, book_code TEXT, chapter_index INTEGER
          );
          CREATE TABLE chapter_text_pack (
            book_id INTEGER NOT NULL,
            chapter_index INTEGER NOT NULL,
            data_z BLOB NOT NULL,
            PRIMARY KEY (book_id, chapter_index)
          ) WITHOUT ROWID;
          CREATE TABLE canon_paragraphs_raw (
            global_id INTEGER PRIMARY KEY,
            book_id INTEGER NOT NULL,
            sub_book TEXT,
            chapter_index INTEGER NOT NULL,
            chapter_title TEXT,
            sutta_title TEXT,
            para_index INTEGER NOT NULL,
            para_num TEXT,
            para_first INTEGER,
            para_last INTEGER,
            rend TEXT,
            word_count INTEGER,
            mula_book_id INTEGER,
            mula_chapter INTEGER,
            mula_para TEXT,
            attha_book_id INTEGER,
            attha_chapter INTEGER,
            attha_para TEXT,
            tika_book_id INTEGER,
            tika_chapter INTEGER,
            tika_para TEXT
          );
          CREATE VIEW canon_paragraphs AS
          SELECT
            cp.global_id,
            (b.code || ':c' || cp.chapter_index || ':n' || COALESCE(cp.para_num, '0') || ':p' || cp.para_index) AS guid,
            b.code AS book_code,
            cp.sub_book,
            cp.chapter_index,
            cp.chapter_title,
            cp.sutta_title,
            cp.para_index,
            cp.para_num,
            cp.para_first,
            cp.para_last,
            cp.rend,
            NULL AS pali_text,
            cp.word_count,
            NULL AS mula_guid,
            bm.code AS mula_book,
            cp.mula_chapter,
            cp.mula_para,
            NULL AS attha_guid,
            ba.code AS attha_book,
            cp.attha_chapter,
            cp.attha_para,
            NULL AS tika_guid,
            bt.code AS tika_book,
            cp.tika_chapter,
            cp.tika_para,
            NULL AS match_quality
          FROM canon_paragraphs_raw cp
          JOIN books b ON b.id = cp.book_id
          LEFT JOIN books bm ON bm.id = cp.mula_book_id
          LEFT JOIN books ba ON ba.id = cp.attha_book_id
          LEFT JOIN books bt ON bt.id = cp.tika_book_id;
        ''');

        final mulaMetaZ = zlib.encode(utf8.encode(jsonEncode({
          'para_to_chapter': {'1': 0},
          'book_type': 'Whole',
        })));
        final attMetaZ = zlib.encode(utf8.encode(jsonEncode({'book_type': 'Whole'})));
        optDb.execute(
          'INSERT INTO books VALUES (1, ?, ?, ?, ?, ?, 1, NULL, ?), (2, ?, ?, ?, ?, ?, 1, NULL, ?)',
          [
            's0101m.mul', 'Brahmajālasutta', 'digha', 'mūla', 's0101m.mul.xml', mulaMetaZ,
            's0101a.att', 'Brahmajālasutta-aṭṭhakathā', 'digha', 'aṭṭhakathā', 's0101a.att.xml', attMetaZ,
          ],
        );

        final mulaHtmlZ = zlib.encode(utf8.encode(
          '<p class="bodytext" data-pindex="0" data-para="1">Evaṃ me sutaṃ. Bhagavā viharati.</p>',
        ));
        final attHtmlZ = zlib.encode(utf8.encode(
          '<p class="bodytext" data-pindex="0" data-para="1"><strong class="bld">Eva</strong>nti ādi vuttaṃ.</p>',
        ));
        optDb.execute(
          'INSERT INTO chapters VALUES (1, 1, ?, 0, ?, ?, ?, 0, NULL, ?), (2, 2, ?, 0, ?, ?, ?, 0, NULL, ?)',
          [
            's0101m.mul', 'Ch0', 'ch0', 'chap-0', mulaHtmlZ,
            's0101a.att', 'Ch0', 'ch0', 'chap-0', attHtmlZ,
          ],
        );

        final mulaPackZ = zlib.encode(utf8.encode(jsonEncode([
          [0, null, [[1, 'Evaṃ me sutaṃ.'], [2, 'Bhagavā viharati.']]],
        ])));
        final attPackZ = zlib.encode(utf8.encode(jsonEncode([
          [0, 'Evanti ādi vuttaṃ.', [[1, 'Evanti ādi vuttaṃ.']]],
        ])));
        optDb.execute(
          'INSERT INTO chapter_text_pack VALUES (1, 0, ?), (2, 0, ?)',
          [mulaPackZ, attPackZ],
        );
        optDb.execute(
          'INSERT INTO canon_paragraphs_raw VALUES '
          "(1, 1, NULL, 0, 'Ch0', 'Brahmajāla', 0, '1', 1, 1, 'bodytext', 5, 1, 0, '1', 2, 0, '1', NULL, NULL, NULL),"
          "(2, 2, NULL, 0, 'Ch0', 'Brahmajāla', 0, '1', 1, 1, 'bodytext', 3, 1, 0, '1', 2, 0, '1', NULL, NULL, NULL);",
        );
      } finally {
        optDb.close();
      }

      // Note: NO pali_sentences.db exists in tmpDir!
      final api = TipitakaWebApi(
        dbDirectoryPath: tmpDir.path,
        dpdFamilyTemplates: DpdFamilyTemplates(),
      );
      final server = TipitakaLocalServer(
        api: api,
        preferredPort: 0,
        explicitWebRootDir: webRoot,
      );
      final baseUri = await server.ensureStarted();
      try {
        await api.warmUpIndexes();

        // 1. /api/translations reports has_pali_sentences: true from unified tipitaka.db
        final transAvail = await _httpGet(baseUri, '/api/translations');
        expect(transAvail.statusCode, 200);
        expect((jsonDecode(transAvail.body) as Map)['has_pali_sentences'], isTrue);

        // 2. /api/book and /api/book/chapter decode meta_z & html_z
        final bookResp = await _httpGet(baseUri, '/api/book/s0101m.mul?chapter=0');
        expect(bookResp.statusCode, 200);
        final bookJson = jsonDecode(bookResp.body) as Map<String, dynamic>;
        expect(bookJson['html'], contains('Evaṃ me sutaṃ'));
        expect((bookJson['para_to_chapter'] as Map)['1'], 0);

        // 3. /api/book/:code/pali_sentences reads chapter_text_pack
        final sentResp = await _httpGet(baseUri, '/api/book/s0101m.mul/pali_sentences');
        expect(sentResp.statusCode, 200);
        final sentJson = jsonDecode(sentResp.body) as Map<String, dynamic>;
        final p0Sents = ((sentJson['chapters'] as Map)['0'] as Map)['0'] as List;
        expect(p0Sents.length, 2);
        expect((p0Sents.first as Map)['text'], 'Evaṃ me sutaṃ.');

        // 4. Bold Def & Linked Def + Preview work from html_z & chapter_text_pack
        final boldResp = await _httpGet(
          baseUri,
          '/api/dict/lookup?w=${Uri.encodeQueryComponent('evaṃ')}&dict=bold_def',
        );
        expect(boldResp.statusCode, 200);
        expect((jsonDecode(boldResp.body) as Map)['results'], isNotEmpty);

        final linksResp = await _httpGet(baseUri, '/api/book/s0101m.mul/chapter/0/links');
        expect(linksResp.statusCode, 200);
        final linksMap = (jsonDecode(linksResp.body) as Map)['paragraphs'] as Map;
        expect(linksMap['0'], isNotNull);

        // 5. /api/paragraph/:guid hydrates pali_text cleanly
        final guidResp = await _httpGet(baseUri, '/api/paragraph/s0101m.mul:c0:n1:p0');
        expect(guidResp.statusCode, 200);
        expect((jsonDecode(guidResp.body) as Map)['pali_text'], 'Evaṃ me sutaṃ. Bhagavā viharati.');

        // 6. FtsIndexService indexes chapter_text_pack cleanly
        await FtsIndexService().buildPaliFtsIndex(dbDirPath: tmpDir.path, force: true);
        expect(File(p.join(tmpDir.path, 'fts_tipitaka.db')).existsSync(), isTrue);
      } finally {
        await server.dispose();
      }
    });

    test('matches inline <b>...</b>ti and 2-letter <b>Me</b>tiādīni tokens on their exact sentence lines', () async {
      _seedTipitakaFixture(tmpDir.path);
      final db = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        db.execute(
          'INSERT INTO chapters (book_code, chapter_index, title, html) VALUES (?, ?, ?, ?)',
          [
            's0101a.att',
            1,
            'AttCh1',
            '<p class="bodytext" data-pindex="10" data-para="1">'
                'Tathā <strong class="bld">eva</strong>nti niddisitabbaṃ. '
                '<strong class="bld">Me</strong>tiādīni nāmapadāni. '
                '<strong class="bld">Suta</strong>nti puggalakiccaṃ.'
                '</p>',
          ],
        );
        db.execute(
          'INSERT INTO canon_paragraphs '
          '(book_code, chapter_index, para_index, para_num, para_first, para_last, pali_text, mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para) '
          'VALUES '
          "('s0101a.att', 1, 10, '1', 1, 1, 'Tathā evanti niddisitabbaṃ. Metiādīni nāmapadāni. Sutanti puggalakiccaṃ.', 's0101m.mul', 0, '1', 's0101a.att', 1, '1', NULL, NULL, NULL);",
        );
      } finally {
        db.close();
      }

      final ps = sqlite3.open(p.join(tmpDir.path, 'pali_sentences.db'));
      try {
        ps.execute(
          'INSERT INTO pali_sentences (book_code, chapter_index, para_index, line_id, sentence) VALUES '
          "('s0101a.att', 1, 10, 1, 'Tathā <b>evan</b>ti niddisitabbaṃ.'),"
          "('s0101a.att', 1, 10, 2, '<b>Me</b>tiādīni nāmapadāni.'),"
          "('s0101a.att', 1, 10, 3, '<b>Sutan</b>ti puggalakiccaṃ.');",
        );
      } finally {
        ps.close();
      }

      final boldService = BoldDefinitionIndexService();
      await boldService.ensureBuilt(dbDirPath: tmpDir.path, force: true);
      final linkedService = LinkedDefinitionService(boldService: boldService);

      final links = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        chapterIndex: 1,
      );
      final byLine = ((links['paragraphs'] as Map)['10'] as Map)['by_line'] as Map<String, dynamic>;
      expect((byLine['1'] as List).any((l) => l['word'] == 'evaṃ'), isTrue);
      expect((byLine['2'] as List).any((l) => l['word'] == 'me'), isTrue);
      expect((byLine['3'] as List).any((l) => l['word'] == 'sutaṃ'), isTrue);
    });

    test('v3 sentence-level bold_def translations, -n before ti, editorial note stripping, inflection matching, and dual Tika reverse links', () async {
      final db = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        db.execute('''
          CREATE TABLE books (id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT, nikaya TEXT, category TEXT);
          CREATE TABLE chapters (id INTEGER PRIMARY KEY, book_id INTEGER, book_code TEXT, chapter_index INTEGER, title TEXT, html TEXT);
          CREATE TABLE chapter_text_pack (book_id INTEGER NOT NULL, chapter_index INTEGER NOT NULL, data_z BLOB NOT NULL, PRIMARY KEY (book_id, chapter_index));
          CREATE TABLE canon_paragraphs (
            global_id INTEGER PRIMARY KEY, book_code TEXT, chapter_index INTEGER, para_index INTEGER,
            para_num TEXT, para_first INTEGER, para_last INTEGER, pali_text TEXT,
            mula_book TEXT, mula_chapter INTEGER, mula_para TEXT,
            attha_book TEXT, attha_chapter INTEGER, attha_para TEXT,
            tika_book TEXT, tika_chapter INTEGER, tika_para TEXT
          );
          INSERT INTO books VALUES
            (1, 's0101m.mul', 'Brahmajāla', 'digha', 'mūla'),
            (2, 's0101a.att', 'Brahmajāla-aṭṭhakathā', 'digha', 'aṭṭhakathā'),
            (3, 's0101t.tik', 'Brahmajāla-ṭīkā', 'digha', 'ṭīkā');
          INSERT INTO chapters VALUES
            (1, 1, 's0101m.mul', 0, 'M', ''),
            (2, 2, 's0101a.att', 0, 'A', ''),
            (3, 3, 's0101t.tik', 0, 'T', '');
        ''');

        final packM = zlib.encode(utf8.encode(jsonEncode([
          [
            5,
            null,
            [
              [1, 'Ekaṃ samayaṃ bhagavā viharati.'],
              [2, 'Bhagavantaṃ piṭṭhito piṭṭhito anubandhā [anubaddhā (ka. sī. pī.)] honti.'],
            ],
          ],
        ])));
        final packA = zlib.encode(utf8.encode(jsonEncode([
          [
            10,
            null,
            [
              [1, '<b>Samayo</b>ti kālo.'],
              [2, '<b>Bhagavantaṃ piṭṭhito piṭṭhito anubandhā hontī</b>ti pacchato gacchanti.'],
              [3, '<b>Ayaṃ</b>ti idha niddeso.'],
              [4, '<b>Evan</b>ti niddisati.'],
            ],
          ],
        ])));
        final packT = zlib.encode(utf8.encode(jsonEncode([
          [
            20,
            null,
            [
              [1, '<b>Viharatī</b>ti iriyāpathavasena.'],
              [2, '<b>Kālo</b>ti samayaviseso.'],
            ],
          ],
        ])));
        db.execute('INSERT INTO chapter_text_pack VALUES (?, ?, ?)', [1, 0, packM]);
        db.execute('INSERT INTO chapter_text_pack VALUES (?, ?, ?)', [2, 0, packA]);
        db.execute('INSERT INTO chapter_text_pack VALUES (?, ?, ?)', [3, 0, packT]);

        db.execute(
          'INSERT INTO canon_paragraphs VALUES '
          "(1, 's0101m.mul', 0, 5, '5', 5, 5, NULL, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5'),"
          "(2, 's0101a.att', 0, 10, '5', 5, 5, NULL, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5'),"
          "(3, 's0101t.tik', 0, 20, '5', 5, 5, NULL, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5');",
        );
      } finally {
        db.close();
      }

      final transEn = sqlite3.open(p.join(tmpDir.path, 'translation_en.db'));
      try {
        transEn.execute('''
          CREATE TABLE paragraph_translations (
            book_code TEXT, chapter_index INTEGER, para_index INTEGER,
            translation TEXT, sentences_json TEXT
          );
          CREATE TABLE sentence_translations (
            book_code TEXT, chapter_index INTEGER, para_index INTEGER,
            line_id INTEGER, translation TEXT
          );
        ''');
        transEn.execute(
          'INSERT INTO paragraph_translations VALUES (?, ?, ?, ?, ?)',
          [
            's0101a.att',
            0,
            10,
            'WHOLE PARAGRAPH SHOULD NOT LEAK',
            jsonEncode([
              {'line_id': 1, 'translation': 'Samaya means time (line 1).'},
              {'line_id': 4, 'translation': 'Thus means explained (line 4).'},
            ]),
          ],
        );
        transEn.execute(
          'INSERT INTO sentence_translations VALUES (?, ?, ?, ?, ?)',
          ['s0101a.att', 0, 10, 4, 'Thus means explained (line 4).'],
        );
      } finally {
        transEn.close();
      }

      final boldService = BoldDefinitionIndexService();
      await boldService.ensureBuilt(dbDirPath: tmpDir.path, force: true);

      final bdb = sqlite3.open(p.join(tmpDir.path, BoldDefinitionIndexService.dbFilename), mode: OpenMode.readOnly);
      try {
        final ver = bdb.select("SELECT value FROM meta WHERE key = 'schema_version'").first['value'];
        expect(ver, '4');
      } finally {
        bdb.close();
      }

      // -n before ti (`<b>Evan</b>ti` -> word='evaṃ', lineId=4) & sentence-level translation
      final evamRes = await boldService.lookup(dbDirPath: tmpDir.path, rawWord: 'evaṃ', enabledLangs: ['en']);
      expect(evamRes.results, isNotEmpty);
      expect(evamRes.results.first.word, 'evaṃ');
      expect(evamRes.results.first.lineId, 4);
      expect(evamRes.results.first.translations['en'], 'Thus means explained (line 4).');

      final samayaRes = await boldService.lookup(dbDirPath: tmpDir.path, rawWord: 'samayo', enabledLangs: ['en']);
      expect(samayaRes.results.first.lineId, 1);
      expect(samayaRes.results.first.translations['en'], 'Samaya means time (line 1).');

      final linkedService = LinkedDefinitionService(boldService: boldService);
      final mLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101m.mul',
        chapterIndex: 0,
      );
      final p5ByLine = ((mLinks['paragraphs'] as Map)['5'] as Map)['by_line'] as Map<String, dynamic>;
      final l1 = (p5ByLine['1'] as List).cast<Map<String, dynamic>>();
      final l2 = (p5ByLine['2'] as List).cast<Map<String, dynamic>>();
      expect(l1.any((e) => e['word'] == 'samayo' && e['target_line_id'] == 1), isTrue);
      expect(l1.any((e) => e['word'] == 'ayaṃ'), isFalse);
      expect(l1.any((e) => e['word'] == 'viharatī' && e['target_book'] == 's0101t.tik' && e['target_line_id'] == 1), isTrue);
      expect(l2.any((e) => e['word'] == 'bhagavantaṃ piṭṭhito piṭṭhito anubandhā hontī' && e['target_line_id'] == 2), isTrue);

      final tLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101t.tik',
        chapterIndex: 0,
      );
      final p20ByLine = ((tLinks['paragraphs'] as Map)['20'] as Map)['by_line'] as Map<String, dynamic>;
      expect(
        (p20ByLine['1'] as List).cast<Map<String, dynamic>>().any(
          (e) => e['word'] == 'viharatī' && e['target_book'] == 's0101m.mul' && e['target_line_id'] == 1 && e['is_source'] == true,
        ),
        isTrue,
      );
      expect(
        (p20ByLine['2'] as List).cast<Map<String, dynamic>>().any(
          (e) => e['word'] == 'kālo' && e['target_book'] == 's0101a.att' && e['target_line_id'] == 1 && e['is_source'] == true,
        ),
        isTrue,
      );
    });

    test('multi-para para_num, CST normalization, no bogus line-1 fallback, boundary-safe highlight, and v2->v3 auto-upgrade', () async {
      final tmpDir = await Directory.systemTemp.createTemp('bold_linked_multipara_');
      addTearDown(() async {
        if (tmpDir.existsSync()) await tmpDir.delete(recursive: true);
      });

      final db = sqlite3.open(p.join(tmpDir.path, 'tipitaka.db'));
      try {
        db.execute('''
          CREATE TABLE books (id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT, nikaya TEXT, category TEXT);
          CREATE TABLE chapters (id INTEGER PRIMARY KEY, book_id INTEGER, book_code TEXT, chapter_index INTEGER, title TEXT, html TEXT);
          CREATE TABLE chapter_text_pack (book_id INTEGER NOT NULL, chapter_index INTEGER NOT NULL, data_z BLOB NOT NULL, PRIMARY KEY (book_id, chapter_index));
          CREATE TABLE canon_paragraphs (
            global_id INTEGER PRIMARY KEY, book_code TEXT, chapter_index INTEGER, para_index INTEGER,
            para_num TEXT, para_first INTEGER, para_last INTEGER, pali_text TEXT,
            mula_book TEXT, mula_chapter INTEGER, mula_para TEXT,
            attha_book TEXT, attha_chapter INTEGER, attha_para TEXT,
            tika_book TEXT, tika_chapter INTEGER, tika_para TEXT
          );
          INSERT INTO books VALUES
            (1, 's0101m.mul', 'Mula', 'digha', 'mūla'),
            (2, 's0101a.att', 'Attha', 'digha', 'aṭṭhakathā'),
            (3, 's0101t.tik', 'Tika', 'digha', 'ṭīkā');
          INSERT INTO chapters VALUES
            (1, 1, 's0101m.mul', 0, 'M0', ''),
            (2, 2, 's0101a.att', 0, 'A0', ''),
            (3, 3, 's0101t.tik', 0, 'T0', '');
        ''');

        List<int> z(String s) => zlib.encode(utf8.encode(s));

        db.execute(
          'INSERT INTO chapter_text_pack VALUES (?, ?, ?)',
          [1, 0, z(jsonEncode([[5, null, [[1, 'Addhānamaggappaṭipanno hoti.']]]]))],
        );
        db.execute(
          'INSERT INTO chapter_text_pack VALUES (?, ?, ?)',
          [
            2,
            0,
            z(jsonEncode([
              [20, null, [[1, 'Samena vuttanti.']]],
              [21, null, [[1, '‘ mayā ’ ti atthe sati.']]],
              [
                22,
                null,
                [
                  [1, 'Intro line.'],
                  [2, '<b>Me</b> -saddo tiādīsu.'],
                  [3, 'Evametaṃ bhagavā, evametaṃ sugatā.'],
                  [4, 'Evaṃ te bhikkhave upadese.'],
                ],
              ],
            ])),
          ],
        );
        db.execute(
          'INSERT INTO chapter_text_pack VALUES (?, ?, ?)',
          [
            3,
            0,
            z(jsonEncode([
              [
                30,
                null,
                [
                  [1, '<b>Me saddo</b> tīsu atthesu dissatīti.'],
                  [2, '<b>Evametaṃ bhagavā evametaṃ sugatā</b>ti vacanaṃ.'],
                  [3, '<b>Mayāti atthe satī</b>ti āha.'],
                  [4, '<b>Paṭipanno hotī</b>ti gacchati.'],
                  [5, '<b>Evaṃ te pe upadese</b>ti saṃkhepo.'],
                  [6, '<b>Sambandho</b>ti anukkamena.'],
                ],
              ],
            ])),
          ],
        );

        db.execute(
          'INSERT INTO canon_paragraphs VALUES '
          "(1, 's0101m.mul', 0, 5, '1', 1, 1, NULL, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
          "(2, 's0101a.att', 0, 20, '1', 1, 1, NULL, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
          "(3, 's0101a.att', 0, 21, '1', 1, 1, NULL, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
          "(4, 's0101a.att', 0, 22, '1', 1, 1, NULL, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1'),"
          "(5, 's0101t.tik', 0, 30, '1', 1, 1, NULL, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');",
        );
      } finally {
        db.close();
      }

      // Create a stale v2 bold_definitions.db WITHOUT line_id column to verify auto-upgrade in both services
      final staleBold = sqlite3.open(p.join(tmpDir.path, 'bold_definitions.db'));
      try {
        staleBold.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);');
        staleBold.execute("INSERT INTO meta VALUES ('schema_version', '2');");
        staleBold.execute('''
          CREATE TABLE bold_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_code TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            para_index INTEGER NOT NULL,
            para_num TEXT,
            word TEXT NOT NULL,
            word_clean TEXT NOT NULL,
            ending TEXT,
            snippet TEXT NOT NULL
          );
        ''');
        staleBold.execute(
          "INSERT INTO bold_definitions (book_code, chapter_index, para_index, para_num, word, word_clean, ending, snippet) VALUES ('s0101t.tik', 0, 30, '1', 'me saddo', 'me saddo', '', 'old')",
        );
      } finally {
        staleBold.close();
      }

      final boldService = BoldDefinitionIndexService();
      // Calling lookup on stale v2 DB must auto-rebuild to v3 without throwing on missing line_id
      final lookupMatches = await boldService.lookup(
        dbDirPath: tmpDir.path,
        rawWord: 'me saddo',
      );
      expect(lookupMatches.results, isNotEmpty);
      expect(lookupMatches.results.first.lineId, 1);
      expect(BoldDefinitionIndexService.isUpToDate(tmpDir.path), isTrue);

      // Now verify LinkedDefinitionService also upgrades a stale v2 DB automatically
      final staleBold2 = sqlite3.open(p.join(tmpDir.path, 'bold_definitions.db'));
      try {
        staleBold2.execute('DROP TABLE bold_definitions;');
        staleBold2.execute("UPDATE meta SET value = '2' WHERE key = 'schema_version';");
        staleBold2.execute('''
          CREATE TABLE bold_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_code TEXT NOT NULL,
            chapter_index INTEGER NOT NULL,
            para_index INTEGER NOT NULL,
            para_num TEXT,
            word TEXT NOT NULL,
            word_clean TEXT NOT NULL,
            ending TEXT,
            snippet TEXT NOT NULL
          );
        ''');
      } finally {
        staleBold2.close();
      }

      final linkedService = LinkedDefinitionService();
      final tLinks = await linkedService.getLinksForChapter(
        dbDirPath: tmpDir.path,
        bookCode: 's0101t.tik',
        chapterIndex: 0,
      );
      expect(BoldDefinitionIndexService.isUpToDate(tmpDir.path), isTrue);
      final p30ByLine = ((tLinks['paragraphs'] as Map)['30'] as Map)['by_line'] as Map<String, dynamic>;

      List<Map<String, dynamic>> lineLinks(String lid) =>
          ((p30ByLine[lid] as List?) ?? const []).cast<Map<String, dynamic>>();

      expect(lineLinks('1').any((e) => e['word'] == 'me saddo' && e['target_book'] == 's0101a.att' && e['target_para_index'] == 22 && e['target_line_id'] == 2), isTrue);
      expect(lineLinks('2').any((e) => e['word'] == 'evametaṃ bhagavā evametaṃ sugatā' && e['target_book'] == 's0101a.att' && e['target_para_index'] == 22 && e['target_line_id'] == 3), isTrue);
      expect(lineLinks('3').any((e) => e['word'] == 'mayāti atthe satī' && e['target_book'] == 's0101a.att' && e['target_para_index'] == 21 && e['target_line_id'] == 1), isTrue);
      expect(lineLinks('4').any((e) => e['word'] == 'paṭipanno hotī' && e['target_book'] == 's0101m.mul' && e['target_para_index'] == 5 && e['target_line_id'] == 1), isTrue);
      expect(lineLinks('5').any((e) => e['word'] == 'evaṃ te pe upadese' && e['target_book'] == 's0101a.att' && e['target_para_index'] == 22 && e['target_line_id'] == 4), isTrue);
      expect(lineLinks('6'), isEmpty);

      final prev1 = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        chapterIndex: 0,
        paraIndex: 20,
        lineId: 1,
        word: 'samena',
      );
      expect(prev1, isNotNull);
      final prevLines1 = prev1!.lines;
      expect(prevLines1, isNotEmpty);
      final targetLine1 = prevLines1.firstWhere((l) => l.isTarget);
      expect(targetLine1.paliHtml.contains('Sa<b>me</b>na'), isFalse);
      expect(targetLine1.paliHtml.contains('<b>Samena</b>'), isTrue);

      final prev2 = await linkedService.getLinkedPreview(
        dbDirPath: tmpDir.path,
        bookCode: 's0101a.att',
        chapterIndex: 0,
        paraNum: '1',
        word: 'mayāti atthe satī',
      );
      expect(prev2, isNotNull);
      expect(prev2!.targetParaIndex, 21);
      expect(prev2.targetLineId, 1);
    });
  });
}
