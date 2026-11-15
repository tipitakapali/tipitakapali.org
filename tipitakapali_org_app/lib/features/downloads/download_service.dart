import 'dart:async';
import 'dart:io';
import 'dart:isolate';

import 'package:archive/archive_io.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../../core/models/db_manifest.dart';
import '../../core/storage/db_storage_service.dart';

enum TransferPhase {
  queued,
  downloading,
  verifyingZip,
  extracting,
  verifyingDb,
  completed,
  cancelled,
  failed,
}

class DownloadProgress {
  final String assetId;
  final String filename;
  final TransferPhase phase;
  final int bytesReceived;
  final int totalBytes;
  final double bytesPerSecond;
  final String? message;
  final String? error;

  const DownloadProgress({
    required this.assetId,
    required this.filename,
    required this.phase,
    this.bytesReceived = 0,
    this.totalBytes = 0,
    this.bytesPerSecond = 0,
    this.message,
    this.error,
  });

  double? get fraction {
    if (phase == TransferPhase.completed) return 1.0;
    if (totalBytes <= 0) return null;
    return (bytesReceived / totalBytes).clamp(0.0, 1.0);
  }

  bool get isActive =>
      phase == TransferPhase.queued ||
      phase == TransferPhase.downloading ||
      phase == TransferPhase.verifyingZip ||
      phase == TransferPhase.extracting ||
      phase == TransferPhase.verifyingDb;
}

class DownloadCancellationToken {
  bool _cancelled = false;
  final List<void Function()> _listeners = [];

  bool get isCancelled => _cancelled;

  void addListener(void Function() listener) {
    if (_cancelled) {
      listener();
    } else {
      _listeners.add(listener);
    }
  }

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final cb in List<void Function()>.from(_listeners)) {
      cb();
    }
    _listeners.clear();
  }
}

class DownloadCancelledException implements Exception {
  const DownloadCancelledException();
  @override
  String toString() => 'Download cancelled';
}

class DownloadService {
  static const Duration stallTimeout = Duration(seconds: 60);
  static const int maxRedirects = 6;

  final DbStorageService storage;
  final http.Client _client;

  DownloadService({
    required this.storage,
    http.Client? client,
  }) : _client = client ?? http.Client();

  Future<void> downloadAndInstallAsset(
    DatabaseAsset asset, {
    required String url,
    DownloadCancellationToken? token,
    Future<void> Function()? beforeSwap,
    void Function(DownloadProgress progress)? onProgress,
  }) async {
    final cancelToken = token ?? DownloadCancellationToken();
    void emit(
      TransferPhase phase, {
      int bytesReceived = 0,
      int totalBytes = 0,
      double bytesPerSecond = 0,
      String? message,
      String? error,
    }) {
      onProgress?.call(
        DownloadProgress(
          assetId: asset.id,
          filename: asset.filename,
          phase: phase,
          bytesReceived: bytesReceived,
          totalBytes: totalBytes,
          bytesPerSecond: bytesPerSecond,
          message: message,
          error: error,
        ),
      );
    }

    final digestSeed = '${asset.checksum ?? asset.zipSha256 ?? ''}|$url';
    final partFile = await storage.partialZipFile(asset.filename, digestSeed);
    final stagingDb = await storage.stagingDbFile(asset.filename);
    final destDbPath = await storage.installedDbPath(asset.filename);

    try {
      // Clean stale staging output from previous interrupted runs.
      if (stagingDb.existsSync()) {
        await stagingDb.delete();
      }

      await _downloadWithResume(
        url: url,
        partFile: partFile,
        expectedTotalBytes: asset.zipSize > 0 ? asset.zipSize : null,
        token: cancelToken,
        onTransferProgress: (received, total, speedBps) {
          emit(
            TransferPhase.downloading,
            bytesReceived: received,
            totalBytes: total,
            bytesPerSecond: speedBps,
            message: 'Downloading ${asset.assetName}...',
          );
        },
      );

      if (cancelToken.isCancelled) throw const DownloadCancelledException();

      if (asset.zipSha256 != null && asset.zipSha256!.isNotEmpty) {
        emit(
          TransferPhase.verifyingZip,
          bytesReceived: asset.zipSize,
          totalBytes: asset.zipSize,
          message: 'Verifying archive SHA-256...',
        );
        final actualZipSha = await DbStorageService.computeFileSha256(partFile.path);
        if (actualZipSha != asset.zipSha256!.toLowerCase()) {
          await partFile.delete();
          throw StateError(
            'Archive SHA-256 mismatch for ${asset.assetName}: '
            'expected ${asset.zipSha256}, got $actualZipSha.',
          );
        }
      }

      if (cancelToken.isCancelled) throw const DownloadCancelledException();

      emit(
        TransferPhase.extracting,
        message: 'Extracting ${asset.filename} in background isolate...',
      );
      await _extractDatabaseFromZip(
        zipPath: partFile.path,
        outputDbPath: stagingDb.path,
        preferredFilename: asset.filename,
      );

      if (cancelToken.isCancelled) throw const DownloadCancelledException();

      emit(
        TransferPhase.verifyingDb,
        message: 'Verifying SQLite schema & integrity...',
      );
      final verification = await storage.verifyAndPrepareSqliteDb(
        stagingDb.path,
        requiredTables: asset.requiredTables,
        expectedBytes: asset.dbSize > 0 ? asset.dbSize : null,
        expectedSha256: asset.checksum,
      );
      if (!verification.valid) {
        throw StateError(verification.error ?? 'SQLite verification failed.');
      }

      await beforeSwap?.call();
      await storage.atomicReplaceFile(stagingDb.path, destDbPath);

      if (partFile.existsSync()) {
        await partFile.delete();
      }

      emit(
        TransferPhase.completed,
        bytesReceived: verification.sizeBytes,
        totalBytes: verification.sizeBytes,
        message: 'Installed ${asset.filename}',
      );
    } on DownloadCancelledException {
      // Preserve partFile so the user can resume seamlessly later!
      if (stagingDb.existsSync()) {
        try {
          await stagingDb.delete();
        } catch (_) {}
      }
      emit(TransferPhase.cancelled, message: 'Paused (progress saved for resume)');
      rethrow;
    } catch (e) {
      if (stagingDb.existsSync()) {
        try {
          await stagingDb.delete();
        } catch (_) {}
      }
      emit(
        TransferPhase.failed,
        error: e.toString(),
        message: 'Download failed',
      );
      rethrow;
    }
  }

  /// Offline fallback matching epitaka_app: accepts a user-picked `.zip` or `.db`
  /// file and runs the same isolate extraction, SQLite verification, and swap.
  Future<void> importLocalFile(
    String sourcePath,
    DatabaseAsset asset, {
    Future<void> Function()? beforeSwap,
    void Function(DownloadProgress progress)? onProgress,
  }) async {
    void emit(TransferPhase phase, {String? message, String? error}) {
      onProgress?.call(
        DownloadProgress(
          assetId: asset.id,
          filename: asset.filename,
          phase: phase,
          message: message,
          error: error,
        ),
      );
    }

    final srcFile = File(sourcePath);
    if (!srcFile.existsSync()) {
      throw ArgumentError('Selected file not found: $sourcePath');
    }

    final stagingDb = await storage.stagingDbFile(asset.filename);
    final destDbPath = await storage.installedDbPath(asset.filename);

    try {
      if (stagingDb.existsSync()) {
        await stagingDb.delete();
      }

      final lower = sourcePath.toLowerCase();
      if (lower.endsWith('.zip')) {
        emit(TransferPhase.extracting, message: 'Extracting ${p.basename(sourcePath)}...');
        await _extractDatabaseFromZip(
          zipPath: sourcePath,
          outputDbPath: stagingDb.path,
          preferredFilename: asset.filename,
        );
      } else if (lower.endsWith('.db') || lower.endsWith('.sqlite')) {
        emit(TransferPhase.extracting, message: 'Staging ${p.basename(sourcePath)}...');
        await srcFile.copy(stagingDb.path);
      } else {
        throw ArgumentError('Expected a .zip or .db file.');
      }

      emit(TransferPhase.verifyingDb, message: 'Verifying SQLite schema & integrity...');
      final verification = await storage.verifyAndPrepareSqliteDb(
        stagingDb.path,
        requiredTables: asset.requiredTables,
        expectedBytes: asset.dbSize > 0 ? asset.dbSize : null,
        expectedSha256: asset.checksum,
      );
      if (!verification.valid) {
        throw StateError(verification.error ?? 'Imported database verification failed.');
      }

      await beforeSwap?.call();
      await storage.atomicReplaceFile(stagingDb.path, destDbPath);

      emit(
        TransferPhase.completed,
        message: 'Imported ${asset.filename}',
      );
    } catch (e) {
      if (stagingDb.existsSync()) {
        try {
          await stagingDb.delete();
        } catch (_) {}
      }
      emit(TransferPhase.failed, error: e.toString(), message: 'Import failed');
      rethrow;
    }
  }

  Future<void> _downloadWithResume({
    required String url,
    required File partFile,
    int? expectedTotalBytes,
    required DownloadCancellationToken token,
    required void Function(int received, int total, double bytesPerSecond)
    onTransferProgress,
  }) async {
    var existingBytes = partFile.existsSync() ? await partFile.length() : 0;
    if (expectedTotalBytes != null && existingBytes > expectedTotalBytes) {
      await partFile.delete();
      existingBytes = 0;
    }

    var attemptRestartFromZero = false;
    for (var pass = 0; pass < 2; pass++) {
      if (attemptRestartFromZero && partFile.existsSync()) {
        await partFile.delete();
        existingBytes = 0;
      }

      final response = await _sendWithRedirects(
        Uri.parse(url),
        rangeStart: existingBytes > 0 ? existingBytes : null,
      );

      if (response.statusCode == 416 && existingBytes > 0) {
        // Check if file might already be complete or server shifted size.
        await response.stream.drain<void>();
        attemptRestartFromZero = true;
        continue;
      }

      if (response.statusCode != 200 && response.statusCode != 206) {
        await response.stream.drain<void>();
        throw HttpException(
          'HTTP ${response.statusCode} downloading $url',
          uri: Uri.parse(url),
        );
      }

      final isResumed = response.statusCode == 206 && existingBytes > 0;
      var receivedBytes = isResumed ? existingBytes : 0;

      int totalBytes = expectedTotalBytes ?? 0;
      if (isResumed) {
        final contentRange = response.headers['content-range'];
        final parsedTotal = _parseContentRangeTotal(contentRange);
        if (parsedTotal != null && parsedTotal > 0) {
          totalBytes = parsedTotal;
        } else if (response.contentLength != null) {
          totalBytes = existingBytes + response.contentLength!;
        }
      } else if (response.contentLength != null && response.contentLength! > 0) {
        totalBytes = response.contentLength!;
      }

      final raf = await partFile.open(
        mode: isResumed ? FileMode.writeOnlyAppend : FileMode.writeOnly,
      );

      var lastChunkAt = DateTime.now();
      final stopwatch = Stopwatch()..start();
      var sessionBytes = 0;
      var lastEmitAt = DateTime.fromMillisecondsSinceEpoch(0);
      final completer = Completer<void>();
      late StreamSubscription<List<int>> sub;

      final watchdog = Timer.periodic(const Duration(seconds: 2), (_) {
        if (completer.isCompleted) return;
        if (token.isCancelled) {
          completer.completeError(const DownloadCancelledException());
          return;
        }
        if (DateTime.now().difference(lastChunkAt) > stallTimeout) {
          completer.completeError(
            TimeoutException('Download stalled for ${stallTimeout.inSeconds}s'),
          );
        }
      });

      token.addListener(() {
        if (!completer.isCompleted) {
          completer.completeError(const DownloadCancelledException());
        }
      });

      sub = response.stream.listen(
        (chunk) {
          lastChunkAt = DateTime.now();
          raf.writeFromSync(chunk);
          receivedBytes += chunk.length;
          sessionBytes += chunk.length;

          final now = DateTime.now();
          if (now.difference(lastEmitAt).inMilliseconds >= 120 ||
              (totalBytes > 0 && receivedBytes >= totalBytes)) {
            lastEmitAt = now;
            final secs = stopwatch.elapsedMilliseconds / 1000.0;
            final speed = secs > 0.1 ? sessionBytes / secs : 0.0;
            onTransferProgress(receivedBytes, totalBytes, speed);
          }
        },
        onError: (Object err, StackTrace st) {
          if (!completer.isCompleted) {
            completer.completeError(err, st);
          }
        },
        onDone: () {
          if (!completer.isCompleted) {
            completer.complete();
          }
        },
        cancelOnError: true,
      );

      try {
        await completer.future;
        await raf.flush();
      } finally {
        watchdog.cancel();
        await sub.cancel();
        await raf.close();
      }
      return;
    }
  }

  Future<http.StreamedResponse> _sendWithRedirects(
    Uri initialUri, {
    int? rangeStart,
  }) async {
    var currentUri = initialUri;
    for (var hop = 0; hop <= maxRedirects; hop++) {
      final request = http.Request('GET', currentUri)
        ..followRedirects = false
        ..headers['User-Agent'] = 'tipitakapali-app';
      if (rangeStart != null && rangeStart > 0) {
        request.headers['Range'] = 'bytes=$rangeStart-';
      }

      final response = await _client.send(request);
      if (response.statusCode == 301 ||
          response.statusCode == 302 ||
          response.statusCode == 303 ||
          response.statusCode == 307 ||
          response.statusCode == 308) {
        await response.stream.drain<void>();
        final location = response.headers['location'];
        if (location == null || location.isEmpty) {
          throw HttpException('Redirect without Location header', uri: currentUri);
        }
        currentUri = currentUri.resolve(location);
        continue;
      }
      return response;
    }
    throw HttpException('Too many redirects (> $maxRedirects)', uri: initialUri);
  }

  static int? _parseContentRangeTotal(String? header) {
    if (header == null) return null;
    final slash = header.lastIndexOf('/');
    if (slash < 0) return null;
    final rawTotal = header.substring(slash + 1).trim();
    if (rawTotal == '*') return null;
    return int.tryParse(rawTotal);
  }

  static Future<void> _extractDatabaseFromZip({
    required String zipPath,
    required String outputDbPath,
    required String preferredFilename,
  }) async {
    await Isolate.run(() async {
      final input = InputFileStream(zipPath);
      try {
        final archive = ZipDecoder().decodeStream(input, verify: true);
        ArchiveFile? chosen;
        final wantedBase = p.basename(preferredFilename).toLowerCase();

        for (final entry in archive.files) {
          if (!entry.isFile) continue;
          final safeBase = p.basename(entry.name.replaceAll('\\', '/'));
          if (entry.name.contains('..')) continue;
          if (safeBase.toLowerCase() == wantedBase) {
            chosen = entry;
            break;
          }
          if (chosen == null && safeBase.toLowerCase().endsWith('.db')) {
            chosen = entry;
          }
        }

        if (chosen == null) {
          throw StateError(
            'No .db file found inside archive ${p.basename(zipPath)}.',
          );
        }

        final output = OutputFileStream(outputDbPath);
        try {
          chosen.writeContent(output, freeMemory: true);
        } finally {
          await output.close();
        }
      } finally {
        await input.close();
      }
    });
  }
}
