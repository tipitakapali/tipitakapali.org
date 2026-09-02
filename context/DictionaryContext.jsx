'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { fetchDictionaryLookup, fetchDictionaryInflection, getFeedbackTemplateFromDb } from '../services/api';
import { convertAnyToRoman, cleanDictionaryQuery } from '../services/transliterate';
import { restoreMinifiedLinks } from '../services/dpdFeedback';

export const AVAILABLE_DICTIONARIES = [
  {
    id: 'dpd',
    label: 'Digital Pāḷi Dictionary (DPD)',
    shortLabel: 'DPD',
    badge: 'Primary',
    badgeClass: 'bg-[var(--accent-light)] text-[var(--accent)]',
    desc: 'Over 90,000+ entries with complete grammar, roots, case inflections and compounds.',
  },
  {
    id: 'abd',
    label: 'Tipiṭaka Pāḷi-Myanmar Dictionary',
    shortLabel: 'အဘိဓာန်',
    badge: 'Classic',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    desc: 'Tipiṭaka Pāḷi-Myanmar Dictionary',
  },
  {
    id: 'pts',
    label: "Pāḷi Text Society's PED (2015)",
    shortLabel: 'PTS',
    badge: 'Classic',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    desc: 'Authoritative Rhys Davids & Stede English definitions (corrected 2015 reprint).',
  },
  {
    id: 'psd',
    label: 'Pāḷi-Sinhala Dictionary (PSD)',
    shortLabel: 'පාලි-සිංහල',
    badge: 'Sinhala',
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    desc: 'Comprehensive Pāḷi to Sinhala dictionary definitions by Path Nirvana.',
  },
  {
    id: 'sans',
    label: 'Sanskrit Dictionaries',
    shortLabel: 'Sanskrit',
    badge: 'Comparative',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    desc: 'Comparative Sanskrit roots and definitions (Apte Practical, Monier-Williams, & Edgerton).',
  },
  {
    id: 'splitter',
    label: 'DPD Word Splitter / Deconstructor',
    shortLabel: 'Splitter',
    badge: 'Analysis',
    badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    desc: 'Automated compound word breakups and sandhi decomposition.',
  },
];

const STORAGE_KEYS = {
  DOCK_MODE: 'tipitaka_dict_dock_mode',
  FONT_SIZE: 'tipitaka_dict_font_size_multiplier',
  CLICK_LOOKUP: 'tipitaka_dict_click_lookup',
  CLICK_MODE: 'tipitaka_dict_click_mode',
  LAST_TAB: 'tipitaka_dict_last_tab',
  DICT_ORDER: 'tipitaka_dict_order_v2',
  DICT_ENABLED: 'tipitaka_dict_enabled',
};

export const DEFAULT_DICT_ORDER = ['dpd', 'abd', 'pts', 'psd', 'sans', 'splitter'];
export const DEFAULT_DICT_ENABLED = { dpd: true, abd: true, pts: true, psd: true, sans: true, splitter: true };

const DictionaryContext = createContext(null);

export function DictionaryProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [queryWord, setQueryWord] = useState('');
  const [displayWord, setDisplayWord] = useState('');
  const [dockMode, setDockModeState] = useState('side'); // 'modal' | 'left' | 'side' | 'right'
  const [fontSizeMultiplier, setFontSizeMultiplierState] = useState(1);
  const [clickToLookupEnabled, setClickToLookupState] = useState(true);
  const [clickLookupMode, setClickLookupModeState] = useState('single'); // 'single' | 'double'
  const [activeDictTab, setActiveDictTab] = useState('dpd');
  const [dictOrder, setDictOrderState] = useState(DEFAULT_DICT_ORDER);
  const [dictEnabled, setDictEnabledState] = useState(DEFAULT_DICT_ENABLED);

  // History navigation stack
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Lookup results state
  const [lookupData, setLookupData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState(null);

  const lookupSeqRef = useRef(0);
  const lookupAbortControllerRef = useRef(null);

  // Cache for loaded inflection tables: { [targetId]: htmlString }
  const [inflectionCache, setInflectionCache] = useState({});

  // Active expanded section target IDs (e.g. Set of targetIds like 'declension_buddha_1')
  const [expandedSections, setExpandedSections] = useState({});

  const [isMobileScreen, setIsMobileScreen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobileScreen(mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch dynamic DPD feedback template on first visit (payload ##tipitakapalidpdfeedback)
  useEffect(() => {
    getFeedbackTemplateFromDb();
  }, []);

  // Load user preferences from localStorage
  useEffect(() => {
    try {
      const savedDock = localStorage.getItem(STORAGE_KEYS.DOCK_MODE);
      if (savedDock && ['modal', 'left', 'side', 'right'].includes(savedDock)) {
        setDockModeState(savedDock);
      } else if (savedDock === 'top' || savedDock === 'bottom') {
        setDockModeState('side');
      } else if (!savedDock) {
        // No saved preference: apply responsive default (Right Dock on desktop, Center Modal on mobile)
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
        setDockModeState(isMobile ? 'modal' : 'side');
      }

      const savedFont = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
      if (savedFont) {
        const num = parseFloat(savedFont);
        if (!isNaN(num) && num >= 0.7 && num <= 1.8) {
          setFontSizeMultiplierState(num);
        }
      }
      const savedClick = localStorage.getItem(STORAGE_KEYS.CLICK_LOOKUP);
      if (savedClick !== null) {
        setClickToLookupState(savedClick === 'true');
      }
      const savedClickMode = localStorage.getItem(STORAGE_KEYS.CLICK_MODE);
      if (savedClickMode && ['single', 'double'].includes(savedClickMode)) {
        setClickLookupModeState(savedClickMode);
      }
      const savedTab = localStorage.getItem(STORAGE_KEYS.LAST_TAB);
      if (savedTab && ['dpd', 'abd', 'pts', 'psd', 'sans', 'splitter'].includes(savedTab)) {
        setActiveDictTab(savedTab);
      }
      const savedOrder = localStorage.getItem(STORAGE_KEYS.DICT_ORDER);
      if (savedOrder) {
        try {
          const parsed = JSON.parse(savedOrder);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const merged = [...parsed];
            for (const id of DEFAULT_DICT_ORDER) {
              if (!merged.includes(id)) merged.push(id);
            }
            setDictOrderState(merged);
          }
        } catch (e) {}
      }
      const savedEnabled = localStorage.getItem(STORAGE_KEYS.DICT_ENABLED);
      if (savedEnabled) {
        try {
          const parsed = JSON.parse(savedEnabled);
          if (parsed && typeof parsed === 'object') {
            setDictEnabledState((prev) => ({ ...prev, ...parsed }));
          }
        } catch (e) {}
      }
    } catch (e) {}
  }, []);

  const setDockMode = useCallback((mode) => {
    const validMode = ['left', 'modal', 'side', 'right'].includes(mode) ? mode : 'side';
    setDockModeState(validMode);
    try {
      localStorage.setItem(STORAGE_KEYS.DOCK_MODE, validMode);
    } catch (e) {}

    // Synchronize Navigation Sidebar to dock to the opposite side
    if (typeof window !== 'undefined') {
      if (validMode === 'left') {
        try {
          localStorage.setItem('tipitaka_tree_dock', 'right');
          window.dispatchEvent(new CustomEvent('tipitaka_tree_dock_change', { detail: 'right' }));
        } catch (e) {}
      } else if (validMode === 'side' || validMode === 'right') {
        try {
          localStorage.setItem('tipitaka_tree_dock', 'left');
          window.dispatchEvent(new CustomEvent('tipitaka_tree_dock_change', { detail: 'left' }));
        } catch (e) {}
      }
    }
  }, []);

  const setClickLookupMode = useCallback((mode) => {
    if (!['single', 'double'].includes(mode)) return;
    setClickLookupModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEYS.CLICK_MODE, mode);
    } catch (e) {}
  }, []);

  const setFontSizeMultiplier = useCallback((updater) => {
    setFontSizeMultiplierState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const clamped = Math.max(0.7, Math.min(1.8, parseFloat(next.toFixed(1))));
      try {
        localStorage.setItem(STORAGE_KEYS.FONT_SIZE, clamped.toString());
      } catch (e) {}
      return clamped;
    });
  }, []);

  const setClickToLookupEnabled = useCallback((enabled) => {
    setClickToLookupState(enabled);
    try {
      localStorage.setItem(STORAGE_KEYS.CLICK_LOOKUP, enabled.toString());
    } catch (e) {}
  }, []);

  const setDictTab = useCallback((tab) => {
    setActiveDictTab(tab);
    try {
      localStorage.setItem(STORAGE_KEYS.LAST_TAB, tab);
    } catch (e) {}
  }, []);

  const setDictOrder = useCallback((newOrder) => {
    if (!Array.isArray(newOrder)) return;
    setDictOrderState(newOrder);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(newOrder));
    } catch (e) {}
  }, []);

  const moveDictUp = useCallback((dictId) => {
    setDictOrderState((prev) => {
      const idx = prev.indexOf(dictId);
      if (idx <= 0) return prev;
      const next = [...prev];
      const temp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = temp;
      try {
        localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  const moveDictDown = useCallback((dictId) => {
    setDictOrderState((prev) => {
      const idx = prev.indexOf(dictId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      const temp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = temp;
      try {
        localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  const toggleDictEnabled = useCallback((dictId) => {
    setDictEnabledState((prev) => {
      const next = { ...prev, [dictId]: !prev[dictId] };
      try {
        localStorage.setItem(STORAGE_KEYS.DICT_ENABLED, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  const setDictEnabled = useCallback((updater) => {
    setDictEnabledState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      try {
        localStorage.setItem(STORAGE_KEYS.DICT_ENABLED, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // Two-Phase Progressive Dictionary Lookup:
  // Phase 1: Fetch DPD (primary) instantly → show results immediately
  // Phase 2: Fetch secondary dictionaries (PTS, ABD, PSD, SANS, Splitter) in background
  const performLookup = useCallback(async (wordToSearch, addToHistoryStack = true) => {
    if (!wordToSearch || !wordToSearch.trim()) return;

    // Preserve the exact raw user input for display (e.g. "''Evaṃ, bhante''ti" or "evaṁ")
    const rawDisplay = wordToSearch.trim();

    // Behind the scenes: clean quotes, attached enclitics, punctuation, and normalize ṁ -> ṃ
    const sanitizedInput = cleanDictionaryQuery(rawDisplay);
    if (!sanitizedInput) return;

    const romanWord = convertAnyToRoman(sanitizedInput).trim().toLowerCase();
    const cleanWord = (romanWord || sanitizedInput.trim().toLowerCase()).replace(/ṁ/g, 'ṃ');

    const currentSeq = ++lookupSeqRef.current;
    lookupAbortControllerRef.current?.abort();
    lookupAbortControllerRef.current = new AbortController();
    const signal = lookupAbortControllerRef.current.signal;

    setQueryWord(cleanWord);
    setDisplayWord(rawDisplay);
    setIsLoading(true);
    setIsBackgroundLoading(false);
    setError(null);

    // Update history stack
    if (addToHistoryStack) {
      setHistory((prev) => {
        const nextStack = [...prev.slice(0, historyIndex + 1), rawDisplay];
        setHistoryIndex(nextStack.length - 1);
        return nextStack;
      });
    }

    try {
      // ── Parallel-Progressive: fire DPD + others together, render DPD instantly ──
      const dpdPromise = fetchDictionaryLookup(cleanWord, 'dpd', { signal });
      const othersPromise = fetchDictionaryLookup(cleanWord, 'others', { signal });
      setIsBackgroundLoading(true);

      // Phase 1: DPD resolves first → paint immediately (no extra RTT)
      const dpdData = await dpdPromise;
      if (currentSeq !== lookupSeqRef.current || signal.aborted) return;

      const dpdCount = dpdData?.counts?.dpd || dpdData?.dpd?.length || 0;

      // Restore minified links and DPD feedback placeholders
      const processedDpd = (dpdData?.dpd || []).map((entry) => {
        if (entry && typeof entry === 'object') {
          return {
            ...entry,
            html: entry.html ? restoreMinifiedLinks(entry.html) : '',
            defi: entry.defi ? restoreMinifiedLinks(entry.defi) : '',
          };
        }
        return entry;
      });

      // Show DPD results immediately (user sees results in ~30-80ms, others fetch already in-flight)
      const immediateLookup = {
        word: cleanWord,
        hasResults: dpdCount > 0,
        synonyms: dpdData?.synonyms || [],
        counts: { dpd: dpdCount, pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
        dpd: processedDpd,
        pts: [],
        abd: [],
        psd: [],
        sans: [],
        splitter: [],
      };

      // Tab selection for Phase 1
      const activeOrder = (dictOrder || DEFAULT_DICT_ORDER).filter(
        (id) => dictEnabled?.[id] !== false
      );
      const currentTabKey = activeDictTab;

      setLookupData(immediateLookup);
      setIsLoading(false);

      // If current tab is DPD and has results, stay. Otherwise auto-select DPD if it has results.
      if (dpdCount > 0 && currentTabKey !== 'dpd' && (immediateLookup.counts?.[currentTabKey] || 0) === 0) {
        if (activeOrder.includes('dpd')) {
          setActiveDictTab('dpd');
        }
      }

      // ── Phase 2: Secondary dictionaries (already in-flight via parallel Promise) ──
      const othersData = await othersPromise;
      if (currentSeq !== lookupSeqRef.current || signal.aborted) return;

      const ptsCount = othersData?.counts?.pts || othersData?.pts?.length || 0;
      const abdCount = othersData?.counts?.abd || othersData?.abd?.length || 0;
      const psdCount = othersData?.counts?.psd || othersData?.psd?.length || 0;
      const sansCount = othersData?.counts?.sans || othersData?.sans?.length || 0;
      const splitterCount = othersData?.counts?.splitter || othersData?.splitter?.length || 0;
      const othersHasAny = ptsCount > 0 || abdCount > 0 || psdCount > 0 || sansCount > 0 || splitterCount > 0;

      // Merge secondary results into existing lookup data
      setLookupData((prev) => {
        const merged = {
          ...prev,
          hasResults: prev.hasResults || othersHasAny,
          counts: {
            ...prev.counts,
            pts: ptsCount,
            abd: abdCount,
            psd: psdCount,
            sans: sansCount,
            splitter: splitterCount,
          },
          pts: othersData?.pts || [],
          abd: othersData?.abd || [],
          psd: othersData?.psd || [],
          sans: othersData?.sans || [],
          splitter: othersData?.splitter || [],
        };

        return merged;
      });

      // If DPD had no results but a secondary dict does, auto-switch tab
      if (dpdCount === 0 && othersHasAny) {
        for (const t of activeOrder) {
          if (t === 'dpd') continue;
          const cnt = { pts: ptsCount, abd: abdCount, psd: psdCount, sans: sansCount, splitter: splitterCount }[t] || 0;
          if (cnt > 0) {
            setActiveDictTab(t);
            break;
          }
        }
      }

      setIsBackgroundLoading(false);
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || signal.aborted || currentSeq !== lookupSeqRef.current) return;
      console.warn('Dictionary lookup error:', err);
      setError(err.message || 'Dictionary lookup failed');
      setIsLoading(false);
      setIsBackgroundLoading(false);
    }
  }, [historyIndex, dictOrder, dictEnabled, activeDictTab]);

  // Open dictionary with word (or just open)
  const openDictionary = useCallback((word = '', initialTab = null) => {
    setIsOpen(true);
    if (initialTab) {
      setDictTab(initialTab);
    }
    if (word && word.trim()) {
      performLookup(word.trim(), true);
    }
  }, [performLookup, setDictTab]);

  const closeDictionary = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Global keyboard shortcut ('d' or 'D' when reading, Esc to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        return;
      }
      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selection = window.getSelection()?.toString()?.trim();
        if (selection && selection.length > 0 && selection.length < 50) {
          openDictionary(selection);
        } else {
          openDictionary();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, openDictionary]);

  // History navigation
  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const targetIdx = historyIndex - 1;
      setHistoryIndex(targetIdx);
      const targetWord = history[targetIdx];
      performLookup(targetWord, false);
    }
  }, [history, historyIndex, performLookup]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const targetIdx = historyIndex + 1;
      setHistoryIndex(targetIdx);
      const targetWord = history[targetIdx];
      performLookup(targetWord, false);
    }
  }, [history, historyIndex, performLookup]);

  // Dynamic Inflection Table loader (declension & conjugation buttons)
  const toggleInflection = useCallback(async (targetId, lemma) => {
    setExpandedSections((prev) => {
      const isCurrentlyOpen = !!prev[targetId];
      return { ...prev, [targetId]: !isCurrentlyOpen };
    });

    // If not cached yet, fetch from server API
    if (!inflectionCache[targetId]) {
      try {
        const res = await fetchDictionaryInflection(targetId);
        if (res && res.html) {
          setInflectionCache((prev) => ({ ...prev, [targetId]: res.html }));
        }
      } catch (err) {
        console.error('Error fetching inflection table:', err);
      }
    }
  }, [inflectionCache]);

  const clearDictionaryInput = useCallback(() => {
    setQueryWord('');
    setDisplayWord('');
  }, []);

  const effectiveDockMode = isMobileScreen ? 'modal' : dockMode;

  const value = {
    isOpen,
    queryWord,
    displayWord,
    activeDictTab,
    dockMode: effectiveDockMode,
    rawDockMode: dockMode,
    isMobileScreen,
    fontSizeMultiplier,
    clickToLookupEnabled,

    clickLookupMode,
    dictOrder,
    dictEnabled,
    history,
    historyIndex,
    lookupData,
    isLoading,
    isBackgroundLoading,
    error,
    inflectionCache,
    expandedSections,
    openDictionary,
    closeDictionary,
    performLookup,
    goBack,
    goForward,
    setDictTab,
    setDockMode,
    setFontSizeMultiplier,
    setClickToLookupEnabled,
    setClickLookupMode,
    setDictOrder,
    moveDictUp,
    moveDictDown,
    toggleDictEnabled,
    setDictEnabled,
    toggleInflection,
    setDisplayWord,
    setQueryWord,
    clearDictionaryInput,
  };

  return (
    <DictionaryContext.Provider value={value}>
      {children}
    </DictionaryContext.Provider>
  );
}

export function useDictionary() {
  const context = useContext(DictionaryContext);
  if (!context) {
    throw new Error('useDictionary must be used within a DictionaryProvider');
  }
  return context;
}
