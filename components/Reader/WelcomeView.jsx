'use client';

import React, { useState } from 'react';
import { Search, BookSearch, PanelLeft, History, Bookmark, Sparkles, Bot } from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useDictionary } from '../../context/DictionaryContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';
import { typeVelthuis } from '../../services/transliterate';

export default function WelcomeView() {
  const { recentHistory, bookmarks, setIsHistoryOpen, setIsBookmarkOpen, setIsSidebarOpen, openBook, openAiChatTab } = useTabs();
  const { settings, setIsZenMode } = useThemeSettings();
  const { openDictionary } = useDictionary();
  const [dictQuery, setDictQuery] = useState('');

  const { openSearchModal, isSidebarOpen, setIsHeaderVisible } = useTabs();

  // Light variants for light/sepia to avoid harsh black on light UI
  const isLightBadge = settings?.theme === 'classic' || settings?.theme === 'white' || settings?.theme === 'sepia';
  const appStoreSrc = isLightBadge ? '/download-on-the-app-store-light.svg' : '/download-on-the-app-store.svg';
  const playStoreSrc = isLightBadge ? '/Google_Play_Store_badge_EN_light.svg' : '/Google_Play_Store_badge_EN.svg';
  const desktopSrc = isLightBadge ? '/download-for-desktop-light.svg' : '/download-for-desktop.svg';

  const handleOpenTree = () => {
    setIsZenMode(false);
    setIsSidebarOpen(true);
    setIsHeaderVisible(true);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('zen-mode');
    }
  };

  const handleDictSearch = (e) => {
    if (e) e.preventDefault();
    const q = dictQuery.trim();
    if (!q) return;
    openDictionary(q);
    setDictQuery('');
  };

  const handleDictKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDictSearch();
    }
  };

  return (
    <div className="welcome-view">
      <img
        src="/tipitakapali_org_logo.svg"
        alt="TipiṭakaPali.org"
        className="welcome-icon w-16 h-16 rounded-2xl object-contain bg-white shadow-md border border-[var(--border-color)] p-1.5 mb-3"
        width={64}
        height={64}
        loading="eager"
        decoding="async"
      />
      <h1 className="welcome-title">{convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka', settings?.paliScript)}</h1>
      <p className="welcome-desc">
        Explore the complete canonical Pāḷi scriptures. Select any book from the
        navigation tree on the left, open multiple books in tabs, or search across 520,000+
        paragraphs.
      </p>

      {/* Full-text Search — above category cards */}
      <div className="w-full mb-5">
        <div
          onClick={() => openSearchModal('')}
          className="group relative w-full cursor-pointer"
        >
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition" />
          <input
            type="text"
            readOnly
            placeholder="Full-text search — search across the entire Tipiṭaka"
            onFocus={(e) => {
              e.target.blur();
              openSearchModal('');
            }}
            className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] group-hover:border-[var(--accent)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] cursor-pointer outline-none transition shadow-sm group-hover:shadow-md"
          />
        </div>
      </div>

      {/* Category Cards — compact 2-line cards */}
      <div className="category-grid">
        {/* 1. Open Tipitaka Tree */}
        <button
          onClick={handleOpenTree}
          className="category-card group relative text-left !p-3 flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md !min-h-0"
        >
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] group-hover:scale-105 transition shrink-0">
            <PanelLeft size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="!mb-0 !text-[13px] !leading-tight !text-[var(--text-primary)] group-hover:!text-[var(--accent)] transition truncate">
              Open Tipiṭaka Tree
            </h3>
            <p className="!text-[11px] !leading-tight !truncate">217 books • Piṭaka • Nikāya</p>
          </div>
        </button>

        {/* 2. Recent opened books */}
        <button
          onClick={() => setIsHistoryOpen(true)}
          className="category-card group relative text-left !p-3 flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md !min-h-0"
        >
          {recentHistory.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center shadow-md border-2 border-[var(--bg-primary)]">
              {recentHistory.length > 99 ? '99+' : recentHistory.length}
            </span>
          )}
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-105 transition shrink-0">
            <History size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="!mb-0 !text-[13px] !leading-tight !text-[var(--text-primary)] group-hover:!text-blue-600 transition truncate">Recent opened books</h3>
            <p className="!text-[11px] !leading-tight !truncate">
              {recentHistory.length ? `${recentHistory.length} in history` : 'No recent books'}
            </p>
          </div>
        </button>

        {/* 3. Saved bookmarks */}
        <button
          onClick={() => setIsBookmarkOpen(true)}
          className="category-card group relative text-left !p-3 flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md !min-h-0"
        >
          {bookmarks.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center shadow-md border-2 border-[var(--bg-primary)]">
              {bookmarks.length > 99 ? '99+' : bookmarks.length}
            </span>
          )}
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-105 transition shrink-0">
            <Bookmark size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="!mb-0 !text-[13px] !leading-tight !text-[var(--text-primary)] group-hover:!text-amber-600 transition truncate">Saved bookmarks</h3>
            <p className="!text-[11px] !leading-tight !truncate">
              {bookmarks.length ? `${bookmarks.length} saved` : 'Bookmark paragraphs'}
            </p>
          </div>
        </button>

        {/* 4. Study with Ani (AI Nissaya) */}
        <button
          onClick={() => openAiChatTab()}
          className="category-card group relative text-left !p-3 flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md !bg-gradient-to-br from-[var(--bg-card)] to-[var(--accent-light)]/40 !min-h-0"
        >
          <div className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white">Beta</div>
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:scale-105 transition shrink-0">
            <Bot size={18} />
          </div>
          <div className="min-w-0 flex-1 pr-6">
            <h3 className="!mb-0 !text-[13px] !leading-tight !text-[var(--text-primary)] group-hover:!text-violet-600 transition flex items-center gap-1 truncate">
              Ani (AI Nissaya) <span className="text-[9px] font-bold px-1 py-px rounded bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 shrink-0">Beta</span> <Sparkles size={11} className="text-violet-500 shrink-0" />
            </h3>
            <p className="!text-[11px] !leading-tight !truncate">Your Tipiṭaka Study companion</p>
          </div>
        </button>
      </div>

      {/* Dictionary input — below category cards */}
      <div className="w-full mt-5">
        <form onSubmit={handleDictSearch} className="relative group w-full">
          <BookSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition" />
          <input
            type="text"
            value={dictQuery}
            onChange={(e) => {
              const raw = e.target.value;
              const isDeleting = raw.length < dictQuery.length;
              let val = raw;
              if (!isDeleting) {
                const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
                val = hasNonLatin ? raw : typeVelthuis(raw);
              }
              setDictQuery(val);
            }}
            onKeyDown={handleDictKeyDown}
            placeholder="Dictionary - multi words & 17 pāḷi scripts input accepted"
            className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] focus:border-[var(--accent)] group-hover:border-[var(--border-color)] rounded-xl py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition shadow-sm focus:shadow-md group-hover:shadow-sm cursor-text"
          />
        </form>
      </div>
      {/* Store & App Download Links — theme-aware: card wrapper softens black badges on light */}
      <div className="w-full mt-7 pt-5 border-t border-[var(--border-color)]/60 flex flex-col items-center gap-2.5 select-none">
        <p className="text-[11px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">
          Get Tipiṭaka Pāḷi for Mobile & Desktop
        </p>
        <div className="welcome-badges flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {/* iOS App Store */}
          <a
            href="https://apps.apple.com/vn/app/tipitaka-pali-cst/id6743404213"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-all duration-200 hover:scale-[1.03] active:scale-95 inline-flex items-center shrink-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm hover:border-[var(--accent)] hover:shadow-md"
            title="Download on the App Store (iOS / iPadOS / macOS)"
          >
            <img
              src={appStoreSrc}
              alt="Download on the App Store"
              className="h-[38px] sm:h-[40px] w-auto object-contain block"
            />
          </a>

          {/* Google Play Store */}
          <a
            href="https://play.google.com/store/apps/details?id=org.tipitakapali.android"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-all duration-200 hover:scale-[1.03] active:scale-95 inline-flex items-center shrink-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm hover:border-[var(--accent)] hover:shadow-md"
            title="Get it on Google Play (Android)"
          >
            <img
              src={playStoreSrc}
              alt="Get it on Google Play"
              className="h-[38px] sm:h-[40px] w-auto object-contain block"
            />
          </a>

          {/* Desktop Releases */}
          <a
            href="https://github.com/tipitakapali/tipitakapali.org/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-all duration-200 hover:scale-[1.03] active:scale-95 inline-flex items-center shrink-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm hover:border-[var(--accent)] hover:shadow-md"
            title="Download for Desktop (Windows, macOS, Linux)"
          >
            <img
              src={desktopSrc}
              alt="Download for Desktop"
              className="h-[38px] sm:h-[40px] w-auto object-contain block"
            />
          </a>
        </div>
      </div>
    </div>
  );
}

