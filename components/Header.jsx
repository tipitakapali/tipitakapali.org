'use client';

import React, { useEffect } from 'react';
import { Menu, Search, Settings } from 'lucide-react';
import LanguageMenu from './LanguageMenu';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { useTabs } from '../context/TabContext';

export default function Header() {
  const { settings, updateSetting, openSettingsModal } = useThemeSettings();
  const { toggleSidebar, openSearchModal } = useTabs();

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, openSearchModal]);

  return (
    <header className="app-header h-[50px] sm:h-[52px] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-2.5 sm:px-4 flex items-center justify-between shrink-0 z-50 select-none">
      {/* Brand & Menu */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          className="p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
          onClick={toggleSidebar}
          title="Toggle Navigation Tree (Ctrl+B)"
        >
          <Menu size={19} />
        </button>



        <a href="/" className="font-bold text-[15px] sm:text-[17px] text-[var(--accent)] tracking-tight hover:opacity-90 transition">
          <span>TipitakaPali.org</span>
        </a>
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
            placeholder="Search 217 books (Press /)..."
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

        {/* Language & Multi-Translation Menu */}
        <LanguageMenu />

        {/* Theme Dropdown */}
        <select
          value={settings.theme}
          onChange={(e) => updateSetting('theme', e.target.value)}
          className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md px-1.5 sm:px-2 py-1 text-xs text-[var(--text-secondary)] cursor-pointer outline-none"
        >
          <option value="light">☀️ Light</option>
          <option value="sepia">📜 Sepia</option>
          <option value="dark">🌙 Dark</option>
          <option value="oled">🌌 OLED</option>
        </select>

        {/* Settings Button */}
        <button
          className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
          onClick={openSettingsModal}
          title="Advanced Reader Settings"
        >
          <Settings size={14} />
          <span className="hidden sm:inline">Settings</span>
        </button>
      </div>
    </header>
  );
}
