import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tipitakapali_app/core/services/github_release_service.dart';

void main() {
  test('default repository points to tipitakapali/tipitakapali.org', () {
    expect(
      GitHubReleaseService.defaultRepo,
      'tipitakapali/tipitakapali.org',
    );
    expect(GitHubReleaseService.defaultTag, 'db');
  });

  test('fetchFromGitHubApiBase merges live zip URLs, sizes, and digests', () async {
    final bundledRaw =
        await File('assets/databases_manifest.json').readAsString();
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    server.listen((request) {
      if (request.uri.path ==
          '/repos/tipitakapali/tipitakapali.org/releases/tags/db') {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(
            jsonEncode({
              'tag_name': 'v2026.11',
              'assets': [
                {
                  'name': 'tipitaka.db.zip',
                  'browser_download_url':
                      'https://example.invalid/releases/v2026.11/tipitaka.db.zip',
                  'size': 12345678,
                  'digest': 'sha256:abcdef0123456789',
                  'updated_at': '2026-11-14T00:00:00Z',
                },
                {
                  'name': 'custom_extra.db.zip',
                  'browser_download_url':
                      'https://example.invalid/releases/v2026.11/custom_extra.db.zip',
                  'size': 999,
                  'updated_at': '2026-11-14T00:00:00Z',
                },
              ],
            }),
          )
          ..close();
        return;
      }
      request.response
        ..statusCode = 404
        ..close();
    });

    final service = GitHubReleaseService(
      assetLoader: (_) async => bundledRaw,
    );
    final result = await service.fetchFromGitHubApiBase(
      apiBaseUrl: 'http://127.0.0.1:${server.port}',
    );

    expect(result.fetchedLive, isTrue);
    expect(result.warning, isNull);
    final tipitaka = result.manifest.core['tipitaka']!;
    expect(
      tipitaka.url,
      'https://example.invalid/releases/v2026.11/tipitaka.db.zip',
    );
    expect(tipitaka.zipSize, 12345678);
    expect(tipitaka.zipSha256, 'abcdef0123456789');
    expect(tipitaka.updated, '2026-11-14');
    expect(
      result.manifest.discoveredExtras.map((e) => e.filename),
      contains('custom_extra.db'),
    );
  });

  test('decodes UTF-8 manifest and API responses without charset header', () async {
    final bundledBytes =
        await File('assets/databases_manifest.json').readAsBytes();
    final bundledRaw = utf8.decode(bundledBytes);
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    server.listen((request) {
      if (request.uri.path ==
          '/repos/tipitakapali/tipitakapali.org/releases/tags/db') {
        final releasePayload = utf8.encode(
          jsonEncode({
            'tag_name': 'v2026.11',
            'assets': [
              {
                'name': 'databases_manifest.json',
                'browser_download_url':
                    'http://127.0.0.1:${server.port}/assets/databases_manifest.json',
                'size': bundledBytes.length,
              },
            ],
          }),
        );
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType('application', 'octet-stream')
          ..add(releasePayload)
          ..close();
        return;
      }
      if (request.uri.path == '/assets/databases_manifest.json') {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType('application', 'octet-stream')
          ..add(bundledBytes)
          ..close();
        return;
      }
      request.response
        ..statusCode = 404
        ..close();
    });

    final service = GitHubReleaseService(
      assetLoader: (_) async => bundledRaw,
    );
    final result = await service.fetchFromGitHubApiBase(
      apiBaseUrl: 'http://127.0.0.1:${server.port}',
    );

    expect(result.fetchedLive, isTrue);
    expect(result.manifest.languages['vi']?.nativeName, 'Tiếng Việt');
    expect(result.manifest.languages['fr']?.nativeName, 'Français');
    expect(result.manifest.languages['es']?.nativeName, 'Español');
    expect(result.manifest.languages['my']?.nativeName, 'မြန်မာဘာသာ');
    expect(result.manifest.core['tipitaka']?.compulsory, isTrue);
    expect(result.manifest.core['pali_sentences']?.compulsory, isFalse);
  });

  test('preserves compulsory flags on core and dictionaries even when remote manifest sets false', () async {
    final bundledRaw =
        await File('assets/databases_manifest.json').readAsString();
    final remoteMap = jsonDecode(bundledRaw) as Map<String, dynamic>;
    final coreMap = remoteMap['core'] as Map<String, dynamic>;
    (coreMap['tipitaka'] as Map<String, dynamic>)['compulsory'] = false;
    final dictMap = remoteMap['dictionaries'] as Map<String, dynamic>;
    for (final entry in dictMap.values) {
      (entry as Map<String, dynamic>)['compulsory'] = false;
    }
    final remoteBytes = utf8.encode(jsonEncode(remoteMap));

    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));

    server.listen((request) {
      if (request.uri.path ==
          '/repos/tipitakapali/tipitakapali.org/releases/tags/db') {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(
            jsonEncode({
              'tag_name': 'v2026.11',
              'assets': [
                {
                  'name': 'databases_manifest.json',
                  'browser_download_url':
                      'http://127.0.0.1:${server.port}/assets/databases_manifest.json',
                  'size': remoteBytes.length,
                },
              ],
            }),
          )
          ..close();
        return;
      }
      if (request.uri.path == '/assets/databases_manifest.json') {
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..add(remoteBytes)
          ..close();
        return;
      }
      request.response
        ..statusCode = 404
        ..close();
    });

    final service = GitHubReleaseService(
      assetLoader: (_) async => bundledRaw,
    );
    final result = await service.fetchFromGitHubApiBase(
      apiBaseUrl: 'http://127.0.0.1:${server.port}',
    );

    expect(result.fetchedLive, isTrue);
    expect(result.manifest.core['tipitaka']?.compulsory, isTrue);
    expect(result.manifest.core['pali_sentences']?.compulsory, isFalse);
    expect(
      result.manifest.dictionaries.values.every((d) => d.compulsory),
      isTrue,
    );
    expect(result.manifest.languages['en']?.translationDb.compulsory, isFalse);
  });

  test(
    'fetchOfficialRelease checks raw repo databases_manifest.json and falls back to bundled offline',
    () async {
      final bundledRaw =
          await File('assets/databases_manifest.json').readAsString();
      final remoteMap = jsonDecode(bundledRaw) as Map<String, dynamic>;
      final coreMap = remoteMap['core'] as Map<String, dynamic>;
      final tipitakaMap = coreMap['tipitaka'] as Map<String, dynamic>;
      tipitakaMap['version'] = 2;
      tipitakaMap['updated'] = '2026-12-01';

      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));

      server.listen((request) {
        if (request.uri.path == '/raw/databases_manifest.json') {
          request.response
            ..statusCode = 200
            ..headers.contentType = ContentType.json
            ..add(utf8.encode(jsonEncode(remoteMap)))
            ..close();
          return;
        }
        request.response
          ..statusCode = 404
          ..close();
      });

      final onlineService = GitHubReleaseService(
        assetLoader: (_) async => bundledRaw,
        rawManifestUrlOverride:
            'http://127.0.0.1:${server.port}/raw/databases_manifest.json',
        apiBaseUrlOverride: 'http://127.0.0.1:${server.port}',
      );
      final onlineResult = await onlineService.fetchOfficialRelease();
      expect(onlineResult.fetchedLive, isTrue);
      expect(onlineResult.manifest.core['tipitaka']?.version, 2);
      expect(onlineResult.manifest.core['tipitaka']?.updated, '2026-12-01');
      expect(onlineResult.manifest.core['tipitaka']?.compulsory, isTrue);

      final offlineService = GitHubReleaseService(
        assetLoader: (_) async => bundledRaw,
        rawManifestUrlOverride: 'http://127.0.0.1:${server.port}/missing.json',
        apiBaseUrlOverride: 'http://127.0.0.1:${server.port}',
      );
      final offlineResult = await offlineService.fetchOfficialRelease();
      expect(offlineResult.fetchedLive, isFalse);
      expect(offlineResult.manifest.core['tipitaka']?.version, 1);
    },
  );
}
