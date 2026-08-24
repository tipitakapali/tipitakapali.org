'use client';

import React, { useState } from 'react';
import {
  ListTree,
  Bookmark,
  Layers,
  Navigation,
  Type,
  X,
} from 'lucide-react';

import BookTocModal from './BookTocModal';
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
    isGoToOpen,
    openGoToModal,
    closeGoToModal,
    goToInitialTab,
    goToInitialEdition,
    isHistoryOpen,
    setIsHistoryOpen,
    isBookmarkOpen,
    setIsBookmarkOpen,
  } = useTabs();
  const { settings, updateSetting } = useThemeSettings();

  const [isFontSizeOpen, setIsFontSizeOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isMatModalOpen, setIsMatModalOpen] = useState(false);

  return (
    <>
      <footer className="app-footer w-full max-w-full overflow-x-auto overflow-y-hidden h-[46px] sm:h-[48px] bg-[var(--bg-secondary)] border-t border-[var(--border-color)] px-2 sm:px-4 flex items-center justify-center shrink-0 z-40 text-xs select-none box-border">
        {/* Navigation Buttons Group */}
        <div className="footer-nav-group mx-auto flex items-center justify-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Text Size Button */}
          <button
            onClick={() => setIsFontSizeOpen(true)}
            className={`footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0 ${
              isFontSizeOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
            }`}
            title="Adjust Text Size"
          >
            <Type size={13} className="text-[var(--accent)]" />
            <span>Size</span>
            <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
              {settings.fontSize}
            </span>
          </button>

          {/* MAT Button */}
          <button
            onClick={() => setIsMatModalOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Jump to Connected Mūla, Aṭṭhakathā, Ṭīkā"
          >
            <Layers size={13} className="text-[var(--accent)]" />
            <span>MAT</span>
            {activeParaNum && (
              <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold">
                {activeParaNum}
              </span>
            )}
          </button>

          {/* Go Button */}
          <button
            onClick={() => openGoToModal('para')}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Go to Paragraph or Page Number"
          >
            <Navigation size={13} className="text-[var(--accent)]" />
            <span>Go</span>
          </button>

          {/* Book Toc */}
          <button
            onClick={() => setIsTocOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold cursor-pointer shrink-0"
            title="Open Book Table of Contents"
          >
            <ListTree size={14} className="text-[var(--accent)]" />
            <span>Toc</span>
            {activeTab?.toc && activeTab.toc.length > 0 && (
              <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
                {activeTab.toc.length}
              </span>
            )}
          </button>
        </div>
      </footer>

      {/* Font Size Modal */}
      {isFontSizeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-2xs animate-fade-in text-[var(--text-primary)]"
          onClick={() => setIsFontSizeOpen(false)}
        >
          <div
            className="w-full max-w-[280px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl p-4 text-xs animate-in zoom-in-95 duration-100 select-none flex flex-col gap-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-color)]/60 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
                  <Type size={15} />
                </div>
                <span className="font-bold text-xs text-[var(--text-primary)]">Text Size</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-1.5 py-0.5 focus-within:border-[var(--accent)] transition">
                  <input
                    type="number"
                    min="8"
                    value={settings.fontSize}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) {
                        updateSetting('fontSize', val);
                      }
                    }}
                    className="w-10 bg-transparent text-center font-mono text-xs font-bold text-[var(--accent)] outline-none"
                  />
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">px</span>
                </div>
                <button
                  onClick={() => setIsFontSizeOpen(false)}
                  className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Stepper Buttons */}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => updateSetting('fontSize', Math.max(8, settings.fontSize - 1))}
                className="py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                title="Decrease font size"
              >
                A−
              </button>
              <button
                onClick={() => updateSetting('fontSize', 25)}
                className="px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer shadow-2xs"
                title="Reset to default (25px)"
              >
                Reset (25)
              </button>
              <button
                onClick={() => updateSetting('fontSize', settings.fontSize + 1)}
                className="py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                title="Increase font size"
              >
                A+
              </button>
            </div>

            {/* Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono">
                <span>12px</span>
                <span>48px</span>
              </div>
              <input
                type="range"
                min="12"
                max="48"
                step="1"
                value={Math.min(48, Math.max(12, settings.fontSize))}
                onChange={(e) => updateSetting('fontSize', parseInt(e.target.value, 10))}
                className="w-full accent-[var(--accent)] cursor-pointer h-1.5 bg-[var(--bg-secondary)] rounded-lg"
              />
            </div>

            {/* Quick Presets */}
            <div className="pt-2 border-t border-[var(--border-color)]/60">
              <div className="text-[10px] text-[var(--text-muted)] mb-1.5 font-medium">Quick Presets</div>
              <div className="grid grid-cols-6 gap-1">
                {[16, 18, 20, 22, 24, 28].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => updateSetting('fontSize', sz)}
                    className={`py-1 rounded text-[10.5px] font-mono transition cursor-pointer text-center ${
                      settings.fontSize === sz
                        ? 'bg-[var(--accent)] text-white font-bold shadow-2xs'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)]/50'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <MatJumpModal isOpen={isMatModalOpen} onClose={() => setIsMatModalOpen(false)} />
      <GoToModal
        isOpen={isGoToOpen}
        onClose={closeGoToModal}
        initialTab={goToInitialTab}
        initialEdition={goToInitialEdition}
      />
      <BookTocModal isOpen={isTocOpen} onClose={() => setIsTocOpen(false)} />
      <BookmarkModal isOpen={isBookmarkOpen} onClose={() => setIsBookmarkOpen(false)} />
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
    </>
  );
}




