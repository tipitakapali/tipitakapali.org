import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/models/db_manifest.dart';
import 'package:tipitakapali_app/core/services/github_release_service.dart';
import 'package:tipitakapali_app/core/storage/db_storage_service.dart';
import 'package:tipitakapali_app/features/downloads/download_controller.dart';
import 'package:tipitakapali_app/features/downloads/download_service.dart';

Future<({File zipFile, String zipSha, String dbSha, int dbSize, int zipSize})>
_buildTestTipitakaZip(Directory workDir) async {
  final dbFile = File(p.join(workDir.path, 'src_tipitaka.db'));
  final db = sqlite3.open(dbFile.path);
  try {
    db.execute('CREATE TABLE books (book_code TEXT PRIMARY KEY, book_name TEXT);');
    db.execute('CREATE TABLE chapters (id INTEGER PRIMARY KEY, html TEXT);');
    db.execute('CREATE TABLE tree_nodes (id INTEGER PRIMARY KEY);');
    db.execute('CREATE TABLE canon_paragraphs (id INTEGER PRIMARY KEY);');
    db.execute(
      "INSERT INTO books (book_code, book_name) VALUES ('dn1', 'Brahmajala Sutta');",
    );
    // Keep payload non-trivial so Range resume tests split cleanly across chunks.
    for (var i = 0; i < 200; i++) {
      db.execute(
        'INSERT INTO chapters (html) VALUES (?);',
        ['<p>Paragraph sample $i with repeated Pali content for archive bytes.</p>'],
      );
    }
  } finally {
    db.close();
  }

  final dbBytes = await dbFile.readAsBytes();
  final dbSha = sha256.convert(dbBytes).toString();

  final zipFile = File(p.join(workDir.path, 'tipitaka.db.zip'));
  final encoder = ZipFileEncoder();
  encoder.create(zipFile.path);
  await encoder.addFile(dbFile, 'tipitaka.db');
  await encoder.close();

  final zipBytes = await zipFile.readAsBytes();
  final zipSha = sha256.convert(zipBytes).toString();
  return (
    zipFile: zipFile,
    zipSha: zipSha,
    dbSha: dbSha,
    dbSize: dbBytes.length,
    zipSize: zipBytes.length,
  );
}

void main() {
  test('downloads via 302 redirect, extracts in isolate, verifies SHA-256 & schema, and swaps', () async {
    final tmp = await Directory.systemTemp.createTemp('tp_dl_full_');
    addTearDown(() => tmp.delete(recursive: true));

    final dbDir = Directory(p.join(tmp.path, 'dbs'));
    final bundle = await _buildTestTipitakaZip(tmp);
    final zipBytes = await bundle.zipFile.readAsBytes();

    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    server.listen((req) async {
      if (req.uri.path == '/release/tipitaka.db.zip') {
        req.response
          ..statusCode = 302
          ..headers.set('location', '/cdn/tipitaka.db.zip')
          ..close();
        return;
      }
      if (req.uri.path == '/cdn/tipitaka.db.zip') {
        req.response
          ..statusCode = 200
          ..contentLength = zipBytes.length
          ..add(zipBytes);
        await req.response.close();
        return;
      }
      req.response
        ..statusCode = 404
        ..close();
    });

    final storage = DbStorageService(overrideDirectory: dbDir);
    final service = DownloadService(storage: storage);

    final asset = DatabaseAsset(
      id: 'tipitaka',
      filename: 'tipitaka.db',
      assetName: 'tipitaka.db.zip',
      title: 'Tipitaka',
      category: DbCategory.core,
      compulsory: true,
      zipSize: bundle.zipSize,
      dbSize: bundle.dbSize,
      checksum: bundle.dbSha,
      zipSha256: bundle.zipSha,
      requiredTables: const ['books', 'chapters', 'tree_nodes', 'canon_paragraphs'],
    );

    final phases = <TransferPhase>[];
    await service.downloadAndInstallAsset(
      asset,
      url: 'http://127.0.0.1:${server.port}/release/tipitaka.db.zip',
      onProgress: (p) => phases.add(p.phase),
    );

    expect(phases, containsAllInOrder([
      TransferPhase.downloading,
      TransferPhase.verifyingZip,
      TransferPhase.extracting,
      TransferPhase.verifyingDb,
      TransferPhase.completed,
    ]));

    final installed = await storage.listInstalledDatabases();
    expect(installed.containsKey('tipitaka.db'), isTrue);
    expect(installed['tipitaka.db']!.sizeBytes, bundle.dbSize);

    // Ensure partial zip file was cleaned up after install.
    final remainingParts = dbDir
        .listSync()
        .where((e) => e.path.endsWith('.zip.part'))
        .toList();
    expect(remainingParts, isEmpty);
  });

  test('resumes partial download via HTTP Range 206 header', () async {
    final tmp = await Directory.systemTemp.createTemp('tp_dl_resume_');
    addTearDown(() => tmp.delete(recursive: true));

    final dbDir = Directory(p.join(tmp.path, 'dbs'));
    final bundle = await _buildTestTipitakaZip(tmp);
    final zipBytes = await bundle.zipFile.readAsBytes();
    final splitAt = zipBytes.length ~/ 2;

    final storage = DbStorageService(overrideDirectory: dbDir);
    final url = 'http://127.0.0.1:0/tipitaka.db.zip';
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    final liveUrl = 'http://127.0.0.1:${server.port}/tipitaka.db.zip';
    final asset = DatabaseAsset(
      id: 'tipitaka',
      filename: 'tipitaka.db',
      assetName: 'tipitaka.db.zip',
      title: 'Tipitaka',
      category: DbCategory.core,
      zipSize: bundle.zipSize,
      dbSize: bundle.dbSize,
      checksum: bundle.dbSha,
      zipSha256: bundle.zipSha,
      requiredTables: const ['books'],
    );
    expect(url, isNot(liveUrl));

    // Seed partial `.zip.part` matching exact deterministic seed rule.
    final digestSeed = '${asset.checksum}|$liveUrl';
    final partFile = await storage.partialZipFile(asset.filename, digestSeed);
    await partFile.writeAsBytes(zipBytes.sublist(0, splitAt));

    String? receivedRangeHeader;
    server.listen((req) async {
      receivedRangeHeader = req.headers.value('range');
      if (receivedRangeHeader == 'bytes=$splitAt-') {
        final tail = zipBytes.sublist(splitAt);
        req.response
          ..statusCode = 206
          ..headers.set('content-range', 'bytes $splitAt-${zipBytes.length - 1}/${zipBytes.length}')
          ..contentLength = tail.length
          ..add(tail);
        await req.response.close();
      } else {
        req.response
          ..statusCode = 200
          ..contentLength = zipBytes.length
          ..add(zipBytes);
        await req.response.close();
      }
    });

    final service = DownloadService(storage: storage);
    await service.downloadAndInstallAsset(asset, url: liveUrl);

    expect(receivedRangeHeader, 'bytes=$splitAt-');
    final installed = await storage.listInstalledDatabases();
    expect(installed.containsKey('tipitaka.db'), isTrue);
  });

  test('rejects mismatched SHA-256 and imports local zip cleanly', () async {
    final tmp = await Directory.systemTemp.createTemp('tp_dl_verify_');
    addTearDown(() => tmp.delete(recursive: true));

    final dbDir = Directory(p.join(tmp.path, 'dbs'));
    final bundle = await _buildTestTipitakaZip(tmp);
    final storage = DbStorageService(overrideDirectory: dbDir);
    final service = DownloadService(storage: storage);

    final badChecksumAsset = DatabaseAsset(
      id: 'tipitaka',
      filename: 'tipitaka.db',
      assetName: 'tipitaka.db.zip',
      title: 'Tipitaka',
      category: DbCategory.core,
      dbSize: bundle.dbSize,
      checksum: '0' * 64,
      requiredTables: const ['books'],
    );

    await expectLater(
      () => service.importLocalFile(bundle.zipFile.path, badChecksumAsset),
      throwsStateError,
    );
    expect(await storage.listInstalledDatabases(), isEmpty);

    final validAsset = badChecksumAsset.copyWith(checksum: bundle.dbSha);
    await service.importLocalFile(bundle.zipFile.path, validAsset);
    final installed = await storage.listInstalledDatabases();
    expect(installed.containsKey('tipitaka.db'), isTrue);
  });

  test('downloadAssetsGroup resolves live manifest asset so onboarding downloads leave availableUpdates empty', () async {
    SharedPreferences.setMockInitialValues({});
    final tmp = await Directory.systemTemp.createTemp('tp_dl_group_live_');
    addTearDown(() => tmp.delete(recursive: true));

    final dbDir = Directory(p.join(tmp.path, 'dbs'));
    final srcDb = File(p.join(tmp.path, 'src_dpd.db'));
    final db = sqlite3.open(srcDb.path);
    try {
      db.execute('CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT);');
      db.execute("INSERT INTO entries (word) VALUES ('dhamma');");
    } finally {
      db.close();
    }
    final dbBytes = await srcDb.readAsBytes();
    final dbSha = sha256.convert(dbBytes).toString();
    final zipFile = File(p.join(tmp.path, 'dpd_tipitakapali.db.zip'));
    final encoder = ZipFileEncoder();
    encoder.create(zipFile.path);
    await encoder.addFile(srcDb, 'dpd_tipitakapali.db');
    await encoder.close();
    final zipBytes = await zipFile.readAsBytes();
    final zipSha = sha256.convert(zipBytes).toString();

    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    final baseUrl = 'http://127.0.0.1:${server.port}';

    String makeManifest({
      required int version,
      required String updated,
      required String checksum,
      required String zipSha256,
    }) {
      return jsonEncode({
        'version': 1,
        'releaseRepo': 'tipitakapali/tipitakapali.org',
        'releaseTag': 'db',
        'core': <String, dynamic>{},
        'dictionaries': {
          'dpd_tipitakapali': {
            'id': 'dpd_tipitakapali',
            'filename': 'dpd_tipitakapali.db',
            'assetName': 'dpd_tipitakapali.db.zip',
            'title': 'Digital Pali Dictionary (DPD)',
            'category': 'dictionary',
            'compulsory': true,
            'version': version,
            'dbSize': dbBytes.length,
            'size': zipBytes.length,
            'updated': updated,
            'checksum': checksum,
            'zipSha256': zipSha256,
            'url': '$baseUrl/dpd_tipitakapali.db.zip',
          },
        },
        'languages': <String, dynamic>{},
      });
    }

    final bundledRaw = makeManifest(
      version: 1,
      updated: '2026-11-14',
      checksum: '0' * 64,
      zipSha256: '0' * 64,
    );
    final liveRaw = makeManifest(
      version: 2,
      updated: '2026-11-15',
      checksum: dbSha,
      zipSha256: zipSha,
    );

    server.listen((req) async {
      if (req.uri.path == '/raw/databases_manifest.json') {
        req.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(liveRaw);
        await req.response.close();
        return;
      }
      if (req.uri.path == '/dpd_tipitakapali.db.zip') {
        req.response
          ..statusCode = 200
          ..contentLength = zipBytes.length
          ..add(zipBytes);
        await req.response.close();
        return;
      }
      req.response
        ..statusCode = 404
        ..close();
    });

    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(
          DbStorageService(overrideDirectory: dbDir),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            assetLoader: (_) async => bundledRaw,
            rawManifestUrlOverride: '$baseUrl/raw/databases_manifest.json',
            apiBaseUrlOverride: '$baseUrl/api',
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);
    final staleSnapshot =
        container.read(downloadControllerProvider).manifest!.dictionaries['dpd_tipitakapali']!;
    expect(staleSnapshot.version, 1);

    await controller.downloadAssetsGroup([staleSnapshot]);

    final after = container.read(downloadControllerProvider);
    expect(after.installedDbs.containsKey('dpd_tipitakapali.db'), isTrue);
    expect(after.availableUpdates, isEmpty);

    await controller.checkForDatabaseUpdates();
    expect(container.read(downloadControllerProvider).availableUpdates, isEmpty);
  });

  test('checkForDatabaseUpdates backfills metadata and avoids prompt when pre-existing DB matches remote checksum', () async {
    SharedPreferences.setMockInitialValues({});
    final tmp = await Directory.systemTemp.createTemp('tp_dl_preexisting_');
    addTearDown(() => tmp.delete(recursive: true));

    final dbDir = Directory(p.join(tmp.path, 'dbs'))..createSync(recursive: true);
    final dictFile = File(p.join(dbDir.path, 'dpd_tipitakapali.db'));
    final db = sqlite3.open(dictFile.path);
    try {
      db.execute('CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT);');
      db.execute("INSERT INTO entries (word) VALUES ('sati');");
    } finally {
      db.close();
    }
    dictFile.setLastModifiedSync(DateTime.utc(2025, 1, 1));
    final dbBytes = await dictFile.readAsBytes();
    final dbSha = sha256.convert(dbBytes).toString();

    final manifestJson = jsonEncode({
      'version': 1,
      'releaseRepo': 'tipitakapali/tipitakapali.org',
      'releaseTag': 'db',
      'core': <String, dynamic>{},
      'dictionaries': {
        'dpd_tipitakapali': {
          'id': 'dpd_tipitakapali',
          'filename': 'dpd_tipitakapali.db',
          'assetName': 'dpd_tipitakapali.db.zip',
          'title': 'Digital Pali Dictionary (DPD)',
          'category': 'dictionary',
          'compulsory': true,
          'version': 1,
          'dbSize': dbBytes.length,
          'size': 1234,
          'updated': '2026-11-14',
          'checksum': dbSha,
          'url': 'https://example.com/dpd_tipitakapali.db.zip',
        },
      },
      'languages': <String, dynamic>{},
    });

    final mockClient = MockClient((request) async {
      if (request.url.toString() == GitHubReleaseService.defaultRawManifestUrl) {
        return http.Response(manifestJson, 200);
      }
      return http.Response('{}', 404);
    });

    final container = ProviderContainer(
      overrides: [
        dbStorageServiceProvider.overrideWithValue(
          DbStorageService(overrideDirectory: dbDir),
        ),
        gitHubReleaseServiceProvider.overrideWithValue(
          GitHubReleaseService(
            client: mockClient,
            assetLoader: (_) async => manifestJson,
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(downloadControllerProvider.notifier);
    await controller.initialize(fetchRemote: false);
    expect(container.read(downloadControllerProvider).availableUpdates, isEmpty);

    await controller.checkForDatabaseUpdates();
    expect(container.read(downloadControllerProvider).availableUpdates, isEmpty);

    final prefs = await SharedPreferences.getInstance();
    expect(
      prefs.getString('installed_asset_meta_dpd_tipitakapali.db'),
      isNotNull,
    );
  });
}
