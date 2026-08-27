'use client';

import React, { useState } from 'react';
import { Search, BookA, PanelLeft, History, Bookmark, Sparkles, Bot, X, Send } from 'lucide-react';
import { useTabs } from '../../context/TabContext';
import { useDictionary } from '../../context/DictionaryContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';
import { typeVelthuis } from '../../services/transliterate';

export default function WelcomeView() {
  const { recentHistory, bookmarks, setIsHistoryOpen, setIsBookmarkOpen, setIsSidebarOpen, openBook } = useTabs();
  const { settings, setIsZenMode } = useThemeSettings();
  const { openDictionary } = useDictionary();
  const [dictQuery, setDictQuery] = useState('');
  const [isAISayaOpen, setIsAISayaOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');

  const { openSearchModal, isSidebarOpen, setIsHeaderVisible } = useTabs();

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

  const handleAISubmit = (e) => {
    if (e) e.preventDefault();
    if (!aiInput.trim()) return;
    setAiInput('');
    setIsAISayaOpen(false);
  };

  return (
    <div className="welcome-view">
      <img
        src="/apple-touch-icon.png"
        alt="TipiṭakaPali.org"
        className="welcome-icon w-16 h-16 rounded-2xl object-cover shadow-md border border-[var(--border-color)] mb-3"
        width={64}
        height={64}
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

        {/* 4. Study with Tipiṭaka Saya */}
        <button
          onClick={() => setIsAISayaOpen(true)}
          className="category-card group relative text-left !p-3 flex items-center gap-3 hover:border-[var(--accent)] hover:shadow-md !bg-gradient-to-br from-[var(--bg-card)] to-[var(--accent-light)]/40 !min-h-0"
        >
          <div className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white">NEW</div>
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:scale-105 transition shrink-0">
            <Bot size={16} />
          </div>
          <div className="min-w-0 flex-1 pr-6">
            <h3 className="!mb-0 !text-[13px] !leading-tight !text-[var(--text-primary)] group-hover:!text-violet-600 transition flex items-center gap-1 truncate">
              Tipiṭaka Saya <Sparkles size={11} className="text-violet-500 shrink-0" />
            </h3>
            <p className="!text-[11px] !leading-tight !truncate">Your Pāḷi study companion</p>
          </div>
        </button>
      </div>

      {/* Dictionary input — below category cards */}
      <div className="w-full mt-5">
        <form onSubmit={handleDictSearch} className="relative group w-full">
          <BookA size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition" />
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

      {/* Tipiṭaka Saya Modal */}
      {isAISayaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setIsAISayaOpen(false)}>
          <div
            className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-br from-violet-500 via-indigo-500 to-violet-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                  <Bot size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Tipiṭaka Saya</h3>
                  <p className="text-xs text-white/80">Your Pāḷi study companion • tipitakapali.org</p>
                </div>
              </div>
              <button onClick={() => setIsAISayaOpen(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[var(--bg-secondary)]/50">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-500 flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-white" />
                </div>
                <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] shadow-sm">
                  <p>Sādhu! I am <b>Tipiṭaka Saya</b> — ask me about Pāḷi grammar, translation, or Dhamma concepts.</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1.5">Try: “Explain paṭiccasamuppāda in simple terms” or “What is the difference between samādhi and jhāna?”</p>
                </div>
              </div>
              <div className="text-center py-2">
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300">Coming soon — AI tab will open here</span>
              </div>
            </div>
            <form onSubmit={handleAISubmit} className="p-3 bg-[var(--bg-primary)] border-t border-[var(--border-color)] flex items-center gap-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Ask Tipiṭaka Saya anything…"
                className="flex-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2.5 px-3.5 text-sm outline-none focus:border-violet-500 text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <button type="submit" className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition shadow-sm">
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
