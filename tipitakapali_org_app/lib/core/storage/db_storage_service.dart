import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

class InstalledDbInfo {
  final String filename;
  final String path;
  final int sizeBytes;
  final DateTime modifiedAt;
  final bool validSqlite;
  final List<String> missingTables;
  final String? verificationError;

  const InstalledDbInfo({
    required this.filename,
    required this.path,
    required this.sizeBytes,
    required this.modifiedAt,
    required this.validSqlite,
    this.missingTables = const [],
    this.verificationError,
  });

  bool get isHealthy => validSqlite && missingTables.isEmpty && verificationError == null;
}

class DbVerificationResult {
  final bool valid;
  final int sizeBytes;
  final String sha256Hex;
  final List<String> tables;
  final List<String> missingTables;
  final String? error;

  const DbVerificationResult({
    required this.valid,
    required this.sizeBytes,
    required this.sha256Hex,
    this.tables = const [],
    this.missingTables = const [],
    this.error,
  });
}

class DbStorageService {
  final Directory? overrideDirectory;

  DbStorageService({this.overrideDirectory});

  Future<Directory> getDatabaseDirectory() async {
    if (overrideDirectory != null) {
      if (!overrideDirectory!.existsSync()) {
        await overrideDirectory!.create(recursive: true);
      }
      return overrideDirectory!;
    }

    final envPath = Platform.environment['TIPITAKA_DB_PATH']?.trim();
    if (envPath != null && envPath.isNotEmpty) {
      final dir = Directory(envPath);
      if (!dir.existsSync()) {
        await dir.create(recursive: true);
      }
      return dir;
    }

    final baseDir = (Platform.isAndroid || Platform.isIOS)
        ? await getApplicationDocumentsDirectory()
        : await getApplicationSupportDirectory();
    final dbDir = Directory(p.join(baseDir.path, 'databases'));
    if (!dbDir.existsSync()) {
      await dbDir.create(recursive: true);
    }
    return dbDir;
  }

  Future<String> installedDbPath(String filename) async {
    final dir = await getDatabaseDirectory();
    return p.join(dir.path, p.basename(filename));
  }

  /// Deterministic partial zip filename keyed by a 12-char SHA-256 prefix of the
  /// expected URL/checksum so stale partial transfers never resume across versions.
  Future<File> partialZipFile(String filename, String digestSeed) async {
    final dir = await getDatabaseDirectory();
    final seedHash = sha256.convert(utf8.encode(digestSeed)).toString();
    final prefix12 = seedHash.substring(0, 12);
    final safeName = p.basename(filename);
    return File(p.join(dir.path, '$safeName.$prefix12.zip.part'));
  }

  Future<File> stagingDbFile(String filename) async {
    final dir = await getDatabaseDirectory();
    final safeName = p.basename(filename);
    return File(p.join(dir.path, '$safeName.staging.tmp'));
  }

  Future<void> cleanWalFiles(String dbPath) async {
    for (final suffix in const ['-wal', '-shm', '-journal']) {
      final sidecar = File('$dbPath$suffix');
      if (sidecar.existsSync()) {
        try {
          sidecar.deleteSync();
        } catch (_) {}
      }
    }
  }

  /// Removes abandoned `.staging.tmp` / FTS `.db.tmp` artifacts left by a
  /// process kill while keeping `*.zip.part` files intact for HTTP Range resume.
  Future<void> cleanupInterruptedTempFiles() async {
    final dir = await getDatabaseDirectory();
    if (!dir.existsSync()) return;
    for (final entity in dir.listSync(followLinks: false)) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      final isStagingTmp = name.contains('.staging.tmp');
      final isFtsTmp = name.startsWith('fts_') && name.contains('.db.tmp');
      if (!isStagingTmp && !isFtsTmp) continue;
      try {
        entity.deleteSync();
      } catch (_) {}
    }
  }

  /// Fast startup validation that [dbPath] opens as SQLite, has tables, and
  /// includes every table in [requiredTables].
  bool hasValidSqliteSchema(
    String dbPath, {
    List<String> requiredTables = const [],
  }) {
    final file = File(dbPath);
    if (!file.existsSync() || file.lengthSync() <= 0) return false;
    Database? db;
    try {
      db = sqlite3.open(dbPath, mode: OpenMode.readOnly);
      final rows = db.select(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
      );
      if (rows.isEmpty) return false;
      final tableSet = rows
          .map((r) => (r['name'] ?? '').toString().toLowerCase())
          .where((n) => n.isNotEmpty)
          .toSet();
      for (final req in requiredTables) {
        if (!tableSet.contains(req.toLowerCase())) {
          return false;
        }
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      db?.close();
    }
  }

  /// Verifies that [dbPath] is a readable SQLite FTS5 DB whose
  /// `paragraphs_fts` virtual table contains at least one indexed row.
  bool isPopulatedFtsDb(String dbPath) {
    final file = File(dbPath);
    if (!file.existsSync() || file.lengthSync() <= 0) return false;
    Database? db;
    try {
      db = sqlite3.open(dbPath, mode: OpenMode.readOnly);
      final tbl = db.select(
        "SELECT 1 FROM sqlite_master WHERE name = 'paragraphs_fts' LIMIT 1",
      );
      if (tbl.isEmpty) return false;
      final rows = db.select('SELECT 1 FROM paragraphs_fts LIMIT 1');
      return rows.isNotEmpty;
    } catch (_) {
      return false;
    } finally {
      db?.close();
    }
  }

  Future<void> deleteDatabase(String filename) async {
    final dbPath = await installedDbPath(filename);
    await cleanWalFiles(dbPath);
    final file = File(dbPath);
    if (file.existsSync()) {
      file.deleteSync();
    }
  }

  Future<Map<String, InstalledDbInfo>> listInstalledDatabases() async {
    final dir = await getDatabaseDirectory();
    if (!dir.existsSync()) return const {};

    final result = <String, InstalledDbInfo>{};
    for (final entity in dir.listSync(followLinks: false)) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      if (!name.endsWith('.db')) continue;
      final stat = entity.statSync();
      if (stat.size <= 0) continue;
      result[name] = InstalledDbInfo(
        filename: name,
        path: entity.path,
        sizeBytes: stat.size,
        modifiedAt: stat.modified,
        validSqlite: true,
      );
    }
    return result;
  }

  static Future<String> computeFileSha256(String filePath) async {
    final digest = await sha256.bind(File(filePath).openRead()).first;
    return digest.toString().toLowerCase();
  }

  Future<DbVerificationResult> verifyAndPrepareSqliteDb(
    String dbPath, {
    List<String> requiredTables = const [],
    int? expectedBytes,
    String? expectedSha256,
    bool computeHashWhenUnconstrained = false,
  }) async {
    final file = File(dbPath);
    if (!file.existsSync()) {
      return const DbVerificationResult(
        valid: false,
        sizeBytes: 0,
        sha256Hex: '',
        error: 'Database file does not exist.',
      );
    }

    final sizeBytes = await file.length();
    if (sizeBytes <= 0) {
      return const DbVerificationResult(
        valid: false,
        sizeBytes: 0,
        sha256Hex: '',
        error: 'Database file is empty.',
      );
    }

    if (expectedBytes != null && expectedBytes > 0 && sizeBytes != expectedBytes) {
      return DbVerificationResult(
        valid: false,
        sizeBytes: sizeBytes,
        sha256Hex: '',
        error: 'Size mismatch: expected $expectedBytes bytes, got $sizeBytes bytes.',
      );
    }

    var actualSha = '';
    final normalizedExpected = expectedSha256?.trim().toLowerCase();
    if ((normalizedExpected != null && normalizedExpected.isNotEmpty) ||
        computeHashWhenUnconstrained) {
      actualSha = await computeFileSha256(dbPath);
      if (normalizedExpected != null &&
          normalizedExpected.isNotEmpty &&
          actualSha != normalizedExpected) {
        return DbVerificationResult(
          valid: false,
          sizeBytes: sizeBytes,
          sha256Hex: actualSha,
          error: 'SHA-256 mismatch: expected $normalizedExpected, got $actualSha.',
        );
      }
    }

    Database? db;
    try {
      db = sqlite3.open(dbPath);
      final quickCheck = db.select('PRAGMA quick_check(1)');
      if (quickCheck.isEmpty || quickCheck.first.values.first?.toString() != 'ok') {
        return DbVerificationResult(
          valid: false,
          sizeBytes: sizeBytes,
          sha256Hex: actualSha,
          error: 'SQLite integrity check failed.',
        );
      }

      // Match epitaka_app's DPD safeguard: force DELETE journal mode before swap
      // so stale WAL/SHM files never invalidate a newly replaced database.
      try {
        db.execute('PRAGMA journal_mode=DELETE');
      } catch (_) {
        // Read-only or FTS DBs may keep default journal mode safely.
      }

      final rows = db.select(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
      );
      final tableNames = rows
          .map((row) => row['name']?.toString() ?? '')
          .where((name) => name.isNotEmpty)
          .toList(growable: false);
      final tableSet = tableNames.map((e) => e.toLowerCase()).toSet();
      final missing = requiredTables
          .where((req) => !tableSet.contains(req.toLowerCase()))
          .toList(growable: false);

      return DbVerificationResult(
        valid: missing.isEmpty,
        sizeBytes: sizeBytes,
        sha256Hex: actualSha,
        tables: tableNames,
        missingTables: missing,
        error: missing.isEmpty
            ? null
            : 'Missing expected tables: ${missing.join(', ')}',
      );
    } catch (e) {
      return DbVerificationResult(
        valid: false,
        sizeBytes: sizeBytes,
        sha256Hex: actualSha,
        error: 'SQLite open error: $e',
      );
    } finally {
      db?.close();
    }
  }

  /// Atomically swaps [stagingPath] into [destinationPath], cleaning WAL/SHM
  /// sidecars and falling back to copy+delete across filesystems.
  Future<void> atomicReplaceFile(String stagingPath, String destinationPath) async {
    final destFile = File(destinationPath);
    if (!destFile.parent.existsSync()) {
      await destFile.parent.create(recursive: true);
    }
    await cleanWalFiles(destinationPath);

    final stagingFile = File(stagingPath);
    try {
      if (destFile.existsSync()) {
        await destFile.delete();
      }
      await stagingFile.rename(destinationPath);
    } on FileSystemException {
      final copied = await stagingFile.copy(destinationPath);
      if (copied.existsSync()) {
        await stagingFile.delete();
      }
    }
    await cleanWalFiles(destinationPath);
  }
}
