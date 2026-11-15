import 'dart:convert';

import '../storage/db_storage_service.dart';
import 'db_manifest.dart';

/// Recorded manifest metadata for a locally installed database file.
class InstalledAssetMetadata {
  final int version;
  final String? updated;
  final String? zipSha256;
  final String? checksum;

  const InstalledAssetMetadata({
    required this.version,
    this.updated,
    this.zipSha256,
    this.checksum,
  });

  factory InstalledAssetMetadata.fromAsset(DatabaseAsset asset) {
    return InstalledAssetMetadata(
      version: asset.version,
      updated: _normalizeOptional(asset.updated),
      zipSha256: _normalizeHash(asset.zipSha256),
      checksum: _normalizeHash(asset.checksum),
    );
  }

  Map<String, dynamic> toJson() => {
    'version': version,
    if (updated != null) 'updated': updated,
    if (zipSha256 != null) 'zipSha256': zipSha256,
    if (checksum != null) 'checksum': checksum,
  };

  String toJsonString() => jsonEncode(toJson());

  static InstalledAssetMetadata? tryParse(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      final map = jsonDecode(raw);
      if (map is! Map<String, dynamic>) return null;
      return InstalledAssetMetadata(
        version: (map['version'] as num?)?.toInt() ?? 1,
        updated: _normalizeOptional(map['updated'] as String?),
        zipSha256: _normalizeHash(map['zipSha256'] as String?),
        checksum: _normalizeHash(map['checksum'] as String?),
      );
    } catch (_) {
      return null;
    }
  }
}

/// Represents a locally installed database that has a newer version available
/// in the remote manifest.
class DatabaseUpdateItem {
  final DatabaseAsset asset;
  final int? installedVersion;
  final String? installedUpdated;

  const DatabaseUpdateItem({
    required this.asset,
    this.installedVersion,
    this.installedUpdated,
  });

  int get downloadSizeBytes => asset.estimatedDownloadBytes;
}

/// Compares a locally installed database against [remoteAsset] from the
/// active manifest.
bool isDatabaseUpdateAvailable({
  required DatabaseAsset remoteAsset,
  required InstalledDbInfo installed,
  required InstalledAssetMetadata? recordedMeta,
  required DatabaseManifest manifest,
}) {
  if (remoteAsset.category == DbCategory.fts) return false;
  final url = manifest.resolveDownloadUrl(
    remoteAsset,
    overrideRepo: manifest.releaseRepo,
    overrideTag: manifest.releaseTag,
  );
  if (url == null || url.trim().isEmpty) return false;

  final remoteUpdated = _normalizeOptional(remoteAsset.updated);
  final remoteZipSha = _normalizeHash(remoteAsset.zipSha256);
  final remoteChecksum = _normalizeHash(remoteAsset.checksum);

  if (recordedMeta != null) {
    if (remoteAsset.version > recordedMeta.version) {
      return true;
    }
    if (recordedMeta.checksum != null &&
        remoteChecksum != null &&
        recordedMeta.checksum != remoteChecksum) {
      return true;
    }
    if (recordedMeta.zipSha256 != null &&
        remoteZipSha != null &&
        recordedMeta.zipSha256 != remoteZipSha) {
      return true;
    }
    if (recordedMeta.updated != null &&
        remoteUpdated != null &&
        recordedMeta.updated!.compareTo(remoteUpdated) < 0) {
      return true;
    }
    return false;
  }

  // Fallback for databases installed before metadata tracking was added:
  // compare the file modification date (YYYY-MM-DD) against manifest.updated.
  if (remoteUpdated != null) {
    final fileDate = _formatDateOnly(installed.modifiedAt);
    return fileDate.compareTo(remoteUpdated) < 0;
  }
  return false;
}

String _formatDateOnly(DateTime dt) {
  final utc = dt.toUtc();
  final y = utc.year.toString().padLeft(4, '0');
  final m = utc.month.toString().padLeft(2, '0');
  final d = utc.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

String? _normalizeOptional(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  return trimmed;
}

String? _normalizeHash(String? value) {
  final trimmed = value?.trim().toLowerCase();
  if (trimmed == null || trimmed.isEmpty) return null;
  return trimmed;
}
