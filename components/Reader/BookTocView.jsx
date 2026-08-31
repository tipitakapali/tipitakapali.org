'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, BookOpen, ChevronRight } from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali, normalizePaliForSearch, typeVelthuis } from '../../services/transliterate';

function getTocItemHierarchy(item) {
  const t = (item.type || '').toLowerCase();
  const r = (item.rend || '').toLowerCase();
  const level = item.level;
  const title = item.title || '';
  if (t === 'nikaya' || t === 'book' || level === 0) return { depth: 0, type: 'book' };
  if (t === 'chapter' || r === 'chapter' || (level === 1 && t !== 'title' && t !== 'subhead')) return { depth: 1, type: 'chapter' };
  if (t === 'title' || r === 'title' || (t === 'subhead' && /^\d+[\.\s]/i.test(title))) return { depth: 2, type: 'title' };
  if (t === 'subhead' || r === 'subhead' || level === 2) return { depth: 3, type: 'subhead' };
  return { depth: 4, type: 'subsubhead' };
}

export default function BookTocView() {
  const { activeTab, openBook, loadingBook } = useTabs();
  const { settings } = useThemeSettings();
  const [filterQuery, setFilterQuery] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const tocList = activeTab?.toc || [];
  const chapters = activeTab?.chapters || [];
  const isTocLoading = activeTab?.isLoading || (tocList.length === 0 && loadingBook);

  const currentPitaka = useMemo(() => {
    if (!activeTab) return null;
    const code = (activeTab.bookCode || '').toLowerCase();
    const nikaya = (activeTab.nikaya || '').toLowerCase();
    const cat = (activeTab.category || '').toLowerCase();
    if (code.startsWith('vin') || nikaya.includes('vinaya') || cat.includes('vinaya')) return 'vinaya';
    if (code.startsWith('s0') || nikaya.includes('sutta') || cat.includes('sutta')) return 'sutta';
    if (code.startsWith('abh') || code.startsWith('e0') || code.startsWith('y0') || code.startsWith('p0') || nikaya.includes('abhidhamma') || cat.includes('abhidhamma')) return 'abhidhamma';
    return 'anna';
  }, [activeTab]);

  const filteredToc = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return tocList.map((item, originalIdx) => ({ ...item, originalIdx }));
    const normQ = normalizePaliForSearch(q);
    const lowerQ = q.toLowerCase();
    return tocList
      .map((item, originalIdx) => ({ ...item, originalIdx }))
      .filter((item) => {
        const titleStr = item.title || '';
        return titleStr.toLowerCase().includes(lowerQ) || normalizePaliForSearch(titleStr).includes(normQ);
      });
  }, [tocList, filterQuery]);

  const handleSelectTocItem = async (item) => {
    // Jump to this section: open book at its chapter + para
    await openBook(activeTab.bookCode, {
      targetChapterIdx: item.chapter_index,
      targetParaIndex: item.para_index,
      targetParaNum: item.para_num || undefined,
    });
  };

  const handleChapterClick = async (chapterIdx) => {
    await openBook(activeTab.bookCode, { targetChapterIdx: chapterIdx });
  };

  if (!activeTab) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] overflow-hidden">
      {/* Header — compact 1-line to maximize reading space */}
      <div className="shrink-0 px-3 sm:px-4 py-2 sm:py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] border border-[var(--accent-border)] flex items-center justify-center shrink-0">
              <BookOpen size={14} className="text-[var(--accent)]" />
            </div>
            <h1 className="toc-pali-title text-sm sm:text-[15px] font-bold text-[var(--text-primary)] leading-none truncate shrink min-w-0">
              {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
            </h1>
            {(activeTab.nikaya || activeTab.category) && (
              <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${currentPitaka ? `toc-reading-${currentPitaka}` : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentPitaka ? `toc-bullet-dot toc-dot-${currentPitaka}` : 'bg-[var(--accent)]'}`} />
                <span className="toc-pali-title truncate max-w-[14ch]">{convertPaliScript(capitalizePali(activeTab.nikaya || activeTab.category), settings?.paliScript)}</span>
              </span>
            )}
            <span className="text-xs text-[var(--text-muted)] truncate shrink-0 hidden md:inline">
              {activeTab.chapter_count ? `• ${activeTab.chapter_count} ch` : ''}
              {tocList.length ? ` • ${tocList.length} sec` : ''}
            </span>
            <span className="text-xs text-[var(--text-muted)] truncate shrink-0 md:hidden">
              {activeTab.chapter_count || tocList.length ? `• ${activeTab.chapter_count || tocList.length} sec` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="shrink-0 px-4 sm:px-6 py-3 bg-[var(--bg-primary)] border-b border-[var(--border-color)]/60">
        <div className="max-w-3xl mx-auto w-full relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder={`Filter ${tocList.length} sections… (e.g. “sutta”, “vagga”)`}
            value={filterQuery}
            onChange={(e) => setFilterQuery(typeVelthuis(e.target.value))}
            className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 pl-9 pr-9 text-sm outline-none focus:border-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* TOC List — scrollable */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 bg-[var(--bg-primary)]">
        <div className="max-w-3xl mx-auto w-full space-y-1">
          {isTocLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center select-none animate-fade-in">
              <div className="relative flex items-center justify-center mb-4">
                <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)] shadow-sm">
                  <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                </div>
              </div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Loading Table of Contents…
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Buffering book sections & outline
              </p>
            </div>
          ) : filteredToc.length === 0 ? (
            <div className="text-center py-16 text-sm text-[var(--text-muted)]">
              {filterQuery ? `No matching sections found for “${filterQuery}”.` : 'No Table of Contents sections recorded for this book.'}
            </div>
          ) : (
            filteredToc.map((item) => {
              const { depth } = getTocItemHierarchy(item);
              let itemClass = 'w-full text-left rounded-lg cursor-pointer transition flex items-center justify-between group ';
              let titleClass = 'toc-pali-title truncate leading-relaxed ';
              let indentClass = '';
              if (depth === 0) {
                indentClass = 'pl-3 pr-3 py-2.5';
                titleClass += 'font-bold text-[15.5px] text-[var(--text-primary)] tracking-wide';
                itemClass += 'bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] mt-3 first:mt-0 border-y border-[var(--border-color)]/40 ';
              } else if (depth === 1) {
                indentClass = 'pl-6 pr-3 py-2';
                titleClass += 'font-bold text-[15px] text-[var(--accent)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] mt-1.5 ';
              } else if (depth === 2) {
                indentClass = 'pl-11 pr-3 py-2';
                titleClass += 'font-semibold text-[14.5px] text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] mt-0.5 ';
              } else if (depth === 3) {
                indentClass = 'pl-16 pr-3 py-1.5';
                titleClass += 'font-normal text-[14px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              } else {
                indentClass = 'pl-21 pr-3 py-1.5';
                titleClass += 'font-normal text-[13.5px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              }

              return (
                <div
                  key={item.originalIdx}
                  onClick={() => handleSelectTocItem(item)}
                  className={`${itemClass} ${indentClass} hover:shadow-xs`}
                  title={`${item.title} (para ${item.para_index})`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden mr-2 min-w-0">
                    {depth === 0 ? (
                      <BookOpen size={15} className={currentPitaka ? `tree-icon-${currentPitaka} shrink-0` : 'text-[var(--accent)] shrink-0'} />
                    ) : depth === 1 ? (
                      <span className={`w-2 h-2 rounded-full shrink-0 toc-bullet-dot ${currentPitaka ? `toc-dot-${currentPitaka}` : ''}`} />
                    ) : depth === 2 ? (
                      <span className="w-2 h-2 rounded-full border-[1.5px] border-[var(--text-secondary)] bg-transparent shrink-0" />
                    ) : depth === 3 ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0" />
                    ) : (
                      <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]/50 shrink-0" />
                    )}
                    <span className={titleClass}>{convertPaliScript(capitalizePali(item.title || `Section ${item.para_index}`), settings?.paliScript)}</span>
                  </div>
                  <ChevronRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              );
            })
          )}
          {!isTocLoading && filteredToc.length > 0 && (
            <div className="pt-6 pb-2 text-center">
              <p className="text-xs text-[var(--text-muted)]">
                Click any section to read
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
