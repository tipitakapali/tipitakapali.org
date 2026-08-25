'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  BookA,
  X,
  Search,
  ArrowLeft,
  ArrowRight,
  HelpCircle,
  Keyboard,
  Layers,
  PanelBottom,
  PanelRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Sparkles,
  ExternalLink,
  Split,
  BookOpen,
  Languages,
  RotateCcw,
} from 'lucide-react';
import { useDictionary } from '../context/DictionaryContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertAnyToRoman, convertPaliScript, transliterateHtml } from '../services/transliterate';
import { fetchDictionaryInflection } from '../services/api';

// Helper to highlight exact matching inflections in table cells (CC BY-NC-SA 4.0 DPD)
function highlightInflections(searchTerm, container) {
  if (!searchTerm || !container) return;
  const normalizedSearch = searchTerm.toLowerCase().trim();
  const inflectionTables = container.querySelectorAll('table.inflection');

  inflectionTables.forEach((table) => {
    const cells = table.querySelectorAll('td');
    cells.forEach((cell) => {
      const cellHTML = cell.innerHTML;
      const parts = cellHTML.split(/<br\s*\/?>/i);
      let modified = false;

      const newParts = parts.map((part) => {
        const tempElement = document.createElement('div');
        tempElement.innerHTML = part;
        const partText = (tempElement.textContent || '').toLowerCase().trim();

        if (partText === normalizedSearch) {
          modified = true;
          return `<span class="inflection-highlight font-bold text-[var(--accent)] bg-[var(--accent-light)] px-1 py-0.5 rounded shadow-xs">${part}</span>`;
        }
        return part;
      });

      if (modified) {
        cell.innerHTML = newParts.join('<br>');
      }
    });
  });
}

// Helper to transliterate table cells into reader's target script
function convertPaliTableCells(container, selectTable = 'table.inflection', onlyCell = 'td', removeBoldTag = false, targetScript = 'roman') {
  if (!container || !targetScript || targetScript === 'roman') return;
  const tables = container.querySelectorAll(selectTable);
  tables.forEach((table) => {
    const cells = table.querySelectorAll(onlyCell);
    cells.forEach((cell) => {
      const converted = convertPaliScript(cell.textContent || '', targetScript);
      if (converted) {
        cell.innerHTML = `<b>${converted}</b>`;
      }
    });
  });
}

export default function DictionaryModal() {
  const {
    isOpen,
    queryWord,
    displayWord,
    activeDictTab,
    dockMode,
    fontSizeMultiplier,
    history,
    historyIndex,
    lookupData,
    isLoading,
    error,
    openDictionary,
    closeDictionary,
    performLookup,
    goBack,
    goForward,
    setDictTab,
    setDockMode,
    setFontSizeMultiplier,
    setDisplayWord,
  } = useDictionary();

  const { settings } = useThemeSettings();
  const [showVelthuisHelp, setShowVelthuisHelp] = useState(false);
  const [localInput, setLocalInput] = useState('');
  const inputRef = useRef(null);
  const contentContainerRef = useRef(null);

  const currentScript = settings?.paliScript || 'roman';

  // Synchronize local input with context display word
  useEffect(() => {
    setLocalInput(displayWord || queryWord || '');
  }, [displayWord, queryWord]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 80);
    }
  }, [isOpen]);

  // Register global window.playAudio for inline DPD audio buttons (Fix 3)
  useEffect(() => {
    window.playAudio = function (headword, buttonElement) {
      if (!headword) return;
      const gender = 'male';
      const baseUrl = 'https://www.dpdict.net/audio/';
      const audioUrl = `${baseUrl}${encodeURIComponent(headword)}?gender=${gender}`;
      const audio = new Audio(audioUrl);

      audio.addEventListener('error', () => {
        if (buttonElement) {
          buttonElement.innerHTML = `
            <svg viewBox="0 0 24 24" width="14px" height="14px" fill="none" stroke="currentColor" stroke-width="2" class="text-rose-500 inline-block">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          `;
          buttonElement.classList.add('disabled');
          buttonElement.style.pointerEvents = 'none';
          buttonElement.title = 'Audio not found';
          buttonElement.removeAttribute('onclick');
        }
      });

      audio.play().catch((err) => {
        console.warn('Audio play failed:', err);
      });
    };

    return () => {
      try {
        delete window.playAudio;
      } catch (e) {}
    };
  }, []);

  // Handle word search submission
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (localInput.trim()) {
      performLookup(localInput.trim(), true);
    }
  };

  // Intercept clicks inside definitions (DPD buttons, inflection loader, auto-collapse, word jump)
  const handleContentClick = useCallback(
    async (e) => {
      // 1. Handle Audio play button clicks
      const playBtn = e.target.closest('a.dpd-button.play, button.play, a.play');
      if (playBtn) {
        e.preventDefault();
        e.stopPropagation();
        const onclickAttr = playBtn.getAttribute('onclick') || '';
        const match = onclickAttr.match(/playAudio\(['"]([^'"]+)['"]/);
        const headword = match ? match[1] : queryWord;
        if (typeof window.playAudio === 'function' && headword) {
          window.playAudio(headword, playBtn);
        }
        return;
      }

      // 2. Handle DPD interactive button clicks (grammar, examples, declension, conjugation, families, fb)
      const buttonEl = e.target.closest('a.dpd-button, a.button, button[data-target]');
      if (buttonEl) {
        e.preventDefault();
        e.stopPropagation();

        const targetId = buttonEl.getAttribute('data-target');
        if (!targetId) return;

        // Find enclosing entry container (div.dpd or section.dp9)
        const entryEl =
          buttonEl.closest('div.dpd') ||
          buttonEl.closest('section.dp9') ||
          buttonEl.closest('.dict-entry-box') ||
          contentContainerRef.current;

        const targetDiv = entryEl?.querySelector(`#${CSS.escape(targetId)}`) || document.getElementById(targetId);
        if (!targetDiv) return;

        const isCurrentlyHidden = targetDiv.classList.contains('hidden');

        // Fix 4: Auto-collapse all other button data in this entry so user doesn't need to scroll up and down
        if (entryEl) {
          const allContentDivs = entryEl.querySelectorAll(
            '[id^="grammar_"], [id^="examples_"], [id^="declension_"], [id^="conjugation_"], [id^="family_"], [id^="feedback_"], div.content'
          );
          allContentDivs.forEach((d) => {
            if (d !== targetDiv) {
              d.classList.add('hidden');
            }
          });

          const allButtons = entryEl.querySelectorAll('a.dpd-button, a.button');
          allButtons.forEach((b) => {
            if (b !== buttonEl) {
              b.classList.remove('active');
            }
          });
        }

        // Toggle state of clicked button & content
        if (isCurrentlyHidden) {
          // Fix 2: Fetch and render inflection table if empty or loading
          if (
            (targetId.startsWith('declension_') || targetId.startsWith('conjugation_')) &&
            (targetDiv.innerHTML.trim().length < 10 || targetDiv.innerHTML.includes('Loading'))
          ) {
            targetDiv.innerHTML = '<div class="p-3 text-xs text-[var(--text-muted)] animate-pulse">Loading inflection table...</div>';
            targetDiv.classList.remove('hidden');
            buttonEl.classList.add('active');

            try {
              const res = await fetchDictionaryInflection(targetId);
              if (res && res.html) {
                targetDiv.innerHTML = res.html;

                // Highlight matching search word in table
                if (queryWord) {
                  highlightInflections(queryWord, targetDiv);
                }

                // Transliterate if not Roman
                if (currentScript && currentScript !== 'roman') {
                  convertPaliTableCells(targetDiv, 'table.inflection', 'td', true, currentScript);
                }
              } else {
                targetDiv.innerHTML = '<div class="p-2.5 text-xs text-rose-500">Inflection table not available.</div>';
              }
            } catch (err) {
              targetDiv.innerHTML = `<div class="p-2.5 text-xs text-rose-500">Failed to load: ${err.message}</div>`;
            }
          } else {
            targetDiv.classList.remove('hidden');
            buttonEl.classList.add('active');
          }

          // Smoothly scroll target content into view
          setTimeout(() => {
            targetDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 30);
        } else {
          targetDiv.classList.add('hidden');
          buttonEl.classList.remove('active');
        }
        return;
      }

      // 3. Handle clicks on clickable terms / jumps inside definitions (Recursive lookup)
      const jumpLink = e.target.closest('a.jump, a.link, span.p1w, span.p2w, span.p3w, .dec-term');
      if (jumpLink) {
        const text = jumpLink.textContent?.trim();
        if (text && text.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          const cleanWord = text.replace(/^[√\d\s\.\-]+/, '').trim();
          if (cleanWord) {
            performLookup(cleanWord, true);
          }
        }
      }
    },
    [queryWord, currentScript, performLookup]
  );

  // Dictionary tab specifications
  const DICT_TABS = useMemo(
    () => [
      { id: 'dpd', label: 'DPD', desc: 'Digital Pāḷi Dictionary', count: lookupData?.counts?.dpd || 0 },
      { id: 'pts', label: 'PTS', desc: 'Pali Text Society PED', count: lookupData?.counts?.pts || 0 },
      { id: 'abd', label: 'အဘိဓာန်', desc: 'Abhidhānappadīpikā (MM)', count: lookupData?.counts?.abd || 0 },
      { id: 'psd', label: 'පාලි-සිංහල', desc: 'Pāli-Sinhala Dictionary', count: lookupData?.counts?.psd || 0 },
      { id: 'sans', label: 'Sanskrit', desc: 'Apte / Monier-Williams', count: lookupData?.counts?.sans || 0 },
      { id: 'splitter', label: 'Splitter', desc: 'Compound Deconstructor', count: lookupData?.counts?.splitter || 0 },
    ],
    [lookupData]
  );

  // Active results list for current tab
  const currentTabResults = useMemo(() => {
    if (!lookupData) return [];
    if (activeDictTab === 'dpd') return lookupData.dpd || [];
    if (activeDictTab === 'pts') return lookupData.pts || [];
    if (activeDictTab === 'abd') return lookupData.abd || [];
    if (activeDictTab === 'psd') return lookupData.psd || [];
    if (activeDictTab === 'sans') return lookupData.sans || [];
    if (activeDictTab === 'splitter') return lookupData.splitter || [];
    return [];
  }, [lookupData, activeDictTab]);

  if (!isOpen) return null;

  return (
    <div
      className={dockMode === 'modal' ? 'dict-overlay animate-fade-in' : ''}
      onClick={dockMode === 'modal' ? closeDictionary : undefined}
    >
      <div
        className={`dict-panel-${dockMode} flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-color)]`}
        style={{ '--dict-font-size': `${13.5 * fontSizeMultiplier}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========================================================= */}
        {/* Top Header Bar */}
        {/* ========================================================= */}
        <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between gap-2 select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center text-[var(--accent)] shrink-0">
              <BookA size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold tracking-tight text-[var(--text-primary)] truncate">
                  Pāḷi Dictionary
                </h3>
                {queryWord && (
                  <span className="hidden sm:inline-block text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--accent)] font-semibold truncate max-w-[140px]">
                    {queryWord}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* History Back / Forward */}
            <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5">
              <button
                onClick={goBack}
                disabled={historyIndex <= 0}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                title="Previous lookup (Back)"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                onClick={goForward}
                disabled={historyIndex >= history.length - 1}
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                title="Next lookup (Forward)"
              >
                <ArrowRight size={13} />
              </button>
            </div>

            {/* Font Size Adjust */}
            <div className="hidden sm:flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5 text-[11px]">
              <button
                onClick={() => setFontSizeMultiplier((f) => f - 0.1)}
                className="px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] font-bold transition cursor-pointer"
                title="Smaller font"
              >
                A-
              </button>
              <span className="px-1 font-mono text-[10px] text-[var(--text-secondary)]">
                {Math.round(fontSizeMultiplier * 100)}%
              </span>
              <button
                onClick={() => setFontSizeMultiplier((f) => f + 0.1)}
                className="px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] font-bold transition cursor-pointer"
                title="Larger font"
              >
                A+
              </button>
            </div>

            {/* Dock Position Switcher */}
            <div className="hidden md:flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5">
              <button
                onClick={() => setDockMode('modal')}
                className={`p-1 rounded transition cursor-pointer ${dockMode === 'modal' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Center Modal mode"
              >
                <Maximize2 size={13} />
              </button>
              <button
                onClick={() => setDockMode('bottom')}
                className={`p-1 rounded transition cursor-pointer ${dockMode === 'bottom' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Bottom Drawer mode"
              >
                <PanelBottom size={13} />
              </button>
              <button
                onClick={() => setDockMode('side')}
                className={`p-1 rounded transition cursor-pointer ${dockMode === 'side' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Right Side Panel mode"
              >
                <PanelRight size={13} />
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={closeDictionary}
              className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
              title="Close dictionary (Esc)"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* Search Input Bar & Velthuis Shortcuts */}
        {/* ========================================================= */}
        <div className="p-3 bg-[var(--bg-primary)] border-b border-[var(--border-color)] space-y-2 shrink-0">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                type="text"
                value={localInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
                  const converted = hasNonLatin ? raw : typeVelthuis(raw);
                  setLocalInput(converted);
                  setDisplayWord(converted);
                }}
                placeholder="Type Pali term or Velthuis (e.g. buddha, bhikkhu, anatta, dhamma, nibbaana)..."
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 pl-9 pr-8 text-xs sm:text-sm outline-none focus:border-[var(--accent)] text-[var(--text-primary)] shadow-xs transition"
              />
              {localInput && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalInput('');
                    setDisplayWord('');
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !localInput.trim()}
              className="px-3.5 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:pointer-events-none shadow-xs transition shrink-0 cursor-pointer"
            >
              {isLoading ? 'Searching...' : 'Search'}
            </button>
          </form>

          {/* Guide toggle button */}
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] px-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <Keyboard size={12} className="text-[var(--accent)] shrink-0" />
              <span className="truncate">Velthuis & 17 scripts input accepted</span>
            </div>
            <button
              type="button"
              onClick={() => setShowVelthuisHelp((prev) => !prev)}
              className="text-[var(--accent)] hover:underline font-semibold cursor-pointer shrink-0 ml-auto flex items-center gap-1"
            >
              <HelpCircle size={12} />
              <span>{showVelthuisHelp ? 'Hide guide' : 'Typing guide'}</span>
            </button>
          </div>

          {/* Velthuis Shortcuts Table */}
          {showVelthuisHelp && (
            <div className="p-2.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-[11px] space-y-1.5 animate-fade-in">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[10.5px]">
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">aa, ii, uu</span>
                  <span className="font-bold text-[var(--accent)]">ā, ī, ū</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">.m, m..</span>
                  <span className="font-bold text-[var(--accent)]">ṃ, ṁ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">.t, .d</span>
                  <span className="font-bold text-[var(--accent)]">ṭ, ḍ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">.n, .l</span>
                  <span className="font-bold text-[var(--accent)]">ṇ, ḷ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">~n, ,,n</span>
                  <span className="font-bold text-[var(--accent)]">ñ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">"n, n..</span>
                  <span className="font-bold text-[var(--accent)]">ṅ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">.s, "s</span>
                  <span className="font-bold text-[var(--accent)]">ṣ, ś</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)] py-0.5">
                  <span className="text-[var(--text-muted)]">.h, .r</span>
                  <span className="font-bold text-[var(--accent)]">ḥ, ṛ</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================= */}
        {/* Dictionary Switcher Tabs Bar */}
        {/* ========================================================= */}
        <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {DICT_TABS.map((tab) => {
            const isActive = activeDictTab === tab.id;
            const hasMatches = tab.count > 0;
            return (
              <button
                key={tab.id}
                onClick={() => setDictTab(tab.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer select-none ${
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : hasMatches
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                }`}
                title={tab.desc}
              >
                <span>{tab.label}</span>
                {hasMatches ? (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive ? 'bg-white/25 text-white' : 'bg-[var(--accent-light)] text-[var(--accent)]'
                    }`}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* ========================================================= */}
        {/* Definition Content Body */}
        {/* ========================================================= */}
        <div
          ref={contentContainerRef}
          onClick={handleContentClick}
          className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4"
        >
          {/* Loading Indicator */}
          {isLoading && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
              <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium">Looking up &ldquo;{queryWord}&rdquo; across dictionaries...</span>
            </div>
          )}

          {/* Error Message */}
          {error && !isLoading && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Results List */}
          {!isLoading && currentTabResults.length > 0 && (
            <div className="space-y-4">
              {currentTabResults.map((item, idx) => {
                const rawHtml = item.html || '';
                const renderedHtml = currentScript !== 'roman' ? transliterateHtml(rawHtml, currentScript) : rawHtml;

                return (
                  <div
                    key={idx}
                    className="dict-entry-box p-3.5 sm:p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-xs transition"
                  >
                    {item.source && (
                      <div className="text-[10.5px] font-semibold text-[var(--accent)] mb-1.5 pb-1 border-b border-[var(--border-color)] flex items-center justify-between">
                        <span>{item.source}</span>
                        {item.isExact && <span className="text-[9.5px] uppercase font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded">Exact match</span>}
                      </div>
                    )}
                    <div
                      className="dp9 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* No results for current tab */}
          {!isLoading && currentTabResults.length === 0 && queryWord && (
            <div className="py-10 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--text-muted)]">
                <BookOpen size={20} />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                No entries found in <b>{DICT_TABS.find((t) => t.id === activeDictTab)?.label}</b> for &ldquo;{queryWord}&rdquo;.
              </p>
              {lookupData?.hasResults && (
                <p className="text-xs text-[var(--accent)]">
                  Check other tabs above for matching entries in different dictionaries.
                </p>
              )}
            </div>
          )}

          {/* Initial / Empty State with Suggestions */}
          {!isLoading && !queryWord && (
            <div className="py-8 text-center space-y-4 text-xs text-[var(--text-muted)]">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--accent)]">
                <Sparkles size={22} />
              </div>
              <div className="max-w-sm mx-auto space-y-1">
                <h4 className="font-bold text-[var(--text-primary)] text-sm">Comprehensive Pāḷi Dictionaries</h4>
                <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                  Type any Pāḷi word, root, or inflected form in the search box above, or double-click any word in the reader to look up definitions instantly.
                </p>
              </div>

              {/* Sample Quick Terms */}
              <div className="pt-2">
                <span className="text-[11px] text-[var(--text-muted)] block mb-2">Try quick lookup:</span>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {['buddha', 'dhamma', 'saṅgha', 'bhikkhu', 'nibbāna', 'anatta', 'dukkha', 'paññā', 'samādhi', 'mettā'].map((w) => (
                    <button
                      key={w}
                      onClick={() => performLookup(w, true)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] border border-[var(--border-color)] text-xs font-mono transition cursor-pointer"
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
