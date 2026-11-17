import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import '../services/bold_definition_index_service.dart';
import '../services/linked_definition_service.dart';
import '../services/tipitaka_core_reader.dart';
import '../utils/pali_script_converter.dart';
import 'dpd_family_templates.dart';

part 'tipitaka_ai_api.dart';

/// Result wrapper returned by [TipitakaWebApi] handlers for HTTP serialization.
class ApiResponse {
  final int statusCode;
  final Object? body;
  final String contentType;

  const ApiResponse(
    this.body, {
    this.statusCode = 200,
    this.contentType = 'application/json; charset=utf-8',
  });

  factory ApiResponse.notFound(String message) =>
      ApiResponse({'error': message}, statusCode: 404);

  factory ApiResponse.serverError(String message) =>
      ApiResponse({'error': message}, statusCode: 500);
}

/// Offline SQLite API backend mirroring `tipitakapali.org/server_api` so the
/// static Next.js frontend in WebView runs identically offline.
class TipitakaWebApi {
  String dbDirectoryPath;
  final DpdFamilyTemplates dpdFamilyTemplates;
  final BoldDefinitionIndexService? _boldServiceOverride;
  final LinkedDefinitionService? _linkedServiceOverride;

  late final BoldDefinitionIndexService boldDefinitionService =
      _boldServiceOverride ?? BoldDefinitionIndexService();
  late final LinkedDefinitionService linkedDefinitionService =
      _linkedServiceOverride ??
      LinkedDefinitionService(boldService: boldDefinitionService);

  final Map<String, Database> _dbs = {};
  final Map<String, Set<String>> _tableNamesCache = {};
  final Map<String, List<String>> _synCache = {};

  List<dynamic>? _treeCache;
  Map<String, dynamic>? _booksListCache;
  List<Map<String, dynamic>>? _matListCache;
  final Map<String, Map<String, dynamic>> _bookMetaCache = {};
  final Map<String, List<Map<String, dynamic>>> _tocCache = {};
  final Map<String, Map<String, dynamic>> _chapterLinksCache = {};
  final Map<String, Map<String, dynamic>> _linkedPreviewCache = {};
  bool _boldIndexVerified = false;

  static const Map<String, String> _langNameToCode = {
    'english': 'en',
    'vietnamese': 'vi',
    'myanmar': 'my',
    'burmese': 'my',
    'sinhala': 'si',
    'chinese': 'zh',
    'khmer': 'km',
    'thai': 'th',
    'lao': 'lo',
    'tamil': 'ta',
    'hindi': 'hi',
    'german': 'de',
    'japanese': 'ja',
    'korean': 'ko',
    'indonesian': 'id',
    'nepali': 'ne',
    'bengali': 'be',
    'spanish': 'es',
    'french': 'fr',
    'portuguese': 'pt',
    'russian': 'ru',
    'czech': 'cs',
    'marathi': 'mr',
    'my_nissaya': 'my_nissaya',
    'nissaya': 'my_nissaya',
  };

  static final Map<String, String> _codeToLangId = {
    for (final entry in _langNameToCode.entries) entry.value: entry.key,
  };

  TipitakaWebApi({
    required this.dbDirectoryPath,
    required this.dpdFamilyTemplates,
    BoldDefinitionIndexService? boldDefinitionService,
    LinkedDefinitionService? linkedDefinitionService,
  })  : _boldServiceOverride = boldDefinitionService,
        _linkedServiceOverride = linkedDefinitionService;

  void updateDbDirectory(String newPath) {
    if (newPath != dbDirectoryPath) {
      dbDirectoryPath = newPath;
    }
    invalidateDatabases();
  }

  /// Closes cached SQLite connections and drops RAM caches so newly downloaded
  /// or removed `.db` files take effect immediately.
  void invalidateDatabases() {
    for (final db in _dbs.values) {
      try {
        db.close();
      } catch (_) {}
    }
    _dbs.clear();
    _tableNamesCache.clear();
    _synCache.clear();
    _treeCache = null;
    _booksListCache = null;
    _matListCache = null;
    _bookMetaCache.clear();
    _tocCache.clear();
    _chapterLinksCache.clear();
    _linkedPreviewCache.clear();
    _boldIndexVerified = false;
  }

  /// Ensures derived offline indexes (such as `bold_definitions.db`) are built
  /// in the background without blocking startup.
  Future<void> warmUpIndexes() async {
    try {
      if (!BoldDefinitionIndexService.isUpToDate(dbDirectoryPath)) {
        final prev = _dbs.remove(BoldDefinitionIndexService.dbFilename);
        if (prev != null) {
          try {
            prev.close();
          } catch (_) {}
        }
      }
      final result = await boldDefinitionService.ensureBuilt(
        dbDirPath: dbDirectoryPath,
      );
      _boldIndexVerified = true;
      if (!result.skipped) {
        final prev = _dbs.remove(BoldDefinitionIndexService.dbFilename);
        if (prev != null) {
          try {
            prev.close();
          } catch (_) {}
        }
        _chapterLinksCache.clear();
      }
    } catch (_) {}
  }

  Database? _openFreshBoldDb() {
    if (BoldDefinitionIndexService.isInFlight(dbDirectoryPath)) {
      return null;
    }
    if (!_boldIndexVerified) {
      if (BoldDefinitionIndexService.isUpToDate(dbDirectoryPath)) {
        _boldIndexVerified = true;
      } else {
        final prev = _dbs.remove(BoldDefinitionIndexService.dbFilename);
        if (prev != null) {
          try {
            prev.close();
          } catch (_) {}
        }
        return null;
      }
    }
    return _openDb(BoldDefinitionIndexService.dbFilename);
  }

  void close() => invalidateDatabases();

  Database? _openDb(String filename) {
    final existing = _dbs[filename];
    if (existing != null) return existing;

    final filePath = p.join(dbDirectoryPath, filename);
    if (!File(filePath).existsSync()) return null;

    try {
      final db = sqlite3.open(filePath, mode: OpenMode.readOnly);
      db.execute(
        'PRAGMA temp_store = MEMORY; PRAGMA query_only = 1; '
        'PRAGMA cache_size = -8000; PRAGMA mmap_size = 67108864;',
      );
      _dbs[filename] = db;
      return db;
    } catch (_) {
      return null;
    }
  }

  Database? _openPtsDb() {
    return _openDb('ptsped2015ed_tipitakapali.db') ??
        _openDb('legacy_ptsped2015ed_tipitakapali.db');
  }

  Set<String> _getTableNames(String dbKey, Database db) {
    final cached = _tableNamesCache[dbKey];
    if (cached != null) return cached;
    final rows = db.select(
      "SELECT name FROM sqlite_master WHERE type='table' "
      "AND name NOT IN ('sqlite_sequence', 'android_metadata', 'misc', 'synonyms', 'zmisc') "
      "AND name NOT LIKE 'sqlite_%'",
    );
    final set = rows.map((r) => r['name'].toString()).toSet();
    _tableNamesCache[dbKey] = set;
    return set;
  }

  String _getFChar(
    String word,
    String dbKey,
    Database db, {
    bool useSplitter = false,
  }) {
    final tables = _getTableNames(dbKey, db);
    if (word.isEmpty) return 'misc';
    if (word.length == 1) {
      return tables.contains('0000000z') ? '0000000z' : 'misc';
    }
    final prefix = '${word.substring(0, 2)}z';
    if (tables.contains(prefix)) return prefix;
    return useSplitter ? 'zmisc' : 'misc';
  }

  static ({String code, int? suffixChapter}) _parseBookCode(String rawCode) {
    var clean = Uri.decodeComponent(rawCode).replaceAll('.xml', '');
    final m = RegExp(
      r'^(.*?\.(?:mul|att|tik|nrf))(\d+)$',
      caseSensitive: false,
    ).firstMatch(clean);
    if (m != null) {
      return (code: m.group(1)!, suffixChapter: int.tryParse(m.group(2)!));
    }
    return (code: clean, suffixChapter: null);
  }

  static List<dynamic> _cleanTree(dynamic data) {
    if (data is List && data.length == 1) {
      final first = data.first;
      if (first is Map) {
        final text = (first['text'] ?? '').toString().toLowerCase();
        if ((text == 'tipiṭaka' || text == 'tipitaka') &&
            first['children'] is List) {
          return List<dynamic>.from(first['children'] as List);
        }
      }
    }
    if (data is List) return List<dynamic>.from(data);
    return const [];
  }

  ApiResponse health() {
    final hasCore = File(p.join(dbDirectoryPath, 'tipitaka.db')).existsSync();
    return ApiResponse({
      'status': hasCore ? 'healthy' : 'missing_core_db',
      'version': '3.0.0',
      'mode': 'offline-flutter-shelf-sqlite',
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    });
  }

  ApiResponse getTree() {
    if (_treeCache != null) return ApiResponse(_treeCache);
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }

    try {
      final rows = db.select(
        "SELECT value FROM site_metadata WHERE key = 'tree_json' LIMIT 1",
      );
      if (rows.isNotEmpty && rows.first['value'] != null) {
        final parsed = jsonDecode(rows.first['value'].toString());
        _treeCache = _cleanTree(parsed);
        return ApiResponse(_treeCache);
      }
    } catch (_) {}

    // Fallback: reconstruct nested jsTree structure from `tree_nodes` if `site_metadata` is empty.
    try {
      final nodes = db.select(
        'SELECT id, text, parent_id, node_type, book_code, chapter_index, href '
        'FROM tree_nodes ORDER BY id',
      );
      final byId = <int, Map<String, dynamic>>{};
      final roots = <Map<String, dynamic>>[];
      for (final r in nodes) {
        final id = (r['id'] as num).toInt();
        final href = r['href']?.toString();
        final nodeMap = <String, dynamic>{
          'id': id.toString(),
          'text': (r['text'] ?? '').toString(),
          if (href != null && href.isNotEmpty) 'a_attr': {'href': href},
          if (r['book_code'] != null) 'book_code': r['book_code'].toString(),
          if (r['chapter_index'] != null)
            'chapter_index': (r['chapter_index'] as num).toInt(),
          'children': <Map<String, dynamic>>[],
        };
        byId[id] = nodeMap;
      }
      for (final r in nodes) {
        final id = (r['id'] as num).toInt();
        final parentId = (r['parent_id'] as num?)?.toInt();
        final node = byId[id]!;
        if (parentId != null && byId.containsKey(parentId)) {
          (byId[parentId]!['children'] as List).add(node);
        } else {
          roots.add(node);
        }
      }
      _treeCache = _cleanTree(roots);
      return ApiResponse(_treeCache);
    } catch (_) {
      return ApiResponse.notFound('Navigation tree not found');
    }
  }

  ApiResponse getBooks() {
    if (_booksListCache != null) return ApiResponse(_booksListCache);
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    final rows = db.select(
      'SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id',
    );
    final list = rows
        .map(
          (r) => {
            'code': r['code'],
            'title': r['title'],
            'nikaya': r['nikaya'],
            'category': r['category'],
            'chapter_count': r['chapter_count'],
          },
        )
        .toList(growable: false);
    _booksListCache = {'total': list.length, 'books': list};
    return ApiResponse(_booksListCache);
  }

  ApiResponse getMatList() {
    if (_matListCache != null) return ApiResponse(_matListCache);
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    try {
      final rows = db.select(
        'SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat',
      );
      _matListCache = rows
          .map(
            (r) => {
              'book_code': r['book_code'],
              'category': r['category'],
              'mula_code': r['mula_code'],
              'mula_title': r['mula_title'],
              'attha_code': r['attha_code'],
              'attha_title': r['attha_title'],
              'tika_code': r['tika_code'],
              'tika_title': r['tika_title'],
            },
          )
          .toList(growable: false);
    } catch (_) {
      _matListCache = const [];
    }
    return ApiResponse(_matListCache);
  }

  Map<String, dynamic>? _loadBookEntry(Database db, String cleanCode) {
    final cached = _bookMetaCache[cleanCode];
    if (cached != null) return cached;

    final bookRows = db.select(
      'SELECT id, code, title, nikaya, category, chapter_count '
      'FROM books WHERE code = ? LIMIT 1',
      [cleanCode],
    );
    if (bookRows.isEmpty) return null;
    final b = bookRows.first;
    final chapRows = db.select(
      'SELECT chapter_index, title, chunk_name, anchor_id, para_index '
      'FROM chapters WHERE book_code = ? ORDER BY chapter_index',
      [cleanCode],
    );
    final chapters = chapRows
        .map(
          (r) => {
            'chapter_index': (r['chapter_index'] as num).toInt(),
            'title': r['title'],
            'chunk_name': r['chunk_name'],
            'anchor_id': r['anchor_id'],
            'para_index': r['para_index'],
          },
        )
        .toList(growable: false);

    Map<String, dynamic> meta = {};
    final metaJson = TipitakaCoreReader.readBookMetaJson(db, cleanCode);
    if (metaJson != null && metaJson.isNotEmpty) {
      try {
        final decoded = jsonDecode(metaJson);
        if (decoded is Map<String, dynamic>) meta = decoded;
      } catch (_) {}
    }

    final entry = {
      'book': {
        'id': b['id'],
        'code': b['code'],
        'title': b['title'],
        'nikaya': b['nikaya'],
        'category': b['category'],
        'chapter_count': b['chapter_count'],
      },
      'chapters': chapters,
      'meta': meta,
    };
    if (_bookMetaCache.length > 100) {
      _bookMetaCache.remove(_bookMetaCache.keys.first);
    }
    _bookMetaCache[cleanCode] = entry;
    return entry;
  }

  List<Map<String, dynamic>> _loadToc(Database db, String cleanCode) {
    final cached = _tocCache[cleanCode];
    if (cached != null) return cached;
    final rows = db.select(
      'SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index '
      'FROM book_toc WHERE book_code = ? ORDER BY item_index',
      [cleanCode],
    );
    final toc = rows
        .map(
          (r) => {
            'item_index': r['item_index'],
            'level': r['level'],
            'type': r['type'],
            'rend': r['rend'],
            'title': r['title'],
            'para_index': r['para_index'],
            'para_num': r['para_num'],
            'anchor_id': r['anchor_id'],
            'chapter_index': r['chapter_index'],
          },
        )
        .toList(growable: false);
    if (_tocCache.length > 100) {
      _tocCache.remove(_tocCache.keys.first);
    }
    _tocCache[cleanCode] = toc;
    return toc;
  }

  Map<String, dynamic>? _resolveMatObject(
    Database db,
    String cleanCode,
    Map<String, dynamic> meta,
  ) {
    final metaMat = meta['mat'];
    if (metaMat is Map<String, dynamic>) {
      return {
        ...metaMat,
        'split_targets':
            meta['split_targets'] ?? metaMat['split_targets'],
        'sub_book': meta['sub_book'] ?? metaMat['sub_book'],
        'sub_books': meta['sub_books'] ?? metaMat['sub_books'],
        if (meta['mula_chapter'] != null || metaMat['mula_chapter'] != null)
          'mula_chapter': meta['mula_chapter'] ?? metaMat['mula_chapter'],
        if (meta['mula_chapter_offset'] != null ||
            metaMat['mula_chapter_offset'] != null)
          'mula_chapter_offset':
              meta['mula_chapter_offset'] ?? metaMat['mula_chapter_offset'],
        if (meta['attha_chapter_offset'] != null ||
            metaMat['attha_chapter_offset'] != null)
          'attha_chapter_offset':
              meta['attha_chapter_offset'] ?? metaMat['attha_chapter_offset'],
      };
    }
    try {
      final rows = db.select(
        'SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title '
        'FROM book_mat WHERE book_code = ? LIMIT 1',
        [cleanCode],
      );
      if (rows.isEmpty) return null;
      final r = rows.first;
      return {
        'book_code': r['book_code'],
        'category': r['category'],
        'mula_code': r['mula_code'],
        'mula_title': r['mula_title'],
        'attha_code': r['attha_code'],
        'attha_title': r['attha_title'],
        'tika_code': r['tika_code'],
        'tika_title': r['tika_title'],
      };
    } catch (_) {
      return null;
    }
  }

  ApiResponse getBook(String rawCode, Map<String, String> query) {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    final parsed = _parseBookCode(rawCode);
    var cleanCode = parsed.code;
    var entry = _loadBookEntry(db, cleanCode);
    if (entry == null && parsed.suffixChapter == null) {
      return ApiResponse.notFound("Book '$cleanCode' not found");
    }
    if (entry == null) {
      return ApiResponse.notFound("Book '$cleanCode' not found");
    }

    final book = entry['book'] as Map<String, dynamic>;
    final chapters = entry['chapters'] as List<Map<String, dynamic>>;
    final meta = entry['meta'] as Map<String, dynamic>;
    final toc = _loadToc(db, cleanCode);
    final matObj = _resolveMatObject(db, cleanCode, meta);

    final isTocOnly = query['tocOnly'] == 'true' || query['tocOnly'] == '1';
    if (isTocOnly) {
      return ApiResponse({
        'code': book['code'],
        'title': book['title'],
        'nikaya': book['nikaya'],
        'category': book['category'],
        'chapter_count': book['chapter_count'],
        'chapters': chapters,
        'toc': toc,
        'para_to_chapter': meta['para_to_chapter'] ?? const {},
        'para_to_index': meta['para_to_index'] ?? const {},
        'page_to_chapter': meta['page_to_chapter'] ?? const {},
        'page_to_para': meta['page_to_para'] ?? const {},
        'page_anchors': meta['page_anchors'] ?? const {},
        'para_range': meta['para_range'] ?? {'min': 1, 'max': 1, 'total': 0},
        'edition_ranges': meta['edition_ranges'] ?? const {},
        'book_type': meta['book_type'] ?? 'Whole',
        'mat': matObj,
        'sub_books': meta['sub_books'],
        'sub_book': meta['sub_book'],
        'chapter_to_sub_book': meta['chapter_to_sub_book'],
        'sub_books_para_to_chapter': meta['sub_books_para_to_chapter'],
        'attha_start_chapter': meta['attha_start_chapter'],
        'tika_start_chapter': meta['tika_start_chapter'],
        'chapter_to_mat': meta['chapter_to_mat'],
        'para_to_mat': meta['para_to_mat'],
        'sub_books_para_to_mat': meta['sub_books_para_to_mat'],
        'initial_chapter': null,
        'chapters_data': const {},
        'html': '',
        'viewMode': 'toc',
      });
    }

    final isFull = query['full'] == 'true';
    final reqChap = query.containsKey('chapter')
        ? (int.tryParse(query['chapter']!) ?? 0)
        : (parsed.suffixChapter ?? 0);
    final bufferCount = int.tryParse(query['buffer'] ?? '') ?? 1;

    final chaptersData = <String, String>{};
    if (isFull) {
      final htmlMap = TipitakaCoreReader.readChaptersHtml(db, cleanCode);
      for (final e in htmlMap.entries) {
        chaptersData[e.key.toString()] = e.value;
      }
    } else if (chapters.isNotEmpty) {
      final startIdx = math.max(0, reqChap - bufferCount);
      final endIdx = math.min(chapters.length - 1, reqChap + bufferCount);
      final htmlMap = TipitakaCoreReader.readChaptersHtml(
        db,
        cleanCode,
        startIdx: startIdx,
        endIdx: endIdx,
      );
      for (final e in htmlMap.entries) {
        chaptersData[e.key.toString()] = e.value;
      }
    }

    final sortedKeys = chaptersData.keys.toList()
      ..sort((a, b) => int.parse(a).compareTo(int.parse(b)));
    final joinedHtml = sortedKeys.map((k) => chaptersData[k]!).join('\n');

    return ApiResponse({
      'code': book['code'],
      'title': book['title'],
      'nikaya': book['nikaya'],
      'category': book['category'],
      'chapter_count': book['chapter_count'],
      'chapters': chapters,
      'toc': toc,
      'para_to_chapter': meta['para_to_chapter'] ?? const {},
      'para_to_index': meta['para_to_index'] ?? const {},
      'page_to_chapter': meta['page_to_chapter'] ?? const {},
      'page_to_para': meta['page_to_para'] ?? const {},
      'page_anchors': meta['page_anchors'] ?? const {},
      'para_range': meta['para_range'] ?? {'min': 1, 'max': 1, 'total': 0},
      'edition_ranges': meta['edition_ranges'] ?? const {},
      'mat': matObj,
      'sub_books': meta['sub_books'],
      'sub_book': meta['sub_book'],
      'chapter_to_sub_book': meta['chapter_to_sub_book'],
      'sub_books_para_to_chapter': meta['sub_books_para_to_chapter'],
      'attha_start_chapter': meta['attha_start_chapter'],
      'tika_start_chapter': meta['tika_start_chapter'],
      'chapter_to_mat': meta['chapter_to_mat'],
      'para_to_mat': meta['para_to_mat'],
      'sub_books_para_to_mat': meta['sub_books_para_to_mat'],
      'split_targets': meta['split_targets'],
      'mula_chapter': meta['mula_chapter'],
      'mula_chapter_offset': meta['mula_chapter_offset'],
      'attha_chapter_offset': meta['attha_chapter_offset'],
      'initial_chapter': reqChap,
      'chapters_data': chaptersData,
      'html': joinedHtml,
    });
  }

  ApiResponse getChapter(String rawCode, int chapterIndex) {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    var cleanCode = Uri.decodeComponent(rawCode).replaceAll('.xml', '');
    var html = TipitakaCoreReader.readChapterHtml(db, cleanCode, chapterIndex);
    if (html == null) {
      final parsed = _parseBookCode(cleanCode);
      if (parsed.code != cleanCode) {
        cleanCode = parsed.code;
        html = TipitakaCoreReader.readChapterHtml(db, cleanCode, chapterIndex);
      }
    }
    if (html == null) {
      return ApiResponse.notFound(
        "Chapter $chapterIndex not found in book '$cleanCode'",
      );
    }
    return ApiResponse({
      'book_code': cleanCode,
      'chapter_index': chapterIndex,
      'html': html,
    });
  }

  ApiResponse getToc(String rawCode) {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    final cleanCode = _parseBookCode(rawCode).code;
    final toc = _loadToc(db, cleanCode);
    return ApiResponse({'book_code': cleanCode, 'total': toc.length, 'toc': toc});
  }

  ApiResponse getBookMat(String rawCode) {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    final cleanCode = _parseBookCode(rawCode).code;
    final entry = _loadBookEntry(db, cleanCode);
    final meta = entry?['meta'] as Map<String, dynamic>? ?? const {};
    final mat = _resolveMatObject(db, cleanCode, meta);
    if (mat == null) {
      return ApiResponse.notFound("No MAT relationship found for '$cleanCode'");
    }
    return ApiResponse({'book_code': cleanCode, ...mat});
  }

  ApiResponse getPaliSentences(String rawCode) {
    final dedicated = _openDb('pali_sentences.db');
    final tipiDb = _openDb('tipitaka.db');
    if (!TipitakaCoreReader.hasPaliSentencesSupport(dedicated, tipiDb)) {
      return ApiResponse.notFound('Pali sentences unavailable');
    }
    final cleanCode = _parseBookCode(rawCode).code;
    try {
      final rows = TipitakaCoreReader.readBookSentences(
        dedicated,
        tipiDb,
        cleanCode,
      );
      if (rows.isEmpty && dedicated == null && tipiDb == null) {
        return ApiResponse.notFound("No Pali sentences found for '$cleanCode'");
      }
      final chapters = <String, Map<String, List<Map<String, dynamic>>>>{};
      for (final r in rows) {
        final ch = r.chapterIndex.toString();
        final pa = r.paraIndex.toString();
        chapters
            .putIfAbsent(ch, () => {})
            .putIfAbsent(pa, () => [])
            .add({'line': r.lineId, 'text': r.text});
      }
      return ApiResponse({'book_code': cleanCode, 'chapters': chapters});
    } catch (_) {
      return ApiResponse.notFound("No Pali sentences found for '$cleanCode'");
    }
  }

  String? _bookTitleFor(Database db, String? bookCode) {
    if (bookCode == null || bookCode.isEmpty) return null;
    final cached = _bookMetaCache[bookCode]?['book'] as Map<String, dynamic>?;
    if (cached != null) return cached['title']?.toString();
    final rows = db.select(
      'SELECT title FROM books WHERE code = ? LIMIT 1',
      [bookCode],
    );
    return rows.isNotEmpty ? rows.first['title']?.toString() : null;
  }

  ApiResponse getMatJump(String rawCode, String? paraRaw, int? chapter) {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return ApiResponse.serverError('tipitaka.db not installed');
    }
    final cleanCode = _parseBookCode(rawCode).code;
    final pStr = paraRaw
        ?.replaceFirst(RegExp(r'^(?:para-?|p)', caseSensitive: false), '')
        .trim();
    final baseP =
        (pStr != null && pStr.contains('-')) ? pStr.split('-').first.trim() : pStr;

    final entry = _loadBookEntry(db, cleanCode);
    final meta = entry?['meta'] as Map<String, dynamic>? ?? const {};
    String? subKey = meta['sub_book']?.toString();
    if (subKey == null && chapter != null) {
      final map = meta['chapter_to_sub_book'];
      if (map is Map) {
        subKey = map[chapter.toString()]?.toString();
      }
    }

    var matchQuality = 'exact';
    var matchedSourcePara = pStr;

    // 1. Check `canon_paragraphs` exact/span/closest
    Map<String, dynamic>? canonRow;
    if (pStr != null && pStr.isNotEmpty && chapter != null) {
      try {
        final queryNum = int.tryParse(baseP ?? '') ?? -1;
        var rows = db.select(
          'SELECT guid, book_code, chapter_index, para_num, '
          'mula_guid, mula_book, mula_chapter, mula_para, '
          'attha_guid, attha_book, attha_chapter, attha_para, '
          'tika_guid, tika_book, tika_chapter, tika_para, match_quality '
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? '
          'AND (para_num = ? OR (para_first <= ? AND para_last >= ?)) LIMIT 1',
          [cleanCode, chapter, pStr, queryNum, queryNum],
        );
        if (rows.isEmpty && queryNum > 0) {
          rows = db.select(
            'SELECT guid, book_code, chapter_index, para_num, '
            'mula_guid, mula_book, mula_chapter, mula_para, '
            'attha_guid, attha_book, attha_chapter, attha_para, '
            'tika_guid, tika_book, tika_chapter, tika_para, match_quality '
            'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? '
            'AND para_first IS NOT NULL ORDER BY ABS(para_first - ?) ASC LIMIT 1',
            [cleanCode, chapter, queryNum],
          );
          if (rows.isNotEmpty) {
            matchQuality = 'closest';
            matchedSourcePara = rows.first['para_num']?.toString();
          }
        }
        if (rows.isNotEmpty) {
          final r = rows.first;
          canonRow = {for (final col in rows.columnNames) col: r[col]};
        }
      } catch (_) {}
    }

    final canonFine = canonRow != null &&
        (canonRow['match_quality'] == 'exact' ||
            canonRow['match_quality'] == 'span' ||
            matchQuality == 'closest');
    Map<String, dynamic> buildCanonPayload() {
      final cr = canonRow!;
      Map<String, dynamic>? layer(String prefix) {
        final b = cr['${prefix}_book']?.toString();
        if (b == null || b.isEmpty) return null;
        return {
          'book': b,
          'chapter': cr['${prefix}_chapter'],
          'para': cr['${prefix}_para'],
          'guid': cr['${prefix}_guid'],
          'title': _bookTitleFor(db, b),
        };
      }

      return {
        'source_book': cleanCode,
        'source_chapter': chapter,
        'source_para': pStr,
        'source_guid': cr['guid'],
        'match_quality':
            matchQuality != 'exact' ? matchQuality : cr['match_quality'],
        'matched_source_para': matchedSourcePara,
        'mula': layer('mula'),
        'attha': layer('attha'),
        'tika': layer('tika'),
      };
    }

    if (canonFine) return ApiResponse(buildCanonPayload());

    // 2. Fall back to `mat_para_map` + neighbor fill + `mat_chapter_map`.
    Map<String, dynamic>? paraRow;
    try {
      const cols =
          'mula_book, mula_chapter, mula_para, mula_title, '
          'attha_book, attha_chapter, attha_para, attha_title, '
          'tika_book, tika_chapter, tika_para, tika_title, source_para';
      if (pStr != null && pStr.isNotEmpty && chapter != null) {
        var r = db.select(
          'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_chapter = ? AND source_para = ? LIMIT 1',
          [cleanCode, chapter, pStr],
        );
        if (r.isEmpty && baseP != null && baseP != pStr) {
          r = db.select(
            'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_chapter = ? AND source_para = ? LIMIT 1',
            [cleanCode, chapter, baseP],
          );
        }
        if (r.isNotEmpty) {
          paraRow = {for (final c in r.columnNames) c: r.first[c]};
        }
      }
      if (paraRow == null && pStr != null && subKey != null) {
        var r = db.select(
          'SELECT $cols FROM mat_para_map WHERE source_book = ? AND sub_book = ? AND source_para = ? LIMIT 1',
          [cleanCode, subKey, pStr],
        );
        if (r.isEmpty && baseP != null && baseP != pStr) {
          r = db.select(
            'SELECT $cols FROM mat_para_map WHERE source_book = ? AND sub_book = ? AND source_para = ? LIMIT 1',
            [cleanCode, subKey, baseP],
          );
        }
        if (r.isNotEmpty) {
          paraRow = {for (final c in r.columnNames) c: r.first[c]};
        }
      }
      if (paraRow == null && pStr != null && subKey == null) {
        var r = db.select(
          'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_para = ? LIMIT 1',
          [cleanCode, pStr],
        );
        if (r.isEmpty && baseP != null && baseP != pStr) {
          r = db.select(
            'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_para = ? LIMIT 1',
            [cleanCode, baseP],
          );
        }
        if (r.isNotEmpty) {
          paraRow = {for (final c in r.columnNames) c: r.first[c]};
        }
      }
      if (paraRow == null && pStr != null && chapter != null) {
        final pNum = int.tryParse(baseP ?? '');
        if (pNum != null && pNum > 0) {
          final r = db.select(
            'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_chapter = ? '
            'AND CAST(source_para AS INTEGER) > 0 ORDER BY ABS(CAST(source_para AS INTEGER) - ?) ASC LIMIT 1',
            [cleanCode, chapter, pNum],
          );
          if (r.isNotEmpty) {
            paraRow = {for (final c in r.columnNames) c: r.first[c]};
            matchQuality = 'closest';
            matchedSourcePara = paraRow['source_para']?.toString();
          }
        }
      }

      // Neighbor fill for sibling rows in the same chapter.
      if (paraRow != null && chapter != null && baseP != null) {
        final selfNum = int.tryParse(baseP.split('-').first);
        if (selfNum != null) {
          final sibs = db.select(
            'SELECT $cols FROM mat_para_map WHERE source_book = ? AND source_chapter = ?',
            [cleanCode, chapter],
          );
          for (final layer in const ['mula', 'attha', 'tika']) {
            final bKey = '${layer}_book';
            final pKey = '${layer}_para';
            if (paraRow[bKey] == null || paraRow[pKey] != null) continue;
            Row? best;
            var bestDiff = 1 << 30;
            var bestNum = 1 << 30;
            for (final r in sibs) {
              if (r[bKey] != paraRow[bKey]) continue;
              if (r[pKey] == null) continue;
              final rn = int.tryParse(
                (r['source_para'] ?? '').toString().split('-').first,
              );
              if (rn == null) continue;
              final diff = (rn - selfNum).abs();
              if (diff < bestDiff || (diff == bestDiff && rn < bestNum)) {
                best = r;
                bestDiff = diff;
                bestNum = rn;
              }
            }
            if (best != null) {
              paraRow['${layer}_chapter'] = best['${layer}_chapter'];
              paraRow['${layer}_para'] = best['${layer}_para'];
              paraRow['${layer}_title'] ??= best['${layer}_title'];
            }
          }
        }
      }
    } catch (_) {}

    final matHasPara = paraRow != null &&
        const ['mula', 'attha', 'tika'].any(
          (l) => paraRow!['${l}_book'] != null && paraRow['${l}_para'] != null,
        );
    if (!matHasPara && canonRow != null) {
      return ApiResponse(buildCanonPayload());
    }

    Map<String, dynamic>? chapRow;
    if (chapter != null) {
      try {
        final r = db.select(
          'SELECT mula_book, mula_chapter, mula_title, attha_book, attha_chapter, attha_title, tika_book, tika_chapter, tika_title '
          'FROM mat_chapter_map WHERE source_book = ? AND source_chapter = ? LIMIT 1',
          [cleanCode, chapter],
        );
        if (r.isNotEmpty) {
          chapRow = {for (final c in r.columnNames) c: r.first[c]};
        }
      } catch (_) {}
    }

    if (paraRow == null && chapRow != null) {
      matchQuality = 'chapter';
    }

    Map<String, dynamic>? formatLayer(String prefix) {
      final book =
          paraRow?['${prefix}_book'] ?? chapRow?['${prefix}_book'];
      if (book == null) return null;
      return {
        'book': book,
        'chapter': paraRow?['${prefix}_chapter'] ??
            chapRow?['${prefix}_chapter'] ??
            0,
        'para': paraRow?['${prefix}_para'],
        'title': paraRow?['${prefix}_title'] ?? chapRow?['${prefix}_title'],
      };
    }

    return ApiResponse({
      'source_book': cleanCode,
      'source_chapter': chapter,
      'source_para': pStr,
      'match_quality': matchQuality,
      'matched_source_para': matchedSourcePara,
      'mula': formatLayer('mula'),
      'attha': formatLayer('attha'),
      'tika': formatLayer('tika'),
    });
  }

  ApiResponse getParagraphByGuid(String guid) {
    final db = _openDb('tipitaka.db');
    if (db == null) return ApiResponse.serverError('tipitaka.db not installed');
    try {
      ResultSet rows;
      final parsed = TipitakaCoreReader.tryParseGuid(guid);
      if (parsed != null) {
        rows = db.select(
          'SELECT * FROM canon_paragraphs '
          'WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
          [parsed.bookCode, parsed.chapterIndex, parsed.paraIndex],
        );
      } else {
        rows = db.select(
          'SELECT * FROM canon_paragraphs WHERE guid = ? LIMIT 1',
          [guid],
        );
      }
      if (rows.isEmpty) {
        rows = db.select(
          'SELECT * FROM canon_paragraphs WHERE guid = ? LIMIT 1',
          [guid],
        );
      }
      if (rows.isEmpty) {
        return ApiResponse.notFound('Paragraph not found: $guid');
      }
      final r = rows.first;
      final out = <String, dynamic>{for (final c in rows.columnNames) c: r[c]};
      if (out['pali_text'] == null &&
          out['book_code'] != null &&
          out['chapter_index'] != null &&
          out['para_index'] != null) {
        final chapTexts = TipitakaCoreReader.readChapterPaliTexts(
          db,
          out['book_code'].toString(),
          (out['chapter_index'] as num).toInt(),
        );
        final resolved = chapTexts[(out['para_index'] as num).toInt()];
        if (resolved != null) out['pali_text'] = resolved;
      }
      return ApiResponse(out);
    } catch (e) {
      return ApiResponse.serverError(e.toString());
    }
  }

  ApiResponse getParagraphs(Map<String, String> query) {
    final db = _openDb('tipitaka.db');
    if (db == null) return ApiResponse.serverError('tipitaka.db not installed');
    final book = query['book'];
    final chapter =
        query['chapter'] != null ? int.tryParse(query['chapter']!) : null;
    final limit = math.min(int.tryParse(query['limit'] ?? '100') ?? 100, 500);
    final offset = math.max(0, int.tryParse(query['offset'] ?? '0') ?? 0);

    const cols =
        'global_id, guid, book_code, sub_book, chapter_index, chapter_title, '
        'sutta_title, para_index, para_num, rend, pali_text, word_count, '
        'mula_guid, attha_guid, tika_guid';
    final ResultSet rows;
    if (book != null && chapter != null) {
      rows = db.select(
        'SELECT $cols FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? ORDER BY para_index LIMIT ? OFFSET ?',
        [book, chapter, limit, offset],
      );
    } else if (book != null) {
      rows = db.select(
        'SELECT $cols FROM canon_paragraphs WHERE book_code = ? ORDER BY para_index LIMIT ? OFFSET ?',
        [book, limit, offset],
      );
    } else {
      rows = db.select(
        'SELECT $cols FROM canon_paragraphs ORDER BY global_id LIMIT ? OFFSET ?',
        [limit, offset],
      );
    }
    final paragraphs = rows
        .map((r) => {for (final c in rows.columnNames) c: r[c]})
        .toList(growable: false);
    return ApiResponse({'count': paragraphs.length, 'paragraphs': paragraphs});
  }

  // ---------------------------------------------------------------------------
  // Translations API
  // ---------------------------------------------------------------------------

  List<Map<String, dynamic>> _discoverTranslations() {
    final dir = Directory(dbDirectoryPath);
    if (!dir.existsSync()) return const [];
    final out = <Map<String, dynamic>>[];
    final regex = RegExp(r'^translation_([a-z_]+)\.db$', caseSensitive: false);
    for (final entity in dir.listSync()) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      final m = regex.firstMatch(name);
      if (m == null) continue;
      final code = m.group(1)!.toLowerCase();
      final db = _openDb(name);
      if (db == null) continue;
      final meta = <String, String>{};
      try {
        for (final r in db.select('SELECT key, value FROM translation_meta')) {
          meta[r['key'].toString()] = (r['value'] ?? '').toString();
        }
      } catch (_) {}
      out.add({
        'code': code,
        'id': _codeToLangId[code] ?? code,
        'name': meta['name'] ?? meta['lang_name'] ?? code.toUpperCase(),
        'native_name':
            meta['native_name'] ?? meta['lang_native_name'] ?? code.toUpperCase(),
        'flag': meta['flag'] ?? '🌐',
        if (meta['total_sentences'] != null)
          'total_sentences': int.tryParse(meta['total_sentences']!),
        if (meta['total_paragraphs'] != null)
          'total_paragraphs': int.tryParse(meta['total_paragraphs']!),
        if (meta['total_books'] != null)
          'total_books': int.tryParse(meta['total_books']!),
        'converted_at': meta['converted_at'],
      });
    }
    out.sort((a, b) => (a['code'] as String).compareTo(b['code'] as String));
    return out;
  }

  ApiResponse getAvailableTranslations() {
    return ApiResponse({
      'available': _discoverTranslations(),
      'has_pali_sentences': TipitakaCoreReader.hasPaliSentencesSupport(
        _openDb('pali_sentences.db'),
        _openDb('tipitaka.db'),
      ),
    });
  }

  String _normalizeLangCode(String raw) {
    final lower = raw.trim().toLowerCase();
    return _langNameToCode[lower] ?? lower;
  }

  ApiResponse getBookTranslation(
    String rawCode,
    int chapterIndex,
    Map<String, String> query,
  ) {
    final cleanCode = _parseBookCode(rawCode).code;
    final langsParam = query['lang'] ?? query['langs'] ?? 'en';
    final isDetailed = query['detailed'] == 'true' || query['detailed'] == '1';
    final withSentences =
        query['sentences'] == 'true' || query['sentences'] == '1';

    final requested = langsParam == 'all'
        ? _discoverTranslations().map((l) => l['code'].toString()).toList()
        : langsParam
            .split(',')
            .map((s) => _normalizeLangCode(s))
            .where((s) => s.isNotEmpty)
            .toList();

    final installedCodes = <String>[];
    final translations = <String, Map<String, dynamic>>{};
    final sentences = <String, Map<String, dynamic>>{};
    final detailedParagraphs = <String, Map<String, dynamic>>{};

    for (final code in requested) {
      final db = _openDb('translation_$code.db');
      if (db == null) continue;
      installedCodes.add(code);
      try {
        final rows = db.select(
          'SELECT para_index, guid, para_num, translation, sentence_count, sentences_json '
          'FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? '
          'ORDER BY para_index ASC',
          [cleanCode, chapterIndex],
        );
        if (isDetailed) {
          for (final r in rows) {
            final pKey = r['para_index'].toString();
            final entry = detailedParagraphs.putIfAbsent(
              pKey,
              () => {
                'para_index': r['para_index'],
                'guid': r['guid'],
                'para_num': r['para_num'],
                'translations': <String, dynamic>{},
              },
            );
            (entry['translations'] as Map<String, dynamic>)[code] = {
              'text': r['translation'],
              'sentence_count': r['sentence_count'],
              'sentences': _tryDecodeJson(r['sentences_json']),
            };
          }
        } else {
          final paraMap = <String, dynamic>{};
          final sentMap = <String, dynamic>{};
          for (final r in rows) {
            final pKey = r['para_index'].toString();
            paraMap[pKey] = r['translation'];
            if (withSentences && r['sentences_json'] != null) {
              final parsed = _tryDecodeJson(r['sentences_json']);
              if (parsed is List && parsed.isNotEmpty) {
                sentMap[pKey] = parsed;
              }
            }
          }
          translations[code] = paraMap;
          if (withSentences) {
            if (sentMap.isEmpty) {
              try {
                final stRows = db.select(
                  'SELECT para_index, line_id, translation '
                  'FROM sentence_translations WHERE book_code = ? AND chapter_index = ? '
                  'ORDER BY para_index ASC, line_id ASC',
                  [cleanCode, chapterIndex],
                );
                for (final sr in stRows) {
                  final pKey = sr['para_index'].toString();
                  final list = sentMap.putIfAbsent(pKey, () => <Map<String, dynamic>>[])
                      as List<Map<String, dynamic>>;
                  list.add({
                    'line_id': sr['line_id'],
                    'translation': sr['translation'],
                  });
                }
              } catch (_) {}
            }
            sentences[code] = sentMap;
          }
        }
      } catch (_) {}
    }

    if (isDetailed) {
      return ApiResponse({
        'book_code': cleanCode,
        'chapter_index': chapterIndex,
        'languages': installedCodes,
        'paragraphs': detailedParagraphs,
      });
    }

    return ApiResponse({
      'book_code': cleanCode,
      'chapter_index': chapterIndex,
      'languages': installedCodes,
      'translations': translations,
      if (withSentences) 'sentences': sentences,
    });
  }

  ApiResponse getGuidTranslation(String guid, String langsParam) {
    final requested = langsParam == 'all'
        ? _discoverTranslations().map((l) => l['code'].toString()).toList()
        : langsParam
            .split(',')
            .map((s) => _normalizeLangCode(s))
            .where((s) => s.isNotEmpty)
            .toList();

    final translations = <String, dynamic>{};
    for (final code in requested) {
      final db = _openDb('translation_$code.db');
      if (db == null) continue;
      try {
        final rows = db.select(
          'SELECT book_code, chapter_index, para_index, guid, para_num, translation, sentences_json '
          'FROM paragraph_translations WHERE guid = ? LIMIT 1',
          [guid],
        );
        if (rows.isNotEmpty) {
          final r = rows.first;
          translations[code] = {
            'text': r['translation'],
            'book_code': r['book_code'],
            'chapter_index': r['chapter_index'],
            'para_index': r['para_index'],
            'para_num': r['para_num'],
            'sentences': _tryDecodeJson(r['sentences_json']),
          };
        }
      } catch (_) {}
    }
    return ApiResponse({'guid': guid, 'translations': translations});
  }

  static dynamic _tryDecodeJson(Object? raw) {
    if (raw == null) return null;
    try {
      return jsonDecode(raw.toString());
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Search API
  // ---------------------------------------------------------------------------

  bool _hasPopulatedFtsIndex(String filename) {
    final db = _openDb(filename);
    if (db == null) return false;
    try {
      final tbl = db.select(
        "SELECT 1 FROM sqlite_master WHERE name = 'paragraphs_fts' LIMIT 1",
      );
      if (tbl.isEmpty) return false;
      final row = db.select('SELECT 1 FROM paragraphs_fts LIMIT 1');
      return row.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  ApiResponse getSearchDatabases() {
    final databases = <Map<String, dynamic>>[];
    if (_hasPopulatedFtsIndex('fts_tipitaka.db')) {
      databases.add({
        'id': 'fts_tipitaka.db',
        'key': 'pali',
        'name': 'Pāḷi CST',
        'native_name': 'Pāḷi CST',
        'flag': '☸️',
        'is_pali': true,
      });
    }
    for (final t in _discoverTranslations()) {
      final code = t['code'].toString();
      final ftsName = 'fts_translation_$code.db';
      if (_hasPopulatedFtsIndex(ftsName)) {
        databases.add({
          'id': ftsName,
          'key': code,
          'name': t['name'],
          'native_name': t['native_name'],
          'flag': t['flag'],
          'total_paragraphs': t['total_paragraphs'],
          'is_pali': false,
        });
      }
    }
    return ApiResponse({'databases': databases});
  }

  ({Database? db, String key, bool isPali, String dbName}) _resolveSearchDb(
    String rawParam,
  ) {
    final norm = rawParam.trim().toLowerCase();
    if (norm.isEmpty ||
        norm == 'pali' ||
        norm == 'tipitaka' ||
        norm == 'fts_tipitaka.db' ||
        norm == 'fts_tipitaka') {
      return (
        db: _openDb('fts_tipitaka.db'),
        key: 'pali',
        isPali: true,
        dbName: 'fts_tipitaka.db',
      );
    }

    var lang = norm;
    final m = RegExp(r'(?:fts_)?translation_([a-z_]+)(?:\.db)?$').firstMatch(norm);
    if (m != null) {
      lang = m.group(1)!;
    } else {
      lang = norm.replaceFirst(RegExp(r'\.db$'), '');
    }
    lang = _langNameToCode[lang] ?? lang;

    final filename = 'fts_translation_$lang.db';
    final transDb = _openDb(filename);
    if (transDb != null) {
      return (db: transDb, key: lang, isPali: false, dbName: filename);
    }
    return (
      db: _openDb('fts_tipitaka.db'),
      key: 'pali',
      isPali: true,
      dbName: 'fts_tipitaka.db',
    );
  }

  static bool _checkIsContains(String text) =>
      RegExp(r'(?:^|\s)\*(\S+)').hasMatch(text);

  static List<String> _extractContainsTerms(String text) {
    return text
        .split(RegExp(r'\s+'))
        .map((t) => t.replaceAll(RegExp(r'^\*+|\*+$'), '').trim())
        .where((t) => t.isNotEmpty)
        .toList(growable: false);
  }

  static String _buildFts5Query(String cleanText, String distance) {
    final tokens = cleanText
        .replaceAll(RegExp(r'[^\p{L}\p{N}\p{M}\u200C\u200D\s*]', unicode: true), ' ')
        .trim()
        .split(RegExp(r'\s+'))
        .where((t) => t.isNotEmpty)
        .toList(growable: false);
    if (tokens.isEmpty) return '';
    if (tokens.length == 1) {
      final tok = tokens.first;
      final clean = tok.replaceAll('*', '');
      return tok.endsWith('*')
          ? '"${tok.substring(0, tok.length - 1)}"*'
          : '"$clean"*';
    }
    if (distance == '1' || distance == 'exact') {
      final phrase = tokens.map((t) => t.replaceAll('*', '')).join(' ');
      return '"$phrase"';
    }
    final distNum = int.tryParse(distance);
    if (distNum != null && distNum >= 2 && distNum <= 50) {
      final terms = tokens.map((t) => '"${t.replaceAll('*', '')}"*').join(' ');
      return 'NEAR($terms, $distNum)';
    }
    return tokens
        .map(
          (t) => t.endsWith('*')
              ? '"${t.substring(0, t.length - 1)}"*'
              : '"${t.replaceAll('*', '')}"*',
        )
        .join(' AND ');
  }

  static String _highlightContains(
    String content,
    List<String> terms, {
    int snippetLen = 200,
  }) {
    if (content.isEmpty || terms.isEmpty) return content;
    final escaped = terms.map(RegExp.escape).toList(growable: false);
    var firstIdx = -1;
    var firstTermLen = 0;
    for (final term in escaped) {
      final m = RegExp(term, caseSensitive: false).firstMatch(content);
      if (m != null && (firstIdx == -1 || m.start < firstIdx)) {
        firstIdx = m.start;
        firstTermLen = m.end - m.start;
      }
    }
    if (firstIdx < 0) {
      return content.length > snippetLen
          ? '${content.substring(0, snippetLen)}...'
          : content;
    }
    final half = math.max(snippetLen ~/ 2, 20);
    final start = math.max(0, firstIdx - half);
    final end = math.min(content.length, firstIdx + firstTermLen + half);
    var result = content.substring(start, end);
    if (start > 0) result = '... $result';
    if (end < content.length) result = '$result ...';

    final sorted = [...escaped]..sort((a, b) => b.length.compareTo(a.length));
    for (final term in sorted) {
      result = result.replaceAllMapped(
        RegExp('($term)', caseSensitive: false),
        (m) => '<mark>${m.group(1)}</mark>',
      );
    }
    return result;
  }

  ApiResponse search(Map<String, String> query) {
    final rawQuery = (query['q'] ?? query['query'] ?? '').trim();
    final dbParam = query['l'] ?? query['db'] ?? query['lang'] ?? 'pali';
    final target = _resolveSearchDb(dbParam);
    final searchDb = target.db;

    final bookFilter = query['book'];
    final matFilter = query['mat'] ?? 'all';
    final pitakaFilter = query['pitaka'] ?? query['nikaya'] ?? 'all';
    final distanceVal = query['distance'] ?? query['dist'] ?? 'any';
    final sortVal = query['sort'] ?? 'pitaka';
    final limit = (int.tryParse(query['limit'] ?? '50') ?? 50).clamp(1, 200);
    final offset = math.max(0, int.tryParse(query['offset'] ?? '0') ?? 0);

    if (rawQuery.isEmpty || searchDb == null) {
      return ApiResponse({
        'total': 0,
        'count': 0,
        'db': target.dbName,
        'lang': target.key,
        'is_translation': !target.isPali,
        'results': const [],
      });
    }

    final cleanQuery = target.isPali
        ? PaliScriptConverter.convertToRoman(rawQuery).trim()
        : rawQuery;

    final isContains = _checkIsContains(cleanQuery);
    final containsTerms =
        isContains ? _extractContainsTerms(cleanQuery) : const <String>[];
    if (isContains && containsTerms.isEmpty) {
      return ApiResponse({
        'total': 0,
        'count': 0,
        'db': target.dbName,
        'lang': target.key,
        'is_translation': !target.isPali,
        'results': const [],
      });
    }

    final ftsMatch = !isContains ? _buildFts5Query(cleanQuery, distanceVal) : '';
    if (!isContains && ftsMatch.isEmpty) {
      return ApiResponse({
        'total': 0,
        'count': 0,
        'db': target.dbName,
        'lang': target.key,
        'is_translation': !target.isPali,
        'results': const [],
      });
    }

    final whereClauses = <String>[];
    final params = <Object?>[];

    if (isContains) {
      for (final term in containsTerms) {
        final lower = term.toLowerCase();
        final cap =
            lower.isEmpty ? '' : '${lower[0].toUpperCase()}${lower.substring(1)}';
        if (lower != cap) {
          whereClauses.add(
            "(content LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')",
          );
          params.addAll([lower, cap]);
        } else {
          whereClauses.add("content LIKE '%' || ? || '%'");
          params.add(lower);
        }
      }
    } else {
      whereClauses.add('paragraphs_fts MATCH ?');
      params.add(ftsMatch);
    }

    if (bookFilter != null && bookFilter.isNotEmpty && bookFilter != 'all') {
      whereClauses.add('book_code = ?');
      params.add(bookFilter.replaceAll('.xml', ''));
    }

    if (matFilter != 'all' && matFilter.isNotEmpty) {
      final conds = <String>[];
      for (final m in matFilter.toLowerCase().split(',').map((s) => s.trim())) {
        if (m == 'mula' || m == 'm' || m == 'mul') {
          conds.add("book_code LIKE '%.mul%'");
        } else if (m == 'attha' || m == 'a' || m == 'att') {
          conds.add("book_code LIKE '%.att%'");
        } else if (m == 'tika' || m == 't' || m == 'tik') {
          conds.add("book_code LIKE '%.tik%'");
        } else if (m == 'anna' || m == 'anya' || m == 'e') {
          conds.add(
            "(book_code NOT LIKE '%.mul%' AND book_code NOT LIKE '%.att%' AND book_code NOT LIKE '%.tik%')",
          );
        }
      }
      if (conds.isNotEmpty) whereClauses.add('(${conds.join(' OR ')})');
    }

    if (pitakaFilter != 'all' && pitakaFilter.isNotEmpty) {
      final conds = <String>[];
      for (final pk
          in pitakaFilter.toLowerCase().split(',').map((s) => s.trim())) {
        if (pk == 'vinaya' || pk == 'vi' || pk == 'vin') {
          conds.add(
            "(book_code LIKE 'vin%' OR book_code LIKE 'vi%' OR book_code LIKE 'v0%')",
          );
        } else if (pk == 'sutta' || pk == 'su' || pk == 's') {
          conds.add(
            "(book_code LIKE 's0%' OR book_code LIKE 's1%' OR book_code LIKE 's2%')",
          );
        } else if (pk == 'digha' || pk == 's01') {
          conds.add("book_code LIKE 's01%'");
        } else if (pk == 'majjhima' || pk == 's02') {
          conds.add("book_code LIKE 's02%'");
        } else if (pk == 'samyutta' || pk == 's03') {
          conds.add("book_code LIKE 's03%'");
        } else if (pk == 'anguttara' || pk == 's04') {
          conds.add("book_code LIKE 's04%'");
        } else if (pk == 'khuddaka' || pk == 's05') {
          conds.add("book_code LIKE 's05%'");
        } else if (pk == 'abhidhamma' || pk == 'abh' || pk == 'ab') {
          conds.add("book_code LIKE 'abh%'");
        } else if (pk == 'anna' || pk == 'anya' || pk == 'e') {
          conds.add("book_code LIKE 'e%'");
        }
      }
      if (conds.isNotEmpty) whereClauses.add('(${conds.join(' OR ')})');
    }

    final whereSql = 'WHERE ${whereClauses.join(' AND ')}';
    var orderSql = '''
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
          WHEN book_code LIKE 'e%' THEN 8
          ELSE 9
        END ASC,
        book_code ASC,
        para_index ASC,
        rowid ASC
    ''';

    if (!isContains) {
      if (sortVal == 'relevance' || sortVal == 'rank') {
        orderSql = 'ORDER BY rank ASC';
      } else if (sortVal == 'bm25') {
        orderSql = 'ORDER BY bm25(paragraphs_fts) ASC';
      }
    }

    try {
      final countRows = searchDb.select(
        'SELECT count(*) AS total FROM paragraphs_fts $whereSql',
        params,
      );
      final total =
          countRows.isNotEmpty ? (countRows.first['total'] as num).toInt() : 0;

      final querySql = isContains
          ? 'SELECT rowid, book_code, book_title, nikaya, para_num, para_index, para_rend, content '
              'FROM paragraphs_fts $whereSql $orderSql LIMIT ? OFFSET ?'
          : "SELECT rowid, book_code, book_title, nikaya, para_num, para_index, para_rend, "
              "snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet "
              'FROM paragraphs_fts $whereSql $orderSql LIMIT ? OFFSET ?';

      final rows = searchDb.select(querySql, [...params, limit, offset]);
      final results = <Map<String, dynamic>>[];
      for (final r in rows) {
        final item = <String, dynamic>{
          'rowid': r['rowid'],
          'book_code': r['book_code'],
          'book_title': r['book_title'],
          'nikaya': r['nikaya'],
          'para_num': r['para_num'],
          'para_index': r['para_index'],
          'para_rend': r['para_rend'],
          if (!target.isPali) 'is_translation': true,
          if (!target.isPali) 'lang': target.key,
          if (!target.isPali) 'db': target.dbName,
        };
        if (isContains) {
          item['snippet'] = _highlightContains(
            (r['content'] ?? '').toString(),
            containsTerms,
          );
        } else {
          item['snippet'] = r['snippet'];
        }
        results.add(item);
      }

      return ApiResponse({
        'query': cleanQuery,
        'ftsQuery':
            isContains ? '*${containsTerms.join(' ')}' : ftsMatch,
        'is_contains': isContains,
        'db': target.dbName,
        'lang': target.key,
        'is_translation': !target.isPali,
        'total': total,
        'count': results.length,
        'offset': offset,
        'limit': limit,
        'mat': matFilter,
        'pitaka': pitakaFilter,
        'distance': distanceVal,
        'sort': sortVal,
        'results': results,
      });
    } catch (e) {
      return ApiResponse({
        'query': cleanQuery,
        'db': target.dbName,
        'lang': target.key,
        'is_translation': !target.isPali,
        'total': 0,
        'count': 0,
        'error': e.toString(),
        'results': const [],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Dictionary & Inflection HTML API (exact `dictEngine.js` contract)
  // ---------------------------------------------------------------------------

  List<String> _getSynonyms(String word) {
    final cached = _synCache[word];
    if (cached != null) return cached;
    final db = _openDb('dpd_synonyms_tipitakapali.db');
    if (db == null) return const [];
    try {
      final fchar = _getFChar(word, 'SYN', db);
      final safe = '"${fchar.replaceAll('"', '""')}"';
      final rows = db.select('SELECT word FROM $safe WHERE synonym = ?', [word]);
      final result = rows
          .map((r) => (r['word'] ?? '').toString())
          .where((w) => w.isNotEmpty)
          .toList(growable: false);
      if (_synCache.length >= 3000) {
        _synCache.remove(_synCache.keys.first);
      }
      _synCache[word] = result;
      return result;
    } catch (_) {
      return const [];
    }
  }

  List<Map<String, dynamic>> _lookupSingleDpd(
    String word,
    List<String> cachedSyns,
  ) {
    final db = _openDb('dpd_tipitakapali.db');
    if (db == null) return const [];
    if (word.startsWith('##')) {
      try {
        final rows = db.select(
          'SELECT word, defi FROM misc WHERE word = ? LIMIT 1',
          [word],
        );
        if (rows.isNotEmpty) {
          return [
            {
              'word': rows.first['word'],
              'isExact': true,
              'html': dpdFamilyTemplates.restoreMinifiedLinksAndFooter(
                (rows.first['defi'] ?? '').toString(),
              ),
            },
          ];
        }
      } catch (_) {}
      return const [];
    }

    final wordsToQuery = <String>{word, ...cachedSyns}.toList(growable: false);
    final exact = <Map<String, dynamic>>[];
    final related = <Map<String, dynamic>>[];

    final grouped = <String, List<String>>{};
    for (final w in wordsToQuery) {
      final fchar = _getFChar(w, 'DPD', db);
      grouped.putIfAbsent(fchar, () => <String>[]).add(w);
    }
    for (final entry in grouped.entries) {
      final safe = '"${entry.key.replaceAll('"', '""')}"';
      final groupWords = entry.value;
      final placeholders = List.filled(groupWords.length, '?').join(',');
      try {
        final rows = db.select(
          'SELECT word, defi FROM $safe WHERE word IN ($placeholders)',
          groupWords,
        );
        for (final r in rows) {
          var df = dpdFamilyTemplates.restoreDpdDefi(
            (r['defi'] ?? '').toString(),
          );
          final hw = (r['word'] ?? '').toString();
          final isExact = hw.toLowerCase() == word;
          if (isExact) {
            df = df.replaceAll('class=p1w', 'class=p2w');
            exact.add({'word': hw, 'isExact': true, 'html': df});
          } else {
            related.add({'word': hw, 'isExact': false, 'html': df});
          }
        }
      } catch (_) {}
    }
    return [...exact, ...related];
  }

  List<Map<String, dynamic>> _lookupSimpleDict({
    required Database? db,
    required String dbKey,
    required String word,
    required List<String> wordsToQuery,
    required Map<String, dynamic> Function(Row row, bool isExact) formatter,
  }) {
    if (db == null) return const [];
    final exact = <Map<String, dynamic>>[];
    final related = <Map<String, dynamic>>[];
    final grouped = <String, List<String>>{};
    for (final w in wordsToQuery) {
      final fchar = _getFChar(w, dbKey, db);
      grouped.putIfAbsent(fchar, () => <String>[]).add(w);
    }
    for (final entry in grouped.entries) {
      final safe = '"${entry.key.replaceAll('"', '""')}"';
      final groupWords = entry.value;
      final placeholders = List.filled(groupWords.length, '?').join(',');
      try {
        final sql = dbKey == 'PSD'
            ? 'SELECT word, defi, source FROM $safe WHERE word IN ($placeholders)'
            : 'SELECT word, defi FROM $safe WHERE word IN ($placeholders)';
        final rows = db.select(sql, groupWords);
        for (final r in rows) {
          final hw = (r['word'] ?? '').toString();
          final isExact = hw.toLowerCase() == word;
          final item = formatter(r, isExact);
          if (isExact) {
            exact.add(item);
          } else {
            related.add(item);
          }
        }
      } catch (_) {}
    }
    return [...exact, ...related];
  }

  List<Map<String, dynamic>> _lookupDpdList(
    String cleanWord,
    List<String> sharedSyns,
  ) {
    if (!cleanWord.contains(' ')) {
      return _lookupSingleDpd(cleanWord, sharedSyns);
    }
    final full = _lookupSingleDpd(cleanWord, sharedSyns);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(_lookupSingleDpd(tok, _getSynonyms(tok)));
    }
    return out;
  }

  List<Map<String, dynamic>> _lookupPts(
    String cleanWord,
    List<String> sharedSyns,
  ) {
    final db = _openPtsDb();
    if (db == null) return const [];
    List<Map<String, dynamic>> runSingle(String w, List<String> syns) {
      return _lookupSimpleDict(
        db: db,
        dbKey: 'PTS',
        word: w,
        wordsToQuery: <String>{w, ...syns}.toList(growable: false),
        formatter: (r, isExact) => {
          'word': r['word'],
          'isExact': isExact,
          'html':
              '<div class="pts15"><span class="${isExact ? 'pp2w' : 'pp1w'}">${r['word']}</span><br>${r['defi']}</div>',
        },
      );
    }

    if (!cleanWord.contains(' ')) return runSingle(cleanWord, sharedSyns);
    final full = runSingle(cleanWord, sharedSyns);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(runSingle(tok, _getSynonyms(tok)));
    }
    return out;
  }

  List<Map<String, dynamic>> _lookupAbd(
    String cleanWord,
    List<String> sharedSyns,
  ) {
    final db = _openDb('abhidhan_tipitakapali.db');
    if (db == null) return const [];
    List<Map<String, dynamic>> runSingle(String w, List<String> syns) {
      return _lookupSimpleDict(
        db: db,
        dbKey: 'ABD',
        word: w,
        wordsToQuery: <String>{w, ...syns}.toList(growable: false),
        formatter: (r, isExact) => {
          'word': r['word'],
          'isExact': isExact,
          'html':
              '<div class="tmmAbhidhan"><span class="${isExact ? 'pm2w' : 'pm1w'}">${r['word']}</span><br>${r['defi']}</div>',
        },
      );
    }

    if (!cleanWord.contains(' ')) return runSingle(cleanWord, sharedSyns);
    final full = runSingle(cleanWord, sharedSyns);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(runSingle(tok, _getSynonyms(tok)));
    }
    return out;
  }

  List<Map<String, dynamic>> _lookupPsd(
    String cleanWord,
    List<String> sharedSyns,
  ) {
    final db = _openDb('palisinh.db');
    if (db == null) return const [];
    List<Map<String, dynamic>> runSingle(String w, List<String> syns) {
      return _lookupSimpleDict(
        db: db,
        dbKey: 'PSD',
        word: w,
        wordsToQuery: <String>{w, ...syns}.toList(growable: false),
        formatter: (r, isExact) {
          var df = (r['defi'] ?? '').toString();
          if (isExact) df = df.replaceAll('class=psdW', 'class=p2w');
          return {
            'word': r['word'],
            'isExact': isExact,
            'source': r['source'],
            'html': '<div class="psinh26">$df</div>',
          };
        },
      );
    }

    if (!cleanWord.contains(' ')) return runSingle(cleanWord, sharedSyns);
    final full = runSingle(cleanWord, sharedSyns);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(runSingle(tok, _getSynonyms(tok)));
    }
    return out;
  }

  List<Map<String, dynamic>> _lookupSans(String cleanWord) {
    final db = _openDb('ap_bh_mw_sanskrit.db');
    if (db == null) return const [];
    List<Map<String, dynamic>> runSingle(String w) {
      return _lookupSimpleDict(
        db: db,
        dbKey: 'SANS',
        word: w,
        wordsToQuery: [w],
        formatter: (r, isExact) {
          var df = (r['defi'] ?? '').toString();
          if (isExact) df = df.replaceAll('class=p1w', 'class=p3w');
          return {
            'word': r['word'],
            'isExact': isExact,
            'html': '<div class="sanskritSection">$df</div>',
          };
        },
      );
    }

    if (!cleanWord.contains(' ')) return runSingle(cleanWord);
    final full = runSingle(cleanWord);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(runSingle(tok));
    }
    return out;
  }

  List<Map<String, dynamic>> _lookupSplitter(String cleanWord) {
    final db = _openDb('dpd_splitter_tipitakapali.db');
    if (db == null) return const [];
    List<Map<String, dynamic>> runSingle(String w) {
      final fchar = _getFChar(w, 'SPLI', db, useSplitter: true);
      final safe = '"${fchar.replaceAll('"', '""')}"';
      final results = <Map<String, dynamic>>[];
      try {
        final rows = db.select('SELECT word, defi FROM $safe WHERE word = ?', [w]);
        for (final r in rows) {
          final hw = (r['word'] ?? w).toString();
          final elements = (r['defi'] ?? '')
              .toString()
              .split('@')
              .where((x) => x.trim().isNotEmpty)
              .toList(growable: false);
          final decHtml = elements
              .map(
                (el) =>
                    '<p class="dec">${el.replaceAll('+', ' <span class="dec-plus">+</span> ')}</p>',
              )
              .join();
          final encodedWord = Uri.encodeComponent(hw);
          final improveLink =
              'https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform?usp=pp_url&entry.438735500=$encodedWord&entry.326955045=Deconstructor&entry.1433863141=Tipitakapali.org%209999-12-12';
          final html = '''
            <div class="dpd-splitter-section">
              <div class="splitter-headword">
                <span class="p2w font-bold text-indigo-600 dark:text-indigo-400 text-sm sm:text-base">$hw</span>
              </div>
              <div class="splitter-body mt-2 space-y-1.5">
                $decHtml
              </div>
              <p class="dpd-footer">These DPD word breakups are code-generated. <a href="$improveLink" class="link" target="_blank">Improve it</a>.</p>
            </div>
          ''';
          results.add({
            'word': hw,
            'isExact': true,
            'isSplitter': true,
            'breakups': elements,
            'html': html,
          });
        }
      } catch (_) {}
      return results;
    }

    if (!cleanWord.contains(' ')) return runSingle(cleanWord);
    final full = runSingle(cleanWord);
    if (full.isNotEmpty) return full;
    final out = <Map<String, dynamic>>[];
    for (final tok in cleanWord.split(RegExp(r'\s+')).toSet().take(20)) {
      if (tok.isNotEmpty) out.addAll(runSingle(tok));
    }
    return out;
  }

  List<String> _resolveLangCodes(String? rawLangs) {
    final raw = rawLangs?.trim() ?? '';
    if (raw.isEmpty) return const [];
    if (raw.toLowerCase() == 'all') {
      return _discoverTranslations()
          .map((l) => l['code'].toString())
          .where((c) => c.isNotEmpty)
          .toList();
    }
    final seen = <String>{};
    final out = <String>[];
    for (final part in raw.split(',')) {
      final norm = _normalizeLangCode(part);
      if (norm.isNotEmpty && seen.add(norm)) {
        out.add(norm);
      }
    }
    return out;
  }

  Future<BoldDefinitionQueryResult> _lookupBoldDef(
    String word,
    List<String> langList,
  ) {
    return boldDefinitionService.lookup(
      dbDirPath: dbDirectoryPath,
      rawWord: word,
      enabledLangs: langList,
      boldDbOverride: _openFreshBoldDb(),
      tipitakaDbOverride: _openDb('tipitaka.db'),
      openTranslationDb: (code) => _openDb('translation_$code.db'),
    );
  }

  Future<ApiResponse> getChapterLinks(
    String rawCode,
    int chapterIndex,
  ) async {
    final cleanCode = _parseBookCode(rawCode).code;
    if (cleanCode.isEmpty || chapterIndex < 0) {
      return ApiResponse.notFound('Invalid chapter for links');
    }
    final cacheKey = '$cleanCode#$chapterIndex';
    final cached = _chapterLinksCache[cacheKey];
    if (cached != null) {
      return ApiResponse(cached);
    }

    final result = await linkedDefinitionService.getLinksForChapter(
      dbDirPath: dbDirectoryPath,
      bookCode: cleanCode,
      chapterIndex: chapterIndex,
      tipitakaDbOverride: _openDb('tipitaka.db'),
      boldDbOverride: _openFreshBoldDb(),
      paliSentencesDbOverride: _openDb('pali_sentences.db'),
    );
    _chapterLinksCache[cacheKey] = result;
    return ApiResponse(result);
  }

  Future<ApiResponse> getLinkedPreview(Map<String, String> query) async {
    final rawBook = query['book'] ?? query['bookCode'] ?? '';
    final cleanCode = _parseBookCode(rawBook).code;
    if (cleanCode.isEmpty) {
      return const ApiResponse(
        {'error': 'Missing book code'},
        statusCode: 400,
      );
    }

    final chapterIdx = int.tryParse(
      query['chapter'] ?? query['chapterIndex'] ?? '',
    );
    final paraIdx = int.tryParse(
      query['paraIndex'] ?? query['para_index'] ?? '',
    );
    final paraNum = query['paraNum'] ?? query['para_num'] ?? query['para'];
    final lineId = int.tryParse(query['lineId'] ?? query['line_id'] ?? '');
    final word = query['word'];
    final langList = _resolveLangCodes(query['langs'] ?? query['lang']);
    final cacheKey =
        '$cleanCode|${chapterIdx ?? ''}|${paraIdx ?? ''}|${paraNum ?? ''}|${lineId ?? ''}|${word ?? ''}|${langList.join(',')}';
    final cached = _linkedPreviewCache[cacheKey];
    if (cached != null) {
      return ApiResponse(cached);
    }

    final preview = await linkedDefinitionService.getLinkedPreview(
      dbDirPath: dbDirectoryPath,
      bookCode: cleanCode,
      chapterIndex: chapterIdx,
      paraIndex: paraIdx,
      paraNum: paraNum,
      lineId: lineId,
      word: word,
      enabledLangs: langList,
      tipitakaDbOverride: _openDb('tipitaka.db'),
      boldDbOverride: _openFreshBoldDb(),
      paliSentencesDbOverride: _openDb('pali_sentences.db'),
      openTranslationDb: (code) => _openDb('translation_$code.db'),
    );
    if (preview == null) {
      return ApiResponse.notFound(
        'Linked passage not found for $cleanCode',
      );
    }
    final json = preview.toJson();
    if (_linkedPreviewCache.length >= 400) {
      _linkedPreviewCache.remove(_linkedPreviewCache.keys.first);
    }
    _linkedPreviewCache[cacheKey] = json;
    return ApiResponse(json);
  }

  Future<ApiResponse> getLinkedPreviewsBatch(Map<String, dynamic> body) async {
    final rawItems = body['items'];
    if (rawItems is! List || rawItems.isEmpty) {
      return const ApiResponse({'results': <String, dynamic>{}});
    }
    final rawLangs = body['langs'] ?? body['lang'];
    final langStr = rawLangs is List
        ? rawLangs.map((e) => e.toString()).join(',')
        : (rawLangs?.toString() ?? '');
    final langList = _resolveLangCodes(langStr);
    final results = <String, dynamic>{};

    for (final item in rawItems.take(60)) {
      if (item is! Map) continue;
      final rawBook = (item['book'] ?? item['bookCode'] ?? '').toString();
      final cleanCode = _parseBookCode(rawBook).code;
      if (cleanCode.isEmpty) continue;
      final chapterIdx = item['chapter'] is num
          ? (item['chapter'] as num).toInt()
          : int.tryParse(item['chapter']?.toString() ?? '');
      final paraIdx = item['paraIndex'] is num
          ? (item['paraIndex'] as num).toInt()
          : int.tryParse(item['paraIndex']?.toString() ?? '');
      final paraNum = item['paraNum']?.toString();
      final lineId = item['lineId'] is num
          ? (item['lineId'] as num).toInt()
          : int.tryParse(item['lineId']?.toString() ?? '');
      final word = item['word']?.toString();
      final resultKey = item['key']?.toString() ?? cleanCode;
      final cacheKey =
          '$cleanCode|${chapterIdx ?? ''}|${paraIdx ?? ''}|${paraNum ?? ''}|${lineId ?? ''}|${word ?? ''}|${langList.join(',')}';

      final cached = _linkedPreviewCache[cacheKey];
      if (cached != null) {
        results[resultKey] = cached;
        continue;
      }

      final preview = await linkedDefinitionService.getLinkedPreview(
        dbDirPath: dbDirectoryPath,
        bookCode: cleanCode,
        chapterIndex: chapterIdx,
        paraIndex: paraIdx,
        paraNum: paraNum,
        lineId: lineId,
        word: word,
        enabledLangs: langList,
        tipitakaDbOverride: _openDb('tipitaka.db'),
        boldDbOverride: _openFreshBoldDb(),
        paliSentencesDbOverride: _openDb('pali_sentences.db'),
        openTranslationDb: (code) => _openDb('translation_$code.db'),
      );
      if (preview != null) {
        final json = preview.toJson();
        if (_linkedPreviewCache.length >= 400) {
          _linkedPreviewCache.remove(_linkedPreviewCache.keys.first);
        }
        _linkedPreviewCache[cacheKey] = json;
        results[resultKey] = json;
      }
    }

    return ApiResponse({'results': results});
  }

  Future<ApiResponse> lookupDict(
    String rawWord, {
    String dictType = 'all',
    String? langs,
  }) async {
    await dpdFamilyTemplates.ensureLoaded();
    final word = PaliScriptConverter.cleanDictionaryQuery(rawWord);
    if (word.isEmpty) {
      return const ApiResponse({
        'word': '',
        'hasResults': false,
        'error': 'Empty word query',
      });
    }

    final type = dictType.toLowerCase();
    final langList = _resolveLangCodes(langs);

    if (type == 'bold_def' || type == 'bold' || type == 'bold_definitions') {
      final boldRes = await _lookupBoldDef(word, langList);
      final jsonList =
          boldRes.results.map((r) => r.toJson()).toList(growable: false);
      return ApiResponse({
        'word': boldRes.query.isNotEmpty ? boldRes.query : word,
        'search_prefix': boldRes.searchPrefix,
        'hasResults': jsonList.isNotEmpty,
        'results': jsonList,
      });
    }

    final syns = _getSynonyms(word);

    if (type == 'dpd') {
      final dpd = _lookupDpdList(word, syns);
      return ApiResponse({
        'word': word,
        'hasResults': dpd.isNotEmpty,
        'synonyms': syns,
        'counts': {
          'dpd': dpd.length,
          'pts': 0,
          'abd': 0,
          'psd': 0,
          'sans': 0,
          'splitter': 0,
          'bold_def': 0,
        },
        'dpd': dpd,
        'pts': const [],
        'abd': const [],
        'psd': const [],
        'sans': const [],
        'splitter': const [],
        'bold_def': const [],
      });
    }

    if (type == 'others' || type == 'rest') {
      final pts = _lookupPts(word, syns);
      final abd = _lookupAbd(word, syns);
      final psd = _lookupPsd(word, syns);
      final sans = _lookupSans(word);
      final splitter = _lookupSplitter(word);
      return ApiResponse({
        'word': word,
        'hasResults': pts.isNotEmpty ||
            abd.isNotEmpty ||
            psd.isNotEmpty ||
            sans.isNotEmpty ||
            splitter.isNotEmpty,
        'counts': {
          'pts': pts.length,
          'abd': abd.length,
          'psd': psd.length,
          'sans': sans.length,
          'splitter': splitter.length,
        },
        'pts': pts,
        'abd': abd,
        'psd': psd,
        'sans': sans,
        'splitter': splitter,
      });
    }

    if (type == 'pts') {
      return ApiResponse({'word': rawWord, 'results': _lookupPts(word, syns)});
    }
    if (type == 'abd') {
      return ApiResponse({'word': rawWord, 'results': _lookupAbd(word, syns)});
    }
    if (type == 'psd') {
      return ApiResponse({'word': rawWord, 'results': _lookupPsd(word, syns)});
    }
    if (type == 'sans') {
      return ApiResponse({'word': rawWord, 'results': _lookupSans(word)});
    }
    if (type == 'splitter') {
      return ApiResponse({'word': rawWord, 'results': _lookupSplitter(word)});
    }

    // Default: 'all'
    final dpd = _lookupDpdList(word, syns);
    final pts = _lookupPts(word, syns);
    final abd = _lookupAbd(word, syns);
    final psd = _lookupPsd(word, syns);
    final sans = _lookupSans(word);
    final splitter = _lookupSplitter(word);
    final boldRes = await _lookupBoldDef(word, langList);
    final boldJson =
        boldRes.results.map((r) => r.toJson()).toList(growable: false);
    return ApiResponse({
      'word': word,
      'hasResults': dpd.isNotEmpty ||
          pts.isNotEmpty ||
          abd.isNotEmpty ||
          psd.isNotEmpty ||
          sans.isNotEmpty ||
          splitter.isNotEmpty ||
          boldJson.isNotEmpty,
      'synonyms': syns,
      'bold_def_prefix': boldRes.searchPrefix,
      'counts': {
        'dpd': dpd.length,
        'pts': pts.length,
        'abd': abd.length,
        'psd': psd.length,
        'sans': sans.length,
        'splitter': splitter.length,
        'bold_def': boldJson.length,
      },
      'dpd': dpd,
      'pts': pts,
      'abd': abd,
      'psd': psd,
      'sans': sans,
      'splitter': splitter,
      'bold_def': boldJson,
    });
  }

  ApiResponse lookupInflection(String rawQuery) {
    final trimmed = rawQuery.trim();
    if (trimmed.isEmpty) {
      return const ApiResponse({'error': 'Empty inflection query'});
    }
    final db = _openDb('dpd_inflection_tipitakapali.db');
    if (db == null) return ApiResponse({'word': trimmed, 'html': ''});

    final clean = trimmed.replaceFirst(
      RegExp(r'^(declension_|conjugation_)'),
      '',
    ).trim();

    Map<String, dynamic>? queryTable(String key) {
      final fchar = _getFChar(key, 'INF', db);
      final safe = '"${fchar.replaceAll('"', '""')}"';
      try {
        final rows = db.select(
          'SELECT word, defi FROM $safe WHERE word = ? LIMIT 1',
          [key],
        );
        if (rows.isNotEmpty && rows.first['defi'] != null) {
          return {
            'word': rows.first['word'],
            'query': rawQuery,
            'html': rows.first['defi'].toString(),
          };
        }
      } catch (_) {}
      return null;
    }

    final exact = queryTable(clean);
    if (exact != null) return ApiResponse(exact);

    if (clean.contains('_')) {
      final base = clean.split('_').first;
      final fallback = queryTable(base);
      if (fallback != null) return ApiResponse(fallback);
    }

    return ApiResponse({'word': trimmed, 'html': ''});
  }
}
