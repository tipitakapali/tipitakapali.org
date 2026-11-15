import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers/reader_settings_provider.dart';
import '../../core/providers/workspace_provider.dart';
import '../../core/services/tipitaka_repository.dart';
import '../../core/utils/pali_script_converter.dart';
import '../dictionary/dictionary_popup.dart';
import '../downloads/database_manager_screen.dart';
import '../downloads/download_controller.dart';
import '../reader/reader_pane.dart';
import 'workspace_modals.dart';

class TipitakaWorkspaceScreen extends ConsumerStatefulWidget {
  const TipitakaWorkspaceScreen({super.key});

  @override
  ConsumerState<TipitakaWorkspaceScreen> createState() =>
      _TipitakaWorkspaceScreenState();
}

class _TipitakaWorkspaceScreenState
    extends ConsumerState<TipitakaWorkspaceScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  String _treeFilter = '';
  int? _bookCount;
  int? _chapterCount;
  int? _paraCount;
  List<CanonBook> _books = const [];
  List<CanonTreeNode> _rootNodes = const [];
  final Map<int, List<CanonTreeNode>> _childrenCache = {};
  final Set<int> _expandedIds = {};
  String? _loadedDbPath;
  bool _loadingCanon = true;
  ChapterContentBundle? _activeBundle;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadCanon);
  }

  Future<void> _loadCanon() async {
    final installed = ref.read(downloadControllerProvider).installedDbs;
    final tipitakaInfo = installed['tipitaka.db'];
    if (tipitakaInfo == null) {
      if (!mounted) return;
      setState(() {
        _loadingCanon = false;
        _books = const [];
        _rootNodes = const [];
      });
      return;
    }

    if (_loadedDbPath == tipitakaInfo.path && _books.isNotEmpty) return;

    setState(() => _loadingCanon = true);
    try {
      final repo = ref.read(tipitakaRepositoryProvider);
      final stats = repo.getStats(tipitakaInfo.path);
      final books = repo.getBooks(tipitakaInfo.path);
      final roots = repo.getTreeChildren(tipitakaInfo.path);
      if (!mounted) return;
      setState(() {
        _loadedDbPath = tipitakaInfo.path;
        _bookCount = stats.books;
        _chapterCount = stats.chapters;
        _paraCount = stats.paragraphs;
        _books = books;
        _rootNodes = roots;
        _childrenCache.clear();
        _expandedIds.clear();
        _loadingCanon = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingCanon = false);
    }
  }

  void _toggleNode(CanonTreeNode node) {
    if (node.isFolder) {
      setState(() {
        if (_expandedIds.contains(node.id)) {
          _expandedIds.remove(node.id);
        } else {
          _expandedIds.add(node.id);
          if (!_childrenCache.containsKey(node.id) && _loadedDbPath != null) {
            _childrenCache[node.id] = ref
                .read(tipitakaRepositoryProvider)
                .getTreeChildren(_loadedDbPath!, parentId: node.id);
          }
        }
      });
      return;
    }

    final rawCode = node.bookCode;
    if (rawCode == null || rawCode.isEmpty) return;
    final repo = ref.read(tipitakaRepositoryProvider);
    final norm = repo.normalizeBookAndChapter(rawCode, node.chapterIndex ?? 0);
    final bookMeta = _books.where((b) => b.code == norm.bookCode).firstOrNull;

    ref.read(workspaceProvider.notifier).openBook(
          bookCode: norm.bookCode,
          bookTitle: bookMeta?.title ?? node.text,
          nikaya: bookMeta?.nikaya ?? '',
          category: bookMeta?.category ?? '',
          chapterIndex: norm.chapterIndex,
        );

    if (_scaffoldKey.currentState?.isDrawerOpen ?? false) {
      Navigator.of(context).pop();
    }
  }

  void _openDatabaseManager() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const DatabaseManagerScreen()),
    );
  }

  void _openOutlineSheet(BuildContext context, ChapterContentBundle bundle) {
    final script = ref.read(readerSettingsProvider).paliScript;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => DefaultTabController(
        length: 2,
        child: SizedBox(
          height: MediaQuery.of(ctx).size.height * 0.72,
          child: Column(
            children: [
              const TabBar(
                tabs: [
                  Tab(text: 'Chapters'),
                  Tab(text: 'Outline / Suttas'),
                ],
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    ListView.builder(
                      itemCount: bundle.chapters.length,
                      itemBuilder: (_, idx) {
                        final ch = bundle.chapters[idx];
                        final active =
                            ch.chapterIndex == bundle.currentChapterIndex;
                        return ListTile(
                          selected: active,
                          leading: Text('${ch.chapterIndex + 1}.'),
                          title: Text(
                            PaliScriptConverter.convertFromRoman(
                              ch.title,
                              script,
                            ),
                          ),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            ref.read(workspaceProvider.notifier).openBook(
                                  bookCode: bundle.book.code,
                                  bookTitle: bundle.book.title,
                                  nikaya: bundle.book.nikaya,
                                  chapterIndex: ch.chapterIndex,
                                );
                          },
                        );
                      },
                    ),
                    bundle.toc.isEmpty
                        ? const Center(child: Text('No outline entries.'))
                        : ListView.builder(
                            itemCount: bundle.toc.length,
                            itemBuilder: (_, idx) {
                              final entry = bundle.toc[idx];
                              return ListTile(
                                contentPadding: EdgeInsets.only(
                                  left: 16.0 + entry.level * 14.0,
                                  right: 16,
                                ),
                                title: Text(
                                  PaliScriptConverter.convertFromRoman(
                                    entry.title,
                                    script,
                                  ),
                                ),
                                subtitle: entry.paraNum != null
                                    ? Text('¶ ${entry.paraNum}')
                                    : null,
                                onTap: () {
                                  Navigator.of(ctx).pop();
                                  ref.read(workspaceProvider.notifier).openBook(
                                        bookCode: bundle.book.code,
                                        bookTitle: bundle.book.title,
                                        nikaya: bundle.book.nikaya,
                                        chapterIndex: entry.chapterIndex,
                                        targetParaIndex: entry.paraIndex,
                                        targetParaNum: entry.paraNum,
                                      );
                                },
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
    );
  }

  @override
  Widget build(BuildContext context) {
    final dlState = ref.watch(downloadControllerProvider);
    final installedPath = dlState.installedDbs['tipitaka.db']?.path;
    if (installedPath != null && installedPath != _loadedDbPath) {
      Future.microtask(_loadCanon);
    }

    final ws = ref.watch(workspaceProvider);
    final wsCtrl = ref.read(workspaceProvider.notifier);
    final settings = ref.watch(readerSettingsProvider);
    final settingsCtrl = ref.read(readerSettingsProvider.notifier);
    final preset = settings.themePreset;
    final accent = settings.accentPreset.color;

    final isWide = MediaQuery.of(context).size.width >= 720;
    final activeTab = ws.activeTab;

    final sidebar = _NavigationSidebar(
      loading: _loadingCanon,
      rootNodes: _rootNodes,
      books: _books,
      childrenCache: _childrenCache,
      expandedIds: _expandedIds,
      filterText: _treeFilter,
      script: settings.paliScript,
      preset: preset,
      accent: accent,
      onFilterChanged: (v) => setState(() => _treeFilter = v),
      onToggleNode: _toggleNode,
      onOpenBook: (book) {
        wsCtrl.openBook(
          bookCode: book.code,
          bookTitle: book.title,
          nikaya: book.nikaya,
          category: book.category,
        );
        if (_scaffoldKey.currentState?.isDrawerOpen ?? false) {
          Navigator.of(context).pop();
        }
      },
    );

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: preset.background,
      drawer: isWide ? null : Drawer(child: SafeArea(child: sidebar)),
      body: SafeArea(
        child: Column(
          children: [
            // Header bar modeled after tipitakapali.org Header.jsx
            Container(
              height: 50,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: preset.secondaryBackground,
                border: Border(bottom: BorderSide(color: preset.borderColor)),
              ),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Toggle Navigation Tree',
                    icon: Icon(Icons.menu, color: preset.textColor),
                    onPressed: () {
                      if (isWide) {
                        wsCtrl.toggleSidebar();
                      } else {
                        _scaffoldKey.currentState?.openDrawer();
                      }
                    },
                  ),
                  InkWell(
                    onTap: wsCtrl.showWelcomeHome,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 4,
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.auto_stories,
                            color: accent,
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Tipiṭaka Pāḷi',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: preset.textColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Dictionary Lookup',
                    icon: Icon(Icons.book_outlined, color: preset.textColor),
                    onPressed: () => showDictionaryPopup(
                      context,
                      initialWord: '',
                      onManageDictionaries: _openDatabaseManager,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Full-Text Search',
                    icon: Icon(Icons.search, color: preset.textColor),
                    onPressed: () => showFtsSearchModal(
                      context,
                      onOpenDatabases: _openDatabaseManager,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Bookmarks',
                    icon: Icon(Icons.bookmark_border, color: preset.textColor),
                    onPressed: () => showBookmarksModal(context),
                  ),
                  IconButton(
                    tooltip: 'Reading History',
                    icon: Icon(Icons.history, color: preset.textColor),
                    onPressed: () => showHistoryModal(context),
                  ),
                  PopupMenuButton<PaliScript>(
                    tooltip: 'Pāli Script (${settings.paliScript.englishName})',
                    icon: Icon(Icons.font_download_outlined, color: preset.textColor),
                    initialValue: settings.paliScript,
                    onSelected: (s) => settingsCtrl.update(
                      (c) => c.copyWith(paliScript: s),
                    ),
                    itemBuilder: (_) => PaliScript.values
                        .map(
                          (s) => PopupMenuItem(
                            value: s,
                            child: Text('${s.englishName} (${s.nativeName})'),
                          ),
                        )
                        .toList(),
                  ),
                  IconButton(
                    tooltip: 'Reader Settings & Themes',
                    icon: Icon(Icons.settings_outlined, color: preset.textColor),
                    onPressed: () => showReaderSettingsModal(context),
                  ),
                  IconButton(
                    tooltip: 'Offline Databases',
                    icon: Icon(Icons.cloud_download_outlined, color: preset.textColor),
                    onPressed: _openDatabaseManager,
                  ),
                ],
              ),
            ),

            // BookTabsBar modeled after tipitakapali.org BookTabsBar.jsx
            if (ws.openTabs.isNotEmpty)
              _BookTabsBar(
                tabs: ws.openTabs,
                activeIndex: ws.activeTabIndex,
                script: settings.paliScript,
                preset: preset,
                accent: accent,
                onSelectTab: wsCtrl.switchTab,
                onSelectHome: wsCtrl.showWelcomeHome,
                onCloseTab: wsCtrl.closeTab,
                onCloseAll: wsCtrl.closeAllTabs,
              ),

            // Body: Split Navigation Sidebar + Reader / Welcome View
            Expanded(
              child: Row(
                children: [
                  if (isWide && ws.isSidebarOpen)
                    Container(
                      width: 280,
                      decoration: BoxDecoration(
                        color: preset.secondaryBackground,
                        border: Border(
                          right: BorderSide(color: preset.borderColor),
                        ),
                      ),
                      child: sidebar,
                    ),
                  Expanded(
                    child: activeTab != null
                        ? ReaderPane(
                            key: ValueKey(activeTab.bookCode),
                            bookCode: activeTab.bookCode,
                            chapterIndex: activeTab.chapterIndex,
                            highlightParaIndex: activeTab.targetParaIndex,
                            onBundleLoaded: (b) => _activeBundle = b,
                            onOpenDatabases: _openDatabaseManager,
                            onOpenGoTo: () => showGoToModal(
                              context,
                              bookCode: activeTab.bookCode,
                              bookTitle: activeTab.bookTitle,
                              currentChapterIndex: activeTab.chapterIndex,
                            ),
                            onOpenMatJump: (para) => showMatJumpModal(
                              context,
                              bookCode: activeTab.bookCode,
                              chapterIndex: activeTab.chapterIndex,
                              para: para,
                            ),
                            onOpenOutline: () {
                              final b = _activeBundle;
                              if (b != null && b.book.code == activeTab.bookCode) {
                                _openOutlineSheet(context, b);
                              }
                            },
                          )
                        : _WelcomeHomeView(
                            bookCount: _bookCount,
                            chapterCount: _chapterCount,
                            paraCount: _paraCount,
                            books: _books,
                            recentHistory: ws.history,
                            script: settings.paliScript,
                            preset: preset,
                            accent: accent,
                            onLookupWord: (w) => showDictionaryPopup(
                              context,
                              initialWord: w,
                              onManageDictionaries: _openDatabaseManager,
                            ),
                            onOpenSearch: () => showFtsSearchModal(
                              context,
                              onOpenDatabases: _openDatabaseManager,
                            ),
                            onOpenBookCode: (code, {int chapter = 0, String? title}) {
                              wsCtrl.openBook(
                                bookCode: code,
                                bookTitle: title,
                                chapterIndex: chapter,
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BookTabsBar extends StatelessWidget {
  final List<BookTabState> tabs;
  final int activeIndex;
  final PaliScript script;
  final ReaderThemePreset preset;
  final Color accent;
  final ValueChanged<int> onSelectTab;
  final VoidCallback onSelectHome;
  final ValueChanged<int> onCloseTab;
  final VoidCallback onCloseAll;

  const _BookTabsBar({
    required this.tabs,
    required this.activeIndex,
    required this.script,
    required this.preset,
    required this.accent,
    required this.onSelectTab,
    required this.onSelectHome,
    required this.onCloseTab,
    required this.onCloseAll,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      decoration: BoxDecoration(
        color: preset.secondaryBackground,
        border: Border(bottom: BorderSide(color: preset.borderColor)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Library / Welcome',
            visualDensity: VisualDensity.compact,
            icon: Icon(
              Icons.home_outlined,
              size: 18,
              color: activeIndex == -1 ? accent : preset.mutedTextColor,
            ),
            onPressed: onSelectHome,
          ),
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
              itemCount: tabs.length,
              separatorBuilder: (_, _) => const SizedBox(width: 4),
              itemBuilder: (ctx, idx) {
                final tab = tabs[idx];
                final isActive = idx == activeIndex;
                final title = PaliScriptConverter.convertFromRoman(
                  tab.bookTitle,
                  script,
                );
                return Material(
                  color: isActive ? preset.background : preset.secondaryBackground,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => onSelectTab(idx),
                    child: Container(
                      padding: const EdgeInsets.only(left: 10, right: 4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: isActive ? accent : preset.borderColor,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 180),
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: isActive
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: isActive ? accent : preset.textColor,
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          InkWell(
                            onTap: () => onCloseTab(idx),
                            child: Icon(
                              Icons.close,
                              size: 14,
                              color: preset.mutedTextColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          if (tabs.length > 1)
            IconButton(
              tooltip: 'Close all tabs',
              visualDensity: VisualDensity.compact,
              icon: Icon(
                Icons.clear_all,
                size: 18,
                color: preset.mutedTextColor,
              ),
              onPressed: onCloseAll,
            ),
        ],
      ),
    );
  }
}

class _NavigationSidebar extends StatelessWidget {
  final bool loading;
  final List<CanonTreeNode> rootNodes;
  final List<CanonBook> books;
  final Map<int, List<CanonTreeNode>> childrenCache;
  final Set<int> expandedIds;
  final String filterText;
  final PaliScript script;
  final ReaderThemePreset preset;
  final Color accent;
  final ValueChanged<String> onFilterChanged;
  final ValueChanged<CanonTreeNode> onToggleNode;
  final ValueChanged<CanonBook> onOpenBook;

  const _NavigationSidebar({
    required this.loading,
    required this.rootNodes,
    required this.books,
    required this.childrenCache,
    required this.expandedIds,
    required this.filterText,
    required this.script,
    required this.preset,
    required this.accent,
    required this.onFilterChanged,
    required this.onToggleNode,
    required this.onOpenBook,
  });

  List<Widget> _buildTreeNodes(List<CanonTreeNode> nodes, int depth) {
    final widgets = <Widget>[];
    for (final node in nodes) {
      final isExpanded = expandedIds.contains(node.id);
      widgets.add(
        InkWell(
          onTap: () => onToggleNode(node),
          child: Padding(
            padding: EdgeInsets.fromLTRB(10.0 + depth * 12.0, 7, 8, 7),
            child: Row(
              children: [
                Icon(
                  node.isFolder
                      ? (isExpanded ? Icons.expand_more : Icons.chevron_right)
                      : Icons.description_outlined,
                  size: 16,
                  color: node.isFolder ? accent : preset.mutedTextColor,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    PaliScriptConverter.convertFromRoman(node.text, script),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight:
                          node.isFolder ? FontWeight.w600 : FontWeight.normal,
                      color: preset.textColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (node.isFolder && isExpanded) {
        widgets.addAll(
          _buildTreeNodes(childrenCache[node.id] ?? const [], depth + 1),
        );
      }
    }
    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    final normQ = PaliScriptConverter.normalizePaliForSearch(filterText);
    final filteredBooks = normQ.isEmpty
        ? const <CanonBook>[]
        : books
            .where(
              (b) =>
                  PaliScriptConverter.normalizePaliForSearch(b.title)
                      .contains(normQ) ||
                  b.code.toLowerCase().contains(normQ) ||
                  PaliScriptConverter.normalizePaliForSearch(b.nikaya)
                      .contains(normQ),
            )
            .toList(growable: false);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(10),
          child: TextField(
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Filter Canon books...',
              prefixIcon: const Icon(Icons.filter_list, size: 18),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onChanged: onFilterChanged,
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : normQ.isNotEmpty
                  ? ListView.builder(
                      itemCount: filteredBooks.length,
                      itemBuilder: (_, idx) {
                        final b = filteredBooks[idx];
                        return ListTile(
                          dense: true,
                          title: Text(
                            PaliScriptConverter.convertFromRoman(
                              b.title,
                              script,
                            ),
                            style: TextStyle(color: preset.textColor),
                          ),
                          subtitle: Text(
                            '${b.nikaya} • ${b.category}',
                            style: TextStyle(color: preset.mutedTextColor),
                          ),
                          onTap: () => onOpenBook(b),
                        );
                      },
                    )
                  : ListView(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      children: _buildTreeNodes(rootNodes, 0),
                    ),
        ),
      ],
    );
  }
}

class _WelcomeHomeView extends StatefulWidget {
  final int? bookCount;
  final int? chapterCount;
  final int? paraCount;
  final List<CanonBook> books;
  final List<HistoryEntry> recentHistory;
  final PaliScript script;
  final ReaderThemePreset preset;
  final Color accent;
  final ValueChanged<String> onLookupWord;
  final VoidCallback onOpenSearch;
  final void Function(String code, {int chapter, String? title}) onOpenBookCode;

  const _WelcomeHomeView({
    required this.bookCount,
    required this.chapterCount,
    required this.paraCount,
    required this.books,
    required this.recentHistory,
    required this.script,
    required this.preset,
    required this.accent,
    required this.onLookupWord,
    required this.onOpenSearch,
    required this.onOpenBookCode,
  });

  @override
  State<_WelcomeHomeView> createState() => _WelcomeHomeViewState();
}

class _WelcomeHomeViewState extends State<_WelcomeHomeView> {
  final _dictCtrl = TextEditingController();

  @override
  void dispose() {
    _dictCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final preset = widget.preset;
    final accent = widget.accent;

    const nikayaQuick = [
      ('Vinayapiṭaka', 'vin01m.mul', 'Pārājikapāḷi & Discipline'),
      ('Dīghanikāya', 's0101m.mul', 'Long Discourses'),
      ('Majjhimanikāya', 's0201m.mul', 'Middle Length Discourses'),
      ('Saṃyuttanikāya', 's0301m.mul', 'Connected Discourses'),
      ('Aṅguttaranikāya', 's0401m.mul', 'Numerical Discourses'),
      ('Khuddakanikāya', 's0502m.mul', 'Dhammapada, Sutta Nipāta, Jātaka'),
      ('Abhidhammapiṭaka', 'abh01m.mul', 'Dhammasaṅgaṇī & Higher Teaching'),
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 820),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Tipiṭaka Pāḷi Offline',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: preset.textColor,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'CST4 Pāli Canon, Mūla–Aṭṭhakathā–Ṭīkā parallels, translations, full-text search & instant click-on-word DPD lookup.',
                style: TextStyle(color: preset.mutedTextColor),
              ),
              const SizedBox(height: 16),

              if (widget.bookCount != null)
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  children: [
                    _MiniBadge('${widget.bookCount} Books', preset, accent),
                    _MiniBadge(
                      '${widget.chapterCount ?? 0} Chapters',
                      preset,
                      accent,
                    ),
                    _MiniBadge(
                      '${widget.paraCount ?? 0} Paragraphs',
                      preset,
                      accent,
                    ),
                  ],
                ),

              const SizedBox(height: 20),

              // Quick Dictionary & Canon Search bar (matching WelcomeView.jsx)
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _dictCtrl,
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: preset.secondaryBackground,
                        hintText:
                            'Dictionary lookup (Velthuis or 17 scripts, e.g. dhamma, eva.m)...',
                        prefixIcon: const Icon(Icons.menu_book_outlined),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      onChanged: (v) {
                        final conv = PaliScriptConverter.typeVelthuis(v);
                        if (conv != v) {
                          _dictCtrl.value = TextEditingValue(
                            text: conv,
                            selection: TextSelection.collapsed(
                              offset: conv.length,
                            ),
                          );
                        }
                      },
                      onSubmitted: (q) {
                        if (q.trim().isNotEmpty) widget.onLookupWord(q);
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: accent),
                    onPressed: widget.onOpenSearch,
                    icon: const Icon(Icons.search),
                    label: const Text('Full-Text Search'),
                  ),
                ],
              ),

              const SizedBox(height: 24),
              Text(
                'Piṭaka Collections',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: preset.textColor,
                    ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final item in nikayaQuick)
                    if (widget.books.isEmpty ||
                        widget.books.any((b) => b.code == item.$2))
                      SizedBox(
                        width: 256,
                        child: Card(
                          color: preset.secondaryBackground,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(14),
                            onTap: () => widget.onOpenBookCode(
                              item.$2,
                              title: item.$1,
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    PaliScriptConverter.convertFromRoman(
                                      item.$1,
                                      widget.script,
                                    ),
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      color: accent,
                                      fontSize: 15,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    item.$3,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: preset.mutedTextColor,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                ],
              ),

              if (widget.recentHistory.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text(
                  'Continue Reading',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: preset.textColor,
                      ),
                ),
                const SizedBox(height: 8),
                for (final h in widget.recentHistory.take(5))
                  Card(
                    color: preset.secondaryBackground,
                    margin: const EdgeInsets.only(bottom: 6),
                    child: ListTile(
                      leading: Icon(Icons.history, color: accent),
                      title: Text(
                        PaliScriptConverter.convertFromRoman(
                          h.bookTitle,
                          widget.script,
                        ),
                        style: TextStyle(color: preset.textColor),
                      ),
                      subtitle: Text(
                        '${h.chapterTitle.isNotEmpty ? h.chapterTitle : h.bookCode} · Ch ${h.chapterIndex + 1}',
                        style: TextStyle(color: preset.mutedTextColor),
                      ),
                      onTap: () => widget.onOpenBookCode(
                        h.bookCode,
                        chapter: h.chapterIndex,
                        title: h.bookTitle,
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniBadge extends StatelessWidget {
  final String label;
  final ReaderThemePreset preset;
  final Color accent;

  const _MiniBadge(this.label, this.preset, this.accent);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: preset.secondaryBackground,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: preset.borderColor),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: accent,
        ),
      ),
    );
  }
}
