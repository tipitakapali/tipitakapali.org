'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Loader2, Filter, SlidersHorizontal, ArrowUpDown, ChevronDown } from 'lucide-react';
import SearchResultItem from './SearchResultItem';
import { searchTipitaka, fetchSearchDatabases } from '../../services/api';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { typeVelthuis, convertAnyToRoman } from '../../services/transliterate';

export const LANG_KEY_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  burmese: 'my',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  indonesian: 'id',
  nepali: 'ne',
  portuguese: 'pt',
  russian: 'ru',
  my_nissaya: 'my_nissaya',
  nissaya: 'my_nissaya',
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

export function getMinSearchLength(str) {
  if (!str) return 1;
  return 1;
}

const MAT_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'mula', label: 'Mūla' },
  { id: 'attha', label: 'Aṭṭhakathā' },
  { id: 'tika', label: 'Ṭīkā' },
  { id: 'anna', label: 'Añña' },
];

const PITAKA_OPTIONS = [
  { id: 'all', label: 'All Piṭakas' },
  { id: 'vinaya', label: 'Vinayapiṭaka' },
  { id: 'sutta', label: 'Suttapiṭaka (All)' },
  { id: 'digha', label: '— Dīghanikāya' },
  { id: 'majjhima', label: '— Majjhimanikāya' },
  { id: 'samyutta', label: '— Saṃyuttanikāya' },
  { id: 'anguttara', label: '— Aṅguttaranikāya' },
  { id: 'khuddaka', label: '— Khuddakanikāya' },
  { id: 'abhidhamma', label: 'Abhidhammapiṭaka' },
  { id: 'anna', label: 'Añña (Other texts)' },
];

const DISTANCE_OPTIONS = [
  { id: 'any', label: 'Any' },
  { id: '1', label: '1 word (Exact phrase)' },
  { id: '2', label: '2 words' },
  { id: '3', label: '3 words' },
  { id: '5', label: '5 words' },
  { id: '8', label: '8 words' },
  { id: '10', label: '10 words' },
];

const SORT_OPTIONS = [
  { id: 'pitaka', label: 'Piṭaka order' },
  { id: 'relevance', label: 'Relevant' },
  { id: 'bm25', label: 'BM25' },
];

const DEFAULT_FTS_DATABASES = [
  { id: 'fts_tipitaka.db', key: 'pali', label: 'Pāḷi CST', flag: '☸️', isPali: true },
  { id: 'fts_translation_en.db', key: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'fts_translation_vi.db', key: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { id: 'fts_translation_my.db', key: 'my', label: 'မြန်မာ', flag: '🇲🇲' },
  { id: 'fts_translation_my_nissaya.db', key: 'my_nissaya', label: 'မြန်မာ နိဿယ', flag: '🇲🇲' },
  { id: 'fts_translation_si.db', key: 'si', label: 'සිංහල', flag: '🇱🇰' },
  { id: 'fts_translation_th.db', key: 'th', label: 'ไทย', flag: '🇹🇭' },
  { id: 'fts_translation_zh.db', key: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'fts_translation_km.db', key: 'km', label: 'ភាសាខ្មែរ', flag: '🇰🇭' },
  { id: 'fts_translation_lo.db', key: 'lo', label: 'ລາວ', flag: '🇱🇦' },
  { id: 'fts_translation_ta.db', key: 'ta', label: 'தமிழ்', flag: '🇮🇳' },
  { id: 'fts_translation_hi.db', key: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { id: 'fts_translation_de.db', key: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'fts_translation_ja.db', key: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'fts_translation_pt.db', key: 'pt', label: 'Português', flag: '🇵🇹' },
  { id: 'fts_translation_ru.db', key: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'fts_translation_ko.db', key: 'ko', label: '한국어', flag: '🇰🇷' },
  { id: 'fts_translation_id.db', key: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { id: 'fts_translation_ne.db', key: 'ne', label: 'नेपाली', flag: '🇳🇵' },
];

export function resolveDbFromLangParam(param, databases = DEFAULT_FTS_DATABASES) {
  if (!param) return null;
  const normCode = normalizeLangCode(param);
  if (!normCode) return null;
  if (normCode === 'pali') return 'fts_tipitaka.db';
  const list = databases && databases.length > 0 ? databases : DEFAULT_FTS_DATABASES;
  const found = list.find(
    (d) => d.id === param || d.key === normCode || d.id === `fts_translation_${normCode}.db`
  );
  if (found) return found.id;
  const defaultFound = DEFAULT_FTS_DATABASES.find(
    (d) => d.id === param || d.key === normCode || d.id === `fts_translation_${normCode}.db`
  );
  if (defaultFound) return defaultFound.id;
  return 'fts_tipitaka.db';
}

const SEARCH_PREFS_KEY = 'tipitaka_search_prefs_v1';

export const SUPPORTED_CASES = [
  {
    no: 1,
    query: 'buddhaṃ saraṇaṃ gacchāmi',
    ok: '✅',
    label: 'Pāḷi with full diacritics',
    note: (
      <>
        Pāḷi <b>with</b> full diacritics
      </>
    ),
  },
  {
    no: 2,
    query: 'buddham saranam gacchami',
    ok: '✅',
    label: 'Pāḷi without diacritics',
    note: (
      <>
        Pāḷi <b>without</b> diacritics
      </>
    ),
  },
  {
    no: 3,
    query: 'buddh* saran* gacch*',
    ok: '✅',
    label: 'Partial words wildcard',
    note: (
      <>
        <b>Partial</b> words wildcard
      </>
    ),
  },
  {
    no: 4,
    query: 'buddh saran gacch',
    ok: '✅',
    label: 'Partial words (auto add *)',
    note: (
      <>
        <b>Partial</b> words (auto add *)
      </>
    ),
  },
  {
    no: 5,
    query: 'bu sa ga',
    ok: '✅',
    label: 'Abbreviated (auto add *)',
    note: (
      <>
        <b>Abbreviated</b>, broad results (auto add *)
      </>
    ),
  },
  {
    no: 6,
    query: 'b s g',
    ok: '✅',
    label: 'Highly abbreviated',
    note: (
      <>
        <b>Highly abbreviated</b>, broad results
      </>
    ),
  },
  {
    no: 7,
    query: 'e m s e s b b v i m t k p b',
    ok: '✅',
    label: 'Long highly abbreviated acronyms',
    note: (
      <>
        <b>Long highly abbreviated acronyms</b>
      </>
    ),
  },
  {
    no: 8,
    query: '*cāyatanaṃ',
    ok: '✅',
    label: 'Prefix search',
    note: (
      <>
        <b>Prefix search</b> (prefix <b>*</b>) → matches <code>viññāṇañcāyatanaṃ</code>, <code>ākāsānañcāyatanaṃ</code>, etc.
      </>
    ),
  },
];

export const SCRIPT_EXAMPLES = [
  { script: 'Myanmar', sample: 'သာဓု' },
  { script: 'Sinhala', sample: 'සාධු'},
  { script: 'Devanagari', sample: 'साधु' },
  { script: 'Thai', sample: 'สาธุ' },
  { script: 'Khmer', sample: 'សាធុ' },
  { script: 'Cyrillic', sample: 'са̄дху' },
  { script: 'Roman', sample: 'sādhu' },
];

export function SupportedSearchTable({ onSelectExample, isPaliDb = true }) {
  if (!isPaliDb) return null;
  return (
    <div className="search-help-container my-3 p-3 sm:p-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-2xs max-w-3xl mx-auto text-xs sm:text-sm">
      <div className="text-center mb-3">
        <h3 className="font-semibold text-sm sm:text-base text-[var(--accent)]">
          Examples of supported search input
        </h3>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Can search with 17 different Pāḷi scripts (click any example or script to search):
        </p>
        <div className="flex flex-wrap justify-center items-center gap-1.5 mt-2">
          {SCRIPT_EXAMPLES.map((s) => (
            <button
              key={s.script}
              type="button"
              onClick={() => onSelectExample?.(s.sample)}
              className="px-2.5 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--accent)] hover:text-white transition font-medium text-xs cursor-pointer shadow-2xs active:scale-95"
              title={`Search with ${s.script} script: ${s.sample}`}
            >
              <span className="font-semibold">{s.sample}</span>
              <span className="text-[10px] opacity-75 ml-1">({s.script})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead className="bg-[var(--bg-secondary)] text-[var(--text-primary)] border-b border-[var(--border-color)]">
            <tr>
              <th className="p-2 sm:p-2.5 w-10 text-center font-semibold">No.</th>
              <th className="p-2 sm:p-2.5 font-semibold">Roman Pāḷi — Examples</th>
              <th className="p-2 sm:p-2.5 w-12 text-center font-semibold">OK</th>
              <th className="p-2 sm:p-2.5 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)] text-[var(--text-secondary)]">
            {SUPPORTED_CASES.map((item) => (
              <tr
                key={item.no}
                onClick={() => onSelectExample?.(item.query)}
                className="hover:bg-[var(--bg-hover)] transition cursor-pointer group"
                title={`Click to search: ${item.query}`}
              >
                <td className="p-2 sm:p-2.5 text-center font-mono text-[var(--text-muted)]">
                  {item.no}
                </td>
                <td className="p-2 sm:p-2.5 font-mono text-[var(--accent)] group-hover:underline font-medium">
                  {item.query}
                </td>
                <td className="p-2 sm:p-2.5 text-center select-none text-base">
                  {item.ok}
                </td>
                <td className="p-2 sm:p-2.5 text-[var(--text-primary)]">
                  {item.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] sm:text-xs text-[var(--text-muted)] leading-relaxed border-t border-[var(--border-color)] pt-2.5">
        <p>
          <strong className="text-[var(--text-primary)]">Important:</strong> All input must be in <u>Unicode</u>. If you copy and paste from a non-Unicode source, the search may not work. Please retype the keywords in <strong>Unicode</strong>—just a few words are usually enough!
        </p>
      </div>
    </div>
  );
}

export default function SearchModal() {
  const { isSearchOpen, searchInitialQuery, closeSearchModal, openBook, updateUrlParams } =
    useTabs();
  const { settings, updateSetting } = useThemeSettings();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);

  // Database selection state (Default: Pāḷi fts_tipitaka.db, or URL param l/lang/db)
  const [selectedDb, setSelectedDb] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlDb = urlParams.get('l') || urlParams.get('lang') || urlParams.get('db');
        if (urlDb) {
          const resolved = resolveDbFromLangParam(urlDb, DEFAULT_FTS_DATABASES);
          if (resolved) return resolved;
        }
        const saved = localStorage.getItem(SEARCH_PREFS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.db) return parsed.db;
        }
      } catch {}
    }
    return 'fts_tipitaka.db';
  });
  const [ftsDatabases, setFtsDatabases] = useState(DEFAULT_FTS_DATABASES);
  const isPaliDb = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';

  // All available FTS databases from server or fallback defaults (excluding disabled placeholders)
  const displayedDatabases = (ftsDatabases && ftsDatabases.length > 0 ? ftsDatabases : DEFAULT_FTS_DATABASES).filter((d) => !d.disabled);

  // Search Filter and Sort Controls (Default: Piṭaka Sort, Any Distance, All MAT, All Piṭakas)
  const [matFilter, setMatFilter] = useState('all');
  const [pitakaFilter, setPitakaFilter] = useState('all');
  const [distanceFilter, setDistanceFilter] = useState('any');
  const [sortOption, setSortOption] = useState('pitaka');

  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const handledInitialQueryRef = useRef(null);
  const performSearchRef = useRef(null);

  // Dynamically load available FTS databases from server
  useEffect(() => {
    fetchSearchDatabases()
      .then((data) => {
        if (data?.databases && Array.isArray(data.databases) && data.databases.length > 0) {
          const mapped = data.databases.map((d) => {
            const defOpt = DEFAULT_FTS_DATABASES.find((def) => def.id === d.id);
            return {
              id: d.id,
              key: d.key,
              label: defOpt?.label || (d.is_pali ? 'Pāḷi CST' : (d.native_name || d.name)),
              flag: d.flag || defOpt?.flag || '🌐',
              isPali: Boolean(d.is_pali),
            };
          });
          // Preserve canonical DEFAULT_FTS_DATABASES ordering
          const orderMap = new Map(DEFAULT_FTS_DATABASES.map((def, idx) => [def.id, idx]));
          mapped.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));
          setFtsDatabases(mapped);
        }
      })
      .catch(() => {});
  }, []);

  // Load saved preferences or URL parameters on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlDb = urlParams.get('l') || urlParams.get('lang') || urlParams.get('db');
        if (urlDb) {
          const resolved = resolveDbFromLangParam(urlDb, DEFAULT_FTS_DATABASES);
          if (resolved) {
            setSelectedDb(resolved);
            return;
          }
        }
      }
      const saved = localStorage.getItem(SEARCH_PREFS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mat) setMatFilter(parsed.mat);
        if (parsed.pitaka) setPitakaFilter(parsed.pitaka);
        if (parsed.distance) setDistanceFilter(parsed.distance);
        if (parsed.sort) setSortOption(parsed.sort);
        if (parsed.db) setSelectedDb(parsed.db);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save preferences whenever they change
  const savePrefs = (mat, pitaka, distance, sort, db = selectedDb) => {
    try {
      localStorage.setItem(
        SEARCH_PREFS_KEY,
        JSON.stringify({ mat, pitaka, distance, sort, db })
      );
    } catch {
      // Ignore quota errors
    }
  };

    const performSearch = useCallback(
    async (
      searchQuery,
      currentOffset = 0,
      currentDb = selectedDb,
      currentMat = matFilter,
      currentPitaka = pitakaFilter,
      currentDist = distanceFilter,
      currentSort = sortOption
    ) => {
      const minLen = getMinSearchLength(searchQuery);
      if (!searchQuery || searchQuery.trim().length < minLen) {
        setResults([]);
        setTotal(0);
        setOffset(0);
        return;
      }

      if (currentOffset === 0) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        setLoading(true);
        setResults([]);
        setTotal(0);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const langCode = (currentDb !== 'fts_tipitaka.db' && currentDb !== 'pali')
          ? normalizeLangCode(currentDb)
          : null;
        const data = await searchTipitaka(searchQuery, {
          db: currentDb,
          l: langCode,
          mat: currentMat,
          pitaka: currentPitaka,
          distance: currentDist,
          sort: currentSort,
          limit: 50,
          offset: currentOffset,
          signal: abortControllerRef.current?.signal,
        });

        const newResults = data.results || [];
        if (currentOffset === 0) {
          setResults(newResults);
          setOffset(0);
        } else {
          setResults((prev) => [...prev, ...newResults]);
          setOffset(currentOffset);
        }
        setTotal(data.total || 0);
        updateUrlParams({
          q: searchQuery,
          l: langCode,
          db: null,
          lang: null,
        });
      } catch (err) {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
        setError(err.message);
        if (currentOffset === 0) setResults([]);
      } finally {
        if (!abortControllerRef.current?.signal?.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [selectedDb, matFilter, pitakaFilter, distanceFilter, sortOption, updateUrlParams]
  );

  useEffect(() => {
    performSearchRef.current = performSearch;
  });

  useEffect(() => {
    if (!isSearchOpen) {
      handledInitialQueryRef.current = null;
      return;
    }

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, 50);

    if (searchInitialQuery && handledInitialQueryRef.current !== searchInitialQuery) {
      handledInitialQueryRef.current = searchInitialQuery;
      const raw = searchInitialQuery;
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const urlDb = urlParams?.get('l') || urlParams?.get('lang') || urlParams?.get('db');
      let effectiveDb = selectedDb;
      if (urlDb) {
        const resolved = resolveDbFromLangParam(urlDb, displayedDatabases);
        if (resolved) {
          effectiveDb = resolved;
          setSelectedDb(resolved);
        }
      }
      const isPali = effectiveDb === 'fts_tipitaka.db' || effectiveDb === 'pali';
      let displayedVal = raw;
      if (isPali) {
        const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
        displayedVal = hasNonLatin ? raw : typeVelthuis(raw);
      }
      setQuery(displayedVal);

      const searchQuery = isPali ? convertAnyToRoman(displayedVal).trim() : displayedVal.trim();
      const minLen = getMinSearchLength(searchQuery);
      if (searchQuery.length >= minLen) {
        performSearchRef.current?.(searchQuery, 0, effectiveDb);
      }
    }
  }, [isSearchOpen, searchInitialQuery, displayedDatabases]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSearchOpen) {
        closeSearchModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, closeSearchModal]);

  const handleInputChange = (e) => {
    const raw = e.target.value;
    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
    let displayedVal = raw;
    if (isPali) {
      const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
      displayedVal = hasNonLatin ? raw : typeVelthuis(raw);
    }
    setQuery(displayedVal);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const searchQuery = isPali ? convertAnyToRoman(displayedVal).trim() : displayedVal.trim();
    const minLen = getMinSearchLength(searchQuery);
    if (searchQuery.length < minLen) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      if (searchQuery.length === 0) {
        updateUrlParams({ q: null, l: null, db: null, lang: null });
      }
      return;
    }

    setLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      performSearch(searchQuery, 0, selectedDb);
    }, 250);
  };

  const handleDbChange = (e) => {
    const newDb = e.target.value;
    setSelectedDb(newDb);
    setResults([]);
    setTotal(0);
    savePrefs(matFilter, pitakaFilter, distanceFilter, sortOption, newDb);

    const isNewPali = newDb === 'fts_tipitaka.db' || newDb === 'pali';
    const langCode = !isNewPali ? normalizeLangCode(newDb) : null;
    updateUrlParams({ l: langCode, db: null, lang: null });

    const searchQuery = isNewPali ? convertAnyToRoman(query).trim() : query.trim();
    const minLen = getMinSearchLength(searchQuery);
    if (searchQuery.length >= minLen) {
      performSearch(searchQuery, 0, newDb);
    }
  };

  const handleFilterChange = (type, value) => {
    let newMat = matFilter;
    let newPitaka = pitakaFilter;
    let newDist = distanceFilter;
    let newSort = sortOption;

    if (type === 'mat') {
      newMat = value;
      setMatFilter(value);
    } else if (type === 'pitaka') {
      newPitaka = value;
      setPitakaFilter(value);
    } else if (type === 'distance') {
      newDist = value;
      setDistanceFilter(value);
    } else if (type === 'sort') {
      newSort = value;
      setSortOption(value);
    }

    savePrefs(newMat, newPitaka, newDist, newSort, selectedDb);

    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
    const searchQuery = isPali ? convertAnyToRoman(query).trim() : query.trim();
    const minLen = getMinSearchLength(searchQuery);
    if (searchQuery.length >= minLen) {
      performSearch(searchQuery, 0, selectedDb, newMat, newPitaka, newDist, newSort);
    }
  };

  const handleSelectExample = (exampleQuery) => {
    setQuery(exampleQuery);
    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
    const searchQuery = isPali ? convertAnyToRoman(exampleQuery).trim() : exampleQuery.trim();
    performSearch(searchQuery, 0, selectedDb);
    inputRef.current?.focus();
  };

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    const nextOffset = offset + 50;
    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
    const searchQuery = isPali ? convertAnyToRoman(query).trim() : query.trim();
    const minLen = getMinSearchLength(searchQuery);
    if (searchQuery.length >= minLen) {
      performSearch(searchQuery, nextOffset, selectedDb);
    }
  };

  const handleResultClick = async (result) => {
    closeSearchModal();
    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
    const romanQuery = isPali ? convertAnyToRoman(query).trim() : query.trim();
    // para_num can be empty string for headings (e.g. Paṭhamakoṭigāmasuttaṃ); treat empty as undefined so para_index fallback is used
    const cleanParaNum = result.para_num && String(result.para_num).trim() ? String(result.para_num).trim() : undefined;

    // If result is from a translation database, ensure that translation layer is enabled in reader settings
    if (!isPali && (result.lang || selectedDb !== 'fts_tipitaka.db')) {
      const transLangKey = toLangKey(result.lang || selectedDb);
      if (transLangKey && transLangKey !== 'pali' && (!settings?.translations || !settings.translations[transLangKey])) {
        updateSetting('translations', {
          ...(settings?.translations || {}),
          [transLangKey]: true,
        });
      }
    }

    const cleanLangCode = !isPali ? normalizeLangCode(result.lang || selectedDb) : 'pali';

    await openBook(result.book_code, {
      targetParaIndex: result.para_index,
      targetParaNum: isPali ? cleanParaNum : undefined,
      highlightQuery: romanQuery,
      searchQuery: romanQuery || query.trim(),
      lang: cleanLangCode,
      l: cleanLangCode !== 'pali' ? cleanLangCode : null,
      db: selectedDb,
    });
  };

  if (!isSearchOpen) return null;

  return (
    <div className="modal-overlay active" onClick={closeSearchModal}>
      <div className="modal-card modal-card-search" onClick={(e) => e.stopPropagation()}>
        {/* Search Header Row — redesigned with FTS database selector before input field */}
        <div className="p-2 sm:p-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-1.5 sm:gap-2 shrink-0 select-none">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
              const searchQuery = isPali ? convertAnyToRoman(query).trim() : query.trim();
              const minLen = getMinSearchLength(searchQuery);
              if (searchQuery.length >= minLen) {
                performSearch(searchQuery, 0, selectedDb);
              }
              inputRef.current?.blur();
            }}
            className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0"
          >
            {/* Dropdown menu to select the FTS database to search */}
            <div className="relative shrink-0">
              <select
                value={selectedDb}
                onChange={handleDbChange}
                aria-label="Select FTS database"
                title={isPaliDb ? 'Pāḷi CST' : `Translation FTS: ${displayedDatabases.find((d) => d.id === selectedDb)?.label || selectedDb}`}
                className={`search-select-dropdown text-xs sm:text-sm py-1.5 sm:py-2 px-2 rounded-xl font-medium transition cursor-pointer max-w-[125px] sm:max-w-[190px] text-ellipsis ${
                  !isPaliDb
                    ? '!border-red-500 !text-red-600 !bg-red-50 font-semibold dark:!bg-red-950/30 dark:!border-red-400 dark:!text-red-400'
                    : 'bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]'
                }`}
              >
                {displayedDatabases.map((dbOpt) => (
                  <option key={dbOpt.id} value={dbOpt.id}>
                    {dbOpt.flag ? `${dbOpt.flag} ` : ''}{dbOpt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--accent)] pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                placeholder={
                  isPaliDb
                    ? 'Full text search - Velthuis & 17 pāḷi scripts input accepted'
                    : `Search ${
                        displayedDatabases.find((d) => d.id === selectedDb)?.label ||
                        (normalizeLangCode(selectedDb) || '').toUpperCase()
                      } translation...`
                }
                value={query}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target?.blur();
                    const isPali = selectedDb === 'fts_tipitaka.db' || selectedDb === 'pali';
                    const searchQuery = isPali ? convertAnyToRoman(query).trim() : query.trim();
                    const minLen = getMinSearchLength(searchQuery);
                    if (searchQuery.length >= minLen) {
                      performSearch(searchQuery, 0, selectedDb);
                    }
                  }
                }}
                autoComplete="off"
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-1.5 sm:py-2 pl-9 pr-8 text-xs sm:text-sm outline-none focus:border-[var(--accent)] text-[var(--text-primary)] shadow-2xs transition"
              />
              {query && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setQuery('');
                    setResults([]);
                    setTotal(0);
                  }}
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setTotal(0);
                    updateUrlParams({ q: null, l: null, db: null, lang: null });
                    inputRef.current?.focus();
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] active:bg-[var(--bg-secondary)] cursor-pointer touch-manipulation z-20"
                  title="Clear input"
                  aria-label="Clear input"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </form>
          <button
            type="button"
            onClick={closeSearchModal}
            className="flex items-center px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs font-medium shadow-2xs transition cursor-pointer shrink-0"
            title="Close search (Esc)"
            aria-label="Close search"
          >
            <span>Close</span>
          </button>
        </div>

        {/* Search Filters & Controls Toolbar */}
        <div className="search-filter-toolbar">
          {/* MAT Filter Segmented Buttons */}
          <div className="search-filter-item">
            <span className="search-filter-label">Group:</span>
            <div className="search-mat-pills">
              {MAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`search-mat-pill ${matFilter === opt.id ? 'active' : ''}`}
                  onClick={() => handleFilterChange('mat', opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Piṭaka Filter Dropdown */}
          <div className="search-filter-item">
            <span className={`search-filter-label ${pitakaFilter !== 'all' ? '!text-red-600 font-bold' : ''}`}>Piṭaka:</span>
            <select
              value={pitakaFilter}
              onChange={(e) => handleFilterChange('pitaka', e.target.value)}
              className={`search-select-dropdown ${pitakaFilter !== 'all' ? '!border-red-500 !text-red-600 !bg-red-50 font-semibold dark:!bg-red-950/30 dark:!border-red-400 dark:!text-red-400' : ''}`}
            >
              {PITAKA_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Word Distance Dropdown */}
          <div className="search-filter-item">
            <span className={`search-filter-label ${distanceFilter !== 'any' ? '!text-red-600 font-bold' : ''}`}>Distance:</span>
            <select
              value={distanceFilter}
              onChange={(e) => handleFilterChange('distance', e.target.value)}
              className={`search-select-dropdown ${distanceFilter !== 'any' ? '!border-red-500 !text-red-600 !bg-red-50 font-semibold dark:!bg-red-950/30 dark:!border-red-400 dark:!text-red-400' : ''}`}
            >
              {DISTANCE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="search-filter-item">
            <span className="search-filter-label">Sort:</span>
            <select
              value={sortOption}
              onChange={(e) => handleFilterChange('sort', e.target.value)}
              className="search-select-dropdown font-medium"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Modal Body / Results */}
        <div className="modal-body">
          {loading && (
            <div className="loading-view py-8">
              <Loader2 size={24} className="spinner" />
              <div>
                Searching {isPaliDb ? 'Tipiṭaka' : 'translation'} for &ldquo;<strong>{query}</strong>&rdquo;...
              </div>
            </div>
          )}

          {error && <div className="search-error">Search error: {error}</div>}

          {!loading && !error && query.trim().length === 0 && (
            <div className="search-empty-container p-1 sm:p-2">
              <SupportedSearchTable onSelectExample={handleSelectExample} isPaliDb={isPaliDb} />
              {!isPaliDb && (
                <div className="search-empty-state">
                  Type to search across the {displayedDatabases.find((d) => d.id === selectedDb)?.label || selectedDb} translation database...
                </div>
              )}
            </div>
          )}

          {!loading && !error && query.trim().length > 0 && results.length === 0 && (
            <div className="search-no-results-container p-1 sm:p-2">
              <div className="search-empty-state mb-2">
                No results found for &ldquo;<strong>{query}</strong>&rdquo;
                {isPaliDb && convertAnyToRoman(query).trim() !== query.trim() && (
                  <span className="text-[var(--text-muted)] text-xs ml-1 font-mono">
                    ({convertAnyToRoman(query).trim()})
                  </span>
                )}
                {matFilter !== 'all' || pitakaFilter !== 'all' || distanceFilter !== 'any' ? (
                  <div className="mt-2 text-xs text-[var(--text-muted)]">
                    (Filters active: {matFilter !== 'all' ? `Group=${matFilter} ` : ''}
                    {pitakaFilter !== 'all' ? `Piṭaka=${pitakaFilter} ` : ''}
                    {distanceFilter !== 'any' ? `Distance=${distanceFilter} ` : ''})
                  </div>
                ) : null}
              </div>
              <SupportedSearchTable onSelectExample={handleSelectExample} isPaliDb={isPaliDb} />
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="search-summary-bar">
                <span>
                  Found <strong>{total.toLocaleString()}</strong> matches {!isPaliDb && <span className="text-red-600 dark:text-red-400 font-semibold">({displayedDatabases.find((d) => d.id === selectedDb)?.label || (normalizeLangCode(selectedDb) || '').toUpperCase()})</span>} for &ldquo;<strong>{query}</strong>&rdquo;
                  {isPaliDb && convertAnyToRoman(query).trim() !== query.trim() && (
                    <span className="text-[var(--text-muted)] text-xs ml-1 font-mono">
                      ({convertAnyToRoman(query).trim()})
                    </span>
                  )}
                  :
                </span>
                <span className="text-xs">
                  Showing {results.length} of {total.toLocaleString()}
                </span>
              </div>
              <div className="search-results-list">
                {results.map((r, i) => (
                  <SearchResultItem
                    key={`${r.book_code}-${r.para_index || i}-${i}`}
                    result={r}
                    onClick={() => handleResultClick(r)}
                  />
                ))}
              </div>

              {results.length < total && (
                <div className="flex justify-center mt-4 mb-2">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 text-xs font-semibold rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-active)] border border-[var(--border-color)] text-[var(--text-primary)] transition-all flex items-center gap-2"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={14} className="spinner" />
                        Loading more matches...
                      </>
                    ) : (
                      `Load More (+50 of ${(total - results.length).toLocaleString()} remaining)`
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

