'use client';

import React, { useState } from 'react';
import { X, Bookmark, BookmarkCheck, Trash2, Search, ExternalLink, Calendar, Plus } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertPaliScript, capitalizePali, normalizePaliForSearch } from '../services/transliterate';

export default function BookmarkModal({ isOpen, onClose }) {
  const { bookmarks, addBookmark, removeBookmark, openBook, activeTab, activeParaNum } = useTabs();
  const { settings } = useThemeSettings();
  const [filterText, setFilterText] = useState('');

  if (!isOpen) return null;

  const currentChapIdx = activeTab?.currentChapterIdx || 0;
  const currentChap = activeTab?.chapters?.[currentChapIdx];
  const isCurrentBookmarked =
    activeTab &&
    bookmarks.some(
      (b) =>
        b.bookCode === activeTab.bookCode &&
        b.chapterIdx === currentChapIdx &&
        (activeParaNum ? String(b.paraNum) === String(activeParaNum) : true)
    );

  const handleToggleCurrentPage = () => {
    if (!activeTab) return;
    let currentPara = activeParaNum;
    let currentChapIdx = activeTab.currentChapterIdx || 0;
    let paraSnippet = '';

    if (!currentPara && typeof document !== 'undefined') {
      const readerEl = document.querySelector('.reader-container') || document.querySelector('main');
      if (readerEl) {
        const targetY = (readerEl.getBoundingClientRect?.().top || 0) + 80;
        const paraElements = readerEl.querySelectorAll('p[data-pindex]');
        for (const p of paraElements) {
          const rect = p.getBoundingClientRect();
          if (rect.bottom >= targetY) {
            let pNum = p.getAttribute('data-para');
            if (!pNum) {
              let prev = p.previousElementSibling;
              while (prev) {
                pNum = prev.getAttribute('data-para');
                if (pNum) break;
                prev = prev.previousElementSibling;
              }
            }
            if (pNum) {
              currentPara = pNum;
              break;
            }
          }
        }
      }
    }

    if (currentPara && activeTab.para_to_chapter?.[currentPara] !== undefined) {
      currentChapIdx = activeTab.para_to_chapter[currentPara];
    }

    const currentChap = activeTab.chapters?.[currentChapIdx];

    if (typeof document !== 'undefined' && currentPara) {
      const pEl = document.querySelector(`[data-para="${currentPara}"]`);
      if (pEl) {
        paraSnippet = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (paraSnippet.length > 130) paraSnippet = paraSnippet.slice(0, 130) + '...';
      }
    }

    if (isCurrentBookmarked) {
      const existing = bookmarks.find(
        (b) =>
          b.bookCode === activeTab.bookCode &&
          b.chapterIdx === currentChapIdx &&
          (currentPara ? String(b.paraNum) === String(currentPara) : true)
      );
      if (existing) removeBookmark(existing.id);
    } else {
      addBookmark({
        id: `${activeTab.bookCode}_${currentChapIdx}_${currentPara || '0'}`,
        bookCode: activeTab.bookCode,
        bookTitle: activeTab.title,
        nikaya: activeTab.nikaya,
        chapterIdx: currentChapIdx,
        chapterTitle: currentChap?.title || '',
        paraNum: currentPara || undefined,
        snippet:
          paraSnippet ||
          `${activeTab.title} — ${currentChap?.title || `Chapter ${currentChapIdx + 1}`}${
            currentPara ? ` (Para ${currentPara})` : ''
          }`,
      });
    }
  };

  const filtered = bookmarks.filter((b) => {
    const rawQ = filterText.trim();
    if (!rawQ) return true;
    const q = rawQ.toLowerCase();
    const normQ = normalizePaliForSearch(rawQ);
    return (
      b.bookTitle?.toLowerCase().includes(q) ||
      normalizePaliForSearch(b.bookTitle).includes(normQ) ||
      b.chapterTitle?.toLowerCase().includes(q) ||
      normalizePaliForSearch(b.chapterTitle).includes(normQ) ||
      b.snippet?.toLowerCase().includes(q) ||
      normalizePaliForSearch(b.snippet).includes(normQ) ||
      b.nikaya?.toLowerCase().includes(q) ||
      normalizePaliForSearch(b.nikaya).includes(normQ)
    );
  });

  const handleJump = (item) => {
    openBook(item.bookCode, {
      targetChapterIdx: item.chapterIdx || 0,
      targetParaNum: item.paraNum,
      targetParaIndex: item.paraNum ? undefined : item.paraIndex,
    });
    onClose();
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 animate-fade-in">
      <div
        className="modal-card bookmark-modal bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        style={{ fontFamily: settings?.paliScript && settings.paliScript !== 'roman' ? 'var(--font-reader)' : undefined }}
      >
        {/* Header */}
        <div className="modal-header px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm text-[var(--accent)]">
            <Bookmark size={16} />
            <span>Saved Bookmarks</span>
            <span className="text-[11px] font-normal text-[var(--text-muted)]">
              ({bookmarks.length})
            </span>
          </div>
          <button
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Quick Action: Bookmark This Page */}
        {activeTab && (
          <div className="px-4 py-2.5 bg-[var(--bg-card)] border-b border-[var(--border-color)] flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Current Reading Page:
              </div>
              <div className="text-xs font-semibold text-[var(--text-primary)] truncate flex items-center gap-1.5 flex-wrap">
                <span>{convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}</span>
                {currentChap?.title && currentChap.title !== activeTab.title && (
                  <span className="text-[var(--text-muted)] font-normal">
                    {' › '}
                    {convertPaliScript(capitalizePali(currentChap.title), settings?.paliScript)}
                  </span>
                )}
                {activeParaNum && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold shrink-0">
                    Para {activeParaNum}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={handleToggleCurrentPage}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1.5 shadow-xs cursor-pointer ${
                isCurrentBookmarked
                  ? 'bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]'
                  : 'bg-[var(--accent)] text-white hover:opacity-95'
              }`}
              title={isCurrentBookmarked ? 'Remove Bookmark' : 'Bookmark this page'}
            >
              {isCurrentBookmarked ? (
                <>
                  <BookmarkCheck size={14} className="text-[var(--accent)]" />
                  <span>Bookmarked</span>
                </>
              ) : (
                <>
                  <Plus size={14} />
                  <span>Bookmark this page</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Search Filter */}
        <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search saved bookmarks..."
              value={filterText}

              onChange={(e) => setFilterText(typeVelthuis(e.target.value))}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Bookmarks List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-xs text-[var(--text-muted)]">
              {filterText ? 'No matching bookmarks found.' : 'No bookmarks saved yet. Click the bookmark icon in the reader header to save your place.'}
            </div>
          ) : (
            filtered.map((item) => {
              const displayBookTitle = convertPaliScript(capitalizePali(item.bookTitle), settings?.paliScript);
              const displayChapterTitle = convertPaliScript(capitalizePali(item.chapterTitle), settings?.paliScript);
              const displaySnippet = convertPaliScript(item.snippet, settings?.paliScript);
              const displayNikaya = convertPaliScript(capitalizePali(item.nikaya), settings?.paliScript);
              return (
                <div
                  key={item.id}
                  className="bookmark-item group p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--accent)]/50 transition flex items-start justify-between gap-3 cursor-pointer"
                  onClick={() => handleJump(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="bookmark-title flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] flex-wrap">
                      <span className="truncate bookmark-pali-title pali-script-text">{displayBookTitle}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-normal bookmark-pali-chapter pali-script-text">
                        › {displayChapterTitle || `Ch ${item.chapterIdx + 1}`}
                      </span>
                      {item.paraNum && (
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold shrink-0">
                          Para {item.paraNum}
                        </span>
                      )}
                    </div>
                    {displaySnippet && (
                      <div className="bookmark-snippet pali-script-text text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                        {displaySnippet}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] mt-1.5">
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {formatDate(item.timestamp)}
                      </span>
                      {displayNikaya && <span>• {displayNikaya}</span>}
                    </div>
                  </div>

                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-secondary)] transition"
                    onClick={() => handleJump(item)}
                    title="Jump to bookmark"
                  >
                    <ExternalLink size={13} />
                  </button>
                  <button
                    className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-secondary)] transition"
                    onClick={() => removeBookmark(item.id)}
                    title="Delete bookmark"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
        </div>
      </div>
    </div>
  );
}
