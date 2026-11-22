import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sqlite3/sqlite3.dart';

import 'dictionary_repository.dart';
import 'tipitaka_core_reader.dart';

export 'dictionary_repository.dart';

class CanonTreeNode {
  final int id;
  final String text;
  final int? parentId;
  final String nodeType;
  final String? bookCode;
  final int? chapterIndex;
  final String? href;

  const CanonTreeNode({
    required this.id,
    required this.text,
    required this.parentId,
    required this.nodeType,
    this.bookCode,
    this.chapterIndex,
    this.href,
  });

  bool get isFolder =>
      nodeType == 'category' || bookCode == null || bookCode!.isEmpty;
}

class CanonBook {
  final int id;
  final String code;
  final String title;
  final String nikaya;
  final String category;
  final int chapterCount;

  const CanonBook({
    required this.id,
    required this.code,
    required this.title,
    required this.nikaya,
    required this.category,
    required this.chapterCount,
  });
}

class CanonChapterSummary {
  final int chapterIndex;
  final String title;
  final String chunkName;
  final int paraIndex;

  const CanonChapterSummary({
    required this.chapterIndex,
    required this.title,
    required this.chunkName,
    required this.paraIndex,
  });
}

class MatChapterTarget {
  final String bookCode;
  final int chapterIndex;
  final String? title;
  final String? para;

  const MatChapterTarget({
    required this.bookCode,
    required this.chapterIndex,
    this.title,
    this.para,
  });
}

class MatRelations {
  final MatChapterTarget? mula;
  final MatChapterTarget? attha;
  final MatChapterTarget? tika;

  const MatRelations({this.mula, this.attha, this.tika});

  bool get isEmpty => mula == null && attha == null && tika == null;
}

class BookTocEntry {
  final int itemIndex;
  final int level;
  final String type;
  final String rend;
  final String title;
  final int paraIndex;
  final String? paraNum;
  final int chapterIndex;

  const BookTocEntry({
    required this.itemIndex,
    required this.level,
    required this.type,
    required this.rend,
    required this.title,
    required this.paraIndex,
    this.paraNum,
    required this.chapterIndex,
  });
}

class PageBreakMarker {
  final String edition; // M, V, P, T, O
  final String page;

  const PageBreakMarker({required this.edition, required this.page});

  String get displayLabel => '$edition $page';
}

class AlignedSentence {
  final int lineId;
  final String paliSentence;
  final Map<String, String> translationsByLang;

  const AlignedSentence({
    required this.lineId,
    required this.paliSentence,
    this.translationsByLang = const {},
  });
}

class CanonParagraph {
  final int paraIndex;
  final String? paraNum;
  final String rend;
  final String paliText;
  final String? translationText;
  final Map<String, String> translationsByLang;
  final List<PageBreakMarker> pageBreaks;
  final List<AlignedSentence> sentences;
  final String? mulaBook;
  final int? mulaChapter;
  final String? mulaPara;
  final String? atthaBook;
  final int? atthaChapter;
  final String? atthaPara;
  final String? tikaBook;
  final int? tikaChapter;
  final String? tikaPara;

  const CanonParagraph({
    required this.paraIndex,
    this.paraNum,
    required this.rend,
    required this.paliText,
    this.translationText,
    this.translationsByLang = const {},
    this.pageBreaks = const [],
    this.sentences = const [],
    this.mulaBook,
    this.mulaChapter,
    this.mulaPara,
    this.atthaBook,
    this.atthaChapter,
    this.atthaPara,
    this.tikaBook,
    this.tikaChapter,
    this.tikaPara,
  });

  bool get isHeading =>
      rend == 'title' ||
      rend == 'chapter' ||
      rend == 'subhead' ||
      rend == 'book' ||
      rend == 'nikaya' ||
      rend == 'centre';

  bool get isGatha => rend.startsWith('gatha');
}

class ChapterContentBundle {
  final CanonBook book;
  final List<CanonChapterSummary> chapters;
  final int currentChapterIndex;
  final List<BookTocEntry> toc;
  final MatRelations mat;
  final List<CanonParagraph> paragraphs;
  final String? activeTranslationLang;
  final List<String> activeTranslationLangs;

  const ChapterContentBundle({
    required this.book,
    required this.chapters,
    required this.currentChapterIndex,
    required this.toc,
    required this.mat,
    required this.paragraphs,
    this.activeTranslationLang,
    this.activeTranslationLangs = const [],
  });
}

class BookNavigationMeta {
  final String bookCode;
  final Map<String, int> paraToChapter;
  final Map<String, Map<String, int>> pageToChapter; // edition -> page -> chapter
  final int? minPara;
  final int? maxPara;

  const BookNavigationMeta({
    required this.bookCode,
    required this.paraToChapter,
    required this.pageToChapter,
    this.minPara,
    this.maxPara,
  });

  List<String> get availableEditions {
    return pageToChapter.entries
        .where((e) => e.value.isNotEmpty)
        .map((e) => e.key)
        .toList(growable: false);
  }
}

class FtsSearchHit {
  final String bookCode;
  final String bookTitle;
  final String nikaya;
  final String? paraNum;
  final int paraIndex;
  final int chapterIndex;
  final String snippet;

  const FtsSearchHit({
    required this.bookCode,
    required this.bookTitle,
    required this.nikaya,
    this.paraNum,
    required this.paraIndex,
    required this.chapterIndex,
    required this.snippet,
  });
}

final tipitakaRepositoryProvider = Provider<TipitakaRepository>(
  (ref) => TipitakaRepository(),
);

class TipitakaRepository {
  final DictionaryRepository _dictionaryRepo = DictionaryRepository();

  Database _openReadOnly(String dbPath) {
    return sqlite3.open(dbPath, mode: OpenMode.readOnly);
  }

  List<CanonBook> getBooks(String tipitakaDbPath) {
    final db = _openReadOnly(tipitakaDbPath);
    try {
      final rows = db.select(
        'SELECT id, code, title, nikaya, category, chapter_count '
        'FROM books ORDER BY id',
      );
      return rows
          .map(
            (r) => CanonBook(
              id: (r['id'] as num?)?.toInt() ?? 0,
              code: (r['code'] ?? '').toString(),
              title: (r['title'] ?? '').toString(),
              nikaya: (r['nikaya'] ?? '').toString(),
              category: (r['category'] ?? '').toString(),
              chapterCount: (r['chapter_count'] as num?)?.toInt() ?? 0,
            ),
          )
          .toList(growable: false);
    } finally {
      db.close();
    }
  }

  ({int books, int chapters, int paragraphs}) getStats(String tipitakaDbPath) {
    final db = _openReadOnly(tipitakaDbPath);
    try {
      final b = (db.select('SELECT COUNT(*) AS c FROM books').first['c'] as num)
          .toInt();
      final c =
          (db.select('SELECT COUNT(*) AS c FROM chapters').first['c'] as num)
              .toInt();
      final p = (db
              .select('SELECT COUNT(*) AS c FROM canon_paragraphs')
              .first['c'] as num)
          .toInt();
      return (books: b, chapters: c, paragraphs: p);
    } finally {
      db.close();
    }
  }

  List<CanonTreeNode> getTreeChildren(
    String tipitakaDbPath, {
    int? parentId,
  }) {
    final db = _openReadOnly(tipitakaDbPath);
    try {
      final rows = parentId == null
          ? db.select(
              'SELECT id, text, parent_id, node_type, book_code, chapter_index, href '
              'FROM tree_nodes WHERE parent_id IS NULL ORDER BY id',
            )
          : db.select(
              'SELECT id, text, parent_id, node_type, book_code, chapter_index, href '
              'FROM tree_nodes WHERE parent_id = ? ORDER BY id',
              [parentId],
            );

      final nodes = rows
          .map(
            (r) => CanonTreeNode(
              id: (r['id'] as num).toInt(),
              text: (r['text'] ?? '').toString(),
              parentId: (r['parent_id'] as num?)?.toInt(),
              nodeType: (r['node_type'] ?? 'category').toString(),
              bookCode: r['book_code']?.toString(),
              chapterIndex: (r['chapter_index'] as num?)?.toInt(),
              href: r['href']?.toString(),
            ),
          )
          .toList(growable: false);

      // Unwrap single "Tipitaka" root container just like server.js cleanTree().
      if (parentId == null &&
          nodes.length == 1 &&
          nodes.first.isFolder &&
          nodes.first.text.toLowerCase().contains('tipi')) {
        return getTreeChildren(tipitakaDbPath, parentId: nodes.first.id);
      }
      return nodes;
    } finally {
      db.close();
    }
  }

  /// Resolves codes like `vin01m.mul` or legacy chapter-suffixed codes like
  /// `s0101m.mul0`, mirroring server.js.
  ({String bookCode, int chapterIndex}) normalizeBookAndChapter(
    String rawBookCode,
    int chapterIndex,
  ) {
    var clean = rawBookCode.replaceAll('.xml', '').trim();
    var chap = chapterIndex;
    final match = RegExp(
      r'^(.*?\.(?:mul|att|tik|nrf))(\d+)$',
      caseSensitive: false,
    ).firstMatch(clean);
    if (match != null) {
      clean = match.group(1)!;
      chap = int.tryParse(match.group(2)!) ?? chap;
    }
    return (bookCode: clean, chapterIndex: chap);
  }

  ChapterContentBundle loadChapter(
    String tipitakaDbPath, {
    required String rawBookCode,
    int chapterIndex = 0,
    String? translationDbPath,
    String? translationLangCode,
    Map<String, String> translationDbPaths = const {},
    String? paliSentencesDbPath,
    bool showFootnotes = true,
  }) {
    final normalized = normalizeBookAndChapter(rawBookCode, chapterIndex);
    final bookCode = normalized.bookCode;

    final effectiveTransPaths = <String, String>{...translationDbPaths};
    if (translationDbPath != null && translationLangCode != null) {
      effectiveTransPaths.putIfAbsent(
        translationLangCode,
        () => translationDbPath,
      );
    }

    final db = _openReadOnly(tipitakaDbPath);
    try {
      final bookRows = db.select(
        'SELECT id, code, title, nikaya, category, chapter_count '
        'FROM books WHERE code = ? LIMIT 1',
        [bookCode],
      );
      if (bookRows.isEmpty) {
        throw StateError('Book "$bookCode" not found in tipitaka.db');
      }
      final b = bookRows.first;
      final book = CanonBook(
        id: (b['id'] as num?)?.toInt() ?? 0,
        code: b['code'].toString(),
        title: b['title'].toString(),
        nikaya: (b['nikaya'] ?? '').toString(),
        category: (b['category'] ?? '').toString(),
        chapterCount: (b['chapter_count'] as num?)?.toInt() ?? 0,
      );

      final chapRows = db.select(
        'SELECT chapter_index, title, chunk_name, para_index '
        'FROM chapters WHERE book_code = ? ORDER BY chapter_index ASC',
        [bookCode],
      );
      final chapters = chapRows
          .map(
            (r) => CanonChapterSummary(
              chapterIndex: (r['chapter_index'] as num).toInt(),
              title: (r['title'] ?? '').toString(),
              chunkName: (r['chunk_name'] ?? '').toString(),
              paraIndex: (r['para_index'] as num?)?.toInt() ?? 0,
            ),
          )
          .toList(growable: false);

      var targetChap = normalized.chapterIndex;
      if (chapters.isNotEmpty &&
          !chapters.any((c) => c.chapterIndex == targetChap)) {
        targetChap = chapters.first.chapterIndex;
      }

      final tocRows = db.select(
        'SELECT item_index, level, type, rend, title, para_index, para_num, chapter_index '
        'FROM book_toc WHERE book_code = ? ORDER BY item_index ASC',
        [bookCode],
      );
      final toc = tocRows
          .map(
            (r) => BookTocEntry(
              itemIndex: (r['item_index'] as num?)?.toInt() ?? 0,
              level: (r['level'] as num?)?.toInt() ?? 0,
              type: (r['type'] ?? '').toString(),
              rend: (r['rend'] ?? '').toString(),
              title: (r['title'] ?? '').toString(),
              paraIndex: (r['para_index'] as num?)?.toInt() ?? 0,
              paraNum: r['para_num']?.toString(),
              chapterIndex: (r['chapter_index'] as num?)?.toInt() ?? 0,
            ),
          )
          .toList(growable: false);

      final mat = _resolveChapterMat(db, bookCode, targetChap);

      // Extract page breaks (M/V/P/T) & footnote-filtered text from chapters.html
      final htmlMetaByPara = _extractHtmlMetaByPara(db, bookCode, targetChap);

      // Load paragraph & sentence translations for every requested language
      final translationsByLang = <String, Map<int, String>>{};
      final sentTransByLang = <String, Map<int, Map<int, String>>>{};
      final loadedLangs = <String>[];

      for (final entry in effectiveTransPaths.entries) {
        final lang = entry.key;
        final path = entry.value;
        final paraMap = _loadTranslationsForChapter(
          translationDbPath: path,
          bookCode: bookCode,
          chapterIndex: targetChap,
        );
        final sentMap = _loadSentenceTranslationsForChapter(
          translationDbPath: path,
          bookCode: bookCode,
          chapterIndex: targetChap,
        );
        if (paraMap.isNotEmpty || sentMap.isNotEmpty) {
          loadedLangs.add(lang);
        }
        if (paraMap.isNotEmpty) translationsByLang[lang] = paraMap;
        if (sentMap.isNotEmpty) sentTransByLang[lang] = sentMap;
      }

      // Load Pali sentences when pali_sentences.db is available
      final paliSentencesByPara = _loadPaliSentencesForChapter(
        paliSentencesDbPath: paliSentencesDbPath,
        bookCode: bookCode,
        chapterIndex: targetChap,
      );

      final paraRows = db.select(
        'SELECT para_index, para_num, rend, pali_text, '
        'mula_book, mula_chapter, mula_para, '
        'attha_book, attha_chapter, attha_para, '
        'tika_book, tika_chapter, tika_para '
        'FROM canon_paragraphs '
        'WHERE book_code = ? AND chapter_index = ? '
        'ORDER BY para_index ASC',
        [bookCode, targetChap],
      );

      List<CanonParagraph> paragraphs;
      if (paraRows.isNotEmpty) {
        paragraphs = paraRows.map((r) {
          final pIdx = (r['para_index'] as num).toInt();
          final pMap = <String, String>{};
          for (final lang in effectiveTransPaths.keys) {
            final t = translationsByLang[lang]?[pIdx];
            if (t != null && t.isNotEmpty) pMap[lang] = t;
          }
          final firstLangText = translationLangCode != null
              ? pMap[translationLangCode]
              : (pMap.isNotEmpty ? pMap.values.first : null);

          final htmlMeta = htmlMetaByPara[pIdx];
          var paliText = (r['pali_text'] ?? '').toString();
          if (!showFootnotes && htmlMeta?.textWithoutFootnotes != null) {
            paliText = htmlMeta!.textWithoutFootnotes!;
          }

          final rawSents = paliSentencesByPara[pIdx] ?? const [];
          final alignedSents = rawSents
              .map(
                (s) => AlignedSentence(
                  lineId: s.lineId,
                  paliSentence: s.sentence,
                  translationsByLang: {
                    for (final lang in effectiveTransPaths.keys)
                      if (sentTransByLang[lang]?[pIdx]?[s.lineId] != null)
                        lang: sentTransByLang[lang]![pIdx]![s.lineId]!,
                  },
                ),
              )
              .toList(growable: false);

          return CanonParagraph(
            paraIndex: pIdx,
            paraNum: r['para_num']?.toString(),
            rend: (r['rend'] ?? 'bodytext').toString(),
            paliText: paliText,
            translationText: firstLangText,
            translationsByLang: pMap,
            pageBreaks: htmlMeta?.pageBreaks ?? const [],
            sentences: alignedSents,
            mulaBook: r['mula_book']?.toString(),
            mulaChapter: (r['mula_chapter'] as num?)?.toInt(),
            mulaPara: r['mula_para']?.toString(),
            atthaBook: r['attha_book']?.toString(),
            atthaChapter: (r['attha_chapter'] as num?)?.toInt(),
            atthaPara: r['attha_para']?.toString(),
            tikaBook: r['tika_book']?.toString(),
            tikaChapter: (r['tika_chapter'] as num?)?.toInt(),
            tikaPara: r['tika_para']?.toString(),
          );
        }).toList(growable: false);
      } else {
        paragraphs = _extractParagraphsFromChapterHtml(
          db,
          bookCode,
          targetChap,
          translationsByLang,
          translationLangCode,
          showFootnotes: showFootnotes,
        );
      }

      return ChapterContentBundle(
        book: book,
        chapters: chapters,
        currentChapterIndex: targetChap,
        toc: toc,
        mat: mat,
        paragraphs: paragraphs,
        activeTranslationLang: loadedLangs.isNotEmpty
            ? (translationLangCode != null &&
                      loadedLangs.contains(translationLangCode)
                  ? translationLangCode
                  : loadedLangs.first)
            : null,
        activeTranslationLangs: loadedLangs,
      );
    } finally {
      db.close();
    }
  }

  /// Resolves book-level paragraph & edition-page index maps for `GoToModal`.
  BookNavigationMeta getBookNavigationMeta(
    String tipitakaDbPath,
    String bookCode,
  ) {
    final db = _openReadOnly(tipitakaDbPath);
    try {
      final rows = db.select(
        'SELECT meta_json FROM books WHERE code = ? LIMIT 1',
        [bookCode],
      );
      final paraToChap = <String, int>{};
      final pageToChap = <String, Map<String, int>>{};
      int? minPara;
      int? maxPara;

      if (rows.isNotEmpty && rows.first['meta_json'] != null) {
        try {
          final decoded = jsonDecode(rows.first['meta_json'].toString());
          if (decoded is Map<String, dynamic>) {
            final pMap = decoded['para_to_chapter'];
            if (pMap is Map) {
              for (final e in pMap.entries) {
                final v = (e.value as num?)?.toInt();
                if (v != null) {
                  paraToChap[e.key.toString()] = v;
                  final n = int.tryParse(e.key.toString());
                  if (n != null) {
                    if (minPara == null || n < minPara) minPara = n;
                    if (maxPara == null || n > maxPara) maxPara = n;
                  }
                }
              }
            }
            final pgMap = decoded['page_to_chapter'];
            if (pgMap is Map) {
              for (final sys in pgMap.entries) {
                if (sys.value is Map) {
                  final inner = <String, int>{};
                  for (final pe in (sys.value as Map).entries) {
                    final cv = (pe.value as num?)?.toInt();
                    if (cv != null) inner[pe.key.toString()] = cv;
                  }
                  if (inner.isNotEmpty) {
                    pageToChap[sys.key.toString()] = inner;
                  }
                }
              }
            }
          }
        } catch (_) {}
      }

      if (paraToChap.isEmpty) {
        final pRows = db.select(
          'SELECT para_num, chapter_index FROM canon_paragraphs '
          'WHERE book_code = ? AND para_num IS NOT NULL AND para_num != ""',
          [bookCode],
        );
        for (final r in pRows) {
          final pNum = r['para_num']?.toString().trim() ?? '';
          final chap = (r['chapter_index'] as num?)?.toInt();
          if (pNum.isNotEmpty && chap != null) {
            paraToChap.putIfAbsent(pNum, () => chap);
            final n = int.tryParse(pNum);
            if (n != null) {
              if (minPara == null || n < minPara) minPara = n;
              if (maxPara == null || n > maxPara) maxPara = n;
            }
          }
        }
      }

      return BookNavigationMeta(
        bookCode: bookCode,
        paraToChapter: paraToChap,
        pageToChapter: pageToChap,
        minPara: minPara,
        maxPara: maxPara,
      );
    } finally {
      db.close();
    }
  }

  /// Resolves exact paragraph-level target chapter + paraIndex when jumping to a para number.
  ({int chapterIndex, int? paraIndex})? findParagraphTarget(
    String tipitakaDbPath, {
    required String bookCode,
    required String paraNumQuery,
  }) {
    final clean = paraNumQuery.replaceFirst(RegExp(r'^(?:para-?|p)', caseSensitive: false), '').trim();
    if (clean.isEmpty) return null;
    final db = _openReadOnly(tipitakaDbPath);
    try {
      final rows = db.select(
        'SELECT chapter_index, para_index FROM canon_paragraphs '
        'WHERE book_code = ? AND para_num = ? ORDER BY para_index ASC LIMIT 1',
        [bookCode, clean],
      );
      if (rows.isNotEmpty) {
        return (
          chapterIndex: (rows.first['chapter_index'] as num).toInt(),
          paraIndex: (rows.first['para_index'] as num).toInt(),
        );
      }

      final cleanInt = int.tryParse(clean);
      if (cleanInt != null) {
        final rangeRows = db.select(
          'SELECT chapter_index, para_index FROM canon_paragraphs '
          'WHERE book_code = ? AND para_first <= ? AND para_last >= ? '
          'ORDER BY para_index ASC LIMIT 1',
          [bookCode, cleanInt, cleanInt],
        );
        if (rangeRows.isNotEmpty) {
          return (
            chapterIndex: (rangeRows.first['chapter_index'] as num).toInt(),
            paraIndex: (rangeRows.first['para_index'] as num).toInt(),
          );
        }
      }

      final meta = getBookNavigationMeta(tipitakaDbPath, bookCode);
      final chap = meta.paraToChapter[clean];
      if (chap != null) return (chapterIndex: chap, paraIndex: null);
      return null;
    } finally {
      db.close();
    }
  }

  /// Resolves edition page number (e.g. `1.0005` or `5`) -> chapterIndex.
  int? findEditionPageChapter(
    BookNavigationMeta meta,
    String edition,
    String pageInput,
  ) {
    final map = meta.pageToChapter[edition];
    if (map == null || map.isEmpty) return null;
    final clean = pageInput.trim();
    if (map.containsKey(clean)) return map[clean];
    final asInt = int.tryParse(clean);
    if (asInt != null) {
      final padded = asInt.toString().padLeft(4, '0');
      for (final entry in map.entries) {
        if (entry.key == asInt.toString() ||
            entry.key.endsWith('.$padded') ||
            entry.key.endsWith('.$asInt')) {
          return entry.value;
        }
      }
    }
    return null;
  }

  /// Resolves Mūla / Aṭṭhakathā / Ṭīkā parallel links for a specific paragraph.
  MatRelations resolveMatForParagraph(
    String tipitakaDbPath, {
    required String bookCode,
    required int chapterIndex,
    String? paraNum,
    int? paraIndex,
  }) {
    final db = _openReadOnly(tipitakaDbPath);
    try {
      if (paraNum != null && paraNum.trim().isNotEmpty) {
        try {
          final rows = db.select(
            'SELECT mula_book, mula_chapter, mula_para, mula_title, '
            'attha_book, attha_chapter, attha_para, attha_title, '
            'tika_book, tika_chapter, tika_para, tika_title '
            'FROM mat_para_map WHERE source_book = ? AND source_chapter = ? AND source_para = ? LIMIT 1',
            [bookCode, chapterIndex, paraNum.trim()],
          );
          if (rows.isNotEmpty) {
            final r = rows.first;
            return MatRelations(
              mula: _makeTarget(r['mula_book'], r['mula_chapter'], r['mula_title'], r['mula_para']),
              attha: _makeTarget(r['attha_book'], r['attha_chapter'], r['attha_title'], r['attha_para']),
              tika: _makeTarget(r['tika_book'], r['tika_chapter'], r['tika_title'], r['tika_para']),
            );
          }
        } catch (_) {}

        final cpRows = db.select(
          'SELECT mula_book, mula_chapter, mula_para, '
          'attha_book, attha_chapter, attha_para, '
          'tika_book, tika_chapter, tika_para '
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_num = ? LIMIT 1',
          [bookCode, chapterIndex, paraNum.trim()],
        );
        if (cpRows.isNotEmpty) {
          final r = cpRows.first;
          final rel = MatRelations(
            mula: _makeTarget(r['mula_book'], r['mula_chapter'], null, r['mula_para']),
            attha: _makeTarget(r['attha_book'], r['attha_chapter'], null, r['attha_para']),
            tika: _makeTarget(r['tika_book'], r['tika_chapter'], null, r['tika_para']),
          );
          if (!rel.isEmpty) return rel;
        }
      }

      if (paraIndex != null) {
        final cpRows = db.select(
          'SELECT mula_book, mula_chapter, mula_para, '
          'attha_book, attha_chapter, attha_para, '
          'tika_book, tika_chapter, tika_para '
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
          [bookCode, chapterIndex, paraIndex],
        );
        if (cpRows.isNotEmpty) {
          final r = cpRows.first;
          final rel = MatRelations(
            mula: _makeTarget(r['mula_book'], r['mula_chapter'], null, r['mula_para']),
            attha: _makeTarget(r['attha_book'], r['attha_chapter'], null, r['attha_para']),
            tika: _makeTarget(r['tika_book'], r['tika_chapter'], null, r['tika_para']),
          );
          if (!rel.isEmpty) return rel;
        }
      }

      return _resolveChapterMat(db, bookCode, chapterIndex);
    } finally {
      db.close();
    }
  }

  MatRelations _resolveChapterMat(Database db, String bookCode, int chapIdx) {
    final chapMat = db.select(
      'SELECT mula_book, mula_chapter, mula_title, '
      'attha_book, attha_chapter, attha_title, '
      'tika_book, tika_chapter, tika_title '
      'FROM mat_chapter_map WHERE source_book = ? AND source_chapter = ? LIMIT 1',
      [bookCode, chapIdx],
    );
    if (chapMat.isNotEmpty) {
      final r = chapMat.first;
      return MatRelations(
        mula: _makeTarget(r['mula_book'], r['mula_chapter'], r['mula_title']),
        attha: _makeTarget(r['attha_book'], r['attha_chapter'], r['attha_title']),
        tika: _makeTarget(r['tika_book'], r['tika_chapter'], r['tika_title']),
      );
    }

    final bookMat = db.select(
      'SELECT mula_code, mula_title, attha_code, attha_title, tika_code, tika_title '
      'FROM book_mat WHERE book_code = ? LIMIT 1',
      [bookCode],
    );
    if (bookMat.isNotEmpty) {
      final r = bookMat.first;
      return MatRelations(
        mula: r['mula_code'] != null
            ? MatChapterTarget(
                bookCode: r['mula_code'].toString(),
                chapterIndex: 0,
                title: r['mula_title']?.toString(),
              )
            : null,
        attha: r['attha_code'] != null
            ? MatChapterTarget(
                bookCode: r['attha_code'].toString(),
                chapterIndex: 0,
                title: r['attha_title']?.toString(),
              )
            : null,
        tika: r['tika_code'] != null
            ? MatChapterTarget(
                bookCode: r['tika_code'].toString(),
                chapterIndex: 0,
                title: r['tika_title']?.toString(),
              )
            : null,
      );
    }
    return const MatRelations();
  }

  MatChapterTarget? _makeTarget(
    Object? bookObj,
    Object? chapObj,
    Object? titleObj, [
    Object? paraObj,
  ]) {
    final code = bookObj?.toString().trim();
    if (code == null || code.isEmpty) return null;
    return MatChapterTarget(
      bookCode: code,
      chapterIndex: (chapObj as num?)?.toInt() ?? 0,
      title: titleObj?.toString(),
      para: paraObj?.toString(),
    );
  }

  Map<int, String> _loadTranslationsForChapter({
    String? translationDbPath,
    required String bookCode,
    required int chapterIndex,
  }) {
    if (translationDbPath == null || !File(translationDbPath).existsSync()) {
      return const {};
    }
    final db = _openReadOnly(translationDbPath);
    try {
      final v2Pack = TipitakaCoreReader.readChapterTranslationPack(
        db,
        bookCode,
        chapterIndex,
      );
      if (v2Pack != null) {
        return {
          for (final item in v2Pack)
            if (item.translation != null)
              item.paraIndex: stripSimpleHtml(item.translation!),
        };
      }
      final rows = db.select(
        'SELECT para_index, translation FROM paragraph_translations '
        'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index ASC',
        [bookCode, chapterIndex],
      );
      return {
        for (final r in rows)
          if (r['para_index'] != null && r['translation'] != null)
            (r['para_index'] as num).toInt():
                stripSimpleHtml(r['translation'].toString()),
      };
    } catch (_) {
      return const {};
    } finally {
      db.close();
    }
  }

  Map<int, Map<int, String>> _loadSentenceTranslationsForChapter({
    String? translationDbPath,
    required String bookCode,
    required int chapterIndex,
  }) {
    if (translationDbPath == null || !File(translationDbPath).existsSync()) {
      return const {};
    }
    final db = _openReadOnly(translationDbPath);
    try {
      final v2Pack = TipitakaCoreReader.readChapterTranslationPack(
        db,
        bookCode,
        chapterIndex,
      );
      if (v2Pack != null) {
        final out = <int, Map<int, String>>{};
        for (final item in v2Pack) {
          for (final s in item.sentences) {
            if (s.text.trim().isNotEmpty) {
              out.putIfAbsent(item.paraIndex, () => <int, String>{})[s.lineId] =
                  stripSimpleHtml(s.text);
            }
          }
        }
        return out;
      }
      final rows = db.select(
        'SELECT para_index, line_id, translation FROM sentence_translations '
        'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index ASC, line_id ASC',
        [bookCode, chapterIndex],
      );
      final out = <int, Map<int, String>>{};
      for (final r in rows) {
        final pIdx = (r['para_index'] as num?)?.toInt();
        final lId = (r['line_id'] as num?)?.toInt();
        final text = r['translation']?.toString();
        if (pIdx != null && lId != null && text != null && text.trim().isNotEmpty) {
          out.putIfAbsent(pIdx, () => <int, String>{})[lId] = stripSimpleHtml(text);
        }
      }
      return out;
    } catch (_) {
      return const {};
    } finally {
      db.close();
    }
  }

  Map<int, List<({int lineId, String sentence})>> _loadPaliSentencesForChapter({
    String? paliSentencesDbPath,
    required String bookCode,
    required int chapterIndex,
  }) {
    if (paliSentencesDbPath == null || !File(paliSentencesDbPath).existsSync()) {
      return const {};
    }
    final db = _openReadOnly(paliSentencesDbPath);
    try {
      final rows = db.select(
        'SELECT para_index, line_id, sentence FROM pali_sentences '
        'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index ASC, line_id ASC',
        [bookCode, chapterIndex],
      );
      final out = <int, List<({int lineId, String sentence})>>{};
      for (final r in rows) {
        final pIdx = (r['para_index'] as num?)?.toInt();
        final lId = (r['line_id'] as num?)?.toInt();
        final sent = r['sentence']?.toString();
        if (pIdx != null && lId != null && sent != null && sent.trim().isNotEmpty) {
          out
              .putIfAbsent(pIdx, () => <({int lineId, String sentence})>[])
              .add((lineId: lId, sentence: sent.trim()));
        }
      }
      return out;
    } catch (_) {
      return const {};
    } finally {
      db.close();
    }
  }

  Map<int, ({List<PageBreakMarker> pageBreaks, String? textWithoutFootnotes})>
      _extractHtmlMetaByPara(Database db, String bookCode, int chapterIndex) {
    final rows = db.select(
      'SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1',
      [bookCode, chapterIndex],
    );
    if (rows.isEmpty || rows.first['html'] == null) return const {};
    final html = rows.first['html'].toString();
    final matches = RegExp(
      r'<p\b([^>]*)>([\s\S]*?)<\/p>',
      caseSensitive: false,
    ).allMatches(html);

    final out = <int, ({List<PageBreakMarker> pageBreaks, String? textWithoutFootnotes})>{};
    for (final m in matches) {
      final attrs = m.group(1) ?? '';
      final innerHtml = m.group(2) ?? '';
      final pidxMatch = RegExp(r'data-pindex="(\d+)"').firstMatch(attrs);
      if (pidxMatch == null) continue;
      final pIdx = int.parse(pidxMatch.group(1)!);

      final pbs = <PageBreakMarker>[];
      for (final pbMatch in RegExp(
        r'<span\b[^>]*class="[^"]*\bpb\b[^"]*"[^>]*>',
        caseSensitive: false,
      ).allMatches(innerHtml)) {
        final tag = pbMatch.group(0) ?? '';
        final ed = RegExp(r'data-ed="([^"]+)"').firstMatch(tag)?.group(1);
        final pg = RegExp(r'data-page="([^"]+)"').firstMatch(tag)?.group(1);
        if (ed != null && pg != null) {
          pbs.add(PageBreakMarker(edition: ed, page: pg));
        }
      }

      var noNoteHtml = innerHtml.replaceAll(
        RegExp(
          r'<span\b[^>]*class="[^"]*\bnote\b[^"]*"[^>]*>[\s\S]*?<\/span>',
          caseSensitive: false,
        ),
        '',
      );
      noNoteHtml = noNoteHtml.replaceAll(
        RegExp(
          r'<span\b[^>]*class="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>',
          caseSensitive: false,
        ),
        '',
      );
      final cleanNoNotes = stripSimpleHtml(noNoteHtml)
          .replaceAll(RegExp(r' {2,}'), ' ')
          .trim();

      out[pIdx] = (
        pageBreaks: pbs,
        textWithoutFootnotes: cleanNoNotes.isNotEmpty ? cleanNoNotes : null,
      );
    }
    return out;
  }

  List<CanonParagraph> _extractParagraphsFromChapterHtml(
    Database db,
    String bookCode,
    int chapterIndex,
    Map<String, Map<int, String>> translationsByLang,
    String? primaryLang, {
    bool showFootnotes = true,
  }) {
    final rows = db.select(
      'SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1',
      [bookCode, chapterIndex],
    );
    if (rows.isEmpty || rows.first['html'] == null) return const [];
    final html = rows.first['html'].toString();
    final matches = RegExp(
      r'<p\b([^>]*)>([\s\S]*?)<\/p>',
      caseSensitive: false,
    ).allMatches(html);

    final out = <CanonParagraph>[];
    var fallbackIdx = 0;
    for (final m in matches) {
      final attrs = m.group(1) ?? '';
      var innerHtml = m.group(2) ?? '';
      if (!showFootnotes) {
        innerHtml = innerHtml.replaceAll(
          RegExp(
            r'<span\b[^>]*class="[^"]*\bnote\b[^"]*"[^>]*>[\s\S]*?<\/span>',
            caseSensitive: false,
          ),
          '',
        );
      }
      final inner = stripSimpleHtml(innerHtml);
      if (inner.trim().isEmpty) continue;
      final pidxMatch = RegExp(r'data-pindex="(\d+)"').firstMatch(attrs);
      final paraMatch = RegExp(r'data-para="([^"]+)"').firstMatch(attrs);
      final clsMatch = RegExp(r'class="([^"]*)"').firstMatch(attrs);
      final pIdx = pidxMatch != null
          ? int.parse(pidxMatch.group(1)!)
          : fallbackIdx++;
      final pMap = <String, String>{
        for (final entry in translationsByLang.entries)
          if (entry.value[pIdx] != null) entry.key: entry.value[pIdx]!,
      };
      out.add(
        CanonParagraph(
          paraIndex: pIdx,
          paraNum: paraMatch?.group(1),
          rend: (clsMatch?.group(1) ?? 'bodytext').trim(),
          paliText: inner,
          translationText:
              primaryLang != null ? pMap[primaryLang] : pMap.values.firstOrNull,
          translationsByLang: pMap,
        ),
      );
    }
    return out;
  }

  List<FtsSearchHit> searchFts({
    required String ftsDbPath,
    String? tipitakaDbPath,
    required String query,
    String? nikayaFilter,
    int limit = 60,
  }) {
    final cleaned = query.trim();
    if (cleaned.isEmpty || !File(ftsDbPath).existsSync()) return const [];

    final hasOperators = RegExp(r'\b(AND|OR|NOT|NEAR)\b|["*:]').hasMatch(cleaned);
    final matchExpr = hasOperators
        ? cleaned
        : cleaned
              .split(RegExp(r'\s+'))
              .where((w) => w.isNotEmpty)
              .map((w) => '"${w.replaceAll('"', '""')}"*')
              .join(' ');

    final db = _openReadOnly(ftsDbPath);
    Database? canonDb;
    try {
      final hasNikaya = nikayaFilter != null && nikayaFilter.trim().isNotEmpty;
      final sql = hasNikaya
          ? 'SELECT book_code, book_title, nikaya, para_num, para_index, '
                "snippet(paragraphs_fts, 6, '[', ']', '…', 20) AS snippet "
                'FROM paragraphs_fts WHERE paragraphs_fts MATCH ? AND nikaya = ? '
                'LIMIT ?'
          : 'SELECT book_code, book_title, nikaya, para_num, para_index, '
                "snippet(paragraphs_fts, 6, '[', ']', '…', 20) AS snippet "
                'FROM paragraphs_fts WHERE paragraphs_fts MATCH ? '
                'LIMIT ?';

      final rows = hasNikaya
          ? db.select(sql, [matchExpr, nikayaFilter.trim(), limit])
          : db.select(sql, [matchExpr, limit]);

      if (tipitakaDbPath != null && File(tipitakaDbPath).existsSync()) {
        canonDb = _openReadOnly(tipitakaDbPath);
      }

      return rows.map((r) {
        final code = (r['book_code'] ?? '').toString();
        final pIdx = (r['para_index'] as num?)?.toInt() ?? 0;
        var resolvedChapter = 0;
        if (canonDb != null) {
          final ch = canonDb.select(
            'SELECT chapter_index FROM chapters '
            'WHERE book_code = ? AND para_index <= ? '
            'ORDER BY para_index DESC LIMIT 1',
            [code, pIdx],
          );
          if (ch.isNotEmpty) {
            resolvedChapter = (ch.first['chapter_index'] as num?)?.toInt() ?? 0;
          }
        }
        return FtsSearchHit(
          bookCode: code,
          bookTitle: (r['book_title'] ?? code).toString(),
          nikaya: (r['nikaya'] ?? '').toString(),
          paraNum: r['para_num']?.toString(),
          paraIndex: pIdx,
          chapterIndex: resolvedChapter,
          snippet: stripSimpleHtml((r['snippet'] ?? '').toString()),
        );
      }).toList(growable: false);
    } finally {
      canonDb?.close();
      db.close();
    }
  }

  /// Preserved flat lookup API; delegates to [DictionaryRepository].
  List<DictionaryEntry> lookupWord({
    required String rawWord,
    String? unifiedDictDbPath,
    String? dpdDbPath,
    String? synonymsDbPath,
    String? splitterDbPath,
    String? inflectionDbPath,
    String? ptspedDbPath,
    String? abhidhanDbPath,
    String? palisinhDbPath,
    String? sanskritDbPath,
  }) {
    return _dictionaryRepo
        .lookup(
          rawWord,
          DictionaryDbPaths(
            unifiedDictDbPath: unifiedDictDbPath,
            dpdDbPath: dpdDbPath,
            synonymsDbPath: synonymsDbPath,
            splitterDbPath: splitterDbPath,
            inflectionDbPath: inflectionDbPath,
            ptspedDbPath: ptspedDbPath,
            abhidhanDbPath: abhidhanDbPath,
            palisinhDbPath: palisinhDbPath,
            sanskritDbPath: sanskritDbPath,
          ),
        )
        .entries;
  }

  static String stripSimpleHtml(String html) =>
      DictionaryRepository.stripHtmlToPlainText(html);
}
