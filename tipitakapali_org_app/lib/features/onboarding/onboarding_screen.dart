import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/fts/fts_index_service.dart';
import '../../core/models/db_manifest.dart';
import '../../core/services/github_release_service.dart';
import '../../core/storage/db_storage_service.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/formatters.dart';
import '../../core/utils/pali_script_converter.dart';
import '../downloads/download_controller.dart';
import '../downloads/download_service.dart';

/// First-run setup screen modeled on epitaka_app's IndexGate setup wizard.
/// Automatically connects to our official GitHub release without requiring
/// manual repository or URL input.
class OnboardingWizardScreen extends ConsumerStatefulWidget {
  final VoidCallback onCompleted;

  const OnboardingWizardScreen({super.key, required this.onCompleted});

  @override
  ConsumerState<OnboardingWizardScreen> createState() =>
      _OnboardingWizardScreenState();
}

class _OnboardingWizardScreenState
    extends ConsumerState<OnboardingWizardScreen> {
  bool _notifiedCompleted = false;

  Future<void> _pickAndImport(DatabaseAsset asset) async {
    final picked = await FilePicker.pickFiles(
      dialogTitle: 'Select ${asset.assetName} or ${asset.filename}',
      type: FileType.custom,
      allowedExtensions: const ['zip', 'db', 'sqlite'],
    );
    final path = picked.isNotEmpty ? picked.first.path : null;
    if (path == null) return;
    await ref
        .read(downloadControllerProvider.notifier)
        .importLocalArchiveOrDb(localPath: path, targetAsset: asset);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<DownloadCenterState>(downloadControllerProvider, (prev, next) {
      final prevReady =
          prev != null &&
          prev.onboardingCompleted &&
          !prev.needsOnboarding &&
          !prev.isBatchInstalling &&
          !prev.hasActiveTransfers &&
          !prev.isIndexingFts;
      final nextReady =
          next.onboardingCompleted &&
          !next.needsOnboarding &&
          !next.isBatchInstalling &&
          !next.hasActiveTransfers &&
          !next.isIndexingFts;
      if (!_notifiedCompleted && !prevReady && nextReady) {
        _notifiedCompleted = true;
        widget.onCompleted();
      }
    });

    final state = ref.watch(downloadControllerProvider);
    final controller = ref.read(downloadControllerProvider.notifier);
    final colors = Theme.of(context).colorScheme;
    final manifest = state.manifest;

    if (manifest == null) {
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(color: colors.primary),
                const SizedBox(height: 12),
                Text(
                  'Loading database catalog...',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final requiredCoreAssets = manifest.core.values
        .where((a) => a.compulsory)
        .toList(growable: false);
    final requiredDictAssets = manifest.dictionaries.values
        .where((a) => a.compulsory)
        .toList(growable: false);
    final optionalDictAssets = manifest.dictionaries.values
        .where((a) => !a.compulsory)
        .toList(growable: false);
    final requiredTranslations = manifest.languages.values
        .map((l) => l.translationDb)
        .where((a) => a.compulsory)
        .toList(growable: false);

    final activeLang = manifest.languages[state.selectedLanguageCode];
    final additionalLangAsset = (activeLang != null &&
            !activeLang.translationDb.compulsory)
        ? activeLang.translationDb
        : null;

    final pendingAssets = manifest.allCatalogAssets
        .where(
          (a) =>
              a.category != DbCategory.fts &&
              (a.compulsory || state.selectedOptionalIds.contains(a.id)) &&
              !state.installedDbs.containsKey(a.filename),
        )
        .toList(growable: false);
    final pendingSelectedCount = pendingAssets.length;
    final totalDownloadBytes = pendingAssets.fold<int>(
      0,
      (sum, a) => sum + a.estimatedDownloadBytes,
    );
    final totalRequiredBytes = manifest.allCatalogAssets
        .where(
          (a) => a.category != DbCategory.fts && a.compulsory,
        )
        .fold<int>(0, (sum, a) => sum + a.estimatedDownloadBytes);

    if (state.isIndexingFts) {
      return _OnboardingFtsIndexingView(
        status: state.indexingStatus,
        fallbackMessage: state.indexingMessage,
      );
    }

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              children: [
                // ── Header matching epitaka_app ────────────────────────
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 22, 20, 8),
                  child: Column(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          color: colors.primaryContainer,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Icon(
                          Icons.menu_book_rounded,
                          size: 36,
                          color: colors.primary,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Welcome to TipitakaPali.org',
                        style: Theme.of(context).textTheme.headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w700),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Download the offline canon & translation databases from our official GitHub release.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),

                // ── Scrollable Cards ───────────────────────────────────
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                    children: [
                      // Required databases header
                      Text(
                        'Required Databases',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: colors.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Essential Pāḷi canon texts and offline dictionaries (required total ${formatBytes(totalRequiredBytes)}).',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (requiredCoreAssets.isNotEmpty) ...[
                        _OnboardingAssetGroupCard(
                          title: 'Tipiṭaka Pāḷi Text (CST)',
                          subtitle:
                              'Canon books, chapters & parallel MAT structure',
                          icon: Icons.menu_book_rounded,
                          assets: requiredCoreAssets,
                          installedDbs: state.installedDbs,
                          transfers: state.transfers,
                          isRequired: true,
                          onDownloadAll: () =>
                              controller.downloadAssetsGroup(requiredCoreAssets),
                          onPauseAll: () =>
                              controller.cancelAssetsGroup(requiredCoreAssets),
                        ),
                        const SizedBox(height: 10),
                      ],
                      if (requiredDictAssets.isNotEmpty) ...[
                        _OnboardingAssetGroupCard(
                          title: 'Pāḷi Dictionaries (All)',
                          subtitle: 'Complete offline Pāḷi & Sanskrit lexicons',
                          icon: Icons.library_books_rounded,
                          assets: requiredDictAssets,
                          installedDbs: state.installedDbs,
                          transfers: state.transfers,
                          isRequired: true,
                          onDownloadAll: () =>
                              controller.downloadAssetsGroup(requiredDictAssets),
                          onPauseAll: () =>
                              controller.cancelAssetsGroup(requiredDictAssets),
                        ),
                        const SizedBox(height: 10),
                      ],
                      for (final asset in requiredTranslations) ...[
                        _OnboardingAssetCard(
                          asset: asset,
                          manifest: manifest,
                          installed: state.installedDbs[asset.filename],
                          progress: state.transfers[asset.id],
                          isRequired: true,
                          selected: true,
                          onToggleSelected: null,
                          onDownload: () => controller.downloadAsset(asset),
                          onPause: () => controller.cancelDownload(asset.id),
                          onImport: () => _pickAndImport(asset),
                        ),
                        const SizedBox(height: 10),
                      ],

                      const SizedBox(height: 6),
                      Text(
                        'Pāḷi Display Script',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        'You can change this anytime in the reader Language Menu.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _PaliScriptSelectorCard(
                        selectedScriptId: state.selectedPaliScript,
                        onChanged: controller.setPaliScript,
                      ),

                      const SizedBox(height: 14),
                      Text(
                        'Optional AI Translation',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        'You can always download it later in the language menu.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _LanguageSelectorCard(
                        selectedCode: state.selectedLanguageCode,
                        languages: manifest.languages,
                        onChanged: controller.setLanguageCode,
                      ),
                      if (additionalLangAsset != null) ...[
                        const SizedBox(height: 10),
                        _OnboardingAssetCard(
                          asset: additionalLangAsset,
                          manifest: manifest,
                          installed:
                              state.installedDbs[additionalLangAsset.filename],
                          progress: state.transfers[additionalLangAsset.id],
                          isRequired: false,
                          selected: state.selectedOptionalIds.contains(
                            additionalLangAsset.id,
                          ),
                          onToggleSelected: () => controller
                              .toggleOptionalAsset(additionalLangAsset),
                          onDownload: () =>
                              controller.downloadAsset(additionalLangAsset),
                          onPause: () => controller
                              .cancelDownload(additionalLangAsset.id),
                          onImport: () => _pickAndImport(additionalLangAsset),
                        ),
                      ],

                      if (optionalDictAssets.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        Text(
                          'Optional Dictionaries',
                          style: Theme.of(context).textTheme.labelLarge
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 8),
                        for (final asset in optionalDictAssets) ...[
                          _OnboardingAssetCard(
                            asset: asset,
                            manifest: manifest,
                            installed: state.installedDbs[asset.filename],
                            progress: state.transfers[asset.id],
                            isRequired: false,
                            selected: state.selectedOptionalIds.contains(
                              asset.id,
                            ),
                            onToggleSelected: () =>
                                controller.toggleOptionalAsset(asset),
                            onDownload: () => controller.downloadAsset(asset),
                            onPause: () => controller.cancelDownload(asset.id),
                            onImport: () => _pickAndImport(asset),
                          ),
                          const SizedBox(height: 10),
                        ],
                      ],

                      const SizedBox(height: 12),
                      const _FeatureGuidePreview(),
                    ],
                  ),
                ),

                // ── Sticky Bottom Bar ──────────────────────────────────
                Container(
                  padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHighest,
                    border: Border(
                      top: BorderSide(
                        color: colors.outlineVariant.withValues(alpha: 0.7),
                      ),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (pendingAssets.isNotEmpty) ...[
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                'Total to download ($pendingSelectedCount files)',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(color: colors.onSurfaceVariant),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              formatBytes(totalDownloadBytes),
                              maxLines: 1,
                              softWrap: false,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    fontFeatures: const [
                                      FontFeature.tabularFigures(),
                                    ],
                                  ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (state.releaseWarning != null ||
                          state.onboardingInterrupted) ...[
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: colors.errorContainer.withValues(alpha: 0.45),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: colors.error.withValues(alpha: 0.4),
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.warning_amber_rounded,
                                size: 16,
                                color: colors.error,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  state.releaseWarning ??
                                      'Previous setup was interrupted. Please complete the required downloads and search indexing.',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodySmall
                                      ?.copyWith(color: colors.onErrorContainer),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                      Builder(
                        builder: (context) {
                          final isBusy = state.isBatchInstalling ||
                              state.hasActiveTransfers ||
                              state.isIndexingFts;
                          const spinner = SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          );
                          return Row(
                            children: [
                              if (!state.allCompulsoryInstalled)
                                Expanded(
                                  child: FilledButton.icon(
                                    onPressed: isBusy
                                        ? null
                                        : controller
                                            .downloadRequiredAndSelected,
                                    icon: isBusy
                                        ? spinner
                                        : const Icon(Icons.download),
                                    label: Text(
                                      state.isIndexingFts
                                          ? (state.indexingMessage ??
                                              'Indexing full-text search...')
                                          : (state.isBatchInstalling ||
                                                  state.hasActiveTransfers)
                                              ? 'Downloading...'
                                              : 'Download All (${formatBytes(totalDownloadBytes)})',
                                      maxLines: 1,
                                      softWrap: false,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontFeatures: [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                    ),
                                  ),
                                )
                              else if (!state.hasRequiredFtsReady) ...[
                                if (pendingSelectedCount > 0 && !isBusy) ...[
                                  OutlinedButton.icon(
                                    onPressed:
                                        controller.downloadRequiredAndSelected,
                                    icon: const Icon(Icons.download),
                                    label: Text(
                                      'Get $pendingSelectedCount More (${formatBytes(totalDownloadBytes)})',
                                      maxLines: 1,
                                      softWrap: false,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                ],
                                Expanded(
                                  child: FilledButton.icon(
                                    onPressed: isBusy
                                        ? null
                                        : () => controller
                                            .ensureMissingFtsIndexed(
                                              autoCompleteOnboarding: true,
                                            ),
                                    icon: isBusy
                                        ? spinner
                                        : const Icon(Icons.manage_search),
                                    label: Text(
                                      state.isIndexingFts
                                          ? (state.indexingMessage ??
                                              'Indexing full-text search...')
                                          : (state.isBatchInstalling ||
                                                  state.hasActiveTransfers)
                                              ? 'Downloading remaining packs...'
                                              : 'Finish Indexing & Enter',
                                      maxLines: 1,
                                      softWrap: false,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ),
                              ] else ...[
                                if (pendingSelectedCount > 0 && !isBusy)
                                  OutlinedButton.icon(
                                    onPressed:
                                        controller.downloadRequiredAndSelected,
                                    icon: const Icon(Icons.download),
                                    label: Text(
                                      'Get $pendingSelectedCount More (${formatBytes(totalDownloadBytes)})',
                                      maxLines: 1,
                                      softWrap: false,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                if (pendingSelectedCount > 0 && !isBusy)
                                  const SizedBox(width: 10),
                                Expanded(
                                  child: FilledButton.icon(
                                    onPressed: isBusy
                                        ? null
                                        : () async {
                                            await controller
                                                .completeOnboarding();
                                            widget.onCompleted();
                                          },
                                    icon: isBusy
                                        ? spinner
                                        : const Icon(Icons.arrow_forward),
                                    label: Text(
                                      state.isIndexingFts
                                          ? (state.indexingMessage ??
                                              'Indexing FTS5...')
                                          : (state.isBatchInstalling ||
                                                  state.hasActiveTransfers)
                                              ? 'Downloading remaining packs...'
                                              : 'Enter Library',
                                      maxLines: 1,
                                      softWrap: false,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PaliScriptSelectorCard extends StatelessWidget {
  final String selectedScriptId;
  final ValueChanged<String> onChanged;

  const _PaliScriptSelectorCard({
    required this.selectedScriptId,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final currentValue = PaliScript.fromId(selectedScriptId).webId;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.text_fields_rounded,
                  size: 22,
                  color: colors.primary,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Pāḷi Display Script',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'Pre-selects your preferred script for Pāḷi canon texts',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: colors.outlineVariant),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: currentValue,
                isExpanded: true,
                onChanged: (val) {
                  if (val != null) onChanged(val);
                },
                items: PaliScript.values
                    .map(
                      (script) => DropdownMenuItem<String>(
                        value: script.webId,
                        child: Text(
                          '${script.englishName} (${script.nativeName})',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(growable: false),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LanguageSelectorCard extends StatelessWidget {
  final String selectedCode;
  final Map<String, LanguagePack> languages;
  final ValueChanged<String> onChanged;

  const _LanguageSelectorCard({
    required this.selectedCode,
    required this.languages,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final entries = languages.values.toList(growable: false);
    final currentValue = selectedCode == DownloadController.noLanguageCode ||
            languages.containsKey(selectedCode)
        ? selectedCode
        : (entries.isNotEmpty
              ? entries.first.code
              : DownloadController.noLanguageCode);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.translate, size: 22, color: colors.primary),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AI Translation Language',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'Pre-selects an optional AI-assisted translation database',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: colors.outlineVariant),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: currentValue,
                isExpanded: true,
                onChanged: (val) {
                  if (val != null) onChanged(val);
                },
                items: [
                  const DropdownMenuItem<String>(
                    value: DownloadController.noLanguageCode,
                    child: Text(
                      'None - Pāḷi text only',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  ...entries.map(
                    (lang) => DropdownMenuItem<String>(
                      value: lang.code,
                      child: Text(
                        '${lang.displayFlag} ${lang.name} (${lang.nativeName})',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: Colors.amber.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Colors.amber.withValues(alpha: 0.35),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  size: 16,
                  color: Colors.amber.shade800,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'AI Translation Note: Translations are AI-assisted (adapted from Epitaka) and may contain inaccuracies. Please use them as study aids and verify against the original Pāḷi text.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OnboardingAssetGroupCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final List<DatabaseAsset> assets;
  final Map<String, InstalledDbInfo> installedDbs;
  final Map<String, DownloadProgress> transfers;
  final bool isRequired;
  final VoidCallback onDownloadAll;
  final VoidCallback onPauseAll;

  const _OnboardingAssetGroupCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.assets,
    required this.installedDbs,
    required this.transfers,
    required this.isRequired,
    required this.onDownloadAll,
    required this.onPauseAll,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final installedList = <InstalledDbInfo>[
      for (final a in assets)
        if (installedDbs.containsKey(a.filename)) installedDbs[a.filename]!,
    ];
    final allInstalled =
        assets.isNotEmpty && installedList.length == assets.length;
    final activeTransfers = [
      for (final a in assets)
        if (transfers[a.id]?.isActive ?? false) transfers[a.id]!,
    ];
    final anyActive = activeTransfers.isNotEmpty;
    final failedTransfer = [
      for (final a in assets)
        if (!installedDbs.containsKey(a.filename) &&
            transfers[a.id]?.phase == TransferPhase.failed &&
            transfers[a.id]?.error != null)
          transfers[a.id]!,
    ].firstOrNull;

    final totalGroupDownloadBytes = assets.fold<int>(
      0,
      (sum, a) => sum + a.estimatedDownloadBytes,
    );
    final remainingDownloadBytes = assets
        .where((a) => !installedDbs.containsKey(a.filename))
        .fold<int>(0, (sum, a) => sum + a.estimatedDownloadBytes);
    final totalInstalledBytes = installedList.fold<int>(
      0,
      (sum, info) => sum + info.sizeBytes,
    );

    final totalTrackedBytes = totalGroupDownloadBytes;
    var completedBytes = 0;
    for (final a in assets) {
      if (installedDbs.containsKey(a.filename)) {
        completedBytes += a.estimatedDownloadBytes;
      } else {
        final tr = transfers[a.id];
        if (tr != null && tr.bytesReceived > 0) {
          completedBytes += tr.bytesReceived.clamp(0, a.estimatedDownloadBytes);
        }
      }
    }
    final fraction = totalTrackedBytes > 0
        ? (completedBytes / totalTrackedBytes).clamp(0.0, 1.0)
        : null;

    final borderColor = allInstalled
        ? AppPalette.successGreen.withValues(alpha: 0.45)
        : isRequired
            ? colors.error.withValues(alpha: 0.45)
            : colors.outlineVariant;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: allInstalled
                  ? AppPalette.successGreen.withValues(alpha: 0.14)
                  : isRequired
                      ? colors.errorContainer
                      : colors.primaryContainer,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              allInstalled ? Icons.check_circle : icon,
              size: 22,
              color: allInstalled
                  ? AppPalette.successGreen
                  : isRequired
                      ? colors.error
                      : colors.primary,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (isRequired && !allInstalled) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: colors.error.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          'Required',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: colors.error,
                                fontWeight: FontWeight.w700,
                                fontSize: 10,
                              ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  allInstalled
                      ? 'Ready (${formatBytes(totalInstalledBytes)})'
                      : '$subtitle • Total ${formatBytes(remainingDownloadBytes)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: allInstalled
                        ? AppPalette.successGreen
                        : colors.onSurfaceVariant,
                  ),
                ),
                if (anyActive) ...[
                  const SizedBox(height: 8),
                  LinearProgressIndicator(
                    value: fraction,
                    minHeight: 4,
                    borderRadius: BorderRadius.circular(2),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Downloading (${installedList.length}/${assets.length})'
                    '${totalTrackedBytes > 0 ? ' • ${formatBytes(completedBytes)} / ${formatBytes(totalTrackedBytes)}' : ''}',
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.onSurfaceVariant,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
                if (failedTransfer != null && !anyActive) ...[
                  const SizedBox(height: 4),
                  Text(
                    failedTransfer.error!,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 6),
          if (anyActive)
            IconButton.filledTonal(
              tooltip: 'Pause',
              onPressed: onPauseAll,
              icon: const Icon(Icons.pause),
            )
          else if (!allInstalled)
            IconButton.filledTonal(
              tooltip: 'Download all',
              onPressed: onDownloadAll,
              icon: const Icon(Icons.download),
            ),
        ],
      ),
    );
  }
}

class _OnboardingAssetCard extends StatelessWidget {
  final DatabaseAsset asset;
  final DatabaseManifest manifest;
  final InstalledDbInfo? installed;
  final DownloadProgress? progress;
  final bool isRequired;
  final bool selected;
  final VoidCallback? onToggleSelected;
  final VoidCallback onDownload;
  final VoidCallback onPause;
  final VoidCallback onImport;

  const _OnboardingAssetCard({
    required this.asset,
    required this.manifest,
    required this.installed,
    required this.progress,
    required this.isRequired,
    required this.selected,
    required this.onToggleSelected,
    required this.onDownload,
    required this.onPause,
    required this.onImport,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isInstalled = installed != null;
    final isActive = progress?.isActive ?? false;
    final isError = progress?.phase == TransferPhase.failed;
    final hasUrl = manifest.resolveDownloadUrl(
          asset,
          overrideRepo: GitHubReleaseService.defaultRepo,
          overrideTag: GitHubReleaseService.defaultTag,
        ) !=
        null;

    final borderColor = isInstalled
        ? AppPalette.successGreen.withValues(alpha: 0.45)
        : isRequired
            ? colors.error.withValues(alpha: 0.45)
            : colors.outlineVariant;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (!isRequired && !isInstalled && onToggleSelected != null)
            Checkbox(
              value: selected,
              onChanged: isActive ? null : (_) => onToggleSelected?.call(),
            )
          else
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: isInstalled
                    ? AppPalette.successGreen.withValues(alpha: 0.14)
                    : isRequired
                        ? colors.errorContainer
                        : colors.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                isInstalled
                    ? Icons.check_circle
                    : isRequired
                        ? Icons.storage_rounded
                        : Icons.menu_book_outlined,
                size: 22,
                color: isInstalled
                    ? AppPalette.successGreen
                    : isRequired
                        ? colors.error
                        : colors.primary,
              ),
            ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        asset.title,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (isRequired && !isInstalled) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: colors.error.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          'Required',
                          style: Theme.of(context).textTheme.labelSmall
                              ?.copyWith(
                                color: colors.error,
                                fontWeight: FontWeight.w700,
                                fontSize: 10,
                              ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  isInstalled
                      ? 'Ready (${formatBytes(installed!.sizeBytes)})'
                      : asset.zipSize > 0
                          ? '${asset.filename} • ZIP ${formatBytes(asset.zipSize)}'
                          : '${asset.filename} • DB ~${formatBytes(asset.dbSize)}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isInstalled
                        ? AppPalette.successGreen
                        : colors.onSurfaceVariant,
                  ),
                ),
                if (isActive && progress != null) ...[
                  const SizedBox(height: 8),
                  LinearProgressIndicator(
                    value: progress!.fraction,
                    minHeight: 4,
                    borderRadius: BorderRadius.circular(2),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    progress!.phase == TransferPhase.downloading
                        ? '${formatBytes(progress!.bytesReceived)}'
                            '${progress!.totalBytes > 0 ? ' / ${formatBytes(progress!.totalBytes)}' : ''}'
                            '${progress!.bytesPerSecond > 0 ? ' • ${formatSpeed(progress!.bytesPerSecond)}' : ''}'
                        : (progress!.message ?? progress!.phase.name),
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.onSurfaceVariant,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
                if (isError && progress?.error != null && !isInstalled) ...[
                  const SizedBox(height: 4),
                  Text(
                    progress!.error!,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 6),
          if (isActive)
            IconButton.filledTonal(
              tooltip: 'Pause',
              onPressed: onPause,
              icon: const Icon(Icons.pause),
            )
          else if (!isInstalled)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton.filledTonal(
                  tooltip: 'Import local .zip or .db',
                  onPressed: onImport,
                  icon: const Icon(Icons.folder_open),
                ),
                const SizedBox(width: 4),
                IconButton.filledTonal(
                  tooltip: 'Download',
                  onPressed: hasUrl ? onDownload : null,
                  icon: const Icon(Icons.download),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _FeatureGuidePreview extends StatefulWidget {
  const _FeatureGuidePreview();

  @override
  State<_FeatureGuidePreview> createState() => _FeatureGuidePreviewState();
}

class _FeatureGuidePreviewState extends State<_FeatureGuidePreview> {
  String? _expanded;

  static const _items = [
    (
      id: 'mat',
      icon: Icons.account_tree_outlined,
      title: 'CST4 217-Book Tree & MAT Parallel Jumps',
      detail:
          'Browse Vinaya, Sutta, and Abhidhamma and jump directly between Mūla, Aṭṭhakathā commentary, and Ṭīkā sub-commentary.',
    ),
    (
      id: 'trans',
      icon: Icons.translate_outlined,
      title: 'Paragraph-Aligned Translations',
      detail:
          'Read Pāḷi canon texts side-by-side with any downloaded translation_<lang>.db pack.',
    ),
    (
      id: 'fts',
      icon: Icons.bolt_outlined,
      title: 'In-App FTS5 Full-Text Search',
      detail:
          'Automatically builds fts_tipitaka.db and fts_translation_<lang>.db on-device from tipitaka.db and downloaded translations—no pre-built search downloads needed.',
    ),
    (
      id: 'dpd',
      icon: Icons.menu_book_outlined,
      title: 'Tap-to-Lookup Pali Dictionary',
      detail:
          'Tap any Pāḷi word while reading to query installed DPD, Sandhi Splitter, and PTS dictionaries completely offline.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.explore_outlined, size: 18, color: colors.primary),
              const SizedBox(width: 8),
              Text(
                'What you get offline',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final item in _items)
            InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => setState(
                () => _expanded = _expanded == item.id ? null : item.id,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(item.icon, size: 18, color: colors.primary),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            item.title,
                            style: Theme.of(context).textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w500),
                          ),
                        ),
                        Icon(
                          _expanded == item.id
                              ? Icons.expand_less
                              : Icons.expand_more,
                          size: 18,
                          color: colors.onSurfaceVariant,
                        ),
                      ],
                    ),
                    if (_expanded == item.id) ...[
                      const SizedBox(height: 4),
                      Padding(
                        padding: const EdgeInsets.only(left: 28),
                        child: Text(
                          item.detail,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: colors.onSurfaceVariant),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _OnboardingFtsIndexingView extends StatefulWidget {
  final FtsIndexingStatus? status;
  final String? fallbackMessage;

  const _OnboardingFtsIndexingView({
    required this.status,
    required this.fallbackMessage,
  });

  @override
  State<_OnboardingFtsIndexingView> createState() =>
      _OnboardingFtsIndexingViewState();
}

class _OnboardingFtsIndexingViewState
    extends State<_OnboardingFtsIndexingView> {
  static const _tips = <({IconData icon, String title, String body})>[
    (
      icon: Icons.search_rounded,
      title: 'Search without typing Pāḷi diacritics',
      body:
          'Typing "nibbana" or "satipatthana" automatically matches "nibbāna" and "satipaṭṭhāna" across the entire Canon.',
    ),
    (
      icon: Icons.touch_app_rounded,
      title: 'Tap any word for instant dictionary lookup',
      body:
          'Digital Pali Dictionary (DPD) breaks down inflections and compound words while you read.',
    ),
    (
      icon: Icons.auto_awesome_rounded,
      title: 'Explore roots & wildcards with *',
      body:
          'Search prefix patterns like "sati*" or "dhamma*" to discover related terms across Sutta, Vinaya, and Abhidhamma.',
    ),
    (
      icon: Icons.translate_rounded,
      title: '15+ Tipiṭaka scripts & parallel M-A-Ṭ links',
      body:
          'Switch scripts seamlessly between Roman, Myanmar, Sinhala, Thai, Devanāgarī, and open Mūla–Aṭṭhakathā–Ṭīkā side by side.',
    ),
  ];

  int _tipIndex = 0;
  Timer? _tipTimer;

  @override
  void initState() {
    super.initState();
    _tipTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted) return;
      setState(() {
        _tipIndex = (_tipIndex + 1) % _tips.length;
      });
    });
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    super.dispose();
  }

  void _nextTip() {
    setState(() {
      _tipIndex = (_tipIndex + 1) % _tips.length;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final status = widget.status;
    final progress = (status?.overallProgress ?? 0.0).clamp(0.0, 1.0);
    final percent = (progress * 100).round();
    final stage = status?.stage ?? FtsBuildStage.preparing;
    final detail =
        status?.detail ??
        widget.fallbackMessage ??
        'Preparing full-text search index...';
    final taskHeading = status == null
        ? 'Initializing search engine'
        : (status.totalTasks > 1
              ? 'Step ${status.taskIndex} of ${status.totalTasks} • ${status.taskLabel}'
              : status.taskLabel);
    final tip = _tips[_tipIndex];

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 500),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TweenAnimationBuilder<double>(
                    tween: Tween<double>(end: progress),
                    duration: const Duration(milliseconds: 220),
                    builder: (context, animatedValue, _) {
                      return SizedBox(
                        width: 152,
                        height: 152,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            Container(
                              width: 152,
                              height: 152,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: colors.primaryContainer.withValues(
                                  alpha: 0.28,
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 136,
                              height: 136,
                              child: CircularProgressIndicator(
                                value: status == null ? null : animatedValue,
                                strokeWidth: 9,
                                strokeCap: StrokeCap.round,
                                backgroundColor:
                                    colors.surfaceContainerHighest,
                                color: colors.primary,
                              ),
                            ),
                            Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.manage_search_rounded,
                                  size: 28,
                                  color: colors.primary,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '$percent%',
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineMedium
                                      ?.copyWith(
                                        fontWeight: FontWeight.w800,
                                        color: colors.onSurface,
                                        fontFeatures: const [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Building Full-Text Search Index',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'All databases are downloaded. Indexing passages for instant offline search.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),

                  // ── Active Indexing Progress Card ────────────────────────
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: colors.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: colors.outlineVariant.withValues(alpha: 0.7),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: colors.primaryContainer,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                taskHeading,
                                style: Theme.of(context).textTheme.labelMedium
                                    ?.copyWith(
                                      color: colors.onPrimaryContainer,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                            ),
                            if (status != null)
                              Text(
                                status.filename,
                                style: Theme.of(context).textTheme.labelSmall
                                    ?.copyWith(color: colors.onSurfaceVariant),
                              ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(999),
                          child: TweenAnimationBuilder<double>(
                            tween: Tween<double>(end: progress),
                            duration: const Duration(milliseconds: 220),
                            builder: (context, animatedValue, _) {
                              return LinearProgressIndicator(
                                value: status == null ? null : animatedValue,
                                minHeight: 8,
                                backgroundColor: colors.surface,
                                color: colors.primary,
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                detail,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      color: colors.onSurface,
                                    ),
                              ),
                            ),
                            if (status != null && status.totalRows > 0) ...[
                              const SizedBox(width: 8),
                              Text(
                                '${formatCount(status.processedRows)} / ${formatCount(status.totalRows)}',
                                style: Theme.of(context).textTheme.labelMedium
                                    ?.copyWith(
                                      color: colors.onSurfaceVariant,
                                      fontFeatures: const [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            _StageChip(
                              label: 'Read Texts',
                              done: stage.index > FtsBuildStage.preparing.index,
                              active: stage == FtsBuildStage.preparing,
                            ),
                            const SizedBox(width: 8),
                            _StageChip(
                              label: 'Index Words',
                              done: stage.index > FtsBuildStage.indexing.index,
                              active: stage == FtsBuildStage.indexing,
                            ),
                            const SizedBox(width: 8),
                            _StageChip(
                              label: 'Optimize',
                              done: stage == FtsBuildStage.completed,
                              active:
                                  stage == FtsBuildStage.optimizing ||
                                  stage == FtsBuildStage.compacting,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // ── Engaging Tip Card While Waiting ──────────────────────
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: colors.secondaryContainer.withValues(alpha: 0.45),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: colors.outlineVariant.withValues(alpha: 0.5),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Text(
                              'STUDY TIP ${_tipIndex + 1}/${_tips.length}',
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
                                    color: colors.primary,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.5,
                                  ),
                            ),
                            const Spacer(),
                            InkWell(
                              borderRadius: BorderRadius.circular(8),
                              onTap: _nextTip,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      'Next tip',
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelSmall
                                          ?.copyWith(
                                            color: colors.primary,
                                            fontWeight: FontWeight.w600,
                                          ),
                                    ),
                                    const SizedBox(width: 2),
                                    Icon(
                                      Icons.chevron_right,
                                      size: 16,
                                      color: colors.primary,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 260),
                          child: Row(
                            key: ValueKey(_tipIndex),
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(tip.icon, size: 22, color: colors.primary),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      tip.title,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleSmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.w600,
                                          ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      tip.body,
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall
                                          ?.copyWith(
                                            color: colors.onSurfaceVariant,
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StageChip extends StatelessWidget {
  final String label;
  final bool done;
  final bool active;

  const _StageChip({
    required this.label,
    required this.done,
    required this.active,
  });

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final bgColor = done
        ? AppPalette.successGreen.withValues(alpha: 0.14)
        : active
            ? colors.primaryContainer
            : colors.surface;
    final fgColor = done
        ? AppPalette.successGreen
        : active
            ? colors.onPrimaryContainer
            : colors.onSurfaceVariant;

    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: active
                ? colors.primary.withValues(alpha: 0.5)
                : colors.outlineVariant.withValues(alpha: 0.5),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (done)
              Icon(Icons.check_circle, size: 14, color: fgColor)
            else if (active)
              SizedBox(
                width: 11,
                height: 11,
                child: CircularProgressIndicator(
                  strokeWidth: 1.8,
                  color: fgColor,
                ),
              )
            else
              Icon(Icons.circle_outlined, size: 13, color: fgColor),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: fgColor,
                  fontWeight: active || done ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
