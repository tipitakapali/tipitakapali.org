'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { fetchDictionaryLookup, fetchDictionaryInflection, getFeedbackTemplateFromDb } from '../services/api';
import { convertAnyToRoman, cleanDictionaryQuery } from '../services/transliterate';
import { restoreMinifiedLinks } from '../services/dpdFeedback';
import { useThemeSettings } from './ThemeSettingsContext';
import { normalizeLangCode } from './TabContext';

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
    id: 'bold_def',
    label: 'Bold Definition',
    shortLabel: 'Bold Def',
    badge: 'Tipiṭaka',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    desc: 'Pāḷi bold-highlighted definitions across Mūla, Aṭṭhakathā, and Ṭīkā with context & translations.',
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
  DOCK_MODE: 'tipitaka_dict_dock_mode_v2',
  FONT_SIZE: 'tipitaka_dict_font_size_multiplier_v2',
  CLICK_LOOKUP: 'tipitaka_dict_click_lookup_v2',
  CLICK_MODE: 'tipitaka_dict_click_mode_v2',
  LAST_TAB: 'tipitaka_dict_last_tab_v2',
  DICT_ORDER: 'tipitaka_dict_order_v3',
  DICT_ENABLED: 'tipitaka_dict_enabled_v2',
  LOOKUP_HISTORY: 'tipitaka_dict_lookup_history_v2',
};

export const DEFAULT_DICT_ORDER = ['dpd', 'bold_def', 'abd', 'pts', 'psd', 'sans', 'splitter'];
export const DEFAULT_DICT_ENABLED = { dpd: true, bold_def: true, abd: true, pts: true, psd: true, sans: true, splitter: true };

export function getTopDictWithMeaning(order, enabled, lookupData) {
  const activeOrder = (order || DEFAULT_DICT_ORDER).filter((id) => enabled?.[id] !== false);
  if (!activeOrder.length) return 'dpd';

  if (lookupData) {
    for (const dictId of activeOrder) {
      const count = lookupData.counts?.[dictId] ?? lookupData[dictId]?.length ?? 0;
      if (count > 0) {
        return dictId;
      }
    }
  }

  return activeOrder[0];
}

const DictionaryContext = createContext(null);

export function DictionaryProvider({ children }) {
  const { settings } = useThemeSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [isOpen, setIsOpen] = useState(false);
  const [queryWord, setQueryWord] = useState('');
  const [displayWord, setDisplayWord] = useState('');
  const [dockMode, setDockModeState] = useState('side'); // 'modal' | 'left' | 'side' | 'right'
  const [fontSizeMultiplier, setFontSizeMultiplierState] = useState(1);
  const [clickToLookupEnabled, setClickToLookupState] = useState(true);
  const [clickLookupMode, setClickLookupModeState] = useState('single'); // 'single' | 'double'
  const [dictOrder, setDictOrderState] = useState(DEFAULT_DICT_ORDER);
  const [dictEnabled, setDictEnabledState] = useState(DEFAULT_DICT_ENABLED);
  const [activeDictTab, setActiveDictTab] = useState('dpd');

  const dictOrderRef = useRef(dictOrder);
  const dictEnabledRef = useRef(dictEnabled);
  useEffect(() => {
    dictOrderRef.current = dictOrder;
  }, [dictOrder]);
  useEffect(() => {
    dictEnabledRef.current = dictEnabled;
  }, [dictEnabled]);

  // History navigation stack & persistent lookup history
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lookupHistory, setLookupHistory] = useState([]);

  // Lookup results state
  const [lookupData, setLookupData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [error, setError] = useState(null);

  const lookupSeqRef = useRef(0);
  const lookupAbortControllerRef = useRef(null);
  // Mirror of the latest lookup results for the repeat-word fast path below
  // (avoids adding lookupData to performLookup's dep array).
  const lookupDataRef = useRef(null);
  useEffect(() => {
    lookupDataRef.current = lookupData;
  }, [lookupData]);

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

  // Shrinking from desktop to mobile while the dictionary is open docked: close it
  // instead of popping it into a center modal. It reopens on the next word click.
  const prevMobileRef = useRef(isMobileScreen);
  useEffect(() => {
    if (!prevMobileRef.current && isMobileScreen && isOpen) {
      setIsOpen(false);
    }
    prevMobileRef.current = isMobileScreen;
  }, [isMobileScreen, isOpen]);

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
      let loadedOrder = DEFAULT_DICT_ORDER;
      const savedOrder = localStorage.getItem(STORAGE_KEYS.DICT_ORDER);
      if (savedOrder) {
        try {
          const parsed = JSON.parse(savedOrder);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const merged = [...parsed];
            for (const id of DEFAULT_DICT_ORDER) {
              if (!merged.includes(id)) merged.push(id);
            }
            loadedOrder = merged;
            dictOrderRef.current = merged;
            setDictOrderState(merged);
          }
        } catch (e) {}
      }
      let loadedEnabled = DEFAULT_DICT_ENABLED;
      const savedEnabled = localStorage.getItem(STORAGE_KEYS.DICT_ENABLED);
      if (savedEnabled) {
        try {
          const parsed = JSON.parse(savedEnabled);
          if (parsed && typeof parsed === 'object') {
            loadedEnabled = { ...DEFAULT_DICT_ENABLED, ...parsed };
            dictEnabledRef.current = loadedEnabled;
            setDictEnabledState((prev) => ({ ...prev, ...parsed }));
          }
        } catch (e) {}
      }

      const activeOrder = loadedOrder.filter((id) => loadedEnabled[id] !== false);
      if (activeOrder.length > 0) {
        setActiveDictTab(activeOrder[0]);
      }

      const savedLookupHistory = localStorage.getItem(STORAGE_KEYS.LOOKUP_HISTORY);
      if (savedLookupHistory) {
        try {
          const parsed = JSON.parse(savedLookupHistory);
          if (Array.isArray(parsed)) {
            setLookupHistory(parsed);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }, []);

  const setDockMode = useCallback((mode) => {
    const validMode = ['left', 'modal', 'side', 'right'].includes(mode) ? mode : 'side';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('tipitaka:before-layout-shift', { detail: { source: 'dictionary-dock', mode: validMode } })
      );
    }
    setDockModeState(validMode);
    try {
      localStorage.setItem(STORAGE_KEYS.DOCK_MODE, validMode);
    } catch (e) {}

    // Synchronize Navigation Sidebar to dock to the opposite side
    if (typeof window !== 'undefined') {
      if (validMode === 'left') {
        try {
          localStorage.setItem('tipitaka_tree_dock_v2', 'right');
          window.dispatchEvent(new CustomEvent('tipitaka_tree_dock_change', { detail: 'right' }));
        } catch (e) {}
      } else if (validMode === 'side' || validMode === 'right') {
        try {
          localStorage.setItem('tipitaka_tree_dock_v2', 'left');
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

  const updateTabFromOrder = useCallback((order, enabled, currentLookup) => {
    const targetTab = getTopDictWithMeaning(order, enabled, currentLookup);
    if (targetTab) {
      setActiveDictTab(targetTab);
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_TAB, targetTab);
      } catch (e) {}
    }
  }, []);

  const setDictOrder = useCallback((newOrder) => {
    if (!Array.isArray(newOrder)) return;
    dictOrderRef.current = newOrder;
    setDictOrderState(newOrder);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(newOrder));
    } catch (e) {}
    updateTabFromOrder(newOrder, dictEnabledRef.current, lookupDataRef.current);
  }, [updateTabFromOrder]);

  const moveDictUp = useCallback((dictId) => {
    const prev = dictOrderRef.current || DEFAULT_DICT_ORDER;
    const idx = prev.indexOf(dictId);
    if (idx <= 0) return;
    const next = [...prev];
    const temp = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = temp;
    dictOrderRef.current = next;
    setDictOrderState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(next));
    } catch (e) {}
    updateTabFromOrder(next, dictEnabledRef.current, lookupDataRef.current);
  }, [updateTabFromOrder]);

  const moveDictDown = useCallback((dictId) => {
    const prev = dictOrderRef.current || DEFAULT_DICT_ORDER;
    const idx = prev.indexOf(dictId);
    if (idx < 0 || idx >= prev.length - 1) return;
    const next = [...prev];
    const temp = next[idx + 1];
    next[idx + 1] = next[idx];
    next[idx] = temp;
    dictOrderRef.current = next;
    setDictOrderState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ORDER, JSON.stringify(next));
    } catch (e) {}
    updateTabFromOrder(next, dictEnabledRef.current, lookupDataRef.current);
  }, [updateTabFromOrder]);

  const toggleDictEnabled = useCallback((dictId) => {
    const prev = dictEnabledRef.current || DEFAULT_DICT_ENABLED;
    const next = { ...prev, [dictId]: !prev[dictId] };
    dictEnabledRef.current = next;
    setDictEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ENABLED, JSON.stringify(next));
    } catch (e) {}
    updateTabFromOrder(dictOrderRef.current, next, lookupDataRef.current);
  }, [updateTabFromOrder]);

  const setDictEnabled = useCallback((updater) => {
    const prev = dictEnabledRef.current || DEFAULT_DICT_ENABLED;
    const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
    dictEnabledRef.current = next;
    setDictEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.DICT_ENABLED, JSON.stringify(next));
    } catch (e) {}
    updateTabFromOrder(dictOrderRef.current, next, lookupDataRef.current);
  }, [updateTabFromOrder]);

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

    // Collect active non-Pāḷi translation language codes for Bold Definition translations
    const activeTransLangs = [];
    const transMap = settingsRef.current?.translations || {};
    const transOrder = settingsRef.current?.translationOrder || Object.keys(transMap);
    const seenLangs = new Set();
    for (const key of [...transOrder, ...Object.keys(transMap)]) {
      if (key === 'pali' || !transMap[key]) continue;
      const code = normalizeLangCode(key);
      if (code && code !== 'pali' && !seenLangs.has(code)) {
        seenLangs.add(code);
        activeTransLangs.push(code);
      }
    }
    const boldEnabled = dictEnabledRef.current?.bold_def !== false;
    const boldContextKey = `${boldEnabled ? '1' : '0'}:${activeTransLangs.join(',')}`;

    // Repeat lookup of the word already displayed (e.g. clicking "dhamma" again):
    // show the cached results instantly with zero state churn — no loading flash,
    // no history duplicate, no in-flight abort, no tab/content motion.
    // Re-run if active translation languages or bold_def enabled state changed.
    if (
      lookupDataRef.current?.word === cleanWord &&
      lookupDataRef.current?._boldContextKey === boldContextKey
    ) {
      setQueryWord(cleanWord);
      setDisplayWord(rawDisplay);
      if (addToHistoryStack) {
        setLookupHistory((prev) => {
          const filtered = prev.filter((item) => item.toLowerCase() !== rawDisplay.toLowerCase());
          const next = [rawDisplay, ...filtered].slice(0, 50);
          try {
            localStorage.setItem(STORAGE_KEYS.LOOKUP_HISTORY, JSON.stringify(next));
          } catch (e) {}
          return next;
        });
      }
      return;
    }

    const currentSeq = ++lookupSeqRef.current;
    lookupAbortControllerRef.current?.abort();
    lookupAbortControllerRef.current = new AbortController();
    const signal = lookupAbortControllerRef.current.signal;

    const currentActiveOrder = (dictOrderRef.current || DEFAULT_DICT_ORDER).filter(
      (id) => dictEnabledRef.current?.[id] !== false
    );
    const currentTopDict = currentActiveOrder[0] || 'dpd';

    setQueryWord(cleanWord);
    setDisplayWord(rawDisplay);
    setIsLoading(true);
    setIsBackgroundLoading(true);
    setError(null);
    setActiveDictTab(currentTopDict);

    // Update history stack & persistent recent lookup history
    if (addToHistoryStack) {
      setHistory((prev) => {
        const nextStack = [...prev.slice(0, historyIndex + 1), rawDisplay];
        setHistoryIndex(nextStack.length - 1);
        return nextStack;
      });
      setLookupHistory((prev) => {
        const filtered = prev.filter((item) => item.toLowerCase() !== rawDisplay.toLowerCase());
        const next = [rawDisplay, ...filtered].slice(0, 50);
        try {
          localStorage.setItem(STORAGE_KEYS.LOOKUP_HISTORY, JSON.stringify(next));
        } catch (e) {}
        return next;
      });
    }

    try {
      // ── Parallel lookup: fire DPD, secondary dictionaries, and Bold Definition together ──
      const dpdPromise = fetchDictionaryLookup(cleanWord, 'dpd', { signal });
      const othersPromise = fetchDictionaryLookup(cleanWord, 'others', { signal });
      const boldPromise = boldEnabled
        ? fetchDictionaryLookup(cleanWord, 'bold_def', { signal, langs: activeTransLangs })
        : Promise.resolve({ results: [] });
      setIsBackgroundLoading(true);

      const mergedData = {
        word: cleanWord,
        _boldContextKey: boldContextKey,
        hasResults: false,
        synonyms: [],
        bold_def_prefix: '',
        counts: { dpd: 0, bold_def: 0, pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
        dpd: [],
        bold_def: [],
        pts: [],
        abd: [],
        psd: [],
        sans: [],
        splitter: [],
      };

      let dpdDone = false;
      let othersDone = false;
      let boldDone = false;

      const handleUpdate = () => {
        if (currentSeq !== lookupSeqRef.current || signal.aborted) return;

        const currentActiveOrder = (dictOrderRef.current || DEFAULT_DICT_ORDER).filter(
          (id) => dictEnabledRef.current?.[id] !== false
        );
        const currentTopDict = currentActiveOrder[0] || 'dpd';

        const hasAny = Object.values(mergedData.counts).some((c) => c > 0);
        mergedData.hasResults = hasAny;

        setLookupData({ ...mergedData });

        if (dpdDone && othersDone && boldDone) {
          setIsLoading(false);
          setIsBackgroundLoading(false);

          // Find first enabled dictionary in order that has meaning (count > 0)
          const targetTab = getTopDictWithMeaning(currentActiveOrder, dictEnabledRef.current, mergedData);
          setActiveDictTab(targetTab);
          return;
        }

        // Partial update when one of the requests has finished
        if (currentTopDict === 'dpd') {
          if (dpdDone) {
            setIsLoading(false);
            if (mergedData.counts.dpd > 0) {
              setActiveDictTab('dpd');
            }
          }
        } else if (currentTopDict === 'bold_def') {
          if (boldDone) {
            setIsLoading(false);
            if (mergedData.counts.bold_def > 0) {
              setActiveDictTab('bold_def');
            }
          } else if (dpdDone) {
            setIsLoading(false);
            setActiveDictTab('bold_def');
          }
        } else {
          // Top dictionary is in others (pts, abd, psd, sans, splitter)
          if (othersDone) {
            if ((mergedData.counts[currentTopDict] || 0) > 0) {
              setIsLoading(false);
              setActiveDictTab(currentTopDict);
            }
          } else if (dpdDone) {
            setIsLoading(false);
            setActiveDictTab(currentTopDict);
          }
        }
      };

      dpdPromise
        .then((dpdData) => {
          if (currentSeq !== lookupSeqRef.current || signal.aborted) return;
          const dpdCount = dpdData?.counts?.dpd || dpdData?.dpd?.length || 0;
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
          mergedData.dpd = processedDpd;
          mergedData.counts.dpd = dpdCount;
          mergedData.synonyms = dpdData?.synonyms || [];
          dpdDone = true;
          handleUpdate();
        })
        .catch((err) => {
          if (err.name === 'AbortError' || signal.aborted || currentSeq !== lookupSeqRef.current) return;
          dpdDone = true;
          handleUpdate();
        });

      othersPromise
        .then((othersData) => {
          if (currentSeq !== lookupSeqRef.current || signal.aborted) return;
          const ptsCount = othersData?.counts?.pts || othersData?.pts?.length || 0;
          const abdCount = othersData?.counts?.abd || othersData?.abd?.length || 0;
          const psdCount = othersData?.counts?.psd || othersData?.psd?.length || 0;
          const sansCount = othersData?.counts?.sans || othersData?.sans?.length || 0;
          const splitterCount = othersData?.counts?.splitter || othersData?.splitter?.length || 0;

          mergedData.pts = othersData?.pts || [];
          mergedData.abd = othersData?.abd || [];
          mergedData.psd = othersData?.psd || [];
          mergedData.sans = othersData?.sans || [];
          mergedData.splitter = othersData?.splitter || [];

          mergedData.counts.pts = ptsCount;
          mergedData.counts.abd = abdCount;
          mergedData.counts.psd = psdCount;
          mergedData.counts.sans = sansCount;
          mergedData.counts.splitter = splitterCount;

          othersDone = true;
          handleUpdate();
        })
        .catch((err) => {
          if (err.name === 'AbortError' || signal.aborted || currentSeq !== lookupSeqRef.current) return;
          othersDone = true;
          handleUpdate();
        });

      boldPromise
        .then((boldData) => {
          if (currentSeq !== lookupSeqRef.current || signal.aborted) return;
          const boldList = Array.isArray(boldData?.results) ? boldData.results : [];
          mergedData.bold_def = boldList;
          mergedData.counts.bold_def = boldList.length;
          mergedData.bold_def_prefix = boldData?.search_prefix || boldData?.bold_def_prefix || '';
          boldDone = true;
          handleUpdate();
        })
        .catch((err) => {
          if (err.name === 'AbortError' || signal.aborted || currentSeq !== lookupSeqRef.current) return;
          boldDone = true;
          handleUpdate();
        });

      const [dpdRes, othersRes, boldRes] = await Promise.allSettled([dpdPromise, othersPromise, boldPromise]);
      if (currentSeq !== lookupSeqRef.current || signal.aborted) return;

      if (dpdRes.status === 'rejected' && othersRes.status === 'rejected' && boldRes.status === 'rejected') {
        const err = dpdRes.reason || othersRes.reason || boldRes.reason;
        console.warn('Dictionary lookup error:', err);
        setError(err?.message || 'Dictionary lookup failed');
      }
      setIsLoading(false);
      setIsBackgroundLoading(false);
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted') || signal.aborted || currentSeq !== lookupSeqRef.current) return;
      console.warn('Dictionary lookup error:', err);
      setError(err.message || 'Dictionary lookup failed');
      setIsLoading(false);
      setIsBackgroundLoading(false);
    }
  }, [historyIndex]);

  // Open dictionary with word (or just open)
  const openDictionary = useCallback((word = '', initialTab = null) => {
    // Ignore ghost click lookups if dictionary was closed moments ago
    if (word && typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('tipitaka:before-layout-shift', { detail: { source: 'dictionary-open' } })
      );
    }
    setIsOpen(true);
    if (initialTab) {
      setDictTab(initialTab);
    } else {
      const currentActiveOrder = (dictOrderRef.current || DEFAULT_DICT_ORDER).filter(
        (id) => dictEnabledRef.current?.[id] !== false
      );
      const topTab = getTopDictWithMeaning(currentActiveOrder, dictEnabledRef.current, lookupDataRef.current);
      if (topTab) {
        setActiveDictTab(topTab);
      }
    }
    if (word && word.trim()) {
      performLookup(word.trim(), true);
    }
  }, [performLookup, setDictTab]);

  const closeDictionary = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('tipitaka:before-layout-shift', { detail: { source: 'dictionary-close' } })
      );
      window.__tipitaka_dict_just_closed = Date.now();
    }
    setIsOpen(false);
  }, []);

  // Global keyboard shortcut ('d' or 'D' when reading, Esc to close)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        closeDictionary();
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

  const clearLookupHistory = useCallback(() => {
    setLookupHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEYS.LOOKUP_HISTORY);
    } catch (e) {}
  }, []);

  const removeLookupHistoryItem = useCallback((wordToRemove) => {
    if (!wordToRemove) return;
    setLookupHistory((prev) => {
      const next = prev.filter((item) => item.toLowerCase() !== wordToRemove.toLowerCase());
      try {
        localStorage.setItem(STORAGE_KEYS.LOOKUP_HISTORY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

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
    lookupHistory,
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
    clearLookupHistory,
    removeLookupHistoryItem,
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
