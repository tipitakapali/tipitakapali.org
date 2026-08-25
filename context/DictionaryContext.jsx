'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { fetchDictionaryLookup, fetchDictionaryInflection } from '../services/api';
import { convertAnyToRoman } from '../services/transliterate';

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
  const [dockMode, setDockModeState] = useState('modal'); // 'modal' | 'top' | 'bottom' | 'left' | 'side' | 'right'
  const [fontSizeMultiplier, setFontSizeMultiplierState] = useState(1.0);
  const [clickToLookupEnabled, setClickToLookupState] = useState(true);
  const [clickLookupMode, setClickLookupModeState] = useState('single'); // 'single' | 'double'

  // History stack for back/forward navigation inside dictionary
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Results & Loading state
  const [lookupData, setLookupData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Cache for loaded inflection tables: { [targetId]: htmlString }
  const [inflectionCache, setInflectionCache] = useState({});

  // Active expanded section target IDs (e.g. Set of targetIds like 'declension_buddha_1')
  const [expandedSections, setExpandedSections] = useState({});

  // Load user preferences from localStorage
  useEffect(() => {
    try {
      const savedDock = localStorage.getItem(STORAGE_KEYS.DOCK_MODE);
      if (savedDock && ['modal', 'top', 'bottom', 'left', 'side', 'right'].includes(savedDock)) {
        setDockModeState(savedDock);
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
    setDockModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEYS.DOCK_MODE, mode);
    } catch (e) {}

    // Synchronize Navigation Sidebar to dock to the opposite side
    if (typeof window !== 'undefined') {
      if (mode === 'left') {
        try {
          localStorage.setItem('tipitaka_tree_dock', 'right');
          window.dispatchEvent(new CustomEvent('tipitaka_tree_dock_change', { detail: 'right' }));
        } catch (e) {}
      } else if (mode === 'side' || mode === 'right') {
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

  // Main lookup function
  const performLookup = useCallback(async (wordToSearch, addToHistoryStack = true) => {
    if (!wordToSearch || !wordToSearch.trim()) return;

    const romanWord = convertAnyToRoman(wordToSearch).trim().toLowerCase();
    const cleanWord = romanWord || wordToSearch.trim().toLowerCase();

    setQueryWord(cleanWord);
    setDisplayWord(wordToSearch);
    setIsLoading(true);
    setError(null);

    // Update history stack
    if (addToHistoryStack) {
      setHistory((prev) => {
        const nextStack = [...prev.slice(0, historyIndex + 1), cleanWord];
        setHistoryIndex(nextStack.length - 1);
        return nextStack;
      });
    }

    try {
      const data = await fetchDictionaryLookup(cleanWord, 'all');
      setLookupData(data);

      // Auto-select tab with results if current active tab has 0 matches
      if (data && data.counts) {
        setActiveDictTab((prevTab) => {
          if (data.counts[prevTab] > 0) return prevTab;
          // Pick first tab with matches
          const priority = ['dpd', 'pts', 'abd', 'psd', 'sans', 'splitter'];
          for (const t of priority) {
            if (data.counts[t] > 0) return t;
          }
          return prevTab;
        });
      }
    } catch (err) {
      console.error('Dictionary lookup error:', err);
      setError(err.message || 'Lookup failed');
    } finally {
      setIsLoading(false);
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
