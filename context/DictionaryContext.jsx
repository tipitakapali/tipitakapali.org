'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { fetchDictionaryLookup, fetchDPDLookup, fetchOthersLookup, fetchDictionaryInflection } from '../services/api';
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

  // Staged Lookup: Priority Stage 1 (DPD instant display) + Stage 2 (Async background enrichment)
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
    setIsBackgroundLoading(true);
    setError(null);

    // Update history stack
    if (addToHistoryStack) {
      setHistory((prev) => {
        const nextStack = [...prev.slice(0, historyIndex + 1), rawDisplay];
        setHistoryIndex(nextStack.length - 1);
        return nextStack;
      });
    }

    // Step 1: Fast priority DPD lookup (Digital Pāḷi Dictionary)
    const dpdPromise = fetchDPDLookup(cleanWord)
      .then((dpdData) => {
        if (currentSeq !== lookupSeqRef.current) return null;
        if (dpdData) {
          setLookupData((prev) => {
            const prevMatchesWord = prev && prev.word === cleanWord;
            return {
              word: cleanWord,
              hasResults: dpdData.hasResults || (dpdData.dpd?.length > 0) || (prevMatchesWord && prev.hasResults),
              synonyms: dpdData.synonyms || [],
              counts: {
                dpd: dpdData.counts?.dpd || dpdData.dpd?.length || 0,
                pts: prevMatchesWord ? (prev.counts?.pts || 0) : 0,
                abd: prevMatchesWord ? (prev.counts?.abd || 0) : 0,
                psd: prevMatchesWord ? (prev.counts?.psd || 0) : 0,
                sans: prevMatchesWord ? (prev.counts?.sans || 0) : 0,
                splitter: prevMatchesWord ? (prev.counts?.splitter || 0) : 0,
              },
              dpd: dpdData.dpd || [],
              pts: prevMatchesWord ? (prev.pts || []) : [],
              abd: prevMatchesWord ? (prev.abd || []) : [],
              psd: prevMatchesWord ? (prev.psd || []) : [],
              sans: prevMatchesWord ? (prev.sans || []) : [],
              splitter: prevMatchesWord ? (prev.splitter || []) : [],
            };
          });
          // Immediately release loading so DPD renders with zero perceived delay!
          setIsLoading(false);
        }
        return dpdData;
      })
      .catch((err) => {
        if (currentSeq !== lookupSeqRef.current) return null;
        console.warn('DPD lookup error:', err);
        return null;
      });

    // Step 2: Background async lookup for secondary dictionaries (PTS, ABD, PSD, Sanskrit, Splitter)
    const othersPromise = fetchOthersLookup(cleanWord)
      .then((othersData) => {
        if (currentSeq !== lookupSeqRef.current) return null;
        if (othersData) {
          setLookupData((prev) => {
            const prevDpdCount = prev?.counts?.dpd || prev?.dpd?.length || 0;
            const ptsCount = othersData.counts?.pts || othersData.pts?.length || 0;
            const abdCount = othersData.counts?.abd || othersData.abd?.length || 0;
            const psdCount = othersData.counts?.psd || othersData.psd?.length || 0;
            const sansCount = othersData.counts?.sans || othersData.sans?.length || 0;
            const splitterCount = othersData.counts?.splitter || othersData.splitter?.length || 0;

            const hasAny = prevDpdCount > 0 || ptsCount > 0 || abdCount > 0 || psdCount > 0 || sansCount > 0 || splitterCount > 0;

            return {
              word: cleanWord,
              hasResults: hasAny,
              synonyms: prev?.synonyms || [],
              counts: {
                dpd: prevDpdCount,
                pts: ptsCount,
                abd: abdCount,
                psd: psdCount,
                sans: sansCount,
                splitter: splitterCount,
              },
              dpd: prev?.dpd || [],
              pts: othersData.pts || [],
              abd: othersData.abd || [],
              psd: othersData.psd || [],
              sans: othersData.sans || [],
              splitter: othersData.splitter || [],
            };
          });

          // If DPD had 0 results, auto-switch to first available tab with results
          setLookupData((latestData) => {
            if (latestData && latestData.word === cleanWord) {
              setActiveDictTab((prevTab) => {
                if (latestData.counts?.[prevTab] > 0) return prevTab;
                if ((latestData.counts?.dpd || 0) === 0) {
                  const priority = ['pts', 'abd', 'psd', 'sans', 'splitter'];
                  for (const t of priority) {
                    if (latestData.counts?.[t] > 0) return t;
                  }
                }
                return prevTab;
              });
            }
            return latestData;
          });
        }
        setIsBackgroundLoading(false);
        return othersData;
      })
      .catch((err) => {
        if (currentSeq !== lookupSeqRef.current) return null;
        console.warn('Others lookup error:', err);
        setIsBackgroundLoading(false);
        return null;
      });

    // Ensure main loading is cleared if both complete or in case DPD threw error
    try {
      await dpdPromise;
    } catch (e) {
      await othersPromise;
    } finally {
      if (currentSeq === lookupSeqRef.current) {
        setIsLoading(false);
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
