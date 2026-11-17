import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import '../utils/pali_script_converter.dart';
import 'linked_definition_service.dart';
import 'tipitaka_core_reader.dart';

class BoldDefinitionBuildResult {
  final String filename;
  final int indexedRows;
  final bool skipped;

  const BoldDefinitionBuildResult({
    required this.filename,
    required this.indexedRows,
    this.skipped = false,
  });
}

class BoldDefinitionMatch {
  final String bookCode;
  final String bookTitle;
  final String category;
  final int chapterIndex;
  final int paraIndex;
  final int lineId;
  final String? paraNum;
  final String word;
  final String plain;
  final String? ending;
  final String sentenceHtml;
  final String? beforeHtml;
  final String? afterHtml;
  final Map<String, String> translations;
  final Map<String, dynamic>? mat;

  const BoldDefinitionMatch({
    required this.bookCode,
    required this.bookTitle,
    required this.category,
    required this.chapterIndex,
    required this.paraIndex,
    this.lineId = 1,
    this.paraNum,
    required this.word,
    required this.plain,
    this.ending,
    required this.sentenceHtml,
    this.beforeHtml,
    this.afterHtml,
    this.translations = const {},
    this.mat,
  });

  Map<String, dynamic> toJson() => {
    'book_code': bookCode,
    'book_title': bookTitle,
    'category': category,
    'chapter_index': chapterIndex,
    'para_index': paraIndex,
    'line_id': lineId,
    'para_num': paraNum,
    'word': word,
    'plain': plain,
    'ending': ending,
    'sentence_html': sentenceHtml,
    'before_html': beforeHtml,
    'after_html': afterHtml,
    'translations': translations,
    if (mat != null) 'mat': mat,
  };
}

class BoldDefinitionQueryResult {
  final String query;
  final String searchPrefix;
  final List<BoldDefinitionMatch> results;

  const BoldDefinitionQueryResult({
    required this.query,
    required this.searchPrefix,
    required this.results,
  });
}

/// Builds and queries `bold_definitions.db` directly from `tipitaka.db`
/// (`chapter_text_pack` / `pali_sentences` with per-paragraph fallback to
/// `chapters.html`), recording sentence `line_id` and resolving sentence-level
/// translations.
class BoldDefinitionIndexService {
  static const String dbFilename = 'bold_definitions.db';
  static const String schemaVersion = '4';
  static const int _maxDistinctWords = 25;
  static const int _maxOccurrencesPerWord = 5;
  static const int _shortSentenceThreshold = 100;

  static final Map<String, Future<BoldDefinitionBuildResult>> _inFlight = {};

  static final RegExp _pTagRe = RegExp(
    r'<p\b([^>]*)>([\s\S]*?)</p>',
    caseSensitive: false,
  );
  static final RegExp _pindexAttrRe = RegExp(
    r'\bdata-pindex="(\d+)"',
    caseSensitive: false,
  );
  static final RegExp _paraAttrRe = RegExp(
    r'\bdata-para="([^"]*)"',
    caseSensitive: false,
  );
  static final RegExp _classAttrRe = RegExp(
    r'\bclass="([^"]*)"',
    caseSensitive: false,
  );
  static final RegExp _pbSpanRe = RegExp(
    r'<span\b[^>]*\bclass=["\x27]?pb["\x27]?[^>]*>[\s\S]*?</span>',
    caseSensitive: false,
  );
  static final RegExp _paranumRe = RegExp(
    r'<strong\b[^>]*\bclass=["\x27]?paranum["\x27]?[^>]*>[\s\S]*?</strong>(?:\s*<span\b[^>]*\bclass=["\x27]?dot["\x27]?[^>]*>[\s\S]*?</span>)?\s*\.?\s*',
    caseSensitive: false,
  );
  static final RegExp _bldTagRe = RegExp(
    r'<strong\b[^>]*\bclass=["\x27]?bld["\x27]?[^>]*>([\s\S]*?)</strong>',
    caseSensitive: false,
  );
  static final RegExp _anyTagExceptBRe = RegExp(
    r'<(?!/?b\b)[^>]+>',
    caseSensitive: false,
  );
  static final RegExp _boldAndSuffixRe = RegExp(
    r'''<b>([^<]+)</b>[’”"']*([a-zA-ZāīūṭḍṅñṇḷṃṁĀĪŪṬḌṄÑṆḶṂṀ]*)''',
  );
  static final RegExp _multiWsRe = RegExp(r'\s+');
  static final RegExp _wordCleanPunctRe = RegExp(
    r'''[‘’“”"'`«»‹›„.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§၊။\d]''',
  );

  static const String _paliVowels = 'aāiīuūeo';

  static String foldDiacritics(String input) {
    if (input.isEmpty) return '';
    return input
        .toLowerCase()
        .replaceAll('ā', 'a')
        .replaceAll('ī', 'i')
        .replaceAll('ū', 'u')
        .replaceAll('ṭ', 't')
        .replaceAll('ḍ', 'd')
        .replaceAll('ṅ', 'n')
        .replaceAll('ñ', 'n')
        .replaceAll('ṇ', 'n')
        .replaceAll('ḷ', 'l')
        .replaceAll('ṃ', 'm')
        .replaceAll('ṁ', 'm');
  }

  /// Pāḷi stemmer adapted from epitaka_app's `PaliStemmer.getStem`, with
  /// clean Roman diacritic normalization (`ṁ` -> `ṃ`).
  static String stemPaliWord(String word) {
    var stem = word.trim().toLowerCase().replaceAll('ṁ', 'ṃ');
    stem = stem.replaceAll(RegExp(r'[\u104a\u104b\u2018\u2019",.\?]'), '');
    if (stem.isEmpty) return '';

    final endings = <RegExp>[
      RegExp(r'ena$'),
      RegExp(r'e(?:h|bh)i$'),
      RegExp(r'ssa$'),
      RegExp(r'(?<=[āīū])naṃ$'),
      RegExp(r'smā$'),
      RegExp(r'mhā$'),
      RegExp(r'smiṃ$'),
      RegExp(r'mhi$'),
      RegExp(r'esu$'),
      RegExp(r'āni$'),
      RegExp(r'(?<=ā)yo$'),
      RegExp(r'(?<=i)yā$'),
      RegExp(r'(?<=ā)yaṃ?$'),
      RegExp(r'(?<=[āiīuū])su$'),
      RegExp(r'o$'),
      RegExp(r'e$'),
    ];

    for (final ending in endings) {
      if (ending.hasMatch(stem)) {
        stem = stem.replaceAll(ending, 'a');
        break;
      }
    }
    if (stem.endsWith('ṃ') && stem.length > 1) {
      stem = stem.substring(0, stem.length - 1);
    }
    return stem;
  }

  /// Prefix search key matching epitaka_app's `paliDefinitionSearchPrefix`:
  /// stems [word], and for stems > 5 chars ending in a Pāḷi vowel, drops
  /// the trailing vowel so sandhi/length variants (e.g. `gacchatīti`) match.
  static String searchPrefixFor(String word) {
    final cleaned = PaliScriptConverter.cleanDictionaryQuery(word)
        .toLowerCase()
        .replaceAll('ṁ', 'ṃ');
    if (cleaned.isEmpty) return '';
    var prefix = stemPaliWord(cleaned);
    if (prefix.length > 5 &&
        _paliVowels.contains(prefix[prefix.length - 1])) {
      prefix = prefix.substring(0, prefix.length - 1);
    }
    return prefix;
  }

  static String _decodeHtmlEntities(String input) {
    if (!input.contains('&')) return input;
    return input
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&apos;', "'")
        .replaceAll('&nbsp;', ' ');
  }

  static String _cleanSentenceHtml(String rawSent) {
    if (rawSent.isEmpty) return '';
    var s = rawSent.replaceAllMapped(_bldTagRe, (m) {
      final inner = (m.group(1) ?? '').replaceAll(RegExp(r'<[^>]+>'), '');
      return '<b>$inner</b>';
    });
    s = s.replaceAllMapped(RegExp(r'\*\*([^*\n]+)\*\*'), (m) => '<b>${m.group(1)}</b>');
    s = s.replaceAll(_anyTagExceptBRe, '');
    s = _decodeHtmlEntities(s);
    s = s.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'Ṃ');
    s = s.replaceAll(RegExp(r'[\u200B-\u200D\uFEFF\u00A0]'), ' ');
    return s.replaceAll(_multiWsRe, ' ').trim();
  }

  static String _cleanParagraphToHtmlWithB(String innerHtml) {
    var s = innerHtml.replaceAll(_pbSpanRe, ' ');
    s = s.replaceAll(_paranumRe, ' ');
    // Normalize <strong class="bld">...</strong> to <b>...</b>
    s = s.replaceAllMapped(_bldTagRe, (m) {
      final inner = (m.group(1) ?? '').replaceAll(RegExp(r'<[^>]+>'), '');
      return '<b>$inner</b>';
    });
    s = s.replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), ' ');
    s = s.replaceAll(_anyTagExceptBRe, '');
    s = _decodeHtmlEntities(s);
    s = s.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'Ṃ');
    s = s.replaceAll(RegExp(r'[\u200B-\u200D\uFEFF\u00A0]'), ' ');
    return s.replaceAll(_multiWsRe, ' ').trim();
  }

  /// Splits cleaned paragraph HTML (containing only `<b>...</b>` tags) into
  /// balanced sentences, keeping parenthetical citations like `(dī. ni. 1.1)`
  /// and bold spans intact.
  static List<String> _splitSentences(String html) {
    if (html.isEmpty) return const [];
    final out = <String>[];
    var parenDepth = 0;
    var inBold = false;
    var start = 0;

    for (var i = 0; i < html.length; i++) {
      if (html.startsWith('<b>', i)) {
        inBold = true;
        i += 2;
        continue;
      }
      if (html.startsWith('</b>', i)) {
        inBold = false;
        i += 3;
        continue;
      }
      final ch = html[i];
      if (ch == '(' || ch == '[') {
        parenDepth++;
        continue;
      }
      if ((ch == ')' || ch == ']') && parenDepth > 0) {
        parenDepth--;
        continue;
      }
      if (!inBold && parenDepth == 0 && (ch == '.' || ch == '?' || ch == '!' || ch == '।')) {
        // Look ahead past optional closing quotes/parens to whitespace or end.
        var j = i + 1;
        while (j < html.length &&
            (html[j] == '’' ||
                html[j] == '”' ||
                html[j] == '"' ||
                html[j] == "'" ||
                html[j] == ')')) {
          j++;
        }
        if (j == html.length || html[j] == ' ') {
          // Avoid splitting right after a tiny abbreviation like `pe.` inside a clause
          final seg = html.substring(start, j).trim();
          if (seg.isNotEmpty) {
            out.add(seg);
          }
          start = j;
          while (start < html.length && html[start] == ' ') {
            start++;
          }
          i = start - 1;
        }
      }
    }

    if (start < html.length) {
      final tail = html.substring(start).trim();
      if (tail.isNotEmpty) out.add(tail);
    }
    return out;
  }

  static ({String word, String? ending})? _extractWordAndEnding(
    String boldInner,
    String immediateSuffix,
  ) {
    var w = boldInner
        .replaceAll(RegExp(r'\[[^\]]*\]'), ' ')
        .replaceAll(_wordCleanPunctRe, ' ')
        .replaceAll('ṁ', 'ṃ')
        .replaceAll('Ṁ', 'ṃ')
        .toLowerCase()
        .replaceAll(_multiWsRe, ' ')
        .trim();
    if (w.isEmpty) return null;

    final suf = immediateSuffix.toLowerCase().replaceAll('ṁ', 'ṃ').trim();
    String? ending;
    if (suf.startsWith('nti')) {
      final last = w[w.length - 1];
      if (_paliVowels.contains(last)) {
        w = '$wṃ';
      }
      ending = suf.substring(1); // e.g. 'ti', 'tiādi'
    } else if (RegExp(r'^t[iī]').hasMatch(suf)) {
      if (w.endsWith('n') && w.length >= 2) {
        w = '${w.substring(0, w.length - 1)}ṃ';
      }
      ending = suf;
    } else if (suf.isNotEmpty) {
      ending = suf;
    }

    // Must contain at least two characters (with at least one letter).
    if (w.length < 2 || !RegExp(r'\p{L}', unicode: true).hasMatch(w)) {
      return null;
    }
    return (word: w, ending: ending);
  }

  static String _stripHtmlTags(String html) =>
      html.replaceAll(RegExp(r'<[^>]+>'), '').trim();

  static String _categoryFromBookCode(String bookCode, String? rawCategory) {
    final lowerCode = bookCode.toLowerCase();
    if (lowerCode.endsWith('.mul')) return 'mūla';
    if (lowerCode.endsWith('.att')) return 'aṭṭhakathā';
    if (lowerCode.endsWith('.tik')) return 'ṭīkā';
    if (lowerCode.endsWith('.nrf')) return 'anya';
    final cat = (rawCategory ?? '').trim();
    return cat.isEmpty ? 'anya' : cat;
  }

  static bool isInFlight(String dbDirPath) =>
      _inFlight.containsKey(p.normalize(dbDirPath));

  /// Ensures `bold_definitions.db` exists and matches `tipitaka.db` inside [dbDirPath].
  /// Deduplicates concurrent calls for the same directory.
  Future<BoldDefinitionBuildResult> ensureBuilt({
    required String dbDirPath,
    bool force = false,
  }) {
    final normalizedDir = p.normalize(dbDirPath);
    if (!force) {
      final existing = _inFlight[normalizedDir];
      if (existing != null) return existing;
    }

    final future = Isolate.run(
      () => buildSync(dbDirPath: normalizedDir, force: force),
    ).whenComplete(() {
      _inFlight.remove(normalizedDir);
    });
    _inFlight[normalizedDir] = future;
    return future;
  }

  static bool isUpToDate(String dbDirPath) => _isUpToDate(dbDirPath);

  static bool _isUpToDate(String dbDirPath) {
    final tipiFile = File(p.join(dbDirPath, 'tipitaka.db'));
    final dstFile = File(p.join(dbDirPath, dbFilename));
    if (!tipiFile.existsSync() || !dstFile.existsSync()) return false;
    if (dstFile.lengthSync() == 0) return false;

    final stat = tipiFile.statSync();
    final db = sqlite3.open(dstFile.path, mode: OpenMode.readOnly);
    try {
      final metaTbl = db.select(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta' LIMIT 1",
      );
      if (metaTbl.isEmpty) return false;
      final metaRows = db.select('SELECT key, value FROM meta');
      final meta = {
        for (final r in metaRows)
          (r['key'] ?? '').toString(): (r['value'] ?? '').toString(),
      };
      if (meta['schema_version'] != schemaVersion) return false;
      if (meta['source_size'] != '${stat.size}') return false;
      final linkTbl = db.select(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapter_links' LIMIT 1",
      );
      if (linkTbl.isEmpty) return false;
      final cnt =
          (db.select('SELECT COUNT(*) AS c FROM bold_definitions').first['c']
                  as num)
              .toInt();
      return cnt > 0;
    } catch (_) {
      return false;
    } finally {
      db.close();
    }
  }

  /// Synchronously builds `bold_definitions.db` from `tipitaka.db`.
  /// Exposed as `static` so it can run inside `Isolate.run` or tests.
  static BoldDefinitionBuildResult buildSync({
    required String dbDirPath,
    bool force = false,
  }) {
    final corePath = p.join(dbDirPath, 'tipitaka.db');
    final coreFile = File(corePath);
    if (!coreFile.existsSync()) {
      return const BoldDefinitionBuildResult(
        filename: dbFilename,
        indexedRows: 0,
        skipped: true,
      );
    }

    final dstPath = p.join(dbDirPath, dbFilename);
    if (!force && _isUpToDate(dbDirPath)) {
      final existing = sqlite3.open(dstPath, mode: OpenMode.readOnly);
      try {
        final cnt = (existing
                .select('SELECT COUNT(*) AS c FROM bold_definitions')
                .first['c'] as num)
            .toInt();
        return BoldDefinitionBuildResult(
          filename: dbFilename,
          indexedRows: cnt,
          skipped: true,
        );
      } finally {
        existing.close();
      }
    }

    final stat = coreFile.statSync();
    final tmpPath = '$dstPath.tmp';
    for (final suffix in ['', '-wal', '-shm']) {
      final f = File('$tmpPath$suffix');
      if (f.existsSync()) f.deleteSync();
    }

    final coreDb = sqlite3.open(corePath, mode: OpenMode.readOnly);
    final dstDb = sqlite3.open(tmpPath);
    var totalRows = 0;

    try {
      final booksMeta = <String, ({String title, String category})>{};
      for (final r in coreDb.select('SELECT code, title, category FROM books')) {
        final code = (r['code'] ?? '').toString();
        if (code.isEmpty) continue;
        booksMeta[code] = (
          title: (r['title'] ?? code).toString(),
          category: _categoryFromBookCode(code, r['category']?.toString()),
        );
      }

      // Map (book_code, para_index) -> para_num as fallback for paragraphs whose
      // HTML element lacks data-para (e.g. continuation paragraphs).
      final paraNumLookup = <String, Map<int, String>>{};
      try {
        final stmt = coreDb.prepare(
          'SELECT book_code, para_index, para_num FROM canon_paragraphs '
          "WHERE para_num IS NOT NULL AND para_num != ''",
        );
        try {
          final cur = stmt.selectCursor();
          while (cur.moveNext()) {
            final row = cur.current;
            final bc = (row['book_code'] ?? '').toString();
            final pidx = (row['para_index'] as num?)?.toInt();
            final pnum = row['para_num']?.toString().trim();
            if (bc.isNotEmpty && pidx != null && pnum != null && pnum.isNotEmpty) {
              paraNumLookup.putIfAbsent(bc, () => {})[pidx] = pnum;
            }
          }
        } finally {
          stmt.close();
        }
      } catch (_) {}

      dstDb.execute('PRAGMA journal_mode = MEMORY;');
      dstDb.execute('PRAGMA temp_store = MEMORY;');
      dstDb.execute('PRAGMA synchronous = OFF;');
      dstDb.execute('PRAGMA cache_size = -64000;');
      dstDb.execute('''
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE bold_definitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_code TEXT NOT NULL,
          book_title TEXT NOT NULL,
          category TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL DEFAULT 1,
          para_num TEXT,
          word TEXT NOT NULL,
          plain TEXT NOT NULL,
          ending TEXT,
          sentence_html TEXT NOT NULL,
          before_html TEXT,
          after_html TEXT
        );
      ''');

      final insertStmt = dstDb.prepare('''
        INSERT INTO bold_definitions (
          book_code, book_title, category, chapter_index, para_index, line_id, para_num,
          word, plain, ending, sentence_html, before_html, after_html
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      ''');

      final coreTables = TipitakaCoreReader.tableAndViewNames(coreDb);
      final hasPack = coreTables.contains('chapter_text_pack');
      final hasInlinePs = coreTables.contains('pali_sentences');
      final hasHtmlZ = TipitakaCoreReader.tableColumns(
        coreDb,
        'chapters',
      ).contains('html_z');

      Database? dedicatedPsDb;
      var hasDedicatedPs = false;
      final psPath = p.join(dbDirPath, 'pali_sentences.db');
      if (File(psPath).existsSync()) {
        try {
          dedicatedPsDb = sqlite3.open(psPath, mode: OpenMode.readOnly);
          hasDedicatedPs = TipitakaCoreReader.tableAndViewNames(
            dedicatedPsDb,
          ).contains('pali_sentences');
        } catch (_) {
          dedicatedPsDb?.close();
          dedicatedPsDb = null;
        }
      }

      PreparedStatement? packStmt;
      PreparedStatement? psStmt;
      if (hasPack) {
        try {
          packStmt = coreDb.prepare(
            'SELECT p.data_z FROM chapter_text_pack p '
            'JOIN books b ON b.id = p.book_id '
            'WHERE b.code = ? AND p.chapter_index = ? LIMIT 1',
          );
        } catch (_) {}
      }
      if (hasDedicatedPs && dedicatedPsDb != null) {
        try {
          psStmt = dedicatedPsDb.prepare(
            'SELECT para_index, line_id, sentence FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? '
            'ORDER BY para_index, line_id',
          );
        } catch (_) {}
      } else if (hasInlinePs) {
        try {
          psStmt = coreDb.prepare(
            'SELECT para_index, line_id, sentence FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? '
            'ORDER BY para_index, line_id',
          );
        } catch (_) {}
      }

      Map<int, List<({int lineId, String text})>> loadSentenceStoreForChapter(
        String bookCode,
        int chapterIndex,
      ) {
        if (packStmt != null) {
          try {
            final res = packStmt.select([bookCode, chapterIndex]);
            if (res.isNotEmpty) {
              final blob = res.first['data_z'];
              if (blob is List<int>) {
                final decoded = TipitakaCoreReader.decodeChapterTextPack(blob);
                if (decoded.isNotEmpty) {
                  return {
                    for (final entry in decoded.entries)
                      if (entry.value.sentences.isNotEmpty)
                        entry.key: entry.value.sentences,
                  };
                }
              }
            }
          } catch (_) {}
        }
        if (psStmt != null) {
          try {
            final rows = psStmt.select([bookCode, chapterIndex]);
            if (rows.isNotEmpty) {
              final map = <int, List<({int lineId, String text})>>{};
              for (final r in rows) {
                final pidx = (r['para_index'] as num).toInt();
                final lid = (r['line_id'] as num).toInt();
                final txt = (r['sentence'] ?? '').toString();
                map.putIfAbsent(pidx, () => []).add((lineId: lid, text: txt));
              }
              return map;
            }
          } catch (_) {}
        }
        return const {};
      }

      void emitSentencesForPara(
        String bookCode,
        String bookTitle,
        String category,
        int chapterIndex,
        int paraIndex,
        String? paraNum,
        List<({int lineId, String text})> sentences,
      ) {
        for (var sIdx = 0; sIdx < sentences.length; sIdx++) {
          final rec = sentences[sIdx];
          final sent = rec.text;
          if (!sent.contains('<b>')) continue;

          final plainSent = _stripHtmlTags(sent);
          final isShort = plainSent.length < _shortSentenceThreshold;
          final beforeHtml = isShort && sIdx > 0 ? sentences[sIdx - 1].text : null;
          final afterHtml = isShort && sIdx < sentences.length - 1
              ? sentences[sIdx + 1].text
              : null;

          final seenInSentence = <String>{};
          for (final bm in _boldAndSuffixRe.allMatches(sent)) {
            final parsed = _extractWordAndEnding(
              bm.group(1) ?? '',
              bm.group(2) ?? '',
            );
            if (parsed == null) continue;
            final dedupeKey = '${parsed.word}|${parsed.ending ?? ''}';
            if (!seenInSentence.add(dedupeKey)) continue;

            insertStmt.execute([
              bookCode,
              bookTitle,
              category,
              chapterIndex,
              paraIndex,
              rec.lineId,
              paraNum,
              parsed.word,
              foldDiacritics(parsed.word),
              parsed.ending,
              sent,
              beforeHtml,
              afterHtml,
            ]);
            totalRows++;
          }
        }
      }

      try {
        final chapStmt = coreDb.prepare(
          hasHtmlZ
              ? 'SELECT book_code, chapter_index, html, html_z FROM chapters '
                  'ORDER BY book_code, chapter_index'
              : 'SELECT book_code, chapter_index, html FROM chapters '
                  'ORDER BY book_code, chapter_index',
        );
        try {
          final cur = chapStmt.selectCursor();
          final processedChapters = <String>{};
          dstDb.execute('BEGIN;');
          try {
            while (cur.moveNext()) {
              final r = cur.current;
              final bookCode = (r['book_code'] ?? '').toString();
              final chapterIndex =
                  (r['chapter_index'] as num?)?.toInt() ?? 0;
              if (bookCode.isEmpty) continue;
              processedChapters.add('$bookCode|$chapterIndex');

              final bookInfo = booksMeta[bookCode];
              final bookTitle = bookInfo?.title ?? bookCode;
              final category =
                  bookInfo?.category ?? _categoryFromBookCode(bookCode, null);
              final bookParaMap = paraNumLookup[bookCode];

              final sentStoreMap =
                  loadSentenceStoreForChapter(bookCode, chapterIndex);
              final boldParasInSentStore = <int>{};
              if (sentStoreMap.isNotEmpty) {
                for (final entry in sentStoreMap.entries) {
                  final normalized = [
                    for (final s in entry.value)
                      (lineId: s.lineId, text: _cleanSentenceHtml(s.text)),
                  ];
                  if (!normalized.any((s) => s.text.contains('<b>'))) continue;
                  boldParasInSentStore.add(entry.key);
                  emitSentencesForPara(
                    bookCode,
                    bookTitle,
                    category,
                    chapterIndex,
                    entry.key,
                    bookParaMap?[entry.key],
                    normalized,
                  );
                }
              }

              final html = TipitakaCoreReader.decodeTextOrZlib(
                    r['html'],
                    hasHtmlZ ? r['html_z'] : null,
                  ) ??
                  '';
              if (html.isEmpty || !html.contains('bld')) {
                continue;
              }

              for (final pm in _pTagRe.allMatches(html)) {
                final attrs = pm.group(1) ?? '';
                final inner = pm.group(2) ?? '';
                if (!inner.contains('bld')) continue;

                final cls = _classAttrRe.firstMatch(attrs)?.group(1) ?? '';
                if (RegExp(
                  r'\b(nikaya|book|title)\b',
                  caseSensitive: false,
                ).hasMatch(cls)) {
                  continue;
                }

                final pidxStr = _pindexAttrRe.firstMatch(attrs)?.group(1);
                final paraIndex =
                    pidxStr != null ? int.tryParse(pidxStr) : null;
                if (paraIndex == null ||
                    boldParasInSentStore.contains(paraIndex)) {
                  continue;
                }

                var paraNum = _paraAttrRe.firstMatch(attrs)?.group(1)?.trim();
                if (paraNum == null || paraNum.isEmpty) {
                  paraNum = bookParaMap?[paraIndex];
                }

                final cleanedPara = _cleanParagraphToHtmlWithB(inner);
                if (!cleanedPara.contains('<b>')) continue;

                final sentences = _splitSentences(cleanedPara);
                if (sentences.isEmpty) continue;

                final splitRecs = [
                  for (var i = 0; i < sentences.length; i++)
                    (lineId: i + 1, text: sentences[i]),
                ];
                emitSentencesForPara(
                  bookCode,
                  bookTitle,
                  category,
                  chapterIndex,
                  paraIndex,
                  paraNum,
                  splitRecs,
                );
              }
            }

            if (hasPack) {
              try {
                final extraPackStmt = coreDb.prepare(
                  'SELECT b.code AS book_code, p.chapter_index, p.data_z '
                  'FROM chapter_text_pack p JOIN books b ON b.id = p.book_id '
                  'ORDER BY b.code, p.chapter_index',
                );
                try {
                  final eCur = extraPackStmt.selectCursor();
                  while (eCur.moveNext()) {
                    final er = eCur.current;
                    final bc = (er['book_code'] ?? '').toString();
                    final cidx = (er['chapter_index'] as num?)?.toInt() ?? 0;
                    if (bc.isEmpty ||
                        !processedChapters.add('$bc|$cidx')) {
                      continue;
                    }
                    final blob = er['data_z'];
                    if (blob is! List<int>) continue;
                    final decoded =
                        TipitakaCoreReader.decodeChapterTextPack(blob);
                    if (decoded.isEmpty) continue;
                    final bookInfo = booksMeta[bc];
                    final bookTitle = bookInfo?.title ?? bc;
                    final category =
                        bookInfo?.category ?? _categoryFromBookCode(bc, null);
                    final bookParaMap = paraNumLookup[bc];
                    for (final entry in decoded.entries) {
                      final normalized = [
                        for (final s in entry.value.sentences)
                          (lineId: s.lineId, text: _cleanSentenceHtml(s.text)),
                      ];
                      if (!normalized.any((s) => s.text.contains('<b>'))) {
                        continue;
                      }
                      emitSentencesForPara(
                        bc,
                        bookTitle,
                        category,
                        cidx,
                        entry.key,
                        bookParaMap?[entry.key],
                        normalized,
                      );
                    }
                  }
                } finally {
                  extraPackStmt.close();
                }
              } catch (_) {}
            }

            dstDb.execute('COMMIT;');
          } catch (e) {
            try {
              dstDb.execute('ROLLBACK;');
            } catch (_) {}
            rethrow;
          }
        } finally {
          chapStmt.close();
        }
      } finally {
        packStmt?.close();
        psStmt?.close();
        dedicatedPsDb?.close();
        insertStmt.close();
      }

      dstDb.execute('CREATE INDEX idx_bdef_word ON bold_definitions(word);');
      dstDb.execute('CREATE INDEX idx_bdef_plain ON bold_definitions(plain);');
      dstDb.execute(
        'CREATE INDEX idx_bdef_book_para ON bold_definitions(book_code, chapter_index, para_index);',
      );
      dstDb.execute(
        'CREATE INDEX idx_bdef_loc ON bold_definitions(book_code, chapter_index, para_index, line_id);',
      );
      dstDb.execute(
        'CREATE INDEX idx_bdef_book_pnum ON bold_definitions(book_code, para_num);',
      );
      dstDb.execute(
        'CREATE INDEX idx_bdef_book_ch_pnum ON bold_definitions(book_code, chapter_index, para_num);',
      );
      LinkedDefinitionService.prebuildChapterLinksSync(
        tipiDb: coreDb,
        boldDb: dstDb,
        paliSentDbPath: hasDedicatedPs ? psPath : null,
      );

      final metaStmt = dstDb.prepare(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?);',
      );
      try {
        metaStmt.execute(['schema_version', schemaVersion]);
        metaStmt.execute(['source_size', '${stat.size}']);
        metaStmt.execute([
          'source_mtime',
          '${stat.modified.millisecondsSinceEpoch}',
        ]);
        metaStmt.execute(['total_rows', '$totalRows']);
      } finally {
        metaStmt.close();
      }
    } finally {
      coreDb.close();
      dstDb.close();
    }

    for (final suffix in ['', '-wal', '-shm']) {
      final f = File('$dstPath$suffix');
      if (f.existsSync()) f.deleteSync();
    }
    File(tmpPath).renameSync(dstPath);
    for (final suffix in ['-wal', '-shm']) {
      final f = File('$tmpPath$suffix');
      if (f.existsSync()) f.deleteSync();
    }

    return BoldDefinitionBuildResult(
      filename: dbFilename,
      indexedRows: totalRows,
    );
  }

  /// Queries `bold_definitions.db` for [rawWord], attaching translations for
  /// [enabledLangs] and MAT links from `tipitaka.db`.
  Future<BoldDefinitionQueryResult> lookup({
    required String dbDirPath,
    required String rawWord,
    List<String> enabledLangs = const [],
    Database? boldDbOverride,
    Database? tipitakaDbOverride,
    Database? Function(String langCode)? openTranslationDb,
  }) async {
    final cleaned = PaliScriptConverter.cleanDictionaryQuery(rawWord)
        .toLowerCase()
        .replaceAll('ṁ', 'ṃ')
        .trim();
    if (cleaned.isEmpty) {
      return const BoldDefinitionQueryResult(
        query: '',
        searchPrefix: '',
        results: [],
      );
    }

    final prefix = searchPrefixFor(cleaned);
    if (prefix.isEmpty) {
      return BoldDefinitionQueryResult(
        query: cleaned,
        searchPrefix: '',
        results: const [],
      );
    }

    Database? ownedBoldDb;
    Database? boldDb = boldDbOverride;
    if (boldDb == null) {
      final boldPath = p.join(dbDirPath, dbFilename);
      if (!isUpToDate(dbDirPath)) {
        await ensureBuilt(dbDirPath: dbDirPath);
      }
      if (!File(boldPath).existsSync()) {
        return BoldDefinitionQueryResult(
          query: cleaned,
          searchPrefix: prefix,
          results: const [],
        );
      }
      ownedBoldDb = sqlite3.open(boldPath, mode: OpenMode.readOnly);
      boldDb = ownedBoldDb;
    }

    Database? ownedTipiDb;
    Database? tipiDb = tipitakaDbOverride;
    if (tipiDb == null) {
      final tipiPath = p.join(dbDirPath, 'tipitaka.db');
      if (File(tipiPath).existsSync()) {
        ownedTipiDb = sqlite3.open(tipiPath, mode: OpenMode.readOnly);
        tipiDb = ownedTipiDb;
      }
    }

    try {
      final escapedPrefix = prefix.replaceAll('[', '[[]').replaceAll('*', '[*]').replaceAll('?', '[?]');
      ResultSet rows = boldDb.select(
        '''
        WITH ranked AS (
          SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                 para_num, word, plain, ending, sentence_html, before_html, after_html,
                 DENSE_RANK() OVER (ORDER BY length(word), word) AS word_rank,
                 ROW_NUMBER() OVER (
                   PARTITION BY word
                   ORDER BY
                     CASE category
                       WHEN 'aṭṭhakathā' THEN 1
                       WHEN 'ṭīkā' THEN 2
                       WHEN 'mūla' THEN 3
                       ELSE 4
                     END,
                     book_code, chapter_index, para_index, line_id
                 ) AS rn
          FROM bold_definitions
          WHERE word GLOB ?
        )
        SELECT book_code, book_title, category, chapter_index, para_index, line_id,
               para_num, word, plain, ending, sentence_html, before_html, after_html
        FROM ranked
        WHERE (word_rank <= ? OR word = ?) AND rn <= ?
        ORDER BY
          CASE WHEN word = ? THEN 0 ELSE 1 END,
          length(word),
          word,
          CASE category
            WHEN 'aṭṭhakathā' THEN 1
            WHEN 'ṭīkā' THEN 2
            WHEN 'mūla' THEN 3
            ELSE 4
          END,
          book_code,
          chapter_index,
          para_index,
          line_id
        ''',
        [
          '$escapedPrefix*',
          _maxDistinctWords,
          cleaned,
          _maxOccurrencesPerWord,
          cleaned,
        ],
      );

      // Diacritic-folded fallback when exact Unicode prefix yielded nothing.
      if (rows.isEmpty) {
        final foldedPrefix = foldDiacritics(prefix);
        final foldedCleaned = foldDiacritics(cleaned);
        final escapedFolded = foldedPrefix
            .replaceAll('[', '[[]')
            .replaceAll('*', '[*]')
            .replaceAll('?', '[?]');
        rows = boldDb.select(
          '''
          WITH ranked AS (
            SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                   para_num, word, plain, ending, sentence_html, before_html, after_html,
                   DENSE_RANK() OVER (ORDER BY length(plain), plain) AS word_rank,
                   ROW_NUMBER() OVER (
                     PARTITION BY plain
                     ORDER BY
                       CASE category
                         WHEN 'aṭṭhakathā' THEN 1
                         WHEN 'ṭīkā' THEN 2
                         WHEN 'mūla' THEN 3
                         ELSE 4
                       END,
                       book_code, chapter_index, para_index, line_id
                   ) AS rn
            FROM bold_definitions
            WHERE plain GLOB ?
          )
          SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                 para_num, word, plain, ending, sentence_html, before_html, after_html
          FROM ranked
          WHERE (word_rank <= ? OR plain = ?) AND rn <= ?
          ORDER BY
            CASE WHEN plain = ? THEN 0 ELSE 1 END,
            length(plain),
            plain,
            CASE category
              WHEN 'aṭṭhakathā' THEN 1
              WHEN 'ṭīkā' THEN 2
              WHEN 'mūla' THEN 3
              ELSE 4
            END,
            book_code,
            chapter_index,
            para_index,
            line_id
          ''',
          [
            '$escapedFolded*',
            _maxDistinctWords,
            foldedCleaned,
            _maxOccurrencesPerWord,
            foldedCleaned,
          ],
        );
      }

      if (rows.isEmpty) {
        return BoldDefinitionQueryResult(
          query: cleaned,
          searchPrefix: prefix,
          results: const [],
        );
      }

      // Collect unique (book_code, chapter_index, para_index) keys for batch
      // lookup of translations & MAT references.
      final uniqueLocations = <String, ({String book, int chap, int para})>{};
      for (final r in rows) {
        final b = r['book_code'].toString();
        final c = (r['chapter_index'] as num).toInt();
        final pa = (r['para_index'] as num).toInt();
        uniqueLocations['$b:$c:$pa'] = (book: b, chap: c, para: pa);
      }

      final sentTransByLine = <String, String>{};
      final paraFallbackByLoc = <String, String>{};
      final parasWithSentTrans = <String>{};
      final loadedLangs = <String>[];
      if (enabledLangs.isNotEmpty) {
        for (final lang in enabledLangs) {
          Database? ownedTdb;
          Database? tdb = openTranslationDb?.call(lang);
          if (tdb == null) {
            final tPath = p.join(dbDirPath, 'translation_$lang.db');
            if (File(tPath).existsSync()) {
              ownedTdb = sqlite3.open(tPath, mode: OpenMode.readOnly);
              tdb = ownedTdb;
            }
          }
          if (tdb == null) continue;
          loadedLangs.add(lang);
          try {
            // Group by book_code so queries stay indexed.
            final byBook = <String, List<({int chap, int para})>>{};
            for (final loc in uniqueLocations.values) {
              byBook.putIfAbsent(loc.book, () => []).add((
                chap: loc.chap,
                para: loc.para,
              ));
            }
            final tTables = TipitakaCoreReader.tableAndViewNames(tdb);
            final hasSentTable = tTables.contains('sentence_translations');
            final hasParaTable = tTables.contains('paragraph_translations');
            final paraCols = hasParaTable
                ? TipitakaCoreReader.tableColumns(tdb, 'paragraph_translations')
                : const <String>{};
            final hasSentJson = paraCols.contains('sentences_json');

            for (final entry in byBook.entries) {
              final paraSet = entry.value.map((e) => e.para).toSet().toList();
              final placeholders = paraSet.map((_) => '?').join(',');
              if (hasSentTable) {
                try {
                  final sRows = tdb.select(
                    'SELECT chapter_index, para_index, line_id, translation '
                    'FROM sentence_translations '
                    'WHERE book_code = ? AND para_index IN ($placeholders)',
                    [entry.key, ...paraSet],
                  );
                  for (final sr in sRows) {
                    final c = (sr['chapter_index'] as num).toInt();
                    final pa = (sr['para_index'] as num).toInt();
                    final lid = (sr['line_id'] as num).toInt();
                    final text = (sr['translation'] ?? '').toString().trim();
                    if (text.isEmpty) continue;
                    final pKey = '$lang|${entry.key}:$c:$pa';
                    parasWithSentTrans.add(pKey);
                    sentTransByLine['$pKey:$lid'] = text;
                  }
                } catch (_) {}
              }
              if (hasParaTable) {
                try {
                  final tRows = tdb.select(
                    hasSentJson
                        ? 'SELECT chapter_index, para_index, translation, sentences_json '
                            'FROM paragraph_translations '
                            'WHERE book_code = ? AND para_index IN ($placeholders)'
                        : 'SELECT chapter_index, para_index, translation '
                            'FROM paragraph_translations '
                            'WHERE book_code = ? AND para_index IN ($placeholders)',
                    [entry.key, ...paraSet],
                  );
                  for (final tr in tRows) {
                    final c = (tr['chapter_index'] as num).toInt();
                    final pa = (tr['para_index'] as num).toInt();
                    final pKey = '$lang|${entry.key}:$c:$pa';
                    if (hasSentJson && tr['sentences_json'] != null) {
                      try {
                        final dec = jsonDecode(tr['sentences_json'].toString());
                        if (dec is List) {
                          for (var idx = 0; idx < dec.length; idx++) {
                            final item = dec[idx];
                            if (item is String) {
                              final st = item.trim();
                              if (st.isNotEmpty) {
                                parasWithSentTrans.add(pKey);
                                sentTransByLine.putIfAbsent(
                                  '$pKey:${idx + 1}',
                                  () => st,
                                );
                              }
                            } else if (item is Map &&
                                item['line_id'] != null &&
                                item['translation'] != null) {
                              final st = item['translation'].toString().trim();
                              if (st.isNotEmpty) {
                                final lid = (item['line_id'] as num).toInt();
                                parasWithSentTrans.add(pKey);
                                sentTransByLine.putIfAbsent(
                                  '$pKey:$lid',
                                  () => st,
                                );
                              }
                            }
                          }
                        }
                      } catch (_) {}
                    }
                    final text = (tr['translation'] ?? '').toString().trim();
                    if (text.isNotEmpty) {
                      paraFallbackByLoc[pKey] = text;
                    }
                  }
                } catch (_) {}
              }
            }
          } catch (_) {} finally {
            ownedTdb?.close();
          }
        }
      }

      final matByLoc = <String, Map<String, dynamic>>{};
      if (tipiDb != null) {
        try {
          final byBook = <String, Set<int>>{};
          for (final loc in uniqueLocations.values) {
            byBook.putIfAbsent(loc.book, () => {}).add(loc.para);
          }
          for (final entry in byBook.entries) {
            final paraList = entry.value.toList();
            final placeholders = paraList.map((_) => '?').join(',');
            final mRows = tipiDb.select(
              'SELECT chapter_index, para_index, '
              'mula_book, mula_chapter, mula_para, '
              'attha_book, attha_chapter, attha_para, '
              'tika_book, tika_chapter, tika_para '
              'FROM canon_paragraphs '
              'WHERE book_code = ? AND para_index IN ($placeholders)',
              [entry.key, ...paraList],
            );
            final bookTitleCache = <String, String>{};
            String titleForBook(String code) {
              return bookTitleCache.putIfAbsent(code, () {
                try {
                  final bRows = tipiDb!.select(
                    'SELECT title FROM books WHERE code = ? LIMIT 1',
                    [code],
                  );
                  if (bRows.isNotEmpty && bRows.first['title'] != null) {
                    return bRows.first['title'].toString();
                  }
                } catch (_) {}
                return code;
              });
            }

            for (final mr in mRows) {
              final c = (mr['chapter_index'] as num).toInt();
              final pa = (mr['para_index'] as num).toInt();
              final mat = <String, dynamic>{};
              for (final layer in const ['mula', 'attha', 'tika']) {
                final mb = mr['${layer}_book']?.toString();
                if (mb != null && mb.isNotEmpty) {
                  mat[layer] = {
                    'book': mb,
                    'book_code': mb,
                    'title': titleForBook(mb),
                    'chapter': (mr['${layer}_chapter'] as num?)?.toInt() ?? 0,
                    'para': mr['${layer}_para']?.toString(),
                  };
                }
              }
              if (mat.isNotEmpty) {
                matByLoc['${entry.key}:$c:$pa'] = mat;
              }
            }
          }
        } catch (_) {}
      }

      final matches = rows.map((r) {
        final b = r['book_code'].toString();
        final c = (r['chapter_index'] as num).toInt();
        final pa = (r['para_index'] as num).toInt();
        final lid = (r['line_id'] as num?)?.toInt() ?? 1;
        final key = '$b:$c:$pa';
        final trans = <String, String>{};
        for (final lang in loadedLangs) {
          final pKey = '$lang|$key';
          final st = sentTransByLine['$pKey:$lid'];
          if (st != null && st.isNotEmpty) {
            trans[lang] = st;
          } else {
            final pt = paraFallbackByLoc[pKey];
            if (pt != null && pt.isNotEmpty) {
              trans[lang] = pt;
            }
          }
        }
        return BoldDefinitionMatch(
          bookCode: b,
          bookTitle: r['book_title'].toString(),
          category: r['category'].toString(),
          chapterIndex: c,
          paraIndex: pa,
          lineId: lid,
          paraNum: r['para_num']?.toString(),
          word: r['word'].toString(),
          plain: r['plain'].toString(),
          ending: r['ending']?.toString(),
          sentenceHtml: r['sentence_html'].toString(),
          beforeHtml: r['before_html']?.toString(),
          afterHtml: r['after_html']?.toString(),
          translations: trans,
          mat: matByLoc[key],
        );
      }).toList(growable: false);

      return BoldDefinitionQueryResult(
        query: cleaned,
        searchPrefix: prefix,
        results: matches,
      );
    } finally {
      ownedBoldDb?.close();
      ownedTipiDb?.close();
    }
  }
}
