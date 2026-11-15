import 'dart:convert';

enum DbCategory {
  core,
  fts,
  dictionary,
  translation;

  static DbCategory fromString(String? raw) {
    switch (raw) {
      case 'fts':
        return DbCategory.fts;
      case 'dictionary':
        return DbCategory.dictionary;
      case 'translation':
        return DbCategory.translation;
      case 'core':
      default:
        return DbCategory.core;
    }
  }

  String get label {
    switch (this) {
      case DbCategory.core:
        return 'Core';
      case DbCategory.fts:
        return 'Search (FTS5)';
      case DbCategory.dictionary:
        return 'Dictionary';
      case DbCategory.translation:
        return 'Translation';
    }
  }
}

class GitHubReleaseAsset {
  final String name;
  final String downloadUrl;
  final int size;
  final String? digestSha256;
  final DateTime? updatedAt;

  const GitHubReleaseAsset({
    required this.name,
    required this.downloadUrl,
    required this.size,
    this.digestSha256,
    this.updatedAt,
  });

  factory GitHubReleaseAsset.fromJson(Map<String, dynamic> json) {
    final rawDigest = json['digest'] as String?;
    String? sha;
    if (rawDigest != null && rawDigest.startsWith('sha256:')) {
      sha = rawDigest.substring('sha256:'.length).trim().toLowerCase();
    }
    return GitHubReleaseAsset(
      name: (json['name'] as String? ?? '').trim(),
      downloadUrl: (json['browser_download_url'] as String? ?? '').trim(),
      size: (json['size'] as num?)?.toInt() ?? 0,
      digestSha256: sha,
      updatedAt: json['updated_at'] is String
          ? DateTime.tryParse(json['updated_at'] as String)
          : null,
    );
  }
}

class DatabaseAsset {
  final String id;
  final String filename;
  final String assetName;
  final String title;
  final String description;
  final DbCategory category;
  final bool compulsory;
  final String? url;
  final int zipSize;
  final int dbSize;
  final String? checksum;
  final String? zipSha256;
  final int version;
  final String? updated;
  final List<String> requiredTables;

  const DatabaseAsset({
    required this.id,
    required this.filename,
    required this.assetName,
    required this.title,
    this.description = '',
    required this.category,
    this.compulsory = false,
    this.url,
    this.zipSize = 0,
    this.dbSize = 0,
    this.checksum,
    this.zipSha256,
    this.version = 1,
    this.updated,
    this.requiredTables = const [],
  });

  bool get hasDownloadUrl => url != null && url!.trim().isNotEmpty;

  int get estimatedDownloadBytes => zipSize > 0 ? zipSize : (dbSize * 0.45).round();

  DatabaseAsset copyWith({
    String? url,
    int? zipSize,
    int? dbSize,
    String? checksum,
    String? zipSha256,
    int? version,
    String? updated,
    bool? compulsory,
  }) {
    return DatabaseAsset(
      id: id,
      filename: filename,
      assetName: assetName,
      title: title,
      description: description,
      category: category,
      compulsory: compulsory ?? this.compulsory,
      url: url ?? this.url,
      zipSize: zipSize ?? this.zipSize,
      dbSize: dbSize ?? this.dbSize,
      checksum: checksum ?? this.checksum,
      zipSha256: zipSha256 ?? this.zipSha256,
      version: version ?? this.version,
      updated: updated ?? this.updated,
      requiredTables: requiredTables,
    );
  }

  factory DatabaseAsset.fromJson(String key, Map<String, dynamic> json) {
    final filename = (json['filename'] as String? ?? '$key.db').trim();
    final assetName = (json['assetName'] as String? ?? '$filename.zip').trim();
    return DatabaseAsset(
      id: (json['id'] as String? ?? key).trim(),
      filename: filename,
      assetName: assetName,
      title: (json['title'] as String? ?? filename).trim(),
      description: (json['description'] as String? ?? '').trim(),
      category: DbCategory.fromString(json['category'] as String?),
      compulsory: json['compulsory'] as bool? ?? false,
      url: (json['url'] as String?)?.trim(),
      zipSize: (json['size'] as num?)?.toInt() ?? 0,
      dbSize: (json['dbSize'] as num?)?.toInt() ?? 0,
      checksum: (json['checksum'] as String?)?.trim().toLowerCase(),
      zipSha256: (json['zipSha256'] as String?)?.trim().toLowerCase(),
      version: (json['version'] as num?)?.toInt() ?? 1,
      updated: (json['updated'] as String?)?.trim(),
      requiredTables: (json['requiredTables'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(growable: false),
    );
  }
}

class LanguagePack {
  static const Map<String, String> _defaultFlags = {
    'en': '🇬🇧',
    'vi': '🇻🇳',
    'my': '🇲🇲',
    'my_nissaya': '🇲🇲',
    'si': '🇱🇰',
    'zh': '🇨🇳',
    'km': '🇰🇭',
    'th': '🇹🇭',
    'lo': '🇱🇦',
    'ta': '🇮🇳',
    'hi': '🇮🇳',
    'mr': '🇮🇳',
    'id': '🇮🇩',
    'cs': '🇨🇿',
    'de': '🇩🇪',
    'es': '🇪🇸',
    'fr': '🇫🇷',
    'ja': '🇯🇵',
    'pt': '🇵🇹',
    'ru': '🇷🇺',
    'ko': '🇰🇷',
    'ne': '🇳🇵',
    'be': '🇧🇩',
    'bn': '🇧🇩',
  };

  final String code;
  final String name;
  final String nativeName;
  final String? flag;
  final DatabaseAsset translationDb;
  final DatabaseAsset? ftsDb;

  const LanguagePack({
    required this.code,
    required this.name,
    required this.nativeName,
    this.flag,
    required this.translationDb,
    this.ftsDb,
  });

  String get displayFlag =>
      (flag != null && flag!.trim().isNotEmpty)
          ? flag!.trim()
          : (_defaultFlags[code.toLowerCase()] ?? '🌐');

  factory LanguagePack.fromJson(String code, Map<String, dynamic> json) {
    final transMap = json['translationDb'] as Map<String, dynamic>? ?? {};
    final ftsMap = json['ftsDb'] as Map<String, dynamic>?;
    return LanguagePack(
      code: (json['code'] as String? ?? code).trim(),
      name: (json['name'] as String? ?? code.toUpperCase()).trim(),
      nativeName: (json['nativeName'] as String? ?? code.toUpperCase()).trim(),
      flag: (json['flag'] as String?)?.trim(),
      translationDb: DatabaseAsset.fromJson('translation_$code', transMap),
      ftsDb: ftsMap != null
          ? DatabaseAsset.fromJson('fts_translation_$code', ftsMap)
          : null,
    );
  }

  LanguagePack copyWith({
    DatabaseAsset? translationDb,
    DatabaseAsset? ftsDb,
  }) {
    return LanguagePack(
      code: code,
      name: name,
      nativeName: nativeName,
      flag: flag,
      translationDb: translationDb ?? this.translationDb,
      ftsDb: ftsDb ?? this.ftsDb,
    );
  }
}

class DatabaseManifest {
  final int version;
  final String releaseRepo;
  final String releaseTag;
  final Map<String, DatabaseAsset> core;
  final Map<String, DatabaseAsset> dictionaries;
  final Map<String, LanguagePack> languages;
  final List<DatabaseAsset> discoveredExtras;
  final String sourceDescription;

  const DatabaseManifest({
    required this.version,
    required this.releaseRepo,
    required this.releaseTag,
    required this.core,
    required this.dictionaries,
    required this.languages,
    this.discoveredExtras = const [],
    this.sourceDescription = 'Bundled catalog',
  });

  factory DatabaseManifest.fromJsonString(
    String rawJson, {
    String sourceDescription = 'Bundled catalog',
  }) {
    final decoded = jsonDecode(rawJson) as Map<String, dynamic>;
    return DatabaseManifest.fromJson(
      decoded,
      sourceDescription: sourceDescription,
    );
  }

  factory DatabaseManifest.fromJson(
    Map<String, dynamic> json, {
    String sourceDescription = 'Bundled catalog',
  }) {
    final coreJson = json['core'] as Map<String, dynamic>? ?? const {};
    final dictJson = json['dictionaries'] as Map<String, dynamic>? ?? const {};
    final langJson = json['languages'] as Map<String, dynamic>? ?? const {};

    final core = <String, DatabaseAsset>{
      for (final e in coreJson.entries)
        if (e.value is Map<String, dynamic>)
          e.key: DatabaseAsset.fromJson(e.key, e.value as Map<String, dynamic>),
    };

    final dictionaries = <String, DatabaseAsset>{
      for (final e in dictJson.entries)
        if (e.value is Map<String, dynamic>)
          e.key: DatabaseAsset.fromJson(e.key, e.value as Map<String, dynamic>),
    };

    final languages = <String, LanguagePack>{
      for (final e in langJson.entries)
        if (e.value is Map<String, dynamic>)
          e.key: LanguagePack.fromJson(e.key, e.value as Map<String, dynamic>),
    };

    return DatabaseManifest(
      version: (json['version'] as num?)?.toInt() ?? 1,
      releaseRepo: (json['releaseRepo'] as String? ?? '').trim(),
      releaseTag: (json['releaseTag'] as String? ?? 'db').trim(),
      core: core,
      dictionaries: dictionaries,
      languages: languages,
      sourceDescription: sourceDescription,
    );
  }

  List<DatabaseAsset> get allCatalogAssets => [
    ...core.values,
    ...dictionaries.values,
    for (final lang in languages.values) ...[
      lang.translationDb,
      if (lang.ftsDb != null) lang.ftsDb!,
    ],
    ...discoveredExtras,
  ];

  List<DatabaseAsset> get compulsoryAssets =>
      allCatalogAssets.where((a) => a.compulsory).toList(growable: false);

  /// Finds the latest catalog entry matching [id] or [filename].
  DatabaseAsset? findAsset({String? id, String? filename}) {
    if (id != null && id.isNotEmpty) {
      for (final asset in allCatalogAssets) {
        if (asset.id == id) return asset;
      }
    }
    if (filename != null && filename.isNotEmpty) {
      for (final asset in allCatalogAssets) {
        if (asset.filename == filename) return asset;
      }
    }
    return null;
  }

  /// Resolves an asset's download URL using either explicit manifest `url`
  /// or `https://github.com/<repo>/releases/download/<tag>/<assetName>`.
  String? resolveDownloadUrl(
    DatabaseAsset asset, {
    String? overrideRepo,
    String? overrideTag,
  }) {
    if (asset.hasDownloadUrl) return asset.url!.trim();
    final repo = (overrideRepo != null && overrideRepo.trim().isNotEmpty)
        ? overrideRepo.trim()
        : releaseRepo.trim();
    if (repo.isEmpty) return null;
    final tag = (overrideTag != null && overrideTag.trim().isNotEmpty)
        ? overrideTag.trim()
        : (releaseTag.trim().isEmpty ? 'db' : releaseTag.trim());
    return 'https://github.com/$repo/releases/download/$tag/${asset.assetName}';
  }

  /// Hydrates catalog entries with live GitHub Release `.zip` assets so
  /// exact compressed sizes, browser_download_url, and GitHub SHA-256 digests
  /// are always accurate even without hand-updating JSON sizes.
  DatabaseManifest applyGitHubReleaseAssets(
    List<GitHubReleaseAsset> assets, {
    required String repo,
    required String tag,
  }) {
    final byName = <String, GitHubReleaseAsset>{
      for (final a in assets) a.name.toLowerCase(): a,
    };
    final matchedNames = <String>{};

    DatabaseAsset merge(DatabaseAsset item) {
      final candidates = [
        item.assetName.toLowerCase(),
        '${item.filename}.zip'.toLowerCase(),
        '${item.id}.zip'.toLowerCase(),
      ];
      GitHubReleaseAsset? match;
      for (final name in candidates) {
        final found = byName[name];
        if (found != null) {
          match = found;
          matchedNames.add(found.name.toLowerCase());
          break;
        }
      }
      if (match == null) return item;
      final updatedDate = match.updatedAt?.toIso8601String().split('T').first;
      final localZipSha = item.zipSha256?.trim().toLowerCase();
      final remoteZipSha = match.digestSha256?.trim().toLowerCase();
      final sameZipDigest =
          localZipSha != null &&
          remoteZipSha != null &&
          localZipSha == remoteZipSha;
      final preserveExistingDate =
          item.updated != null &&
          item.updated!.trim().isNotEmpty &&
          sameZipDigest;
      return item.copyWith(
        url: match.downloadUrl,
        zipSize: match.size > 0 ? match.size : item.zipSize,
        zipSha256: match.digestSha256 ?? item.zipSha256,
        updated: preserveExistingDate ? item.updated : (updatedDate ?? item.updated),
      );
    }

    final mergedCore = {
      for (final e in core.entries) e.key: merge(e.value),
    };
    final mergedDicts = {
      for (final e in dictionaries.entries) e.key: merge(e.value),
    };
    final mergedLangs = {
      for (final e in languages.entries)
        e.key: e.value.copyWith(
          translationDb: merge(e.value.translationDb),
          ftsDb: e.value.ftsDb != null ? merge(e.value.ftsDb!) : null,
        ),
    };

    final extras = <DatabaseAsset>[];
    for (final a in assets) {
      final lower = a.name.toLowerCase();
      if (matchedNames.contains(lower)) continue;
      if (!lower.endsWith('.db.zip') && !lower.endsWith('.zip')) continue;
      final dbFilename = lower.endsWith('.db.zip')
          ? a.name.substring(0, a.name.length - 4)
          : a.name.replaceFirst(RegExp(r'\.zip$', caseSensitive: false), '.db');
      extras.add(
        DatabaseAsset(
          id: dbFilename.replaceAll('.', '_'),
          filename: dbFilename,
          assetName: a.name,
          title: dbFilename,
          description: 'Discovered in GitHub release $tag',
          category: dbFilename.startsWith('fts_')
              ? DbCategory.fts
              : DbCategory.core,
          url: a.downloadUrl,
          zipSize: a.size,
          zipSha256: a.digestSha256,
          updated: a.updatedAt?.toIso8601String().split('T').first,
        ),
      );
    }

    return DatabaseManifest(
      version: version,
      releaseRepo: repo,
      releaseTag: tag,
      core: mergedCore,
      dictionaries: mergedDicts,
      languages: mergedLangs,
      discoveredExtras: extras,
      sourceDescription: 'GitHub Release: $repo ($tag)',
    );
  }

  /// Ensures any asset marked `compulsory` in the bundled catalog remains
  /// compulsory even when adopting an older remote release manifest.
  DatabaseManifest preserveCompulsoryFrom(DatabaseManifest bundled) {
    final mergedCore = <String, DatabaseAsset>{
      for (final e in core.entries)
        e.key: (bundled.core[e.key]?.compulsory ?? false) && !e.value.compulsory
            ? e.value.copyWith(compulsory: true)
            : e.value,
    };
    final mergedDicts = <String, DatabaseAsset>{
      for (final e in dictionaries.entries)
        e.key: (bundled.dictionaries[e.key]?.compulsory ?? false) &&
                !e.value.compulsory
            ? e.value.copyWith(compulsory: true)
            : e.value,
    };
    final mergedLangs = <String, LanguagePack>{
      for (final e in languages.entries)
        e.key: (bundled.languages[e.key]?.translationDb.compulsory ?? false) &&
                !e.value.translationDb.compulsory
            ? e.value.copyWith(
                translationDb: e.value.translationDb.copyWith(compulsory: true),
              )
            : e.value,
    };
    return DatabaseManifest(
      version: version,
      releaseRepo: releaseRepo,
      releaseTag: releaseTag,
      core: mergedCore,
      dictionaries: mergedDicts,
      languages: mergedLangs,
      discoveredExtras: discoveredExtras,
      sourceDescription: sourceDescription,
    );
  }
}
