'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Menu, Search, Settings, Bookmark, HelpCircle, BookA } from 'lucide-react';
import LanguageMenu from './LanguageMenu';
import HelpModal from './HelpModal';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { useTabs } from '../context/TabContext';
import { useDictionary } from '../context/DictionaryContext';

export default function Header() {
  const { settings, updateSetting, openSettingsModal } = useThemeSettings();
  const { openDictionary } = useDictionary();
  const {
    toggleSidebar,
    isSidebarOpen,
    isHeaderVisible,
    openSearchModal,
    setIsBookmarkOpen,
    bookmarks,
  } = useTabs();

  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const themeRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (themeRef.current && !themeRef.current.contains(e.target)) {
        setIsThemeOpen(false);
      }
    };
    if (isThemeOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isThemeOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        openSearchModal('');
      }
      if (
        (e.key === '?' || e.key === 'F1') &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        setIsHelpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, openSearchModal]);

  const currentThemeIcon =
    settings.theme === 'sepia'
      ? '📜'
      : settings.theme === 'dark'
      ? '🌙'
      : settings.theme === 'oled'
      ? '🌌'
      : '☀️';

  const isHidden = !isHeaderVisible && !isSidebarOpen;

  return (
    <header
      className={`app-header h-[50px] sm:h-[52px] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-2.5 sm:px-4 flex items-center justify-between shrink-0 z-50 select-none ${
        isHidden ? 'hidden-header' : ''
      }`}
    >
      {/* Brand & Menu */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
          onClick={toggleSidebar}
          title="Toggle Navigation Tree (Ctrl+B)"
        >
          <Menu size={19} />
        </button>

        <button
          onClick={() => setIsHelpOpen(true)}
          className="font-bold text-[15px] sm:text-[17px] text-[var(--accent)] tracking-tight hover:opacity-85 transition cursor-pointer flex items-center gap-1.5 focus:outline-none"
          title="Tipiṭaka Reader — Help & Guide (Press ?)"
        >
          <span className="hidden sm:inline">TipitakaPali.org</span>
        </button>
      </div>

      {/* Desktop Search Bar */}
      <div className="hidden sm:flex flex-1 max-w-[380px] mx-3">
        <div
          className="relative w-full cursor-pointer"
          onClick={() => openSearchModal('')}
        >
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Full text Search (Press /)..."
            readOnly
            className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-full py-1.5 pl-8 pr-9 text-xs text-[var(--text-primary)] cursor-pointer outline-none transition focus:border-[var(--accent)]"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-muted)]">
            /
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Mobile Search Button */}
        <button
          onClick={() => openSearchModal('')}
          className="sm:hidden p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--accent)] transition"
          title="Search books (/)"
        >
          <Search size={17} />
        </button>

        {/* Dictionary Button */}
        <button
          className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
          onClick={() => openDictionary()}
          title="Pāḷi Dictionary Look-up"
        >
          <BookA size={14} className="text-[var(--accent)]" />
          <span className="hidden md:inline">Dict</span>
        </button>

        {/* Language & Multi-Translation Menu */}
        <LanguageMenu />

        {/* Saved (Bookmarks) Button */}
        <button
          className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
          onClick={() => setIsBookmarkOpen(true)}
          title="Saved Bookmarks"
        >
          <Bookmark size={14} className="text-[var(--accent)]" />
          <span className="hidden md:inline">Saved</span>
          {bookmarks.length > 0 && (
            <span className="text-[8.5px] sm:text-[9px] px-1 rounded bg-[var(--accent)] text-white font-bold">
              {bookmarks.length}
            </span>
          )}
        </button>

        {/* Theme Menu (Icon-only on button, labels inside dropdown) */}
        <div className="relative shrink-0" ref={themeRef}>
          <button
            onClick={() => setIsThemeOpen((prev) => !prev)}
            className={`flex items-center justify-center p-1.5 sm:px-2 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer ${
              isThemeOpen ? 'border-[var(--accent)] bg-[var(--accent-light)]' : ''
            }`}
            title="Theme Selection"
          >
            <span className="text-sm leading-none">{currentThemeIcon}</span>
          </button>

          {isThemeOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl p-1.5 w-32 z-50 text-xs animate-fade-in select-none">
              <div className="text-[10px] font-bold text-[var(--text-muted)] px-2 py-1 uppercase tracking-wider">
                Theme
              </div>
              {[
                { id: 'light', icon: '☀️', label: 'Light' },
                { id: 'sepia', icon: '📜', label: 'Sepia' },
                { id: 'dark', icon: '🌙', label: 'Dark' },
                { id: 'oled', icon: '🌌', label: 'OLED' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    updateSetting('theme', t.id);
                    setIsThemeOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition cursor-pointer text-left ${
                    settings.theme === t.id
                      ? 'bg-[var(--accent-light)] text-[var(--accent)] font-bold'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  <span className="text-sm">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings Button */}
        <button
          className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
          onClick={openSettingsModal}
          title="Advanced Reader Settings"
        >
          <Settings size={14} />
          <span className="hidden sm:inline">Settings</span>
        </button>
      </div>

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </header>
  );
}

