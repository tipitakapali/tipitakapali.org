'use client';

import React, { useState } from 'react';
import { X, History, Trash2, Search, ExternalLink, Clock } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertPaliScript, capitalizePali, normalizePaliForSearch } from '../services/transliterate';

export default function HistoryModal({ isOpen, onClose }) {
  const { recentHistory, clearHistory, openBook } = useTabs();
  const { settings } = useThemeSettings();
  const [filterText, setFilterText] = useState('');

  if (!isOpen) return null;

  const filtered = recentHistory.filter((h) => {
    const rawQ = filterText.trim();
    if (!rawQ) return true;
    const q = rawQ.toLowerCase();
    const normQ = normalizePaliForSearch(rawQ);
    return (
      h.bookTitle?.toLowerCase().includes(q) ||
      normalizePaliForSearch(h.bookTitle).includes(normQ) ||
      h.chapterTitle?.toLowerCase().includes(q) ||
      normalizePaliForSearch(h.chapterTitle).includes(normQ) ||
      h.nikaya?.toLowerCase().includes(q) ||
      normalizePaliForSearch(h.nikaya).includes(normQ)
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

  const formatTimeAgo = (ts) => {
    if (!ts) return '';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mins ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} hours ago`;
    return `${Math.floor(diffSec / 86400)} days ago`;
  };

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 animate-fade-in">
      <div className="modal-card bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="modal-header px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm text-[var(--accent)]">
            <History size={16} />
            <span>Recent Reading History</span>
            <span className="text-[11px] font-normal text-[var(--text-muted)]">
              ({recentHistory.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            {recentHistory.length > 0 && (
              <button
                className="text-[11px] text-[var(--text-muted)] hover:text-red-500 px-2 py-1 rounded hover:bg-[var(--bg-card)] transition flex items-center gap-1"
                onClick={clearHistory}
                title="Clear all reading history"
              >
                <Trash2 size={12} />
                <span>Clear</span>
              </button>
            )}
            <button
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition ml-1"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search Filter */}
        <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-primary)] shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search recent books..."
              value={filterText}
              onChange={(e) => setFilterText(typeVelthuis(e.target.value))}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-xs text-[var(--text-muted)]">
              {filterText ? 'No matching history found.' : 'No recent reading history recorded yet.'}
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
                  className="group p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-[var(--accent)]/50 transition flex items-start justify-between gap-3 cursor-pointer"
                  onClick={() => handleJump(item)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] flex-wrap">
                      <span className="truncate">{displayBookTitle}</span>
                      <span className="text-[10.5px] text-[var(--accent)] font-medium shrink-0">
                        › {displayChapterTitle || `Ch ${(item.chapterIdx || 0) + 1}`}
                      </span>
                      {item.paraNum && (
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold shrink-0">
                          Para {item.paraNum}
                        </span>
                      )}
                    </div>
                    {displaySnippet && (
                      <div className="text-[11.5px] text-[var(--text-secondary)] mt-1 truncate">
                        {displaySnippet}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] mt-1.5">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {formatTimeAgo(item.lastReadTime)}
                      </span>
                      {displayNikaya && <span>• {displayNikaya}</span>}
                    </div>
                  </div>

                  <button
                    className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-secondary)] transition shrink-0"
                    onClick={() => handleJump(item)}
                    title="Resume reading from this place"
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
