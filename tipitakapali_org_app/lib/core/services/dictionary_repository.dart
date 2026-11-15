import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sqlite3/sqlite3.dart';

import '../utils/pali_script_converter.dart';

enum DictSource {
  dpd('dpd', 'DPD'),
  splitter('splitter', 'Sandhi Splitter'),
  pts('pts', 'PTS PED'),
  abd('abd', 'Abhidhān'),
  psd('psd', 'Pāli-Sinhala'),
  sans('sans', 'Sanskrit');

  final String id;
  final String label;

  const DictSource(this.id, this.label);
}

class DictionaryEntry {
  final String dictionaryName;
  final DictSource source;
  final String headword;
  final String bodyText;
  final String? grammar;
  final String? coreMeaning;
  final String? construction;
  final String? examplesText;
  final List<String> tags;
  final List<String> breakups;
  final String? inflectionKey;
  final bool isExactMatch;

  const DictionaryEntry({
    required this.dictionaryName,
    this.source = DictSource.dpd,
    required this.headword,
    required this.bodyText,
    this.grammar,
    this.coreMeaning,
    this.construction,
    this.examplesText,
    this.tags = const [],
    this.breakups = const [],
    this.inflectionKey,
    this.isExactMatch = true,
  });
}

class InflectionCell {
  final String htmlText;
  final List<String> forms;
  final String? tooltip;
  final bool isHeader;

  const InflectionCell({
    required this.htmlText,
    required this.forms,
    this.tooltip,
    this.isHeader = false,
  });
}

class InflectionTableData {
  final String word;
  final String heading;
  final List<List<InflectionCell>> rows;

  const InflectionTableData({
    required this.word,
    required this.heading,
    required this.rows,
  });
}

class DictionaryLookupResult {
  final String rawQuery;
  final String normalizedQuery;
  final List<String> synonyms;
  final List<DictionaryEntry> entries;

  const DictionaryLookupResult({
    required this.rawQuery,
    required this.normalizedQuery,
    required this.synonyms,
    required this.entries,
  });

  bool get isEmpty => entries.isEmpty;

  int countFor(DictSource source) =>
      entries.where((e) => e.source == source).length;
}

class DictionaryDbPaths {
  final String? dpdDbPath;
  final String? synonymsDbPath;
  final String? splitterDbPath;
  final String? inflectionDbPath;
  final String? ptspedDbPath;
  final String? abhidhanDbPath;
  final String? palisinhDbPath;
  final String? sanskritDbPath;

  const DictionaryDbPaths({
    this.dpdDbPath,
    this.synonymsDbPath,
    this.splitterDbPath,
    this.inflectionDbPath,
    this.ptspedDbPath,
    this.abhidhanDbPath,
    this.palisinhDbPath,
    this.sanskritDbPath,
  });

  bool get hasAnyInstalled => [
    dpdDbPath,
    splitterDbPath,
    ptspedDbPath,
    abhidhanDbPath,
    palisinhDbPath,
    sanskritDbPath,
  ].any((p) => p != null && File(p).existsSync());
}

final dictionaryRepositoryProvider = Provider<DictionaryRepository>(
  (ref) => DictionaryRepository(),
);

/// Offline dictionary lookup engine mirroring `tipitakapali.org/server_api/dictEngine.js`.
class DictionaryRepository {
  Database? _tryOpenReadOnly(String? dbPath) {
    if (dbPath == null || !File(dbPath).existsSync()) return null;
    return sqlite3.open(dbPath, mode: OpenMode.readOnly);
  }

  Set<String> _readPrefixTables(Database db) {
    return db
        .select(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .map((r) => r['name'].toString())
        .toSet();
  }

  String? _resolveTable(
    String word,
    Set<String> tables, {
    bool useSplitterFallback = false,
  }) {
    if (word.isEmpty) return null;
    if (word.length == 1) {
      if (tables.contains('0000000z')) return '0000000z';
      return tables.contains('misc') ? 'misc' : null;
    }
    final candidate = '${word.substring(0, 2)}z';
    if (tables.contains(candidate)) return candidate;
    if (useSplitterFallback && tables.contains('zmisc')) return 'zmisc';
    if (tables.contains('misc')) return 'misc';
    return null;
  }

  List<String> _lookupSynonyms(String? synonymsDbPath, String word) {
    final db = _tryOpenReadOnly(synonymsDbPath);
    if (db == null) return const [];
    try {
      final tables = _readPrefixTables(db);
      final table = _resolveTable(word, tables);
      if (table == null) return const [];
      final safeTable = '"${table.replaceAll('"', '""')}"';
      final rows = db.select(
        'SELECT word FROM $safeTable WHERE synonym = ? LIMIT 16',
        [word],
      );
      return rows
          .map((r) => (r['word'] ?? '').toString())
          .where((w) => w.isNotEmpty)
          .toSet()
          .toList(growable: false);
    } catch (_) {
      return const [];
    } finally {
      db.close();
    }
  }

  DictionaryLookupResult lookup(
    String rawQuery,
    DictionaryDbPaths paths, {
    String? quoteJoinedFallback,
  }) {
    var normalized = PaliScriptConverter.cleanDictionaryQuery(rawQuery);
    if (normalized.isEmpty) {
      return DictionaryLookupResult(
        rawQuery: rawQuery,
        normalizedQuery: '',
        synonyms: const [],
        entries: const [],
      );
    }

    var result = _lookupNormalized(rawQuery, normalized, paths);
    // If bare tapped word has no direct/synonym hit and a CST quote-join candidate
    // (e.g. `oghamatarin ’’’ ti` -> `oghamatarinti`) was supplied, try it.
    if (result.isEmpty &&
        quoteJoinedFallback != null &&
        quoteJoinedFallback.trim().isNotEmpty &&
        quoteJoinedFallback != normalized) {
      final joinedNorm = PaliScriptConverter.cleanDictionaryQuery(
        quoteJoinedFallback,
      );
      if (joinedNorm.isNotEmpty && joinedNorm != normalized) {
        final joinedResult = _lookupNormalized(rawQuery, joinedNorm, paths);
        if (!joinedResult.isEmpty) {
          return joinedResult;
        }
      }
    }
    return result;
  }

  DictionaryLookupResult _lookupNormalized(
    String rawQuery,
    String normalized,
    DictionaryDbPaths paths,
  ) {
    final tokens = normalized.contains(' ')
        ? <String>{
            normalized,
            ...normalized.split(RegExp(r'\s+')).where((t) => t.isNotEmpty),
          }.toList(growable: false)
        : <String>[normalized];

    final allSynonyms = <String>[];
    final allEntries = <DictionaryEntry>[];

    // If multi-word phrase matches verbatim, prefer verbatim; else iterate tokens.
    var syns = _lookupSynonyms(paths.synonymsDbPath, normalized);
    allSynonyms.addAll(syns);
    allEntries.addAll(_queryAllSourcesForWord(normalized, syns, paths));

    if (allEntries.isEmpty && tokens.length > 1) {
      final queriedWords = tokens.where((t) => t != normalized).toList();
      for (final tok in queriedWords) {
        final tokSyns = _lookupSynonyms(paths.synonymsDbPath, tok);
        for (final s in tokSyns) {
          if (!allSynonyms.contains(s)) allSynonyms.add(s);
        }
        allEntries.addAll(_queryAllSourcesForWord(tok, tokSyns, paths));
      }
    }

    return DictionaryLookupResult(
      rawQuery: rawQuery,
      normalizedQuery: normalized,
      synonyms: allSynonyms,
      entries: allEntries,
    );
  }

  List<DictionaryEntry> _queryAllSourcesForWord(
    String word,
    List<String> syns,
    DictionaryDbPaths paths,
  ) {
    final wordsToQuery = <String>{word, ...syns}.toList(growable: false);
    final out = <DictionaryEntry>[];

    out.addAll(
      _queryDb(
        dbPath: paths.dpdDbPath,
        baseWord: word,
        wordsToQuery: wordsToQuery,
        source: DictSource.dpd,
        useSplitterFallback: false,
      ),
    );

    // Query Sandhi Splitter on base word (or direct word tokens).
    out.addAll(
      _queryDb(
        dbPath: paths.splitterDbPath,
        baseWord: word,
        wordsToQuery: [word],
        source: DictSource.splitter,
        useSplitterFallback: true,
      ),
    );

    out.addAll(
      _queryDb(
        dbPath: paths.ptspedDbPath,
        baseWord: word,
        wordsToQuery: wordsToQuery,
        source: DictSource.pts,
        useSplitterFallback: false,
      ),
    );

    out.addAll(
      _queryDb(
        dbPath: paths.abhidhanDbPath,
        baseWord: word,
        wordsToQuery: wordsToQuery,
        source: DictSource.abd,
        useSplitterFallback: false,
      ),
    );

    out.addAll(
      _queryDb(
        dbPath: paths.palisinhDbPath,
        baseWord: word,
        wordsToQuery: wordsToQuery,
        source: DictSource.psd,
        useSplitterFallback: false,
      ),
    );

    out.addAll(
      _queryDb(
        dbPath: paths.sanskritDbPath,
        baseWord: word,
        wordsToQuery: [word],
        source: DictSource.sans,
        useSplitterFallback: false,
      ),
    );

    return out;
  }

  List<DictionaryEntry> _queryDb({
    required String? dbPath,
    required String baseWord,
    required List<String> wordsToQuery,
    required DictSource source,
    required bool useSplitterFallback,
  }) {
    final db = _tryOpenReadOnly(dbPath);
    if (db == null) return const [];
    try {
      final tables = _readPrefixTables(db);
      final exact = <DictionaryEntry>[];
      final related = <DictionaryEntry>[];

      for (final candidate in wordsToQuery) {
        if (candidate.startsWith('##') && tables.contains('misc')) {
          final rows = db.select(
            'SELECT word, defi FROM misc WHERE word = ? LIMIT 4',
            [candidate],
          );
          for (final r in rows) {
            exact.add(
              _buildEntry(
                source: source,
                headword: (r['word'] ?? candidate).toString(),
                rawDefi: (r['defi'] ?? '').toString(),
                isExactMatch: true,
              ),
            );
          }
          continue;
        }

        final table = _resolveTable(
          candidate,
          tables,
          useSplitterFallback: useSplitterFallback,
        );
        if (table == null) continue;
        final safeTable = '"${table.replaceAll('"', '""')}"';
        final rows = db.select(
          'SELECT word, defi FROM $safeTable WHERE word = ? LIMIT 12',
          [candidate],
        );
        for (final r in rows) {
          final hw = (r['word'] ?? candidate).toString();
          final rawDefi = (r['defi'] ?? '').toString();
          final isExact = hw.toLowerCase() == baseWord.toLowerCase();
          final entry = _buildEntry(
            source: source,
            headword: hw,
            rawDefi: rawDefi,
            isExactMatch: isExact,
          );
          if (isExact) {
            exact.add(entry);
          } else {
            related.add(entry);
          }
        }
      }
      return [...exact, ...related];
    } catch (_) {
      return const [];
    } finally {
      db.close();
    }
  }

  DictionaryEntry _buildEntry({
    required DictSource source,
    required String headword,
    required String rawDefi,
    required bool isExactMatch,
  }) {
    if (source == DictSource.splitter) {
      final breakups = rawDefi
          .split('@')
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .map((e) => e.replaceAll('+', ' + '))
          .toList(growable: false);
      return DictionaryEntry(
        dictionaryName: source.label,
        source: source,
        headword: headword,
        bodyText: breakups.join('\n'),
        breakups: breakups,
        isExactMatch: isExactMatch,
      );
    }

    if (source == DictSource.dpd) {
      return _parseDpdEntry(headword, rawDefi, isExactMatch);
    }

    final body = stripHtmlToPlainText(_stripLinks(rawDefi));
    return DictionaryEntry(
      dictionaryName: source.label,
      source: source,
      headword: headword,
      bodyText: body,
      isExactMatch: isExactMatch,
    );
  }

  DictionaryEntry _parseDpdEntry(
    String headword,
    String rawDefi,
    bool isExactMatch,
  ) {
    final tags = <String>[];
    var html = rawDefi;

    if (html.startsWith('@')) {
      final secondAt = html.indexOf('@', 1);
      if (secondAt > 0) {
        final metaStr = html.substring(1, secondAt);
        html = html.substring(secondAt + 1);
        try {
          final decoded = jsonDecode(metaStr);
          if (decoded is Map<String, dynamic>) {
            final root = decoded['family_root']?.toString();
            if (root != null && root.isNotEmpty) {
              tags.add(root.split(' ').take(2).join(' '));
            }
            final sets = decoded['family_sets'];
            if (sets is List) {
              for (final s in sets.take(2)) {
                tags.add(s.toString());
              }
            }
            final compounds = decoded['family_compounds'];
            if (compounds is List && compounds.isNotEmpty) {
              tags.add('cmpd: ${compounds.first}');
            }
          }
        } catch (_) {}
      }
    }

    // Extract display headword title if present (`<span class=p1w>bhagavant 1</span>`)
    final hwMatch = RegExp(
      r'''<span[^>]*class=["']?p[123]w["']?[^>]*>([\s\S]*?)</span>''',
      caseSensitive: false,
    ).firstMatch(html);
    final displayHeadword = hwMatch != null
        ? stripHtmlToPlainText(hwMatch.group(1) ?? headword)
        : headword;

    // Extract declension / conjugation key from inflection button if present.
    final infMatch = RegExp(
      r'''onclick=['"][^'"]*(?:openInflection|toggleInflection)\s*\(\s*['"]([^'"]+)['"]''',
      caseSensitive: false,
    ).firstMatch(html);
    final inflectionKey = infMatch?.group(1)?.trim();

    // Remove the button bar and unresolved family template placeholders before rendering prose.
    var cleanHtml = _stripLinks(html);
    cleanHtml = cleanHtml.replaceAll(
      RegExp(
        r'''<div[^>]*class=["']?button-box["']?[^>]*>[\s\S]*?</div>''',
        caseSensitive: false,
      ),
      '',
    );
    cleanHtml = cleanHtml.replaceAll(
      RegExp(
        r'''<span[^>]*class=["']?p[123]w["']?[^>]*>[\s\S]*?</span>''',
        caseSensitive: false,
      ),
      '',
    );
    cleanHtml = cleanHtml.replaceAll(
      RegExp(r'\b[a-zA-Z0-9_]+_(?:fc|fi|fr|fs|fw)\b'),
      '',
    );

    // Extract summary line inside `<div class=dpd><p>...</p>`
    String? grammar;
    String? coreMeaning;
    final dpdSummary = RegExp(
      r'''<div[^>]*class=["']?dpd["']?[^>]*>\s*<p>([\s\S]*?)</p>''',
      caseSensitive: false,
    ).firstMatch(cleanHtml);
    if (dpdSummary != null) {
      final pInner = dpdSummary.group(1) ?? '';
      final bMatch = RegExp(r'<b>([\s\S]*?)</b>', caseSensitive: false).firstMatch(pInner);
      if (bMatch != null) {
        coreMeaning = stripHtmlToPlainText(bMatch.group(1) ?? '');
        final prefix = stripHtmlToPlainText(pInner.substring(0, bMatch.start));
        if (prefix.isNotEmpty) grammar = prefix;
      }
    }

    final bodyText = stripHtmlToPlainText(cleanHtml);
    return DictionaryEntry(
      dictionaryName: DictSource.dpd.label,
      source: DictSource.dpd,
      headword: displayHeadword.isEmpty ? headword : displayHeadword,
      bodyText: bodyText,
      grammar: grammar,
      coreMeaning: coreMeaning,
      tags: tags.toSet().toList(growable: false),
      inflectionKey: inflectionKey,
      isExactMatch: isExactMatch,
    );
  }

  /// Queries `dpd_inflection_tipitakapali.db` for a lemma/key like
  /// `declension_dhamma_1` or `dhamma` and parses the HTML inflection table.
  InflectionTableData? lookupInflection(
    String? inflectionDbPath,
    String rawKey,
  ) {
    final db = _tryOpenReadOnly(inflectionDbPath);
    if (db == null || rawKey.trim().isEmpty) return null;
    try {
      final tables = _readPrefixTables(db);
      final clean = rawKey
          .replaceFirst(RegExp(r'^(declension_|conjugation_)'), '')
          .trim();

      String? wordFound;
      String? defiHtml;

      for (final candidate in <String>[
        clean,
        if (clean.contains('_')) clean.split('_').first,
      ]) {
        final table = _resolveTable(candidate, tables);
        if (table == null) continue;
        final safeTable = '"${table.replaceAll('"', '""')}"';
        final rows = db.select(
          'SELECT word, defi FROM $safeTable WHERE word = ? LIMIT 1',
          [candidate],
        );
        if (rows.isNotEmpty && rows.first['defi'] != null) {
          wordFound = rows.first['word']?.toString() ?? candidate;
          defiHtml = rows.first['defi'].toString();
          break;
        }
      }

      if (defiHtml == null) return null;
      return _parseInflectionHtml(wordFound ?? clean, defiHtml);
    } catch (_) {
      return null;
    } finally {
      db.close();
    }
  }

  InflectionTableData _parseInflectionHtml(String word, String html) {
    final headingMatch = RegExp(
      r'<p[^>]*class=[\x27"]heading[\x27"][^>]*>([\s\S]*?)</p>',
      caseSensitive: false,
    ).firstMatch(html);
    final heading = headingMatch != null
        ? stripHtmlToPlainText(headingMatch.group(1) ?? '')
        : word;

    final rows = <List<InflectionCell>>[];
    final trMatches = RegExp(
      r'<tr\b[^>]*>([\s\S]*?)</tr>',
      caseSensitive: false,
    ).allMatches(html);

    for (final tr in trMatches) {
      final cells = <InflectionCell>[];
      final cellMatches = RegExp(
        r'<(th|td)\b([^>]*)>([\s\S]*?)</\1>',
        caseSensitive: false,
      ).allMatches(tr.group(1) ?? '');
      for (final cm in cellMatches) {
        final tag = (cm.group(1) ?? 'td').toLowerCase();
        final attrs = cm.group(2) ?? '';
        final inner = cm.group(3) ?? '';
        final titleMatch = RegExp(
          r'''title=['"]([^'"]*)['"]''',
          caseSensitive: false,
        ).firstMatch(attrs);
        final parts = inner
            .split(RegExp(r'<br\s*/?>', caseSensitive: false))
            .map(stripHtmlToPlainText)
            .where((p) => p.isNotEmpty)
            .toList(growable: false);
        cells.add(
          InflectionCell(
            htmlText: parts.join('\n'),
            forms: parts,
            tooltip: titleMatch?.group(1),
            isHeader: tag == 'th',
          ),
        );
      }
      if (cells.isNotEmpty) rows.add(cells);
    }
    return InflectionTableData(word: word, heading: heading, rows: rows);
  }

  static String _stripLinks(String text) {
    return text.replaceAll(RegExp(r'L#\d+@'), '');
  }

  static String stripHtmlToPlainText(String html) {
    return html
        .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
        .replaceAll(RegExp(r'</(p|div|li|tr|h\d)>', caseSensitive: false), '\n')
        .replaceAll(RegExp(r'<t[hd]\b[^>]*>', caseSensitive: false), '  ')
        .replaceAll(RegExp(r'<[^>]+>'), '')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&hairsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll(RegExp(r'[ \t]+\n'), '\n')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trim();
  }
}
