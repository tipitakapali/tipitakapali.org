'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { fetchBook, fetchChapter, fetchMat, lookupBookInfo, fetchBookTocOnly } from '../services/api';
import { splitScriptCode } from '../services/transliterate';
import { useThemeSettings } from './ThemeSettingsContext';

const TabContext = createContext();

const STORAGE_KEYS = {
  TABS: 'tipitaka_saved_tabs_v2',
  ACTIVE: 'tipitaka_active_book_v2',
  SCROLL: 'tipitaka_tab_scrolls_v2',
  BOOKMARKS: 'tipitaka_bookmarks_v2',
  HISTORY: 'tipitaka_recent_history_v2',
};

function resolveNearestChapterAndPara(paraToChapMap, rawParaNum, subBook = null, subBooksParaMap = null) {
  let mapToUse = null;
  let isSubSpecific = false;
  if (subBook && subBooksParaMap && subBooksParaMap[subBook]) {
    mapToUse = subBooksParaMap[subBook];
    isSubSpecific = true;
  } else if (!subBook) {
    mapToUse = paraToChapMap;
  } else {
    // A specific subBook was requested, but subBooksParaMap[subBook] is not available.
    // Do NOT fall back to flat paraToChapMap to avoid clobbering with another sub-book!
    return null;
  }
  if (!mapToUse || !rawParaNum) return null;
  const cleanPara = String(rawParaNum).replace(/^(?:para-?|p)/i, '').trim();
  if (mapToUse[cleanPara] !== undefined) {
    return { chapterIdx: mapToUse[cleanPara], paraNum: cleanPara, isSubSpecific };
  }
  const targetInt = parseInt(cleanPara, 10);
  if (isNaN(targetInt)) return null;

  let bestNum = null;
  let bestChap = null;
  for (const [pStr, cIdx] of Object.entries(mapToUse)) {
    const pInt = parseInt(pStr, 10);
    if (!isNaN(pInt) && pInt <= targetInt) {
      if (bestNum === null || pInt > bestNum) {
        bestNum = pInt;
        bestChap = cIdx;
      }
    }
  }
  if (bestChap !== null) {
    return { chapterIdx: bestChap, paraNum: bestNum !== null ? String(bestNum) : cleanPara, isSubSpecific };
  }
  return null;
}

function getFirstParaOfChapter(paraToChapMap, targetChapIdx, subBook = null, subBooksParaMap = null) {
  let mapToUse = null;
  if (subBook && subBooksParaMap && subBooksParaMap[subBook]) {
    mapToUse = subBooksParaMap[subBook];
  } else if (!subBook) {
    mapToUse = paraToChapMap;
  } else {
    return null;
  }
  if (!mapToUse || targetChapIdx === undefined || targetChapIdx === null) return null;
  let firstNum = null;
  let minNum = Infinity;
  for (const [pStr, cIdx] of Object.entries(mapToUse)) {
    if (cIdx === targetChapIdx) {
      const pInt = parseInt(pStr, 10);
      if (!isNaN(pInt) && pInt < minNum) {
        minNum = pInt;
        firstNum = pStr;
      }
    }
  }
  return firstNum;
}

function getChapterIdxForParaIndex(chapters, targetParaIndex) {
  if (!Array.isArray(chapters) || chapters.length === 0) return null;
  if (targetParaIndex === undefined || targetParaIndex === null || targetParaIndex === '') return null;
  const t = parseInt(String(targetParaIndex).trim(), 10);
  if (isNaN(t)) return null;
  // Chapters are sorted by chapter_index, but use para_index to find container
  // Find greatest chapter where para_index <= t
  let best = null;
  // Create sorted copy by para_index ascending to be robust
  const sorted = [...chapters].sort((a, b) => {
    const aIdx = a.para_index !== undefined && a.para_index !== null ? parseInt(a.para_index, 10) : 0;
    const bIdx = b.para_index !== undefined && b.para_index !== null ? parseInt(b.para_index, 10) : 0;
    return aIdx - bIdx;
  });
  for (const ch of sorted) {
    const start = ch.para_index !== undefined && ch.para_index !== null ? parseInt(ch.para_index, 10) : 0;
    if (isNaN(start)) continue;
    if (t >= start) {
      best = ch.chapter_index;
    } else {
      break;
    }
  }
  if (best !== null) return best;
  // Fallback: if not found (e.g. para_index smaller than first chapter start), return first chapter
  return sorted[0]?.chapter_index ?? 0;
}

export function TabProvider({ children }) {


  const { setIsZenMode, updateSetting } = useThemeSettings();

  const [openTabs, setOpenTabs] = useState([]);
  const [activeBookCode, setActiveBookCode] = useState(null);
  const [activeParaNum, setActiveParaNum] = useState(null);
  const [loadingBook, setLoadingBook] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isGoToOpen, setIsGoToOpen] = useState(false);
  const [goToInitialTab, setGoToInitialTab] = useState('para');
  const [goToInitialEdition, setGoToInitialEdition] = useState(null);
  const [isBookmarkOpen, setIsBookmarkOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [searchHighlight, setSearchHighlight] = useState(null);
  const [targetScrollIntent, setTargetScrollIntent] = useState(null);
  const [treeSelectedNode, setTreeSelectedNode] = useState(null);
  const [activeEditionPages, setActiveEditionPages] = useState({});
  const [isNotFound, setIsNotFound] = useState(false);

  const [bookmarks, setBookmarks] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);

  const openTabsRef = useRef([]);
  const activeBookCodeRef = useRef(null);
  const activeParaNumRef = useRef(null);
  const isSidebarOpenRef = useRef(isSidebarOpen);

  const tabScrollMemoryRef = useRef({});
  // bookCode -> URL script prefix (e.g. 'si') for tabs opened via script-prefixed URLs,
  // so updateUrlParams keeps the prefix in the address bar (deep-links stay script-specific)
  const tabScriptPrefixRef = useRef({});

  openTabsRef.current = openTabs;
  activeBookCodeRef.current = activeBookCode;
  activeParaNumRef.current = activeParaNum;
  isSidebarOpenRef.current = isSidebarOpen;

  // Load saved bookmarks, history, and scroll positions from localStorage & handle mobile layout
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }

    try {
      const savedBookmarks = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));

      const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (savedHistory) setRecentHistory(JSON.parse(savedHistory));

      const savedScrolls = localStorage.getItem(STORAGE_KEYS.SCROLL);
      if (savedScrolls) tabScrollMemoryRef.current = JSON.parse(savedScrolls);
    } catch (e) {
      console.warn('Failed to load storage items:', e);
    }
  }, []);

  // Save Bookmarks to localStorage
  const saveBookmarksToStorage = (updated) => {
    setBookmarks(updated);
    try {
      localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(updated));
    } catch (e) {}
  };

  const addBookmark = useCallback((item) => {
    const newEntry = {
      id: item.id || `${item.bookCode}_${item.chapterIdx || 0}_${item.paraNum || item.paraIndex || Date.now()}`,
      bookCode: item.bookCode,
      bookTitle: item.bookTitle,
      nikaya: item.nikaya || '',
      chapterIdx: item.chapterIdx || 0,
      chapterTitle: item.chapterTitle || '',
      paraIndex: item.paraIndex,
      paraNum: item.paraNum,
      snippet: item.snippet || item.chapterTitle || item.bookTitle,
      timestamp: Date.now(),
    };

    setBookmarks((prev) => {
      const filtered = prev.filter(
        (b) => !(b.bookCode === newEntry.bookCode && b.chapterIdx === newEntry.chapterIdx && b.paraNum === newEntry.paraNum)
      );
      const updated = [newEntry, ...filtered];
      try {
        localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);

  const removeBookmark = useCallback((id) => {
    setBookmarks((prev) => {
      const updated = prev.filter((b) => b.id !== id);
      try {
        localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);

  const isBookmarked = useCallback((bookCode, chapterIdx, paraNum) => {
    if (!bookCode) return false;
    return bookmarks.some(
      (b) =>
        b.bookCode === bookCode &&
        b.chapterIdx === (chapterIdx || 0) &&
        (paraNum ? b.paraNum === paraNum : true)
    );
  }, [bookmarks]);

  // Save Recent History to localStorage
  const addToHistory = useCallback((item) => {
    if (!item?.bookCode || !item?.bookTitle) return;
    setRecentHistory((prev) => {
      const filtered = prev.filter((h) => h.bookCode !== item.bookCode);
      const newEntry = {
        id: `${item.bookCode}_${item.chapterIdx || 0}_${item.paraNum || item.paraIndex || Date.now()}`,
        bookCode: item.bookCode,
        bookTitle: item.bookTitle,
        nikaya: item.nikaya || '',
        chapterIdx: item.chapterIdx || 0,
        chapterTitle: item.chapterTitle || '',
        paraNum: item.paraNum,
        paraIndex: item.paraIndex,
        snippet: item.snippet || item.chapterTitle || item.bookTitle,
        lastReadTime: Date.now(),
      };
      const updated = [newEntry, ...filtered].slice(0, 50); // Keep latest 50
      try {
        localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setRecentHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch (e) {}
  }, []);

  // Helper to update URL search parameters and path without reloading (clean /book/:code/:chapter path)
  // Preserves existing hash (#para1091 / #p1091 / #pindex-*) — fixing fragment race
  const updateUrlParams = useCallback((paramsToUpdate) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location);
    const preservedHash = window.location.hash || '';

    if (paramsToUpdate) {
      const bookTarget = paramsToUpdate.book !== undefined ? paramsToUpdate.book : activeBookCodeRef.current;
      const chapterTarget = paramsToUpdate.chapter !== undefined ? paramsToUpdate.chapter : null;

      if (bookTarget === null) {
        url.pathname = '/';
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
        url.searchParams.delete('chapter');
        url.searchParams.delete('c');
      } else if (bookTarget) {
        const prefix = tabScriptPrefixRef.current[bookTarget];
        const fullBookCode = prefix ? `${prefix}.${bookTarget}` : bookTarget;

        if (chapterTarget && parseInt(chapterTarget, 10) > 0) {
          url.pathname = `/book/${fullBookCode}/${chapterTarget}`;
        } else {
          url.pathname = `/book/${fullBookCode}`;
        }
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
        url.searchParams.delete('chapter');
        url.searchParams.delete('c');
      }

      Object.entries(paramsToUpdate).forEach(([k, v]) => {
        if (k === 'book' || k === 'chapter' || k === 'c' || k === 'book_code') return;
        if (v === null || v === undefined) {
          url.searchParams.delete(k);
        } else {
          url.searchParams.set(k, v);
        }
      });
    }

    const newUrl = url.pathname + (url.search || '') + preservedHash;
    const currentFull = window.location.pathname + window.location.search + window.location.hash;
    if (currentFull !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // Save tabs list to localStorage for session resumption
  const persistTabs = useCallback((tabs, activeCode) => {
    if (typeof window === 'undefined') return;
    try {
      const minifiedTabs = tabs.map((t) => ({
        bookCode: t.bookCode,
        currentChapterIdx: t.currentChapterIdx ?? null,
        lastParaNum: t.lastParaNum || (t.bookCode === activeBookCodeRef.current ? activeParaNumRef.current : undefined),
        viewMode: t.viewMode || (t.isTocView ? 'toc' : undefined),
        isTocView: t.isTocView || t.viewMode === 'toc' || false,
      }));
      localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(minifiedTabs));
      if (activeCode) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE, activeCode);
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE);
      }
    } catch (e) {}
  }, []);

  // Save exact tab position (chapter, paragraph, and pixel scroll)
  const saveTabPosition = useCallback((bookCode, chapterIdx, paraNum, scrollTop) => {
    if (!bookCode) return;
    if (scrollTop !== undefined && scrollTop !== null) {
      tabScrollMemoryRef.current[bookCode] = scrollTop;
      try {
        localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
      } catch (e) {}
    }

    if (chapterIdx !== undefined && chapterIdx !== null) {
      // If active tab, synchronize URL ?chapter=X and navigation tree
      if (activeBookCodeRef.current === bookCode) {
        updateUrlParams({ chapter: chapterIdx + 1 });
        setTreeSelectedNode((prev) => {
          if (prev?.bookCode === bookCode && prev?.chapterIdx === chapterIdx) return prev;
          return { bookCode, chapterIdx };
        });
      }
    }

    setOpenTabs((prev) => {
      let hasChanged = false;
      const updated = prev.map((t) => {
        if (t.bookCode === bookCode) {
          const newChapIdx = chapterIdx !== undefined ? chapterIdx : t.currentChapterIdx;
          const newPara = paraNum || t.lastParaNum;
          if (t.currentChapterIdx !== newChapIdx || t.lastParaNum !== newPara) {
            hasChanged = true;
            return {
              ...t,
              currentChapterIdx: newChapIdx,
              lastParaNum: newPara,
            };
          }
        }
        return t;
      });
      if (hasChanged) {
        persistTabs(updated, activeBookCodeRef.current);
        return updated;
      }
      return prev;
    });
  }, [persistTabs, updateUrlParams]);

  // Load a single chapter into an open tab (on demand / lazy loading)
  const loadChapter = useCallback(async (bookCode, chapterIdx) => {
    if (!bookCode || chapterIdx === undefined || chapterIdx === null) return;
    const cleanCode = bookCode.replace('.xml', '');

    const tab = openTabsRef.current.find((t) => t.bookCode === cleanCode);
    if (!tab) return;
    if (tab.loadedChapters?.[chapterIdx] || tab.loadingChapters?.[chapterIdx]) return;

    setOpenTabs((prev) =>
      prev.map((t) =>
        t.bookCode === cleanCode
          ? {
              ...t,
              loadingChapters: { ...t.loadingChapters, [chapterIdx]: true },
            }
          : t
      )
    );

    try {
      const res = await fetchChapter(cleanCode, chapterIdx);
      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.bookCode !== cleanCode) return t;
          const newLoaded = { ...t.loadedChapters, [chapterIdx]: res.html };
          const newLoading = { ...t.loadingChapters, [chapterIdx]: false };
          return {
            ...t,
            loadedChapters: newLoaded,
            loadingChapters: newLoading,
          };
        })
      );
    } catch (err) {
      console.warn(`[LazyLoad] Failed to load chapter ${chapterIdx} for ${cleanCode}:`, err);
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.bookCode === cleanCode
            ? {
                ...t,
                loadingChapters: { ...t.loadingChapters, [chapterIdx]: false },
              }
            : t
        )
      );
    }
  }, []);

  // Buffer adjacent chapters ahead in background
  const bufferAdjacentChapters = useCallback(
    (bookCode, centerIdx) => {
      if (!bookCode || centerIdx === undefined || centerIdx === null) return;
      const cleanCode = bookCode.replace('.xml', '');
      const tab = openTabsRef.current.find((t) => t.bookCode === cleanCode);
      if (!tab) return;

      const totalChaps = tab.chapters?.length || 1;
      const toBuffer = [centerIdx + 1, centerIdx - 1, centerIdx + 2];

      toBuffer.forEach((idx) => {
        if (idx >= 0 && idx < totalChaps && !tab.loadedChapters?.[idx] && !tab.loadingChapters?.[idx]) {
          setTimeout(() => {
            loadChapter(cleanCode, idx);
          }, 80);
        }
      });
    },
    [loadChapter]
  );

  const openBook = useCallback(
    async (bookCode, options = {}) => {
      if (!bookCode) return;
      setIsNotFound(false);
      let cleanCode = bookCode.replace('.xml', '');

      // Optional script prefix (e.g. si.abh03m10.mul -> abh03m10.mul): apply the script
      // app-wide (global setting) and remember the prefix so the URL keeps it.
      const scriptSplit = splitScriptCode(cleanCode);
      if (scriptSplit.scriptId) {
        cleanCode = scriptSplit.bookCode;
        updateSetting('paliScript', scriptSplit.scriptId);
      }

      let hasTargetChapter = options.targetChapterIdx !== undefined && options.targetChapterIdx !== null;
      let targetChapIdx = hasTargetChapter ? options.targetChapterIdx : null;

      // Handle chapter suffix in code (e.g. s0201m.mul1 -> s0201m.mul, chapter_index 1)
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        if (!hasTargetChapter) {
          targetChapIdx = parseInt(chapSuffixMatch[2], 10);
          hasTargetChapter = true;
        }
      }

      // Record the script prefix keyed by the final (chapter-suffix-stripped) book code
      if (scriptSplit.scriptId) {
        tabScriptPrefixRef.current[cleanCode] = scriptSplit.prefix;
      }

      const rawParaNum = options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '') : null;
      const hasParaTarget = rawParaNum || (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '');
      const hasPageTarget = !!options.targetPage;
      // TOC request: no specific chapter/para/page — show book's TOC
      const isTocRequest = !hasTargetChapter && !hasParaTarget && !hasPageTarget;


      const currentTabs = openTabsRef.current;
      const existingTabIndex = currentTabs.findIndex((t) => t.bookCode === cleanCode);

      if (options.zenMode === true) {
        setIsZenMode(true);
        setIsSidebarOpen(false);
        if (typeof document !== 'undefined') {
          document.body.classList.add('zen-mode');
        }
      } else {
        setIsZenMode(false);
        if (typeof document !== 'undefined') {
          document.body.classList.remove('zen-mode');
        }
      }


      if (existingTabIndex !== -1) {
        setActiveBookCode((prev) => (prev !== cleanCode ? cleanCode : prev));
        const tab = currentTabs[existingTabIndex];

        // TOC request — show book TOC (no auto chapter 1)
        if (isTocRequest) {
          const needsTocFetch = !tab.toc || tab.toc.length === 0 || !tab.chapters || tab.chapters.length === 0;
          const nextTabsToc = currentTabs.map((t) =>
            t.bookCode === cleanCode ? { ...t, viewMode: 'toc', isTocView: true, currentChapterIdx: null, isLoading: needsTocFetch } : t
          );
          setOpenTabs(nextTabsToc);
          persistTabs(nextTabsToc, cleanCode);
          setActiveBookCode(cleanCode);
          setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: null });
          updateUrlParams({ book: cleanCode, chapter: null, q: null, search: null });
          setTargetScrollIntent(null);
          setSearchHighlight(null);
          if (needsTocFetch) {
            setLoadingBook(true);
            fetchBookTocOnly(cleanCode)
              .then((bData) => {
                if (bData) {
                  setOpenTabs((prev) =>
                    prev.map((t) =>
                      t.bookCode === cleanCode
                        ? {
                            ...t,
                            title: bData.title || t.title,
                            nikaya: bData.nikaya || t.nikaya,
                            category: bData.category || t.category,
                            chapter_count: bData.chapter_count || t.chapter_count,
                            chapters: bData.chapters || t.chapters,
                            toc: bData.toc || t.toc,
                            para_to_chapter: bData.para_to_chapter || t.para_to_chapter,
                            para_to_index: bData.para_to_index || t.para_to_index,
                            page_to_chapter: bData.page_to_chapter || t.page_to_chapter,
                            viewMode: 'toc',
                            isTocView: true,
                            isLoading: false,
                          }
                        : t
                    )
                  );
                }
              })
              .catch(() => {})
              .finally(() => {
                setLoadingBook(false);
              });
          }
          addToHistory({
            bookCode: cleanCode,
            bookTitle: tab.title,
            nikaya: tab.nikaya,
            chapterIdx: 0,
            chapterTitle: '',
          });
          return;
        }

        // Ensure tab has full metadata (para_to_chapter, page_to_chapter, sub_books, etc.)
        if (
          !tab.para_to_chapter ||
          Object.keys(tab.para_to_chapter).length === 0 ||
          !tab.page_to_chapter ||
          Object.keys(tab.page_to_chapter).length === 0
        ) {
          fetchBook(cleanCode, { chapter: targetChapIdx })
            .then((bData) => {
              if (bData) {
                setOpenTabs((prev) =>
                  prev.map((t) =>
                    t.bookCode === cleanCode
                      ? {
                          ...t,
                          para_to_chapter: bData.para_to_chapter || {},
                          para_to_index: bData.para_to_index || {},
                          page_to_chapter: bData.page_to_chapter || {},
                          page_to_para: bData.page_to_para || {},
                          page_anchors: bData.page_anchors || {},
                          para_range: bData.para_range || t.para_range,
                          edition_ranges: bData.edition_ranges || t.edition_ranges,
                          book_type: bData.book_type || t.book_type || 'Whole',
                          sub_books: bData.sub_books || t.sub_books || null,
                          sub_book: bData.sub_book || t.sub_book || null,
                          chapter_to_sub_book: bData.chapter_to_sub_book || t.chapter_to_sub_book || null,
                          sub_books_para_to_chapter: bData.sub_books_para_to_chapter || t.sub_books_para_to_chapter || null,
                          attha_start_chapter: bData.attha_start_chapter !== undefined ? bData.attha_start_chapter : t.attha_start_chapter,
                          tika_start_chapter: bData.tika_start_chapter !== undefined ? bData.tika_start_chapter : t.tika_start_chapter,
                          toc: bData.toc?.length ? bData.toc : t.toc,
                          mat: bData.mat || t.mat,
                          loadedChapters: { ...t.loadedChapters, ...bData.chapters_data },
                        }
                      : t
                  )

                );
              }
            })
            .catch(() => {});
        }

        const targetSub = options.targetSubBook || tab.sub_book || tab.chapter_to_sub_book?.[targetChapIdx ?? tab.currentChapterIdx ?? 0];
        if (rawParaNum && tab.para_to_chapter) {
          const resolved = resolveNearestChapterAndPara(tab.para_to_chapter, rawParaNum, targetSub, tab.sub_books_para_to_chapter);
          if (resolved) {
            if (!hasTargetChapter || resolved.isSubSpecific) {
              targetChapIdx = resolved.chapterIdx;
              hasTargetChapter = true;
              setActiveParaNum(resolved.paraNum || rawParaNum);
            }
          }
        }

        // Fallback: resolve chapter via para_index for headings/subheads where para_num is empty
        if (!hasTargetChapter && options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
          const chapFromIdx = getChapterIdxForParaIndex(tab.chapters, options.targetParaIndex);
          if (chapFromIdx !== null && chapFromIdx !== undefined) {
            targetChapIdx = chapFromIdx;
            hasTargetChapter = true;
            // For para_index targets (e.g. sutta titles), clear activeParaNum if it was stale from previous chapter
            // ReaderView will scroll via paraIndex, not paraNum
          }
        }

        if (hasTargetChapter && !rawParaNum && (options.targetParaIndex === undefined || options.targetParaIndex === null || options.targetParaIndex === '')) {
          const firstP = getFirstParaOfChapter(tab.para_to_chapter, targetChapIdx, targetSub, tab.sub_books_para_to_chapter);
          if (firstP) {
            setActiveParaNum(firstP);
          }
        }

        if (hasTargetChapter) {
          const nextTabs = currentTabs.map((t) =>
            t.bookCode === cleanCode ? { ...t, currentChapterIdx: targetChapIdx, viewMode: 'reader', isTocView: false } : t
          );
          setOpenTabs(nextTabs);
          persistTabs(nextTabs, cleanCode);

          if (!tab.loadedChapters?.[targetChapIdx]) {
            loadChapter(cleanCode, targetChapIdx);
          }
          bufferAdjacentChapters(cleanCode, targetChapIdx);
        }

        if (hasTargetChapter || options.targetParaIndex !== undefined || rawParaNum || options.targetPage) {
          setTargetScrollIntent({
            chapterIdx: hasTargetChapter ? targetChapIdx : undefined,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum,
            subBook: targetSub || undefined,
            page: options.targetPage,
            pageSystem: options.targetPageSystem,
            highlightQuery: options.highlightQuery,
            timestamp: Date.now(),
          });
        } else {
          setTargetScrollIntent(null);
        }

        const activeChap = hasTargetChapter
          ? targetChapIdx
          : currentTabs[existingTabIndex].currentChapterIdx || 0;

        const qParam = options.searchQuery || options.highlightQuery || null;
        if (qParam) {
          setSearchHighlight({
            query: qParam,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum || (options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '').trim() : undefined),
          });
        } else {
          setSearchHighlight(null);
        }
        setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: activeChap });
        updateUrlParams({ book: cleanCode, chapter: activeChap + 1, q: qParam, search: null });
        persistTabs(openTabsRef.current, cleanCode);

        addToHistory({
          bookCode: cleanCode,
          bookTitle: tab.title,
          nikaya: tab.nikaya,
          chapterIdx: activeChap,
          chapterTitle: tab.chapters?.[activeChap]?.title || '',
        });
        return;
      }

      // Optimistic tab creation - instant 0ms tab open
      const bookInfo = lookupBookInfo(cleanCode);
      if (isTocRequest) {
        const optimisticTocTab = {
          bookCode: cleanCode,
          title: options.title || bookInfo?.title || cleanCode,
          nikaya: options.nikaya || bookInfo?.nikaya || '',
          category: options.category || bookInfo?.category || '',
          chapter_count: 1,
          chapters: [],
          toc: [],
          loadedChapters: {},
          loadingChapters: {},
          isLoading: true,
          currentChapterIdx: null,
          viewMode: 'toc',
          isTocView: true,
        };
        const nextTabsOptimistic = [...openTabsRef.current, optimisticTocTab];
        setOpenTabs(nextTabsOptimistic);
        setActiveBookCode(cleanCode);
        persistTabs(nextTabsOptimistic, cleanCode);
        updateUrlParams({ book: cleanCode, chapter: null, q: null, search: null });
        setLoadingBook(true);
        try {
          const bookData = await fetchBookTocOnly(cleanCode);
          const newTocTab = {
            bookCode: bookData.code,
            title: bookData.title,
            nikaya: bookData.nikaya || bookData.category || '',
            category: bookData.category || '',
            chapter_count: bookData.chapter_count,
            chapters: bookData.chapters || [],
            toc: bookData.toc || [],
            mat: bookData.mat || null,
            para_to_chapter: bookData.para_to_chapter || {},
            para_to_index: bookData.para_to_index || {},
            page_to_chapter: bookData.page_to_chapter || {},
            page_to_para: bookData.page_to_para || {},
            page_anchors: bookData.page_anchors || {},
            para_range: bookData.para_range || null,
            edition_ranges: bookData.edition_ranges || null,
            book_type: bookData.book_type || 'Whole',
            sub_books: bookData.sub_books || null,
            sub_book: bookData.sub_book || null,
            chapter_to_sub_book: bookData.chapter_to_sub_book || null,
            sub_books_para_to_chapter: bookData.sub_books_para_to_chapter || null,
            attha_start_chapter: bookData.attha_start_chapter !== undefined ? bookData.attha_start_chapter : null,
            tika_start_chapter: bookData.tika_start_chapter !== undefined ? bookData.tika_start_chapter : null,
            loadedChapters: {},
            loadingChapters: {},
            isLoading: false,
            currentChapterIdx: null,
            viewMode: 'toc',
            isTocView: true,
          };
          const currentTabsNow2 = openTabsRef.current;
          const idx2 = currentTabsNow2.findIndex((t) => t.bookCode === cleanCode);
          let nextTabs2;
          if (idx2 !== -1) {
            nextTabs2 = [...currentTabsNow2];
            nextTabs2[idx2] = { ...nextTabs2[idx2], ...newTocTab };
          } else {
            nextTabs2 = [...currentTabsNow2, newTocTab];
          }
          setOpenTabs(nextTabs2);
          persistTabs(nextTabs2, cleanCode);
          setActiveBookCode(cleanCode);
          setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: null });
          setTargetScrollIntent(null);
          setSearchHighlight(null);
          updateUrlParams({ book: cleanCode, chapter: null, q: null, search: null });
          addToHistory({
            bookCode: cleanCode,
            bookTitle: newTocTab.title,
            nikaya: newTocTab.nikaya,
            chapterIdx: 0,
            chapterTitle: '',
          });
          return;
        } catch (err) {
          console.warn(`[openBook] Failed to open TOC for '${cleanCode}':`, err?.message || err);
          // Remove optimistic tab from state & localStorage
          const cleanedTabs = openTabsRef.current.filter((t) => t.bookCode !== cleanCode);
          const nextActive = cleanedTabs.length > 0 ? cleanedTabs[cleanedTabs.length - 1].bookCode : null;
          setOpenTabs(cleanedTabs);
          setActiveBookCode(nextActive);
          persistTabs(cleanedTabs, nextActive);
          // Clean from recent history if ever present
          setRecentHistory((prev) => {
            const filtered = prev.filter((h) => h.bookCode !== cleanCode);
            try {
              localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(filtered));
            } catch (e) {}
            return filtered;
          });
          setIsNotFound(true);
          return;
        } finally {
          setLoadingBook(false);
        }
      }
      const optimisticTab = {
        bookCode: cleanCode,
        title: options.title || bookInfo?.title || cleanCode,
        nikaya: options.nikaya || bookInfo?.nikaya || '',
        category: options.category || bookInfo?.category || '',
        chapter_count: 1,
        chapters: [],
        toc: [],
        loadedChapters: {},
        loadingChapters: { [targetChapIdx]: true },
        isLoading: true,
        currentChapterIdx: targetChapIdx,
        viewMode: 'reader',
        isTocView: false,
        sub_book: options.targetSubBook || null,
      };
      const nextTabsOptimistic = [...openTabsRef.current, optimisticTab];
      setOpenTabs(nextTabsOptimistic);
      setActiveBookCode(cleanCode);
      persistTabs(nextTabsOptimistic, cleanCode);
      updateUrlParams({ book: cleanCode, chapter: targetChapIdx + 1 });

      setLoadingBook(true);
      try {
        // First resolve chapter if targetParaNum is provided and we can pre-check or load metadata
        const bookData = await fetchBook(cleanCode, {
          chapter: targetChapIdx,
          buffer: 1,
        });

        const targetSub = options.targetSubBook || bookData.sub_book || bookData.chapter_to_sub_book?.[targetChapIdx ?? 0];
        if (rawParaNum && bookData.para_to_chapter) {
          const resolved = resolveNearestChapterAndPara(bookData.para_to_chapter, rawParaNum, targetSub, bookData.sub_books_para_to_chapter);
          if (resolved) {
            if (!hasTargetChapter || resolved.isSubSpecific) {
              targetChapIdx = resolved.chapterIdx;
              hasTargetChapter = true;
              setActiveParaNum(resolved.paraNum || rawParaNum);
            }
          }
        }

        // Fallback: resolve chapter via para_index for headings where para_num is empty (e.g. Paṭhamakoṭigāmasuttaṃ)
        if (!hasTargetChapter && options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
          const chapFromIdx = getChapterIdxForParaIndex(bookData.chapters, options.targetParaIndex);
          if (chapFromIdx !== null && chapFromIdx !== undefined) {
            targetChapIdx = chapFromIdx;
            hasTargetChapter = true;
          }
        }

        // Critical: Ensure targetChapIdx is loaded into chapters_data (especially in static Cloudflare Pages mode)
        if (targetChapIdx !== null && targetChapIdx !== undefined && !bookData.chapters_data?.[targetChapIdx]) {
          try {
            const chapData = await fetchChapter(cleanCode, targetChapIdx);
            if (chapData && chapData.html) {
              bookData.chapters_data = {
                ...(bookData.chapters_data || {}),
                [targetChapIdx]: chapData.html,
              };
            }
          } catch (e) {
            console.warn(`[openBook] Failed to fetch initial target chapter ${targetChapIdx}:`, e);
          }
        }

        if (hasTargetChapter && !rawParaNum && (options.targetParaIndex === undefined || options.targetParaIndex === null || options.targetParaIndex === '')) {
          const firstP = getFirstParaOfChapter(bookData.para_to_chapter, targetChapIdx, targetSub, bookData.sub_books_para_to_chapter);
          if (firstP) {
            setActiveParaNum(firstP);
          }
        }

        const newTab = {
          bookCode: bookData.code,
          title: bookData.title,
          nikaya: bookData.nikaya || bookData.category || '',
          category: bookData.category || '',
          chapter_count: bookData.chapter_count,
          chapters: bookData.chapters || [],
          toc: bookData.toc || [],
          mat: bookData.mat || null,
          para_to_chapter: bookData.para_to_chapter || {},
          para_to_index: bookData.para_to_index || {},
          page_to_chapter: bookData.page_to_chapter || {},
          page_to_para: bookData.page_to_para || {},
          page_anchors: bookData.page_anchors || {},
          para_range: bookData.para_range || null,
          edition_ranges: bookData.edition_ranges || null,
          book_type: bookData.book_type || 'Whole',
          sub_books: bookData.sub_books || null,
          sub_book: bookData.sub_book || null,
          chapter_to_sub_book: bookData.chapter_to_sub_book || null,
          sub_books_para_to_chapter: bookData.sub_books_para_to_chapter || null,
          attha_start_chapter: bookData.attha_start_chapter !== undefined ? bookData.attha_start_chapter : null,
          tika_start_chapter: bookData.tika_start_chapter !== undefined ? bookData.tika_start_chapter : null,

          loadedChapters: { ...bookData.chapters_data },

          loadingChapters: {},
          isLoading: false,
          currentChapterIdx: targetChapIdx,
          viewMode: 'reader',
          isTocView: false,
        };

        const currentTabsNow = openTabsRef.current;
        const idx = currentTabsNow.findIndex((t) => t.bookCode === cleanCode);
        let nextTabs;
        if (idx !== -1) {
          nextTabs = [...currentTabsNow];
          nextTabs[idx] = {
            ...nextTabs[idx],
            ...newTab,
            loadedChapters: { ...nextTabs[idx].loadedChapters, ...newTab.loadedChapters },
          };
        } else {
          nextTabs = [...currentTabsNow, newTab];
        }
        setOpenTabs(nextTabs);
        persistTabs(nextTabs, cleanCode);
        setActiveBookCode(cleanCode);



        if (hasTargetChapter || options.targetParaIndex !== undefined || rawParaNum || options.targetPage) {
          setTargetScrollIntent({
            chapterIdx: hasTargetChapter ? targetChapIdx : undefined,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum,
            subBook: targetSub || undefined,
            page: options.targetPage,
            pageSystem: options.targetPageSystem,
            highlightQuery: options.highlightQuery,
            timestamp: Date.now(),
          });
        } else {
          setTargetScrollIntent(null);
        }


        setTreeSelectedNode({
          bookCode: cleanCode,
          chapterIdx: targetChapIdx,
        });

        const qParam = options.searchQuery || options.highlightQuery || null;
        if (qParam) {
          setSearchHighlight({
            query: qParam,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum || (options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '').trim() : undefined),
          });
        } else {
          setSearchHighlight(null);
        }
        updateUrlParams({ book: cleanCode, chapter: targetChapIdx + 1, q: qParam, search: null });
        bufferAdjacentChapters(cleanCode, targetChapIdx);



        addToHistory({
          bookCode: cleanCode,
          bookTitle: newTab.title,
          nikaya: newTab.nikaya,
          chapterIdx: targetChapIdx,
          chapterTitle: newTab.chapters?.[targetChapIdx]?.title || '',
        });
      } catch (err) {
        console.warn(`[openBook] Failed to open book '${cleanCode}':`, err?.message || err);
        // Remove optimistic tab from state & localStorage
        const cleanedTabs = openTabsRef.current.filter((t) => t.bookCode !== cleanCode);
        const nextActive = cleanedTabs.length > 0 ? cleanedTabs[cleanedTabs.length - 1].bookCode : null;
        setOpenTabs(cleanedTabs);
        setActiveBookCode(nextActive);
        persistTabs(cleanedTabs, nextActive);
        // Clean from recent history if ever present
        setRecentHistory((prev) => {
          const filtered = prev.filter((h) => h.bookCode !== cleanCode);
          try {
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(filtered));
          } catch (e) {}
          return filtered;
        });
        setIsNotFound(true);
      } finally {
        setLoadingBook(false);
      }
    },
    [updateUrlParams, loadChapter, bufferAdjacentChapters, persistTabs, addToHistory, updateSetting]
  );

  // Switch tabs smoothly with instant scroll position restoration
  const switchTab = useCallback(
    (bookCode) => {
      setActiveBookCode(bookCode);
      setTargetScrollIntent(null);

      const tab = openTabsRef.current.find((t) => t.bookCode === bookCode);
      if (tab) {
        const isToc = tab.viewMode === 'toc' || tab.isTocView;
        if (isToc) {
          // TOC view: no chapter fetch, just show TOC
          setTreeSelectedNode({ bookCode: tab.bookCode, chapterIdx: null });
          setSearchHighlight(null);
          updateUrlParams({ book: tab.bookCode, chapter: null, q: null, search: null });
          persistTabs(openTabsRef.current, tab.bookCode);
          addToHistory({
            bookCode: tab.bookCode,
            bookTitle: tab.title,
            nikaya: tab.nikaya,
            chapterIdx: 0,
            chapterTitle: '',
          });
          return;
        }
        if (
          !tab.para_to_chapter ||
          Object.keys(tab.para_to_chapter).length === 0 ||
          !tab.page_to_chapter ||
          Object.keys(tab.page_to_chapter).length === 0
        ) {
          fetchBook(bookCode, { chapter: tab.currentChapterIdx ?? 0 })
            .then((bData) => {
              if (bData) {
                setOpenTabs((prev) =>
                  prev.map((t) =>
                    t.bookCode === bookCode
                      ? {
                          ...t,
                          para_to_chapter: bData.para_to_chapter || {},
                          para_to_index: bData.para_to_index || {},
                          page_to_chapter: bData.page_to_chapter || {},
                          page_to_para: bData.page_to_para || {},
                          page_anchors: bData.page_anchors || {},
                          para_range: bData.para_range || t.para_range,
                          edition_ranges: bData.edition_ranges || t.edition_ranges,
                          book_type: bData.book_type || t.book_type || 'Whole',
                          sub_books: bData.sub_books || t.sub_books || null,
                          sub_book: bData.sub_book || t.sub_book || null,
                          chapter_to_sub_book: bData.chapter_to_sub_book || t.chapter_to_sub_book || null,
                          sub_books_para_to_chapter: bData.sub_books_para_to_chapter || t.sub_books_para_to_chapter || null,
                          attha_start_chapter: bData.attha_start_chapter !== undefined ? bData.attha_start_chapter : t.attha_start_chapter,
                          tika_start_chapter: bData.tika_start_chapter !== undefined ? bData.tika_start_chapter : t.tika_start_chapter,
                          toc: bData.toc?.length ? bData.toc : t.toc,
                          mat: bData.mat || t.mat,
                        }
                      : t
                  )

                );
              }
            })
            .catch(() => {});
        }


        if (tab.lastParaNum) {
          setActiveParaNum(tab.lastParaNum);
        } else {
          const firstP = getFirstParaOfChapter(tab.para_to_chapter, tab.currentChapterIdx ?? 0);
          if (firstP) {
            setActiveParaNum(firstP);
          }
        }
        setTreeSelectedNode({
          bookCode: tab.bookCode,
          chapterIdx: tab.currentChapterIdx ?? 0,
        });
        setSearchHighlight(null);
        updateUrlParams({
          book: tab.bookCode,
          chapter: (tab.currentChapterIdx ?? 0) + 1,
          q: null,
          search: null,
        });
        persistTabs(openTabsRef.current, tab.bookCode);

        addToHistory({
          bookCode: tab.bookCode,
          bookTitle: tab.title,
          nikaya: tab.nikaya,
          chapterIdx: tab.currentChapterIdx ?? 0,
          chapterTitle: tab.chapters?.[tab.currentChapterIdx ?? 0]?.title || '',
        });
      }
    },
    [updateUrlParams, persistTabs, addToHistory, setActiveParaNum]
  );


  const closeTab = useCallback(
    (bookCode, e) => {
      if (e) e.stopPropagation();

      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx === -1) return;
      delete tabScriptPrefixRef.current[bookCode];

      const newTabs = currentTabs.filter((t) => t.bookCode !== bookCode);
      setOpenTabs(newTabs);

      if (activeBookCodeRef.current === bookCode) {
        if (newTabs.length > 0) {
          const nextIdx = Math.min(idx, newTabs.length - 1);
          const nextTab = newTabs[nextIdx];
          setActiveBookCode(nextTab.bookCode);
          const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
          if (isToc) {
            setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: null });
            updateUrlParams({ book: nextTab.bookCode, chapter: null, q: null, search: null });
          } else {
            const firstP = getFirstParaOfChapter(nextTab.para_to_chapter, nextTab.currentChapterIdx ?? 0);
            if (firstP) setActiveParaNum(firstP);
            setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: nextTab.currentChapterIdx ?? 0 });
            updateUrlParams({ book: nextTab.bookCode, chapter: (nextTab.currentChapterIdx ?? 0) + 1, q: null, search: null });
          }
          persistTabs(newTabs, nextTab.bookCode);
        } else {
          setActiveBookCode(null);
          setTreeSelectedNode(null);
          updateUrlParams({ book: null, chapter: null, q: null, search: null });
          if (typeof document !== 'undefined') {
            document.body.classList.remove('zen-mode');
          }
        }
      } else {
        persistTabs(newTabs, activeBookCodeRef.current);
      }
    },
    [updateUrlParams, persistTabs, setActiveParaNum, setIsZenMode, setIsSidebarOpen]
  );

  // Close other tabs except bookCode
  const closeOtherTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const targetTab = currentTabs.find((t) => t.bookCode === bookCode);
      if (!targetTab) return;

      const newTabs = [targetTab];
      // Drop script-prefix entries for every tab that is being closed
      for (const t of currentTabs) {
        if (t.bookCode !== bookCode) delete tabScriptPrefixRef.current[t.bookCode];
      }
      setOpenTabs(newTabs);
      setActiveBookCode(bookCode);

      const isToc = targetTab.viewMode === 'toc' || targetTab.isTocView;
      if (isToc) {
        setTreeSelectedNode({ bookCode: targetTab.bookCode, chapterIdx: null });
        updateUrlParams({ book: targetTab.bookCode, chapter: null, q: null, search: null });
      } else {
        const firstP = getFirstParaOfChapter(targetTab.para_to_chapter, targetTab.currentChapterIdx ?? 0);
        if (firstP) setActiveParaNum(firstP);
        setTreeSelectedNode({ bookCode: targetTab.bookCode, chapterIdx: targetTab.currentChapterIdx ?? 0 });
        updateUrlParams({ book: targetTab.bookCode, chapter: (targetTab.currentChapterIdx ?? 0) + 1, q: null, search: null });
      }
      persistTabs(newTabs, bookCode);
    },
    [updateUrlParams, persistTabs, setActiveParaNum]
  );

  // Close all tabs
  const closeAllTabs = useCallback(() => {
    tabScriptPrefixRef.current = {};
    setOpenTabs([]);
    setActiveBookCode(null);
    setTreeSelectedNode(null);
    updateUrlParams({ book: null, chapter: null, q: null, search: null });
    persistTabs([], null);
    setIsZenMode(false);
    setIsSidebarOpen(true);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('zen-mode');
    }
  }, [updateUrlParams, persistTabs, setIsZenMode, setIsSidebarOpen]);

  // Close tabs to the left of bookCode
  const closeLeftTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx <= 0) return;
      for (let i = 0; i < idx; i++) delete tabScriptPrefixRef.current[currentTabs[i].bookCode];

      const newTabs = currentTabs.slice(idx);
      setOpenTabs(newTabs);

      const activeCode = activeBookCodeRef.current;
      const activeStillPresent = newTabs.some((t) => t.bookCode === activeCode);

      if (!activeStillPresent) {
        const nextTab = newTabs[0];
        setActiveBookCode(nextTab.bookCode);
        const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
        if (isToc) {
          setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: null });
          updateUrlParams({ book: nextTab.bookCode, chapter: null, q: null, search: null });
        } else {
          const firstP = getFirstParaOfChapter(nextTab.para_to_chapter, nextTab.currentChapterIdx ?? 0);
          if (firstP) setActiveParaNum(firstP);
          setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: nextTab.currentChapterIdx ?? 0 });
          updateUrlParams({ book: nextTab.bookCode, chapter: (nextTab.currentChapterIdx ?? 0) + 1, q: null, search: null });
        }
        persistTabs(newTabs, nextTab.bookCode);
      } else {
        persistTabs(newTabs, activeCode);
      }
    },
    [updateUrlParams, persistTabs, setActiveParaNum]
  );

  // Close tabs to the right of bookCode
  const closeRightTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx === -1 || idx >= currentTabs.length - 1) return;
      for (let i = idx + 1; i < currentTabs.length; i++) delete tabScriptPrefixRef.current[currentTabs[i].bookCode];

      const newTabs = currentTabs.slice(0, idx + 1);
      setOpenTabs(newTabs);

      const activeCode = activeBookCodeRef.current;
      const activeStillPresent = newTabs.some((t) => t.bookCode === activeCode);

      if (!activeStillPresent) {
        const nextTab = newTabs[newTabs.length - 1];
        setActiveBookCode(nextTab.bookCode);
        const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
        if (isToc) {
          setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: null });
          updateUrlParams({ book: nextTab.bookCode, chapter: null, q: null, search: null });
        } else {
          const firstP = getFirstParaOfChapter(nextTab.para_to_chapter, nextTab.currentChapterIdx ?? 0);
          if (firstP) setActiveParaNum(firstP);
          setTreeSelectedNode({ bookCode: nextTab.bookCode, chapterIdx: nextTab.currentChapterIdx ?? 0 });
          updateUrlParams({ book: nextTab.bookCode, chapter: (nextTab.currentChapterIdx ?? 0) + 1, q: null, search: null });
        }
        persistTabs(newTabs, nextTab.bookCode);
      } else {
        persistTabs(newTabs, activeCode);
      }
    },
    [updateUrlParams, persistTabs, setActiveParaNum]
  );

  const reorderTabs = useCallback(
    (fromIndex, toIndex) => {
      if (fromIndex === toIndex || fromIndex === null || toIndex === null) return;
      const currentTabs = openTabsRef.current;
      if (fromIndex < 0 || fromIndex >= currentTabs.length || toIndex < 0 || toIndex >= currentTabs.length) {
        return;
      }
      const next = [...currentTabs];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setOpenTabs(next);
      persistTabs(next, activeBookCodeRef.current);
    },
    [persistTabs]
  );

  const setChapterForActiveTab = useCallback(
    (chapterIdx) => {
      const activeCode = activeBookCodeRef.current;
      if (!activeCode) return;

      const currentTabs = openTabsRef.current;
      const next = currentTabs.map((t) =>
        t.bookCode === activeCode ? { ...t, currentChapterIdx: chapterIdx } : t
      );
      setOpenTabs(next);
      persistTabs(next, activeCode);

      const currentTab = openTabsRef.current.find((t) => t.bookCode === activeCode);
      if (currentTab) {
        const firstP = getFirstParaOfChapter(currentTab.para_to_chapter, chapterIdx);
        if (firstP) {
          setActiveParaNum(firstP);
        }
        addToHistory({
          bookCode: activeCode,
          bookTitle: currentTab.title,
          nikaya: currentTab.nikaya,
          chapterIdx: chapterIdx,
          chapterTitle: currentTab.chapters?.[chapterIdx]?.title || '',
        });
      }

      setTreeSelectedNode({ bookCode: activeCode, chapterIdx });
      setTargetScrollIntent({
        chapterIdx,
        timestamp: Date.now(),
      });

      loadChapter(activeCode, chapterIdx);
      bufferAdjacentChapters(activeCode, chapterIdx);
      setSearchHighlight(null);
      updateUrlParams({ book: activeCode, chapter: chapterIdx + 1, q: null, search: null });
    },
    [updateUrlParams, persistTabs, loadChapter, bufferAdjacentChapters, addToHistory, setActiveParaNum]
  );

  const saveTabScroll = useCallback((bookCode, scrollTop) => {

    if (bookCode) {
      tabScrollMemoryRef.current[bookCode] = scrollTop;
      try {
        localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
      } catch (e) {}
    }
  }, []);

  const getSavedScroll = useCallback((bookCode) => {
    return tabScrollMemoryRef.current[bookCode] || 0;
  }, []);

  const clearTargetScrollIntent = useCallback(() => {
    setTargetScrollIntent(null);
  }, []);

  const openSearchModal = useCallback((query = null) => {
    if (query !== null && query !== undefined && query !== '') {
      setSearchInitialQuery(query);
    } else {
      setSearchInitialQuery(null);
    }
    setIsSearchOpen(true);
  }, []);

  const closeSearchModal = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    const next = !isSidebarOpenRef.current;
    isSidebarOpenRef.current = next;
    setIsSidebarOpen(next);
    setIsHeaderVisible(next);
    setIsZenMode(!next);
    if (typeof document !== 'undefined') {
      if (!next) {
        document.body.classList.add('zen-mode');
      } else {
        document.body.classList.remove('zen-mode');
      }
    }
  }, [setIsZenMode]);

  const activeTab = openTabs.find((t) => t.bookCode === activeBookCode) || null;

  // Auto-fetch MAT if missing on activeTab
  useEffect(() => {
    if (activeTab && !activeTab.mat) {
      fetchMat(activeTab.bookCode).then((mat) => {
        if (mat) {
          setOpenTabs((prev) =>
            prev.map((t) => (t.bookCode === activeTab.bookCode ? { ...t, mat } : t))
          );
        }
      });
    }
  }, [activeTab]);

  // Jump MAT (Mūla · Aṭṭhakathā · Ṭīkā) handler
  const jumpToMat = useCallback(
    async (targetLayer, options = {}) => {
      if (!activeTab) return;
      let mat = activeTab.mat;
      if (!mat) {
        try {
          mat = await fetchMat(activeTab.bookCode);
        } catch (e) {}
      }

      let targetCode = options.code || null;
      let targetTitle = options.title || null;
      let targetChapter = options.chapter !== undefined ? options.chapter : undefined;
      let targetSubBook = options.subBook || null;

      const currentChapIdx = activeTab.currentChapterIdx || 0;

      // 1. Multi-volume reverse jump: activeTab has sub_books (e.g. s0402a.att, s0402t.tik, etc.)
      if (activeTab.sub_books) {
        let subKey = activeTab.chapter_to_sub_book?.[currentChapIdx];
        if (!subKey) {
          for (const [k, v] of Object.entries(activeTab.sub_books)) {
            const cr = v.chapter_range || v.tika_chapter_range;
            if (cr && currentChapIdx >= cr[0] && currentChapIdx <= cr[1]) {
              subKey = k;
              break;
            }
          }
        }
        if (subKey && activeTab.sub_books[subKey]) {
          const subInfo = activeTab.sub_books[subKey];
          targetSubBook = subKey;
          if (targetLayer === 'mula') {
            targetCode = subInfo.mula_code || targetCode;
            targetTitle = subInfo.mula_title || targetTitle;
            const startC = subInfo.chapter_range ? subInfo.chapter_range[0] : 0;
            targetChapter = Math.max(0, currentChapIdx - startC);
          } else if (targetLayer === 'tika') {
            targetCode = mat?.tika_code || subInfo.tika_code || targetCode;
            targetTitle = mat?.tika_title || subInfo.tika_title || targetTitle;
            if (subInfo.tika_chapter_range) {
              const startC = subInfo.chapter_range ? subInfo.chapter_range[0] : 0;
              targetChapter = subInfo.tika_chapter_range[0] + (currentChapIdx - startC);
            } else if (subInfo.tika_chapter !== undefined) {
              targetChapter = subInfo.tika_chapter;
            }
          } else if (targetLayer === 'attha') {
            targetCode = mat?.attha_code || subInfo.attha_code || targetCode;
            targetTitle = mat?.attha_title || subInfo.attha_title || targetTitle;
            if (subInfo.chapter_range && subInfo.tika_chapter_range) {
              const startT = subInfo.tika_chapter_range[0];
              targetChapter = subInfo.chapter_range[0] + (currentChapIdx - startT);
            }
          }
        }
      } else if (activeTab.sub_book || options.subBook) {
        // 2. Single-volume forward jump: activeTab belongs to a multi-volume commentary (e.g. s0402m2.mul)
        targetSubBook = options.subBook || activeTab.sub_book;
        if (options.chapter !== undefined) {
          targetChapter = options.chapter;
        } else if (targetLayer === 'attha') {
          const offset = activeTab.attha_start_chapter !== undefined && activeTab.attha_start_chapter !== null
            ? activeTab.attha_start_chapter
            : (mat?.attha_start_chapter || 0);
          targetChapter = offset + currentChapIdx;
        } else if (targetLayer === 'tika') {
          const offset = activeTab.tika_start_chapter !== undefined && activeTab.tika_start_chapter !== null
            ? activeTab.tika_start_chapter
            : (mat?.tika_start_chapter || 0);
          targetChapter = offset + currentChapIdx;
        }
      }

      if (!targetCode && mat) {
        if (targetLayer === 'mula') {
          targetCode = mat.mula_code;
          targetTitle = mat.mula_title;
        } else if (targetLayer === 'attha') {
          targetCode = mat.attha_code;
          targetTitle = mat.attha_title;
        } else if (targetLayer === 'tika') {
          targetCode = mat.tika_code;
          targetTitle = mat.tika_title;
        }
      }

      if (!targetCode) {
        const base = activeTab.bookCode.split('.')[0];
        const prefix = (base.length > 2 && 'matn'.includes(base.slice(-2, -1)))
          ? base.slice(0, -2)
          : (base.length > 1 && 'matn'.includes(base.slice(-1)))
          ? base.slice(0, -1)
          : base;
        if (targetLayer === 'mula') targetCode = `${prefix}m.mul`;
        else if (targetLayer === 'attha') targetCode = `${prefix}a.att`;
        else if (targetLayer === 'tika') targetCode = `${prefix}t.tik`;
      }

      if (!targetCode || targetCode === activeTab.bookCode) return;

      // Extract current active paragraph number from state or DOM
      let currentPara = activeParaNum;
      if (!currentPara && typeof document !== 'undefined') {
        const container = document.querySelector('.reader-container') || document.querySelector('main');
        if (container) {
          const visibleParaEl = container.querySelector('[data-para]');
          if (visibleParaEl) {
            currentPara = visibleParaEl.getAttribute('data-para');
          }
        }
      }

      openBook(targetCode, {
        title: targetTitle || undefined,
        targetParaNum: currentPara || undefined,
        targetChapterIdx: targetChapter !== undefined ? targetChapter : undefined,
        targetSubBook: targetSubBook || undefined,
      });
    },
    [activeTab, activeParaNum, openBook]
  );

  const openGoToModal = useCallback((tab = 'para', edition = null) => {
    setGoToInitialTab(tab);
    setGoToInitialEdition(edition);
    setIsGoToOpen(true);
  }, []);

  const closeGoToModal = useCallback(() => {
    setIsGoToOpen(false);
  }, []);

  return (
    <TabContext.Provider
      value={{
        openTabs,
        activeBookCode,
        activeTab,
        activeParaNum,
        setActiveParaNum,
        jumpToMat,
        loadingBook,
        isSidebarOpen,
        isSearchOpen,
        isDictOpen,
        setIsDictOpen,
        isGoToOpen,
        setIsGoToOpen,
        goToInitialTab,
        setGoToInitialTab,
        goToInitialEdition,
        setGoToInitialEdition,
        openGoToModal,
        closeGoToModal,
        isBookmarkOpen,
        isHistoryOpen,
        setIsBookmarkOpen,
        setIsHistoryOpen,
        searchInitialQuery,
        searchHighlight,
        setSearchHighlight,
        searchHighlightQuery: searchHighlight?.query || '',
        setSearchHighlightQuery: (q) => setSearchHighlight(q ? { query: q } : null),
        targetScrollIntent,
        treeSelectedNode,
        activeEditionPages,
        setActiveEditionPages,
        tabScrollMemoryRef,
        bookmarks,
        recentHistory,
        addBookmark,
        removeBookmark,
        isBookmarked,
        addToHistory,
        clearHistory,
        openBook,
        loadChapter,
        bufferAdjacentChapters,
        switchTab,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        closeLeftTabs,
        closeRightTabs,
        reorderTabs,
        setChapterForActiveTab,
        saveTabPosition,
        saveTabScroll,
        getSavedScroll,
        clearTargetScrollIntent,
        openSearchModal,
        closeSearchModal,
        toggleSidebar,
        isSidebarOpen,
        setIsSidebarOpen,
        isHeaderVisible,
        setIsHeaderVisible,
        isNotFound,
        setIsNotFound,
        updateUrlParams,
      }}
    >

      {children}
    </TabContext.Provider>
  );
}

export function useTabs() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
}
