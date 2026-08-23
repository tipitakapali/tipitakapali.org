'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { fetchBook, fetchChapter, fetchMat } from '../services/api';
import { useThemeSettings } from './ThemeSettingsContext';

const TabContext = createContext();

const STORAGE_KEYS = {
  TABS: 'tipitaka_saved_tabs_v2',
  ACTIVE: 'tipitaka_active_book_v2',
  SCROLL: 'tipitaka_tab_scrolls_v2',
  BOOKMARKS: 'tipitaka_bookmarks_v2',
  HISTORY: 'tipitaka_recent_history_v2',
};

function resolveNearestChapterAndPara(paraToChapMap, rawParaNum) {

  if (!paraToChapMap || !rawParaNum) return null;
  const cleanPara = String(rawParaNum).replace(/^(?:para-?|p)/i, '').trim();
  if (paraToChapMap[cleanPara] !== undefined) {
    return { chapterIdx: paraToChapMap[cleanPara], paraNum: cleanPara };
  }
  const targetInt = parseInt(cleanPara, 10);
  if (isNaN(targetInt)) return null;

  let bestNum = null;
  let bestChap = null;
  for (const [pStr, cIdx] of Object.entries(paraToChapMap)) {
    const pInt = parseInt(pStr, 10);
    if (!isNaN(pInt) && pInt <= targetInt) {
      if (bestNum === null || pInt > bestNum) {
        bestNum = pInt;
        bestChap = cIdx;
      }
    }
  }
  if (bestChap !== null) {
    return { chapterIdx: bestChap, paraNum: bestNum !== null ? String(bestNum) : cleanPara };
  }
  return null;
}

function getFirstParaOfChapter(paraToChapMap, targetChapIdx) {

  if (!paraToChapMap || targetChapIdx === undefined || targetChapIdx === null) return null;
  let firstNum = null;
  let minNum = Infinity;
  for (const [pStr, cIdx] of Object.entries(paraToChapMap)) {
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

export function TabProvider({ children }) {


  const { setIsZenMode } = useThemeSettings();

  const [openTabs, setOpenTabs] = useState([]);
  const [activeBookCode, setActiveBookCode] = useState(null);
  const [activeParaNum, setActiveParaNum] = useState(null);
  const [loadingBook, setLoadingBook] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isBookmarkOpen, setIsBookmarkOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [targetScrollIntent, setTargetScrollIntent] = useState(null);
  const [treeSelectedNode, setTreeSelectedNode] = useState(null);

  const [bookmarks, setBookmarks] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);

  const openTabsRef = useRef([]);
  const activeBookCodeRef = useRef(null);

  const tabScrollMemoryRef = useRef({});
  const isInitializedRef = useRef(false);

  openTabsRef.current = openTabs;
  activeBookCodeRef.current = activeBookCode;

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
      id: `${item.bookCode}_${item.chapterIdx || 0}_${item.paraIndex || Date.now()}`,
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
      const filtered = prev.filter((b) => b.id !== newEntry.id);
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

  const isBookmarked = useCallback((bookCode, paraIndex) => {
    if (!bookCode) return false;
    return bookmarks.some((b) => b.bookCode === bookCode && b.paraIndex === paraIndex);
  }, [bookmarks]);

  // Save Recent History to localStorage
  const addToHistory = useCallback((item) => {
    if (!item?.bookCode) return;
    setRecentHistory((prev) => {
      const filtered = prev.filter(
        (h) => !(h.bookCode === item.bookCode && h.chapterIdx === (item.chapterIdx || 0))
      );
      const newEntry = {
        id: `${item.bookCode}_${item.chapterIdx || 0}`,
        bookCode: item.bookCode,
        bookTitle: item.bookTitle,
        nikaya: item.nikaya || '',
        chapterIdx: item.chapterIdx || 0,
        chapterTitle: item.chapterTitle || '',
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

  // Helper to update URL search parameters without reloading (1-based chapter in URL)
  // Helper to update URL search parameters and clean path without reloading (1-based chapter in URL)
  const updateUrlParams = useCallback((paramsToUpdate) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location);

    if (paramsToUpdate) {
      // If book is provided, set clean path /book/:bookCode
      if (paramsToUpdate.book) {
        url.pathname = `/book/${paramsToUpdate.book}`;
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
      } else if (paramsToUpdate.book === null) {
        url.pathname = '/';
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
      }

      Object.entries(paramsToUpdate).forEach(([k, v]) => {
        if (k === 'book') return;
        if (v === null || v === undefined) {
          url.searchParams.delete(k);
        } else {
          url.searchParams.set(k, v);
        }
      });
    }

    const newUrl = url.pathname + (url.search || '');
    window.history.replaceState({}, '', newUrl);
  }, []);

  // Save tabs list to localStorage for session resumption
  const persistTabs = useCallback((tabs, activeCode) => {
    if (typeof window === 'undefined') return;
    try {
      const minifiedTabs = tabs.map((t) => ({
        bookCode: t.bookCode,
        currentChapterIdx: t.currentChapterIdx || 0,
      }));
      localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(minifiedTabs));
      if (activeCode) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE, activeCode);
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE);
      }
    } catch (e) {}
  }, []);

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
      let cleanCode = bookCode.replace('.xml', '');
      let hasTargetChapter = options.targetChapterIdx !== undefined && options.targetChapterIdx !== null;
      let targetChapIdx = hasTargetChapter ? options.targetChapterIdx : 0;

      // Handle chapter suffix in code (e.g. s0201m.mul1 -> s0201m.mul, chapter_index 1)
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        if (!hasTargetChapter) {
          targetChapIdx = parseInt(chapSuffixMatch[2], 10);
          hasTargetChapter = true;
        }
      }

      const rawParaNum = options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '') : null;


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
        setActiveBookCode(cleanCode);
        const tab = currentTabs[existingTabIndex];


        if (rawParaNum && tab.para_to_chapter) {
          const resolved = resolveNearestChapterAndPara(tab.para_to_chapter, rawParaNum);
          if (resolved) {
            targetChapIdx = resolved.chapterIdx;
            hasTargetChapter = true;
            setActiveParaNum(resolved.paraNum || rawParaNum);
          }
        } else if (hasTargetChapter) {
          const firstP = getFirstParaOfChapter(tab.para_to_chapter, targetChapIdx);
          if (firstP) {
            setActiveParaNum(firstP);
          }
        }

        if (hasTargetChapter) {
          setOpenTabs((prev) => {
            const next = prev.map((t) =>
              t.bookCode === cleanCode ? { ...t, currentChapterIdx: targetChapIdx } : t
            );
            persistTabs(next, cleanCode);
            return next;
          });

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

        setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: activeChap });
        updateUrlParams({ book: cleanCode, chapter: activeChap + 1 });
        persistTabs(currentTabs, cleanCode);

        addToHistory({
          bookCode: cleanCode,
          bookTitle: tab.title,
          nikaya: tab.nikaya,
          chapterIdx: activeChap,
          chapterTitle: tab.chapters?.[activeChap]?.title || '',
        });
        return;
      }

      setLoadingBook(true);
      try {
        // First resolve chapter if targetParaNum is provided and we can pre-check or load metadata
        const bookData = await fetchBook(cleanCode, {
          chapter: targetChapIdx,
          buffer: 1,
        });

        if (rawParaNum && bookData.para_to_chapter) {
          const resolved = resolveNearestChapterAndPara(bookData.para_to_chapter, rawParaNum);
          if (resolved) {
            targetChapIdx = resolved.chapterIdx;
            hasTargetChapter = true;
            setActiveParaNum(resolved.paraNum || rawParaNum);
            if (!bookData.chapters_data?.[targetChapIdx]) {
              const chapData = await fetchBook(cleanCode, { chapter: targetChapIdx, buffer: 1 });
              Object.assign(bookData.chapters_data, chapData.chapters_data);
            }
          }
        } else if (hasTargetChapter) {
          const firstP = getFirstParaOfChapter(bookData.para_to_chapter, targetChapIdx);
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

          loadedChapters: { ...bookData.chapters_data },
          loadingChapters: {},
          currentChapterIdx: targetChapIdx,
        };


        setOpenTabs((prev) => {
          if (prev.some((t) => t.bookCode === cleanCode)) return prev;
          const next = [...prev, newTab];
          persistTabs(next, cleanCode);
          return next;
        });
        setActiveBookCode(cleanCode);

        if (hasTargetChapter || options.targetParaIndex !== undefined || rawParaNum || options.targetPage) {
          setTargetScrollIntent({
            chapterIdx: hasTargetChapter ? targetChapIdx : undefined,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum,
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

        updateUrlParams({ book: cleanCode, chapter: targetChapIdx + 1 });
        bufferAdjacentChapters(cleanCode, targetChapIdx);



        addToHistory({
          bookCode: cleanCode,
          bookTitle: newTab.title,
          nikaya: newTab.nikaya,
          chapterIdx: targetChapIdx,
          chapterTitle: newTab.chapters?.[targetChapIdx]?.title || '',
        });
      } catch (err) {
        alert(`Error opening book: ${err.message}`);
      } finally {
        setLoadingBook(false);
      }
    },
    [updateUrlParams, loadChapter, bufferAdjacentChapters, persistTabs, addToHistory]
  );

  // Switch tabs smoothly with instant scroll position restoration
  const switchTab = useCallback(
    (bookCode) => {
      setActiveBookCode(bookCode);
      setTargetScrollIntent(null);

      const tab = openTabsRef.current.find((t) => t.bookCode === bookCode);
      if (tab) {
        const firstP = getFirstParaOfChapter(tab.para_to_chapter, tab.currentChapterIdx || 0);
        if (firstP) {
          setActiveParaNum(firstP);
        }
        setTreeSelectedNode({
          bookCode: tab.bookCode,
          chapterIdx: tab.currentChapterIdx || 0,
        });
        updateUrlParams({
          book: tab.bookCode,
          chapter: (tab.currentChapterIdx || 0) + 1,
        });
        persistTabs(openTabsRef.current, tab.bookCode);

        addToHistory({
          bookCode: tab.bookCode,
          bookTitle: tab.title,
          nikaya: tab.nikaya,
          chapterIdx: tab.currentChapterIdx || 0,
          chapterTitle: tab.chapters?.[tab.currentChapterIdx || 0]?.title || '',
        });
      }
    },
    [updateUrlParams, persistTabs, addToHistory, setActiveParaNum]
  );

  const closeTab = useCallback(
    (bookCode, e) => {
      if (e) e.stopPropagation();

      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.bookCode === bookCode);
        if (idx === -1) return prev;

        const newTabs = prev.filter((t) => t.bookCode !== bookCode);

        if (activeBookCodeRef.current === bookCode) {
          if (newTabs.length > 0) {
            const nextIdx = Math.min(idx, newTabs.length - 1);
            const nextTab = newTabs[nextIdx];
            setActiveBookCode(nextTab.bookCode);
            const firstP = getFirstParaOfChapter(nextTab.para_to_chapter, nextTab.currentChapterIdx || 0);
            if (firstP) {
              setActiveParaNum(firstP);
            }
            setTreeSelectedNode({
              bookCode: nextTab.bookCode,
              chapterIdx: nextTab.currentChapterIdx || 0,
            });
            updateUrlParams({
              book: nextTab.bookCode,
              chapter: (nextTab.currentChapterIdx || 0) + 1,
            });
            persistTabs(newTabs, nextTab.bookCode);
          } else {
            setActiveBookCode(null);
            setTreeSelectedNode(null);
            updateUrlParams({ book: null, chapter: null });
            persistTabs([], null);
            setIsZenMode(false);
            setIsSidebarOpen(true);
            if (typeof document !== 'undefined') {
              document.body.classList.remove('zen-mode');
            }
          }

        } else {
          persistTabs(newTabs, activeBookCodeRef.current);
        }

        return newTabs;
      });
    },
    [updateUrlParams, persistTabs, setActiveParaNum]
  );

  const reorderTabs = useCallback(
    (fromIndex, toIndex) => {
      if (fromIndex === toIndex || fromIndex === null || toIndex === null) return;
      setOpenTabs((prev) => {
        if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        persistTabs(next, activeBookCodeRef.current);
        return next;
      });
    },
    [persistTabs]
  );

  const setChapterForActiveTab = useCallback(

    (chapterIdx) => {
      const activeCode = activeBookCodeRef.current;
      if (!activeCode) return;

      setOpenTabs((prev) => {
        const next = prev.map((t) =>
          t.bookCode === activeCode ? { ...t, currentChapterIdx: chapterIdx } : t
        );
        persistTabs(next, activeCode);
        return next;
      });

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
      updateUrlParams({ book: activeCode, chapter: chapterIdx + 1 });
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

  const openSearchModal = useCallback((query = '') => {
    setSearchInitialQuery(query);
    setIsSearchOpen(true);
  }, []);

  const closeSearchModal = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  // Automatic Session Resumption on page load / revisit
  useEffect(() => {
    if (typeof window === 'undefined' || isInitializedRef.current) return;
    isInitializedRef.current = true;

    const url = new URL(window.location);
    const pathname = url.pathname;
    let urlBook = url.searchParams.get('book') || url.searchParams.get('book_code');
    let urlChapter = url.searchParams.get('chapter') || url.searchParams.get('c');

    if (!urlBook && (pathname.startsWith('/book/') || pathname.startsWith('/chapter/'))) {
      const raw = pathname.replace(/^\/(?:book|chapter)\//, '');
      const parts = raw.split('/');
      if (parts[0]) urlBook = decodeURIComponent(parts[0]);
      if (parts[1] && !urlChapter) urlChapter = decodeURIComponent(parts[1]);
    }

    if (urlBook) {
      const chapSuffixMatch = urlBook.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        urlBook = chapSuffixMatch[1];
        if (!urlChapter) {
          urlChapter = parseInt(chapSuffixMatch[2], 10) + 1;
        }
      }
    }

    if (urlBook) {
      const targetChapIdx = urlChapter ? Math.max(0, parseInt(urlChapter, 10) - 1) : 0;
      openBook(urlBook, { targetChapterIdx });
      return;
    }

    // Resume from localStorage
    try {
      const savedTabsRaw = localStorage.getItem(STORAGE_KEYS.TABS);
      const savedActive = localStorage.getItem(STORAGE_KEYS.ACTIVE);

      if (savedTabsRaw) {
        const parsedTabs = JSON.parse(savedTabsRaw);
        if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
          const activeToOpen = savedActive || parsedTabs[0].bookCode;
          const activeItem = parsedTabs.find((p) => p.bookCode === activeToOpen) || parsedTabs[0];

          // Open active book first
          openBook(activeItem.bookCode, { targetChapterIdx: activeItem.currentChapterIdx || 0 });

          // Load rest in background
          parsedTabs.forEach((item) => {
            if (item.bookCode !== activeItem.bookCode) {
              fetchBook(item.bookCode, { chapter: item.currentChapterIdx || 0, buffer: 0 })
                .then((bData) => {
                  setOpenTabs((prev) => {
                    if (prev.some((t) => t.bookCode === bData.code)) return prev;
                    return [
                      ...prev,
                      {
                        bookCode: bData.code,
                        title: bData.title,
                        nikaya: bData.nikaya || bData.category || '',
                        category: bData.category || '',
                        chapter_count: bData.chapter_count,
                        chapters: bData.chapters || [],
                        toc: bData.toc || [],
                        mat: bData.mat || null,
                        para_to_chapter: bData.para_to_chapter || {},
                        para_to_index: bData.para_to_index || {},
                        page_to_chapter: bData.page_to_chapter || {},
                        page_to_para: bData.page_to_para || {},
                        loadedChapters: { ...bData.chapters_data },
                        loadingChapters: {},
                        currentChapterIdx: item.currentChapterIdx || 0,
                      },
                    ];
                  });
                })
                .catch(() => {});
            }
          });
        }
      }
    } catch (e) {
      console.warn('Failed to restore session tabs:', e);
    }
  }, [openBook]);


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
    async (targetLayer) => {
      if (!activeTab) return;
      let mat = activeTab.mat;
      if (!mat) {
        try {
          mat = await fetchMat(activeTab.bookCode);
        } catch (e) {}
      }

      let targetCode = null;
      if (mat) {
        if (targetLayer === 'mula') targetCode = mat.mula_code;
        else if (targetLayer === 'attha') targetCode = mat.attha_code;
        else if (targetLayer === 'tika') targetCode = mat.tika_code;
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
        targetParaNum: currentPara || undefined,
      });
    },
    [activeTab, activeParaNum, openBook]
  );


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
        isBookmarkOpen,
        isHistoryOpen,
        setIsBookmarkOpen,
        setIsHistoryOpen,
        searchInitialQuery,
        targetScrollIntent,
        treeSelectedNode,
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
        reorderTabs,
        setChapterForActiveTab,

        saveTabScroll,
        getSavedScroll,
        clearTargetScrollIntent,
        openSearchModal,
        closeSearchModal,
        toggleSidebar,
        setIsSidebarOpen,
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
