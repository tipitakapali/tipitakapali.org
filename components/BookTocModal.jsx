'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ListTree, X, Search, BookOpen, ChevronRight, Bookmark } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertPaliScript } from '../services/transliterate';

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

  const filteredToc = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) {
      return tocList.map((item, originalIdx) => ({ ...item, originalIdx }));
    }
    return tocList
      .map((item, originalIdx) => ({ ...item, originalIdx }))
      .filter((item) => item.title.toLowerCase().includes(q));
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
              <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate">
                {convertPaliScript(activeTab.title, settings?.paliScript)}
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
              const level = item.level;

              // Clear, distinct indentation & typographic hierarchy matching Navigation Tree
              let itemClass =
                'w-full text-left rounded-lg cursor-pointer transition flex items-center justify-between group ';
              let titleClass = 'truncate leading-relaxed ';
              let indentClass = '';

              if (level === 0) {
                // Book / Root Division (Level 0: 15.5px Bold)
                indentClass = 'pl-3 pr-3 py-2.5';
                titleClass += 'font-bold text-[15.5px] text-[var(--text-primary)] tracking-wide';
                itemClass += 'bg-[var(--bg-secondary)]/70 hover:bg-[var(--bg-secondary)] mt-3 first:mt-0 border-y border-[var(--border-color)]/40 ';
              } else if (level === 1) {
                // Chapter / Major Division (Level 1: 15px Semibold)
                indentClass = 'pl-8 pr-3 py-2';
                titleClass += 'font-semibold text-[15px] text-[var(--accent)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] mt-1 ';
              } else if (level === 2) {
                // Sutta / Section / Subhead (Level 2: 14.5px Medium)
                indentClass = 'pl-13 pr-3 py-2';
                titleClass += 'font-medium text-[14.5px] text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              } else {
                // Subhead / Subsection (Level 3+: 14px Regular)
                indentClass = 'pl-18 pr-3 py-1.5';
                titleClass += 'text-[14px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]';
                itemClass += 'hover:bg-[var(--bg-secondary)] ';
              }

              if (isCurrentReading) {
                itemClass += 'bg-[var(--accent-light)]! text-[var(--accent)]! font-semibold! border-l-[3.5px] border-l-[var(--accent)] shadow-xs ';
              }

              return (
                <div
                  key={originalIdx}
                  data-toc-idx={originalIdx}
                  onClick={() => handleSelectTocItem(item)}
                  className={`${itemClass} ${indentClass}`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden mr-2">
                    {level === 0 ? (
                      <BookOpen size={16} className="text-[var(--accent)] shrink-0" />
                    ) : level === 1 ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] shrink-0 shadow-xs" />
                    ) : level === 2 ? (
                      <span className="w-2 h-2 rotate-45 rounded-[1px] bg-[var(--text-muted)] shrink-0 opacity-80" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]/70 shrink-0" />
                    )}
                    <span className={titleClass}>{convertPaliScript(item.title, settings?.paliScript)}</span>
                  </div>

                  {isCurrentReading ? (
                    <span className="text-[11px] font-bold text-[var(--accent)] shrink-0 tracking-tight flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20">
                      <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-ping" />
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
