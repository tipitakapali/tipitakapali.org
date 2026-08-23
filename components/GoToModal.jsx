'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Navigation, Hash, BookOpen, CornerDownLeft, AlertCircle } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript } from '../services/transliterate';

export default function GoToModal({ isOpen, onClose }) {
  const { activeTab, openBook, activeParaNum } = useTabs();
  const { settings } = useThemeSettings();

  const [activeTabMode, setActiveTabMode] = useState('para'); // 'para' | 'page'
  const [paraInput, setParaInput] = useState('');
  const [pageInput, setPageInput] = useState('');
  const [pageSystem, setPageSystem] = useState('V'); // 'V' | 'P' | 'T' | 'M'
  const [errorMessage, setErrorMessage] = useState('');

  const inputRef = useRef(null);

  // 1. Direct precomputed paragraph limits (from server DB/JSON, 0ms compute)
  const paraRange = useMemo(() => {
    if (activeTab?.para_range) return activeTab.para_range;
    const pMap = activeTab?.para_to_chapter || {};
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const k of Object.keys(pMap)) {
      const n = parseInt(k, 10);
      if (!isNaN(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
        count++;
      }
    }
    if (count === 0) return { min: 1, max: 1, total: 0 };
    return { min, max, total: count };
  }, [activeTab]);

  // 2. Direct precomputed page limits per edition (from server DB/JSON, 0ms compute)
  const editionRanges = useMemo(() => {
    if (activeTab?.edition_ranges) return activeTab.edition_ranges;
    const res = {};
    const pageToChap = activeTab?.page_to_chapter || {};
    for (const sys of ['V', 'P', 'T', 'M']) {
      const pMap = pageToChap[sys] || {};
      const uniquePages = new Set();
      let minNum = Infinity;
      let maxNum = -Infinity;
      for (const p of Object.keys(pMap)) {
        let n = NaN;
        if (p.includes('.')) {
          const parts = p.split('.');
          n = parseInt(parts[1], 10);
        } else {
          n = parseInt(p, 10);
        }
        if (!isNaN(n)) {
          uniquePages.add(n);
          if (n < minNum) minNum = n;
          if (n > maxNum) maxNum = n;
        }
      }
      if (uniquePages.size === 0) {
        res[sys] = {
          available: false,
          count: 0,
          minNum: 1,
          maxNum: 1,
          label: 'Unavailable',
          hint: '1',
        };
      } else {
        res[sys] = {
          available: true,
          count: uniquePages.size,
          minNum,
          maxNum,
          label: `Page ${minNum} – ${maxNum}`,
          hint: `e.g. ${minNum} to ${maxNum}`,
        };
      }
    }
    return res;
  }, [activeTab]);

  const currentEdRange = editionRanges[pageSystem] || { available: false, label: 'Unavailable' };

  // 3. Dynamic quick paragraph chips
  const quickParaChips = useMemo(() => {
    if (!paraRange || paraRange.total === 0) return [1];
    const { min, max } = paraRange;
    if (max - min <= 5) {
      const arr = [];
      for (let i = min; i <= max; i++) arr.push(i);
      return arr;
    }
    const step1 = Math.round(min + (max - min) * 0.25);
    const step2 = Math.round(min + (max - min) * 0.5);
    const step3 = Math.round(min + (max - min) * 0.75);
    const set = new Set([min, step1, step2, step3, max]);
    return Array.from(set).sort((a, b) => a - b);
  }, [paraRange]);

  // 4. Dynamic quick page chips
  const quickPageChips = useMemo(() => {
    if (!currentEdRange.available) return [];
    const { minNum, maxNum } = currentEdRange;
    if (maxNum - minNum <= 5) {
      const arr = [];
      for (let i = minNum; i <= maxNum; i++) arr.push(i);
      return arr;
    }
    const step1 = Math.round(minNum + (maxNum - minNum) * 0.25);
    const step2 = Math.round(minNum + (maxNum - minNum) * 0.5);
    const step3 = Math.round(minNum + (maxNum - minNum) * 0.75);
    const set = new Set([minNum, step1, step2, step3, maxNum]);
    return Array.from(set).sort((a, b) => a - b);
  }, [currentEdRange]);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setParaInput(activeParaNum || '');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 60);
    }
  }, [isOpen, activeTabMode, activeParaNum]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);



  const pageSystems = [
    { code: 'V', label: 'VRI', name: 'Vipassana Research Institute' },
    { code: 'M', label: 'Myanmar', name: 'Chaṭṭha Saṅgāyana' },
    { code: 'P', label: 'PTS', name: 'Pali Text Society' },
    { code: 'T', label: 'Thai', name: 'Royal Thai Edition' },
    { code: 'O', label: 'Other', name: 'Other Extra-canonical' },
  ];


  const handleParaSubmit = (e) => {
    if (e) e.preventDefault();
    const clean = String(paraInput || '').trim().replace(/^(?:para-?|p)/i, '');
    if (!clean) {
      setErrorMessage('Please enter a paragraph number');
      return;
    }

    const intVal = parseInt(clean, 10);
    if (isNaN(intVal) || intVal <= 0) {
      setErrorMessage('Please enter a valid positive paragraph number.');
      return;
    }

    if (!paraRange || paraRange.total === 0) {
      setErrorMessage('Paragraph navigation is not available for this book.');
      return;
    }

    if (intVal < paraRange.min || intVal > paraRange.max) {
      setErrorMessage(
        `Paragraph ${intVal} is out of range. Please enter a paragraph between ${paraRange.min} and ${paraRange.max}.`
      );
      return;
    }

    openBook(activeTab.bookCode, { targetParaNum: clean });
    onClose();
  };

  const handlePageSubmit = (e) => {
    if (e) e.preventDefault();
    const clean = String(pageInput || '').trim();
    if (!clean) {
      setErrorMessage('Please enter a page number');
      return;
    }

    const ed = pageSystem.toUpperCase();
    const edRange = editionRanges[ed];

    if (!edRange || !edRange.available) {
      setErrorMessage(`${ed} edition page numbers are not available for this book.`);
      return;
    }

    // Extract numerical page for range validation
    let enteredNum = NaN;
    if (clean.includes('.')) {
      const parts = clean.split('.');
      enteredNum = parseInt(parts[1], 10);
    } else {
      enteredNum = parseInt(clean, 10);
    }

    if (isNaN(enteredNum) || enteredNum <= 0) {
      setErrorMessage('Please enter a valid positive page number.');
      return;
    }

    if (edRange.minNum !== undefined && edRange.maxNum !== undefined) {
      if (enteredNum < edRange.minNum || enteredNum > edRange.maxNum) {
        setErrorMessage(
          `Page ${enteredNum} is out of range for ${ed} edition. Please enter a page between ${edRange.minNum} and ${edRange.maxNum}.`
        );
        return;
      }
    }

    const pageToChap = activeTab?.page_to_chapter?.[ed];
    const pageToPara = activeTab?.page_to_para?.[ed];

    let targetChap = undefined;
    let targetPara = undefined;

    if (pageToChap) {
      if (pageToChap[clean] !== undefined) {
        targetChap = pageToChap[clean];
        targetPara = pageToPara?.[clean];
      } else {
        const padded4 = String(enteredNum).padStart(4, '0');
        for (const [pKey, cIdx] of Object.entries(pageToChap)) {
          if (
            pKey === clean ||
            pKey === String(enteredNum) ||
            pKey.endsWith(`.${clean}`) ||
            pKey.endsWith(`.${padded4}`)
          ) {
            targetChap = cIdx;
            targetPara = pageToPara?.[pKey];
            break;
          }
        }
      }
    }

    if (targetChap === undefined && targetPara === undefined) {
      setErrorMessage(`Page "${clean}" was not found in ${ed} edition for this book.`);
      return;
    }

    openBook(activeTab.bookCode, {
      targetChapterIdx: targetChap,
      targetParaNum: targetPara,
      targetPage: clean,
      targetPageSystem: ed,
    });
    onClose();
  };



  // Only return null after ALL hooks have executed unconditionally
  if (!isOpen || !activeTab) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <Navigation size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)]">
                Go to Location
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] truncate max-w-[240px]">
                {convertPaliScript(activeTab.title, settings?.paliScript)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-card)] p-1 gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTabMode('para');
              setErrorMessage('');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTabMode === 'para'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <Hash size={14} />
            <span>Paragraph</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTabMode('page');
              setErrorMessage('');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTabMode === 'page'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <BookOpen size={14} />
            <span>Page Number</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4">
          {activeTabMode === 'para' ? (
            <form onSubmit={handleParaSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Paragraph Number
                  </label>
                  {paraRange.total > 0 && (
                    <span className="text-[11px] font-mono font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.2 rounded border border-[var(--accent-border)]">
                      {paraRange.min} – {paraRange.max}
                    </span>
                  )}
                </div>

                <div className="relative flex items-center">
                  <input
                    ref={inputRef}
                    type="number"
                    min={paraRange.min}
                    max={paraRange.max}
                    value={paraInput}
                    onChange={(e) => {
                      setParaInput(e.target.value);
                      setErrorMessage('');
                    }}
                    placeholder={`Enter paragraph (${paraRange.min} – ${paraRange.max})`}
                    className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
                  />
                </div>
              </div>

              {/* Quick Paragraph Chips */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span>Quick Jump:</span>
                  <span>{paraRange.total} total paras</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {quickParaChips.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setParaInput(String(n));
                        setErrorMessage('');
                      }}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                        String(n) === String(paraInput)
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'bg-[var(--bg-secondary)] hover:bg-[var(--accent)] hover:text-white border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-90 shadow-sm transition cursor-pointer"
              >
                <span>Jump to Paragraph</span>
                <CornerDownLeft size={14} />
              </button>
            </form>
          ) : (
            <form onSubmit={handlePageSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                  Page Numbering Edition
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {pageSystems.map((sys) => {
                    const rangeInfo = editionRanges[sys.code] || { available: false, label: 'Unavailable' };
                    return (
                      <button
                        key={sys.code}
                        type="button"
                        disabled={!rangeInfo.available}
                        onClick={() => {
                          setPageSystem(sys.code);
                          setErrorMessage('');
                        }}
                        className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                          pageSystem === sys.code
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-bold'
                            : rangeInfo.available
                            ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--border-color)]/80 cursor-pointer'
                            : 'border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/40 text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs">{sys.label}</span>
                          <span className="text-[10px] opacity-60">[{sys.code}]</span>
                        </div>
                        <span className="text-[10.5px] font-mono font-normal mt-1 opacity-80">
                          {rangeInfo.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-normal">
                  <span className="font-semibold text-[var(--text-primary)]">Editions:</span> <strong>V</strong> = VRI (Vipassana Research Inst.) • <strong>M</strong> = Myanmar • <strong>P</strong> = PTS (Pali Text Society) • <strong>T</strong> = Thai • <strong>O</strong> = Other
                </p>
              </div>


              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Page Number ({pageSystem})
                  </label>
                  {currentEdRange.available && (
                    <span className="text-[11px] font-mono font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.2 rounded border border-[var(--accent-border)]">
                      {currentEdRange.label}
                    </span>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={pageInput}
                  disabled={!currentEdRange.available}
                  onChange={(e) => {
                    setPageInput(e.target.value);
                    setErrorMessage('');
                  }}
                  placeholder={currentEdRange.available ? currentEdRange.hint : 'Unavailable in this book'}
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono disabled:opacity-50"
                />
              </div>

              {/* Quick Page Chips */}
              {quickPageChips.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>Quick Page:</span>
                    <span>{currentEdRange.count} page breaks</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quickPageChips.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setPageInput(String(p));
                          setErrorMessage('');
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                          String(p) === String(pageInput)
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-secondary)] hover:bg-[var(--accent)] hover:text-white border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        p.{p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!currentEdRange.available}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-90 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Jump to Page</span>
                <CornerDownLeft size={14} />
              </button>
            </form>
          )}
        </div>

        {/* Footer info tip */}
        <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
          <span>Press Enter to jump immediately</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[9px]">
            Enter
          </kbd>
        </div>
      </div>
    </div>
  );
}
