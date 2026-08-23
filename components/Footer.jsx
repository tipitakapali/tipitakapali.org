'use client';

import React, { useState } from 'react';
import {
  ListTree,
  ChevronUp,
  BookA,
  Bookmark,
  Layers,
  Navigation,
} from 'lucide-react';

import BookTocModal from './BookTocModal';
import DictionaryModal from './DictionaryModal';
import BookmarkModal from './BookmarkModal';
import HistoryModal from './HistoryModal';
import MatJumpModal from './MatJumpModal';
import GoToModal from './GoToModal';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';

export default function Footer() {
  const {
    activeTab,
    activeParaNum,
    bookmarks,
    isHistoryOpen,
    setIsHistoryOpen,
    isBookmarkOpen,
    setIsBookmarkOpen,
  } = useTabs();
  const { settings, updateSetting } = useThemeSettings();

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isMatModalOpen, setIsMatModalOpen] = useState(false);
  const [isGoToModalOpen, setIsGoToModalOpen] = useState(false);

  return (
    <>
      <footer className="app-footer w-full max-w-full overflow-x-auto overflow-y-hidden h-[46px] sm:h-[48px] bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-2 sm:px-4 flex items-center justify-center shrink-0 z-40 text-xs select-none box-border">
        <div className="footer-nav-group mx-auto flex items-center justify-center gap-1.5 sm:gap-2.5">
          {/* Font-Size Stepper */}
          <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden text-xs shadow-xs shrink-0">
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

          <div className="h-4 w-px bg-[var(--border-color)]/60 mx-0.5 hidden sm:block shrink-0" />

          {/* MAT Jump Button */}
          <button
            onClick={() => setIsMatModalOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Open MAT Jump (Mūla · Aṭṭhakathā · Ṭīkā Connected Books)"
          >
            <Layers size={13} className="text-[var(--accent)]" />
            <span>MAT Jump</span>
            {activeParaNum && (
              <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold">
                {activeParaNum}
              </span>
            )}
          </button>

          {/* Go To Button */}
          <button
            onClick={() => setIsGoToModalOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Go to Paragraph or Page Number"
          >
            <Navigation size={13} className="text-[var(--accent)]" />
            <span>Go to</span>
          </button>

          {/* Book TOC */}
          <button
            onClick={() => setIsTocOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Open Book Table of Contents"
          >
            <ListTree size={14} className="text-[var(--accent)]" />
            <span>TOC</span>
            {activeTab?.toc && activeTab.toc.length > 0 && (
              <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
                {activeTab.toc.length}
              </span>
            )}
          </button>

          {/* Dictionary */}
          <button
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            onClick={() => setIsDictOpen(true)}
            title="Pāḷi Dictionary Look-up"
          >
            <BookA size={14} className="text-[var(--accent)]" />
            <span>Dict</span>
          </button>

          {/* Bookmarks */}
          <button
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            onClick={() => setIsBookmarkOpen(true)}
            title="Saved Bookmarks"
          >
            <Bookmark size={14} className="text-[var(--accent)]" />
            <span>Saved</span>
            {bookmarks.length > 0 && (
              <span className="text-[8.5px] sm:text-[9px] px-1 rounded bg-[var(--accent)] text-white font-bold">
                {bookmarks.length}
              </span>
            )}
          </button>
        </div>
      </footer>

      {/* Modals */}
      <MatJumpModal isOpen={isMatModalOpen} onClose={() => setIsMatModalOpen(false)} />
      <GoToModal isOpen={isGoToModalOpen} onClose={() => setIsGoToModalOpen(false)} />
      <BookTocModal isOpen={isTocOpen} onClose={() => setIsTocOpen(false)} />
      <DictionaryModal isOpen={isDictOpen} onClose={() => setIsDictOpen(false)} />
      <BookmarkModal isOpen={isBookmarkOpen} onClose={() => setIsBookmarkOpen(false)} />
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}


