'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { fetchDictionaryLookup, fetchDictionaryInflection } from '../services/api';
import { convertAnyToRoman, cleanDictionaryQuery } from '../services/transliterate';

const DictionaryContext = createContext();

const STORAGE_KEYS = {
  DOCK_MODE: 'tipitaka_dict_dock_mode_v1',
  FONT_SIZE: 'tipitaka_dict_font_size_v1',
  CLICK_LOOKUP: 'tipitaka_dict_click_lookup_v1',
  CLICK_MODE: 'tipitaka_dict_click_mode_v1',
  LAST_TAB: 'tipitaka_dict_last_tab_v1',
};

export function DictionaryProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [queryWord, setQueryWord] = useState('');
  const [displayWord, setDisplayWord] = useState('');
  const [activeDictTab, setActiveDictTab] = useState('dpd');
  const [dockMode, setDockModeState] = useState('modal'); // 'modal' | 'left' | 'side' | 'right'
  const [fontSizeMultiplier, setFontSizeMultiplierState] = useState(1.0);
  const [clickToLookupEnabled, setClickToLookupState] = useState(true);
  const [clickLookupMode, setClickLookupModeState] = useState('single'); // 'single' | 'double'

  // History stack for back/forward navigation inside dictionary
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Results & Loading state (Stage 1 Priority DPD + Stage 2 Async Enrichment)
  const [lookupData, setLookupData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState(null);

  const lookupSeqRef = useRef(0);

  // Cache for loaded inflection tables: { [targetId]: htmlString }
  const [inflectionCache, setInflectionCache] = useState({});

  // Active expanded section target IDs (e.g. Set of targetIds like 'declension_buddha_1')
  const [expandedSections, setExpandedSections] = useState({});

  // Load user preferences from localStorage
  useEffect(() => {
    try {
      const savedDock = localStorage.getItem(STORAGE_KEYS.DOCK_MODE);
      if (savedDock && ['modal', 'left', 'side', 'right'].includes(savedDock)) {
        setDockModeState(savedDock);
      } else if (savedDock === 'top' || savedDock === 'bottom') {
        setDockModeState('side');
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
      if (savedTab && ['dpd', 'pts', 'abd', 'psd', 'sans', 'splitter'].includes(savedTab)) {
        setActiveDictTab(savedTab);
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

  // Single-Request Instant Dictionary Lookup (All dictionaries fetched in 1 compressed response)
  const performLookup = useCallback(async (wordToSearch, addToHistoryStack = true) => {
    if (!wordToSearch || !wordToSearch.trim()) return;

    // Preserve the exact raw user input for display (e.g. "‘‘Evaṃ, bhante’’ti" or "evaṁ")
    const rawDisplay = wordToSearch.trim();

    // Behind the scenes: clean quotes, attached enclitics, punctuation, and normalize ṁ -> ṃ
    const sanitizedInput = cleanDictionaryQuery(rawDisplay);
    if (!sanitizedInput) return;

    const romanWord = convertAnyToRoman(sanitizedInput).trim().toLowerCase();
    const cleanWord = (romanWord || sanitizedInput.trim().toLowerCase()).replace(/ṁ/g, 'ṃ');

    const currentSeq = ++lookupSeqRef.current;

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
      const data = await fetchDictionaryLookup(cleanWord, 'all');
      if (currentSeq !== lookupSeqRef.current) return;

      if (data) {
        const dpdCount = data.counts?.dpd || data.dpd?.length || 0;
        const ptsCount = data.counts?.pts || data.pts?.length || 0;
        const abdCount = data.counts?.abd || data.abd?.length || 0;
        const psdCount = data.counts?.psd || data.psd?.length || 0;
        const sansCount = data.counts?.sans || data.sans?.length || 0;
        const splitterCount = data.counts?.splitter || data.splitter?.length || 0;

        const hasAny = data.hasResults || dpdCount > 0 || ptsCount > 0 || abdCount > 0 || psdCount > 0 || sansCount > 0 || splitterCount > 0;

        const lookupResult = {
          word: cleanWord,
          hasResults: hasAny,
          synonyms: data.synonyms || [],
          counts: {
            dpd: dpdCount,
            pts: ptsCount,
            abd: abdCount,
            psd: psdCount,
            sans: sansCount,
            splitter: splitterCount,
          },
          dpd: data.dpd || [],
          pts: data.pts || [],
          abd: data.abd || [],
          psd: data.psd || [],
          sans: data.sans || [],
          splitter: data.splitter || [],
        };

        setLookupData(lookupResult);

        // Auto-select tab: DPD if it has results, otherwise switch to first dictionary with results
        if (dpdCount > 0) {
          setActiveDictTab('dpd');
        } else {
          const priority = ['pts', 'abd', 'psd', 'sans', 'splitter'];
          let switched = false;
          for (const t of priority) {
            if ((lookupResult.counts?.[t] || 0) > 0) {
              setActiveDictTab(t);
              switched = true;
              break;
            }
          }
          if (!switched) {
            setActiveDictTab('dpd');
          }
        }
      }
    } catch (err) {
      if (currentSeq !== lookupSeqRef.current) return;
      console.warn('Dictionary lookup error:', err);
      setError(err.message || 'Dictionary lookup failed');
    } finally {
      if (currentSeq === lookupSeqRef.current) {
        setIsLoading(false);
        setIsBackgroundLoading(false);
      }
    }
  }, [historyIndex]);

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

  const value = {
    isOpen,
    queryWord,
    displayWord,
    activeDictTab,
    dockMode,
    fontSizeMultiplier,
    clickToLookupEnabled,
    clickLookupMode,
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
