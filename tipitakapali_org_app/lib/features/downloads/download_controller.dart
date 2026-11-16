import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../core/fts/fts_index_service.dart';
import '../../core/models/db_manifest.dart';
import '../../core/models/db_update_info.dart';
import '../../core/services/bold_definition_index_service.dart';
import '../../core/services/github_release_service.dart';
import '../../core/storage/db_storage_service.dart';
import '../../core/utils/pali_script_converter.dart';
import 'download_service.dart';

class FtsIndexingStatus {
  final String taskLabel;
  final String filename;
  final FtsBuildStage stage;
  final int taskIndex;
  final int totalTasks;
  final int processedRows;
  final int totalRows;
  final double taskProgress;
  final double overallProgress;
  final String detail;

  const FtsIndexingStatus({
    required this.taskLabel,
    required this.filename,
    required this.stage,
    required this.taskIndex,
    required this.totalTasks,
    this.processedRows = 0,
    this.totalRows = 0,
    required this.taskProgress,
    required this.overallProgress,
    required this.detail,
  });
}

class DownloadCenterState {
  final bool isInitializing;
  final bool isFetchingManifest;
  final DatabaseManifest? manifest;
  final bool fetchedLiveRelease;
  final String? releaseWarning;
  final Map<String, InstalledDbInfo> installedDbs;
  final Map<String, DownloadProgress> transfers;
  final String selectedLanguageCode;
  final String selectedPaliScript;
  final Set<String> selectedOptionalIds;
  final String? dbDirectoryPath;
  final String? indexingMessage;
  final FtsIndexingStatus? indexingStatus;
  final bool isBatchInstalling;
  final List<DatabaseUpdateItem> availableUpdates;
  final bool hasCheckedUpdates;
  final bool updateDialogDismissed;
  final bool onboardingCompleted;
  final bool onboardingInterrupted;

  static const _defaultOptionalIds = {
    'translation_en',
    'dpd_tipitakapali',
    'dpd_splitter',
    'dpd_inflection',
    'dpd_synonyms',
    'ptsped2015ed',
    'abhidhan',
    'ap_bh_mw_sanskrit',
    'palisinh',
  };

  const DownloadCenterState({
    this.isInitializing = true,
    this.isFetchingManifest = false,
    this.manifest,
    this.fetchedLiveRelease = false,
    this.releaseWarning,
    this.installedDbs = const {},
    this.transfers = const {},
    this.selectedLanguageCode = DownloadController.defaultLanguageCode,
    this.selectedPaliScript = DownloadController.defaultPaliScript,
    this.selectedOptionalIds = _defaultOptionalIds,
    this.dbDirectoryPath,
    this.indexingMessage,
    this.indexingStatus,
    this.isBatchInstalling = false,
    this.availableUpdates = const [],
    this.hasCheckedUpdates = false,
    this.updateDialogDismissed = false,
    this.onboardingCompleted = false,
    this.onboardingInterrupted = false,
  });

  List<DatabaseAsset> get compulsoryAssets =>
      manifest?.compulsoryAssets ?? const [];

  bool get allCompulsoryInstalled {
    final m = manifest;
    if (m == null) return false;
    final required = m.compulsoryAssets;
    if (required.isEmpty) return installedDbs.containsKey('tipitaka.db');
    return required.every((a) => installedDbs.containsKey(a.filename));
  }

  bool get hasCoreFts => installedDbs.containsKey('fts_tipitaka.db');

  List<String> get missingTranslationFtsLangs {
    final transRegex = RegExp(r'^translation_(.+)\.db$');
    final missing = <String>[];
    for (final name in installedDbs.keys) {
      final m = transRegex.firstMatch(name);
      if (m == null) continue;
      final lang = m.group(1)!;
      if (!installedDbs.containsKey('fts_translation_$lang.db')) {
        missing.add(lang);
      }
    }
    missing.sort();
    return missing;
  }

  bool get hasCoreFtsReady =>
      installedDbs.containsKey('tipitaka.db') && hasCoreFts;

  bool get hasRequiredFtsReady =>
      hasCoreFtsReady && missingTranslationFtsLangs.isEmpty;

  bool get needsOnboarding =>
      !onboardingCompleted || !allCompulsoryInstalled || !hasCoreFtsReady;

  bool get hasActiveTransfers => transfers.values.any((t) => t.isActive);
  bool get isIndexingFts => indexingMessage != null || indexingStatus != null;

  DownloadCenterState copyWith({
    bool? isInitializing,
    bool? isFetchingManifest,
    DatabaseManifest? manifest,
    bool? fetchedLiveRelease,
    String? releaseWarning,
    bool clearWarning = false,
    Map<String, InstalledDbInfo>? installedDbs,
    Map<String, DownloadProgress>? transfers,
    String? selectedLanguageCode,
    String? selectedPaliScript,
    Set<String>? selectedOptionalIds,
    String? dbDirectoryPath,
    String? indexingMessage,
    FtsIndexingStatus? indexingStatus,
    bool clearIndexingMessage = false,
    bool? isBatchInstalling,
    List<DatabaseUpdateItem>? availableUpdates,
    bool? hasCheckedUpdates,
    bool? updateDialogDismissed,
    bool? onboardingCompleted,
    bool? onboardingInterrupted,
  }) {
    return DownloadCenterState(
      isInitializing: isInitializing ?? this.isInitializing,
      isFetchingManifest: isFetchingManifest ?? this.isFetchingManifest,
      manifest: manifest ?? this.manifest,
      fetchedLiveRelease: fetchedLiveRelease ?? this.fetchedLiveRelease,
      releaseWarning:
          clearWarning ? null : (releaseWarning ?? this.releaseWarning),
      installedDbs: installedDbs ?? this.installedDbs,
      transfers: transfers ?? this.transfers,
      selectedLanguageCode: selectedLanguageCode ?? this.selectedLanguageCode,
      selectedPaliScript: selectedPaliScript ?? this.selectedPaliScript,
      selectedOptionalIds: selectedOptionalIds ?? this.selectedOptionalIds,
      dbDirectoryPath: dbDirectoryPath ?? this.dbDirectoryPath,
      indexingMessage: clearIndexingMessage
          ? null
          : (indexingMessage ?? this.indexingMessage),
      indexingStatus: clearIndexingMessage
          ? null
          : (indexingStatus ?? this.indexingStatus),
      isBatchInstalling: isBatchInstalling ?? this.isBatchInstalling,
      availableUpdates: availableUpdates ?? this.availableUpdates,
      hasCheckedUpdates: hasCheckedUpdates ?? this.hasCheckedUpdates,
      updateDialogDismissed:
          updateDialogDismissed ?? this.updateDialogDismissed,
      onboardingCompleted: onboardingCompleted ?? this.onboardingCompleted,
      onboardingInterrupted:
          onboardingInterrupted ?? this.onboardingInterrupted,
    );
  }
}

final dbStorageServiceProvider = Provider<DbStorageService>(
  (ref) => DbStorageService(),
);

final gitHubReleaseServiceProvider = Provider<GitHubReleaseService>(
  (ref) => GitHubReleaseService(),
);

final downloadServiceProvider = Provider<DownloadService>(
  (ref) => DownloadService(storage: ref.watch(dbStorageServiceProvider)),
);

final ftsIndexServiceProvider = Provider<FtsIndexService>(
  (ref) => FtsIndexService(),
);

final downloadControllerProvider =
    NotifierProvider<DownloadController, DownloadCenterState>(
      DownloadController.new,
    );

class DownloadController extends Notifier<DownloadCenterState> {
  static const noLanguageCode = 'none';
  static const defaultLanguageCode = 'en';
  static const defaultPaliScript = 'roman';
  static const _prefLanguageCode = 'selected_language_code';
  static const _prefPaliScript = 'selected_pali_script';
  static const _prefOptionalAssets = 'onboarding_selected_optional_assets_v2';
  static const _prefInstalledMetaPrefix = 'installed_asset_meta_';
  static const _prefOnboardingCompleted = 'onboarding_completed_v1';
  static const _prefOnboardingInProgress = 'onboarding_in_progress_v1';

  final Map<String, DownloadCancellationToken> _tokens = {};
  bool _initialized = false;
  bool _disposed = false;
  Future<void> _ftsQueue = Future.value();
  Future<ManifestFetchResult>? _inFlightManifestRefresh;

  DbStorageService get _storage => ref.read(dbStorageServiceProvider);
  GitHubReleaseService get _releaseService =>
      ref.read(gitHubReleaseServiceProvider);
  DownloadService get _downloadService => ref.read(downloadServiceProvider);
  FtsIndexService get _ftsService => ref.read(ftsIndexServiceProvider);

  @override
  DownloadCenterState build() {
    ref.onDispose(() {
      _disposed = true;
      for (final token in _tokens.values) {
        token.cancel();
      }
      _tokens.clear();
    });
    if (!_initialized) {
      _initialized = true;
      Future.microtask(initialize);
    }
    return const DownloadCenterState();
  }

  Future<void> initialize({bool fetchRemote = true}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_disposed) return;
      final savedLang = prefs.getString(_prefLanguageCode) ?? defaultLanguageCode;
      final savedScript =
          PaliScript.fromId(prefs.getString(_prefPaliScript)).webId;

      final dir = await _storage.getDatabaseDirectory();
      await _storage.cleanupInterruptedTempFiles();
      var installed = await _storage.listInstalledDatabases();
      if (_disposed) return;

      // Load bundled manifest immediately so onboarding/offline launches render in <10ms,
      // then check the online repository manifest in the background.
      final bundled = await _releaseService.loadBundledManifest();
      if (_disposed) return;

      final prunedAny = await _pruneInvalidInstalledDatabases(
        bundled: bundled,
        installed: installed,
      );
      if (prunedAny) {
        installed = await _storage.listInstalledDatabases();
      }
      if (_disposed) return;

      final defaultIds = <String>{
        ...bundled.dictionaries.keys,
        if (savedLang != noLanguageCode) 'translation_$savedLang',
      };
      final savedSelection =
          (prefs.getStringList(_prefOptionalAssets) ?? defaultIds.toList())
              .where((id) => !id.startsWith('fts_'))
              .toSet();

      final initialUpdates = await _computeAvailableUpdates(
        manifest: bundled,
        installed: installed,
        prefs: prefs,
      );
      if (_disposed) return;

      final requiredCompulsory = bundled.compulsoryAssets;
      final hasAllCompulsory = requiredCompulsory.isEmpty
          ? installed.containsKey('tipitaka.db')
          : requiredCompulsory.every((a) => installed.containsKey(a.filename));
      final hasCoreFts = installed.containsKey('fts_tipitaka.db');
      final hasMissingTransFts = _findMissingTranslationFtsLangs(installed)
          .isNotEmpty;
      final hasCoreReady = hasAllCompulsory && hasCoreFts;
      final readyNow = hasCoreReady && !hasMissingTransFts;

      final inProgress = prefs.getBool(_prefOnboardingInProgress) ?? false;
      final completedPref = prefs.getBool(_prefOnboardingCompleted);
      final onboardingDone =
          !inProgress &&
          (completedPref != null
              ? (completedPref && hasCoreReady)
              : readyNow);
      final interrupted = inProgress || (completedPref == false);

      if (!onboardingDone) {
        await prefs.setBool(_prefOnboardingInProgress, true);
        await prefs.setBool(_prefOnboardingCompleted, false);
      }

      state = state.copyWith(
        isInitializing: false,
        manifest: bundled,
        selectedLanguageCode: savedLang,
        selectedPaliScript: savedScript,
        selectedOptionalIds: savedSelection,
        installedDbs: installed,
        dbDirectoryPath: dir.path,
        availableUpdates: initialUpdates,
        onboardingCompleted: onboardingDone,
        onboardingInterrupted: interrupted && !readyNow,
        releaseWarning: interrupted && !hasAllCompulsory
            ? 'Previous setup was interrupted before completing all required downloads. Tap Download All to resume.'
            : null,
      );

      if (hasAllCompulsory && !readyNow && !_hasPendingSelectedDownloads()) {
        // Downloads already finished before the app was killed (during
        // onboarding or after installing a new language); resume FTS indexing
        // automatically (core Pāḷi FTS first, then translations).
        unawaited(ensureMissingFtsIndexed(autoCompleteOnboarding: true));
      }

      if (fetchRemote) {
        if (!installed.containsKey('tipitaka.db') || !onboardingDone) {
          await refreshReleaseManifest();
        } else {
          unawaited(checkForDatabaseUpdates());
        }
      }
    } catch (e) {
      if (_disposed) return;
      state = state.copyWith(
        isInitializing: false,
        releaseWarning: 'Initialization error: $e',
      );
    }
  }

  Future<ManifestFetchResult> refreshReleaseManifest({
    bool silentOffline = false,
  }) {
    final inFlight = _inFlightManifestRefresh;
    if (inFlight != null) {
      return inFlight;
    }
    final future = _performRefreshReleaseManifest(silentOffline: silentOffline);
    _inFlightManifestRefresh = future;
    future.whenComplete(() {
      if (identical(_inFlightManifestRefresh, future)) {
        _inFlightManifestRefresh = null;
      }
    });
    return future;
  }

  Future<ManifestFetchResult> _performRefreshReleaseManifest({
    bool silentOffline = false,
  }) async {
    if (!_disposed) {
      state = state.copyWith(
        isFetchingManifest: true,
        clearWarning: !silentOffline,
      );
    }
    final result = await _releaseService.fetchOfficialRelease();
    if (_disposed) return result;
    final updates = await _computeAvailableUpdates(
      manifest: result.manifest,
      installed: state.installedDbs,
    );
    if (_disposed) return result;
    state = state.copyWith(
      isFetchingManifest: false,
      manifest: result.manifest,
      fetchedLiveRelease: result.fetchedLive,
      releaseWarning: result.fetchedLive || !silentOffline
          ? result.warning
          : state.releaseWarning,
      clearWarning: result.fetchedLive && result.warning == null,
      availableUpdates: updates,
    );
    return result;
  }

  /// Checks the online repository `databases_manifest.json` (and GitHub Release
  /// assets) on startup without blocking the UI. Falls back silently to the
  /// built-in manifest when offline.
  Future<List<DatabaseUpdateItem>> checkForDatabaseUpdates() async {
    final result = await refreshReleaseManifest(silentOffline: true);
    if (_disposed) return const [];
    final updates = await _computeAvailableUpdates(
      manifest: result.manifest,
      installed: state.installedDbs,
    );
    if (_disposed) return const [];
    state = state.copyWith(
      availableUpdates: updates,
      hasCheckedUpdates: true,
    );
    return updates;
  }

  void dismissUpdateNotification() {
    state = state.copyWith(updateDialogDismissed: true);
  }

  Future<void> updateAvailableDatabases() async {
    final toUpdate = state.availableUpdates
        .map((u) => u.asset)
        .toList()
      ..sort((a, b) => _downloadPriority(a).compareTo(_downloadPriority(b)));
    if (toUpdate.isEmpty) return;

    state = state.copyWith(isBatchInstalling: true, clearWarning: true);
    try {
      await _downloadBatch(toUpdate, forceReindexUpdated: true);
    } finally {
      if (!_disposed) {
        state = state.copyWith(isBatchInstalling: false);
      }
    }
  }

  Future<void> refreshInstalled() async {
    final installed = await _storage.listInstalledDatabases();
    if (_disposed) return;
    final manifest = state.manifest;
    final updates = manifest != null
        ? await _computeAvailableUpdates(manifest: manifest, installed: installed)
        : state.availableUpdates;
    if (_disposed) return;
    state = state.copyWith(
      installedDbs: installed,
      availableUpdates: updates,
    );
  }

  Future<void> _recordInstalledAssetMeta(DatabaseAsset asset) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_prefInstalledMetaPrefix${asset.filename}',
      InstalledAssetMetadata.fromAsset(asset).toJsonString(),
    );
  }

  Future<bool> _matchesRemoteChecksumAndBackfillMeta({
    required DatabaseAsset remoteAsset,
    required InstalledDbInfo localInfo,
    required SharedPreferences prefs,
  }) async {
    if (remoteAsset.category == DbCategory.fts) return false;
    final expectedSha = remoteAsset.checksum?.trim().toLowerCase();
    if (expectedSha == null || expectedSha.isEmpty) return false;
    if (remoteAsset.dbSize > 0 && localInfo.sizeBytes != remoteAsset.dbSize) {
      return false;
    }
    try {
      final actualSha = await DbStorageService.computeFileSha256(localInfo.path);
      if (actualSha != expectedSha) return false;
      await prefs.setString(
        '$_prefInstalledMetaPrefix${remoteAsset.filename}',
        InstalledAssetMetadata.fromAsset(remoteAsset).toJsonString(),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<List<DatabaseUpdateItem>> _computeAvailableUpdates({
    required DatabaseManifest manifest,
    required Map<String, InstalledDbInfo> installed,
    SharedPreferences? prefs,
  }) async {
    if (installed.isEmpty) return const [];
    final sp = prefs ?? await SharedPreferences.getInstance();
    final seenFilenames = <String>{};
    final updates = <DatabaseUpdateItem>[];
    for (final asset in manifest.allCatalogAssets) {
      if (!seenFilenames.add(asset.filename)) continue;
      final localInfo = installed[asset.filename];
      if (localInfo == null) continue;
      final recorded = InstalledAssetMetadata.tryParse(
        sp.getString('$_prefInstalledMetaPrefix${asset.filename}'),
      );
      if (recorded == null &&
          await _matchesRemoteChecksumAndBackfillMeta(
            remoteAsset: asset,
            localInfo: localInfo,
            prefs: sp,
          )) {
        continue;
      }
      if (isDatabaseUpdateAvailable(
        remoteAsset: asset,
        installed: localInfo,
        recordedMeta: recorded,
        manifest: manifest,
      )) {
        updates.add(
          DatabaseUpdateItem(
            asset: asset,
            installedVersion: recorded?.version,
            installedUpdated: recorded?.updated,
          ),
        );
      }
    }
    updates.sort(
      (a, b) => _downloadPriority(a.asset).compareTo(_downloadPriority(b.asset)),
    );
    return updates;
  }

  Future<void> setLanguageCode(String code) async {
    final prevCode = state.selectedLanguageCode;
    final nextOptional = Set<String>.from(state.selectedOptionalIds);
    if (prevCode != noLanguageCode) {
      nextOptional.remove('translation_$prevCode');
    }
    if (code != noLanguageCode) {
      nextOptional.add('translation_$code');
    }
    state = state.copyWith(
      selectedLanguageCode: code,
      selectedOptionalIds: nextOptional,
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefLanguageCode, code);
    await prefs.setStringList(
      _prefOptionalAssets,
      nextOptional.toList(growable: false),
    );
  }

  Future<void> setPaliScript(String scriptId) async {
    final normalized = PaliScript.fromId(scriptId).webId;
    state = state.copyWith(selectedPaliScript: normalized);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefPaliScript, normalized);
  }

  Future<void> toggleOptionalAsset(DatabaseAsset asset) async {
    if (asset.compulsory || asset.category == DbCategory.fts) return;
    final next = Set<String>.from(state.selectedOptionalIds);
    if (!next.add(asset.id)) {
      next.remove(asset.id);
    }
    state = state.copyWith(selectedOptionalIds: next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_prefOptionalAssets, next.toList(growable: false));
  }

  static int _downloadPriority(DatabaseAsset asset) {
    if (asset.compulsory && asset.category == DbCategory.core) return 0;
    if (asset.category == DbCategory.dictionary) return 1;
    if (asset.category == DbCategory.translation) return 2;
    return 3;
  }

  bool _needsFtsWorkAfterInstall(String installedFilename) {
    if (installedFilename == 'tipitaka.db' ||
        RegExp(r'^translation_(.+)\.db$').hasMatch(installedFilename)) {
      return true;
    }
    if (state.installedDbs.containsKey('tipitaka.db') &&
        !state.installedDbs.containsKey('fts_tipitaka.db')) {
      return true;
    }
    for (final key in state.installedDbs.keys) {
      final m = RegExp(r'^translation_(.+)\.db$').firstMatch(key);
      if (m != null &&
          !state.installedDbs.containsKey('fts_translation_${m.group(1)}.db')) {
        return true;
      }
    }
    return false;
  }

  List<String> _findMissingTranslationFtsLangs(
    Map<String, InstalledDbInfo> installed,
  ) {
    final transRegex = RegExp(r'^translation_(.+)\.db$');
    final missing = <String>[];
    for (final name in installed.keys) {
      final m = transRegex.firstMatch(name);
      if (m == null) continue;
      final lang = m.group(1)!;
      if (!installed.containsKey('fts_translation_$lang.db')) {
        missing.add(lang);
      }
    }
    missing.sort();
    return missing;
  }

  Future<bool> _pruneInvalidInstalledDatabases({
    required DatabaseManifest bundled,
    required Map<String, InstalledDbInfo> installed,
  }) async {
    var deletedAny = false;
    for (final asset in bundled.compulsoryAssets) {
      final info = installed[asset.filename];
      if (info == null) continue;
      final ok = _storage.hasValidSqliteSchema(
        info.path,
        requiredTables: asset.requiredTables,
      );
      if (!ok) {
        await _storage.deleteDatabase(asset.filename);
        deletedAny = true;
      }
    }

    final transRegex = RegExp(r'^translation_(.+)\.db$');
    for (final entry in installed.entries) {
      final name = entry.key;
      if (name == 'fts_tipitaka.db' ||
          RegExp(r'^fts_translation_.+\.db$').hasMatch(name)) {
        if (!_storage.isPopulatedFtsDb(entry.value.path)) {
          await _storage.deleteDatabase(name);
          deletedAny = true;
        }
      } else if (transRegex.hasMatch(name)) {
        if (!_storage.hasValidSqliteSchema(
          entry.value.path,
          requiredTables: const ['paragraph_translations'],
        )) {
          await _storage.deleteDatabase(name);
          deletedAny = true;
        }
      }
    }
    return deletedAny;
  }

  bool _hasPendingSelectedDownloads([DatabaseManifest? overrideManifest]) {
    final m = overrideManifest ?? state.manifest;
    if (m == null) return false;
    return m.allCatalogAssets.any(
      (a) =>
          a.category != DbCategory.fts &&
          (a.compulsory || state.selectedOptionalIds.contains(a.id)) &&
          !state.installedDbs.containsKey(a.filename),
    );
  }

  /// Marks onboarding complete once every required DB and FTS index is verified.
  Future<bool> completeOnboarding() async {
    if (!state.allCompulsoryInstalled) return false;
    if (!state.hasRequiredFtsReady) {
      await ensureMissingFtsIndexed();
    }
    await refreshInstalled();
    if (!state.allCompulsoryInstalled || !state.hasRequiredFtsReady) {
      return false;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefOnboardingInProgress, false);
    await prefs.setBool(_prefOnboardingCompleted, true);
    if (!_disposed) {
      state = state.copyWith(
        onboardingCompleted: true,
        onboardingInterrupted: false,
      );
    }
    return true;
  }

  Future<void> _markOnboardingInProgress() async {
    if (state.onboardingCompleted) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefOnboardingInProgress, true);
    await prefs.setBool(_prefOnboardingCompleted, false);
  }

  Future<bool> _downloadBatch(
    List<DatabaseAsset> toDownload, {
    bool forceReindexUpdated = false,
  }) async {
    await _markOnboardingInProgress();
    var batchAborted = false;
    var ftsHadError = false;
    if (toDownload.isNotEmpty) {
      for (final asset in toDownload) {
        _updateTransfer(
          DownloadProgress(
            assetId: asset.id,
            filename: asset.filename,
            phase: TransferPhase.queued,
            totalBytes: asset.zipSize,
            message: 'Queued...',
          ),
        );
      }

      await _withWakelock(() async {
        final updatedFiles = <String>{};
        try {
          for (final asset in toDownload) {
            final current = state.transfers[asset.id];
            if (current?.phase == TransferPhase.cancelled) {
              batchAborted = true;
              break;
            }
            await downloadAsset(
              asset,
              useWakelock: false,
              indexOnComplete: false,
            );
            final after = state.transfers[asset.id];
            if (after?.phase == TransferPhase.completed) {
              updatedFiles.add(asset.filename);
            } else {
              batchAborted = true;
              if (after?.error != null && after!.error!.isNotEmpty) {
                state = state.copyWith(releaseWarning: after.error);
              }
              break;
            }
          }
        } finally {
          // Clear any leftover queued entries so interrupted batches never stay
          // stuck with `hasActiveTransfers == true`.
          final nextTransfers = Map<String, DownloadProgress>.from(
            state.transfers,
          );
          var removedQueued = false;
          for (final asset in toDownload) {
            final tr = nextTransfers[asset.id];
            if (tr?.phase == TransferPhase.queued) {
              nextTransfers.remove(asset.id);
              removedQueued = true;
            }
          }
          if (removedQueued && !_disposed) {
            state = state.copyWith(transfers: nextTransfers);
          }
        }

        if (!batchAborted && !state.hasActiveTransfers) {
          final transRegex = RegExp(r'^translation_(.+)\.db$');
          final updatedLangs = forceReindexUpdated
              ? updatedFiles
                    .map((f) => transRegex.firstMatch(f)?.group(1))
                    .whereType<String>()
                    .toSet()
              : const <String>{};
          final ftsResult = await _runMissingFtsIndexing(
            forceTipitaka:
                forceReindexUpdated && updatedFiles.contains('tipitaka.db'),
            forceTranslationLangs: updatedLangs,
          );
          ftsHadError = ftsResult.hadError;
        } else if (batchAborted &&
            !state.hasActiveTransfers &&
            state.installedDbs.containsKey('tipitaka.db')) {
          // Ensure core Pāḷi FTS is still built first if tipitaka.db finished
          // before a subsequent failure/interruption.
          final ftsResult = await _runMissingFtsIndexing(preserveWarning: true);
          ftsHadError = ftsResult.hadError;
        }
      });
    } else if (!state.hasActiveTransfers) {
      final ftsResult = await _runMissingFtsIndexing();
      ftsHadError = ftsResult.hadError;
    }

    return !batchAborted &&
        !ftsHadError &&
        !state.hasActiveTransfers &&
        state.releaseWarning == null;
  }

  Future<void> _autoCompleteOnboardingIfReady() async {
    if (_disposed ||
        state.onboardingCompleted ||
        state.releaseWarning != null ||
        state.hasActiveTransfers ||
        state.isIndexingFts ||
        !state.allCompulsoryInstalled ||
        !state.hasRequiredFtsReady ||
        _hasPendingSelectedDownloads()) {
      return;
    }
    await completeOnboarding();
  }

  Future<DatabaseManifest?> _ensureManifestReadyForDownload({
    bool silentOffline = true,
  }) async {
    if (!state.fetchedLiveRelease) {
      await refreshReleaseManifest(silentOffline: silentOffline);
    } else if (_inFlightManifestRefresh != null) {
      await _inFlightManifestRefresh;
    }
    return state.manifest;
  }

  Future<void> downloadRequiredAndSelected() async {
    final manifest = state.manifest;
    if (manifest == null) return;

    state = state.copyWith(isBatchInstalling: true, clearWarning: true);
    try {
      final activeManifest =
          await _ensureManifestReadyForDownload(silentOffline: false) ??
          manifest;

      final toDownload = activeManifest.allCatalogAssets.where((asset) {
        if (asset.category == DbCategory.fts) return false;
        final wanted =
            asset.compulsory || state.selectedOptionalIds.contains(asset.id);
        return wanted && !state.installedDbs.containsKey(asset.filename);
      }).toList()
        ..sort((a, b) => _downloadPriority(a).compareTo(_downloadPriority(b)));

      final batchOk = await _downloadBatch(toDownload);
      if (batchOk) {
        await _autoCompleteOnboardingIfReady();
      }
    } finally {
      if (!_disposed) {
        state = state.copyWith(isBatchInstalling: false);
      }
    }
  }

  Future<void> downloadAssetsGroup(List<DatabaseAsset> assets) async {
    if (state.manifest == null) return;

    state = state.copyWith(isBatchInstalling: true, clearWarning: true);
    try {
      final activeManifest = await _ensureManifestReadyForDownload(
        silentOffline: true,
      );
      if (activeManifest == null) return;

      final pending = assets
          .map(
            (a) =>
                activeManifest.findAsset(id: a.id, filename: a.filename) ?? a,
          )
          .where((a) => !state.installedDbs.containsKey(a.filename))
          .toList()
        ..sort((a, b) => _downloadPriority(a).compareTo(_downloadPriority(b)));
      if (pending.isEmpty) return;

      final batchOk = await _downloadBatch(pending);
      if (batchOk) {
        await _autoCompleteOnboardingIfReady();
      }
    } finally {
      if (!_disposed) {
        state = state.copyWith(isBatchInstalling: false);
      }
    }
  }

  void cancelAssetsGroup(List<DatabaseAsset> assets) {
    for (final a in assets) {
      cancelDownload(a.id);
    }
  }

  Future<void> downloadAsset(
    DatabaseAsset asset, {
    bool useWakelock = true,
    bool indexOnComplete = true,
  }) async {
    if (_inFlightManifestRefresh != null) {
      await _inFlightManifestRefresh;
    } else if (!state.fetchedLiveRelease && !state.isBatchInstalling) {
      await refreshReleaseManifest(silentOffline: true);
    }
    var manifest = state.manifest;
    if (manifest == null) return;

    var targetAsset =
        manifest.findAsset(id: asset.id, filename: asset.filename) ?? asset;
    var resolvedUrl = manifest.resolveDownloadUrl(
      targetAsset,
      overrideRepo: GitHubReleaseService.defaultRepo,
      overrideTag: GitHubReleaseService.defaultTag,
    );

    if (!state.fetchedLiveRelease && (resolvedUrl == null || resolvedUrl.isEmpty)) {
      final res = await refreshReleaseManifest();
      manifest = res.manifest;
      targetAsset =
          manifest.findAsset(id: asset.id, filename: asset.filename) ??
          targetAsset;
      resolvedUrl = manifest.resolveDownloadUrl(
        targetAsset,
        overrideRepo: GitHubReleaseService.defaultRepo,
        overrideTag: GitHubReleaseService.defaultTag,
      );
    }

    if (resolvedUrl == null || resolvedUrl.isEmpty) {
      _updateTransfer(
        DownloadProgress(
          assetId: targetAsset.id,
          filename: targetAsset.filename,
          phase: TransferPhase.failed,
          error:
              'Asset ${targetAsset.assetName} is not yet uploaded to GitHub release.',
        ),
      );
      return;
    }

    _tokens[targetAsset.id]?.cancel();
    final token = DownloadCancellationToken();
    _tokens[targetAsset.id] = token;

    Future<void> run() async {
      try {
        await _downloadService.downloadAndInstallAsset(
          targetAsset,
          url: resolvedUrl!,
          token: token,
          onProgress: _updateTransfer,
        );
        await _recordInstalledAssetMeta(targetAsset);
        final shouldIndexNow =
            indexOnComplete &&
            !state.hasActiveTransfers &&
            _needsFtsWorkAfterInstall(targetAsset.filename);
        if (shouldIndexNow) {
          state = state.copyWith(
            indexingMessage: 'Preparing full-text search index...',
            clearWarning: true,
          );
        }
        await refreshInstalled();
        var ftsOk = true;
        if (shouldIndexNow) {
          ftsOk = await _indexAfterInstall(targetAsset.filename);
        }
        if (indexOnComplete && ftsOk) {
          await _autoCompleteOnboardingIfReady();
        }
      } on DownloadCancelledException {
        // Progress already reflects paused/cancelled state.
      } catch (_) {
        // Progress already reflects failure message.
      } finally {
        _tokens.remove(targetAsset.id);
      }
    }

    if (useWakelock) {
      await _withWakelock(run);
    } else {
      await run();
    }
  }

  /// Downloads a translation pack (`translation_<langCode>.db`) from our
  /// GitHub release if not yet installed, builds its in-app FTS5 index, and
  /// returns `true` when ready for use.
  Future<bool> downloadAndIndexLanguage(String langCode) async {
    final normalized = langCode.trim().toLowerCase();
    var manifest = state.manifest;
    if (manifest == null) {
      final res = await refreshReleaseManifest();
      manifest = res.manifest;
    }
    final langPack = manifest.languages[normalized];
    if (langPack == null) {
      state = state.copyWith(
        releaseWarning: 'Translation pack "$normalized" is not in the catalog.',
      );
      return false;
    }

    final asset = langPack.translationDb;
    if (!state.installedDbs.containsKey(asset.filename)) {
      await downloadAsset(asset);
    }

    if (!state.installedDbs.containsKey(asset.filename)) {
      return false;
    }

    if (!state.selectedOptionalIds.contains(asset.id)) {
      final nextOptional = Set<String>.from(state.selectedOptionalIds)
        ..add(asset.id);
      if (!_disposed) {
        state = state.copyWith(selectedOptionalIds: nextOptional);
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(
        _prefOptionalAssets,
        nextOptional.where((id) => !id.startsWith('fts_')).toList()..sort(),
      );
    }

    await ensureMissingFtsIndexed();
    return state.installedDbs.containsKey(asset.filename);
  }

  /// Downloads and verifies `pali_sentences.db` when enabling sentence-by-sentence mode.
  Future<bool> downloadPaliSentences() async {
    var manifest = state.manifest;
    if (manifest == null) {
      final res = await refreshReleaseManifest();
      manifest = res.manifest;
    }
    final asset = manifest.core['pali_sentences'];
    if (asset == null) {
      state = state.copyWith(
        releaseWarning: 'Pāḷi sentence index is not in the catalog.',
      );
      return false;
    }

    if (!state.installedDbs.containsKey(asset.filename)) {
      await downloadAsset(asset);
    }
    return state.installedDbs.containsKey(asset.filename);
  }

  Future<bool> _indexAfterInstall(String filename) async {
    final match = RegExp(r'^translation_(.+)\.db$').firstMatch(filename);
    final res = await _runMissingFtsIndexing(
      forceTipitaka: filename == 'tipitaka.db',
      forceTranslationLang: match?.group(1),
    );
    return !res.hadError;
  }

  /// Builds any missing `fts_tipitaka.db` or `fts_translation_*.db` files in
  /// the background isolate from locally installed databases.
  ///
  /// Returns `true` if at least one FTS5 database was built or rebuilt.
  /// When [autoCompleteOnboarding] is `true` and indexing finishes without error
  /// while all required databases and FTS indexes are ready, completes
  /// onboarding automatically so the UI enters the app directly.
  Future<bool> ensureMissingFtsIndexed({
    bool force = false,
    bool forceTipitaka = false,
    String? forceTranslationLang,
    Set<String> forceTranslationLangs = const {},
    bool autoCompleteOnboarding = false,
  }) async {
    final result = await _runMissingFtsIndexing(
      force: force,
      forceTipitaka: forceTipitaka,
      forceTranslationLang: forceTranslationLang,
      forceTranslationLangs: forceTranslationLangs,
    );
    if (autoCompleteOnboarding && !result.hadError && !state.isBatchInstalling) {
      await _autoCompleteOnboardingIfReady();
    }
    return result.builtAny;
  }

  Future<({bool builtAny, bool hadError})> _runMissingFtsIndexing({
    bool force = false,
    bool forceTipitaka = false,
    String? forceTranslationLang,
    Set<String> forceTranslationLangs = const {},
    bool preserveWarning = false,
  }) {
    return _enqueueFts(() async {
      if (_disposed) return (builtAny: false, hadError: false);
      state = state.copyWith(
        indexingMessage: 'Preparing full-text search index...',
        clearWarning: !preserveWarning,
      );
      var builtAny = false;
      var hadError = false;
      try {
        final dir = await _storage.getDatabaseDirectory();
        final installed = await _storage.listInstalledDatabases();
        if (_disposed) return (builtAny: builtAny, hadError: hadError);

        final jobs =
            <({
              String? langCode,
              bool isBoldIndex,
              bool forceRebuild,
              String label,
              String filename,
            })>[];
        if (!installed.containsKey('tipitaka.db')) {
          return (builtAny: false, hadError: false);
        }
        final paliFtsPath = '${dir.path}/fts_tipitaka.db';
        final paliFtsValid = _storage.isPopulatedFtsDb(paliFtsPath);
        if (force || forceTipitaka || !paliFtsValid) {
          jobs.add((
            langCode: null,
            isBoldIndex: false,
            forceRebuild: force || forceTipitaka || !paliFtsValid,
            label: 'Pāḷi Canon',
            filename: 'fts_tipitaka.db',
          ));
        }

        final boldIndexValid = BoldDefinitionIndexService.isUpToDate(dir.path);
        if (force || forceTipitaka || !boldIndexValid) {
          jobs.add((
            langCode: null,
            isBoldIndex: true,
            forceRebuild: force || forceTipitaka || !boldIndexValid,
            label: 'Bold Definitions',
            filename: BoldDefinitionIndexService.dbFilename,
          ));
        }

        final transRegex = RegExp(r'^translation_(.+)\.db$');
        final translationFiles = installed.keys
            .map((name) => transRegex.firstMatch(name))
            .whereType<RegExpMatch>()
            .map((m) => m.group(1)!)
            .toList()
          ..sort();

        for (final langCode in translationFiles) {
          final ftsFilename = 'fts_translation_$langCode.db';
          final ftsValid = _storage.isPopulatedFtsDb('${dir.path}/$ftsFilename');
          final shouldRebuildLang =
              force ||
              forceTranslationLang == langCode ||
              forceTranslationLangs.contains(langCode) ||
              !ftsValid;
          if (shouldRebuildLang) {
            final langName =
                state.manifest?.languages[langCode]?.name ??
                langCode.toUpperCase();
            jobs.add((
              langCode: langCode,
              isBoldIndex: false,
              forceRebuild: shouldRebuildLang,
              label: '$langName Translation',
              filename: ftsFilename,
            ));
          }
        }

        final totalTasks = jobs.length;
        for (var i = 0; i < jobs.length; i++) {
          if (_disposed) return (builtAny: builtAny, hadError: hadError);
          final job = jobs[i];
          void emitProgress(FtsBuildProgress p) {
            if (_disposed) return;
            final overall = ((i + p.progress) / totalTasks).clamp(0.0, 1.0);
            state = state.copyWith(
              indexingMessage:
                  'Indexing ${job.label} (${(overall * 100).round()}%)...',
              indexingStatus: FtsIndexingStatus(
                taskLabel: job.label,
                filename: job.filename,
                stage: p.stage,
                taskIndex: i + 1,
                totalTasks: totalTasks,
                processedRows: p.processedRows,
                totalRows: p.totalRows,
                taskProgress: p.progress,
                overallProgress: overall,
                detail: p.detail,
              ),
              clearWarning: !preserveWarning && !hadError,
            );
          }

          emitProgress(
            FtsBuildProgress(
              filename: job.filename,
              stage: FtsBuildStage.preparing,
              progress: 0.0,
              detail: 'Preparing ${job.label}...',
            ),
          );

          try {
            if (job.isBoldIndex) {
              emitProgress(
                FtsBuildProgress(
                  filename: job.filename,
                  stage: FtsBuildStage.indexing,
                  progress: 0.15,
                  detail: 'Extracting bold definitions from Pāḷi Canon...',
                ),
              );
              await BoldDefinitionIndexService().ensureBuilt(
                dbDirPath: dir.path,
                force: job.forceRebuild,
              );
              emitProgress(
                FtsBuildProgress(
                  filename: job.filename,
                  stage: FtsBuildStage.completed,
                  progress: 1.0,
                  detail: 'Bold definitions ready.',
                ),
              );
            } else if (job.langCode == null) {
              await _ftsService.buildPaliFtsIndex(
                dbDirPath: dir.path,
                force: job.forceRebuild,
                onProgress: emitProgress,
              );
              if (!_storage.isPopulatedFtsDb(paliFtsPath)) {
                throw StateError(
                  'Core Pāḷi FTS index verification failed.',
                );
              }
            } else {
              // Core Pāḷi FTS must always exist and be valid before any
              // translation FTS is processed.
              if (!_storage.isPopulatedFtsDb(paliFtsPath)) {
                return (builtAny: builtAny, hadError: hadError);
              }
              await _ftsService.buildTranslationFtsIndex(
                dbDirPath: dir.path,
                langCode: job.langCode!,
                force: job.forceRebuild,
                onProgress: emitProgress,
              );
            }
            builtAny = true;
            await refreshInstalled();
          } catch (e) {
            hadError = true;
            if (!_disposed) {
              final prefix = job.isBoldIndex
                  ? 'Bold definitions indexing error'
                  : job.langCode == null
                  ? 'Pāḷi FTS5 indexing error'
                  : 'Translation FTS5 (${job.langCode}) indexing error';
              state = state.copyWith(releaseWarning: '$prefix: $e');
            }
            if (!job.isBoldIndex && job.langCode == null) {
              // Abort translation FTS jobs if core Pāḷi FTS failed.
              return (builtAny: builtAny, hadError: hadError);
            }
          }
        }
      } finally {
        if (!_disposed) {
          state = state.copyWith(clearIndexingMessage: true);
        }
      }
      return (builtAny: builtAny, hadError: hadError);
    });
  }

  Future<T> _enqueueFts<T>(Future<T> Function() task) {
    final next = _ftsQueue.then((_) => task(), onError: (_) => task());
    _ftsQueue = next.then((_) {}, onError: (_) {});
    return next;
  }

  void cancelDownload(String assetId) {
    _tokens[assetId]?.cancel();
    final current = state.transfers[assetId];
    if (current != null && current.phase == TransferPhase.queued) {
      _updateTransfer(
        DownloadProgress(
          assetId: assetId,
          filename: current.filename,
          phase: TransferPhase.cancelled,
          message: 'Paused',
        ),
      );
    }
  }

  Future<void> importLocalArchiveOrDb({
    required String localPath,
    required DatabaseAsset targetAsset,
  }) async {
    await _withWakelock(() async {
      try {
        await _downloadService.importLocalFile(
          localPath,
          targetAsset,
          onProgress: _updateTransfer,
        );
        await _recordInstalledAssetMeta(targetAsset);
        final shouldIndexNow = _needsFtsWorkAfterInstall(targetAsset.filename);
        if (shouldIndexNow) {
          state = state.copyWith(
            indexingMessage: 'Preparing full-text search index...',
            clearWarning: true,
          );
        }
        await refreshInstalled();
        var ftsOk = true;
        if (shouldIndexNow) {
          ftsOk = await _indexAfterInstall(targetAsset.filename);
        }
        if (ftsOk) {
          await _autoCompleteOnboardingIfReady();
        }
      } catch (_) {
        // Failure surfaced in transfer state.
      }
    });
  }

  Future<DbVerificationResult> verifyInstalledAsset(DatabaseAsset asset) async {
    final dbPath = await _storage.installedDbPath(asset.filename);
    final result = await _storage.verifyAndPrepareSqliteDb(
      dbPath,
      requiredTables: asset.requiredTables,
      expectedBytes: asset.dbSize > 0 ? asset.dbSize : null,
      expectedSha256: asset.checksum,
    );
    final updatedMap = Map<String, InstalledDbInfo>.from(state.installedDbs);
    final existing = updatedMap[asset.filename];
    if (existing != null) {
      updatedMap[asset.filename] = InstalledDbInfo(
        filename: existing.filename,
        path: existing.path,
        sizeBytes: result.sizeBytes,
        modifiedAt: existing.modifiedAt,
        validSqlite: result.valid,
        missingTables: result.missingTables,
        verificationError: result.error,
      );
      state = state.copyWith(installedDbs: updatedMap);
    }
    return result;
  }

  Future<void> deleteInstalledAsset(String filename) async {
    await _storage.deleteDatabase(filename);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_prefInstalledMetaPrefix$filename');
    await refreshInstalled();
  }

  void _updateTransfer(DownloadProgress progress) {
    if (_disposed) return;
    final next = Map<String, DownloadProgress>.from(state.transfers);
    next[progress.assetId] = progress;
    state = state.copyWith(transfers: next);
  }

  Future<void> _withWakelock(Future<void> Function() action) async {
    final canLock = !kIsWeb;
    if (canLock) {
      try {
        await WakelockPlus.enable();
      } catch (_) {}
    }
    try {
      await action();
    } finally {
      if (canLock) {
        try {
          await WakelockPlus.disable();
        } catch (_) {}
      }
    }
  }
}
