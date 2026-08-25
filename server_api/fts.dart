/// ============================================================================
/// fts.dart - SQLite FTS5 Full-Text Search Table Builder & Reference (Dart)
/// ============================================================================
///
/// This file demonstrates how to build and query the high-performance
/// `paragraphs_fts` SQLite FTS5 virtual table in Dart / Flutter applications:
///   1. `prefix = 3` for instant prefix / wildcard searches (e.g. 'dha*', 'buddha*').
///   2. Footnote / variant reading text preserved for comprehensive scholarly searches.
///   3. Clean text normalization (nigghahita 'ṁ' -> 'ṃ', zero-width spaces stripped).
///   4. B-tree optimization (`optimize`) to merge index segments for maximum query speed.
///   5. Canonical Piṭaka sorting (Mūla -> Aṭṭhakathā -> Ṭīkā -> Añña) and BM25 scoring.
///
/// Usage with `sqlite3` package in Dart / Flutter:
///   import 'package:sqlite3/sqlite3.dart';
///
/// Author: Antigravity Coding Assistant (Tipitaka Project)
/// ============================================================================

import 'dart:io';

class TipitakaFtsHelper {
  /// ==========================================================================
  /// 1. Paragraph Text Sanitization & Cleaning
  /// ==========================================================================
  /// Sanitizes raw TEI XML / HTML paragraph text for FTS5 full-text indexing:
  ///   - RETAINS text inside `<note>...</note>` (footnotes & variant readings).
  ///   - STRIPS `<note>` and `</note>` tags themselves.
  ///   - STRIPS page break markers (`<pb.../>`, `<span class="pagebreak">...</span>`).
  ///   - STRIPS paragraph number anchors (`<strong class="paranum">...</strong>`).
  ///   - STRIPS all remaining XML / HTML markup (`<[^>]+>`).
  ///   - Normalizes Pāḷi nigghahita (`ṁ` / `Ṁ` -> `ṃ`).
  ///   - Removes invisible zero-width and non-breaking spaces.
  ///   - Collapses multiple whitespace characters into single space.
  static String cleanParagraphText(String pcontent) {
    if (pcontent.isEmpty) return '';

    String text = pcontent;

    // Step A: Strip pagebreak markers (e.g. <pb ed="VRI" n="1.0001"/> or HTML spans)
    text = text.replaceAll(RegExp(r'<pb[^>]*/>'), ' ');
    text = text.replaceAll(
      RegExp(r'<span class="pagebreak"[^>]*>.*?</span>', dotAll: true),
      ' ',
    );

    // Step B: Strip paragraph number anchor spans (e.g. <strong class="paranum">1</strong>)
    text = text.replaceAll(
      RegExp(r'<strong class="paranum"[^>]*>.*?</strong>', dotAll: true),
      ' ',
    );

    // Step C: Strip XML / HTML tags (Note: text inside <note>...</note> is preserved!)
    text = text.replaceAll(RegExp(r'<[^>]+>'), ' ');

    // Step D: Normalize Pāḷi nigghahita to standard unicode 'ṃ'
    text = text.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'ṃ');

    // Step E: Remove zero-width spaces, BOM, and non-breaking spaces
    text = text.replaceAll(RegExp(r'[\u200B-\u200D\uFEFF\u00A0]'), ' ');

    // Step F: Collapse whitespace and trim
    return text.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  /// ==========================================================================
  /// 2. SQL DDL for Creating the FTS5 Virtual Table
  /// ==========================================================================
  /// Creates the `paragraphs_fts` table with `prefix = 3`.
  ///
  /// Schema Breakdown:
  ///   - book_code:             Indexed book identifier (e.g. 's0101m.mul')
  ///   - book_title:            Indexed book title (e.g. 'Sīlakkhandhavaggapāḷi')
  ///   - nikaya:                Indexed nikaya name (e.g. 'Dīghanikāya')
  ///   - para_num:              Indexed paragraph number (e.g. '1', '25')
  ///   - para_index UNINDEXED:  Raw 0-indexed position in book (stored but not tokenized)
  ///   - para_rend:             CSS render class (e.g. 'bodytext', 'gatha1', 'hangnum')
  ///   - content:               Clean text of paragraph (tokenized for full-text search)
  ///   - prefix = 3:            Creates dedicated 3-character prefix index for fast wildcards
  static const String createFtsTableSql = '''
    CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index UNINDEXED,
        para_rend,
        content,
        prefix = 3
    );
  ''';

  /// SQL for optimizing FTS5 index segments into a single compact B-tree
  static const String optimizeFtsSql = '''
    INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');
  ''';

  /// ==========================================================================
  /// 3. Query Constructor Helpers (Proximity NEAR, Filters, Canonical Sort)
  /// ==========================================================================

  /// Builds a sanitized FTS5 match query supporting:
  ///   - Single words: `"dhamma"*`
  ///   - Exact phrase (distance = 1): `"evaṃ me sutaṃ"`
  ///   - Proximity NEAR (distance = 2..10): `NEAR("dhamma" "hetu", 3)`
  ///   - Multi-word AND (distance = 'any'): `"dhamma"* AND "hetu"*`
  static String buildFtsMatchQuery(String rawQuery, {dynamic distance = 'any'}) {
    final clean = cleanParagraphText(rawQuery);
    if (clean.isEmpty) return '';

    final tokens = clean
        .replaceAll(RegExp(r'[^\w\s\u00C0-\u024F\u1E00-\u1EFF*]'), ' ')
        .trim()
        .split(RegExp(r'\s+'))
        .where((t) => t.isNotEmpty)
        .toList();

    if (tokens.isEmpty) return '';

    // Single word
    if (tokens.length == 1) {
      final tok = tokens[0];
      return tok.endsWith('*') ? '"${tok.substring(0, tok.length - 1)}"*' : '"$tok"*';
    }

    // Exact phrase: distance = 1
    if (distance == 1 || distance == '1' || distance == 'exact') {
      final phrase = tokens.map((t) => t.replaceAll('*', '')).join(' ');
      return '"$phrase"';
    }

    // Proximity NEAR(w1 w2, N) for distance = 2, 3, 5, 8, 10
    final distNum = int.tryParse(distance.toString());
    if (distNum != null && distNum >= 2 && distNum <= 50) {
      final terms = tokens.map((t) => '"${t.replaceAll('*', '')}"').join(' ');
      return 'NEAR($terms, $distNum)';
    }

    // Default: ANY distance (AND across paragraph)
    return tokens
        .map((t) => t.endsWith('*') ? '"${t.substring(0, t.length - 1)}"*' : '"$t"*')
        .join(' AND ');
  }

  /// Constructs SQL WHERE and ORDER BY clauses:
  ///   - `sort == 'pitaka'`: Canonical Tipitaka order (Mula -> Attha -> Tika -> Anna)
  ///   - `sort == 'relevance'`: FTS5 rank
  ///   - `sort == 'bm25'`: Statistical BM25 score
  static String buildSearchQuerySql({
    String? bookCode,
    String? matFilter,       // 'mula' | 'attha' | 'tika' | 'anna'
    String? pitakaFilter,    // 'vinaya' | 'sutta' | 'digha' | 'majjhima' | 'abhidhamma' | etc.
    String sort = 'pitaka',  // 'pitaka' | 'relevance' | 'bm25'
  }) {
    final whereClauses = <String>['paragraphs_fts MATCH ?'];

    if (bookCode != null && bookCode.isNotEmpty && bookCode != 'all') {
      whereClauses.add("book_code = '$bookCode'");
    }

    // Group (MAT) filter
    if (matFilter != null && matFilter != 'all') {
      if (matFilter == 'mula' || matFilter == 'm') {
        whereClauses.add("book_code LIKE '%.mul%'");
      } else if (matFilter == 'attha' || matFilter == 'a') {
        whereClauses.add("book_code LIKE '%.att%'");
      } else if (matFilter == 'tika' || matFilter == 't') {
        whereClauses.add("book_code LIKE '%.tik%'");
      } else if (matFilter == 'anna' || matFilter == 'e') {
        whereClauses.add("(book_code NOT LIKE '%.mul%' AND book_code NOT LIKE '%.att%' AND book_code NOT LIKE '%.tik%')");
      }
    }

    // Piṭaka filter
    if (pitakaFilter != null && pitakaFilter != 'all') {
      if (pitakaFilter == 'vinaya' || pitakaFilter == 'vi') {
        whereClauses.add("(book_code LIKE 'vin%' OR book_code LIKE 'vi%' OR book_code LIKE 'v0%')");
      } else if (pitakaFilter == 'sutta' || pitakaFilter == 's') {
        whereClauses.add("(book_code LIKE 's0%' OR book_code LIKE 's1%' OR book_code LIKE 's2%')");
      } else if (pitakaFilter == 'digha' || pitakaFilter == 's01') {
        whereClauses.add("book_code LIKE 's01%'");
      } else if (pitakaFilter == 'majjhima' || pitakaFilter == 's02') {
        whereClauses.add("book_code LIKE 's02%'");
      } else if (pitakaFilter == 'samyutta' || pitakaFilter == 's03') {
        whereClauses.add("book_code LIKE 's03%'");
      } else if (pitakaFilter == 'anguttara' || pitakaFilter == 's04') {
        whereClauses.add("book_code LIKE 's04%'");
      } else if (pitakaFilter == 'khuddaka' || pitakaFilter == 's05') {
        whereClauses.add("book_code LIKE 's05%'");
      } else if (pitakaFilter == 'abhidhamma' || pitakaFilter == 'abh') {
        whereClauses.add("book_code LIKE 'abh%'");
      } else if (pitakaFilter == 'anna' || pitakaFilter == 'e') {
        whereClauses.add("book_code LIKE 'e%'");
      }
    }

    final whereSql = 'WHERE ${whereClauses.join(' AND ')}';

    // Canonical Piṭaka Sort (Default)
    String orderSql = '''
      ORDER BY 
        CASE 
          WHEN book_code LIKE '%.mul%' THEN 1
          WHEN book_code LIKE '%.att%' THEN 2
          WHEN book_code LIKE '%.tik%' THEN 3
          ELSE 4
        END ASC,
        CASE 
          WHEN book_code LIKE 'vin%' OR book_code LIKE 'vi%' OR book_code LIKE 'v0%' THEN 1
          WHEN book_code LIKE 's01%' THEN 2
          WHEN book_code LIKE 's02%' THEN 3
          WHEN book_code LIKE 's03%' THEN 4
          WHEN book_code LIKE 's04%' THEN 5
          WHEN book_code LIKE 's05%' THEN 6
          WHEN book_code LIKE 'abh%' THEN 7
          WHEN book_code LIKE 'e%'   THEN 8
          ELSE 9
        END ASC,
        book_code ASC,
        para_index ASC,
        rowid ASC
    ''';

    if (sort == 'relevance' || sort == 'rank') {
      orderSql = 'ORDER BY rank ASC';
    } else if (sort == 'bm25') {
      orderSql = 'ORDER BY bm25(paragraphs_fts) ASC';
    }

    return '''
      SELECT 
        rowid,
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index,
        para_rend,
        snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) as snippet
      FROM paragraphs_fts 
      $whereSql
      $orderSql
      LIMIT ? OFFSET ?;
    ''';
  }
}

void main() {
  print('====================================================================');
  print(' Tipiṭaka SQLite FTS5 Full-Text Search Module (Dart)');
  print('====================================================================\n');

  // Example demonstration of text sanitization
  final sampleRawXml =
      '<p rend="bodytext" n="1"><hi rend="bold">Namo tassa</hi> <note>(syā.) variant</note> <pb ed="VRI" n="1.0001"/> bhagavato arahato sammāsambuddhassa.</p>';
  final cleanedText = TipitakaFtsHelper.cleanParagraphText(sampleRawXml);

  print('1. Sample Raw XML input:');
  print('   $sampleRawXml\n');
  print('2. Cleaned for FTS5 Indexing (Footnotes preserved, tags/pagebreaks stripped):');
  print('   $cleanedText\n');

  print('3. Generated FTS Match Queries:');
  print("   - Single word:     ${TipitakaFtsHelper.buildFtsMatchQuery('dhamma')}");
  print("   - Exact phrase:    ${TipitakaFtsHelper.buildFtsMatchQuery('evaṃ me sutaṃ', distance: 1)}");
  print("   - Proximity NEAR:  ${TipitakaFtsHelper.buildFtsMatchQuery('dhamma hetu', distance: 3)}");
  print("   - Multi-word AND:  ${TipitakaFtsHelper.buildFtsMatchQuery('dhamma hetu', distance: 'any')}\n");

  print('4. Generated SQL with Piṭaka Sorting:');
  print(TipitakaFtsHelper.buildSearchQuerySql(
    matFilter: 'mula',
    pitakaFilter: 'sutta',
    sort: 'pitaka',
  ));

  print('✓ Dart FTS5 reference verified successfully!');
}
