import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/db_manifest.dart';
import '../../core/services/github_release_service.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/formatters.dart';
import 'database_updates_dialog.dart';
import 'download_controller.dart';

class DatabaseManagerScreen extends ConsumerWidget {
  const DatabaseManagerScreen({super.key});

  Future<void> _importLocal(
    BuildContext context,
    WidgetRef ref,
    DatabaseAsset asset,
  ) async {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(downloadControllerProvider);
    final controller = ref.read(downloadControllerProvider.notifier);
    final manifest = state.manifest;
    final assets = (manifest?.allCatalogAssets ?? const <DatabaseAsset>[])
        .where((a) => a.category != DbCategory.fts)
        .toList(growable: false);
    final updateFilenames = {
      for (final u in state.availableUpdates) u.asset.filename,
    };

    return Scaffold(
      appBar: AppBar(
        title: const Text('Offline Databases'),
        actions: [
          IconButton(
            tooltip: 'Rebuild In-App FTS5 Indexes',
            onPressed: state.isIndexingFts
                ? null
                : () => controller.ensureMissingFtsIndexed(force: true),
            icon: const Icon(Icons.manage_search_rounded),
          ),
          IconButton(
            tooltip: 'Refresh GitHub Release',
            onPressed: state.isFetchingManifest
                ? null
                : controller.refreshReleaseManifest,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          if (state.isIndexingFts) ...[
            LinearProgressIndicator(minHeight: 3),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      state.indexingMessage!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
          ],
          ListTile(
            leading: Icon(
              state.fetchedLiveRelease ? Icons.cloud_done : Icons.storage,
              color: state.fetchedLiveRelease ? AppPalette.successGreen : null,
            ),
            title: Text('Source: ${GitHubReleaseService.defaultRepo}'),
            subtitle: Text(
              state.releaseWarning ??
                  'Folder: ${state.dbDirectoryPath ?? 'resolving...'}',
            ),
          ),
          if (state.availableUpdates.isNotEmpty) ...[
            const Divider(height: 1),
            MaterialBanner(
              content: Text(
                state.availableUpdates.length == 1
                    ? '1 database update available (${state.availableUpdates.first.asset.title}).'
                    : '${state.availableUpdates.length} database updates available.',
              ),
              leading: Icon(
                Icons.system_update_rounded,
                color: Theme.of(context).colorScheme.primary,
              ),
              actions: [
                TextButton(
                  onPressed: state.isBatchInstalling
                      ? null
                      : () => DatabaseUpdatesDialog.show(context),
                  child: const Text('Update All'),
                ),
              ],
            ),
          ],
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: assets.length,
              itemBuilder: (context, index) {
                final asset = assets[index];
                final installed = state.installedDbs[asset.filename];
                final hasUpdate = updateFilenames.contains(asset.filename);
                final transfer = state.transfers[asset.id];
                final active = transfer?.isActive ?? false;
                final resolvedUrl = manifest?.resolveDownloadUrl(
                  asset,
                  overrideRepo: GitHubReleaseService.defaultRepo,
                  overrideTag: GitHubReleaseService.defaultTag,
                );

                return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(
                      installed != null
                          ? Icons.check_circle
                          : Icons.circle_outlined,
                      color: installed != null
                          ? (installed.isHealthy
                              ? AppPalette.successGreen
                              : Colors.orange)
                          : null,
                    ),
                    title: Text('${asset.title} (${asset.category.label})'),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${asset.filename} • '
                          '${installed != null ? 'Installed ${formatBytes(installed.sizeBytes)}' : (asset.zipSize > 0 ? 'ZIP ${formatBytes(asset.zipSize)}' : 'DB ~${formatBytes(asset.dbSize)}')}',
                        ),
                        if (hasUpdate)
                          Text(
                            'Update available (${asset.updated ?? 'v${asset.version}'})',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.primary,
                              fontWeight: FontWeight.w600,
                              fontSize: 12,
                            ),
                          ),
                        if (transfer != null &&
                            (active || transfer.error != null)) ...[
                          const SizedBox(height: 4),
                          if (active)
                            LinearProgressIndicator(value: transfer.fraction),
                          Text(
                            transfer.error ??
                                transfer.message ??
                                transfer.phase.name,
                          ),
                        ],
                      ],
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (installed != null)
                          IconButton(
                            tooltip: 'Verify SQLite & SHA-256',
                            onPressed: () async {
                              final res = await controller.verifyInstalledAsset(
                                asset,
                              );
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    res.valid
                                        ? '${asset.filename}: SQLite OK (${res.tables.length} tables)'
                                        : '${asset.filename}: ${res.error}',
                                  ),
                                ),
                              );
                            },
                            icon: const Icon(Icons.verified_user_outlined),
                          ),
                        IconButton(
                          tooltip: 'Import local .zip or .db',
                          onPressed: active
                              ? null
                              : () => _importLocal(context, ref, asset),
                          icon: const Icon(Icons.folder_open),
                        ),
                        if (active)
                          IconButton(
                            tooltip: 'Pause transfer',
                            onPressed: () => controller.cancelDownload(asset.id),
                            icon: const Icon(Icons.pause),
                          )
                        else
                          IconButton(
                            tooltip: 'Download from GitHub Release',
                            onPressed: resolvedUrl == null
                                ? null
                                : () => controller.downloadAsset(asset),
                            icon: const Icon(Icons.download),
                          ),
                        if (installed != null && !asset.compulsory && !active)
                          IconButton(
                            tooltip: 'Delete database',
                            onPressed: () => controller.deleteInstalledAsset(
                              asset.filename,
                            ),
                            icon: const Icon(Icons.delete_outline),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
