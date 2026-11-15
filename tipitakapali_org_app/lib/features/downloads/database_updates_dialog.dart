import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/db_update_info.dart';
import '../../core/utils/formatters.dart';
import 'download_controller.dart';
import 'download_service.dart';

/// Prompts the user when the online repository `databases_manifest.json` has
/// newer versions of locally installed databases.
class DatabaseUpdatesDialog extends ConsumerStatefulWidget {
  const DatabaseUpdatesDialog({super.key});

  static Future<bool?> show(BuildContext context) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const DatabaseUpdatesDialog(),
    );
  }

  @override
  ConsumerState<DatabaseUpdatesDialog> createState() =>
      _DatabaseUpdatesDialogState();
}

class _DatabaseUpdatesDialogState extends ConsumerState<DatabaseUpdatesDialog> {
  bool _started = false;
  String? _error;

  Future<void> _startUpdate() async {
    setState(() {
      _started = true;
      _error = null;
    });
    try {
      await ref
          .read(downloadControllerProvider.notifier)
          .updateAvailableDatabases();
      if (!mounted) return;
      final after = ref.read(downloadControllerProvider);
      if (after.availableUpdates.isEmpty) {
        Navigator.of(context).pop(true);
        return;
      }
      final failed = after.transfers.values
          .where((t) => t.phase == TransferPhase.failed && t.error != null)
          .map((t) => t.error!)
          .firstOrNull;
      setState(() {
        _started = false;
        _error = failed ?? after.releaseWarning ?? 'Some updates did not finish.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _started = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(downloadControllerProvider);
    final updates = state.availableUpdates;
    final colors = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    final running =
        _started || state.isBatchInstalling || state.hasActiveTransfers;

    final totalBytes = updates.fold<int>(
      0,
      (sum, item) => sum + item.downloadSizeBytes,
    );

    final activeTransfer = updates
        .map((u) => state.transfers[u.asset.id])
        .whereType<DownloadProgress>()
        .where((t) => t.isActive)
        .firstOrNull;

    return PopScope(
      canPop: !running,
      child: AlertDialog(
        title: Row(
          children: [
            Icon(Icons.system_update_rounded, color: colors.primary),
            const SizedBox(width: 10),
            const Expanded(child: Text('Database Updates Available')),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  updates.length == 1
                      ? 'An updated database is available in the online catalog.'
                      : '${updates.length} updated databases are available in the online catalog.',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 12),
                for (final item in updates)
                  _UpdateItemRow(
                    item: item,
                    transfer: state.transfers[item.asset.id],
                  ),
                if (totalBytes > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Total download: ${formatBytes(totalBytes)}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
                if (running) ...[
                  const SizedBox(height: 14),
                  LinearProgressIndicator(
                    value: state.isIndexingFts
                        ? null
                        : (activeTransfer != null &&
                                  activeTransfer.totalBytes > 0
                              ? activeTransfer.fraction
                              : null),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    state.indexingMessage ??
                        activeTransfer?.message ??
                        'Updating databases...',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colors.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              if (!running) {
                ref
                    .read(downloadControllerProvider.notifier)
                    .dismissUpdateNotification();
              }
              Navigator.of(context).pop(false);
            },
            child: Text(running ? 'Hide' : 'Later'),
          ),
          if (!running && updates.isNotEmpty)
            FilledButton.icon(
              onPressed: _startUpdate,
              icon: Icon(_error != null ? Icons.refresh : Icons.download),
              label: Text(_error != null ? 'Retry' : 'Update Now'),
            ),
        ],
      ),
    );
  }
}

class _UpdateItemRow extends StatelessWidget {
  final DatabaseUpdateItem item;
  final DownloadProgress? transfer;

  const _UpdateItemRow({required this.item, this.transfer});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final details = <String>[
      if (item.asset.updated != null && item.asset.updated!.isNotEmpty)
        'Updated ${item.asset.updated}'
      else
        'v${item.asset.version}',
      if (item.downloadSizeBytes > 0) formatBytes(item.downloadSizeBytes),
    ].join(' • ');

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(Icons.storage_rounded, size: 18, color: colors.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.asset.title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                Text(
                  details,
                  style: TextStyle(
                    fontSize: 12,
                    color: colors.onSurfaceVariant,
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
