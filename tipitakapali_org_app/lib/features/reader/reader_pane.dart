import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers/reader_settings_provider.dart';
import '../../core/providers/workspace_provider.dart';
import '../../core/services/tipitaka_repository.dart';
import '../../core/utils/pali_script_converter.dart';
import '../dictionary/dictionary_popup.dart';
import '../downloads/download_controller.dart';
import 'utils/reader_word_hit_test.dart';
import 'utils/reader_word_lookup_controller.dart';

/// Embeddable offline reader view modeled after `tipitakapali.org/components/Reader/ReaderView.jsx`.
///
/// Clicking/tapping any Pāli word hit-tests the exact word and opens the
/// offline dictionary popup immediately (`single` or `double` tap trigger).
class ReaderPane extends ConsumerStatefulWidget {
  final String bookCode;
  final int chapterIndex;
  final int? highlightParaIndex;
  final VoidCallback? onOpenGoTo;
  final void Function(CanonParagraph? para)? onOpenMatJump;
  final VoidCallback? onOpenDatabases;
  final VoidCallback? onOpenOutline;
  final ValueChanged<ChapterContentBundle>? onBundleLoaded;

  const ReaderPane({
    super.key,
    required this.bookCode,
    this.chapterIndex = 0,
    this.highlightParaIndex,
    this.onOpenGoTo,
    this.onOpenMatJump,
    this.onOpenDatabases,
    this.onOpenOutline,
    this.onBundleLoaded,
  });

  @override
  ConsumerState<ReaderPane> createState() => _ReaderPaneState();
}

class _ReaderPaneState extends ConsumerState<ReaderPane> {
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _contentHitTestKey = GlobalKey();
  late final ReaderWordLookupController _lookupController;

  ChapterContentBundle? _bundle;
  String? _error;
  bool _loading = true;
  final Map<int, GlobalKey> _paraKeys = {};
  ReaderWordHitResult? _highlightedHit;
  String _selectedText = '';
  int? _scrolledHighlightIdx;

  @override
  void initState() {
    super.initState();
    _lookupController = ReaderWordLookupController();
    Future.microtask(_loadChapter);
  }

  @override
  void didUpdateWidget(covariant ReaderPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.bookCode != widget.bookCode ||
        oldWidget.chapterIndex != widget.chapterIndex) {
      _highlightedHit = null;
      _scrolledHighlightIdx = null;
      _loadChapter();
    } else if (oldWidget.highlightParaIndex != widget.highlightParaIndex &&
        widget.highlightParaIndex != null &&
        widget.highlightParaIndex != _scrolledHighlightIdx) {
      _scrollToParagraph(widget.highlightParaIndex!);
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  List<String> _installedTranslationCodes(Map<String, dynamic> installed) {
    final codes = <String>[];
    for (final name in installed.keys) {
      final m = RegExp(r'^translation_([a-z_]+)\.db$').firstMatch(name);
      if (m != null) codes.add(m.group(1)!);
    }
    codes.sort();
    return codes;
  }

  Future<void> _loadChapter() async {
    final dlState = ref.read(downloadControllerProvider);
    final installed = dlState.installedDbs;
    final tipitakaInfo = installed['tipitaka.db'];
    if (tipitakaInfo == null) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'tipitaka.db is not installed.';
      });
      return;
    }

    final transCodes = _installedTranslationCodes(installed);
    if (transCodes.isNotEmpty) {
      ref
          .read(readerSettingsProvider.notifier)
          .ensureTranslationInitialized(transCodes, dlState.selectedLanguageCode);
    }

    final settings = ref.read(readerSettingsProvider);
    final translationDbPaths = <String, String>{
      for (final lang in settings.enabledTranslations)
        if (installed.containsKey('translation_$lang.db'))
          lang: installed['translation_$lang.db']!.path,
    };

    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final repo = ref.read(tipitakaRepositoryProvider);
      final loaded = repo.loadChapter(
        tipitakaInfo.path,
        rawBookCode: widget.bookCode,
        chapterIndex: widget.chapterIndex,
        translationDbPaths: translationDbPaths,
        translationLangCode: settings.enabledTranslations.firstOrNull,
        paliSentencesDbPath: installed['pali_sentences.db']?.path,
        showFootnotes: settings.showFootnotes,
      );
      if (!mounted) return;
      _paraKeys.clear();
      for (final p in loaded.paragraphs) {
        _paraKeys[p.paraIndex] = GlobalKey();
      }
      setState(() {
        _bundle = loaded;
        _loading = false;
      });
      widget.onBundleLoaded?.call(loaded);

      final chapTitle = loaded.chapters
              .where((c) => c.chapterIndex == loaded.currentChapterIndex)
              .firstOrNull
              ?.title ??
          '';
      ref.read(workspaceProvider.notifier).recordHistory(
            bookCode: loaded.book.code,
            bookTitle: loaded.book.title,
            nikaya: loaded.book.nikaya,
            chapterIndex: loaded.currentChapterIndex,
            chapterTitle: chapTitle,
          );

      if (widget.highlightParaIndex != null) {
        _scrollToParagraph(widget.highlightParaIndex!);
      } else if (_scrollController.hasClients) {
        _scrollController.jumpTo(0);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _scrollToParagraph(int targetIdx) {
    _scrolledHighlightIdx = targetIdx;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final key = _paraKeys[targetIdx];
      final ctx = key?.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(
          ctx,
          alignment: 0.15,
          duration: const Duration(milliseconds: 260),
        );
      }
    });
  }

  void _navigateToChapter(int chapterIndex, {int? paraIndex}) {
    ref.read(workspaceProvider.notifier).openBook(
          bookCode: _bundle?.book.code ?? widget.bookCode,
          bookTitle: _bundle?.book.title,
          nikaya: _bundle?.book.nikaya ?? '',
          category: _bundle?.book.category ?? '',
          chapterIndex: chapterIndex,
          targetParaIndex: paraIndex,
        );
  }

  void _handleLookupResult(TapLookupResult res) {
    if (!res.shouldLookup || res.hit == null) return;
    setState(() => _highlightedHit = res.hit);
    showDictionaryPopup(
      context,
      initialWord: res.word!,
      quoteJoinedFallback: res.hit?.joinedWord,
      onManageDictionaries: widget.onOpenDatabases,
    );
  }

  void _showParagraphActions(CanonParagraph para) {
    final bundle = _bundle;
    if (bundle == null) return;
    final chapTitle = bundle.chapters
            .where((c) => c.chapterIndex == bundle.currentChapterIndex)
            .firstOrNull
            ?.title ??
        '';

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                para.paraNum != null && para.paraNum!.isNotEmpty
                    ? 'Paragraph ${para.paraNum}'
                    : 'Section #${para.paraIndex}',
                style: Theme.of(ctx).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ListTile(
                leading: const Icon(Icons.layers_outlined),
                title: const Text('MAT Parallel Jump (Mūla / Aṭṭhakathā / Ṭīkā)'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  widget.onOpenMatJump?.call(para);
                },
              ),
              ListTile(
                leading: const Icon(Icons.bookmark_add_outlined),
                title: const Text('Bookmark this paragraph'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  ref.read(workspaceProvider.notifier).toggleBookmark(
                        bookCode: bundle.book.code,
                        bookTitle: bundle.book.title,
                        nikaya: bundle.book.nikaya,
                        chapterIndex: bundle.currentChapterIndex,
                        chapterTitle: chapTitle,
                        paraIndex: para.paraIndex,
                        paraNum: para.paraNum,
                        snippet: para.paliText.length > 120
                            ? '${para.paliText.substring(0, 120)}…'
                            : para.paliText,
                      );
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Bookmark updated'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.copy_outlined),
                title: const Text('Copy paragraph text'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Clipboard.setData(ClipboardData(text: para.paliText));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Copied to clipboard'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(readerSettingsProvider);
    final dlState = ref.watch(downloadControllerProvider);
    _lookupController.setTrigger(settings.dictLookupTrigger);

    // Reload chapter when translations or footnote settings change
    ref.listen<ReaderSettings>(readerSettingsProvider, (prev, next) {
      if (prev != null &&
          (prev.enabledTranslations.join(',') !=
                  next.enabledTranslations.join(',') ||
              prev.showFootnotes != next.showFootnotes ||
              prev.sentenceMode != next.sentenceMode)) {
        _loadChapter();
      }
    });

    final preset = settings.themePreset;
    final accent = settings.accentPreset.color;
    final bundle = _bundle;

    if (_loading) {
      return Container(
        color: preset.background,
        child: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Container(
        color: preset.background,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline, color: accent, size: 36),
                const SizedBox(height: 10),
                Text(
                  'Could not open text: $_error',
                  style: TextStyle(color: preset.textColor),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _loadChapter,
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (bundle == null || bundle.paragraphs.isEmpty) {
      return Container(
        color: preset.background,
        child: Center(
          child: Text(
            'No readable paragraphs found.',
            style: TextStyle(color: preset.textColor),
          ),
        ),
      );
    }

    final installed = dlState.installedDbs;
    final transCodes = _installedTranslationCodes(installed);
    final hasSentencesDb = installed.containsKey('pali_sentences.db');

    final chapIdxInList = bundle.chapters.indexWhere(
      (c) => c.chapterIndex == bundle.currentChapterIndex,
    );
    final prevChap = chapIdxInList > 0
        ? bundle.chapters[chapIdxInList - 1]
        : null;
    final nextChap =
        chapIdxInList >= 0 && chapIdxInList < bundle.chapters.length - 1
            ? bundle.chapters[chapIdxInList + 1]
            : null;
    final currentChapTitle = chapIdxInList >= 0
        ? bundle.chapters[chapIdxInList].title
        : bundle.book.title;

    return Container(
      color: preset.background,
      child: Column(
        children: [
          // Reader Action / Chapter / MAT / Translation / Script Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: preset.secondaryBackground,
              border: Border(
                bottom: BorderSide(color: preset.borderColor),
              ),
            ),
            child: Row(
              children: [
                if (widget.onOpenOutline != null)
                  IconButton(
                    tooltip: 'Chapters & Outline',
                    visualDensity: VisualDensity.compact,
                    icon: Icon(Icons.toc, color: preset.textColor),
                    onPressed: widget.onOpenOutline,
                  ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        PaliScriptConverter.convertFromRoman(
                          bundle.book.title,
                          settings.paliScript,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                          color: preset.textColor,
                        ),
                      ),
                      Text(
                        PaliScriptConverter.convertFromRoman(
                          currentChapTitle,
                          settings.paliScript,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: preset.mutedTextColor,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      if (_selectedText.trim().isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FilledButton.icon(
                            style: FilledButton.styleFrom(
                              backgroundColor: accent,
                              visualDensity: VisualDensity.compact,
                            ),
                            icon: const Icon(Icons.search, size: 15),
                            label: const Text('Define'),
                            onPressed: () => showDictionaryPopup(
                              context,
                              initialWord: _selectedText,
                              onManageDictionaries: widget.onOpenDatabases,
                            ),
                          ),
                        ),
                      if (widget.onOpenGoTo != null)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: ActionChip(
                            visualDensity: VisualDensity.compact,
                            avatar: const Icon(Icons.navigation_outlined, size: 15),
                            label: const Text('Go To'),
                            onPressed: widget.onOpenGoTo,
                          ),
                        ),
                      if (widget.onOpenMatJump != null && !bundle.mat.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: ActionChip(
                            visualDensity: VisualDensity.compact,
                            avatar: const Icon(Icons.layers_outlined, size: 15),
                            label: const Text('MAT'),
                            onPressed: () => widget.onOpenMatJump!(null),
                          ),
                        ),
                      if (transCodes.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: _TranslationSelectorChip(
                            installedLangs: transCodes,
                            hasSentencesDb: hasSentencesDb,
                          ),
                        ),
                      IconButton(
                        tooltip: 'Previous Chapter',
                        visualDensity: VisualDensity.compact,
                        icon: Icon(
                          Icons.chevron_left,
                          color: prevChap != null
                              ? preset.textColor
                              : preset.mutedTextColor.withValues(alpha: 0.4),
                        ),
                        onPressed: prevChap == null
                            ? null
                            : () => _navigateToChapter(prevChap.chapterIndex),
                      ),
                      IconButton(
                        tooltip: 'Next Chapter',
                        visualDensity: VisualDensity.compact,
                        icon: Icon(
                          Icons.chevron_right,
                          color: nextChap != null
                              ? preset.textColor
                              : preset.mutedTextColor.withValues(alpha: 0.4),
                        ),
                        onPressed: nextChap == null
                            ? null
                            : () => _navigateToChapter(nextChap.chapterIndex),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Main text body with pointer hit-test -> click word -> popup dictionary
          Expanded(
            child: NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n is ScrollStartNotification) {
                  _lookupController.clearTapState();
                }
                return false;
              },
              child: Listener(
                key: _contentHitTestKey,
                behavior: HitTestBehavior.translucent,
                onPointerDown: (e) {
                  final res = _lookupController.handlePointerDown(
                    pointer: e.pointer,
                    localPosition: e.localPosition,
                    globalPosition: e.position,
                    timestampMs: e.timeStamp.inMilliseconds,
                    contentHitTestKey: _contentHitTestKey,
                  );
                  _handleLookupResult(res);
                },
                onPointerMove: (e) {
                  _lookupController.handlePointerMove(e.pointer, e.localPosition);
                },
                onPointerUp: (e) {
                  final res = _lookupController.handlePointerUp(
                    pointer: e.pointer,
                    globalPosition: e.position,
                    timestampMs: e.timeStamp.inMilliseconds,
                    contentHitTestKey: _contentHitTestKey,
                    hasSelection: _selectedText.trim().isNotEmpty,
                  );
                  _handleLookupResult(res);
                },
                onPointerCancel: (e) {
                  _lookupController.handlePointerCancel(e.pointer);
                },
                child: SelectionArea(
                  onSelectionChanged: (sel) {
                    final txt = sel?.plainText ?? '';
                    if (txt != _selectedText) {
                      setState(() => _selectedText = txt);
                    }
                  },
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 20,
                    ),
                    itemCount: bundle.paragraphs.length + 1,
                    itemBuilder: (ctx, idx) {
                      if (idx == bundle.paragraphs.length) {
                        return _ChapterNavFooter(
                          prevChap: prevChap,
                          nextChap: nextChap,
                          script: settings.paliScript,
                          preset: preset,
                          onSelectChapter: _navigateToChapter,
                        );
                      }

                      final para = bundle.paragraphs[idx];
                      final isSearchTarget =
                          widget.highlightParaIndex != null &&
                          para.paraIndex == widget.highlightParaIndex;

                      return Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 960),
                          child: _ReaderParagraphItem(
                            key: _paraKeys[para.paraIndex],
                            para: para,
                            settings: settings,
                            isSearchTarget: isSearchTarget,
                            highlightedHit:
                                _highlightedHit?.paraIndex == para.paraIndex
                                    ? _highlightedHit
                                    : null,
                            onShowActions: () => _showParagraphActions(para),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TranslationSelectorChip extends ConsumerWidget {
  final List<String> installedLangs;
  final bool hasSentencesDb;

  const _TranslationSelectorChip({
    required this.installedLangs,
    required this.hasSentencesDb,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(readerSettingsProvider);
    final activeCount = settings.enabledTranslations
        .where(installedLangs.contains)
        .length;

    return ActionChip(
      visualDensity: VisualDensity.compact,
      avatar: const Icon(Icons.translate, size: 15),
      label: Text(
        activeCount == 0
            ? 'Translations'
            : settings.enabledTranslations
                .where(installedLangs.contains)
                .map((l) => l.toUpperCase())
                .join('+'),
      ),
      onPressed: () {
        showDialog<void>(
          context: context,
          builder: (ctx) => Consumer(
            builder: (_, dialogRef, _) {
              final cur = dialogRef.watch(readerSettingsProvider);
              final ctrl = dialogRef.read(readerSettingsProvider.notifier);
              return AlertDialog(
                title: const Text('Languages & Layout'),
                content: SizedBox(
                  width: 360,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Show Pāli Text'),
                          value: cur.showPali,
                          onChanged: (v) =>
                              ctrl.update((s) => s.copyWith(showPali: v)),
                        ),
                        SegmentedButton<ReaderDisplayMode>(
                          segments: ReaderDisplayMode.values
                              .map(
                                (m) => ButtonSegment(
                                  value: m,
                                  label: Text(m.label),
                                ),
                              )
                              .toList(),
                          selected: {cur.displayMode},
                          onSelectionChanged: (sel) => ctrl.update(
                            (s) => s.copyWith(displayMode: sel.first),
                          ),
                        ),
                        const SizedBox(height: 8),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Sentence-Aligned Mode'),
                          subtitle: Text(
                            hasSentencesDb
                                ? 'Align Pāli & translations sentence by sentence'
                                : 'Download pali_sentences.db in Databases to enable',
                          ),
                          value: cur.sentenceMode && hasSentencesDb,
                          onChanged: hasSentencesDb
                              ? (v) => ctrl.update(
                                    (s) => s.copyWith(sentenceMode: v),
                                  )
                              : null,
                        ),
                        const Divider(),
                        Text(
                          'Downloaded Translations',
                          style: Theme.of(ctx).textTheme.labelMedium,
                        ),
                        const SizedBox(height: 6),
                        for (final lang in installedLangs)
                          CheckboxListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(lang.toUpperCase()),
                            value: cur.enabledTranslations.contains(lang),
                            onChanged: (_) => ctrl.toggleTranslationLang(lang),
                          ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: const Text('Done'),
                  ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

class _ReaderParagraphItem extends StatelessWidget {
  final CanonParagraph para;
  final ReaderSettings settings;
  final bool isSearchTarget;
  final ReaderWordHitResult? highlightedHit;
  final VoidCallback onShowActions;

  const _ReaderParagraphItem({
    super.key,
    required this.para,
    required this.settings,
    required this.isSearchTarget,
    required this.highlightedHit,
    required this.onShowActions,
  });

  @override
  Widget build(BuildContext context) {
    final preset = settings.themePreset;
    final accent = settings.accentPreset.color;
    final hasTranslations =
        para.translationsByLang.isNotEmpty ||
        (para.translationText?.isNotEmpty ?? false);
    final useSentenceMode =
        settings.sentenceMode && para.sentences.isNotEmpty && settings.showPali;
    final isWide = MediaQuery.of(context).size.width >= 760;
    final isSideBySide =
        settings.displayMode == ReaderDisplayMode.sideBySide &&
        isWide &&
        hasTranslations &&
        settings.showPali;

    final padding = para.isHeading
        ? const EdgeInsets.only(top: 14, bottom: 8)
        : para.isGatha
            ? const EdgeInsets.fromLTRB(26, 2, 12, 4)
            : const EdgeInsets.symmetric(vertical: 6);

    final bgColor = isSearchTarget
        ? accent.withValues(alpha: 0.12)
        : Colors.transparent;

    return Container(
      margin: padding,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10),
        border: isSearchTarget
            ? Border.all(color: accent.withValues(alpha: 0.5))
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (settings.showPageBreaks && para.pageBreaks.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Wrap(
                spacing: 6,
                children: [
                  for (final pb in para.pageBreaks)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: preset.secondaryBackground,
                        borderRadius: BorderRadius.circular(5),
                        border: Border.all(color: preset.borderColor),
                      ),
                      child: Text(
                        pb.displayLabel,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: preset.mutedTextColor,
                        ),
                      ),
                    ),
                ],
              ),
            ),

          if (useSentenceMode)
            _buildSentenceAlignedBody(preset, accent, isSideBySide)
          else if (isSideBySide)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 11,
                  child: _buildPaliParagraphWidget(preset, accent),
                ),
                const SizedBox(width: 18),
                Expanded(
                  flex: 10,
                  child: _buildTranslationsColumn(preset, accent),
                ),
              ],
            )
          else ...[
            if (settings.showPali) _buildPaliParagraphWidget(preset, accent),
            if (hasTranslations) ...[
              if (settings.showPali) const SizedBox(height: 6),
              _buildTranslationsColumn(preset, accent),
            ],
          ],
        ],
      ),
    );
  }

  Widget _buildSentenceAlignedBody(
    ReaderThemePreset preset,
    Color accent,
    bool isSideBySide,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final s in para.sentences)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: isSideBySide
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 11,
                        child: _buildHitTestablePaliText(
                          text: PaliScriptConverter.convertFromRoman(
                            s.paliSentence,
                            settings.paliScript,
                          ),
                          lineId: s.lineId,
                          preset: preset,
                          accent: accent,
                          style: _paliTextStyle(preset),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        flex: 10,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (final e in s.translationsByLang.entries)
                              Text(
                                e.value,
                                style: _transTextStyle(preset),
                              ),
                          ],
                        ),
                      ),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildHitTestablePaliText(
                        text: PaliScriptConverter.convertFromRoman(
                          s.paliSentence,
                          settings.paliScript,
                        ),
                        lineId: s.lineId,
                        preset: preset,
                        accent: accent,
                        style: _paliTextStyle(preset),
                      ),
                      for (final e in s.translationsByLang.entries)
                        Padding(
                          padding: const EdgeInsets.only(top: 3, bottom: 2),
                          child: Container(
                            padding: const EdgeInsets.only(left: 10),
                            decoration: BoxDecoration(
                              border: Border(
                                left: BorderSide(
                                  color: accent.withValues(alpha: 0.4),
                                  width: 2,
                                ),
                              ),
                            ),
                            child: Text(
                              e.value,
                              style: _transTextStyle(preset),
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
      ],
    );
  }

  Widget _buildPaliParagraphWidget(ReaderThemePreset preset, Color accent) {
    final displayText = PaliScriptConverter.convertFromRoman(
      para.paliText,
      settings.paliScript,
    );
    final align = para.isHeading && (para.rend == 'centre' || para.rend == 'nikaya' || para.rend == 'book' || para.rend == 'title')
        ? TextAlign.center
        : (settings.justifyText && !para.isGatha
            ? TextAlign.justify
            : TextAlign.start);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (settings.showParaNumbers &&
            para.paraNum != null &&
            para.paraNum!.isNotEmpty)
          SelectionContainer.disabled(
            child: GestureDetector(
              onTap: onShowActions,
              child: Padding(
                padding: const EdgeInsets.only(right: 8, top: 3),
                child: Tooltip(
                  message: 'Paragraph actions / MAT Jump / Bookmark',
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: preset.secondaryBackground,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: preset.borderColor),
                    ),
                    child: Text(
                      para.paraNum!,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: accent,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        Expanded(
          child: _buildHitTestablePaliText(
            text: displayText,
            lineId: null,
            preset: preset,
            accent: accent,
            style: _paliTextStyle(preset),
            textAlign: align,
          ),
        ),
        SelectionContainer.disabled(
          child: IconButton(
            visualDensity: VisualDensity.compact,
            iconSize: 16,
            tooltip: 'Paragraph actions / MAT Jump',
            icon: Icon(
              Icons.more_horiz,
              color: preset.mutedTextColor.withValues(alpha: 0.7),
            ),
            onPressed: onShowActions,
          ),
        ),
      ],
    );
  }

  Widget _buildHitTestablePaliText({
    required String text,
    required int? lineId,
    required ReaderThemePreset preset,
    required Color accent,
    required TextStyle style,
    TextAlign textAlign = TextAlign.start,
  }) {
    final activeHighlight = highlightedHit;
    final matchesThisLine =
        activeHighlight != null &&
        activeHighlight.paraIndex == para.paraIndex &&
        activeHighlight.lineId == lineId &&
        !activeHighlight.range.isCollapsed &&
        activeHighlight.range.end <= text.length;

    InlineSpan span;
    if (matchesThisLine) {
      final r = activeHighlight.range;
      span = TextSpan(
        style: style,
        children: [
          if (r.start > 0) TextSpan(text: text.substring(0, r.start)),
          TextSpan(
            text: text.substring(r.start, r.end),
            style: TextStyle(
              backgroundColor: accent.withValues(alpha: 0.24),
              color: accent,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (r.end < text.length) TextSpan(text: text.substring(r.end)),
        ],
      );
    } else {
      span = TextSpan(text: text, style: style);
    }

    return MetaData(
      behavior: HitTestBehavior.translucent,
      metaData: ReaderSegmentMeta(
        paraIndex: para.paraIndex,
        lineId: lineId,
        segment: 'pali',
      ),
      child: Text.rich(span, textAlign: textAlign),
    );
  }

  Widget _buildTranslationsColumn(ReaderThemePreset preset, Color accent) {
    final map = para.translationsByLang.isNotEmpty
        ? para.translationsByLang
        : {
            if (para.translationText != null && para.translationText!.isNotEmpty)
              'tr': para.translationText!,
          };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final entry in map.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: accent.withValues(alpha: 0.45),
                  width: 2.5,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (map.length > 1)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(
                      entry.key.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: accent,
                      ),
                    ),
                  ),
                Text(entry.value, style: _transTextStyle(preset)),
              ],
            ),
          ),
      ],
    );
  }

  TextStyle _paliTextStyle(ReaderThemePreset preset) {
    final accent = settings.accentPreset.color;
    if (para.rend == 'nikaya' || para.rend == 'book' || para.rend == 'title') {
      return TextStyle(
        fontSize: settings.fontSize + 4,
        fontWeight: FontWeight.w800,
        color: accent,
        height: 1.35,
      );
    }
    if (para.rend == 'chapter' || para.rend == 'subhead') {
      return TextStyle(
        fontSize: settings.fontSize + 2,
        fontWeight: FontWeight.w700,
        color: accent,
        height: 1.4,
      );
    }
    return TextStyle(
      fontSize: settings.fontSize,
      height: settings.lineHeight,
      color: preset.textColor,
      fontStyle: para.rend == 'centre' ? FontStyle.italic : FontStyle.normal,
    );
  }

  TextStyle _transTextStyle(ReaderThemePreset preset) => TextStyle(
        fontSize: (settings.fontSize - 2).clamp(13.0, 26.0),
        height: settings.lineHeight * 0.92,
        color: preset.mutedTextColor,
      );
}

class _ChapterNavFooter extends StatelessWidget {
  final CanonChapterSummary? prevChap;
  final CanonChapterSummary? nextChap;
  final PaliScript script;
  final ReaderThemePreset preset;
  final void Function(int chapterIndex) onSelectChapter;

  const _ChapterNavFooter({
    required this.prevChap,
    required this.nextChap,
    required this.script,
    required this.preset,
    required this.onSelectChapter,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 20, 10, 40),
      child: Row(
        children: [
          if (prevChap != null)
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => onSelectChapter(prevChap!.chapterIndex),
                icon: const Icon(Icons.arrow_back),
                label: Text(
                  PaliScriptConverter.convertFromRoman(prevChap!.title, script),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            )
          else
            const Spacer(),
          const SizedBox(width: 12),
          if (nextChap != null)
            Expanded(
              child: FilledButton.icon(
                onPressed: () => onSelectChapter(nextChap!.chapterIndex),
                icon: const Icon(Icons.arrow_forward),
                label: Text(
                  PaliScriptConverter.convertFromRoman(nextChap!.title, script),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            )
          else
            const Spacer(),
        ],
      ),
    );
  }
}
