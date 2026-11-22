import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers/reader_settings_provider.dart';
import '../../core/services/tipitaka_repository.dart';
import '../../core/utils/pali_script_converter.dart';
import '../downloads/download_controller.dart';

/// Opens the offline dictionary popup sheet/dialog for [initialWord].
Future<void> showDictionaryPopup(
  BuildContext context, {
  required String initialWord,
  String? quoteJoinedFallback,
  VoidCallback? onManageDictionaries,
}) {
  final isWide = MediaQuery.of(context).size.width >= 760;
  if (isWide) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        child: SizedBox(
          width: 680,
          height: MediaQuery.of(context).size.height * 0.82,
          child: DictionaryPopupPanel(
            initialWord: initialWord,
            quoteJoinedFallback: quoteJoinedFallback,
            onClose: () => Navigator.of(ctx).pop(),
            onManageDictionaries: onManageDictionaries == null
                ? null
                : () {
                    Navigator.of(ctx).pop();
                    onManageDictionaries();
                  },
          ),
        ),
      ),
    );
  }

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (ctx) => FractionallySizedBox(
      heightFactor: 0.78,
      child: DictionaryPopupPanel(
        initialWord: initialWord,
        quoteJoinedFallback: quoteJoinedFallback,
        onClose: () => Navigator.of(ctx).pop(),
        onManageDictionaries: onManageDictionaries == null
            ? null
            : () {
                Navigator.of(ctx).pop();
                onManageDictionaries();
              },
      ),
    ),
  );
}

class DictionaryPopupPanel extends ConsumerStatefulWidget {
  final String initialWord;
  final String? quoteJoinedFallback;
  final VoidCallback? onClose;
  final VoidCallback? onManageDictionaries;

  const DictionaryPopupPanel({
    super.key,
    required this.initialWord,
    this.quoteJoinedFallback,
    this.onClose,
    this.onManageDictionaries,
  });

  @override
  ConsumerState<DictionaryPopupPanel> createState() =>
      _DictionaryPopupPanelState();
}

class _DictionaryPopupPanelState extends ConsumerState<DictionaryPopupPanel> {
  late TextEditingController _controller;
  final List<String> _history = [];
  int _historyIdx = -1;
  DictSource? _sourceFilter;
  DictionaryLookupResult? _result;
  String? _expandedInflectionKey;
  InflectionTableData? _inflectionData;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: PaliScriptConverter.cleanDictionaryQuery(widget.initialWord),
    );
    _lookupWord(
      widget.initialWord,
      quoteJoinedFallback: widget.quoteJoinedFallback,
      pushHistory: true,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  DictionaryDbPaths _resolveDbPaths() {
    final installed = ref.read(downloadControllerProvider).installedDbs;
    return DictionaryDbPaths(
      unifiedDictDbPath: installed['dictionaries.db']?.path,
      dpdDbPath: installed['dpd_tipitakapali.db']?.path,
      synonymsDbPath: installed['dpd_synonyms_tipitakapali.db']?.path,
      splitterDbPath: installed['dpd_splitter_tipitakapali.db']?.path,
      inflectionDbPath: installed['dpd_inflection_tipitakapali.db']?.path,
      ptspedDbPath: installed['ptsped2015ed_tipitakapali.db']?.path,
      abhidhanDbPath: installed['abhidhan_tipitakapali.db']?.path,
      palisinhDbPath: installed['palisinh.db']?.path,
      sanskritDbPath: installed['ap_bh_mw_sanskrit.db']?.path,
    );
  }

  void _lookupWord(
    String query, {
    String? quoteJoinedFallback,
    bool pushHistory = true,
  }) {
    final repo = ref.read(dictionaryRepositoryProvider);
    final paths = _resolveDbPaths();
    final res = repo.lookup(
      query,
      paths,
      quoteJoinedFallback: quoteJoinedFallback,
    );
    final displayQuery = res.normalizedQuery.isNotEmpty
        ? res.normalizedQuery
        : query.trim();

    if (pushHistory && displayQuery.isNotEmpty) {
      if (_historyIdx < _history.length - 1) {
        _history.removeRange(_historyIdx + 1, _history.length);
      }
      if (_history.isEmpty || _history.last != displayQuery) {
        _history.add(displayQuery);
        _historyIdx = _history.length - 1;
      }
    }

    _controller.text = displayQuery;
    _controller.selection = TextSelection.fromPosition(
      TextPosition(offset: displayQuery.length),
    );

    setState(() {
      _result = res;
      _expandedInflectionKey = null;
      _inflectionData = null;
    });
  }

  void _goBack() {
    if (_historyIdx <= 0) return;
    _historyIdx--;
    _lookupWord(_history[_historyIdx], pushHistory: false);
  }

  void _toggleInflection(String key) {
    if (_expandedInflectionKey == key) {
      setState(() {
        _expandedInflectionKey = null;
        _inflectionData = null;
      });
      return;
    }
    final paths = _resolveDbPaths();
    final table = ref
        .read(dictionaryRepositoryProvider)
        .lookupInflection(
          paths.inflectionDbPath,
          key,
          unifiedDictDbPath: paths.unifiedDictDbPath,
        );
    setState(() {
      _expandedInflectionKey = key;
      _inflectionData = table;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final settings = ref.watch(readerSettingsProvider);
    final paths = _resolveDbPaths();
    final res = _result;
    final allEntries = res?.entries ?? const <DictionaryEntry>[];
    final filtered = _sourceFilter == null
        ? allEntries
        : allEntries.where((e) => e.source == _sourceFilter).toList();

    return Column(
      children: [
        // Header + Search input
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 12, 8),
          child: Row(
            children: [
              if (_historyIdx > 0)
                IconButton(
                  tooltip: 'Previous word',
                  icon: const Icon(Icons.arrow_back),
                  onPressed: _goBack,
                ),
              const Icon(Icons.menu_book_outlined, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'Lookup Pāli (Velthuis: aa .m .t ~n supported)',
                    prefixIcon: const Icon(Icons.search, size: 18),
                    suffixIcon: _controller.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 16),
                            onPressed: () {
                              _controller.clear();
                              setState(() {});
                            },
                          )
                        : null,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  onChanged: (value) {
                    final velthuis = PaliScriptConverter.typeVelthuis(value);
                    if (velthuis != value) {
                      _controller.value = TextEditingValue(
                        text: velthuis,
                        selection: TextSelection.collapsed(
                          offset: velthuis.length,
                        ),
                      );
                    }
                  },
                  onSubmitted: (q) => _lookupWord(q),
                ),
              ),
              const SizedBox(width: 6),
              FilledButton(
                onPressed: () => _lookupWord(_controller.text),
                child: const Text('Go'),
              ),
              if (widget.onClose != null)
                IconButton(
                  tooltip: 'Close',
                  icon: const Icon(Icons.close),
                  onPressed: widget.onClose,
                ),
            ],
          ),
        ),

        // Source filter tabs
        if (allEntries.isNotEmpty)
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text('All (${allEntries.length})'),
                    selected: _sourceFilter == null,
                    onSelected: (_) => setState(() => _sourceFilter = null),
                  ),
                ),
                for (final src in DictSource.values)
                  if ((res?.countFor(src) ?? 0) > 0)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text('${src.label} (${res!.countFor(src)})'),
                        selected: _sourceFilter == src,
                        onSelected: (_) => setState(
                          () => _sourceFilter = _sourceFilter == src ? null : src,
                        ),
                      ),
                    ),
              ],
            ),
          ),

        if (res != null && res.synonyms.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Resolved base forms: ${res.synonyms.join(', ')}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.primary,
                ),
              ),
            ),
          ),

        const Divider(height: 1),

        Expanded(
          child: !paths.hasAnyInstalled
              ? _EmptyDictionaryPrompt(
                  onManageDictionaries: widget.onManageDictionaries,
                )
              : filtered.isEmpty
                  ? _NoEntriesView(
                      query: res?.normalizedQuery ?? widget.initialWord,
                      hasSynonymsDb: paths.synonymsDbPath != null,
                      hasSplitterDb: paths.splitterDbPath != null,
                      onManageDictionaries: widget.onManageDictionaries,
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (ctx, idx) {
                        final entry = filtered[idx];
                        return _DictionaryEntryCard(
                          entry: entry,
                          queriedWord: res?.normalizedQuery ?? '',
                          script: settings.paliScript,
                          hasInflectionDb: paths.inflectionDbPath != null,
                          expandedInflectionKey: _expandedInflectionKey,
                          inflectionData: _inflectionData,
                          onTapBreakupWord: (part) => _lookupWord(part),
                          onToggleInflection: _toggleInflection,
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

class _DictionaryEntryCard extends StatelessWidget {
  final DictionaryEntry entry;
  final String queriedWord;
  final PaliScript script;
  final bool hasInflectionDb;
  final String? expandedInflectionKey;
  final InflectionTableData? inflectionData;
  final void Function(String word) onTapBreakupWord;
  final void Function(String key) onToggleInflection;

  const _DictionaryEntryCard({
    required this.entry,
    required this.queriedWord,
    required this.script,
    required this.hasInflectionDb,
    required this.expandedInflectionKey,
    required this.inflectionData,
    required this.onTapBreakupWord,
    required this.onToggleInflection,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final displayHeadword = script == PaliScript.roman
        ? entry.headword
        : '${PaliScriptConverter.convertFromRoman(entry.headword, script)}  (${entry.headword})';

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: SelectableText(
                    displayHeadword,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: colors.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: entry.isExactMatch
                        ? colors.primaryContainer
                        : colors.surfaceContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    entry.dictionaryName,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: entry.isExactMatch
                          ? colors.onPrimaryContainer
                          : colors.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),

            if (entry.grammar != null || entry.coreMeaning != null) ...[
              const SizedBox(height: 6),
              Text.rich(
                TextSpan(
                  children: [
                    if (entry.grammar != null)
                      TextSpan(
                        text: '${entry.grammar} ',
                        style: TextStyle(
                          color: colors.onSurfaceVariant,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                    if (entry.coreMeaning != null)
                      TextSpan(
                        text: entry.coreMeaning,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                  ],
                ),
                style: theme.textTheme.bodyMedium?.copyWith(height: 1.45),
              ),
            ],

            if (entry.breakups.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final breakup in entry.breakups)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      for (var i = 0; i < breakup.split('+').length; i++) ...[
                        if (i > 0)
                          Text(
                            '+',
                            style: TextStyle(
                              color: colors.primary,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ActionChip(
                          visualDensity: VisualDensity.compact,
                          label: Text(breakup.split('+')[i].trim()),
                          onPressed: () =>
                              onTapBreakupWord(breakup.split('+')[i].trim()),
                        ),
                      ],
                    ],
                  ),
                ),
            ] else if (entry.bodyText.isNotEmpty &&
                entry.bodyText.trim() !=
                    [
                      if (entry.grammar != null) entry.grammar!.trim(),
                      if (entry.coreMeaning != null) entry.coreMeaning!.trim(),
                    ].join(' ').trim()) ...[
              const SizedBox(height: 6),
              SelectableText(
                entry.bodyText,
                style: theme.textTheme.bodyMedium?.copyWith(height: 1.48),
              ),
            ],

            if (entry.tags.isNotEmpty || entry.inflectionKey != null) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final t in entry.tags)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: colors.surfaceContainer,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: colors.outlineVariant.withValues(alpha: 0.6),
                        ),
                      ),
                      child: Text(t, style: theme.textTheme.labelSmall),
                    ),
                  if (entry.inflectionKey != null && hasInflectionDb)
                    ActionChip(
                      visualDensity: VisualDensity.compact,
                      avatar: Icon(
                        expandedInflectionKey == entry.inflectionKey
                            ? Icons.expand_less
                            : Icons.table_chart_outlined,
                        size: 16,
                      ),
                      label: const Text('Inflections'),
                      onPressed: () => onToggleInflection(entry.inflectionKey!),
                    ),
                ],
              ),
            ],

            if (entry.inflectionKey != null &&
                expandedInflectionKey == entry.inflectionKey) ...[
              const SizedBox(height: 10),
              if (inflectionData == null || inflectionData!.rows.isEmpty)
                Text(
                  'No inflection table found for "${entry.inflectionKey}".',
                  style: theme.textTheme.bodySmall,
                )
              else
                _InflectionTableWidget(
                  data: inflectionData!,
                  highlightWord: queriedWord,
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _InflectionTableWidget extends StatelessWidget {
  final InflectionTableData data;
  final String highlightWord;

  const _InflectionTableWidget({
    required this.data,
    required this.highlightWord,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final normHighlight = highlightWord.toLowerCase().trim();

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            data.heading,
            style: theme.textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: colors.primary,
            ),
          ),
          const SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Table(
              defaultColumnWidth: const IntrinsicColumnWidth(),
              border: TableBorder.all(
                color: colors.outlineVariant.withValues(alpha: 0.6),
              ),
              children: [
                for (final row in data.rows)
                  TableRow(
                    children: [
                      for (final cell in row)
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 5,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (final form in cell.forms)
                                Container(
                                  decoration:
                                      form.toLowerCase().trim() == normHighlight
                                          ? BoxDecoration(
                                              color: colors.primaryContainer,
                                              borderRadius:
                                                  BorderRadius.circular(4),
                                            )
                                          : null,
                                  padding: form.toLowerCase().trim() ==
                                          normHighlight
                                      ? const EdgeInsets.symmetric(
                                          horizontal: 4,
                                          vertical: 1,
                                        )
                                      : EdgeInsets.zero,
                                  child: Text(
                                    form,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontWeight: cell.isHeader ||
                                              form.toLowerCase().trim() ==
                                                  normHighlight
                                          ? FontWeight.w700
                                          : FontWeight.normal,
                                      color: form.toLowerCase().trim() ==
                                              normHighlight
                                          ? colors.onPrimaryContainer
                                          : null,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyDictionaryPrompt extends StatelessWidget {
  final VoidCallback? onManageDictionaries;

  const _EmptyDictionaryPrompt({this.onManageDictionaries});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.menu_book_outlined, size: 42),
            const SizedBox(height: 12),
            const Text(
              'No offline dictionary database is downloaded yet.',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            const Text(
              'Download DPD, DPD Synonyms, and Sandhi Splitter in Databases for instant word lookup.',
              textAlign: TextAlign.center,
            ),
            if (onManageDictionaries != null) ...[
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: onManageDictionaries,
                icon: const Icon(Icons.download_outlined),
                label: const Text('Open Databases'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _NoEntriesView extends StatelessWidget {
  final String query;
  final bool hasSynonymsDb;
  final bool hasSplitterDb;
  final VoidCallback? onManageDictionaries;

  const _NoEntriesView({
    required this.query,
    required this.hasSynonymsDb,
    required this.hasSplitterDb,
    this.onManageDictionaries,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'No entries found for "$query".',
              style: Theme.of(context).textTheme.titleSmall,
              textAlign: TextAlign.center,
            ),
            if (!hasSynonymsDb || !hasSplitterDb) ...[
              const SizedBox(height: 8),
              Text(
                'Tip: Install DPD Synonyms & Sandhi Splitter so inflected forms and compound words resolve automatically.',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              if (onManageDictionaries != null) ...[
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: onManageDictionaries,
                  child: const Text('Download Dictionary Add-ons'),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
