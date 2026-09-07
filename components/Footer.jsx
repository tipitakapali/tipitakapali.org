'use client';

import React, { useState } from 'react';
import {
  ListTree,
  Bookmark,
  Layers,
  Languages,
  Navigation,
  ScrollText,
  Type,
  X,
  Maximize2,
  AlignLeft,
  AlignJustify,
} from 'lucide-react';


import BookTocModal from './BookTocModal';
import MatJumpModal from './MatJumpModal';
import GoToModal from './GoToModal';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';

export default function Footer() {
  const {
    activeTab,
    activeParaNum,
    setActiveParaNum,
    bookmarks,
    isGoToOpen,
    openGoToModal,
    closeGoToModal,
    goToInitialTab,
    goToInitialEdition,
    isHeaderVisible,
    isSidebarOpen,
    setIsSidebarOpen,
  } = useTabs();
  const { settings, updateSetting, updateSettings, setIsZenMode } = useThemeSettings();


  const [isFontSizeOpen, setIsFontSizeOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isMatModalOpen, setIsMatModalOpen] = useState(false);

  const isHidden = !isHeaderVisible && !isSidebarOpen;

  return (
    <>
      <footer className={`app-footer w-full max-w-full overflow-x-auto overflow-y-hidden h-[46px] sm:h-[48px] bg-transparent px-2 sm:px-4 flex items-center justify-center shrink-0 z-40 text-xs select-none box-border ${
        isHidden ? 'hidden-footer' : ''
      }`}>
        {/* Navigation Buttons Group */}
        <div className="footer-nav-group mx-auto flex items-center justify-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Text Size Button */}
          <button
            onClick={() => setIsFontSizeOpen(true)}
            className={`footer-nav-btn inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] sm:text-xs font-semibold leading-none cursor-pointer shrink-0 ${
              isFontSizeOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
            }`}
            title="Adjust Text Size"
          >
            <Type size={13} className="text-[var(--accent)] shrink-0" />
            <span>Size</span>
          </button>

          {/* MAT Button */}
          <button
            onClick={() => {
              if (typeof document !== 'undefined') {
                const container = document.querySelector('main.content-area') || document.querySelector('.content-area') || document.querySelector('main');
                if (container) {
                  const containerRect = container.getBoundingClientRect();
                  const targetY = containerRect.top + 100;
                  const paras = container.querySelectorAll('[data-para]');
                  let currentVisible = null;
                  for (const p of paras) {
                    const r = p.getBoundingClientRect();
                    if (r.top <= targetY && r.bottom > containerRect.top) {
                      currentVisible = p.getAttribute('data-para');
                    }
                  }
                  if (!currentVisible) {
                    for (const p of paras) {
                      const r = p.getBoundingClientRect();
                      if (r.bottom >= containerRect.top) {
                        currentVisible = p.getAttribute('data-para');
                        break;
                      }
                    }
                  }
                  if (currentVisible) {
                    setActiveParaNum(currentVisible);
                  }
                }
              }
              setIsMatModalOpen(true);
            }}
            disabled={!activeTab}
            className="footer-nav-btn inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] sm:text-xs font-semibold leading-none cursor-pointer shrink-0"
            title="Jump to Connected Mūla, Aṭṭhakathā, Ṭīkā"
          >
            <Layers size={13} className="text-[var(--accent)] shrink-0" />
            <span>MAT</span>
            {activeParaNum && (
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] font-mono font-bold leading-none inline-flex items-center">
                {activeParaNum}
              </span>
            )}
          </button>

          {/* Go Button */}
          <button
            onClick={() => openGoToModal('para')}
            disabled={!activeTab}
            className="footer-nav-btn inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] sm:text-xs font-semibold leading-none cursor-pointer shrink-0"
            title="Go to Paragraph or Page Number"
          >
            <Navigation size={13} className="text-[var(--accent)] shrink-0" />
            <span>Go</span>
          </button>

          {/* Book Toc */}
          <button
            onClick={() => setIsTocOpen(true)}
            disabled={!activeTab}
            className="footer-nav-btn inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] sm:text-xs font-semibold leading-none cursor-pointer shrink-0"
            title="Open Book Table of Contents"
          >
            <ListTree size={14} className="text-[var(--accent)] shrink-0" />
            <span>Toc</span>
          </button>

          {/* Eka Mode / Expand Button */}
          <button
            onClick={() => {
              setIsZenMode(true);
              setIsSidebarOpen(false);
              if (typeof document !== 'undefined') {
                document.body.classList.add('zen-mode');
              }
            }}
            className="footer-nav-btn inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] sm:text-xs font-semibold leading-none cursor-pointer shrink-0"
            title="Enter Eka Mode (Distraction-free reading)"
          >
            <Maximize2 size={13} className="text-[var(--accent)] shrink-0" />
            <span>Eka</span>
          </button>
        </div>
      </footer>




      {/* Size Menu — Typography Quick Controls */}
      {isFontSizeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-2xs animate-fade-in text-[var(--text-primary)]"
          onClick={() => setIsFontSizeOpen(false)}
        >
          <div
            className="w-full max-w-[360px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl text-xs animate-in zoom-in-95 duration-100 select-none flex flex-col max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-color)]/60 px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-[var(--accent-light)] text-[var(--accent)]">
                  <Type size={15} />
                </div>
                <span className="font-bold text-xs text-[var(--text-primary)]">Text Size & Typography</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsFontSizeOpen(false)}
                  className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
              {/* Translation-only settings */}
              <div className="space-y-1.5 rounded-xl border border-violet-500/40 bg-violet-500/5 p-3">
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <Languages size={13} className="text-violet-500 shrink-0" />
                    Translation Font-size
                  </span>
                  <span className="flex items-center font-mono text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/40 text-[10px]">
                    <input
                      type="number"
                      min="8"
                      value={settings.translationFontSize ?? settings.fontSize}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val > 0) {
                          updateSetting('translationFontSize', val);
                        }
                      }}
                      className="w-9 bg-transparent text-center font-bold outline-none"
                      aria-label="Translation font size in pixels"
                    />
                    <span>px</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSetting('translationFontSize', Math.max(8, (settings.translationFontSize ?? settings.fontSize) - 1))}
                    className="py-1.5 rounded-lg border border-violet-500/40 bg-[var(--bg-card)] hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400 transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                    title="Decrease translation font size"
                  >
                    A−
                  </button>
                  <button
                    onClick={() => updateSetting('translationFontSize', (settings.translationFontSize ?? settings.fontSize) + 1)}
                    className="py-1.5 rounded-lg border border-violet-500/40 bg-[var(--bg-card)] hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400 transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                    title="Increase translation font size"
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* Line Height — applies to both Pāḷi and translation text */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold">
                  <span className="text-[var(--text-secondary)]">Line Height</span>
                  <span className="flex items-center font-mono text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.5 rounded border border-[var(--accent-border)] text-[10px]">
                    <input
                      type="number"
                      min="1"
                      step="0.05"
                      value={settings.lineHeight}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val > 0) {
                          updateSetting('lineHeight', val);
                        }
                      }}
                      className="w-12 bg-transparent text-center font-bold outline-none"
                      aria-label="Line height"
                    />
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono">
                  <span>1.4</span>
                  <span>2.6</span>
                </div>
                <input
                  type="range"
                  min="1.4"
                  max="2.6"
                  step="0.05"
                  value={settings.lineHeight}
                  onChange={(e) => updateSetting('lineHeight', parseFloat(e.target.value))}
                  className="w-full accent-[var(--accent)] cursor-pointer h-1.5 bg-[var(--bg-secondary)] rounded-lg"
                />
              </div>

              {/* Pāḷi-only settings */}
              <div className="space-y-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-light)] p-3">
                {/* Pāḷi Font Size — number input with A− / A+ steppers */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <ScrollText size={13} className="text-[var(--accent)] shrink-0" />
                      Pāḷi Font-size
                    </span>
                    <span className="flex items-center font-mono text-[var(--accent)] bg-[var(--bg-card)] px-1.5 py-0.5 rounded border border-[var(--accent-border)] text-[10px]">
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
                        className="w-9 bg-transparent text-center font-bold text-[var(--accent)] outline-none"
                        aria-label="Pali font size in pixels"
                      />
                      <span>px</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateSetting('fontSize', Math.max(8, settings.fontSize - 1))}
                      className="py-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--bg-card)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                      title="Decrease Pāḷi font size"
                    >
                      A−
                    </button>
                    <button
                      onClick={() => updateSetting('fontSize', settings.fontSize + 1)}
                      className="py-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--bg-card)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] transition font-bold text-xs flex-1 text-center cursor-pointer shadow-2xs"
                      title="Increase Pāḷi font size"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </div>

              {/* Reset to Defaults */}
              <button
                onClick={() => updateSettings({ fontSize: 22, lineHeight: 1.85, translationFontSize: null })}
                className="w-full py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer shadow-2xs"
                title="Reset to defaults (Pāḷi 22px / line height 1.85, translation follows Pāḷi)"
              >
                Reset to Defaults (22px)
              </button>

              {/* Text Alignment */}
              <div>
                <div className="text-[10px] text-[var(--text-muted)] mb-1.5 font-medium">Text Alignment</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => updateSetting('textAlign', 'left')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      settings.textAlign === 'left'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]'
                    }`}
                  >
                    <AlignLeft size={14} />
                    <span>Left</span>
                  </button>
                  <button
                    onClick={() => updateSetting('textAlign', 'justify')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      settings.textAlign === 'justify'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-border)]'
                    }`}
                  >
                    <AlignJustify size={14} />
                    <span>Justified</span>
                  </button>
                </div>
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
    </>
  );
}




