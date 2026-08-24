'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, HelpCircle, Keyboard } from 'lucide-react';
import SearchResultItem from './SearchResultItem';
import { searchTipitaka } from '../../services/api';
import { useTabs } from '../../context/TabContext';
import { typeVelthuis, convertAnyToRoman } from '../../services/transliterate';

export default function SearchModal() {
  const { isSearchOpen, searchInitialQuery, closeSearchModal, openBook, updateUrlParams } =
    useTabs();

  const [query, setQuery] = useState('');
  const [showVelthuisHelp, setShowVelthuisHelp] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (isSearchOpen) {
      const raw = searchInitialQuery || '';
      const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
      const displayedVal = hasNonLatin ? raw : typeVelthuis(raw);
      setQuery(displayedVal);

      const romanQuery = convertAnyToRoman(displayedVal).trim();
      if (romanQuery.length >= 2) {
        performSearch(romanQuery);
      } else {
        setResults([]);
        setTotal(0);
      }
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
    }
  }, [isSearchOpen, searchInitialQuery]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSearchOpen) {
        closeSearchModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, closeSearchModal]);

  const performSearch = async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await searchTipitaka(searchQuery, { limit: 50 });
      setResults(data.results || []);
      setTotal(data.total || 0);
      updateUrlParams({ q: searchQuery });
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

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
      performSearch(romanQuery);
    }, 250);
  };

  const handleResultClick = async (result) => {
    closeSearchModal();
    const romanQuery = convertAnyToRoman(query).trim();
    await openBook(result.book_code, {
      targetParaIndex: result.para_index,
      targetParaNum: result.para_num,
      highlightQuery: romanQuery,
    });
  };

  if (!isSearchOpen) return null;

  return (
    <div className="modal-overlay active" onClick={closeSearchModal}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex-col items-stretch gap-2.5 p-3 sm:p-4">
          <div className="flex items-center gap-2.5 w-full">
            <Search size={18} className="modal-search-icon shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder='Full text Search (e.g. kusalā, nibbāna, dhamma)...'
              value={query}
              onChange={handleInputChange}
              autoComplete="off"
              className="flex-1 text-sm sm:text-base outline-none bg-transparent"
            />
            {query && (
              <button
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setTotal(0);
                  inputRef.current?.focus();
                }}
                title="Clear input"
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

          {/* Velthuis & 17 Multi-Script Typing Support Info & Guide */}
          <div className="flex items-center justify-between gap-3 sm:gap-4 text-[11px] text-[var(--text-muted)] pt-1.5 border-t border-[var(--border-color)]/60 px-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Keyboard size={13} className="text-[var(--accent)] shrink-0" />
              <span className="truncate sm:whitespace-normal">
                Velthuis & 17 scripts input accepted (Auto-converted to Roman)
              </span>
            </div>
            <button
              onClick={() => setShowVelthuisHelp((prev) => !prev)}
              className="flex items-center gap-1 text-[var(--accent)] hover:underline font-semibold cursor-pointer shrink-0 ml-auto"
              title="How to type Velthuis diacritics"
            >
              <HelpCircle size={13} className="shrink-0" />
              <span className="whitespace-nowrap">{showVelthuisHelp ? 'Hide guide' : 'Typing guide'}</span>
            </button>
          </div>

          {/* Velthuis Scheme Guide Table */}
          {showVelthuisHelp && (
            <div className="p-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-[11px] space-y-2 animate-fade-in mt-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Velthuis Pāḷi Typing Shortcuts</span>
                <span className="text-[10px] font-normal text-[var(--text-muted)]">Type as you speak</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px]">
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">aa, ii, uu</span>
                  <span className="font-bold text-[var(--accent)]">ā, ī, ū</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.m, m..</span>
                  <span className="font-bold text-[var(--accent)]">ṃ, ṁ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.t, .d</span>
                  <span className="font-bold text-[var(--accent)]">ṭ, ḍ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.n, .l</span>
                  <span className="font-bold text-[var(--accent)]">ṇ, ḷ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">~n, ,,n</span>
                  <span className="font-bold text-[var(--accent)]">ñ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">"n, n..</span>
                  <span className="font-bold text-[var(--accent)]">ṅ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.h, .r</span>
                  <span className="font-bold text-[var(--accent)]">ḥ, ṛ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.s, "s</span>
                  <span className="font-bold text-[var(--accent)]">ṣ, ś</span>
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] italic">
                * Uppercase is also supported (e.g. AA → Ā, .N → Ṇ).
              </div>
            </div>
          )}
        </div>


        <div className="modal-body">
          {loading && (
            <div className="loading-view">
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
              )}.
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="search-summary-bar">
                <span>
                  Found <strong>{total}</strong> matches for &ldquo;<strong>{query}</strong>&rdquo;
                  {convertAnyToRoman(query).trim() !== query.trim() && (
                    <span className="text-[var(--text-muted)] text-xs ml-1 font-mono">
                      ({convertAnyToRoman(query).trim()})
                    </span>
                  )}
                  :
                </span>
                <span>Click any result to jump</span>
              </div>
              <div className="search-results-list">
                {results.map((r, i) => (
                  <SearchResultItem
                    key={`${r.book_code}-${r.para_index || i}`}
                    result={r}
                    onClick={() => handleResultClick(r)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
