'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import SearchResultItem from './SearchResultItem';
import { searchTipitaka } from '../../services/api';
import { useTabs } from '../../context/TabContext';
import { typeVelthuis } from '../../services/transliterate';

export default function SearchModal() {
  const { isSearchOpen, searchInitialQuery, closeSearchModal, openBook, updateUrlParams } =
    useTabs();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const inputRef = useRef(null);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (isSearchOpen) {
      const q = typeVelthuis(searchInitialQuery || '');
      setQuery(q);
      if (q.trim().length >= 2) {
        performSearch(q);
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
    const val = typeVelthuis(raw);
    setQuery(val);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (val.trim().length < 2) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      performSearch(val.trim());
    }, 250);
  };

  const handleResultClick = async (result) => {
    closeSearchModal();
    await openBook(result.book_code, {
      targetParaIndex: result.para_index,
      targetParaNum: result.para_num,
      highlightQuery: query.trim(),
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
              placeholder="Search Pali words (e.g. kusalā, nibbāna, dukkha)..."
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

          {/* Pali Diacritic Keypad Chips */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-[var(--border-color)]/60">
            <span className="text-[10px] font-semibold text-[var(--text-muted)] mr-0.5">Pāli:</span>
            {['ā', 'ī', 'ū', 'ḍ', 'ṭ', 'ṇ', 'ṅ', 'ñ', 'ṃ', 'ḷ'].map((char) => (
              <button
                key={char}
                onClick={() => {
                  const updated = query + char;
                  setQuery(updated);
                  inputRef.current?.focus();
                  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                  if (updated.trim().length >= 2) {
                    setLoading(true);
                    debounceTimerRef.current = setTimeout(() => {
                      performSearch(updated.trim());
                    }, 250);
                  }
                }}
                className="px-2 py-0.5 rounded bg-[var(--bg-card)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] border border-[var(--border-color)] text-xs font-mono font-bold transition"
              >
                {char}
              </button>
            ))}
          </div>
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
              No results found for &ldquo;<strong>{query}</strong>&rdquo;.
            </div>
          )}

          {!loading && !error && results.length > 0 && (
            <>
              <div className="search-summary-bar">
                <span>
                  Found <strong>{total}</strong> matches (showing top {results.length}):
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
