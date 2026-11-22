import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;

import '../models/db_manifest.dart';

class ManifestFetchResult {
  final DatabaseManifest manifest;
  final bool fetchedLive;
  final String? warning;

  const ManifestFetchResult({
    required this.manifest,
    required this.fetchedLive,
    this.warning,
  });
}

class GitHubReleaseService {
  static const String defaultRepo = 'tipitakapali/tipitakapali.org';
  static const String defaultTag = 'db-v2';
  static const String defaultRawManifestUrl =
      'https://github.com/$defaultRepo/releases/download/$defaultTag/databases_manifest.json';
  static const String bundledAssetPath = 'assets/databases_manifest_v2.json';
  static const Duration requestTimeout = Duration(seconds: 15);

  final http.Client _client;
  final Future<String> Function(String path)? assetLoader;
  final String? apiBaseUrlOverride;
  final String? rawManifestUrlOverride;

  GitHubReleaseService({
    http.Client? client,
    this.assetLoader,
    this.apiBaseUrlOverride,
    this.rawManifestUrlOverride,
  }) : _client = client ?? http.Client();

  Future<DatabaseManifest> loadBundledManifest() async {
    final loader = assetLoader ?? rootBundle.loadString;
    final raw = await loader(bundledAssetPath);
    return DatabaseManifest.fromJsonString(
      raw,
      sourceDescription: 'Official release: $defaultRepo',
    );
  }

  /// Fetches the official TipitakaPali online `databases_manifest.json` from the
  /// GitHub repository (`tipitakapali/tipitakapali.org`), merges live
  /// GitHub Release asset metadata when available, and falls back seamlessly to
  /// the bundled manifest when offline.
  Future<ManifestFetchResult> fetchOfficialRelease({
    bool offlineOnly = false,
  }) async {
    final bundled = await loadBundledManifest();
    if (offlineOnly) {
      return ManifestFetchResult(manifest: bundled, fetchedLive: false);
    }

    final repoUrl = rawManifestUrlOverride ?? defaultRawManifestUrl;
    final repoResult = await _fetchFromManifestUrl(
      repoUrl,
      fallback: bundled,
    );
    final repoManifest = repoResult.fetchedLive
        ? repoResult.manifest.preserveCompulsoryFrom(bundled)
        : bundled;

    final releaseResult = await _fetchFromGitHubRelease(
      repo: defaultRepo,
      tag: defaultTag,
      fallback: repoManifest,
      apiBaseUrlOverride: apiBaseUrlOverride,
      skipReleaseManifestAsset: repoResult.fetchedLive,
    );

    if (releaseResult.fetchedLive) {
      return releaseResult;
    }
    if (repoResult.fetchedLive) {
      return ManifestFetchResult(
        manifest: repoManifest,
        fetchedLive: true,
        warning: releaseResult.warning,
      );
    }
    return releaseResult;
  }

  Future<ManifestFetchResult> _fetchFromManifestUrl(
    String url, {
    required DatabaseManifest fallback,
  }) async {
    try {
      final uri = Uri.parse(url);
      final resp = await _client
          .get(uri, headers: const {'Accept': 'application/json'})
          .timeout(requestTimeout);
      if (resp.statusCode != 200) {
        return ManifestFetchResult(
          manifest: fallback,
          fetchedLive: false,
          warning: 'Manifest HTTP ${resp.statusCode}',
        );
      }
      final parsed = DatabaseManifest.fromJsonString(
        utf8.decode(resp.bodyBytes, allowMalformed: true),
        sourceDescription: 'GitHub Release ($defaultRepo)',
      );
      if (parsed.core.isEmpty &&
          parsed.dictionaries.isEmpty &&
          parsed.languages.isEmpty) {
        return ManifestFetchResult(
          manifest: fallback,
          fetchedLive: false,
          warning: 'Remote manifest had no catalog entries.',
        );
      }
      return ManifestFetchResult(manifest: parsed, fetchedLive: true);
    } catch (e) {
      return ManifestFetchResult(
        manifest: fallback,
        fetchedLive: false,
        warning: 'Could not reach manifest: $e',
      );
    }
  }

  Future<ManifestFetchResult> _fetchFromGitHubRelease({
    required String repo,
    required String tag,
    required DatabaseManifest fallback,
    String? apiBaseUrlOverride,
    bool skipReleaseManifestAsset = false,
  }) async {
    final base = apiBaseUrlOverride ?? 'https://api.github.com';
    final releaseUri = tag == 'latest'
        ? Uri.parse('$base/repos/$repo/releases/latest')
        : Uri.parse('$base/repos/$repo/releases/tags/${Uri.encodeComponent(tag)}');

    try {
      final resp = await _client
          .get(
            releaseUri,
            headers: const {
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'tipitakapali-app',
            },
          )
          .timeout(requestTimeout);

      Map<String, dynamic>? releaseJson;
      if (resp.statusCode == 200) {
        releaseJson =
            jsonDecode(utf8.decode(resp.bodyBytes, allowMalformed: true))
                as Map<String, dynamic>;
      } else if (resp.statusCode == 404 && tag == 'latest') {
        final listResp = await _client
            .get(
              Uri.parse('$base/repos/$repo/releases?per_page=10'),
              headers: const {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'tipitakapali-app',
              },
            )
            .timeout(requestTimeout);
        if (listResp.statusCode == 200) {
          final list =
              jsonDecode(utf8.decode(listResp.bodyBytes, allowMalformed: true))
                  as List<dynamic>;
          for (final item in list) {
            if (item is Map<String, dynamic> && item['draft'] != true) {
              releaseJson = item;
              break;
            }
          }
        }
      }

      if (releaseJson == null) {
        return ManifestFetchResult(
          manifest: fallback,
          fetchedLive: false,
          warning:
              'GitHub release unavailable (HTTP ${resp.statusCode}) for $repo. '
              'You can still import local .zip or .db files.',
        );
      }

      final resolvedTag = (releaseJson['tag_name'] as String? ?? tag).trim();
      final rawAssets = (releaseJson['assets'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(GitHubReleaseAsset.fromJson)
          .toList(growable: false);

      var baseManifest = fallback;
      if (!skipReleaseManifestAsset) {
        final manifestAsset = rawAssets
            .where((a) => a.name.toLowerCase() == 'databases_manifest.json')
            .firstOrNull;
        if (manifestAsset != null && manifestAsset.downloadUrl.isNotEmpty) {
          final remoteManifest = await _fetchFromManifestUrl(
            manifestAsset.downloadUrl,
            fallback: fallback,
          );
          baseManifest = remoteManifest.manifest.preserveCompulsoryFrom(fallback);
        }
      }

      final hydrated = baseManifest.applyGitHubReleaseAssets(
        rawAssets,
        repo: repo,
        tag: resolvedTag,
      );

      if (rawAssets.isEmpty) {
        return ManifestFetchResult(
          manifest: hydrated,
          fetchedLive: true,
          warning: 'Release "$resolvedTag" has no uploaded .zip assets yet.',
        );
      }

      return ManifestFetchResult(manifest: hydrated, fetchedLive: true);
    } catch (e) {
      return ManifestFetchResult(
        manifest: fallback,
        fetchedLive: false,
        warning: 'Offline or GitHub unavailable ($e).',
      );
    }
  }

  /// Exposed for testing against a local mock GitHub API server.
  Future<ManifestFetchResult> fetchFromGitHubApiBase({
    required String apiBaseUrl,
    String repo = defaultRepo,
    String tag = defaultTag,
  }) async {
    final bundled = await loadBundledManifest();
    return _fetchFromGitHubRelease(
      repo: repo,
      tag: tag,
      fallback: bundled,
      apiBaseUrlOverride: apiBaseUrl,
    );
  }
}
