'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Filter, SlidersHorizontal, ArrowUpDown, ChevronDown } from 'lucide-react';
import SearchResultItem from './SearchResultItem';
import { searchTipitaka } from '../../services/api';
import { useTabs } from '../../context/TabContext';
import { typeVelthuis, convertAnyToRoman } from '../../services/transliterate';

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

const SEARCH_PREFS_KEY = 'tipitaka_search_prefs_v1';

export default function SearchModal() {
  const { isSearchOpen, searchInitialQuery, closeSearchModal, openBook, updateUrlParams } =
    useTabs();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);

  // Search Filter and Sort Controls (Default: Piṭaka Sort, Any Distance, All MAT, All Piṭakas)
  const [matFilter, setMatFilter] = useState('all');
  const [pitakaFilter, setPitakaFilter] = useState('all');
  const [distanceFilter, setDistanceFilter] = useState('any');
  const [sortOption, setSortOption] = useState('pitaka');

  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Load saved preferences on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SEARCH_PREFS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mat) setMatFilter(parsed.mat);
        if (parsed.pitaka) setPitakaFilter(parsed.pitaka);
        if (parsed.distance) setDistanceFilter(parsed.distance);
        if (parsed.sort) setSortOption(parsed.sort);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save preferences whenever they change
  const savePrefs = (mat, pitaka, distance, sort) => {
    try {
      localStorage.setItem(
        SEARCH_PREFS_KEY,
        JSON.stringify({ mat, pitaka, distance, sort })
      );
    } catch {
      // Ignore quota errors
    }
  };

  const performSearch = useCallback(
    async (searchQuery, currentOffset = 0, currentMat = matFilter, currentPitaka = pitakaFilter, currentDist = distanceFilter, currentSort = sortOption) => {
      if (!searchQuery || searchQuery.trim().length < 2) {
        setResults([]);
        setTotal(0);
        setOffset(0);
        return;
      }

      if (currentOffset === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const data = await searchTipitaka(searchQuery, {
          mat: currentMat,
          pitaka: currentPitaka,
          distance: currentDist,
          sort: currentSort,
          limit: 50,
          offset: currentOffset,
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
        updateUrlParams({ q: searchQuery });
      } catch (err) {
        setError(err.message);
        if (currentOffset === 0) setResults([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [matFilter, pitakaFilter, distanceFilter, sortOption, updateUrlParams]
  );

  useEffect(() => {
    if (isSearchOpen) {
      if (searchInitialQuery) {
        const raw = searchInitialQuery;
        const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
        const displayedVal = hasNonLatin ? raw : typeVelthuis(raw);
        setQuery(displayedVal);

        const romanQuery = convertAnyToRoman(displayedVal).trim();
        if (romanQuery.length >= 2) {
          performSearch(romanQuery, 0);
        }
      }

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 50);
    }
  }, [isSearchOpen, searchInitialQuery, performSearch]);

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
    const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
    const displayedVal = hasNonLatin ? raw : typeVelthuis(raw);
    setQuery(displayedVal);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const romanQuery = convertAnyToRoman(displayedVal).trim();
    if (romanQuery.length < 2) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      performSearch(romanQuery, 0);
    }, 250);
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

    savePrefs(newMat, newPitaka, newDist, newSort);

    const romanQuery = convertAnyToRoman(query).trim();
    if (romanQuery.length >= 2) {
      performSearch(romanQuery, 0, newMat, newPitaka, newDist, newSort);
    }
  };

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    const nextOffset = offset + 50;
    const romanQuery = convertAnyToRoman(query).trim();
    if (romanQuery.length >= 2) {
      performSearch(romanQuery, nextOffset);
    }
  };

  const handleResultClick = async (result) => {
    closeSearchModal();
    const romanQuery = convertAnyToRoman(query).trim();
    await openBook(result.book_code, {
      targetParaIndex: result.para_index,
      targetParaNum: result.para_num,
      highlightQuery: romanQuery,
      searchQuery: query.trim() || romanQuery,
    });
  };

  if (!isSearchOpen) return null;

  return (
    <div className="modal-overlay active" onClick={closeSearchModal}>
      <div className="modal-card modal-card-search" onClick={(e) => e.stopPropagation()}>
        {/* Search Header Row */}
        <div className="modal-header p-3 sm:p-4 pb-2">
          <div className="flex items-center gap-2.5 w-full">
            <Search size={18} className="modal-search-icon shrink-0 text-[var(--accent)]" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Full text search - Velthuis & 17 pāḷi scripts input accepted"
              value={query}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.target?.blur();
                  const romanQuery = convertAnyToRoman(query).trim();
                  if (romanQuery.length >= 2) {
                    performSearch(romanQuery, 0);
                  }
                }
              }}
              autoComplete="off"
              className="flex-1 text-sm sm:text-base outline-none bg-transparent"
            />
            {query && (
              <button
                type="button"
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer touch-manipulation"
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
                  inputRef.current?.focus();
                }}
                title="Clear input"
                aria-label="Clear input"
              >
                <X size={15} />
              </button>
            )}
            <button
              className="btn-icon p-1.5"
              onClick={closeSearchModal}
              title="Close search (Esc)"
            >
              <X size={18} />
            </button>
          </div>
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
            <span className="search-filter-label">Piṭaka:</span>
            <select
              value={pitakaFilter}
              onChange={(e) => handleFilterChange('pitaka', e.target.value)}
              className="search-select-dropdown"
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
            <span className="search-filter-label">Distance:</span>
            <select
              value={distanceFilter}
              onChange={(e) => handleFilterChange('distance', e.target.value)}
              className="search-select-dropdown"
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
                Searching Tipiṭaka for &ldquo;<strong>{query}</strong>&rdquo;...
              </div>
            </div>
          )}

          {error && <div className="search-error">Search error: {error}</div>}

          {!loading && !error && query.trim().length < 2 && (
            <div className="search-empty-state">
              Type 2 or more characters to search across all 217 books...
            </div>
          )}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="search-empty-state">
              No results found for &ldquo;<strong>{query}</strong>&rdquo;
              {convertAnyToRoman(query).trim() !== query.trim() && (
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
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="search-summary-bar">
                <span>
                  Found <strong>{total.toLocaleString()}</strong> matches for &ldquo;<strong>{query}</strong>&rdquo;
                  {convertAnyToRoman(query).trim() !== query.trim() && (
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

