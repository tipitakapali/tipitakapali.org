'use client';

import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ListTree,
  ChevronUp,
  BookA,
  Bookmark,
  History,
} from 'lucide-react';
import BookTocModal from './BookTocModal';
import DictionaryModal from './DictionaryModal';
import BookmarkModal from './BookmarkModal';
import HistoryModal from './HistoryModal';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';

export default function Footer() {
  const {
    activeTab,
    setChapterForActiveTab,
    bookmarks,
    recentHistory,
  } = useTabs();
  const { settings, updateSetting } = useThemeSettings();

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isBookmarkOpen, setIsBookmarkOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const totalChaps = activeTab?.chapters?.length || 1;
  const currentChapIdx = activeTab?.currentChapterIdx || 0;

  const handlePrevChapter = () => {
    if (currentChapIdx > 0) {
      setChapterForActiveTab(currentChapIdx - 1);
    }
  };

  const handleNextChapter = () => {
    if (currentChapIdx < totalChaps - 1) {
      setChapterForActiveTab(currentChapIdx + 1);
    }
  };

  return (
    <>
      <footer className="app-footer w-full max-w-full overflow-hidden h-[46px] sm:h-[48px] bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-1.5 sm:px-4 flex items-center justify-between shrink-0 z-40 text-xs select-none box-border">
        {/* Left: Font-Size Stepper */}
        <div className="footer-left flex items-center shrink-0">
          <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden text-xs shadow-xs">
            <button
              className="px-1.5 sm:px-2 py-0.5 hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition font-bold text-[10.5px] sm:text-[11px]"
              onClick={() => updateSetting('fontSize', Math.max(14, settings.fontSize - 1))}
              title="Decrease font size"
            >
              A−
            </button>
            <span className="px-1 sm:px-1.5 text-[10px] sm:text-[11px] font-mono text-[var(--accent)] font-semibold border-x border-[var(--border-color)]">
              {settings.fontSize}
            </span>
            <button
              className="px-1.5 sm:px-2 py-0.5 hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition font-bold text-[10.5px] sm:text-[11px]"
              onClick={() => updateSetting('fontSize', Math.min(32, settings.fontSize + 1))}
              title="Increase font size"
            >
              A+
            </button>
          </div>
        </div>

        {/* Center: Chapter Navigation */}
        <div className="footer-center flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            className="footer-nav-btn px-1 sm:px-2.5 py-1 text-[11px] sm:text-xs"
            onClick={handlePrevChapter}
            disabled={!activeTab || currentChapIdx <= 0}
            title="Previous Chapter"
          >
            <ChevronLeft size={13} />
            <span className="hidden sm:inline">Prev</span>
          </button>
          <span className="footer-chap-counter font-semibold text-[10px] sm:text-[11.5px] min-w-[48px] sm:min-w-[65px] text-center truncate">
            {activeTab ? `Ch ${currentChapIdx + 1}/${totalChaps}` : '—'}
          </span>
          <button
            className="footer-nav-btn px-1 sm:px-2.5 py-1 text-[11px] sm:text-xs"
            onClick={handleNextChapter}
            disabled={!activeTab || currentChapIdx >= totalChaps - 1}
            title="Next Chapter"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={13} />
          </button>
        </div>

        {/* Right: Dictionary, Bookmarks, Book TOC, Recent History */}
        <div className="footer-right flex items-center gap-0.5 sm:gap-1.5 shrink-0">
          {/* Dictionary */}
          <button
            className="footer-nav-btn p-1 sm:px-2 sm:py-1"
            onClick={() => setIsDictOpen(true)}
            title="Pāḷi Dictionary Look-up"
          >
            <BookA size={14} className="text-[var(--accent)]" />
            <span className="hidden md:inline">Dict</span>
          </button>

          {/* Bookmarks */}
          <button
            className="footer-nav-btn p-1 sm:px-2 sm:py-1"
            onClick={() => setIsBookmarkOpen(true)}
            title="Saved Bookmarks"
          >
            <Bookmark size={14} className="text-[var(--accent)]" />
            <span className="hidden sm:inline">Saved</span>
            {bookmarks.length > 0 && (
              <span className="text-[8.5px] sm:text-[9px] px-1 rounded bg-[var(--accent)] text-white font-bold">
                {bookmarks.length}
              </span>
            )}
          </button>

          {/* Book TOC */}
          <button
            onClick={() => setIsTocOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn p-1 sm:px-2.5 sm:py-1"
            title="Open Book Table of Contents"
          >
            <ListTree size={14} className="text-[var(--accent)]" />
            <span className="hidden sm:inline">TOC</span>
            {activeTab?.toc && activeTab.toc.length > 0 && (
              <span className="hidden sm:inline text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
                {activeTab.toc.length}
              </span>
            )}
            <ChevronUp size={11} className="text-[var(--text-muted)] hidden sm:inline" />
          </button>

          {/* Recent Reading History */}
          <button
            className="footer-nav-btn p-1 sm:px-2 sm:py-1"
            onClick={() => setIsHistoryOpen(true)}
            title="Recent Reading History"
          >
            <History size={14} className="text-[var(--text-secondary)]" />
            <span className="hidden md:inline">History</span>
            {recentHistory.length > 0 && (
              <span className="hidden sm:inline text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
                {recentHistory.length}
              </span>
            )}
          </button>
        </div>
      </footer>

      {/* Modals */}
      <BookTocModal isOpen={isTocOpen} onClose={() => setIsTocOpen(false)} />
      <DictionaryModal isOpen={isDictOpen} onClose={() => setIsDictOpen(false)} />
      <BookmarkModal isOpen={isBookmarkOpen} onClose={() => setIsBookmarkOpen(false)} />
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}
