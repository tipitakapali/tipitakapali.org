import 'dart:async';
import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

enum FtsBuildStage { preparing, indexing, optimizing, compacting, completed }

class FtsBuildProgress {
  final String filename;
  final FtsBuildStage stage;
  final int processedRows;
  final int totalRows;
  final double progress;
  final String detail;

  const FtsBuildProgress({
    required this.filename,
    required this.stage,
    this.processedRows = 0,
    this.totalRows = 0,
    required this.progress,
    required this.detail,
  });
}

class FtsBuildResult {
  final String filename;
  final int indexedRows;
  final bool skipped;

  const FtsBuildResult({
    required this.filename,
    required this.indexedRows,
    this.skipped = false,
  });
}

/// Builds `fts_tipitaka.db` and `fts_translation_<lang>.db` SQLite FTS5
/// full-text search indexes in-app inside a background isolate, matching
/// `tipitakapali.org/server_api/generate_fts.py` and `build_translation_fts.py`.
class FtsIndexService {
  static const Map<String, String> _langTokenize = {
    'vi': 'unicode61 remove_diacritics 0',
    'th': "unicode61 categories 'L* N* Mn'",
    'km': "unicode61 categories 'L* N* Mn'",
    'lo': "unicode61 categories 'L* N* Mn'",
    'my': "unicode61 categories 'L* N* Mn'",
    'my_nissaya': "unicode61 categories 'L* N* Mn'",
    'hi': "unicode61 categories 'L* N* Mn'",
    'mr': "unicode61 categories 'L* N* Mn'",
    'ne': "unicode61 categories 'L* N* Mn'",
    'ta': "unicode61 categories 'L* N* Mn'",
    'si': "unicode61 categories 'L* N* Mn'",
    'be': "unicode61 categories 'L* N* Mn'",
    'cs': 'unicode61 remove_diacritics 2',
    'zh': 'trigram',
    'ja': 'trigram',
  };

  static const String _defaultTokenize = 'unicode61 remove_diacritics 2';
  static const Set<String> _trigramLangs = {'zh', 'ja'};

  static final RegExp _pbRe = RegExp(r'<pb[^>]*/>');
  static final RegExp _pagebreakSpanRe = RegExp(
    r'<span class="pagebreak"[^>]*>.*?</span>',
    dotAll: true,
  );
  static final RegExp _paranumSpanRe = RegExp(
    r'<strong class="paranum"[^>]*>.*?</strong>',
    dotAll: true,
  );
  static final RegExp _anyTagRe = RegExp(r'<[^>]+>');
  static final RegExp _paliInvisibleRe = RegExp(r'[\u200B-\u200D\uFEFF\u00A0]');
  static final RegExp _transInvisibleRe = RegExp(r'[\u200B\uFEFF\u00A0]');
  static final RegExp _multiWsRe = RegExp(r'\s+');
  static final RegExp _xmlParaRe = RegExp(
    r'<(?:p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>(.*?)</(?:p|head|trailer)>',
    dotAll: true,
  );

  static String tokenizeClauseForLanguage(String langCode) =>
      _langTokenize[langCode.toLowerCase()] ?? _defaultTokenize;

  static bool isTrigramLanguage(String langCode) =>
      _trigramLangs.contains(langCode.toLowerCase());

  /// Sanitizes Pāḷi paragraph XML/HTML text identically to `generate_fts.py`.
  static String cleanParagraphText(String raw) {
    if (raw.isEmpty) return '';
    var text = raw.replaceAll(_pbRe, ' ');
    text = text.replaceAll(_pagebreakSpanRe, ' ');
    text = text.replaceAll(_paranumSpanRe, ' ');
    // Retain inner text inside <note>...</note> while stripping markup tags.
    text = text.replaceAll(_anyTagRe, ' ');
    text = text.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'ṃ');
    text = text.replaceAll(_paliInvisibleRe, ' ');
    return text.replaceAll(_multiWsRe, ' ').trim();
  }

  /// Sanitizes translation HTML text identically to `build_translation_fts.py`.
  static String cleanTranslationText(String raw) {
    if (raw.isEmpty) return '';
    var text = raw.replaceAll(_anyTagRe, ' ');
    text = _decodeHtmlEntities(text);
    text = text.replaceAll(_transInvisibleRe, ' ');
    return text.replaceAll(_multiWsRe, ' ').trim();
  }

  static String _decodeHtmlEntities(String input) {
    if (!input.contains('&')) return input;
    var out = input
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&apos;', "'")
        .replaceAll('&nbsp;', ' ');
    out = out.replaceAllMapped(RegExp(r'&#(\d+);'), (m) {
      final code = int.tryParse(m.group(1)!);
      return code != null ? String.fromCharCode(code) : m.group(0)!;
    });
    out = out.replaceAllMapped(RegExp(r'&#x([0-9a-fA-F]+);'), (m) {
      final code = int.tryParse(m.group(1)!, radix: 16);
      return code != null ? String.fromCharCode(code) : m.group(0)!;
    });
    return out;
  }

  /// Builds `fts_tipitaka.db` inside a background isolate from `tipitaka.db`
  /// (using `canon_paragraphs`, or `books_xml.db` / `chapters` as fallback).
  Future<FtsBuildResult> buildPaliFtsIndex({
    required String dbDirPath,
    bool force = false,
    void Function(FtsBuildProgress progress)? onProgress,
  }) {
    if (onProgress == null) {
      return Isolate.run(
        () => _buildPaliFtsSync(
          dbDirPath: dbDirPath,
          force: force,
          onProgress: (_) {},
        ),
      );
    }
    return _runFtsIsolate(
      dbDirPath: dbDirPath,
      force: force,
      onProgress: onProgress,
    );
  }

  /// Builds `fts_translation_<langCode>.db` inside a background isolate from
  /// `translation_<langCode>.db` and `tipitaka.db` metadata.
  Future<FtsBuildResult> buildTranslationFtsIndex({
    required String dbDirPath,
    required String langCode,
    bool force = false,
    void Function(FtsBuildProgress progress)? onProgress,
  }) {
    final normalized = langCode.trim().toLowerCase();
    if (onProgress == null) {
      return Isolate.run(
        () => _buildTranslationFtsSync(
          dbDirPath: dbDirPath,
          langCode: normalized,
          force: force,
          onProgress: (_) {},
        ),
      );
    }
    return _runFtsIsolate(
      dbDirPath: dbDirPath,
      langCode: normalized,
      force: force,
      onProgress: onProgress,
    );
  }

  static Future<FtsBuildResult> _runFtsIsolate({
    required String dbDirPath,
    required bool force,
    String? langCode,
    required void Function(FtsBuildProgress progress) onProgress,
  }) async {
    final receivePort = ReceivePort();
    final completer = Completer<FtsBuildResult>();
    late final StreamSubscription<dynamic> sub;
    sub = receivePort.listen((message) {
      if (message is FtsBuildProgress) {
        onProgress(message);
      } else if (message is _IsolateResult<FtsBuildResult>) {
        if (!completer.isCompleted) {
          completer.complete(message.value);
        }
      } else if (message is _IsolateError) {
        if (!completer.isCompleted) {
          completer.completeError(
            message.error,
            StackTrace.fromString(message.stackTrace),
          );
        }
      }
    });

    try {
      await Isolate.spawn<
        ({SendPort port, String dbDirPath, bool force, String? langCode})
      >(_ftsBuildIsolateMain, (
        port: receivePort.sendPort,
        dbDirPath: dbDirPath,
        force: force,
        langCode: langCode,
      ));
      return await completer.future;
    } finally {
      await sub.cancel();
      receivePort.close();
    }
  }

  static void _ftsBuildIsolateMain(
    ({SendPort port, String dbDirPath, bool force, String? langCode}) args,
  ) {
    try {
      void emit(FtsBuildProgress progress) => args.port.send(progress);
      final value = args.langCode == null
          ? _buildPaliFtsSync(
              dbDirPath: args.dbDirPath,
              force: args.force,
              onProgress: emit,
            )
          : _buildTranslationFtsSync(
              dbDirPath: args.dbDirPath,
              langCode: args.langCode!,
              force: args.force,
              onProgress: emit,
            );
      args.port.send(_IsolateResult<FtsBuildResult>(value));
    } catch (e, st) {
      args.port.send(_IsolateError(e, st.toString()));
    }
  }

  static FtsBuildResult _buildPaliFtsSync({
    required String dbDirPath,
    required bool force,
    required void Function(FtsBuildProgress progress) onProgress,
  }) {
    const outName = 'fts_tipitaka.db';
    final corePath = p.join(dbDirPath, 'tipitaka.db');
    if (!File(corePath).existsSync()) {
      throw StateError('Cannot build Pāḷi FTS index: tipitaka.db is missing.');
    }

    final dstPath = p.join(dbDirPath, outName);
    if (!force) {
      final existingCount = _existingFtsRowCount(dstPath);
      if (existingCount != null && existingCount > 0) {
        onProgress(
          const FtsBuildProgress(
            filename: outName,
            stage: FtsBuildStage.completed,
            progress: 1.0,
            detail: 'Search index ready',
          ),
        );
        return FtsBuildResult(
          filename: outName,
          indexedRows: existingCount,
          skipped: true,
        );
      }
    }

    onProgress(
      const FtsBuildProgress(
        filename: outName,
        stage: FtsBuildStage.preparing,
        progress: 0.02,
        detail: 'Reading canon structure...',
      ),
    );

    final tmpPath = '$dstPath.tmp';
    _cleanupTempFiles(tmpPath);

    final coreDb = sqlite3.open(corePath, mode: OpenMode.readOnly);
    final dstDb = sqlite3.open(tmpPath);
    try {
      final booksMeta = _loadBooksMeta(coreDb);

      dstDb.execute('PRAGMA journal_mode = MEMORY;');
      dstDb.execute('PRAGMA temp_store = MEMORY;');
      dstDb.execute('PRAGMA synchronous = OFF;');
      dstDb.execute('PRAGMA cache_size = -64000;');
      dstDb.execute('''
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
      ''');

      var totalIndexed = 0;
      final insertStmt = dstDb.prepare('''
        INSERT INTO paragraphs_fts (
          book_code, book_title, nikaya, para_num, para_index, para_rend, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      ''');

      try {
        final hasCanon = _tableHasRows(coreDb, 'canon_paragraphs');
        if (hasCanon) {
          totalIndexed = _populateFromCanonParagraphs(
            coreDb: coreDb,
            dstDb: dstDb,
            insertStmt: insertStmt,
            booksMeta: booksMeta,
            outName: outName,
            onProgress: onProgress,
          );
        } else {
          final booksXmlPath = p.join(dbDirPath, 'books_xml.db');
          if (File(booksXmlPath).existsSync()) {
            totalIndexed = _populateFromBooksXml(
              booksXmlPath: booksXmlPath,
              dstDb: dstDb,
              insertStmt: insertStmt,
              booksMeta: booksMeta,
              outName: outName,
              onProgress: onProgress,
            );
          }
          if (totalIndexed == 0 && _tableExists(coreDb, 'chapters')) {
            totalIndexed = _populateFromChapters(
              coreDb: coreDb,
              dstDb: dstDb,
              insertStmt: insertStmt,
              booksMeta: booksMeta,
              outName: outName,
              onProgress: onProgress,
            );
          }
        }
      } finally {
        insertStmt.close();
      }

      onProgress(
        FtsBuildProgress(
          filename: outName,
          stage: FtsBuildStage.optimizing,
          processedRows: totalIndexed,
          totalRows: totalIndexed,
          progress: 0.87,
          detail: 'Optimizing FTS5 search index...',
        ),
      );
      dstDb.execute("INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');");

      onProgress(
        FtsBuildProgress(
          filename: outName,
          stage: FtsBuildStage.compacting,
          processedRows: totalIndexed,
          totalRows: totalIndexed,
          progress: 0.94,
          detail: 'Finalizing search database...',
        ),
      );
      dstDb.execute('VACUUM;');
    } finally {
      coreDb.close();
      dstDb.close();
    }

    _atomicReplace(tmpPath, dstPath);
    final finalCount = _existingFtsRowCount(dstPath) ?? 0;
    onProgress(
      FtsBuildProgress(
        filename: outName,
        stage: FtsBuildStage.completed,
        processedRows: finalCount,
        totalRows: finalCount,
        progress: 1.0,
        detail: 'Search index ready',
      ),
    );
    return FtsBuildResult(filename: outName, indexedRows: finalCount);
  }

  static int _populateFromCanonParagraphs({
    required Database coreDb,
    required Database dstDb,
    required PreparedStatement insertStmt,
    required Map<String, ({String title, String nikaya})> booksMeta,
    required String outName,
    required void Function(FtsBuildProgress progress) onProgress,
  }) {
    const batchSize = 5000;
    var indexed = 0;
    var scanned = 0;
    var inTx = 0;
    final totalRows = _countQuery(coreDb, 'SELECT count(*) AS c FROM canon_paragraphs');
    final emitter = _FtsProgressEmitter(
      filename: outName,
      totalRows: totalRows,
      onProgress: onProgress,
    );
    emitter.emitInitial();

    final selectStmt = coreDb.prepare(
      'SELECT book_code, para_index, para_num, rend, pali_text '
      'FROM canon_paragraphs ORDER BY book_code, para_index',
    );
    try {
      final cursor = selectStmt.selectCursor();
      dstDb.execute('BEGIN;');
      try {
        while (cursor.moveNext()) {
          scanned++;
          final r = cursor.current;
          final code = (r['book_code'] ?? '').toString();
          final meta = booksMeta[code];
          final clean = cleanParagraphText((r['pali_text'] ?? '').toString());
          if (clean.isEmpty) {
            emitter.maybeEmit(scanned);
            continue;
          }
          final pIdx = (r['para_index'] as num?)?.toInt() ?? 0;
          final pNum = (r['para_num'] ?? '').toString();
          final rend = (r['rend'] ?? 'bodytext').toString();
          insertStmt.execute([
            code,
            meta?.title ?? code,
            meta?.nikaya ?? '',
            pNum,
            pIdx,
            rend,
            clean,
          ]);
          indexed++;
          inTx++;
          emitter.maybeEmit(scanned);
          if (inTx >= batchSize) {
            dstDb.execute('COMMIT;');
            dstDb.execute('BEGIN;');
            inTx = 0;
          }
        }
        dstDb.execute('COMMIT;');
      } catch (_) {
        dstDb.execute('ROLLBACK;');
        rethrow;
      }
    } finally {
      selectStmt.close();
    }
    return indexed;
  }

  static int _populateFromBooksXml({
    required String booksXmlPath,
    required Database dstDb,
    required PreparedStatement insertStmt,
    required Map<String, ({String title, String nikaya})> booksMeta,
    required String outName,
    required void Function(FtsBuildProgress progress) onProgress,
  }) {
    final xmlDb = sqlite3.open(booksXmlPath, mode: OpenMode.readOnly);
    var indexed = 0;
    try {
      if (!_tableExists(xmlDb, 'books_xml')) return 0;
      final rows = xmlDb.select(
        'SELECT book_code, xml_content FROM books_xml ORDER BY book_code',
      );
      final emitter = _FtsProgressEmitter(
        filename: outName,
        totalRows: rows.length,
        detail: 'Indexing books...',
        onProgress: onProgress,
      );
      emitter.emitInitial();
      var booksDone = 0;
      dstDb.execute('BEGIN;');
      try {
        for (final r in rows) {
          final code = (r['book_code'] ?? '').toString();
          final xml = (r['xml_content'] ?? '').toString();
          final meta = booksMeta[code];
          var pIdx = 0;
          for (final m in _xmlParaRe.allMatches(xml)) {
            final rend = m.group(1) ?? 'bodytext';
            final pNum = m.group(2) ?? '';
            final clean = cleanParagraphText(m.group(3) ?? '');
            if (clean.isNotEmpty) {
              insertStmt.execute([
                code,
                meta?.title ?? code,
                meta?.nikaya ?? '',
                pNum,
                pIdx,
                rend,
                clean,
              ]);
              indexed++;
            }
            pIdx++;
          }
          booksDone++;
          emitter.maybeEmit(booksDone, force: booksDone == rows.length);
        }
        dstDb.execute('COMMIT;');
      } catch (_) {
        dstDb.execute('ROLLBACK;');
        rethrow;
      }
    } finally {
      xmlDb.close();
    }
    return indexed;
  }

  static int _populateFromChapters({
    required Database coreDb,
    required Database dstDb,
    required PreparedStatement insertStmt,
    required Map<String, ({String title, String nikaya})> booksMeta,
    required String outName,
    required void Function(FtsBuildProgress progress) onProgress,
  }) {
    final rows = coreDb.select(
      'SELECT book_code, para_index, html FROM chapters ORDER BY book_code, chapter_index',
    );
    final emitter = _FtsProgressEmitter(
      filename: outName,
      totalRows: rows.length,
      detail: 'Indexing chapters...',
      onProgress: onProgress,
    );
    emitter.emitInitial();
    var indexed = 0;
    var scanned = 0;
    dstDb.execute('BEGIN;');
    try {
      for (final r in rows) {
        scanned++;
        final code = (r['book_code'] ?? '').toString();
        final meta = booksMeta[code];
        final clean = cleanParagraphText((r['html'] ?? '').toString());
        if (clean.isEmpty) {
          emitter.maybeEmit(scanned);
          continue;
        }
        insertStmt.execute([
          code,
          meta?.title ?? code,
          meta?.nikaya ?? '',
          '',
          (r['para_index'] as num?)?.toInt() ?? 0,
          'bodytext',
          clean,
        ]);
        indexed++;
        emitter.maybeEmit(scanned);
      }
      dstDb.execute('COMMIT;');
    } catch (_) {
      dstDb.execute('ROLLBACK;');
      rethrow;
    }
    return indexed;
  }

  static FtsBuildResult _buildTranslationFtsSync({
    required String dbDirPath,
    required String langCode,
    required bool force,
    required void Function(FtsBuildProgress progress) onProgress,
  }) {
    final srcName = 'translation_$langCode.db';
    final dstName = 'fts_translation_$langCode.db';
    final srcPath = p.join(dbDirPath, srcName);
    final dstPath = p.join(dbDirPath, dstName);

    if (!File(srcPath).existsSync()) {
      throw StateError('Cannot build translation FTS index: $srcName missing.');
    }

    if (!force) {
      final existingCount = _existingFtsRowCount(dstPath);
      if (existingCount != null && existingCount > 0) {
        onProgress(
          FtsBuildProgress(
            filename: dstName,
            stage: FtsBuildStage.completed,
            progress: 1.0,
            detail: 'Search index ready',
          ),
        );
        return FtsBuildResult(
          filename: dstName,
          indexedRows: existingCount,
          skipped: true,
        );
      }
    }

    onProgress(
      FtsBuildProgress(
        filename: dstName,
        stage: FtsBuildStage.preparing,
        progress: 0.02,
        detail: 'Reading translation entries...',
      ),
    );

    final tmpPath = '$dstPath.tmp';
    _cleanupTempFiles(tmpPath);

    final srcDb = sqlite3.open(srcPath, mode: OpenMode.readOnly);
    final corePath = p.join(dbDirPath, 'tipitaka.db');
    final coreDb = File(corePath).existsSync()
        ? sqlite3.open(corePath, mode: OpenMode.readOnly)
        : null;
    final dstDb = sqlite3.open(tmpPath);

    try {
      final booksMeta = coreDb != null
          ? _loadBooksMeta(coreDb)
          : <String, ({String title, String nikaya})>{};
      final rendMap = _loadRendMap(dbDirPath, coreDb);

      final tokenizeClause = tokenizeClauseForLanguage(langCode);
      final escapedTokenize = tokenizeClause.replaceAll("'", "''");
      final prefixClause = isTrigramLanguage(langCode) ? '' : ',\n        prefix = 3';

      dstDb.execute('PRAGMA journal_mode = MEMORY;');
      dstDb.execute('PRAGMA temp_store = MEMORY;');
      dstDb.execute('PRAGMA synchronous = OFF;');
      dstDb.execute('PRAGMA cache_size = -64000;');

      dstDb.execute(
        'CREATE TABLE IF NOT EXISTS translation_meta (key TEXT PRIMARY KEY, value TEXT);',
      );
      if (_tableExists(srcDb, 'translation_meta')) {
        final metaRows = srcDb.select('SELECT key, value FROM translation_meta');
        final metaStmt = dstDb.prepare(
          'INSERT OR REPLACE INTO translation_meta (key, value) VALUES (?, ?);',
        );
        try {
          for (final r in metaRows) {
            metaStmt.execute([r['key'], r['value']]);
          }
        } finally {
          metaStmt.close();
        }
      }

      dstDb.execute('''
        CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
          book_code,
          book_title,
          nikaya,
          para_num,
          para_index UNINDEXED,
          para_rend,
          content,
          tokenize = '$escapedTokenize'$prefixClause
        );
      ''');

      var inserted = 0;
      var scanned = 0;
      const batchSize = 5000;
      var inTx = 0;
      final totalRows = _countQuery(
        srcDb,
        'SELECT count(*) AS c FROM paragraph_translations '
        'WHERE translation IS NOT NULL AND length(trim(translation)) > 0',
      );
      final emitter = _FtsProgressEmitter(
        filename: dstName,
        totalRows: totalRows,
        onProgress: onProgress,
      );
      emitter.emitInitial();

      final insertStmt = dstDb.prepare('''
        INSERT INTO paragraphs_fts (
          book_code, book_title, nikaya, para_num, para_index, para_rend, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      ''');
      final selectStmt = srcDb.prepare(
        'SELECT book_code, para_index, para_num, translation '
        'FROM paragraph_translations '
        'WHERE translation IS NOT NULL AND length(trim(translation)) > 0 '
        'ORDER BY book_code, para_index',
      );

      try {
        final cursor = selectStmt.selectCursor();
        dstDb.execute('BEGIN;');
        try {
          while (cursor.moveNext()) {
            scanned++;
            final r = cursor.current;
            final code = (r['book_code'] ?? '').toString();
            final pIdx = (r['para_index'] as num?)?.toInt() ?? 0;
            final pNum = (r['para_num'] ?? '').toString();
            final clean = cleanTranslationText(
              (r['translation'] ?? '').toString(),
            );
            if (clean.isEmpty) {
              emitter.maybeEmit(scanned);
              continue;
            }
            final meta = booksMeta[code];
            final rend = rendMap['$code:$pIdx'] ?? 'bodytext';
            insertStmt.execute([
              code,
              meta?.title ?? code,
              meta?.nikaya ?? '',
              pNum,
              pIdx,
              rend,
              clean,
            ]);
            inserted++;
            inTx++;
            emitter.maybeEmit(scanned);
            if (inTx >= batchSize) {
              dstDb.execute('COMMIT;');
              dstDb.execute('BEGIN;');
              inTx = 0;
            }
          }
          dstDb.execute('COMMIT;');
        } catch (_) {
          dstDb.execute('ROLLBACK;');
          rethrow;
        }
      } finally {
        selectStmt.close();
        insertStmt.close();
      }

      dstDb.execute(
        "INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_built_at', datetime('now'));",
      );
      dstDb.execute(
        "INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_indexed_rows', ?);",
        [inserted.toString()],
      );
      dstDb.execute(
        "INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_tokenize', ?);",
        [tokenizeClause],
      );

      onProgress(
        FtsBuildProgress(
          filename: dstName,
          stage: FtsBuildStage.optimizing,
          processedRows: inserted,
          totalRows: totalRows > 0 ? totalRows : inserted,
          progress: 0.87,
          detail: 'Optimizing FTS5 search index...',
        ),
      );
      dstDb.execute("INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');");

      onProgress(
        FtsBuildProgress(
          filename: dstName,
          stage: FtsBuildStage.compacting,
          processedRows: inserted,
          totalRows: totalRows > 0 ? totalRows : inserted,
          progress: 0.94,
          detail: 'Finalizing search database...',
        ),
      );
      dstDb.execute('VACUUM;');
    } finally {
      srcDb.close();
      coreDb?.close();
      dstDb.close();
    }

    _atomicReplace(tmpPath, dstPath);
    final finalCount = _existingFtsRowCount(dstPath) ?? 0;
    onProgress(
      FtsBuildProgress(
        filename: dstName,
        stage: FtsBuildStage.completed,
        processedRows: finalCount,
        totalRows: finalCount,
        progress: 1.0,
        detail: 'Search index ready',
      ),
    );
    return FtsBuildResult(filename: dstName, indexedRows: finalCount);
  }

  static Map<String, ({String title, String nikaya})> _loadBooksMeta(
    Database coreDb,
  ) {
    final out = <String, ({String title, String nikaya})>{};
    if (!_tableExists(coreDb, 'books')) return out;
    for (final r in coreDb.select('SELECT code, title, nikaya FROM books')) {
      final code = (r['code'] ?? '').toString();
      out[code] = (
        title: (r['title'] ?? code).toString(),
        nikaya: (r['nikaya'] ?? '').toString(),
      );
    }
    return out;
  }

  static Map<String, String> _loadRendMap(String dbDirPath, Database? coreDb) {
    final out = <String, String>{};
    if (coreDb != null && _tableExists(coreDb, 'canon_paragraphs')) {
      for (final r in coreDb.select(
        'SELECT book_code, para_index, rend FROM canon_paragraphs',
      )) {
        final rend = r['rend']?.toString();
        if (rend != null && rend.isNotEmpty) {
          out['${r['book_code']}:${r['para_index']}'] = rend;
        }
      }
      if (out.isNotEmpty) return out;
    }
    final paliFtsPath = p.join(dbDirPath, 'fts_tipitaka.db');
    if (File(paliFtsPath).existsSync()) {
      final db = sqlite3.open(paliFtsPath, mode: OpenMode.readOnly);
      try {
        if (_tableExists(db, 'paragraphs_fts')) {
          for (final r in db.select(
            'SELECT book_code, para_index, para_rend FROM paragraphs_fts',
          )) {
            final rend = r['para_rend']?.toString();
            if (rend != null && rend.isNotEmpty) {
              out['${r['book_code']}:${r['para_index']}'] = rend;
            }
          }
        }
      } finally {
        db.close();
      }
    }
    return out;
  }

  static int? _existingFtsRowCount(String path) {
    if (!File(path).existsSync()) return null;
    try {
      final db = sqlite3.open(path, mode: OpenMode.readOnly);
      try {
        if (!_tableExists(db, 'paragraphs_fts')) return null;
        final rows = db.select('SELECT count(*) AS c FROM paragraphs_fts');
        if (rows.isEmpty) return 0;
        return (rows.first['c'] as num).toInt();
      } finally {
        db.close();
      }
    } catch (_) {
      return null;
    }
  }

  static bool _tableExists(Database db, String name) {
    final rows = db.select(
      "SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') LIMIT 1",
      [name],
    );
    return rows.isNotEmpty;
  }

  static bool _tableHasRows(Database db, String name) {
    if (!_tableExists(db, name)) return false;
    final rows = db.select('SELECT 1 FROM "$name" LIMIT 1');
    return rows.isNotEmpty;
  }

  static void _cleanupTempFiles(String path) {
    for (final s in ['', '-wal', '-shm']) {
      final f = File('$path$s');
      if (f.existsSync()) {
        try {
          f.deleteSync();
        } catch (_) {}
      }
    }
  }

  static int _countQuery(Database db, String sql) {
    final rows = db.select(sql);
    if (rows.isEmpty) return 0;
    return (rows.first['c'] as num?)?.toInt() ?? 0;
  }

  static void _atomicReplace(String tmpPath, String dstPath) {
    _cleanupTempFiles(dstPath);
    File(tmpPath).renameSync(dstPath);
    for (final s in ['-wal', '-shm']) {
      final f = File('$dstPath$s');
      if (f.existsSync()) {
        try {
          f.deleteSync();
        } catch (_) {}
      }
    }
  }
}

class _FtsProgressEmitter {
  final String filename;
  final int totalRows;
  final String detail;
  final void Function(FtsBuildProgress progress) onProgress;
  int _lastPercent = -1;
  int _lastRow = 0;

  _FtsProgressEmitter({
    required this.filename,
    required this.totalRows,
    this.detail = 'Indexing passages...',
    required this.onProgress,
  });

  void emitInitial() {
    onProgress(
      FtsBuildProgress(
        filename: filename,
        stage: FtsBuildStage.indexing,
        processedRows: 0,
        totalRows: totalRows,
        progress: 0.04,
        detail: detail,
      ),
    );
  }

  void maybeEmit(int processed, {bool force = false}) {
    final clamped = totalRows > 0 ? processed.clamp(0, totalRows) : processed;
    final ratio = totalRows > 0 ? (clamped / totalRows).clamp(0.0, 1.0) : 0.0;
    final pct = (ratio * 100).floor();
    if (!force && pct == _lastPercent && (clamped - _lastRow) < 2000) {
      return;
    }
    _lastPercent = pct;
    _lastRow = clamped;
    onProgress(
      FtsBuildProgress(
        filename: filename,
        stage: FtsBuildStage.indexing,
        processedRows: clamped,
        totalRows: totalRows,
        progress: 0.04 + (0.80 * ratio),
        detail: detail,
      ),
    );
  }
}

class _IsolateResult<T> {
  final T value;
  const _IsolateResult(this.value);
}

class _IsolateError {
  final Object error;
  final String stackTrace;
  const _IsolateError(this.error, this.stackTrace);
}
