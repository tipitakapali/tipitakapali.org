'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  fetchBook,
  fetchChapter,
  fetchChapterBundle,
  isLocalDynamicHost,
  fetchMat,
  fetchMatJump,
  lookupBookInfo,
  fetchBookTocOnly,
} from '../services/api';
import { splitScriptCode } from '../services/transliterate';
import { useThemeSettings } from './ThemeSettingsContext';

const TabContext = createContext();

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const STORAGE_KEYS = {
  TABS: 'tipitaka_saved_tabs_v3',
  ACTIVE: 'tipitaka_active_book_v3',
  SCROLL: 'tipitaka_tab_scrolls_v3',
  BOOKMARKS: 'tipitaka_bookmarks_v3',
  HISTORY: 'tipitaka_recent_history_v3',
};

const TREE_PINNED_STORAGE_KEY = 'tipitaka_tree_pinned_v1';

export function readStoredTreePinned() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(TREE_PINNED_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

const MAX_TABS = 12;

export function parseSavedTabsSnapshot(rawTabs, savedActiveCode = null) {
  let parsed = rawTabs;
  if (typeof rawTabs === 'string') {
    try {
      parsed = JSON.parse(rawTabs);
    } catch (_) {
      return { tabs: [], activeBookCode: null, scriptPrefixes: {} };
    }
  }
  if (!Array.isArray(parsed)) {
    return { tabs: [], activeBookCode: null, scriptPrefixes: {} };
  }

  const tabs = [];
  const seen = new Set();
  const scriptPrefixes = {};

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || typeof entry.bookCode !== 'string') continue;
    const rawCode = entry.bookCode.trim().replace(/\.xml$/i, '');
    if (!rawCode) continue;

    const split = splitScriptCode(rawCode);
    const cleanCode = split.bookCode || rawCode;
    if (seen.has(cleanCode)) continue;
    seen.add(cleanCode);

    const scriptPrefix =
      (typeof entry.scriptPrefix === 'string' && entry.scriptPrefix.trim()) ||
      split.prefix ||
      null;
    if (scriptPrefix) {
      scriptPrefixes[cleanCode] = scriptPrefix;
    }

    if (cleanCode === 'ai_chat' || entry.type === 'ai_chat') {
      tabs.push({
        bookCode: 'ai_chat',
        type: 'ai_chat',
        title: (typeof entry.title === 'string' && entry.title.trim()) || 'Ani Assistant',
        viewMode: 'ai_chat',
        isTocView: false,
      });
    } else {
      const isToc = Boolean(entry.isTocView || entry.viewMode === 'toc');
      const chapIdx =
        typeof entry.currentChapterIdx === 'number' &&
        Number.isFinite(entry.currentChapterIdx) &&
        entry.currentChapterIdx >= 0
          ? Math.floor(entry.currentChapterIdx)
          : isToc
          ? null
          : 0;
      const paraNum =
        entry.lastParaNum !== undefined && entry.lastParaNum !== null && String(entry.lastParaNum).trim()
          ? String(entry.lastParaNum).trim()
          : undefined;
      const parsedParaIndex =
        entry.lastParaIndex !== undefined && entry.lastParaIndex !== null && entry.lastParaIndex !== ''
          ? Number(entry.lastParaIndex)
          : NaN;
      const lastParaIndex = Number.isFinite(parsedParaIndex) && parsedParaIndex >= 0 ? Math.floor(parsedParaIndex) : undefined;

      tabs.push({
        bookCode: cleanCode,
        type: 'book',
        title: (typeof entry.title === 'string' && entry.title.trim()) || cleanCode,
        nikaya: typeof entry.nikaya === 'string' ? entry.nikaya : '',
        category: typeof entry.category === 'string' ? entry.category : '',
        chapter_count: 1,
        chapters: [],
        toc: [],
        loadedChapters: {},
        loadingChapters: {},
        isLoading: false,
        needsHydration: true,
        fromSavedSession: true,
        currentChapterIdx: chapIdx,
        lastParaNum: paraNum,
        lastParaIndex,
        viewMode: isToc ? 'toc' : 'reader',
        isTocView: isToc,
        ...(scriptPrefix ? { scriptPrefix } : {}),
      });
    }

    if (tabs.length >= MAX_TABS) break;
  }

  let resolvedActive = null;
  if (typeof savedActiveCode === 'string' && savedActiveCode.trim()) {
    const cleanActive = splitScriptCode(savedActiveCode.trim().replace(/\.xml$/i, '')).bookCode;
    if (tabs.some((t) => t.bookCode === cleanActive)) {
      resolvedActive = cleanActive;
    }
  }
  if (!resolvedActive && tabs.length > 0) {
    resolvedActive = tabs[0].bookCode;
  }

  return { tabs, activeBookCode: resolvedActive, scriptPrefixes };
}

export function hasDeepLinkInLocation(loc = null) {
  const targetLoc = loc || (typeof window !== 'undefined' ? window.location : null);
  if (!targetLoc) return false;
  const pathname = targetLoc.pathname || '';
  if (pathname.startsWith('/book/') || pathname.startsWith('/chapter/') || pathname.startsWith('/translation/')) {
    return true;
  }
  const params = new URLSearchParams(targetLoc.search || '');
  const tabParam = params.get('tab');
  return Boolean(
    params.get('book') ||
    params.get('book_code') ||
    params.get('q') ||
    params.get('search') ||
    tabParam === 'ai' ||
    tabParam === 'ai_chat'
  );
}

export function getActiveContentArea(bookCode = null) {
  if (typeof document === 'undefined') return null;
  if (bookCode) {
    try {
      const byBook = document.querySelector(`main.content-area[data-book-code="${CSS.escape(bookCode)}"]`);
      if (byBook) return byBook;
    } catch (_) {}
  }
  return (
    document.querySelector('main.content-area[data-active-pane="true"]') ||
    document.querySelector('main.content-area') ||
    document.querySelector('.content-area') ||
    document.querySelector('main')
  );
}

export function insertOrUpdateTabInList(
  tabsList,
  tabObj,
  {
    isSingleMode = false,
    tabView = null,
    isAlongside = false,
    alongside = false,
    sourceBookCode = null,
    activeCode = null,
    activeBookCode = null,
  } = {}
) {
  const cleanCode = tabObj.bookCode;
  const effAlongside = Boolean(isAlongside || alongside);
  const effSingle = Boolean((isSingleMode || tabView === 'single') && !effAlongside);
  const effActive = activeCode || activeBookCode || null;

  if (effSingle && cleanCode !== 'ai_chat') {
    const aiTabs = tabsList.filter((t) => t.bookCode === 'ai_chat' || t.type === 'ai_chat');
    const existing = tabsList.find((t) => t.bookCode === cleanCode);
    return [...aiTabs, existing ? { ...existing, ...tabObj } : tabObj];
  }

  const existingIdx = tabsList.findIndex((t) => t.bookCode === cleanCode);
  let next;
  if (existingIdx !== -1) {
    next = [...tabsList];
    next[existingIdx] = { ...next[existingIdx], ...tabObj };
    if (effAlongside && sourceBookCode && sourceBookCode !== cleanCode) {
      const srcIdx = next.findIndex((t) => t.bookCode === sourceBookCode);
      if (srcIdx !== -1 && existingIdx !== srcIdx + 1) {
        const [moved] = next.splice(existingIdx, 1);
        const newSrcIdx = next.findIndex((t) => t.bookCode === sourceBookCode);
        next.splice(newSrcIdx + 1, 0, moved);
      }
    }
    return next;
  }

  next = [...tabsList];
  const anchorCode = sourceBookCode || effActive;
  const anchorIdx = anchorCode ? next.findIndex((t) => t.bookCode === anchorCode) : -1;
  if (effAlongside && anchorIdx !== -1) {
    next.splice(anchorIdx + 1, 0, tabObj);
  } else {
    next.push(tabObj);
  }

  if (next.length > MAX_TABS) {
    const evictIdx = next.findIndex(
      (t) => t.bookCode !== cleanCode && t.bookCode !== sourceBookCode && t.bookCode !== effActive
    );
    if (evictIdx !== -1) {
      next.splice(evictIdx, 1);
    }
  }
  return next;
}

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

export const LANG_KEY_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  viet: 'vi',
  myanmar: 'my',
  burmese: 'my',
  sinhala: 'si',
  sinhalese: 'si',
  chinese: 'zh',
  khmer: 'km',
  cambodian: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  indonesian: 'id',
  nepali: 'ne',
  bengali: 'be',
  bn: 'be',
  spanish: 'es',
  french: 'fr',
  portuguese: 'pt',
  russian: 'ru',
  czech: 'cs',
  cs: 'cs',
  marathi: 'mr',
  mr: 'mr',
  my_nissaya: 'my_nissaya',
  nissaya: 'my_nissaya',
  burmese_nissaya: 'my_nissaya',
};

export const CODE_TO_LANG_KEY = {
  en: 'english',
  vi: 'vietnamese',
  my: 'myanmar',
  my_nissaya: 'my_nissaya',
  si: 'sinhala',
  th: 'thai',
  zh: 'chinese',
  km: 'khmer',
  lo: 'lao',
  ta: 'tamil',
  hi: 'hindi',
  de: 'german',
  ja: 'japanese',
  pt: 'portuguese',
  ru: 'russian',
  ko: 'korean',
  id: 'indonesian',
  ne: 'nepali',
  be: 'bengali',
  es: 'spanish',
  fr: 'french',
  cs: 'czech',
  mr: 'marathi',
};

export function normalizeLangCode(langOrDb) {
  if (!langOrDb) return null;
  const str = String(langOrDb).trim().toLowerCase();
  if (
    str === 'pali' ||
    str === 'tipitaka' ||
    str === 'fts_tipitaka' ||
    str === 'fts_pali' ||
    str === 'cst' ||
    str === 'cst4' ||
    str === 'fts_tipitaka.db' ||
    str === 'tipitaka.db' ||
    str === 'fts_pali.db'
  ) {
    return 'pali';
  }
  const clean = str.replace(/^(?:fts_)?(?:translation_)?/i, '').replace(/\.db$/i, '');
  if (clean === 'pali' || clean === 'tipitaka' || clean === 'cst' || clean === 'cst4') return 'pali';
  if (LANG_KEY_TO_CODE[clean]) return LANG_KEY_TO_CODE[clean];
  if (CODE_TO_LANG_KEY[clean]) return clean;
  return clean;
}

export function toLangKey(langOrDb) {
  const code = normalizeLangCode(langOrDb);
  if (!code) return null;
  if (code === 'pali') return 'pali';
  return CODE_TO_LANG_KEY[code] || code;
}

export function resolveBundlePrefsFromSettings(settingsObj, extraLangCode = null) {
  const isPaliEnabled = settingsObj?.translations?.pali !== false;
  const order = settingsObj?.translationOrder || [];
  const normExtraCode =
    extraLangCode && extraLangCode !== 'pali' ? normalizeLangCode(extraLangCode) : null;
  const extraLangKey =
    normExtraCode && normExtraCode !== 'pali' ? toLangKey(normExtraCode) : null;
  const langs = [];
  for (const id of order) {
    if (
      id !== 'pali' &&
      LANG_KEY_TO_CODE[id] &&
      (settingsObj?.translations?.[id] || (extraLangKey && id === extraLangKey))
    ) {
      const code = LANG_KEY_TO_CODE[id];
      if (!langs.includes(code)) langs.push(code);
    }
  }
  if (settingsObj?.translations) {
    for (const [id, enabled] of Object.entries(settingsObj.translations)) {
      if (id !== 'pali' && enabled && LANG_KEY_TO_CODE[id]) {
        const code = LANG_KEY_TO_CODE[id];
        if (!langs.includes(code)) langs.push(code);
      }
    }
  }
  if (normExtraCode && normExtraCode !== 'pali' && !langs.includes(normExtraCode)) {
    langs.push(normExtraCode);
  }
  const effectiveSentenceMode = Boolean(
    settingsObj?.translationGranularity === 'sentence' && langs.length > 0
  );
  return {
    langs,
    sentences: effectiveSentenceMode,
    paliSentences: Boolean(effectiveSentenceMode && isPaliEnabled),
  };
}

export function prefetchOpenBookAdjacentBundles({
  bookCode,
  targetChapIdx = 0,
  chaptersData = null,
  settingsObj = null,
  extraLangCode = null,
  prefetchedChapters = null,
  isLocalHost = isLocalDynamicHost,
  fetchBundle = fetchChapterBundle,
}) {
  if (
    !bookCode ||
    typeof isLocalHost !== 'function' ||
    !isLocalHost() ||
    typeof fetchBundle !== 'function' ||
    !chaptersData ||
    typeof chaptersData !== 'object'
  ) {
    return [];
  }
  const prefs = resolveBundlePrefsFromSettings(
    settingsObj,
    extraLangCode && extraLangCode !== 'pali' ? extraLangCode : null
  );
  if (!prefs.langs.length) return [];

  const baseIdx = Number.isInteger(targetChapIdx) ? targetChapIdx : 0;
  const candidates = [baseIdx, baseIdx + 1];
  if (baseIdx > 0) candidates.push(baseIdx - 1);

  const launched = [];
  for (const idx of candidates) {
    if (prefetchedChapters && prefetchedChapters.has(idx)) continue;
    if (chaptersData[idx] === undefined && chaptersData[String(idx)] === undefined) continue;
    launched.push(idx);
    Promise.resolve(
      fetchBundle(bookCode, idx, {
        includeHtml: false,
        langs: prefs.langs,
        sentences: prefs.sentences,
        paliSentences: prefs.paliSentences,
        links: false,
      })
    ).catch(() => {});
  }
  return launched;
}

export function TabProvider({ children }) {


  const { updateSetting, settings } = useThemeSettings();

  const [openTabs, setOpenTabs] = useState([]);
  const [activeBookCode, setActiveBookCode] = useState(null);
  const [activeParaNum, setActiveParaNum] = useState(null);
  const [loadingBook, setLoadingBook] = useState(false);
  const [isSidebarOpen, setIsSidebarOpenRaw] = useState(false);
  const [isTreePinned, setIsTreePinnedState] = useState(() => readStoredTreePinned());
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
  const [tabScrollIntents, setTabScrollIntents] = useState({});
  const [treeSelectedNode, setTreeSelectedNode] = useState(null);
  const [activeEditionPages, setActiveEditionPages] = useState({});
  const [isNotFound, setIsNotFound] = useState(false);

  const [bookmarks, setBookmarks] = useState([]);
  const [recentHistory, setRecentHistory] = useState([]);

  const openTabsRef = useRef([]);
  const activeBookCodeRef = useRef(null);
  const activeParaNumRef = useRef(null);
  const isSidebarOpenRef = useRef(isSidebarOpen);
  const isTreePinnedRef = useRef(isTreePinned);
  isTreePinnedRef.current = isTreePinned;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const setIsSidebarOpen = useCallback((nextValue) => {
    const resolved =
      typeof nextValue === 'function' ? Boolean(nextValue(isSidebarOpenRef.current)) : Boolean(nextValue);
    if (resolved !== isSidebarOpenRef.current && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tipitaka:before-layout-shift', {
        detail: { source: 'sidebar', shiftsLayout: Boolean(isTreePinnedRef.current && window.innerWidth >= 768) },
      }));
    }
    isSidebarOpenRef.current = resolved;
    setIsSidebarOpenRaw(resolved);
  }, []);

  const setBookScrollIntent = useCallback((bookCode, intent) => {
    if (!bookCode) {
      setTargetScrollIntent(intent);
      if (!intent) setTabScrollIntents({});
      return;
    }
    const enriched = intent ? { ...intent, bookCode } : null;
    setTabScrollIntents((prev) => {
      if (!enriched) {
        if (!prev[bookCode]) return prev;
        const next = { ...prev };
        delete next[bookCode];
        return next;
      }
      return { ...prev, [bookCode]: enriched };
    });
    if (!activeBookCodeRef.current || activeBookCodeRef.current === bookCode || !enriched) {
      setTargetScrollIntent(enriched);
    }
  }, []);

  const tabScrollMemoryRef = useRef({});
  const scrollPersistTimerRef = useRef(null);
  // bookCode -> URL script prefix (e.g. 'si') for tabs opened via script-prefixed URLs,
  // so updateUrlParams keeps the prefix in the address bar (deep-links stay script-specific)
  const tabScriptPrefixRef = useRef({});
  // bookCode -> translation language code (e.g. 'vi') for tabs opened via /translation/{lang}/{code} routes
  const tabTransRouteLangRef = useRef({});

  openTabsRef.current = openTabs;
  activeBookCodeRef.current = activeBookCode;
  activeParaNumRef.current = activeParaNum;
  isSidebarOpenRef.current = isSidebarOpen;

  const restoredSessionRef = useRef(false);
  const hydratingBooksRef = useRef(new Set());

  // Restore saved bookmarks, history, and scroll positions BEFORE child mount effects.
  // Do NOT auto-reload last opened tabs on app launch so reopening starts cleanly on WelcomeView.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.innerWidth < 768) {
      setIsSidebarOpenRaw(false);
    }

    try {
      const savedBookmarks = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
      if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));

      const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (savedHistory) setRecentHistory(JSON.parse(savedHistory));

      const savedScrolls = localStorage.getItem(STORAGE_KEYS.SCROLL);
      if (savedScrolls) {
        const parsedScrolls = JSON.parse(savedScrolls);
        if (parsedScrolls && typeof parsedScrolls === 'object') {
          tabScrollMemoryRef.current = parsedScrolls;
        }
      }
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
    const isChangingBook = paramsToUpdate?.book !== undefined && activeBookCodeRef.current && paramsToUpdate.book !== activeBookCodeRef.current;
    let preservedHash = '';
    if (paramsToUpdate?.hash !== undefined) {
      preservedHash = paramsToUpdate.hash ? (paramsToUpdate.hash.startsWith('#') ? paramsToUpdate.hash : `#${paramsToUpdate.hash}`) : '';
    } else if (!isChangingBook) {
      preservedHash = window.location.hash || '';
    }
    let targetLang = undefined;

    if (paramsToUpdate) {
      const bookTarget = paramsToUpdate.book !== undefined ? paramsToUpdate.book : activeBookCodeRef.current;
      const chapterTarget = paramsToUpdate.chapter !== undefined ? paramsToUpdate.chapter : null;

      if (bookTarget === null) {
        url.pathname = '/';
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
        url.searchParams.delete('chapter');
        url.searchParams.delete('c');
        url.searchParams.delete('tab');
      } else if (bookTarget === 'ai_chat') {
        url.pathname = '/';
        url.searchParams.set('tab', 'ai');
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
        url.searchParams.delete('chapter');
        url.searchParams.delete('c');
      } else if (bookTarget) {
        url.searchParams.delete('tab');
        const prefix = tabScriptPrefixRef.current[bookTarget];
        const routeTransLang = tabTransRouteLangRef.current[bookTarget] || null;
        const fullBookCode = prefix ? `${prefix}.${bookTarget}` : bookTarget;

        if (routeTransLang) {
          if (chapterTarget && parseInt(chapterTarget, 10) > 0) {
            url.pathname = `/translation/${routeTransLang}/${bookTarget}/${chapterTarget}`;
          } else {
            url.pathname = `/translation/${routeTransLang}/${bookTarget}`;
          }
        } else if (chapterTarget && parseInt(chapterTarget, 10) > 0) {
          url.pathname = `/book/${fullBookCode}/${chapterTarget}`;
        } else {
          url.pathname = `/book/${fullBookCode}`;
        }
        url.searchParams.delete('book');
        url.searchParams.delete('book_code');
        url.searchParams.delete('chapter');
        url.searchParams.delete('c');
      }

      // Handle language/database parameter normalization:
      // Primary: l=<lang_code> (omitted when 'pali', null, or already encoded in /translation/{lang}/ path).
      // Disallow db and lang in URL; map legacy db/lang into l.
      if (paramsToUpdate.l !== undefined) {
        targetLang = paramsToUpdate.l;
      } else if (paramsToUpdate.lang !== undefined) {
        targetLang = paramsToUpdate.lang;
      } else if (paramsToUpdate.db !== undefined) {
        targetLang = paramsToUpdate.db;
      }

      Object.entries(paramsToUpdate).forEach(([k, v]) => {
        if (k === 'book' || k === 'chapter' || k === 'c' || k === 'book_code' || k === 'hash') return;
        if (k === 'db' || k === 'lang' || k === 'l') return; // Handled specially below
        if (v === null || v === undefined) {
          url.searchParams.delete(k);
        } else {
          url.searchParams.set(k, v);
        }
      });
      url.searchParams.delete('hash');

      const activeRouteTransLang =
        bookTarget && bookTarget !== 'ai_chat' ? tabTransRouteLangRef.current[bookTarget] || null : null;

      if (targetLang !== undefined) {
        const norm = normalizeLangCode(targetLang);
        if (norm && norm !== 'pali') {
          if (activeRouteTransLang && norm === activeRouteTransLang) {
            url.searchParams.delete('l');
          } else {
            url.searchParams.set('l', norm);
          }
        } else {
          url.searchParams.delete('l');
        }
      } else if (activeRouteTransLang && url.searchParams.get('l') === activeRouteTransLang) {
        url.searchParams.delete('l');
      }
    }

    // Always clean up legacy 'db' and 'lang' from URL searchParams
    if (url.searchParams.has('db')) {
      const legacyDb = url.searchParams.get('db');
      url.searchParams.delete('db');
      if (targetLang === undefined && !url.searchParams.has('l') && legacyDb) {
        const norm = normalizeLangCode(legacyDb);
        if (norm && norm !== 'pali') url.searchParams.set('l', norm);
      }
    }
    if (url.searchParams.has('lang')) {
      const legacyLang = url.searchParams.get('lang');
      url.searchParams.delete('lang');
      if (targetLang === undefined && !url.searchParams.has('l') && legacyLang) {
        const norm = normalizeLangCode(legacyLang);
        if (norm && norm !== 'pali') url.searchParams.set('l', norm);
      }
    }
    // Ensure 'l=pali' is never in URL
    if (url.searchParams.get('l') === 'pali') {
      url.searchParams.delete('l');
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
      const minifiedTabs = tabs.map((t) => {
        const prefix = tabScriptPrefixRef.current[t.bookCode] || t.scriptPrefix;
        const resolvedPara =
          t.lastParaNum || (t.bookCode === activeBookCodeRef.current ? activeParaNumRef.current : undefined);
        const resolvedParaIndex =
          typeof t.lastParaIndex === 'number' && Number.isFinite(t.lastParaIndex)
            ? t.lastParaIndex
            : undefined;
        return {
          bookCode: t.bookCode,
          type: t.type || (t.bookCode === 'ai_chat' ? 'ai_chat' : 'book'),
          title: t.title || t.bookCode,
          nikaya: t.nikaya || '',
          category: t.category || '',
          currentChapterIdx: t.currentChapterIdx ?? null,
          lastParaNum: resolvedPara,
          ...(resolvedParaIndex !== undefined ? { lastParaIndex: resolvedParaIndex } : {}),
          viewMode: t.viewMode || (t.isTocView ? 'toc' : undefined),
          isTocView: t.isTocView || t.viewMode === 'toc' || false,
          ...(prefix ? { scriptPrefix: prefix } : {}),
        };
      });
      localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(minifiedTabs));
      if (activeCode) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE, activeCode);
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE);
      }
    } catch (e) {}
  }, []);

  const flushSessionPersistence = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (scrollPersistTimerRef.current) {
      clearTimeout(scrollPersistTimerRef.current);
      scrollPersistTimerRef.current = null;
    }
    try {
      if (typeof document !== 'undefined') {
        const isWindowMode = document.body.classList.contains('window-scroll');
        const activeCode = activeBookCodeRef.current;
        if (isWindowMode && activeCode && activeCode !== 'ai_chat') {
          const wy = window.scrollY || document.documentElement.scrollTop || 0;
          if (wy > 0 || tabScrollMemoryRef.current[activeCode] === undefined) {
            tabScrollMemoryRef.current[activeCode] = wy;
          }
        }
        const panes = document.querySelectorAll('main.content-area[data-book-code]');
        for (const pane of panes) {
          const code = pane.getAttribute('data-book-code');
          if (!code || code === 'ai_chat') continue;
          if (isWindowMode && code === activeCode) continue;
          if (pane.offsetParent !== null && (pane.scrollTop > 0 || tabScrollMemoryRef.current[code] === undefined)) {
            tabScrollMemoryRef.current[code] = pane.scrollTop;
          }
        }
      }
      localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
      persistTabs(openTabsRef.current, activeBookCodeRef.current);
    } catch (_) {}
  }, [persistTabs]);

  // Save exact tab position (chapter, paragraph, and pixel scroll)
  const saveTabPosition = useCallback((bookCode, chapterIdx, paraNum, scrollTop, paraIndex = undefined) => {
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

    const parsedPIdx =
      paraIndex !== undefined && paraIndex !== null && paraIndex !== ''
        ? Number(paraIndex)
        : NaN;
    const cleanPIdx = Number.isFinite(parsedPIdx) && parsedPIdx >= 0 ? Math.floor(parsedPIdx) : undefined;

    setOpenTabs((prev) => {
      let hasChanged = false;
      const updated = prev.map((t) => {
        if (t.bookCode === bookCode) {
          const newChapIdx = chapterIdx !== undefined ? chapterIdx : t.currentChapterIdx;
          let newPara = paraNum || t.lastParaNum;
          if (!paraNum && newChapIdx !== t.currentChapterIdx && t.lastParaNum) {
            const cleanOld = String(t.lastParaNum).replace(/^(?:para-?|p)/i, '').trim();
            const subKey = t.sub_book || t.chapter_to_sub_book?.[newChapIdx];
            const mappedChap =
              (subKey && t.sub_books_para_to_chapter?.[subKey]?.[cleanOld]) ??
              t.para_to_chapter?.[cleanOld];
            if (mappedChap !== undefined && mappedChap !== newChapIdx) {
              newPara =
                getFirstParaOfChapter(t.para_to_chapter, newChapIdx, subKey, t.sub_books_para_to_chapter) ||
                undefined;
            }
          }
          const newPIdx = cleanPIdx !== undefined ? cleanPIdx : t.lastParaIndex;
          if (t.currentChapterIdx !== newChapIdx || t.lastParaNum !== newPara || t.lastParaIndex !== newPIdx) {
            hasChanged = true;
            return {
              ...t,
              currentChapterIdx: newChapIdx,
              lastParaNum: newPara,
              ...(newPIdx !== undefined ? { lastParaIndex: newPIdx } : {}),
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

    openTabsRef.current = openTabsRef.current.map((t) =>
      t.bookCode === cleanCode
        ? {
            ...t,
            loadingChapters: { ...t.loadingChapters, [chapterIdx]: true },
          }
        : t
    );

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
      let chapHtml = null;
      const useBundle =
        typeof isLocalDynamicHost === 'function' &&
        isLocalDynamicHost() &&
        typeof fetchChapterBundle === 'function';
      if (useBundle) {
        const prefs = resolveBundlePrefsFromSettings(settingsRef.current);
        if (prefs.langs.length > 0) {
          const bundle = await fetchChapterBundle(cleanCode, chapterIdx, {
            includeHtml: true,
            langs: prefs.langs,
            sentences: prefs.sentences,
            paliSentences: prefs.paliSentences,
            links: false,
          }).catch(() => null);
          if (bundle && typeof bundle.html === 'string') {
            chapHtml = bundle.html;
          }
        }
      }
      if (chapHtml === null) {
        const res = await fetchChapter(cleanCode, chapterIdx);
        chapHtml = res.html;
      }
      setOpenTabs((prev) =>
        prev.map((t) => {
          if (t.bookCode !== cleanCode) return t;
          const newLoaded = { ...t.loadedChapters, [chapterIdx]: chapHtml };
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
      const isLocal = typeof isLocalDynamicHost === 'function' && isLocalDynamicHost();
      const toBuffer = isLocal
        ? [centerIdx + 1, centerIdx + 2, centerIdx - 1]
        : [centerIdx + 1, centerIdx - 1];

      toBuffer.forEach((idx, order) => {
        if (idx >= 0 && idx < totalChaps && !tab.loadedChapters?.[idx] && !tab.loadingChapters?.[idx]) {
          const delayMs = isLocal ? order * 30 : (order + 1) * 200;
          if (delayMs === 0) {
            loadChapter(cleanCode, idx);
          } else {
            setTimeout(() => {
              loadChapter(cleanCode, idx);
            }, delayMs);
          }
        }
      });
    },
    [loadChapter]
  );

  // Open or switch to Ani (AI Nissaya) Chat tab
  const openAiChatTab = useCallback(
    (options = {}) => {
      setIsNotFound(false);
      if (typeof document !== 'undefined') {
        document.title = 'Ani Assistant | Tipiṭaka Pāḷi';
      }

      const currentTabs = openTabsRef.current;
      const existingIndex = currentTabs.findIndex((t) => t.type === 'ai_chat' || t.bookCode === 'ai_chat');

      if (existingIndex !== -1) {
        setActiveBookCode('ai_chat');
        setTargetScrollIntent(null);
        setTreeSelectedNode(null);
        setSearchHighlight(null);
        persistTabs(currentTabs, 'ai_chat');
        updateUrlParams({ book: 'ai_chat' });
        return;
      }

      const aiTab = {
        bookCode: 'ai_chat',
        type: 'ai_chat',
        title: 'Ani Assistant',
        viewMode: 'ai_chat',
        initialQuery: options?.query || null,
      };

      const nextTabs = [...currentTabs, aiTab];
      setOpenTabs(nextTabs);
      setActiveBookCode('ai_chat');
      setTargetScrollIntent(null);
      setTreeSelectedNode(null);
      setSearchHighlight(null);
      persistTabs(nextTabs, 'ai_chat');
      updateUrlParams({ book: 'ai_chat' });
    },
    [persistTabs, updateUrlParams]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__openAiChatTab = openAiChatTab;
    }
  }, [openAiChatTab]);

  const openBook = useCallback(
    async (bookCode, options = {}) => {
      if (!bookCode) return;
      if (bookCode === 'ai_chat') {
        openAiChatTab(options);
        return;
      }
      setIsNotFound(false);
      let cleanCode = bookCode.replace('.xml', '');
      if (cleanCode === 'ai_chat') {
        openAiChatTab(options);
        return;
      }

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
        delete tabTransRouteLangRef.current[cleanCode];
      }

      // Resolve and enable any requested translation language immediately (works for BOTH
      // TOC routes like /translation/vi/{book_code} or /book/{code}?l=vi AND chapter routes)
      const currentUrlL = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('l') : null;
      const requestedRawLang = options.l || options.lang || options.db || currentUrlL || null;
      const requestedNormLang = requestedRawLang ? normalizeLangCode(requestedRawLang) : null;
      const requestedCleanLang = (requestedNormLang && requestedNormLang !== 'pali') ? requestedNormLang : null;

      if (options.fromTranslationRoute && requestedCleanLang) {
        tabTransRouteLangRef.current[cleanCode] = requestedCleanLang;
        delete tabScriptPrefixRef.current[cleanCode];
      }

      if (requestedCleanLang) {
        const langKey = CODE_TO_LANG_KEY[requestedCleanLang] || requestedCleanLang;
        if (langKey) {
          updateSetting('translations', (prevTrans) => {
            const base = prevTrans || {};
            if (base[langKey]) return prevTrans;
            return { ...base, [langKey]: true };
          });
        }
      }

      const rawParaNum = options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '') : null;
      const hasParaTarget = rawParaNum || (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '');
      const hasPageTarget = !!options.targetPage;
      // TOC request: no specific chapter/para/page — show book's TOC
      const isTocRequest = !hasTargetChapter && !hasParaTarget && !hasPageTarget;

      const isAlongside = Boolean(options.alongside);
      const isSingleMode = settingsRef.current?.tabView === 'single' && !isAlongside && !options.newTab;
      const sourceBookCode = options.sourceBookCode || activeBookCodeRef.current;
      const keepActive = Boolean(
        options.keepActive &&
        sourceBookCode &&
        sourceBookCode !== cleanCode &&
        openTabsRef.current.some((t) => t.bookCode === sourceBookCode)
      );
      const effectiveActiveCode = keepActive ? sourceBookCode : cleanCode;

      const currentTabs = openTabsRef.current;
      const existingTabIndex = currentTabs.findIndex((t) => t.bookCode === cleanCode);

      const readPaneScrollOffset = (code) => {
        if (typeof document === 'undefined' || !code) return null;
        const isWin = document.body?.classList?.contains('window-scroll');
        if (isWin && activeBookCodeRef.current === code && code !== 'ai_chat') {
          return window.scrollY || document.documentElement.scrollTop || 0;
        }
        const c = getActiveContentArea(code);
        if (c && c.offsetParent !== null) {
          return c.scrollTop;
        }
        return null;
      };

      if (activeBookCodeRef.current && activeBookCodeRef.current !== cleanCode) {
        const curScroll = readPaneScrollOffset(activeBookCodeRef.current);
        if (curScroll !== null && (curScroll > 0 || tabScrollMemoryRef.current[activeBookCodeRef.current] === undefined)) {
          tabScrollMemoryRef.current[activeBookCodeRef.current] = curScroll;
          try {
            localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
          } catch (e) {}
        }
      }

      const existingTab = existingTabIndex !== -1 ? currentTabs[existingTabIndex] : null;
      const existingNeedsBookLoad = Boolean(
        existingTab &&
        !isTocRequest &&
        (existingTab.needsHydration || !Array.isArray(existingTab.chapters) || existingTab.chapters.length === 0)
      );

      if (existingTabIndex !== -1 && !existingNeedsBookLoad) {
        if (!keepActive) {
          setActiveBookCode((prev) => (prev !== cleanCode ? cleanCode : prev));
        }
        const tab = currentTabs[existingTabIndex];

        // TOC request — show book TOC (no auto chapter 1)
        if (isTocRequest) {
          const needsTocFetch = !tab.toc || tab.toc.length === 0 || !tab.chapters || tab.chapters.length === 0;
          const updatedTocTab = { ...tab, viewMode: 'toc', isTocView: true, currentChapterIdx: null, isLoading: needsTocFetch };
          const nextTabsToc = insertOrUpdateTabInList(currentTabs, updatedTocTab, {
            isSingleMode,
            isAlongside,
            sourceBookCode,
            activeCode: activeBookCodeRef.current,
          });
          setOpenTabs(nextTabsToc);
          persistTabs(nextTabsToc, cleanCode);
          setActiveBookCode(cleanCode);
          setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: null });
          updateUrlParams({ book: cleanCode, chapter: null, q: null, search: null });
          setBookScrollIntent(cleanCode, null);
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
                            needsHydration: false,
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
          Object.keys(tab.page_to_chapter).length === 0 ||
          (!tab.split_targets && tab.mat?.split_targets) ||
          !tab.chapter_to_mat ||
          !tab.para_to_mat ||
          !tab.mat
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
                          split_targets: bData.split_targets || bData.mat?.split_targets || t.split_targets || null,
                          chapter_to_mat: bData.chapter_to_mat || t.chapter_to_mat || null,
                          para_to_mat: bData.para_to_mat || t.para_to_mat || null,
                          sub_books_para_to_mat: bData.sub_books_para_to_mat || t.sub_books_para_to_mat || null,
                          mula_chapter: bData.mula_chapter !== undefined ? bData.mula_chapter : (bData.mat?.mula_chapter ?? t.mula_chapter),
                          mula_chapter_offset: bData.mula_chapter_offset !== undefined ? bData.mula_chapter_offset : (bData.mat?.mula_chapter_offset ?? t.mula_chapter_offset),
                          attha_chapter_offset: bData.attha_chapter_offset !== undefined ? bData.attha_chapter_offset : (bData.mat?.attha_chapter_offset ?? t.attha_chapter_offset),
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
        let effectivePara = rawParaNum;

        // 1. If targetParaIndex is explicitly provided (e.g. from FTS translation search or TOC), resolve target chapter directly and accurately
        if (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
          const chapFromIdx = getChapterIdxForParaIndex(tab.chapters, options.targetParaIndex);
          if (chapFromIdx !== null && chapFromIdx !== undefined) {
            targetChapIdx = chapFromIdx;
            hasTargetChapter = true;
          }
        }

        // 2. If targetChapter not resolved via targetParaIndex or explicit targetChapterIdx, resolve via rawParaNum
        if (!hasTargetChapter && rawParaNum && tab.para_to_chapter) {
          if (tab.para_to_chapter[rawParaNum] !== undefined) {
            targetChapIdx = tab.para_to_chapter[rawParaNum];
            hasTargetChapter = true;
            effectivePara = rawParaNum;
          } else {
            const resolved = resolveNearestChapterAndPara(tab.para_to_chapter, rawParaNum, targetSub, tab.sub_books_para_to_chapter);
            if (resolved) {
              targetChapIdx = resolved.chapterIdx;
              hasTargetChapter = true;
              effectivePara = resolved.paraNum || rawParaNum;
            }
          }
        }
        if (!keepActive && effectivePara && (!options.lang || options.lang === 'pali')) {
          setActiveParaNum(effectivePara);
        }

        if (hasTargetChapter && !rawParaNum && (options.targetParaIndex === undefined || options.targetParaIndex === null || options.targetParaIndex === '')) {
          const firstP = getFirstParaOfChapter(tab.para_to_chapter, targetChapIdx, targetSub, tab.sub_books_para_to_chapter);
          if (firstP) {
            if (!keepActive) setActiveParaNum(firstP);
            effectivePara = firstP;
          }
        }

        const parsedPIdx =
          options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== ''
            ? Number(options.targetParaIndex)
            : NaN;
        const nextParaIndex = Number.isFinite(parsedPIdx) && parsedPIdx >= 0 ? Math.floor(parsedPIdx) : tab.lastParaIndex;

        const updatedExistingTab = {
          ...tab,
          currentChapterIdx: hasTargetChapter ? targetChapIdx : tab.currentChapterIdx,
          lastParaNum: effectivePara || tab.lastParaNum,
          ...(nextParaIndex !== undefined ? { lastParaIndex: nextParaIndex } : {}),
          fromSavedSession: false,
          viewMode: 'reader',
          isTocView: false,
        };
        const nextTabs = insertOrUpdateTabInList(currentTabs, updatedExistingTab, {
          isSingleMode,
          isAlongside,
          sourceBookCode,
          activeCode: activeBookCodeRef.current,
        });
        setOpenTabs(nextTabs);
        openTabsRef.current = nextTabs;
        persistTabs(nextTabs, effectiveActiveCode);

        if (hasTargetChapter) {
          if (!tab.loadedChapters?.[targetChapIdx]) {
            loadChapter(cleanCode, targetChapIdx);
          }
          if (targetChapIdx > 0 && !tab.loadedChapters?.[targetChapIdx - 1]) {
            loadChapter(cleanCode, targetChapIdx - 1);
          }
          bufferAdjacentChapters(cleanCode, targetChapIdx);
        }

        const currentUrlL = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('l') : null;
        const rawLang = options.l || options.lang || options.db || currentUrlL || null;
        const normLang = rawLang ? normalizeLangCode(rawLang) : null;
        const cleanLangCode = (normLang && normLang !== 'pali') ? normLang : null;

        if (cleanLangCode) {
          const langKey = CODE_TO_LANG_KEY[cleanLangCode] || cleanLangCode;
          if (langKey) {
            updateSetting('translations', (prevTrans) => {
              const base = prevTrans || {};
              if (base[langKey]) return prevTrans;
              return { ...base, [langKey]: true };
            });
          }
        }

        if (hasTargetChapter || options.targetParaIndex !== undefined || rawParaNum || options.targetPage || options.highlightQuery) {
          setBookScrollIntent(cleanCode, {
            chapterIdx: hasTargetChapter ? targetChapIdx : undefined,
            paraIndex: options.targetParaIndex,
            paraNum: effectivePara || rawParaNum,
            lineId: options.targetLineId || null,
            subBook: targetSub || undefined,
            page: options.targetPage,
            pageSystem: options.targetPageSystem,
            highlightQuery: options.highlightQuery,
            lang: cleanLangCode || options.lang || null,
            l: cleanLangCode,
            db: options.db || null,
            timestamp: Date.now(),
          });
        } else {
          setBookScrollIntent(cleanCode, null);
        }

        const activeChap = hasTargetChapter
          ? targetChapIdx
          : currentTabs[existingTabIndex].currentChapterIdx || 0;

        const qParam = options.searchQuery || options.highlightQuery || null;
        const lParam = cleanLangCode || null;
        if (qParam) {
          setSearchHighlight({
            query: qParam,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum || (options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '').trim() : undefined),
            lang: cleanLangCode || options.lang || null,
            l: lParam,
            db: options.db || null,
          });
        } else if (!keepActive) {
          setSearchHighlight(null);
        }
        if (!keepActive) {
          setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: activeChap });
          const existingHash = effectivePara ? `#para${effectivePara}` : (rawParaNum ? `#para${rawParaNum}` : (options.targetParaNum ? `#para${options.targetParaNum}` : undefined));
          updateUrlParams({ book: cleanCode, chapter: activeChap + 1, hash: existingHash, q: qParam, l: lParam, search: null });
        }

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
        const nextTabsOptimistic = insertOrUpdateTabInList(openTabsRef.current, optimisticTocTab, {
          isSingleMode,
          isAlongside,
          sourceBookCode,
          activeCode: activeBookCodeRef.current,
        });
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
            split_targets: bookData.split_targets || bookData.mat?.split_targets || null,
            chapter_to_mat: bookData.chapter_to_mat || null,
            para_to_mat: bookData.para_to_mat || null,
            sub_books_para_to_mat: bookData.sub_books_para_to_mat || null,
            mula_chapter: bookData.mula_chapter !== undefined ? bookData.mula_chapter : null,
            mula_chapter_offset: bookData.mula_chapter_offset !== undefined ? bookData.mula_chapter_offset : null,
            attha_chapter_offset: bookData.attha_chapter_offset !== undefined ? bookData.attha_chapter_offset : null,
            loadedChapters: {},
            loadingChapters: {},
            isLoading: false,
            currentChapterIdx: null,
            viewMode: 'toc',
            isTocView: true,
          };
          const nextTabs2 = insertOrUpdateTabInList(openTabsRef.current, newTocTab, {
            isSingleMode,
            isAlongside,
            sourceBookCode,
            activeCode: activeBookCodeRef.current,
          });
          setOpenTabs(nextTabs2);
          persistTabs(nextTabs2, cleanCode);
          setActiveBookCode(cleanCode);
          setTreeSelectedNode({ bookCode: cleanCode, chapterIdx: null });
          setBookScrollIntent(cleanCode, null);
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
        title: options.title || existingTab?.title || bookInfo?.title || cleanCode,
        nikaya: options.nikaya || existingTab?.nikaya || bookInfo?.nikaya || '',
        category: options.category || existingTab?.category || bookInfo?.category || '',
        chapter_count: 1,
        chapters: [],
        toc: [],
        loadedChapters: {},
        loadingChapters: hasTargetChapter && targetChapIdx !== null && targetChapIdx !== undefined ? { [targetChapIdx]: true } : {},
        isLoading: true,
        fromSavedSession: false,
        needsHydration: false,
        currentChapterIdx: targetChapIdx,
        viewMode: 'reader',
        isTocView: false,
        sub_book: options.targetSubBook || null,
      };
      const nextTabsOptimistic = insertOrUpdateTabInList(openTabsRef.current, optimisticTab, {
        isSingleMode,
        isAlongside,
        sourceBookCode,
        activeCode: activeBookCodeRef.current,
      });
      setOpenTabs(nextTabsOptimistic);
      if (!keepActive) {
        setActiveBookCode(cleanCode);
        const initialHash = rawParaNum ? `#para${rawParaNum}` : (options.targetParaNum ? `#para${options.targetParaNum}` : undefined);
        updateUrlParams({
          book: cleanCode,
          chapter: hasTargetChapter && targetChapIdx !== null && targetChapIdx !== undefined ? targetChapIdx + 1 : null,
          hash: initialHash,
        });
      }
      persistTabs(nextTabsOptimistic, effectiveActiveCode);

      setLoadingBook(true);
      try {
        // Pre-resolve target chapter cleanly before fetching chapters_data when jumping to a para/paraIndex
        if (hasParaTarget && !hasTargetChapter) {
          try {
            const tocMeta = await fetchBookTocOnly(cleanCode);
            if (tocMeta) {
              if (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
                const chapFromIdx = getChapterIdxForParaIndex(tocMeta.chapters, options.targetParaIndex);
                if (chapFromIdx !== null && chapFromIdx !== undefined) {
                  targetChapIdx = chapFromIdx;
                  hasTargetChapter = true;
                }
              }
              if (!hasTargetChapter && rawParaNum && tocMeta.para_to_chapter) {
                const preSub = options.targetSubBook || tocMeta.sub_book || null;
                if (tocMeta.para_to_chapter[rawParaNum] !== undefined) {
                  targetChapIdx = tocMeta.para_to_chapter[rawParaNum];
                  hasTargetChapter = true;
                } else {
                  const resolved = resolveNearestChapterAndPara(
                    tocMeta.para_to_chapter,
                    rawParaNum,
                    preSub,
                    tocMeta.sub_books_para_to_chapter
                  );
                  if (resolved && resolved.chapterIdx !== undefined && resolved.chapterIdx !== null) {
                    targetChapIdx = resolved.chapterIdx;
                    hasTargetChapter = true;
                  }
                }
              }
            }
          } catch (_) {}
        }

        // Prefetch target chapter's translations + pali_sentences in parallel with fetchBook
        // on local offline hosts so ChapterBlock renders on frame 1 without a loading spinner.
        const urlLang = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('l') : null;
        const extraRaw = options.l || options.lang || options.db || urlLang || null;
        const extraNorm = extraRaw ? normalizeLangCode(extraRaw) : null;
        const openBookExtraLang = extraNorm && extraNorm !== 'pali' ? extraNorm : null;
        const prefetchedBundleChapters = new Set();
        if (
          typeof isLocalDynamicHost === 'function' &&
          isLocalDynamicHost() &&
          typeof fetchChapterBundle === 'function' &&
          (hasTargetChapter || (!rawParaNum && (options.targetParaIndex === undefined || options.targetParaIndex === null || options.targetParaIndex === '')))
        ) {
          const prefs = resolveBundlePrefsFromSettings(
            settingsRef.current,
            openBookExtraLang
          );
          if (prefs.langs.length > 0) {
            const preIdx = targetChapIdx ?? 0;
            prefetchedBundleChapters.add(preIdx);
            fetchChapterBundle(cleanCode, preIdx, {
              includeHtml: false,
              langs: prefs.langs,
              sentences: prefs.sentences,
              paliSentences: prefs.paliSentences,
              links: false,
            }).catch(() => {});
          }
        }

        // First resolve chapter if targetParaNum is provided and we can pre-check or load metadata
        const bookData = await fetchBook(cleanCode, {
          chapter: targetChapIdx ?? 0,
          buffer: 1,
        });

        const targetSub = options.targetSubBook || bookData.sub_book || bookData.chapter_to_sub_book?.[targetChapIdx ?? 0];
        let effectivePara = rawParaNum;

        // 1. If targetParaIndex is explicitly provided (e.g. from FTS translation search or TOC), resolve target chapter directly and accurately
        if (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
          const chapFromIdx = getChapterIdxForParaIndex(bookData.chapters, options.targetParaIndex);
          if (chapFromIdx !== null && chapFromIdx !== undefined) {
            targetChapIdx = chapFromIdx;
            hasTargetChapter = true;
          }
        }

        // 2. If targetChapter not resolved via targetParaIndex or explicit targetChapterIdx, resolve via rawParaNum
        if (!hasTargetChapter && rawParaNum && bookData.para_to_chapter) {
          if (bookData.para_to_chapter[rawParaNum] !== undefined) {
            targetChapIdx = bookData.para_to_chapter[rawParaNum];
            hasTargetChapter = true;
            effectivePara = rawParaNum;
          } else {
            const resolved = resolveNearestChapterAndPara(bookData.para_to_chapter, rawParaNum, targetSub, bookData.sub_books_para_to_chapter);
            if (resolved) {
              targetChapIdx = resolved.chapterIdx;
              hasTargetChapter = true;
              effectivePara = resolved.paraNum || rawParaNum;
            }
          }
        }
        if (!keepActive && effectivePara && (!options.lang || options.lang === 'pali')) {
          setActiveParaNum(effectivePara);
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

        // Prefetch translation + pali_sentences bundles for chapters already
        // preloaded via fetchBook(..., { buffer: 1 }) (e.g. targetChapIdx + 1)
        // since loadChapter will not run for them and scrolling down quickly
        // from a short chapter 0 would otherwise hit isTransPending.
        prefetchOpenBookAdjacentBundles({
          bookCode: cleanCode,
          targetChapIdx: targetChapIdx ?? 0,
          chaptersData: bookData.chapters_data,
          settingsObj: settingsRef.current,
          extraLangCode: openBookExtraLang,
          prefetchedChapters: prefetchedBundleChapters,
        });

        if (hasTargetChapter && !rawParaNum && (options.targetParaIndex === undefined || options.targetParaIndex === null || options.targetParaIndex === '')) {
          const firstP = getFirstParaOfChapter(bookData.para_to_chapter, targetChapIdx, targetSub, bookData.sub_books_para_to_chapter);
          if (firstP) {
            if (!keepActive) setActiveParaNum(firstP);
            effectivePara = firstP;
          }
        }

        const parsedNewPIdx =
          options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== ''
            ? Number(options.targetParaIndex)
            : NaN;
        const resolvedNewPIdx = Number.isFinite(parsedNewPIdx) && parsedNewPIdx >= 0 ? Math.floor(parsedNewPIdx) : undefined;

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
          split_targets: bookData.split_targets || bookData.mat?.split_targets || null,
          chapter_to_mat: bookData.chapter_to_mat || null,
          para_to_mat: bookData.para_to_mat || null,
          sub_books_para_to_mat: bookData.sub_books_para_to_mat || null,
          mula_chapter: bookData.mula_chapter !== undefined ? bookData.mula_chapter : (bookData.mat?.mula_chapter ?? null),
          mula_chapter_offset: bookData.mula_chapter_offset !== undefined ? bookData.mula_chapter_offset : (bookData.mat?.mula_chapter_offset ?? null),
          attha_chapter_offset: bookData.attha_chapter_offset !== undefined ? bookData.attha_chapter_offset : (bookData.mat?.attha_chapter_offset ?? null),

          loadedChapters: { ...bookData.chapters_data },

          loadingChapters: {},
          isLoading: false,
          needsHydration: false,
          fromSavedSession: false,
          currentChapterIdx: targetChapIdx ?? 0,
          lastParaNum: effectivePara || undefined,
          ...(resolvedNewPIdx !== undefined ? { lastParaIndex: resolvedNewPIdx } : {}),
          viewMode: 'reader',
          isTocView: false,
        };

        const currentTabsNow = openTabsRef.current;
        const existingNow = currentTabsNow.find((t) => t.bookCode === cleanCode);
        const mergedNewTab = existingNow
          ? {
              ...existingNow,
              ...newTab,
              loadedChapters: { ...existingNow.loadedChapters, ...newTab.loadedChapters },
            }
          : newTab;
        const nextTabs = insertOrUpdateTabInList(currentTabsNow, mergedNewTab, {
          isSingleMode,
          isAlongside,
          sourceBookCode,
          activeCode: activeBookCodeRef.current,
        });
        setOpenTabs(nextTabs);
        openTabsRef.current = nextTabs;
        persistTabs(nextTabs, effectiveActiveCode);
        if (!keepActive) {
          setActiveBookCode(cleanCode);
        }
        if (targetChapIdx !== null && targetChapIdx !== undefined && targetChapIdx > 0 && !bookData.chapters_data?.[targetChapIdx - 1]) {
          loadChapter(cleanCode, targetChapIdx - 1);
        }

        const currentUrlL = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('l') : null;
        const rawLang = options.l || options.lang || options.db || currentUrlL || null;
        const normLang = rawLang ? normalizeLangCode(rawLang) : null;
        const cleanLangCode = (normLang && normLang !== 'pali') ? normLang : null;

        if (cleanLangCode) {
          const langKey = CODE_TO_LANG_KEY[cleanLangCode] || cleanLangCode;
          if (langKey) {
            updateSetting('translations', (prevTrans) => {
              const base = prevTrans || {};
              if (base[langKey]) return prevTrans;
              return { ...base, [langKey]: true };
            });
          }
        }

        if (hasTargetChapter || options.targetParaIndex !== undefined || rawParaNum || options.targetPage || options.highlightQuery) {
          setBookScrollIntent(cleanCode, {
            chapterIdx: hasTargetChapter ? targetChapIdx : undefined,
            paraIndex: options.targetParaIndex,
            paraNum: effectivePara || rawParaNum,
            lineId: options.targetLineId || null,
            subBook: targetSub || undefined,
            page: options.targetPage,
            pageSystem: options.targetPageSystem,
            highlightQuery: options.highlightQuery,
            lang: cleanLangCode || options.lang || null,
            l: cleanLangCode,
            db: options.db || null,
            timestamp: Date.now(),
          });
        } else {
          setBookScrollIntent(cleanCode, null);
        }

        const qParam = options.searchQuery || options.highlightQuery || null;
        const lParam = cleanLangCode || null;
        if (qParam) {
          setSearchHighlight({
            query: qParam,
            paraIndex: options.targetParaIndex,
            paraNum: rawParaNum || (options.targetParaNum ? String(options.targetParaNum).replace(/^(?:para-?|p)/i, '').trim() : undefined),
            lang: cleanLangCode || options.lang || null,
            l: lParam,
            db: options.db || null,
          });
        } else if (!keepActive) {
          setSearchHighlight(null);
        }
        const resolvedChapIdx = targetChapIdx ?? 0;
        if (!keepActive) {
          setTreeSelectedNode({
            bookCode: cleanCode,
            chapterIdx: resolvedChapIdx,
          });
          const finalHash = effectivePara ? `#para${effectivePara}` : (rawParaNum ? `#para${rawParaNum}` : (options.targetParaNum ? `#para${options.targetParaNum}` : undefined));
          updateUrlParams({ book: cleanCode, chapter: (targetChapIdx ?? 0) + 1, hash: finalHash, q: qParam, l: lParam, search: null });
        }
        bufferAdjacentChapters(cleanCode, resolvedChapIdx);

        addToHistory({
          bookCode: cleanCode,
          bookTitle: newTab.title,
          nikaya: newTab.nikaya,
          chapterIdx: resolvedChapIdx,
          chapterTitle: newTab.chapters?.[resolvedChapIdx]?.title || '',
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
    [updateUrlParams, loadChapter, bufferAdjacentChapters, persistTabs, addToHistory, updateSetting, setBookScrollIntent]
  );

  // Switch tabs smoothly with instant scroll position restoration
  const switchTab = useCallback(
    (bookCode) => {
      const outgoingCode = activeBookCodeRef.current;

      // Synchronously save the outgoing tab's exact pixel scroll position.
      // NOTE: we intentionally do NOT sniff/rewrite currentChapterIdx/lastParaNum
      // here. The debounced scroll handler in ReaderView is the sole author of
      // chapter/para position; a viewport guess at switch time (top+offset) would
      // fight the saved pixel on restore and cause the "shifts when switching
      // tabs" bug. Pixel memory is the source of truth for plain tab switches.
      if (outgoingCode && outgoingCode !== bookCode && typeof document !== 'undefined') {
        const isWin = document.body?.classList?.contains('window-scroll');
        const container = getActiveContentArea(outgoingCode);
        const currentScroll = isWin
          ? (window.scrollY || document.documentElement.scrollTop || 0)
          : (container && container.offsetParent !== null ? container.scrollTop : null);
        if (
          currentScroll !== null &&
          (currentScroll > 0 || tabScrollMemoryRef.current[outgoingCode] === undefined)
        ) {
          tabScrollMemoryRef.current[outgoingCode] = currentScroll;
          try {
            localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
          } catch (e) {}
        }
      }

      // Flush any debounced scroll persist immediately before switching
      if (scrollPersistTimerRef.current) {
        clearTimeout(scrollPersistTimerRef.current);
        scrollPersistTimerRef.current = null;
        try {
          localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
        } catch (e) {}
      }

      setActiveBookCode(bookCode);
      setBookScrollIntent(bookCode, null);

      const tab = openTabsRef.current.find((t) => t.bookCode === bookCode);
      if (tab) {
        if (tab.type === 'ai_chat' || tab.bookCode === 'ai_chat') {
          setTreeSelectedNode(null);
          setSearchHighlight(null);
          updateUrlParams({ book: 'ai_chat' });
          persistTabs(openTabsRef.current, 'ai_chat');
          return;
        }
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
        const needsFullHydration =
          Boolean(tab.needsHydration) ||
          !Array.isArray(tab.chapters) ||
          tab.chapters.length === 0 ||
          !tab.para_to_chapter ||
          Object.keys(tab.para_to_chapter).length === 0 ||
          !tab.page_to_chapter ||
          Object.keys(tab.page_to_chapter).length === 0;

        if (needsFullHydration && !hydratingBooksRef.current.has(bookCode)) {
          hydratingBooksRef.current.add(bookCode);
          const hydrateChap = tab.currentChapterIdx ?? 0;
          if (!Array.isArray(tab.chapters) || tab.chapters.length === 0) {
            setOpenTabs((prev) =>
              prev.map((t) =>
                t.bookCode === bookCode ? { ...t, isLoading: true } : t
              )
            );
          }
          fetchBook(bookCode, { chapter: hydrateChap, buffer: 1 })
            .then(async (bData) => {
              if (!bData) return;
              const nextChaptersData = { ...(bData.chapters_data || {}) };
              if (!nextChaptersData[hydrateChap]) {
                try {
                  const chRes = await fetchChapter(bookCode, hydrateChap);
                  if (chRes && chRes.html) {
                    nextChaptersData[hydrateChap] = chRes.html;
                  }
                } catch (_) {}
              }
              prefetchOpenBookAdjacentBundles({
                bookCode,
                targetChapIdx: hydrateChap,
                chaptersData: nextChaptersData,
                settingsObj: settingsRef.current,
              });
              setOpenTabs((prev) =>
                prev.map((t) =>
                  t.bookCode === bookCode
                    ? {
                        ...t,
                        title: bData.title || t.title,
                        nikaya: bData.nikaya || bData.category || t.nikaya,
                        category: bData.category || t.category,
                        chapter_count: bData.chapter_count || (bData.chapters ? bData.chapters.length : t.chapter_count),
                        chapters: bData.chapters?.length ? bData.chapters : t.chapters,
                        toc: bData.toc?.length ? bData.toc : t.toc,
                        loadedChapters: { ...(t.loadedChapters || {}), ...nextChaptersData },
                        isLoading: false,
                        needsHydration: false,
                        para_to_chapter: bData.para_to_chapter || t.para_to_chapter || {},
                        para_to_index: bData.para_to_index || t.para_to_index || {},
                        page_to_chapter: bData.page_to_chapter || t.page_to_chapter || {},
                        page_to_para: bData.page_to_para || t.page_to_para || {},
                        page_anchors: bData.page_anchors || t.page_anchors || {},
                        para_range: bData.para_range || t.para_range,
                        edition_ranges: bData.edition_ranges || t.edition_ranges,
                        book_type: bData.book_type || t.book_type || 'Whole',
                        sub_books: bData.sub_books || t.sub_books || null,
                        sub_book: bData.sub_book || t.sub_book || null,
                        chapter_to_sub_book: bData.chapter_to_sub_book || t.chapter_to_sub_book || null,
                        sub_books_para_to_chapter: bData.sub_books_para_to_chapter || t.sub_books_para_to_chapter || null,
                        attha_start_chapter: bData.attha_start_chapter !== undefined ? bData.attha_start_chapter : t.attha_start_chapter,
                        tika_start_chapter: bData.tika_start_chapter !== undefined ? bData.tika_start_chapter : t.tika_start_chapter,
                        split_targets: bData.split_targets || bData.mat?.split_targets || t.split_targets || null,
                        chapter_to_mat: bData.chapter_to_mat || t.chapter_to_mat || null,
                        para_to_mat: bData.para_to_mat || t.para_to_mat || null,
                        sub_books_para_to_mat: bData.sub_books_para_to_mat || t.sub_books_para_to_mat || null,
                        mula_chapter: bData.mula_chapter !== undefined ? bData.mula_chapter : (bData.mat?.mula_chapter ?? t.mula_chapter),
                        mula_chapter_offset: bData.mula_chapter_offset !== undefined ? bData.mula_chapter_offset : (bData.mat?.mula_chapter_offset ?? t.mula_chapter_offset),
                        attha_chapter_offset: bData.attha_chapter_offset !== undefined ? bData.attha_chapter_offset : (bData.mat?.attha_chapter_offset ?? t.attha_chapter_offset),
                        mat: bData.mat || t.mat,
                      }
                    : t
                )
              );
            })
            .catch(() => {
              setOpenTabs((prev) =>
                prev.map((t) => (t.bookCode === bookCode ? { ...t, isLoading: false } : t))
              );
            })
            .finally(() => {
              hydratingBooksRef.current.delete(bookCode);
            });
        }

        let targetChap = tab.currentChapterIdx;
        if ((targetChap === undefined || targetChap === null) && tab.lastParaNum) {
          const cleanP = String(tab.lastParaNum).replace(/^(?:para-?|p)/i, '').trim();
          const subKey = tab.sub_book;
          const mappedChap =
            (subKey && tab.sub_books_para_to_chapter?.[subKey]?.[cleanP]) ??
            tab.para_to_chapter?.[cleanP];
          if (cleanP && mappedChap !== undefined) {
            targetChap = mappedChap;
          }
        }
        if (targetChap === undefined || targetChap === null) {
          targetChap = 0;
        }

        // Plain tab switch: do NOT rewrite the outgoing tab's chapter/para
        // (see save above). Only ensure the incoming tab's chapter index is initialized
        // if it was null/undefined; never force a re-anchor — pixel restore in ReaderView owns the scroll position.
        setOpenTabs((prev) => {
          const incoming = prev.find((t) => t.bookCode === bookCode);
          if (!incoming || incoming.currentChapterIdx === targetChap) return prev;
          const next = prev.map((t) => {
            if (t.bookCode === bookCode) {
              return {
                ...t,
                currentChapterIdx: targetChap,
              };
            }
            return t;
          });
          persistTabs(next, bookCode);
          return next;
        });

        if (!tab.loadedChapters?.[targetChap]) {
          loadChapter(bookCode, targetChap);
        }
        bufferAdjacentChapters(bookCode, targetChap);

        const activeSubForChap = tab.sub_book || tab.chapter_to_sub_book?.[targetChap];
        if (tab.lastParaNum) {
          setActiveParaNum(tab.lastParaNum);
        } else {
          const firstP = getFirstParaOfChapter(tab.para_to_chapter, targetChap, activeSubForChap, tab.sub_books_para_to_chapter);
          if (firstP) {
            setActiveParaNum(firstP);
          }
        }
        setTreeSelectedNode({
          bookCode: tab.bookCode,
          chapterIdx: targetChap,
        });
        setSearchHighlight(null);
        const hashToApply = tab.lastParaNum ? `#para${tab.lastParaNum}` : '';
        updateUrlParams({
          book: tab.bookCode,
          chapter: targetChap + 1,
          hash: hashToApply,
          q: null,
          search: null,
        });
        persistTabs(openTabsRef.current, tab.bookCode);

        addToHistory({
          bookCode: tab.bookCode,
          bookTitle: tab.title,
          nikaya: tab.nikaya,
          chapterIdx: targetChap,
          chapterTitle: tab.chapters?.[targetChap]?.title || '',
        });
      }
    },
    [updateUrlParams, persistTabs, addToHistory, setActiveParaNum, loadChapter, bufferAdjacentChapters]
  );


  const snapshotPaneScroll = useCallback((bookCode) => {
    if (!bookCode || bookCode === 'ai_chat' || typeof document === 'undefined') return null;
    const isWin = document.body?.classList?.contains('window-scroll');
    let curScroll = null;
    if (isWin && activeBookCodeRef.current === bookCode && typeof window !== 'undefined') {
      curScroll = window.scrollY || document.documentElement?.scrollTop || 0;
    } else {
      const container = getActiveContentArea(bookCode);
      if (container && container.offsetParent !== null) {
        curScroll = container.scrollTop;
      }
    }
    if (curScroll !== null && (curScroll > 0 || tabScrollMemoryRef.current[bookCode] === undefined)) {
      tabScrollMemoryRef.current[bookCode] = curScroll;
      try {
        localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
      } catch (e) {}
    }
    return curScroll;
  }, []);

  const emitLayoutShiftBeforeChange = useCallback((source) => {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      window.dispatchEvent(
        new CustomEvent('tipitaka:before-layout-shift', {
          detail: { source, shiftsLayout: true },
        })
      );
    }
  }, []);

  const closeTab = useCallback(
    (bookCode, e) => {
      if (e) e.stopPropagation();

      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx === -1) return;

      const remainingBookTabs = currentTabs.filter(
        (t) => t.bookCode !== bookCode && t.type !== 'ai_chat' && t.bookCode !== 'ai_chat'
      );
      if (remainingBookTabs.length === 1 && currentTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat').length > 1) {
        snapshotPaneScroll(remainingBookTabs[0].bookCode);
        emitLayoutShiftBeforeChange('close-tab');
      }

      delete tabScriptPrefixRef.current[bookCode];
      delete tabTransRouteLangRef.current[bookCode];

      const newTabs = currentTabs.filter((t) => t.bookCode !== bookCode);
      setOpenTabs(newTabs);

      if (activeBookCodeRef.current === bookCode) {
        if (newTabs.length > 0) {
          const nextIdx = Math.min(idx, newTabs.length - 1);
          const nextTab = newTabs[nextIdx];
          setActiveBookCode(nextTab.bookCode);
          const isAi = nextTab.type === 'ai_chat' || nextTab.bookCode === 'ai_chat';
          const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
          if (isAi) {
            setTreeSelectedNode(null);
            setSearchHighlight(null);
            updateUrlParams({ book: 'ai_chat' });
          } else if (isToc) {
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
        }
      } else {
        persistTabs(newTabs, activeBookCodeRef.current);
      }
    },
    [updateUrlParams, persistTabs, setActiveParaNum, setIsSidebarOpen, snapshotPaneScroll, emitLayoutShiftBeforeChange]
  );

  // Close other tabs except bookCode
  const closeOtherTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const targetTab = currentTabs.find((t) => t.bookCode === bookCode);
      if (!targetTab) return;

      if (currentTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat').length > 1) {
        snapshotPaneScroll(bookCode);
        emitLayoutShiftBeforeChange('close-other-tabs');
      }

      const newTabs = [targetTab];
      // Drop script-prefix & translation-route entries for every tab that is being closed
      for (const t of currentTabs) {
        if (t.bookCode !== bookCode) {
          delete tabScriptPrefixRef.current[t.bookCode];
          delete tabTransRouteLangRef.current[t.bookCode];
        }
      }
      setOpenTabs(newTabs);
      const isAi = targetTab.type === 'ai_chat' || targetTab.bookCode === 'ai_chat';
      const isToc = targetTab.viewMode === 'toc' || targetTab.isTocView;
      if (isAi) {
        setTreeSelectedNode(null);
        setSearchHighlight(null);
        updateUrlParams({ book: 'ai_chat' });
      } else if (isToc) {
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
    [updateUrlParams, persistTabs, setActiveParaNum, snapshotPaneScroll, emitLayoutShiftBeforeChange]
  );

  // Close all tabs
  const closeAllTabs = useCallback(() => {
    tabScriptPrefixRef.current = {};
    tabTransRouteLangRef.current = {};
    setOpenTabs([]);
    setActiveBookCode(null);
    setTreeSelectedNode(null);
    updateUrlParams({ book: null, chapter: null, q: null, search: null });
    persistTabs([], null);
    setIsSidebarOpen(false);
  }, [updateUrlParams, persistTabs, setIsSidebarOpen]);

  // Close tabs to the left of bookCode
  const closeLeftTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx <= 0) return;
      for (let i = 0; i < idx; i++) {
        delete tabScriptPrefixRef.current[currentTabs[i].bookCode];
        delete tabTransRouteLangRef.current[currentTabs[i].bookCode];
      }

      const newTabs = currentTabs.slice(idx);
      const remainingBooks = newTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat');
      if (remainingBooks.length === 1 && currentTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat').length > 1) {
        snapshotPaneScroll(remainingBooks[0].bookCode);
        emitLayoutShiftBeforeChange('close-left-tabs');
      }
      setOpenTabs(newTabs);

      const activeCode = activeBookCodeRef.current;
      const activeStillPresent = newTabs.some((t) => t.bookCode === activeCode);

      if (!activeStillPresent) {
        const nextTab = newTabs[0];
        setActiveBookCode(nextTab.bookCode);
        const isAi = nextTab.type === 'ai_chat' || nextTab.bookCode === 'ai_chat';
        const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
        if (isAi) {
          setTreeSelectedNode(null);
          setSearchHighlight(null);
          updateUrlParams({ book: 'ai_chat' });
        } else if (isToc) {
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
    [updateUrlParams, persistTabs, setActiveParaNum, snapshotPaneScroll, emitLayoutShiftBeforeChange]
  );

  // Close tabs to the right of bookCode
  const closeRightTabs = useCallback(
    (bookCode) => {
      const currentTabs = openTabsRef.current;
      const idx = currentTabs.findIndex((t) => t.bookCode === bookCode);
      if (idx === -1 || idx >= currentTabs.length - 1) return;
      for (let i = idx + 1; i < currentTabs.length; i++) {
        delete tabScriptPrefixRef.current[currentTabs[i].bookCode];
        delete tabTransRouteLangRef.current[currentTabs[i].bookCode];
      }

      const newTabs = currentTabs.slice(0, idx + 1);
      const remainingBooks = newTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat');
      if (remainingBooks.length === 1 && currentTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat').length > 1) {
        snapshotPaneScroll(remainingBooks[0].bookCode);
        emitLayoutShiftBeforeChange('close-right-tabs');
      }
      setOpenTabs(newTabs);

      const activeCode = activeBookCodeRef.current;
      const activeStillPresent = newTabs.some((t) => t.bookCode === activeCode);

      if (!activeStillPresent) {
        const nextTab = newTabs[newTabs.length - 1];
        setActiveBookCode(nextTab.bookCode);
        const isAi = nextTab.type === 'ai_chat' || nextTab.bookCode === 'ai_chat';
        const isToc = nextTab.viewMode === 'toc' || nextTab.isTocView;
        if (isAi) {
          setTreeSelectedNode(null);
          setSearchHighlight(null);
          updateUrlParams({ book: 'ai_chat' });
        } else if (isToc) {
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
    [updateUrlParams, persistTabs, setActiveParaNum, snapshotPaneScroll, emitLayoutShiftBeforeChange]
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
      const currentTab = currentTabs.find((t) => t.bookCode === activeCode);
      const subKey = currentTab?.sub_book || currentTab?.chapter_to_sub_book?.[chapterIdx];
      const firstP = currentTab
        ? getFirstParaOfChapter(currentTab.para_to_chapter, chapterIdx, subKey, currentTab.sub_books_para_to_chapter)
        : null;

      const next = currentTabs.map((t) =>
        t.bookCode === activeCode
          ? {
              ...t,
              currentChapterIdx: chapterIdx,
              lastParaNum: firstP || undefined,
              viewMode: 'reader',
              isTocView: false,
            }
          : t
      );
      setOpenTabs(next);
      persistTabs(next, activeCode);

      if (currentTab) {
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
      setBookScrollIntent(activeCode, {
        chapterIdx,
        timestamp: Date.now(),
      });

      loadChapter(activeCode, chapterIdx);
      bufferAdjacentChapters(activeCode, chapterIdx);
      setSearchHighlight(null);
      updateUrlParams({ book: activeCode, chapter: chapterIdx + 1, q: null, search: null });
    },
    [updateUrlParams, persistTabs, loadChapter, bufferAdjacentChapters, addToHistory, setActiveParaNum, setBookScrollIntent]
  );

  const saveTabScroll = useCallback((bookCode, scrollTop) => {
    if (!bookCode) return;
    tabScrollMemoryRef.current[bookCode] = scrollTop;
    if (scrollPersistTimerRef.current) {
      clearTimeout(scrollPersistTimerRef.current);
    }
    scrollPersistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.SCROLL, JSON.stringify(tabScrollMemoryRef.current));
      } catch (e) {}
    }, 250);
  }, []);

  const getSavedScroll = useCallback((bookCode) => {
    return tabScrollMemoryRef.current[bookCode] || 0;
  }, []);

  const clearTargetScrollIntent = useCallback((bookCode = null) => {
    const code = typeof bookCode === 'string' && bookCode ? bookCode : activeBookCodeRef.current;
    setBookScrollIntent(code, null);
    if (!bookCode || bookCode === activeBookCodeRef.current) {
      setTargetScrollIntent(null);
    }
  }, [setBookScrollIntent]);

  // Activate a visible column pane without resetting or fighting its scroll position
  const activatePane = useCallback(
    (bookCode) => {
      if (!bookCode || bookCode === activeBookCodeRef.current) return;
      const outgoingCode = activeBookCodeRef.current;
      if (outgoingCode) {
        snapshotPaneScroll(outgoingCode);
      }
      setActiveBookCode(bookCode);
      const tab = openTabsRef.current.find((t) => t.bookCode === bookCode);
      if (tab) {
        const targetChap = tab.currentChapterIdx ?? 0;
        if (tab.lastParaNum) {
          setActiveParaNum(tab.lastParaNum);
        }
        setTreeSelectedNode({
          bookCode: tab.bookCode,
          chapterIdx: tab.viewMode === 'toc' || tab.isTocView ? null : targetChap,
        });
        const hashToApply = tab.lastParaNum ? `#para${tab.lastParaNum}` : '';
        updateUrlParams({
          book: tab.bookCode,
          chapter: tab.viewMode === 'toc' || tab.isTocView ? null : targetChap + 1,
          hash: hashToApply,
        });
        persistTabs(openTabsRef.current, tab.bookCode);
      }
    },
    [updateUrlParams, persistTabs, snapshotPaneScroll]
  );

  // Open a text (Mūla / Aṭṭhakathā / Ṭīkā) alongside the current tab:
  // On wide screens (>= 900px) opens in side-by-side columns view; on narrow screens opens in a tab.
  const openAlongside = useCallback(
    (bookCode, options = {}) => {
      if (!bookCode) return;
      const isWide = typeof window !== 'undefined' && window.innerWidth >= 900;
      const fromCode = options.sourceBookCode || activeBookCodeRef.current;
      const cleanTarget = splitScriptCode(bookCode.replace('.xml', '')).bookCode.replace(
        /^(.*?\.(?:mul|att|tik|nrf))\d+$/i,
        '$1'
      );
      const existingTarget = openTabsRef.current.find((t) => t.bookCode === cleanTarget);
      const hasAnyTarget =
        (options.targetChapterIdx !== undefined && options.targetChapterIdx !== null) ||
        Boolean(options.targetParaNum) ||
        (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') ||
        Boolean(options.targetPage) ||
        /\.(?:mul|att|tik|nrf)\d+$/i.test(bookCode.replace('.xml', ''));
      const fallbackChapIdx =
        !hasAnyTarget && !options.isTocView
          ? existingTarget?.currentChapterIdx ?? 0
          : options.targetChapterIdx;

      if (fromCode) {
        snapshotPaneScroll(fromCode);
      }
      if (activeBookCodeRef.current && activeBookCodeRef.current !== fromCode) {
        snapshotPaneScroll(activeBookCodeRef.current);
      }
      if (isWide) {
        emitLayoutShiftBeforeChange('open-alongside');
        if (settingsRef.current?.tabView !== 'columns') {
          updateSetting('tabView', 'columns');
        }
      } else if (settingsRef.current?.tabView === 'single') {
        updateSetting('tabView', 'tabbed');
      }
      return openBook(bookCode, {
        ...options,
        targetChapterIdx: fallbackChapIdx,
        alongside: true,
        newTab: true,
        sourceBookCode: fromCode,
        keepActive: isWide && Boolean(fromCode && fromCode !== cleanTarget),
      });
    },
    [openBook, updateSetting, snapshotPaneScroll, emitLayoutShiftBeforeChange]
  );

  // When switching tabView to 'single', keep only the active tab
  useEffect(() => {
    if (settings?.tabView === 'single' && openTabsRef.current.length > 1 && activeBookCodeRef.current) {
      closeOtherTabs(activeBookCodeRef.current);
    }
  }, [settings?.tabView, closeOtherTabs]);

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

  const setIsTreePinned = useCallback((nextValue) => {
    const resolved =
      typeof nextValue === 'function' ? Boolean(nextValue(isTreePinnedRef.current)) : Boolean(nextValue);
    const shiftsLayout = typeof window !== 'undefined' ? Boolean(window.innerWidth >= 768) : true;
    if (typeof window !== 'undefined' && isSidebarOpenRef.current) {
      window.dispatchEvent(
        new CustomEvent('tipitaka:before-layout-shift', { detail: { source: 'sidebar-pin', shiftsLayout } })
      );
    }
    isTreePinnedRef.current = resolved;
    setIsTreePinnedState(resolved);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(TREE_PINNED_STORAGE_KEY, String(resolved));
      } catch (_) {}
      window.dispatchEvent(
        new CustomEvent('tipitaka:layout-shift-resize', { detail: { source: 'sidebar-pin', shiftsLayout } })
      );
    }
  }, []);

  const toggleTreePinned = useCallback(() => {
    setIsTreePinned((prev) => !prev);
  }, [setIsTreePinned]);

  const toggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tipitaka:before-layout-shift', {
        detail: { source: 'sidebar', shiftsLayout: Boolean(isTreePinnedRef.current && window.innerWidth >= 768) },
      }));
    }
    const next = !isSidebarOpenRef.current;
    isSidebarOpenRef.current = next;
    setIsSidebarOpenRaw(next);
    if (next) {
      setIsHeaderVisible(true);
    }
  }, [setIsHeaderVisible]);

  const hydrateSessionTab = useCallback(
    (tab) => {
      if (!tab || tab.type === 'ai_chat' || tab.bookCode === 'ai_chat' || !tab.needsHydration) return;
      const cleanCode = tab.bookCode;
      if (hydratingBooksRef.current.has(cleanCode)) return;
      hydratingBooksRef.current.add(cleanCode);

      if (tab.isTocView || tab.viewMode === 'toc') {
        setOpenTabs((prev) =>
          prev.map((t) => (t.bookCode === cleanCode ? { ...t, isLoading: true } : t))
        );
        fetchBookTocOnly(cleanCode)
          .then((bData) => {
            if (!bData) return;
            setOpenTabs((prev) =>
              prev.map((t) =>
                t.bookCode === cleanCode
                  ? {
                      ...t,
                      title: bData.title || t.title,
                      nikaya: bData.nikaya || bData.category || t.nikaya,
                      category: bData.category || t.category,
                      chapter_count: bData.chapter_count || (bData.chapters ? bData.chapters.length : 1),
                      chapters: bData.chapters || [],
                      toc: bData.toc || [],
                      mat: bData.mat || t.mat,
                      split_targets: bData.split_targets || bData.mat?.split_targets || t.split_targets || null,
                      book_type: bData.book_type || t.book_type || 'Whole',
                      isLoading: false,
                      needsHydration: false,
                    }
                  : t
              )
            );
          })
          .catch(() => {
            setOpenTabs((prev) =>
              prev.map((t) => (t.bookCode === cleanCode ? { ...t, isLoading: false, needsHydration: false } : t))
            );
          })
          .finally(() => {
            hydratingBooksRef.current.delete(cleanCode);
          });
        return;
      }

      const targetChap = tab.currentChapterIdx ?? 0;
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.bookCode === cleanCode
            ? { ...t, isLoading: true, loadingChapters: { ...t.loadingChapters, [targetChap]: true } }
            : t
        )
      );

      fetchBook(cleanCode, { chapter: targetChap, buffer: 1 })
        .then(async (bData) => {
          if (!bData) return;
          const nextChaptersData = { ...(bData.chapters_data || {}) };
          if (!nextChaptersData[targetChap]) {
            try {
              const chRes = await fetchChapter(cleanCode, targetChap);
              if (chRes && chRes.html) nextChaptersData[targetChap] = chRes.html;
            } catch (_) {}
          }
          prefetchOpenBookAdjacentBundles({
            bookCode: cleanCode,
            targetChapIdx: targetChap,
            chaptersData: nextChaptersData,
            settingsObj: settingsRef.current,
          });
          setOpenTabs((prev) =>
            prev.map((t) =>
              t.bookCode === cleanCode
                ? {
                    ...t,
                    title: bData.title || t.title,
                    nikaya: bData.nikaya || bData.category || t.nikaya,
                    category: bData.category || t.category,
                    chapter_count: bData.chapter_count || (bData.chapters ? bData.chapters.length : 1),
                    chapters: bData.chapters || [],
                    toc: bData.toc || [],
                    mat: bData.mat || t.mat,
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
                    split_targets: bData.split_targets || bData.mat?.split_targets || t.split_targets || null,
                    chapter_to_mat: bData.chapter_to_mat || t.chapter_to_mat || null,
                    para_to_mat: bData.para_to_mat || t.para_to_mat || null,
                    sub_books_para_to_mat: bData.sub_books_para_to_mat || t.sub_books_para_to_mat || null,
                    mula_chapter: bData.mula_chapter !== undefined ? bData.mula_chapter : (bData.mat?.mula_chapter ?? t.mula_chapter),
                    mula_chapter_offset: bData.mula_chapter_offset !== undefined ? bData.mula_chapter_offset : (bData.mat?.mula_chapter_offset ?? t.mula_chapter_offset),
                    attha_chapter_offset: bData.attha_chapter_offset !== undefined ? bData.attha_chapter_offset : (bData.mat?.attha_chapter_offset ?? t.attha_chapter_offset),
                    loadedChapters: { ...(t.loadedChapters || {}), ...nextChaptersData },
                    loadingChapters: { ...(t.loadingChapters || {}), [targetChap]: false },
                    isLoading: false,
                    needsHydration: false,
                  }
                : t
            )
          );
          bufferAdjacentChapters(cleanCode, targetChap);
        })
        .catch(() => {
          setOpenTabs((prev) =>
            prev.map((t) =>
              t.bookCode === cleanCode ? { ...t, isLoading: false, needsHydration: false } : t
            )
          );
        })
        .finally(() => {
          hydratingBooksRef.current.delete(cleanCode);
        });
    },
    [bufferAdjacentChapters]
  );

  // Sync URL for restored initial session & flush persistence on lifecycle events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.__tpoFlushSession = flushSessionPersistence;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSessionPersistence();
      }
    };
    const handlePageHide = () => {
      flushSessionPersistence();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    if (restoredSessionRef.current && !hasDeepLinkInLocation()) {
      const currentTabs = openTabsRef.current;
      const activeCode = activeBookCodeRef.current;
      const activeTabObj = currentTabs.find((t) => t.bookCode === activeCode);
      if (activeTabObj) {
        if (activeTabObj.type === 'ai_chat' || activeTabObj.bookCode === 'ai_chat') {
          updateUrlParams({ book: 'ai_chat' });
        } else if (activeTabObj.isTocView || activeTabObj.viewMode === 'toc') {
          updateUrlParams({ book: activeTabObj.bookCode, chapter: null, q: null, search: null });
        } else {
          const hashStr = activeTabObj.lastParaNum ? `#para${activeTabObj.lastParaNum}` : undefined;
          updateUrlParams({
            book: activeTabObj.bookCode,
            chapter: (activeTabObj.currentChapterIdx ?? 0) + 1,
            hash: hashStr,
            q: null,
            search: null,
          });
        }
      }
    }

    return () => {
      flushSessionPersistence();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      if (window.__tpoFlushSession === flushSessionPersistence) {
        delete window.__tpoFlushSession;
      }
    };
  }, [flushSessionPersistence, updateUrlParams]);

  // Reactively hydrate active tab and any visible columns with needsHydration=true
  useEffect(() => {
    if (typeof window === 'undefined' || openTabs.length === 0) return;

    const bookTabs = openTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat');
    const vw = window.innerWidth || 1280;
    const isAiActive = activeBookCode === 'ai_chat';
    const isColumnsMode = settings?.tabView === 'columns' && vw >= 900 && bookTabs.length > 1 && !isAiActive;

    const toHydrate = [];
    if (isColumnsMode) {
      const maxCols = vw >= 1440 ? 4 : vw >= 1100 ? 3 : 2;
      if (bookTabs.length <= maxCols) {
        toHydrate.push(...bookTabs);
      } else {
        const activeIdx = Math.max(0, bookTabs.findIndex((t) => t.bookCode === activeBookCode));
        let start = maxCols === 2 ? activeIdx : Math.max(0, activeIdx - Math.floor((maxCols - 1) / 2));
        if (start + maxCols > bookTabs.length) {
          start = Math.max(0, bookTabs.length - maxCols);
        }
        toHydrate.push(...bookTabs.slice(start, start + maxCols));
      }
    } else if (activeBookCode) {
      const active = openTabs.find((t) => t.bookCode === activeBookCode);
      if (active) toHydrate.push(active);
    }

    for (const tab of toHydrate) {
      if (tab?.needsHydration && !tab.isLoading) {
        hydrateSessionTab(tab);
      }
    }
  }, [openTabs, activeBookCode, settings?.tabView, hydrateSessionTab]);

  const activeTab = openTabs.find((t) => t.bookCode === activeBookCode) || null;

  // Auto-fetch MAT if missing on open tabs or ensure split_targets populated
  useEffect(() => {
    const tabsToCheck = settings?.tabView === 'columns' ? openTabs : (activeTab ? [activeTab] : []);
    for (const tabItem of tabsToCheck) {
      if (!tabItem || tabItem.bookCode === 'ai_chat' || tabItem.type === 'ai_chat') continue;
      if (!tabItem.mat || (!tabItem.split_targets && tabItem.mat?.split_targets)) {
        if (!tabItem.mat) {
          fetchMat(tabItem.bookCode).then((mat) => {
            if (mat) {
              setOpenTabs((prev) =>
                prev.map((t) => (t.bookCode === tabItem.bookCode ? {
                  ...t,
                  mat,
                  split_targets: mat.split_targets || t.split_targets || null,
                  mula_chapter: mat.mula_chapter !== undefined ? mat.mula_chapter : t.mula_chapter,
                  mula_chapter_offset: mat.mula_chapter_offset !== undefined ? mat.mula_chapter_offset : t.mula_chapter_offset,
                  attha_chapter_offset: mat.attha_chapter_offset !== undefined ? mat.attha_chapter_offset : t.attha_chapter_offset,
                } : t))
              );
            }
          });
        } else if (!tabItem.split_targets && tabItem.mat?.split_targets) {
          setOpenTabs((prev) =>
            prev.map((t) => (t.bookCode === tabItem.bookCode ? {
              ...t,
              split_targets: t.mat.split_targets,
              mula_chapter: t.mat.mula_chapter !== undefined ? t.mat.mula_chapter : t.mula_chapter,
              mula_chapter_offset: t.mat.mula_chapter_offset !== undefined ? t.mat.mula_chapter_offset : t.mula_chapter_offset,
              attha_chapter_offset: t.mat.attha_chapter_offset !== undefined ? t.mat.attha_chapter_offset : t.attha_chapter_offset,
            } : t))
          );
        }
      }
    }
  }, [activeTab, openTabs, settings?.tabView]);

  // Jump MAT (Mūla · Aṭṭhakathā · Ṭīkā) handler
  const jumpToMat = useCallback(
    async (targetLayer, options = {}) => {
      const sourceTab =
        (options.sourceBookCode && openTabsRef.current.find((t) => t.bookCode === options.sourceBookCode)) ||
        activeTab;
      if (!sourceTab) return;

      if (sourceTab.bookCode) {
        snapshotPaneScroll(sourceTab.bookCode);
      }

      let mat = sourceTab.mat;
      if (!mat) {
        try {
          mat = await fetchMat(sourceTab.bookCode);
        } catch (e) {}
      }

      let targetCode = options.code || null;
      let targetTitle = options.title || null;
      let targetChapter = options.chapter !== undefined ? options.chapter : undefined;
      let targetSubBook = options.subBook || null;

      let currentPNum = options.targetParaNum || options.sourceParaNum || (sourceTab.bookCode === activeBookCodeRef.current ? activeParaNum : sourceTab.lastParaNum);
      if (!currentPNum && typeof window !== 'undefined' && window.location.hash && sourceTab.bookCode === activeBookCodeRef.current) {
        const hashMatch = window.location.hash.match(/^(?:#para-?|#p)?(\d+(?:-\d+)?)/i);
        if (hashMatch) currentPNum = hashMatch[1];
      }
      if (!currentPNum && typeof document !== 'undefined') {
        const cEl = getActiveContentArea(sourceTab.bookCode);
        if (cEl) {
          const pEl = cEl.querySelector('[data-para]');
          if (pEl) currentPNum = pEl.getAttribute('data-para');
        }
      }
      const cleanP = String(currentPNum || '').replace(/^(?:para-?|p)/i, '').trim();

      let currentChapIdx =
        options.sourceChapterIdx !== undefined && options.sourceChapterIdx !== null
          ? options.sourceChapterIdx
          : sourceTab.currentChapterIdx !== undefined && sourceTab.currentChapterIdx !== null
          ? sourceTab.currentChapterIdx
          : 0;
      if (cleanP && sourceTab.para_to_chapter?.[cleanP] !== undefined) {
        currentChapIdx = sourceTab.para_to_chapter[cleanP];
      } else if (typeof window !== 'undefined' && sourceTab.bookCode === activeBookCodeRef.current) {
        const m = window.location.pathname.match(/\/book\/[^/]+\/(\d+)/i);
        if (m) currentChapIdx = Math.max(0, parseInt(m[1], 10) - 1);
      }

      let activeSubKey = sourceTab?.sub_book || sourceTab?.chapter_to_sub_book?.[currentChapIdx];
      if (!activeSubKey && sourceTab?.sub_books) {
        for (const [k, v] of Object.entries(sourceTab.sub_books)) {
          const cr = v.chapter_range || v.tika_chapter_range;
          if (cr && currentChapIdx >= cr[0] && currentChapIdx <= cr[1]) {
            activeSubKey = k;
            break;
          }
        }
      }

      // 0. High-Priority Precomputed Canonical Mapping (Authoritative Database Ground Truth)
      let precomputedTarget = (cleanP && activeSubKey && sourceTab.sub_books_para_to_mat?.[activeSubKey]?.[cleanP]?.[targetLayer])
        || (cleanP && sourceTab.para_to_mat?.[cleanP]?.[targetLayer])
        || sourceTab.chapter_to_mat?.[currentChapIdx]?.[targetLayer]
        || sourceTab.chapter_to_mat?.[String(currentChapIdx)]?.[targetLayer];

      if (!precomputedTarget && typeof window !== 'undefined') {
        try {
          const jumpData = await fetchMatJump(sourceTab.bookCode, cleanP, currentChapIdx);
          if (jumpData?.[targetLayer]?.book) {
            precomputedTarget = jumpData[targetLayer];
          }
        } catch (_) {}
      }

      if (options.code && (options.targetChapterIdx !== undefined || options.chapter !== undefined)) {
        targetCode = options.code;
        targetTitle = options.title || targetTitle;
        targetChapter = options.targetChapterIdx !== undefined ? options.targetChapterIdx : options.chapter;
        if (options.targetParaNum) currentPNum = options.targetParaNum;
      } else if (precomputedTarget?.book) {
        targetCode = precomputedTarget.book;
        targetTitle = precomputedTarget.title || options.title || targetTitle;
        targetChapter = precomputedTarget.chapter;
        if (precomputedTarget.para) currentPNum = precomputedTarget.para;
      }

      // 1. Multi-volume reverse jump: sourceTab has sub_books (e.g. s0402a.att, s0402t.tik, etc.)
      if (!targetCode && sourceTab.sub_books) {
        let subKey = sourceTab.chapter_to_sub_book?.[currentChapIdx];
        if (!subKey) {
          for (const [k, v] of Object.entries(sourceTab.sub_books)) {
            const cr = v.chapter_range || v.tika_chapter_range;
            if (cr && currentChapIdx >= cr[0] && currentChapIdx <= cr[1]) {
              subKey = k;
              break;
            }
          }
        }
        if (subKey && sourceTab.sub_books[subKey]) {
          const subInfo = sourceTab.sub_books[subKey];
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
      } else if (sourceTab.sub_book || options.subBook) {
        // 2. Single-volume forward jump: sourceTab belongs to a multi-volume commentary (e.g. s0402m2.mul)
        targetSubBook = options.subBook || sourceTab.sub_book;
        if (options.chapter !== undefined) {
          targetChapter = options.chapter;
        } else if (targetLayer === 'attha') {
          const offset = sourceTab.attha_start_chapter !== undefined && sourceTab.attha_start_chapter !== null
            ? sourceTab.attha_start_chapter
            : (mat?.attha_start_chapter || 0);
          targetChapter = offset + currentChapIdx;
        } else if (targetLayer === 'tika') {
          const offset = sourceTab.tika_start_chapter !== undefined && activeTab?.tika_start_chapter !== null
            ? sourceTab.tika_start_chapter
            : (mat?.tika_start_chapter || 0);
          targetChapter = offset + currentChapIdx;
        }
      }

      // 3. One-to-Many dynamic routing using split_targets (e.g. s0508, s0513, s0514, vin01)
      const splitTargets = sourceTab.split_targets || mat?.split_targets;
      if (splitTargets && splitTargets[targetLayer]) {
        const layerTargets = splitTargets[targetLayer];
        if (Array.isArray(layerTargets)) {
          let currentPInt = parseInt(cleanP, 10);

          let effectiveChapIdx = currentChapIdx;
          let subKeyForChap = sourceTab?.chapter_to_sub_book?.[currentChapIdx] || sourceTab?.chapter_to_sub_book?.[String(currentChapIdx)];
          if (!subKeyForChap && sourceTab?.sub_books) {
            for (const [k, v] of Object.entries(sourceTab.sub_books)) {
              const cr = v.chapter_range || v.tika_chapter_range;
              if (cr && currentChapIdx >= cr[0] && currentChapIdx <= cr[1]) {
                subKeyForChap = k;
                break;
              }
            }
          }

          if (cleanP) {
            let pChap = undefined;
            if (subKeyForChap && sourceTab.sub_books_para_to_chapter?.[subKeyForChap]) {
              pChap = sourceTab.sub_books_para_to_chapter[subKeyForChap][cleanP];
            } else if (sourceTab.para_to_chapter) {
              pChap = sourceTab.para_to_chapter[cleanP];
            }

            if (pChap !== undefined && pChap === currentChapIdx) {
              effectiveChapIdx = currentChapIdx;
            } else if (pChap !== undefined && pChap !== currentChapIdx) {
              const hasExplicitHash = typeof window !== 'undefined' && window.location.hash && window.location.hash.includes(cleanP);
              const hasExplicitPathChapter = typeof window !== 'undefined' && Boolean(window.location.pathname.match(/\/book\/[^/]+\/(\d+)/i));
              if (hasExplicitHash && !subKeyForChap && !hasExplicitPathChapter) {
                effectiveChapIdx = pChap;
              } else if (pChap === undefined) {
                currentPInt = NaN;
              }
            }
          }

          let matchedRule = null;
          for (const rule of layerTargets) {
            const inChap = rule.chapter_range && effectiveChapIdx >= rule.chapter_range[0] && effectiveChapIdx <= rule.chapter_range[1];
            let inPara = true;
            if (rule.para_range) {
              inPara = !isNaN(currentPInt) && currentPInt >= rule.para_range[0] && currentPInt <= rule.para_range[1];
            }
            if (inChap && inPara) {
              matchedRule = rule;
              break;
            }
          }

          if (matchedRule) {
            targetCode = options.code || matchedRule.code || targetCode;
            targetTitle = options.title || matchedRule.title || targetTitle;
            if (options.chapter !== undefined) {
              targetChapter = options.chapter;
            } else if (matchedRule.target_chapter !== undefined) {
              targetChapter = matchedRule.target_chapter;
            } else if (matchedRule.target_chapter_offset !== undefined) {
              targetChapter = Math.max(0, effectiveChapIdx + matchedRule.target_chapter_offset);
            }
          }
        }
      }

      // 4. Reverse offsets for split volumes
      if (targetLayer === 'mula' && targetChapter === undefined) {
        if (sourceTab.mula_chapter !== undefined && sourceTab.mula_chapter !== null) {
          targetChapter = sourceTab.mula_chapter;
        } else if (mat?.mula_chapter !== undefined && mat?.mula_chapter !== null) {
          targetChapter = mat.mula_chapter;
        } else if (sourceTab.mula_chapter_offset !== undefined && sourceTab.mula_chapter_offset !== null) {
          targetChapter = Math.max(0, currentChapIdx + sourceTab.mula_chapter_offset);
        } else if (mat?.mula_chapter_offset !== undefined && mat?.mula_chapter_offset !== null) {
          targetChapter = Math.max(0, currentChapIdx + mat.mula_chapter_offset);
        }
      } else if (targetLayer === 'attha' && targetChapter === undefined) {
        if (sourceTab.attha_chapter !== undefined && sourceTab.attha_chapter !== null) {
          targetChapter = sourceTab.attha_chapter;
        } else if (mat?.attha_chapter !== undefined && mat?.attha_chapter !== null) {
          targetChapter = mat.attha_chapter;
        } else if (sourceTab.attha_chapter_offset !== undefined && sourceTab.attha_chapter_offset !== null) {
          targetChapter = Math.max(0, currentChapIdx + sourceTab.attha_chapter_offset);
        } else if (mat?.attha_chapter_offset !== undefined && mat?.attha_chapter_offset !== null) {
          targetChapter = Math.max(0, currentChapIdx + mat.attha_chapter_offset);
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

      // Only fall back to filename heuristics if no MAT table metadata was resolved for this tab,
      // AND verify the synthesized candidate book actually exists in the tree catalog.
      const hasResolvedMatTable = Boolean(
        mat &&
          (mat.book_code !== undefined ||
            mat.mula_code !== undefined ||
            mat.attha_code !== undefined ||
            mat.tika_code !== undefined)
      );
      if (!targetCode && !hasResolvedMatTable) {
        const base = sourceTab.bookCode.split('.')[0];
        const prefix = (base.length > 2 && 'matn'.includes(base.slice(-2, -1)))
          ? base.slice(0, -2)
          : (base.length > 1 && 'matn'.includes(base.slice(-1)))
          ? base.slice(0, -1)
          : base;
        let candidate = null;
        if (targetLayer === 'mula') candidate = `${prefix}m.mul`;
        else if (targetLayer === 'attha') candidate = `${prefix}a.att`;
        else if (targetLayer === 'tika') candidate = `${prefix}t.tik`;
        if (candidate && lookupBookInfo(candidate)) {
          targetCode = candidate;
        }
      }

      if (!targetCode || targetCode === sourceTab.bookCode) return;

      // Extract current active paragraph number from state or DOM
      let currentPara = currentPNum || activeParaNum;
      if (!currentPara && typeof document !== 'undefined') {
        const container = getActiveContentArea(sourceTab.bookCode);
        if (container) {
          const visibleParaEl = container.querySelector('[data-para]');
          if (visibleParaEl) {
            currentPara = visibleParaEl.getAttribute('data-para');
          }
        }
      }

      const openOpts = {
        title: targetTitle || undefined,
        targetParaNum: currentPara || undefined,
        targetChapterIdx:
          targetChapter !== undefined ? targetChapter : !currentPara ? currentChapIdx ?? 0 : undefined,
        targetSubBook: targetSubBook || undefined,
        sourceBookCode: sourceTab.bookCode,
      };

      if (options.alongside || settingsRef.current?.tabView === 'columns') {
        openAlongside(targetCode, openOpts);
      } else {
        openBook(targetCode, openOpts);
      }
    },
    [activeTab, activeParaNum, openBook, openAlongside, snapshotPaneScroll]
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
        openAlongside,
        activatePane,
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
        tabScrollIntents,
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
        openAiChatTab,
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
        isTreePinned,
        setIsTreePinned,
        toggleTreePinned,
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
