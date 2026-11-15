import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers/reader_settings_provider.dart';
import '../../core/providers/workspace_provider.dart';
import '../../core/services/tipitaka_repository.dart';
import '../../core/utils/pali_script_converter.dart';
import '../downloads/download_controller.dart';

/// GoTo Paragraph / Edition Page modal matching `tipitakapali.org/components/GoToModal.jsx`.
Future<void> showGoToModal(
  BuildContext context, {
  required String bookCode,
  required String bookTitle,
  required int currentChapterIndex,
}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => _GoToDialog(
      bookCode: bookCode,
      bookTitle: bookTitle,
      currentChapterIndex: currentChapterIndex,
    ),
  );
}

class _GoToDialog extends ConsumerStatefulWidget {
  final String bookCode;
  final String bookTitle;
  final int currentChapterIndex;

  const _GoToDialog({
    required this.bookCode,
    required this.bookTitle,
    required this.currentChapterIndex,
  });

  @override
  ConsumerState<_GoToDialog> createState() => _GoToDialogState();
}

class _GoToDialogState extends ConsumerState<_GoToDialog> {
  String _mode = 'para'; // 'para' | 'page'
  String _edition = 'M';
  final _paraCtrl = TextEditingController();
  final _pageCtrl = TextEditingController();
  String? _error;
  BookNavigationMeta? _meta;

  @override
  void initState() {
    super.initState();
    _edition = ref.read(readerSettingsProvider).defaultEditionPage;
    if (_edition == 'all') _edition = 'M';
    final tipitakaPath =
        ref.read(downloadControllerProvider).installedDbs['tipitaka.db']?.path;
    if (tipitakaPath != null) {
      _meta = ref
          .read(tipitakaRepositoryProvider)
          .getBookNavigationMeta(tipitakaPath, widget.bookCode);
      final avail = _meta!.availableEditions;
      if (avail.isNotEmpty && !avail.contains(_edition)) {
        _edition = avail.first;
      }
    }
  }

  @override
  void dispose() {
    _paraCtrl.dispose();
    _pageCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    final tipitakaPath =
        ref.read(downloadControllerProvider).installedDbs['tipitaka.db']?.path;
    if (tipitakaPath == null) return;
    final repo = ref.read(tipitakaRepositoryProvider);

    if (_mode == 'para') {
      final q = _paraCtrl.text.trim();
      final hit = repo.findParagraphTarget(
        tipitakaPath,
        bookCode: widget.bookCode,
        paraNumQuery: q,
      );
      if (hit == null) {
        setState(() => _error = 'Paragraph "$q" not found in this book.');
        return;
      }
      ref.read(workspaceProvider.notifier).openBook(
            bookCode: widget.bookCode,
            bookTitle: widget.bookTitle,
            chapterIndex: hit.chapterIndex,
            targetParaIndex: hit.paraIndex,
            targetParaNum: q,
          );
      Navigator.of(context).pop();
      return;
    }

    final meta = _meta;
    final pq = _pageCtrl.text.trim();
    if (meta == null) {
      setState(() => _error = 'Edition page metadata unavailable.');
      return;
    }
    final chap = repo.findEditionPageChapter(meta, _edition, pq);
    if (chap == null) {
      setState(
        () => _error = 'Page "$pq" not found in $_edition edition for this book.',
      );
      return;
    }
    ref.read(workspaceProvider.notifier).openBook(
          bookCode: widget.bookCode,
          bookTitle: widget.bookTitle,
          chapterIndex: chap,
        );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final meta = _meta;
    final editions = meta?.availableEditions ?? const ['M', 'V', 'P', 'T'];

    return AlertDialog(
      title: const Text('Go To Paragraph / Page'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'para', label: Text('Paragraph #')),
                ButtonSegment(value: 'page', label: Text('Edition Page')),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => setState(() {
                _mode = s.first;
                _error = null;
              }),
            ),
            const SizedBox(height: 14),
            if (_mode == 'para') ...[
              TextField(
                controller: _paraCtrl,
                autofocus: true,
                keyboardType: TextInputType.text,
                decoration: InputDecoration(
                  labelText: 'Paragraph number',
                  hintText: meta?.minPara != null && meta?.maxPara != null
                      ? 'Range ${meta!.minPara} – ${meta.maxPara}'
                      : 'e.g. 12',
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: (_) => _submit(),
              ),
            ] else ...[
              if (editions.isNotEmpty)
                Wrap(
                  spacing: 6,
                  children: [
                    for (final ed in editions)
                      ChoiceChip(
                        label: Text(ed),
                        selected: _edition == ed,
                        onSelected: (_) => setState(() {
                          _edition = ed;
                          _error = null;
                        }),
                      ),
                  ],
                ),
              const SizedBox(height: 10),
              TextField(
                controller: _pageCtrl,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Page number',
                  hintText: 'e.g. 1.0005 or 5',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _submit(),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _submit, child: const Text('Jump')),
      ],
    );
  }
}

/// MAT Parallel Jump modal matching `tipitakapali.org/components/MatJumpModal.jsx`.
Future<void> showMatJumpModal(
  BuildContext context, {
  required String bookCode,
  required int chapterIndex,
  CanonParagraph? para,
}) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => _MatJumpDialog(
      bookCode: bookCode,
      chapterIndex: chapterIndex,
      para: para,
    ),
  );
}

class _MatJumpDialog extends ConsumerWidget {
  final String bookCode;
  final int chapterIndex;
  final CanonParagraph? para;

  const _MatJumpDialog({
    required this.bookCode,
    required this.chapterIndex,
    this.para,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tipitakaPath =
        ref.watch(downloadControllerProvider).installedDbs['tipitaka.db']?.path;
    final script = ref.watch(readerSettingsProvider).paliScript;

    MatRelations rel = const MatRelations();
    if (tipitakaPath != null) {
      rel = ref.read(tipitakaRepositoryProvider).resolveMatForParagraph(
            tipitakaPath,
            bookCode: bookCode,
            chapterIndex: chapterIndex,
            paraNum: para?.paraNum,
            paraIndex: para?.paraIndex,
          );
    }

    Widget buildTargetTile(String kind, MatChapterTarget? t) {
      if (t == null) {
        return ListTile(
          enabled: false,
          leading: const Icon(Icons.layers_clear_outlined),
          title: Text(kind),
          subtitle: const Text('Not linked for this section'),
        );
      }
      final displayTitle = PaliScriptConverter.convertFromRoman(
        t.title?.isNotEmpty == true ? t.title! : t.bookCode,
        script,
      );
      final paraLabel =
          t.para != null && t.para!.isNotEmpty ? ' · ¶ ${t.para}' : '';

      void jump({required bool newTab}) {
        int? targetParaIdx;
        if (tipitakaPath != null && t.para != null && t.para!.isNotEmpty) {
          targetParaIdx = ref
              .read(tipitakaRepositoryProvider)
              .findParagraphTarget(
                tipitakaPath,
                bookCode: t.bookCode,
                paraNumQuery: t.para!,
              )
              ?.paraIndex;
        }
        ref.read(workspaceProvider.notifier).openBook(
              bookCode: t.bookCode,
              bookTitle: t.title,
              chapterIndex: t.chapterIndex,
              targetParaIndex: targetParaIdx,
              targetParaNum: t.para,
              openInNewTab: newTab,
            );
        Navigator.of(context).pop();
      }

      return Card(
        child: ListTile(
          leading: const Icon(Icons.auto_stories_outlined),
          title: Text('$kind — $displayTitle'),
          subtitle: Text('${t.bookCode} · Ch ${t.chapterIndex + 1}$paraLabel'),
          trailing: Wrap(
            spacing: 4,
            children: [
              TextButton(
                onPressed: () => jump(newTab: false),
                child: const Text('Open'),
              ),
              OutlinedButton(
                onPressed: () => jump(newTab: true),
                child: const Text('New Tab'),
              ),
            ],
          ),
        ),
      );
    }

    return AlertDialog(
      title: Text(
        para?.paraNum != null
            ? 'MAT Parallel (¶ ${para!.paraNum})'
            : 'Mūla · Aṭṭhakathā · Ṭīkā',
      ),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            buildTargetTile('Mūla', rel.mula),
            buildTargetTile('Aṭṭhakathā', rel.attha),
            buildTargetTile('Ṭīkā', rel.tika),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

/// Bookmarks modal matching `tipitakapali.org/components/BookmarkModal.jsx`.
Future<void> showBookmarksModal(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _BookmarksDialog(),
  );
}

class _BookmarksDialog extends ConsumerStatefulWidget {
  const _BookmarksDialog();

  @override
  ConsumerState<_BookmarksDialog> createState() => _BookmarksDialogState();
}

class _BookmarksDialogState extends ConsumerState<_BookmarksDialog> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final ws = ref.watch(workspaceProvider);
    final script = ref.watch(readerSettingsProvider).paliScript;
    final normQ = PaliScriptConverter.normalizePaliForSearch(_filter);
    final items = ws.bookmarks.where((b) {
      if (normQ.isEmpty) return true;
      return PaliScriptConverter.normalizePaliForSearch(b.bookTitle)
              .contains(normQ) ||
          PaliScriptConverter.normalizePaliForSearch(b.chapterTitle)
              .contains(normQ) ||
          PaliScriptConverter.normalizePaliForSearch(b.snippet)
              .contains(normQ);
    }).toList(growable: false);

    return AlertDialog(
      title: Text('Bookmarks (${ws.bookmarks.length})'),
      content: SizedBox(
        width: 500,
        height: 440,
        child: Column(
          children: [
            TextField(
              decoration: const InputDecoration(
                isDense: true,
                prefixIcon: Icon(Icons.search),
                hintText: 'Filter bookmarks (Velthuis supported)',
                border: OutlineInputBorder(),
              ),
              onChanged: (v) => setState(() => _filter = v),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: items.isEmpty
                  ? const Center(
                      child: Text(
                        'No bookmarks yet.\nTap a paragraph number in the reader to bookmark.',
                        textAlign: TextAlign.center,
                      ),
                    )
                  : ListView.separated(
                      itemCount: items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (ctx, idx) {
                        final b = items[idx];
                        return ListTile(
                          title: Text(
                            PaliScriptConverter.convertFromRoman(
                              b.bookTitle,
                              script,
                            ),
                          ),
                          subtitle: Text(
                            '${b.chapterTitle}${b.paraNum != null ? ' · ¶ ${b.paraNum}' : ''}'
                            '${b.snippet.isNotEmpty ? '\n${b.snippet}' : ''}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => ref
                                .read(workspaceProvider.notifier)
                                .removeBookmark(b.id),
                          ),
                          onTap: () {
                            ref.read(workspaceProvider.notifier).openBook(
                                  bookCode: b.bookCode,
                                  bookTitle: b.bookTitle,
                                  nikaya: b.nikaya,
                                  chapterIndex: b.chapterIndex,
                                  targetParaIndex: b.paraIndex,
                                  targetParaNum: b.paraNum,
                                );
                            Navigator.of(context).pop();
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

/// Recent reading history modal matching `tipitakapali.org/components/HistoryModal.jsx`.
Future<void> showHistoryModal(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _HistoryDialog(),
  );
}

class _HistoryDialog extends ConsumerWidget {
  const _HistoryDialog();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ws = ref.watch(workspaceProvider);
    final script = ref.watch(readerSettingsProvider).paliScript;

    return AlertDialog(
      title: Row(
        children: [
          Expanded(child: Text('Recent Books (${ws.history.length})')),
          if (ws.history.isNotEmpty)
            TextButton.icon(
              onPressed: () =>
                  ref.read(workspaceProvider.notifier).clearHistory(),
              icon: const Icon(Icons.delete_sweep_outlined, size: 18),
              label: const Text('Clear'),
            ),
        ],
      ),
      content: SizedBox(
        width: 480,
        height: 400,
        child: ws.history.isEmpty
            ? const Center(child: Text('No reading history yet.'))
            : ListView.separated(
                itemCount: ws.history.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (ctx, idx) {
                  final h = ws.history[idx];
                  return ListTile(
                    leading: const Icon(Icons.history),
                    title: Text(
                      PaliScriptConverter.convertFromRoman(h.bookTitle, script),
                    ),
                    subtitle: Text(
                      '${h.chapterTitle.isNotEmpty ? h.chapterTitle : h.bookCode} · Ch ${h.chapterIndex + 1}',
                    ),
                    onTap: () {
                      ref.read(workspaceProvider.notifier).openBook(
                            bookCode: h.bookCode,
                            bookTitle: h.bookTitle,
                            nikaya: h.nikaya,
                            chapterIndex: h.chapterIndex,
                            targetParaIndex: h.paraIndex,
                            targetParaNum: h.paraNum,
                          );
                      Navigator.of(context).pop();
                    },
                  );
                },
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

/// Full-Text Search modal across `fts_tipitaka.db` & `fts_translation_<lang>.db`.
Future<void> showFtsSearchModal(
  BuildContext context, {
  required VoidCallback onOpenDatabases,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _FtsSearchDialog(onOpenDatabases: onOpenDatabases),
  );
}

class _FtsSearchDialog extends ConsumerStatefulWidget {
  final VoidCallback onOpenDatabases;

  const _FtsSearchDialog({required this.onOpenDatabases});

  @override
  ConsumerState<_FtsSearchDialog> createState() => _FtsSearchDialogState();
}

class _FtsSearchDialogState extends ConsumerState<_FtsSearchDialog> {
  final _ctrl = TextEditingController();
  String _selectedFtsDb = 'fts_tipitaka.db';
  String _nikayaFilter = '';
  List<FtsSearchHit> _hits = const [];
  String? _error;
  bool _searched = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _runSearch() {
    final installed = ref.read(downloadControllerProvider).installedDbs;
    final ftsInfo = installed[_selectedFtsDb];
    if (ftsInfo == null) {
      setState(() => _error = '$_selectedFtsDb is not installed.');
      return;
    }
    final q = PaliScriptConverter.convertToRoman(_ctrl.text).trim();
    if (q.isEmpty) return;

    try {
      final hits = ref.read(tipitakaRepositoryProvider).searchFts(
            ftsDbPath: ftsInfo.path,
            tipitakaDbPath: installed['tipitaka.db']?.path,
            query: _selectedFtsDb == 'fts_tipitaka.db' ? q : _ctrl.text.trim(),
            nikayaFilter: _nikayaFilter.isEmpty ? null : _nikayaFilter,
            limit: 80,
          );
      setState(() {
        _hits = hits;
        _error = null;
        _searched = true;
      });
    } catch (e) {
      setState(() => _error = 'Search query error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final installed = ref.watch(downloadControllerProvider).installedDbs;
    final script = ref.watch(readerSettingsProvider).paliScript;
    final ftsDbs = installed.keys
        .where((k) => k == 'fts_tipitaka.db' || k.startsWith('fts_translation_'))
        .toList()
      ..sort();
    if (ftsDbs.isNotEmpty && !ftsDbs.contains(_selectedFtsDb)) {
      _selectedFtsDb = ftsDbs.first;
    }

    return Dialog(
      insetPadding: const EdgeInsets.all(20),
      child: SizedBox(
        width: 720,
        height: MediaQuery.of(context).size.height * 0.82,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 10, 8),
              child: Row(
                children: [
                  const Icon(Icons.search),
                  const SizedBox(width: 8),
                  const Text(
                    'Full-Text Search',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      autofocus: true,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText:
                            'Search words or phrase (Velthuis: aa .m .t ~n)',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      onChanged: (val) {
                        if (_selectedFtsDb == 'fts_tipitaka.db') {
                          final v = PaliScriptConverter.typeVelthuis(val);
                          if (v != val) {
                            _ctrl.value = TextEditingValue(
                              text: v,
                              selection: TextSelection.collapsed(
                                offset: v.length,
                              ),
                            );
                          }
                        }
                      },
                      onSubmitted: (_) => _runSearch(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: ftsDbs.isEmpty ? null : _runSearch,
                    child: const Text('Search'),
                  ),
                ],
              ),
            ),
            if (ftsDbs.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    DropdownButton<String>(
                      value: _selectedFtsDb,
                      items: ftsDbs
                          .map(
                            (d) => DropdownMenuItem(
                              value: d,
                              child: Text(
                                d == 'fts_tipitaka.db'
                                    ? 'Pāli Canon'
                                    : d
                                        .replaceFirst('fts_translation_', '')
                                        .replaceFirst('.db', '')
                                        .toUpperCase(),
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setState(() => _selectedFtsDb = v);
                      },
                    ),
                    DropdownButton<String>(
                      value: _nikayaFilter,
                      items: const [
                        DropdownMenuItem(value: '', child: Text('All Nikāyas')),
                        DropdownMenuItem(
                          value: 'Vinayapiṭaka',
                          child: Text('Vinayapiṭaka'),
                        ),
                        DropdownMenuItem(
                          value: 'Dīghanikāya',
                          child: Text('Dīghanikāya'),
                        ),
                        DropdownMenuItem(
                          value: 'Majjhimanikāya',
                          child: Text('Majjhimanikāya'),
                        ),
                        DropdownMenuItem(
                          value: 'Saṃyuttanikāya',
                          child: Text('Saṃyuttanikāya'),
                        ),
                        DropdownMenuItem(
                          value: 'Aṅguttaranikāya',
                          child: Text('Aṅguttaranikāya'),
                        ),
                        DropdownMenuItem(
                          value: 'Khuddakanikāya',
                          child: Text('Khuddakanikāya'),
                        ),
                        DropdownMenuItem(
                          value: 'Abhidhammapiṭaka',
                          child: Text('Abhidhammapiṭaka'),
                        ),
                      ],
                      onChanged: (v) {
                        if (v != null) setState(() => _nikayaFilter = v);
                      },
                    ),
                  ],
                ),
              ),
            const Divider(),
            Expanded(
              child: ftsDbs.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('fts_tipitaka.db is not installed yet.'),
                          const SizedBox(height: 10),
                          FilledButton(
                            onPressed: () {
                              Navigator.of(context).pop();
                              widget.onOpenDatabases();
                            },
                            child: const Text('Open Databases'),
                          ),
                        ],
                      ),
                    )
                  : _error != null
                      ? Center(child: Text(_error!))
                      : !_searched
                          ? const Center(
                              child: Text('Enter keywords to search offline.'),
                            )
                          : _hits.isEmpty
                              ? const Center(child: Text('No matches found.'))
                              : ListView.separated(
                                  padding: const EdgeInsets.all(12),
                                  itemCount: _hits.length,
                                  separatorBuilder: (_, _) =>
                                      const SizedBox(height: 8),
                                  itemBuilder: (ctx, idx) {
                                    final hit = _hits[idx];
                                    return Card(
                                      margin: EdgeInsets.zero,
                                      child: ListTile(
                                        title: Text(
                                          PaliScriptConverter.convertFromRoman(
                                            hit.bookTitle,
                                            script,
                                          ),
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        subtitle: Text(
                                          '${hit.nikaya} · Ch ${hit.chapterIndex + 1}'
                                          '${hit.paraNum != null ? ' · ¶ ${hit.paraNum}' : ''}\n'
                                          '${hit.snippet}',
                                        ),
                                        onTap: () {
                                          ref
                                              .read(workspaceProvider.notifier)
                                              .openBook(
                                                bookCode: hit.bookCode,
                                                bookTitle: hit.bookTitle,
                                                nikaya: hit.nikaya,
                                                chapterIndex: hit.chapterIndex,
                                                targetParaIndex: hit.paraIndex,
                                                targetParaNum: hit.paraNum,
                                              );
                                          Navigator.of(context).pop();
                                        },
                                      ),
                                    );
                                  },
                                ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Reader Preferences modal matching `tipitakapali.org/components/Settings/SettingsModal.jsx`.
Future<void> showReaderSettingsModal(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _SettingsDialog(),
  );
}

class _SettingsDialog extends ConsumerWidget {
  const _SettingsDialog();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(readerSettingsProvider);
    final ctrl = ref.read(readerSettingsProvider.notifier);

    return AlertDialog(
      title: Row(
        children: [
          const Expanded(child: Text('Reader Settings')),
          TextButton(
            onPressed: ctrl.resetDefaults,
            child: const Text('Reset'),
          ),
        ],
      ),
      content: SizedBox(
        width: 480,
        height: 480,
        child: ListView(
          children: [
            const Text('Theme', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final t in ReaderThemePreset.values)
                  ChoiceChip(
                    label: Text(t.label),
                    avatar: CircleAvatar(backgroundColor: t.background, radius: 8),
                    selected: s.themePreset == t,
                    onSelected: (_) => ctrl.update((c) => c.copyWith(themePreset: t)),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            const Text('Accent', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final a in AccentPreset.values)
                  ChoiceChip(
                    label: Text(a.label),
                    avatar: CircleAvatar(backgroundColor: a.color, radius: 8),
                    selected: s.accentPreset == a,
                    onSelected: (_) => ctrl.update((c) => c.copyWith(accentPreset: a)),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            const Text(
              'Pāli Display Script (17 Scripts)',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<PaliScript>(
              initialValue: s.paliScript,
              decoration: const InputDecoration(border: OutlineInputBorder()),
              items: PaliScript.values
                  .map(
                    (sc) => DropdownMenuItem(
                      value: sc,
                      child: Text('${sc.englishName} (${sc.nativeName})'),
                    ),
                  )
                  .toList(),
              onChanged: (sc) {
                if (sc != null) ctrl.update((c) => c.copyWith(paliScript: sc));
              },
            ),
            const SizedBox(height: 14),
            const Text(
              'Word Dictionary Popup Trigger',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            SegmentedButton<DictLookupTrigger>(
              segments: DictLookupTrigger.values
                  .map((v) => ButtonSegment(value: v, label: Text(v.label)))
                  .toList(),
              selected: {s.dictLookupTrigger},
              onSelectionChanged: (sel) =>
                  ctrl.update((c) => c.copyWith(dictLookupTrigger: sel.first)),
            ),
            const SizedBox(height: 14),
            Text('Font Size: ${s.fontSize.round()} pt'),
            Slider(
              min: 14,
              max: 32,
              divisions: 18,
              value: s.fontSize,
              onChanged: (v) => ctrl.update((c) => c.copyWith(fontSize: v)),
            ),
            Text('Line Height: ${s.lineHeight.toStringAsFixed(2)}'),
            Slider(
              min: 1.3,
              max: 2.3,
              divisions: 10,
              value: s.lineHeight,
              onChanged: (v) => ctrl.update((c) => c.copyWith(lineHeight: v)),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Justify Text'),
              value: s.justifyText,
              onChanged: (v) => ctrl.update((c) => c.copyWith(justifyText: v)),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show Paragraph Numbers'),
              value: s.showParaNumbers,
              onChanged: (v) =>
                  ctrl.update((c) => c.copyWith(showParaNumbers: v)),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show Edition Page Numbers (M/V/P/T)'),
              value: s.showPageBreaks,
              onChanged: (v) =>
                  ctrl.update((c) => c.copyWith(showPageBreaks: v)),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show Footnotes'),
              value: s.showFootnotes,
              onChanged: (v) =>
                  ctrl.update((c) => c.copyWith(showFootnotes: v)),
            ),
          ],
        ),
      ),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Done'),
        ),
      ],
    );
  }
}
