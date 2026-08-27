'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ListTree, X, Search, BookOpen, ChevronRight, Bookmark } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertPaliScript, capitalizePali, normalizePaliForSearch } from '../services/transliterate';

// Compute accurate hierarchy depth: Book/Nikāya (0) > Chapter (1) > Title (2) > Subhead (3) > Subsubhead (4)
function getTocItemHierarchy(item) {
  const t = (item.type || '').toLowerCase();
  const r = (item.rend || '').toLowerCase();
  const level = item.level;
  const title = item.title || '';

  if (t === 'nikaya' || t === 'book' || level === 0) {
    return { depth: 0, type: 'book' };
  }
  if (t === 'chapter' || r === 'chapter' || (level === 1 && t !== 'title' && t !== 'subhead')) {
    return { depth: 1, type: 'chapter' };
  }
  if (t === 'title' || r === 'title' || (t === 'subhead' && /^\d+[\.\s]/i.test(title))) {
    return { depth: 2, type: 'title' };
  }
  if (t === 'subhead' || r === 'subhead' || level === 2) {
    return { depth: 3, type: 'subhead' };
  }
  return { depth: 4, type: 'subsubhead' };
}

export default function BookTocModal({ isOpen, onClose }) {
  const { activeTab, openBook } = useTabs();
  const { settings } = useThemeSettings();
  const [filterQuery, setFilterQuery] = useState('');
  const [activeTocIdx, setActiveTocIdx] = useState(-1);
  const inputRef = useRef(null);
  const listContainerRef = useRef(null);

  // Compute currently reading paragraph index and corresponding TOC item
  useEffect(() => {
    if (!isOpen || !activeTab) return;

    let currentParaIdx = 0;
    const contentArea = document.querySelector('main.content-area');
    if (contentArea) {
      const containerRect = contentArea.getBoundingClientRect();
      const paras = contentArea.querySelectorAll('[data-pindex]');

      for (let i = 0; i < paras.length; i++) {
        const p = paras[i];
        const rect = p.getBoundingClientRect();
        if (rect.top - containerRect.top <= 140) {
          currentParaIdx = parseInt(p.getAttribute('data-pindex'), 10) || 0;
        } else {
          break;
        }
      }
    }

    const tocList = activeTab.toc || [];
    let matchedIdx = -1;
    for (let i = 0; i < tocList.length; i++) {
      if (tocList[i].para_index <= currentParaIdx) {
        matchedIdx = i;
      } else {
        break;
      }
    }
    setActiveTocIdx(matchedIdx);

    // Auto focus filter input & smoothly scroll to current reading section
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      if (matchedIdx >= 0 && listContainerRef.current) {
        const targetEl = listContainerRef.current.querySelector(`[data-toc-idx="${matchedIdx}"]`);
        if (targetEl) {
          targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen) {
      setFilterQuery('');
    }
  }, [isOpen]);

  const tocList = activeTab?.toc || [];

  // Determine Piṭaka category (Vinaya, Sutta, Abhidhamma, Añña) for coloring
  const currentPitaka = useMemo(() => {
    if (!activeTab) return null;
    const code = (activeTab.bookCode || '').toLowerCase();
    const nikaya = (activeTab.nikaya || '').toLowerCase();
    const cat = (activeTab.category || '').toLowerCase();

    if (code.startsWith('vin') || nikaya.includes('vinaya') || cat.includes('vinaya')) return 'vinaya';
    if (code.startsWith('s0') || nikaya.includes('sutta') || cat.includes('sutta')) return 'sutta';
    if (
      code.startsWith('abh') ||
      code.startsWith('e0') ||
      code.startsWith('y0') ||
      code.startsWith('p0') ||
      nikaya.includes('abhidhamma') ||
      cat.includes('abhidhamma')
    ) {
      return 'abhidhamma';
    }
    return 'anna';
  }, [activeTab]);

  const filteredToc = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) {
      return tocList.map((item, originalIdx) => ({ ...item, originalIdx }));
    }
    const normQ = normalizePaliForSearch(q);
    const lowerQ = q.toLowerCase();
    return tocList
      .map((item, originalIdx) => ({ ...item, originalIdx }))
      .filter((item) => {
        const titleStr = item.title || '';
        return (
          titleStr.toLowerCase().includes(lowerQ) ||
          normalizePaliForSearch(titleStr).includes(normQ)
        );
      });
  }, [tocList, filterQuery]);

  if (!isOpen || !activeTab) return null;

  const handleSelectTocItem = async (item) => {
    onClose();
    await openBook(activeTab.bookCode, {
      targetParaIndex: item.para_index,
      targetParaNum: item.para_num,
      targetChapterIdx: item.chapter_index,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in text-[var(--text-primary)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-[85vh] sm:h-auto sm:max-h-[700px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <ListTree size={18} className="text-[var(--accent)] shrink-0" />
            <div className="overflow-hidden">
              <h3 className="toc-pali-title text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
              </h3>
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                <span>Table of Contents</span>
                <span>•</span>
                <span>{tocList.length} sections</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Minimalist Filter Bar */}
        <div className="px-4 py-2.5 border-b border-[var(--border-color)]/60 bg-[var(--bg-primary)] shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              placeholder={`Filter ${tocList.length} sections...`}
              value={filterQuery}
              onChange={(e) => setFilterQuery(typeVelthuis(e.target.value))}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        {/* Typographic TOC Content matching Navigation Tree Typography */}
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto px-3 py-3 space-y-1 scroll-smooth select-none"
        >
          {filteredToc.length === 0 ? (
            <div className="text-center py-12 text-sm text-[var(--text-muted)]">
              No matching sections found.
            </div>
          ) : (
            filteredToc.map((item) => {
              const originalIdx = item.originalIdx;
              const isCurrentReading = originalIdx === activeTocIdx;
              const { depth, type } = getTocItemHierarchy(item);

              // Distinct indentation & typographic hierarchy for Chapter > Title > Subhead
              let itemClass =
                'w-full text-left rounded-lg cursor-pointer transition flex items-center justify-between group ';
              let titleClass = 'toc-pali-title truncate leading-relaxed ';
              let indentClass = '';

              if (depth === 0) {
                // Book / Root Division (Depth 0)
                indentClass = 'pl-3 pr-3 py-2.5';
                titleClass += 'font-bold text-[15.5px] text-[var(--text-primary)] tracking-wide';
                itemClass += 'bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] mt-3 first:mt-0 border-y border-[var(--border-color)]/40 ';
              } else if (depth === 1) {
                // Chapter (Depth 1)
                indentClass = 'pl-6 pr-3 py-2';
                titleClass += 'font-bold text-[15px] text-[var(--accent)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] mt-1.5 ';
              } else if (depth === 2) {
                // Title (Depth 2)
                indentClass = 'pl-11 pr-3 py-2';
                titleClass += 'font-semibold text-[14.5px] text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] mt-0.5 ';
              } else if (depth === 3) {
                // Subhead (Depth 3)
                indentClass = 'pl-16 pr-3 py-1.5';
                titleClass += 'font-normal text-[14px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              } else {
                // Subsubhead (Depth 4+)
                indentClass = 'pl-21 pr-3 py-1.5';
                titleClass += 'font-normal text-[13.5px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              }

              if (isCurrentReading) {
                itemClass += `toc-row-active ${currentPitaka ? `toc-row-active-${currentPitaka}` : 'toc-row-active-default'} rounded-lg shadow-xs `;
                titleClass += ` font-bold ${currentPitaka ? `toc-title-${currentPitaka}` : 'text-[var(--accent)]'} `;
              }

              return (
                <div
                  key={originalIdx}
                  data-toc-idx={originalIdx}
                  onClick={() => handleSelectTocItem(item)}
                  className={`${itemClass} ${indentClass}`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden mr-2">
                    {depth === 0 ? (
                      <BookOpen size={15} className={currentPitaka ? `tree-icon-${currentPitaka}` : 'text-[var(--accent)] shrink-0'} />
                    ) : depth === 1 ? (
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isCurrentReading
                            ? `toc-bullet-dot ${currentPitaka ? `toc-dot-${currentPitaka}` : ''} ring-2 ring-current/30`
                            : `toc-bullet-dot ${currentPitaka ? `toc-dot-${currentPitaka}` : ''}`
                        }`}
                      />
                    ) : depth === 2 ? (
                      <span
                        className={`w-2 h-2 rounded-full border-[1.5px] shrink-0 transition-colors ${
                          isCurrentReading
                            ? `toc-bullet-ring ${currentPitaka ? `toc-dot-${currentPitaka}` : ''}`
                            : 'border-[var(--text-secondary)] bg-transparent'
                        }`}
                      />
                    ) : depth === 3 ? (
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isCurrentReading
                            ? `toc-bullet-dot ${currentPitaka ? `toc-dot-${currentPitaka}` : ''}`
                            : 'bg-[var(--text-muted)]'
                        }`}
                      />
                    ) : (
                      <span
                        className={`w-1 h-1 rounded-full shrink-0 ${
                          isCurrentReading
                            ? `toc-bullet-dot ${currentPitaka ? `toc-dot-${currentPitaka}` : ''}`
                            : 'bg-[var(--text-muted)]/50'
                        }`}
                      />
                    )}
                    <span className={titleClass}>{convertPaliScript(capitalizePali(item.title), settings?.paliScript)}</span>
                  </div>

                  {isCurrentReading ? (
                    <span className={`toc-reading-badge toc-reading-${currentPitaka || 'default'} text-[11px] font-semibold shrink-0 tracking-tight flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--bg-primary)] border shadow-2xs`}>
                      <span className={`tree-ping-wrapper relative flex h-2 w-2 ${currentPitaka ? `tree-ping-${currentPitaka}` : 'tree-ping-default'}`}>
                        <span className="tree-ping-dot-radar animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" />
                        <span className="tree-ping-dot-core relative inline-flex rounded-full h-2 w-2" />
                      </span>
                      <span>Reading</span>
                    </span>
                  ) : (
                    <ChevronRight
                      size={14}
                      className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
