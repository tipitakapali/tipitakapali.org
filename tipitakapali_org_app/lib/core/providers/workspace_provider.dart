import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BookTabState {
  final String bookCode;
  final String bookTitle;
  final String nikaya;
  final String category;
  final int chapterIndex;
  final int? targetParaIndex;
  final String? targetParaNum;

  const BookTabState({
    required this.bookCode,
    required this.bookTitle,
    this.nikaya = '',
    this.category = '',
    this.chapterIndex = 0,
    this.targetParaIndex,
    this.targetParaNum,
  });

  BookTabState copyWith({
    String? bookCode,
    String? bookTitle,
    String? nikaya,
    String? category,
    int? chapterIndex,
    int? targetParaIndex,
    String? targetParaNum,
    bool clearTargetPara = false,
  }) {
    return BookTabState(
      bookCode: bookCode ?? this.bookCode,
      bookTitle: bookTitle ?? this.bookTitle,
      nikaya: nikaya ?? this.nikaya,
      category: category ?? this.category,
      chapterIndex: chapterIndex ?? this.chapterIndex,
      targetParaIndex:
          clearTargetPara ? null : (targetParaIndex ?? this.targetParaIndex),
      targetParaNum:
          clearTargetPara ? null : (targetParaNum ?? this.targetParaNum),
    );
  }

  Map<String, dynamic> toJson() => {
    'bookCode': bookCode,
    'bookTitle': bookTitle,
    'nikaya': nikaya,
    'category': category,
    'chapterIndex': chapterIndex,
    'targetParaIndex': targetParaIndex,
    'targetParaNum': targetParaNum,
  };

  factory BookTabState.fromJson(Map<String, dynamic> json) => BookTabState(
    bookCode: json['bookCode']?.toString() ?? '',
    bookTitle: json['bookTitle']?.toString() ?? '',
    nikaya: json['nikaya']?.toString() ?? '',
    category: json['category']?.toString() ?? '',
    chapterIndex: (json['chapterIndex'] as num?)?.toInt() ?? 0,
    targetParaIndex: (json['targetParaIndex'] as num?)?.toInt(),
    targetParaNum: json['targetParaNum']?.toString(),
  );
}

class BookmarkEntry {
  final String id;
  final String bookCode;
  final String bookTitle;
  final String nikaya;
  final int chapterIndex;
  final String chapterTitle;
  final int? paraIndex;
  final String? paraNum;
  final String snippet;
  final int createdAtMs;

  const BookmarkEntry({
    required this.id,
    required this.bookCode,
    required this.bookTitle,
    this.nikaya = '',
    required this.chapterIndex,
    this.chapterTitle = '',
    this.paraIndex,
    this.paraNum,
    this.snippet = '',
    required this.createdAtMs,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'bookCode': bookCode,
    'bookTitle': bookTitle,
    'nikaya': nikaya,
    'chapterIndex': chapterIndex,
    'chapterTitle': chapterTitle,
    'paraIndex': paraIndex,
    'paraNum': paraNum,
    'snippet': snippet,
    'createdAtMs': createdAtMs,
  };

  factory BookmarkEntry.fromJson(Map<String, dynamic> json) => BookmarkEntry(
    id: json['id']?.toString() ?? '',
    bookCode: json['bookCode']?.toString() ?? '',
    bookTitle: json['bookTitle']?.toString() ?? '',
    nikaya: json['nikaya']?.toString() ?? '',
    chapterIndex: (json['chapterIndex'] as num?)?.toInt() ?? 0,
    chapterTitle: json['chapterTitle']?.toString() ?? '',
    paraIndex: (json['paraIndex'] as num?)?.toInt(),
    paraNum: json['paraNum']?.toString(),
    snippet: json['snippet']?.toString() ?? '',
    createdAtMs: (json['createdAtMs'] as num?)?.toInt() ?? 0,
  );
}

class HistoryEntry {
  final String bookCode;
  final String bookTitle;
  final String nikaya;
  final int chapterIndex;
  final String chapterTitle;
  final int? paraIndex;
  final String? paraNum;
  final int visitedAtMs;

  const HistoryEntry({
    required this.bookCode,
    required this.bookTitle,
    this.nikaya = '',
    required this.chapterIndex,
    this.chapterTitle = '',
    this.paraIndex,
    this.paraNum,
    required this.visitedAtMs,
  });

  Map<String, dynamic> toJson() => {
    'bookCode': bookCode,
    'bookTitle': bookTitle,
    'nikaya': nikaya,
    'chapterIndex': chapterIndex,
    'chapterTitle': chapterTitle,
    'paraIndex': paraIndex,
    'paraNum': paraNum,
    'visitedAtMs': visitedAtMs,
  };

  factory HistoryEntry.fromJson(Map<String, dynamic> json) => HistoryEntry(
    bookCode: json['bookCode']?.toString() ?? '',
    bookTitle: json['bookTitle']?.toString() ?? '',
    nikaya: json['nikaya']?.toString() ?? '',
    chapterIndex: (json['chapterIndex'] as num?)?.toInt() ?? 0,
    chapterTitle: json['chapterTitle']?.toString() ?? '',
    paraIndex: (json['paraIndex'] as num?)?.toInt(),
    paraNum: json['paraNum']?.toString(),
    visitedAtMs: (json['visitedAtMs'] as num?)?.toInt() ?? 0,
  );
}

class WorkspaceState {
  final List<BookTabState> openTabs;
  final int activeTabIndex; // -1 means Welcome / Home view
  final bool isSidebarOpen;
  final List<BookmarkEntry> bookmarks;
  final List<HistoryEntry> history;

  const WorkspaceState({
    this.openTabs = const [],
    this.activeTabIndex = -1,
    this.isSidebarOpen = true,
    this.bookmarks = const [],
    this.history = const [],
  });

  BookTabState? get activeTab =>
      activeTabIndex >= 0 && activeTabIndex < openTabs.length
      ? openTabs[activeTabIndex]
      : null;

  WorkspaceState copyWith({
    List<BookTabState>? openTabs,
    int? activeTabIndex,
    bool? isSidebarOpen,
    List<BookmarkEntry>? bookmarks,
    List<HistoryEntry>? history,
  }) {
    return WorkspaceState(
      openTabs: openTabs ?? this.openTabs,
      activeTabIndex: activeTabIndex ?? this.activeTabIndex,
      isSidebarOpen: isSidebarOpen ?? this.isSidebarOpen,
      bookmarks: bookmarks ?? this.bookmarks,
      history: history ?? this.history,
    );
  }
}

final workspaceProvider =
    NotifierProvider<WorkspaceController, WorkspaceState>(
      WorkspaceController.new,
    );

class WorkspaceController extends Notifier<WorkspaceState> {
  static const _tabsKey = 'tipitaka_open_tabs_v1';
  static const _activeTabKey = 'tipitaka_active_tab_idx_v1';
  static const _bookmarksKey = 'tipitaka_bookmarks_v2';
  static const _historyKey = 'tipitaka_history_v1';
  bool _loaded = false;

  @override
  WorkspaceState build() {
    if (!_loaded) {
      _loaded = true;
      Future.microtask(_load);
    }
    return const WorkspaceState();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final tabsRaw = prefs.getString(_tabsKey);
      final bookmarksRaw = prefs.getString(_bookmarksKey);
      final historyRaw = prefs.getString(_historyKey);
      final activeIdx = prefs.getInt(_activeTabKey) ?? -1;

      final tabs = <BookTabState>[];
      if (tabsRaw != null && tabsRaw.isNotEmpty) {
        final decoded = jsonDecode(tabsRaw);
        if (decoded is List) {
          for (final item in decoded) {
            if (item is Map<String, dynamic>) {
              final t = BookTabState.fromJson(item);
              if (t.bookCode.isNotEmpty) tabs.add(t);
            }
          }
        }
      }

      final bookmarks = <BookmarkEntry>[];
      if (bookmarksRaw != null && bookmarksRaw.isNotEmpty) {
        final decoded = jsonDecode(bookmarksRaw);
        if (decoded is List) {
          for (final item in decoded) {
            if (item is Map<String, dynamic>) {
              bookmarks.add(BookmarkEntry.fromJson(item));
            }
          }
        }
      }

      final history = <HistoryEntry>[];
      if (historyRaw != null && historyRaw.isNotEmpty) {
        final decoded = jsonDecode(historyRaw);
        if (decoded is List) {
          for (final item in decoded) {
            if (item is Map<String, dynamic>) {
              history.add(HistoryEntry.fromJson(item));
            }
          }
        }
      }

      final safeIdx = tabs.isEmpty
          ? -1
          : activeIdx.clamp(-1, tabs.length - 1);

      state = state.copyWith(
        openTabs: tabs,
        activeTabIndex: safeIdx,
        bookmarks: bookmarks,
        history: history,
      );
    } catch (_) {}
  }

  Future<void> _saveTabs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _tabsKey,
        jsonEncode(state.openTabs.map((t) => t.toJson()).toList()),
      );
      await prefs.setInt(_activeTabKey, state.activeTabIndex);
    } catch (_) {}
  }

  Future<void> _saveBookmarks() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _bookmarksKey,
        jsonEncode(state.bookmarks.map((b) => b.toJson()).toList()),
      );
    } catch (_) {}
  }

  Future<void> _saveHistory() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _historyKey,
        jsonEncode(state.history.map((h) => h.toJson()).toList()),
      );
    } catch (_) {}
  }

  void openBook({
    required String bookCode,
    String? bookTitle,
    String nikaya = '',
    String category = '',
    int chapterIndex = 0,
    int? targetParaIndex,
    String? targetParaNum,
    bool openInNewTab = false,
  }) {
    final cleanCode = bookCode.replaceAll('.xml', '').trim();
    final existingIdx = openInNewTab
        ? -1
        : state.openTabs.indexWhere((t) => t.bookCode == cleanCode);

    final nextTabs = List<BookTabState>.from(state.openTabs);
    int nextActive;

    if (existingIdx >= 0) {
      nextTabs[existingIdx] = nextTabs[existingIdx].copyWith(
        bookTitle: bookTitle ?? nextTabs[existingIdx].bookTitle,
        chapterIndex: chapterIndex,
        targetParaIndex: targetParaIndex,
        targetParaNum: targetParaNum,
        clearTargetPara: targetParaIndex == null && targetParaNum == null,
      );
      nextActive = existingIdx;
    } else {
      nextTabs.add(
        BookTabState(
          bookCode: cleanCode,
          bookTitle: (bookTitle != null && bookTitle.isNotEmpty)
              ? bookTitle
              : cleanCode,
          nikaya: nikaya,
          category: category,
          chapterIndex: chapterIndex,
          targetParaIndex: targetParaIndex,
          targetParaNum: targetParaNum,
        ),
      );
      nextActive = nextTabs.length - 1;
    }

    state = state.copyWith(openTabs: nextTabs, activeTabIndex: nextActive);
    _saveTabs();
  }

  void updateActiveTabPosition({
    required String bookCode,
    String? bookTitle,
    String? nikaya,
    String? category,
    required int chapterIndex,
    int? paraIndex,
    String? paraNum,
  }) {
    final idx = state.activeTabIndex;
    if (idx < 0 || idx >= state.openTabs.length) return;
    if (state.openTabs[idx].bookCode != bookCode) return;

    final nextTabs = List<BookTabState>.from(state.openTabs);
    nextTabs[idx] = nextTabs[idx].copyWith(
      bookTitle: bookTitle,
      nikaya: nikaya,
      category: category,
      chapterIndex: chapterIndex,
      targetParaIndex: paraIndex,
      targetParaNum: paraNum,
    );
    state = state.copyWith(openTabs: nextTabs);
    _saveTabs();
  }

  void showWelcomeHome() {
    state = state.copyWith(activeTabIndex: -1);
    _saveTabs();
  }

  void switchTab(int index) {
    if (index < -1 || index >= state.openTabs.length) return;
    state = state.copyWith(activeTabIndex: index);
    _saveTabs();
  }

  void closeTab(int index) {
    if (index < 0 || index >= state.openTabs.length) return;
    final nextTabs = List<BookTabState>.from(state.openTabs)..removeAt(index);
    int nextActive = state.activeTabIndex;
    if (nextTabs.isEmpty) {
      nextActive = -1;
    } else if (nextActive >= nextTabs.length) {
      nextActive = nextTabs.length - 1;
    } else if (nextActive > index) {
      nextActive -= 1;
    }
    state = state.copyWith(openTabs: nextTabs, activeTabIndex: nextActive);
    _saveTabs();
  }

  void closeOtherTabs(int keepIndex) {
    if (keepIndex < 0 || keepIndex >= state.openTabs.length) return;
    final kept = state.openTabs[keepIndex];
    state = state.copyWith(openTabs: [kept], activeTabIndex: 0);
    _saveTabs();
  }

  void closeAllTabs() {
    state = state.copyWith(openTabs: const [], activeTabIndex: -1);
    _saveTabs();
  }

  void toggleSidebar() {
    state = state.copyWith(isSidebarOpen: !state.isSidebarOpen);
  }

  void setSidebarOpen(bool open) {
    state = state.copyWith(isSidebarOpen: open);
  }

  void toggleBookmark({
    required String bookCode,
    required String bookTitle,
    String nikaya = '',
    required int chapterIndex,
    String chapterTitle = '',
    int? paraIndex,
    String? paraNum,
    String snippet = '',
  }) {
    final id = '${bookCode}_${chapterIndex}_${paraNum ?? paraIndex ?? 0}';
    final existingIdx = state.bookmarks.indexWhere((b) => b.id == id);
    final next = List<BookmarkEntry>.from(state.bookmarks);
    if (existingIdx >= 0) {
      next.removeAt(existingIdx);
    } else {
      next.insert(
        0,
        BookmarkEntry(
          id: id,
          bookCode: bookCode,
          bookTitle: bookTitle,
          nikaya: nikaya,
          chapterIndex: chapterIndex,
          chapterTitle: chapterTitle,
          paraIndex: paraIndex,
          paraNum: paraNum,
          snippet: snippet,
          createdAtMs: DateTime.now().millisecondsSinceEpoch,
        ),
      );
    }
    state = state.copyWith(bookmarks: next);
    _saveBookmarks();
  }

  void removeBookmark(String id) {
    final next = state.bookmarks.where((b) => b.id != id).toList(growable: false);
    state = state.copyWith(bookmarks: next);
    _saveBookmarks();
  }

  void recordHistory({
    required String bookCode,
    required String bookTitle,
    String nikaya = '',
    required int chapterIndex,
    String chapterTitle = '',
    int? paraIndex,
    String? paraNum,
  }) {
    final filtered = state.history
        .where((h) => !(h.bookCode == bookCode && h.chapterIndex == chapterIndex))
        .toList();
    filtered.insert(
      0,
      HistoryEntry(
        bookCode: bookCode,
        bookTitle: bookTitle,
        nikaya: nikaya,
        chapterIndex: chapterIndex,
        chapterTitle: chapterTitle,
        paraIndex: paraIndex,
        paraNum: paraNum,
        visitedAtMs: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    if (filtered.length > 60) {
      filtered.removeRange(60, filtered.length);
    }
    state = state.copyWith(history: filtered);
    _saveHistory();
  }

  void clearHistory() {
    state = state.copyWith(history: const []);
    _saveHistory();
  }
}
