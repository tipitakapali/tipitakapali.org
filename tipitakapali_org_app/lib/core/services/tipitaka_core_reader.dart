import 'dart:convert';
import 'dart:io';

import 'package:sqlite3/sqlite3.dart';

/// Shared reader utilities supporting both standard/legacy `tipitaka.db`
/// schemas (`html`, `meta_json`, `pali_text`, separate `pali_sentences.db`)
/// and size-optimized unified `tipitaka.db` schemas (`html_z`, `meta_z`,
/// `chapter_text_pack` containing both paragraph text and sentence splits).
class TipitakaCoreReader {
  TipitakaCoreReader._();

  static final RegExp _guidRe = RegExp(
    r'^(.+?):c(\d+):n[^:]*:p(\d+)$',
  );

  static final Expando<Set<String>> _tableNamesCache = Expando<Set<String>>();
  static final Expando<Map<String, Set<String>>> _tableColumnsCache =
      Expando<Map<String, Set<String>>>();

  static Set<String> tableAndViewNames(Database db) {
    final cached = _tableNamesCache[db];
    if (cached != null) return cached;
    final rows = db.select(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') "
      "AND name NOT LIKE 'sqlite_%'",
    );
    final set = rows.map((r) => r['name'].toString()).toSet();
    _tableNamesCache[db] = set;
    return set;
  }

  static Set<String> tableColumns(Database db, String tableName) {
    var map = _tableColumnsCache[db];
    if (map == null) {
      map = {};
      _tableColumnsCache[db] = map;
    }
    final cached = map[tableName];
    if (cached != null) return cached;
    final safe = '"${tableName.replaceAll('"', '""')}"';
    try {
      final rows = db.select('PRAGMA table_info($safe)');
      final set = rows.map((r) => r['name'].toString()).toSet();
      map[tableName] = set;
      return set;
    } catch (_) {
      return const {};
    }
  }

  /// Decodes a UTF-8 string from either plain text column [rawText] or zlib-compressed [compressedBytes].
  static String? decodeTextOrZlib(Object? rawText, Object? compressedBytes) {
    if (compressedBytes is List<int> && compressedBytes.isNotEmpty) {
      return utf8.decode(zlib.decode(compressedBytes));
    }
    return rawText?.toString();
  }

  /// Loads book `meta_json` transparently (supports `meta_z` BLOB or `meta_json` TEXT).
  static String? readBookMetaJson(Database db, String bookCode) {
    final cols = tableColumns(db, 'books');
    final hasMetaZ = cols.contains('meta_z');
    final selectCols = hasMetaZ ? 'meta_json, meta_z' : 'meta_json';
    final rows = db.select(
      'SELECT $selectCols FROM books WHERE code = ? LIMIT 1',
      [bookCode],
    );
    if (rows.isEmpty) return null;
    final r = rows.first;
    return decodeTextOrZlib(r['meta_json'], hasMetaZ ? r['meta_z'] : null);
  }

  /// Loads single chapter HTML transparently (supports `html_z` BLOB or `html` TEXT).
  static String? readChapterHtml(
    Database db,
    String bookCode,
    int chapterIndex,
  ) {
    final cols = tableColumns(db, 'chapters');
    final hasHtmlZ = cols.contains('html_z');
    final selectCols = hasHtmlZ ? 'html, html_z' : 'html';
    final rows = db.select(
      'SELECT $selectCols FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1',
      [bookCode, chapterIndex],
    );
    if (rows.isEmpty) return null;
    final r = rows.first;
    return decodeTextOrZlib(r['html'], hasHtmlZ ? r['html_z'] : null);
  }

  /// Loads chapter HTML map for a range (or full book when [startIdx] == null).
  static Map<int, String> readChaptersHtml(
    Database db,
    String bookCode, {
    int? startIdx,
    int? endIdx,
  }) {
    final cols = tableColumns(db, 'chapters');
    final hasHtmlZ = cols.contains('html_z');
    final selectCols = hasHtmlZ
        ? 'chapter_index, html, html_z'
        : 'chapter_index, html';

    final ResultSet rows;
    if (startIdx != null && endIdx != null) {
      rows = db.select(
        'SELECT $selectCols FROM chapters '
        'WHERE book_code = ? AND chapter_index BETWEEN ? AND ? '
        'ORDER BY chapter_index',
        [bookCode, startIdx, endIdx],
      );
    } else {
      rows = db.select(
        'SELECT $selectCols FROM chapters WHERE book_code = ? ORDER BY chapter_index',
        [bookCode],
      );
    }

    final out = <int, String>{};
    for (final r in rows) {
      final html = decodeTextOrZlib(r['html'], hasHtmlZ ? r['html_z'] : null);
      if (html != null) {
        out[(r['chapter_index'] as num).toInt()] = html;
      }
    }
    return out;
  }

  /// Decodes a `chapter_text_pack.data_z` BLOB into per-paragraph text & sentences.
  static Map<
    int,
    ({String? paliText, List<({int lineId, String text})> sentences})
  >
  decodeChapterTextPack(List<int> dataZ) {
    final raw = utf8.decode(zlib.decode(dataZ));
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const {};

    final out =
        <
          int,
          ({String? paliText, List<({int lineId, String text})> sentences})
        >{};

    for (final item in decoded) {
      if (item is! List || item.length < 2) continue;
      final paraIndex = (item[0] as num).toInt();
      final rawPali = item[1]?.toString();

      final sents = <({int lineId, String text})>[];
      if (item.length >= 3 && item[2] is List) {
        for (final s in (item[2] as List)) {
          if (s is! List || s.length < 2) continue;
          final lid = (s[0] as num).toInt();
          final txt = (s[1] ?? '').toString();
          sents.add((lineId: lid, text: txt));
        }
      }

      final resolvedPali =
          rawPali ?? (sents.isNotEmpty ? sents.map((e) => e.text).join(' ') : null);
      out[paraIndex] = (paliText: resolvedPali, sentences: sents);
    }
    return out;
  }

  /// Returns `true` when full sentence splits are available from either
  /// [dedicatedPsDb] (`pali_sentences.db`) or our unified optimized `tipitaka.db`
  /// (`site_metadata.has_pali_sentences == '1'` or populated `chapter_text_pack`).
  static bool hasPaliSentencesSupport(
    Database? dedicatedPsDb,
    Database? tipiDb, {
    Set<String>? tipiTables,
  }) {
    if (dedicatedPsDb != null) return true;
    if (tipiDb == null) return false;
    final tables = tipiTables ?? tableAndViewNames(tipiDb);
    if (tables.contains('site_metadata')) {
      try {
        final meta = tipiDb.select(
          "SELECT value FROM site_metadata WHERE key = 'has_pali_sentences' LIMIT 1",
        );
        if (meta.isNotEmpty && meta.first['value']?.toString() == '1') {
          return true;
        }
      } catch (_) {}
    }
    if (tables.contains('chapter_text_pack')) {
      try {
        if (tipiDb.select('SELECT 1 FROM chapter_text_pack LIMIT 1').isNotEmpty) {
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  /// Reads all sentence rows for [bookCode] ordered by (chapter_index, para_index, line_id).
  static List<({int chapterIndex, int paraIndex, int lineId, String text})>
  readBookSentences(
    Database? dedicatedPsDb,
    Database? tipiDb,
    String bookCode,
  ) {
    if (dedicatedPsDb != null) {
      try {
        final rows = dedicatedPsDb.select(
          'SELECT chapter_index, para_index, line_id, sentence '
          'FROM pali_sentences WHERE book_code = ? '
          'ORDER BY chapter_index, para_index, line_id',
          [bookCode],
        );
        return [
          for (final r in rows)
            (
              chapterIndex: (r['chapter_index'] as num).toInt(),
              paraIndex: (r['para_index'] as num).toInt(),
              lineId: (r['line_id'] as num).toInt(),
              text: (r['sentence'] ?? '').toString(),
            ),
        ];
      } catch (_) {}
    }

    if (tipiDb == null) return const [];
    final tables = tableAndViewNames(tipiDb);

    if (tables.contains('pali_sentences')) {
      try {
        final rows = tipiDb.select(
          'SELECT chapter_index, para_index, line_id, sentence '
          'FROM pali_sentences WHERE book_code = ? '
          'ORDER BY chapter_index, para_index, line_id',
          [bookCode],
        );
        return [
          for (final r in rows)
            (
              chapterIndex: (r['chapter_index'] as num).toInt(),
              paraIndex: (r['para_index'] as num).toInt(),
              lineId: (r['line_id'] as num).toInt(),
              text: (r['sentence'] ?? '').toString(),
            ),
        ];
      } catch (_) {}
    }

    if (tables.contains('chapter_text_pack')) {
      try {
        final rows = tipiDb.select(
          'SELECT ctp.chapter_index, ctp.data_z '
          'FROM chapter_text_pack ctp '
          'JOIN books b ON b.id = ctp.book_id '
          'WHERE b.code = ? '
          'ORDER BY ctp.chapter_index',
          [bookCode],
        );
        final out =
            <({int chapterIndex, int paraIndex, int lineId, String text})>[];
        for (final r in rows) {
          final cidx = (r['chapter_index'] as num).toInt();
          final blob = r['data_z'];
          if (blob is! List<int>) continue;
          final decoded = decodeChapterTextPack(blob);
          final pKeys = decoded.keys.toList()..sort();
          for (final pidx in pKeys) {
            final entry = decoded[pidx]!;
            for (final s in entry.sentences) {
              out.add((
                chapterIndex: cidx,
                paraIndex: pidx,
                lineId: s.lineId,
                text: s.text,
              ));
            }
          }
        }
        return out;
      } catch (_) {}
    }

    return const [];
  }

  /// Reads per-paragraph sentence splits for a single chapter ([bookCode], [chapterIndex]).
  static Map<int, List<({int lineId, String text})>> readChapterSentences(
    Database? dedicatedPsDb,
    Database? tipiDb,
    String bookCode,
    int chapterIndex,
  ) {
    if (dedicatedPsDb != null) {
      try {
        final rows = dedicatedPsDb.select(
          'SELECT para_index, line_id, sentence '
          'FROM pali_sentences WHERE book_code = ? AND chapter_index = ? '
          'ORDER BY para_index, line_id',
          [bookCode, chapterIndex],
        );
        if (rows.isNotEmpty) {
          final out = <int, List<({int lineId, String text})>>{};
          for (final r in rows) {
            out
                .putIfAbsent((r['para_index'] as num).toInt(), () => [])
                .add((
                  lineId: (r['line_id'] as num).toInt(),
                  text: (r['sentence'] ?? '').toString(),
                ));
          }
          return out;
        }
      } catch (_) {}
    }

    if (tipiDb == null) return const {};
    final tables = tableAndViewNames(tipiDb);

    if (tables.contains('pali_sentences')) {
      try {
        final rows = tipiDb.select(
          'SELECT para_index, line_id, sentence '
          'FROM pali_sentences WHERE book_code = ? AND chapter_index = ? '
          'ORDER BY para_index, line_id',
          [bookCode, chapterIndex],
        );
        if (rows.isNotEmpty) {
          final out = <int, List<({int lineId, String text})>>{};
          for (final r in rows) {
            out
                .putIfAbsent((r['para_index'] as num).toInt(), () => [])
                .add((
                  lineId: (r['line_id'] as num).toInt(),
                  text: (r['sentence'] ?? '').toString(),
                ));
          }
          return out;
        }
      } catch (_) {}
    }

    if (tables.contains('chapter_text_pack')) {
      try {
        final rows = tipiDb.select(
          'SELECT ctp.data_z FROM chapter_text_pack ctp '
          'JOIN books b ON b.id = ctp.book_id '
          'WHERE b.code = ? AND ctp.chapter_index = ? LIMIT 1',
          [bookCode, chapterIndex],
        );
        if (rows.isNotEmpty && rows.first['data_z'] is List<int>) {
          final decoded = decodeChapterTextPack(
            rows.first['data_z'] as List<int>,
          );
          return {
            for (final e in decoded.entries)
              if (e.value.sentences.isNotEmpty) e.key: e.value.sentences,
          };
        }
      } catch (_) {}
    }

    return const {};
  }

  /// Reads per-paragraph Pāḷi plain text for a single chapter, falling back from
  /// `chapter_text_pack` to `canon_paragraphs.pali_text`.
  static Map<int, String> readChapterPaliTexts(
    Database tipiDb,
    String bookCode,
    int chapterIndex,
  ) {
    final tables = tableAndViewNames(tipiDb);
    if (tables.contains('chapter_text_pack')) {
      try {
        final rows = tipiDb.select(
          'SELECT ctp.data_z FROM chapter_text_pack ctp '
          'JOIN books b ON b.id = ctp.book_id '
          'WHERE b.code = ? AND ctp.chapter_index = ? LIMIT 1',
          [bookCode, chapterIndex],
        );
        if (rows.isNotEmpty && rows.first['data_z'] is List<int>) {
          final decoded = decodeChapterTextPack(
            rows.first['data_z'] as List<int>,
          );
          return {
            for (final e in decoded.entries)
              if (e.value.paliText != null && e.value.paliText!.isNotEmpty)
                e.key: e.value.paliText!,
          };
        }
      } catch (_) {}
    }

    final out = <int, String>{};
    try {
      final rows = tipiDb.select(
        'SELECT para_index, pali_text FROM canon_paragraphs '
        'WHERE book_code = ? AND chapter_index = ?',
        [bookCode, chapterIndex],
      );
      for (final r in rows) {
        final t = r['pali_text']?.toString();
        if (t != null && t.isNotEmpty) {
          out[(r['para_index'] as num).toInt()] = t;
        }
      }
    } catch (_) {}
    return out;
  }

  static ({String bookCode, int chapterIndex, int paraIndex})? tryParseGuid(
    String guid,
  ) {
    final m = _guidRe.firstMatch(guid.trim());
    if (m == null) return null;
    final c = int.tryParse(m.group(2)!);
    final pIdx = int.tryParse(m.group(3)!);
    if (c == null || pIdx == null) return null;
    return (bookCode: m.group(1)!, chapterIndex: c, paraIndex: pIdx);
  }
}
