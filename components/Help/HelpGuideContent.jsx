'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Keyboard,
  BookOpen,
  Search,
  Layers,
  Sparkles,
  BookSearch,
  ArrowRightLeft,
  ExternalLink,
  ShieldCheck,
  Mail,
  Volume2,
  Sliders,
  Filter,
  Languages,
  ChevronDown,
  Check,
  Columns,
} from 'lucide-react';

export const SHOW_ANDROID_BADGE = process.env.NEXT_PUBLIC_OFFLINE_APP !== 'true';

export const HELP_SECTIONS = [
  { id: 'topic-overview', label: 'TipitakaPali.org Overview', icon: BookOpen },
  { id: 'topic-reading', label: 'Parallel Reading, Tabs & Floating Panels', icon: Columns },
  { id: 'topic-translations', label: 'Language Menu & Pāḷi Layers', icon: Languages },
  { id: 'topic-search', label: 'Full-Text Search (FTS5)', icon: Search },
  { id: 'topic-dict', label: 'Dictionaries & Bold Definitions', icon: BookSearch },
  { id: 'topic-velthuis', label: 'Velthuis & 17 Pāḷi Scripts', icon: Keyboard },
  { id: 'topic-mat', label: 'MAT Cross-Navigation & Linked Previews', icon: Layers },
  { id: 'topic-tts', label: 'Read Aloud (Text-to-Speech)', icon: Volume2 },
  { id: 'topic-ani', label: 'Ani (AI Nissaya) Assistant', icon: Sparkles },
  { id: 'topic-shortcuts', label: 'Shortcuts & Page Editions', icon: Sliders },
  { id: 'topic-attributions', label: 'Attributions, License & Credits', icon: ShieldCheck },
];

export default function HelpGuideContent({ showTabBar = true }) {
  const [selectedTopic, setSelectedTopic] = useState('topic-overview');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectTopic = (topicId) => {
    setSelectedTopic(topicId);
    setIsDropdownOpen(false);

    // Smooth scroll directly to the selected topic without hiding others
    const el = document.getElementById(topicId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Temporary highlight pulse
      el.classList.add('ring-2', 'ring-[var(--accent)]');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-[var(--accent)]');
      }, 1500);
    }
  };

  const currentSection = HELP_SECTIONS.find((s) => s.id === selectedTopic) || HELP_SECTIONS[0];
  const CurrentIcon = currentSection.icon;

  return (
    <div className="text-xs text-[var(--text-secondary)] leading-relaxed relative flex flex-col flex-1">
      {/* Fixed Sticky Header Selector Bar */}
      {showTabBar && (
        <div className="sticky top-0 bg-[var(--bg-secondary)] py-2.5 px-4 sm:px-6 border-b border-[var(--border-color)] z-30 flex items-center justify-between gap-3 shadow-xs shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] shrink-0">
            <Filter size={14} className="text-[var(--accent)]" />
            <span>Jump to Topic:</span>
          </div>

          {/* Custom Dropdown with Lucide Icons */}
          <div className="relative flex-1 sm:max-w-xs" ref={dropdownRef}>
            <button
              type="button"
              aria-expanded={isDropdownOpen}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent)] transition cursor-pointer text-xs font-medium shadow-2xs"
            >
              <div className="flex items-center gap-2 truncate">
                <CurrentIcon size={14} className="text-[var(--accent)] shrink-0" />
                <span className="truncate">{currentSection.label}</span>
              </div>
              <ChevronDown
                size={14}
                className={`text-[var(--text-muted)] shrink-0 transition-transform duration-200 ${
                  isDropdownOpen ? 'rotate-180 text-[var(--accent)]' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu List */}
            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-full min-w-[260px] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-xl z-50 py-1 max-h-72 overflow-y-auto animate-fade-in">
                {HELP_SECTIONS.map((sec) => {
                  const Icon = sec.icon;
                  const isSelected = sec.id === selectedTopic;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => handleSelectTopic(sec.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent-light)] text-[var(--accent)] font-semibold'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                      }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                      <span className="flex-1 truncate">{sec.label}</span>
                      {isSelected && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content Sections Container */}
      <div className="p-4 sm:p-6 space-y-6 flex-1">
        {/* 1. Introduction & Overview */}
        <section id="topic-overview" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              TipitakaPali.org (CST Edition)
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
            <strong>TipitakaPali.org</strong> provides a clean, modern, and high-performance study environment for reading the <strong>Chaṭṭha Saṅgāyana Tipiṭaka (CST)</strong> — <strong>217 books</strong>, <strong>2,695+ chapters</strong>, and <strong>520,000+ paragraphs</strong> covering Mūla, Aṭṭhakathā, Ṭīkā, and Añña treatises.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px] mt-2">
            <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>Authentic CST Source</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Directly synchronized with the official <strong>Vipassana Research Institute (VRI)</strong> TEI XML corpus (latest revision including all errata corrections).
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Languages size={14} className="text-blue-600 dark:text-blue-400" />
                <span>17 Pāḷi Scripts &amp; 23 Translations</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Live transliteration across 17 scripts (Roman, Myanmar, Sinhala, Devanagari, Thai, Khmer, Lao, Brahmi, Tibetan, Cyrillic, etc.) plus 23 modern translations (24 layers including Pāḷi).
              </p>
            </div>
          </div>

          {/* Mobile & Desktop App Downloads */}
          <div className="pt-3 border-t border-[var(--border-color)] flex flex-col items-center gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Download Tipiṭaka Pāḷi App for Offline Study
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
              <a
                href="https://apps.apple.com/vn/app/tipitaka-pali-cst/id6743404213"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                title="Download on the App Store (iOS / iPadOS / macOS)"
              >
                <img
                  src="/download-on-the-app-store.svg"
                  alt="Download on the App Store"
                  className="h-[34px] sm:h-[36px] w-auto object-contain"
                />
              </a>
              {SHOW_ANDROID_BADGE && (
                <a
                  href="https://play.google.com/store/apps/details?id=org.tipitakapali.android"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                  title="Get it on Google Play (Android)"
                >
                  <img
                    src="/Google_Play_Store_badge_EN.svg"
                    alt="Get it on Google Play"
                    className="h-[34px] sm:h-[36px] w-auto object-contain"
                  />
                </a>
              )}
              <a
                href="https://github.com/tipitakapali/tipitakapali.org/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                title="Download for Desktop (Windows, macOS, Linux)"
              >
                <img
                  src="/download-for-desktop.svg"
                  alt="Download for Desktop"
                  className="h-[34px] sm:h-[36px] w-auto object-contain"
                />
              </a>
            </div>
          </div>
        </section>

        {/* 1b. Parallel Reading, Tabs & Non-Shifting Floating Panels */}
        <section id="topic-reading" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Columns size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Parallel Reading, Tabs &amp; Non-Shifting Floating Panels
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Designed for calm, distraction-free study across root texts, commentaries, and sub-commentaries without layout jumps.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Floating Overlays &amp; Opt-In Pin</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">Zero Shift</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Both the <strong>Tipiṭaka Navigation Tree</strong> and <strong>Dictionary panel</strong> (Left/Right Dock) open as <strong>non-shifting floating overlays</strong> by default so your reading line never jumps. Toggle <strong>Pin</strong> whenever you want either panel docked beside the text. Clicking empty space closes unpinned panels, while clicking words inside the dictionary continues looking up words seamlessly.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Multi-Column Parallel Reading &amp; Sync</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">Columns</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Switch tab layouts in the order <strong>Columns | Tabs | Single</strong>, with the <strong>Sync</strong> toggle right next to <strong>Columns</strong> to lock parallel scrolling across Mūla, Aṭṭhakathā, and Ṭīkā. Each column displays a <strong>live per-column section title</strong> as you scroll, and opening <strong>+Aṭṭha</strong>, <strong>+Ṭīkā</strong>, or <strong>+Mūla</strong> preserves your exact scroll position.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Open Tabs Switcher</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] font-semibold">Multi-Tab</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                When two or more books are open, an <strong>Open Tabs switcher button</strong> appears in the tab bar so you can jump directly to any tab, rearrange focus, or close tabs cleanly without horizontal crowding.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Clean App Launch &amp; Saved Progress</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">Fresh Start</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Opening the app starts cleanly without auto-reloading old tabs, while your <strong>Bookmarks</strong>, <strong>Reading History</strong>, and <strong>per-book scroll positions</strong> remain safely preserved on your device whenever you reopen a book.
              </p>
            </div>
          </div>
        </section>

        {/* 2. Redesigned Language Menu & Pāḷi Layers */}
        <section id="topic-translations" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Languages size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Language Menu &amp; Pāḷi Layers (23 Modern Translations)
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Study the Canon alongside <strong>23 modern translations</strong> (<strong>24 reading layers including Pāḷi</strong>) with sentence-aligned parallel modes, custom colors, and a clean two-zone Language Menu.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Two-Zone Language Menu</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] font-semibold">Redesigned</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                The <strong>Enabled</strong> zone lists active layers — including <strong>Pāḷi</strong> as an independent layer — with one-tap move-to-top (<kbd className="font-mono text-[var(--accent)] font-bold">⤒</kbd>), reorder (<kbd className="font-mono text-[var(--accent)] font-bold">▲</kbd>/<kbd className="font-mono text-[var(--accent)] font-bold">▼</kbd>), and per-language color customization. The <strong>Available</strong> zone shows language info and quick enable/disable switches.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Offline Translation Management</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">Offline App</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                In the offline mobile/desktop app, the Language Menu includes built-in <strong>Download</strong>, <strong>Update</strong>, <strong>Delete</strong>, and footer <strong>Check</strong> controls so you can manage local translation databases in one place.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Stacked vs. Side-by-Side Modes</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">Flexible</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Choose <strong>Vertical / Stacked</strong> to view sentence-aligned translations beneath Pāḷi, <strong>Pāḷi – Translation</strong> (Pāḷi left, translation right), or <strong>Translation – Pāḷi</strong> (translation left, Pāḷi right). Toggle sentence alignment or full-paragraph display anytime.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Color-Coded Language Accents</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">Custom</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Each translation layer features a customizable border/text color (e.g. Royal Blue for English, Crimson for Vietnamese, Jade Green for Myanmar) so you distinguish layers effortlessly without visual clutter.
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5 text-[11.5px] text-[var(--text-primary)]">
            <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span>⚠️ AI-Assisted Translation Notice</span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              All translation corpora are adapted from the{' '}
              <a
                href="https://epitaka.org/about"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline font-semibold inline-flex items-center gap-0.5"
              >
                Epitaka AI Translation Project <ExternalLink size={10} />
              </a>
              . Because these texts are machine-generated with artificial intelligence, they <strong>may contain errors or inaccuracies and are not authoritative</strong>. Readers are urged to verify key passages against the original Pāḷi text with discernment and wisdom.
            </p>
          </div>
        </section>

        {/* 3. Full-Text Search (FTS5) */}
        <section id="topic-search" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              High-Performance Full-Text Search (FTS5)
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Search instantaneously across all <strong>217 books</strong> and <strong>520,000+ canonical paragraphs</strong> in Pāḷi or across the <strong>23 modern translations</strong>, powered by a dedicated SQLite FTS5 prefix engine.
          </p>

          {/* Search Controls Breakdown */}
          <div className="space-y-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Filter size={14} className="text-[var(--accent)]" />
                <span>Literature Group, Piṭaka &amp; Translation Scope</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Narrow your search results to specific textual strata, collections, or languages:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Group Filter:</strong> All, Mūla (Root Canon), Aṭṭhakathā (Commentaries), Ṭīkā (Sub-commentaries), Añña (Extra).
                </div>
                <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Piṭaka Filter:</strong> All, Vinaya, Sutta (Dīgha, Majjhima, Saṃyutta, Aṅguttara, Khuddaka), Abhidhamma, Añña.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sliders size={14} className="text-[var(--accent)]" />
                <span>Word Distance &amp; Proximity Search (NEAR)</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Control the maximum word span between multiple search terms:
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                <li className="p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Any:</strong> Matches terms anywhere in the paragraph (<code className="font-mono text-[var(--accent)]">AND</code>).
                </li>
                <li className="p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>1 word (Exact):</strong> Matches terms as an exact contiguous phrase (<code className="font-mono text-[var(--accent)]">"evaṃ me sutaṃ"</code>).
                </li>
                <li className="p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>2, 3, 5, 8, 10 words:</strong> Matches terms occurring within N words of each other using <code className="font-mono text-[var(--accent)]">NEAR()</code>.
                </li>
                <li className="p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Prefix Wildcards:</strong> Fast prefix search (<code className="font-mono text-[var(--accent)]">dha*</code>, <code className="font-mono text-[var(--accent)]">buddha*</code>) using dedicated prefix indexing.
                </li>
              </ul>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Layers size={14} className="text-[var(--accent)]" />
                <span>Result Sorting &amp; Accurate Paragraph Jumping</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1 text-[11px]">
                <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong className="text-[var(--accent)]">Piṭaka Order (Default)</strong>
                  <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Hierarchical canonical order: Mūla → Aṭṭhakathā → Ṭīkā, Vinaya → Sutta → Abhidhamma.</div>
                </div>
                <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Relevant / BM25</strong>
                  <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Ranked by term density or statistical BM25 probabilistic relevance scoring.</div>
                </div>
                <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                  <strong>Accurate Jump with Translations</strong>
                  <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Clicking any search result, TOC heading, or paragraph target lands precisely on the matching paragraph even when translations are enabled.</div>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--accent-light)] border border-[var(--accent-border)] text-[11.5px] text-[var(--text-primary)] flex items-start gap-2">
              <Sparkles size={15} className="text-[var(--accent)] shrink-0 mt-0.5" />
              <div>
                <strong>Footnotes &amp; Variant Readings Included:</strong> The search index preserves scholarly variant readings (e.g. <code className="font-mono text-[var(--accent)]">syā.</code>, <code className="font-mono text-[var(--accent)]">ka.</code>, <code className="font-mono text-[var(--accent)]">pī.</code>) and manuscript annotations. Shareable URLs such as <code className="font-mono text-[var(--accent)]">/?q=anatta</code> open search directly.
              </div>
            </div>
          </div>
        </section>

        {/* 4. Integrated Dictionaries & Pre-Indexed Bold Definitions */}
        <section id="topic-dict" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <BookSearch size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Integrated Dictionaries &amp; 387K+ Pre-Indexed Bold Definitions
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Click or tap any Pāḷi word while reading — or even click words <em>inside</em> the dictionary panel itself — to view grammatical breakdowns, root families, inflection tables, compound splits, and canonical bold definitions:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Digital Pāḷi Dictionary (DPD)</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] font-semibold">Primary</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Over 90,000+ entries with complete grammatical breakdowns, case inflection tables, verbal conjugations, Sanskrit cognates, and root families.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Pre-Indexed Canonical Bold Definitions</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold">387K+ Glosses</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Instantly searches <strong>387,000+ bold headword definitions</strong> extracted across Aṭṭhakathā, Ṭīkā, Visuddhimagga, and Mūla with aligned translations and direct jumps to the source paragraph.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>DPD Compound Splitter &amp; PTS PED</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">Sandhi + PTS</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Splits long <span className="italic">samāsa</span>/sandhi compounds into lexical units alongside the authoritative PTS Pāḷi–English Dictionary (Rhys Davids &amp; Stede, corrected 2015 reprint).
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Classical &amp; Sanskrit Lexicons</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">Comparative</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Tipiṭaka Pāḷi–Myanmar Abhidhān, Pāḷi–Sinhala Dictionary, and Cologne Sanskrit lexicons (Monier-Williams, V.S. Apte, Edgerton Buddhist Hybrid Sanskrit).
              </p>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[11.5px] space-y-1">
            <strong>Non-Shifting Floating Dock &amp; In-Panel Lookups:</strong> In Settings, choose <em>Left Dock</em>, <em>Center Modal</em>, or <em>Right Dock</em>. Docked panels float cleanly over the edge without shifting your text (click <strong>Pin</strong> to dock beside the text). Click empty space outside to dismiss an unpinned panel, or click any Pāḷi word inside the dictionary to look it up immediately.
          </div>
        </section>

        {/* 5. Velthuis Typing Scheme & 17 Scripts */}
        <section id="topic-velthuis" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Velthuis Pāḷi Typing System &amp; 17 Scripts
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Type Pāḷi with standard Latin keyboards. The search bar, dictionary lookup, and TOC filters automatically convert Velthuis input in real time:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px] mt-2">
            <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] text-xs mb-1">Long Vowels &amp; Niggahīta</div>
              <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
                <span className="text-[var(--text-secondary)]">aa, ii, uu</span>
                <span className="font-bold text-[var(--accent)]">ā, ī, ū</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
                <span className="text-[var(--text-secondary)]">.m or m..</span>
                <span className="font-bold text-[var(--accent)]">ṃ / ṁ</span>
              </div>
              <div className="flex justify-between py-0.5 font-mono">
                <span className="text-[var(--text-secondary)]">AA, II, UU, .M</span>
                <span className="font-bold text-[var(--accent)]">Ā, Ī, Ū, Ṃ</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] text-xs mb-1">Retroflex &amp; Nasals</div>
              <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
                <span className="text-[var(--text-secondary)]">.t, .d, .n, .l</span>
                <span className="font-bold text-[var(--accent)]">ṭ, ḍ, ṇ, ḷ</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
                <span className="text-[var(--text-secondary)]">~n or ,,n</span>
                <span className="font-bold text-[var(--accent)]">ñ</span>
              </div>
              <div className="flex justify-between py-0.5 font-mono">
                <span className="text-[var(--text-secondary)]">&quot;n or n..</span>
                <span className="font-bold text-[var(--accent)]">ṅ</span>
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-[var(--accent-light)] border border-[var(--accent-border)] text-[11.5px] text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--accent)] shrink-0" />
            <span>
              <strong>Examples:</strong> Type <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">nibbaana</code> → <strong>nibbāna</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">buddha.m</code> → <strong>buddhaṃ</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">sa,,naa</code> → <strong>saññā</strong>.
            </span>
          </div>

          {/* Link to Standalone Pāḷi Script Converter Tool */}
          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <strong className="text-[var(--text-primary)] text-xs">Standalone Pāḷi Script Converter Tool</strong>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Convert text between all 17 scripts and Roman Velthuis instantly. Works fully offline in browser.
              </p>
            </div>
            <a
              href="/pali-script-converter.html"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-bold hover:opacity-90 transition shrink-0 inline-flex items-center justify-center gap-1.5 shadow-2xs"
            >
              <span>Open Converter</span>
              <ExternalLink size={11} />
            </a>
          </div>
        </section>

        {/* 6. MAT Cross-Navigation & Linked Definition Previews */}
        <section id="topic-mat" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              MAT Cross-Navigation &amp; Linked Definition Previews
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Move effortlessly between root canon, commentaries, and sub-commentaries with inline linked previews or parallel columns:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-emerald-500/30 space-y-1">
              <span className="font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] uppercase tracking-wider inline-block">
                Mūla (Root)
              </span>
              <div className="font-semibold text-[var(--text-primary)] mt-1">The Canonical Discourses</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Primary Sutta, Vinaya, and Abhidhamma texts spoken by the Buddha and chief disciples.</div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-amber-500/30 space-y-1">
              <span className="font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-[10px] uppercase tracking-wider inline-block">
                Aṭṭhakathā
              </span>
              <div className="font-semibold text-[var(--text-primary)] mt-1">Ancient Commentaries</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Commentaries clarifying words, doctrinal nuances, and background stories of the Mūla.</div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-purple-500/30 space-y-1">
              <span className="font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 text-[10px] uppercase tracking-wider inline-block">
                Ṭīkā
              </span>
              <div className="font-semibold text-[var(--text-primary)] mt-1">Sub-Commentaries</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Sub-commentaries clarifying technical points of the Aṭṭhakathā.</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <ArrowRightLeft size={14} className="text-[var(--accent)]" />
                <span>MAT Toolbar &amp; Parallel Columns</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Use <strong>MAT</strong> or <strong>+Aṭṭha / +Ṭīkā / +Mūla</strong> to open the matching commentary right beside your current text while keeping your exact reading scroll position intact.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Sparkles size={14} className="text-[var(--accent)]" />
                <span>Linked Definition Popup Previews</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Click any inline linked definition badge to preview the exact commentary or sub-commentary gloss with <strong>per-line selection</strong>, aligned translations, <strong>direct Open in Reader</strong>, and a convenient wider <strong>Close</strong> button.
              </p>
            </div>
          </div>
        </section>

        {/* 7. Read Aloud (Text-to-Speech) */}
        <section id="topic-tts" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Read Aloud (Text-to-Speech)
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Listen to enabled translations while reading: tap the <strong>Read</strong> button in the bottom footer (right after <strong>Toc</strong>). Reading starts at the paragraph currently at the top of your screen and continues automatically into the next chapter.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)]">Language selection</div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Only enabled translation languages are spoken (Pāḷi speech is not supported). With one translation enabled it reads straight away; with two or more, pick which languages to hear — remembered until your enabled languages change.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)]">Player &amp; voice controls</div>
              <p className="text-[11px] text-[var(--text-muted)]">
                The floating mini-player offers play/pause, stop, previous/next paragraph, follow-along highlighting, and per-language voice, speed, pitch, and volume controls. <strong>Reset</strong> restores defaults cleanly.
              </p>
            </div>
          </div>
        </section>

        {/* 8. Ani (AI Nissaya) Assistant */}
        <section id="topic-ani" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Ani (AI Nissaya) Assistant <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400">Beta</span>
            </h3>
          </div>
          <p className="text-[12px] text-[var(--text-secondary)]">
            <strong>Ani (AI Nissaya)</strong> is your AI research companion for the Tipiṭaka — open it from the <strong>Ani</strong> header button or via <code className="font-mono text-[var(--accent)]">?tab=ai</code>.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Concept-Group Search</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">Smart RAG</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Step 1 automatically breaks complex questions into <strong>main Concept Groups</strong> with suggested <strong>Pāḷi terms/stems</strong> and <strong>English keywords/synonyms</strong>, then runs tiered boolean-intersection search across Pāḷi and translations to find the exact suttas and paragraphs.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Bold Definitions &amp; Sentence Citations</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold">387K+ Glosses</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Queries <strong>387,000+ pre-indexed canonical bold definitions</strong> alongside DPD, Aṭṭhakathā, Ṭīkā, and sentence-aligned translations. Clickable <strong>Sources</strong> chips (including sentence-level <code className="font-mono">[book:cX:pY-LZ]</code>) preview passages and jump straight into the Reader.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Zero-Key-Escape &amp; Multi-Provider</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 font-semibold">Private</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Your API key stays strictly in your browser and is never sent to TipitakaPali.org servers. Supports free <strong>Google Gemini</strong> keys as well as <strong>OpenAI</strong>, <strong>OpenRouter</strong>, and custom/local OpenAI-compatible endpoints.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>RAG Mode vs. Knowledge Mode</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">RAG default</span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                <strong>RAG Mode</strong> (default) grounds answers in verified Tipiṭaka database tool calls with collapsible Step 1 &amp; Step 2 research cards; <strong>Knowledge Mode</strong> answers directly from the model. Tap the mode badge in the chat header to switch.
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5 text-[11.5px] text-[var(--text-primary)]">
            <div className="font-bold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span>⚠️ Ani Can Make Mistakes</span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Ani is inspired by and built on the <strong>summaries.db</strong> database of <a href="https://epitaka.org/about" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline font-semibold inline-flex items-center gap-0.5">Vīmaṃsa <ExternalLink size={10} /></a> in the ePitaka app. Always verify important doctrinal points against the original Pāḷi text.
            </p>
          </div>
        </section>

        {/* 9. Shortcuts, Page Editions & Gestures */}
        <section id="topic-shortcuts" className="scroll-mt-14 space-y-4">
          {/* Keyboard Shortcuts */}
          <div className="bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] space-y-3 transition duration-300">
            <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
              <Keyboard size={16} className="text-[var(--accent)]" />
              <span>Keyboard Shortcuts</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px]">
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span>Full-Text Search</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">/</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span>Toggle Navigation Sidebar</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Ctrl + B</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span>Open Help &amp; Guide</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">? or F1</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span>Close Modals / Dialogs</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Esc</kbd>
              </div>
            </div>
          </div>

          {/* Page Editions Guide */}
          <div className="bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] space-y-3">
            <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
              <Layers size={16} className="text-[var(--accent)]" />
              <span>Page Break Editions &amp; Letter Abbreviations</span>
            </h3>
            <p className="text-[11.5px] text-[var(--text-muted)]">
              Page break badges e.g. <code className="font-mono text-[var(--accent)] bg-[var(--bg-secondary)] px-1 py-0.5 rounded">[M 1.0029]</code> or <code className="font-mono text-[var(--accent)] bg-[var(--bg-secondary)] px-1 py-0.5 rounded">[V 1.0031]</code> represent exact page boundaries in historical printed editions:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">V</span>
                <div>
                  <strong className="text-[var(--text-primary)]">VRI</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Vipassana Research Institute</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">M</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Myanmar</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Chaṭṭha Saṅgāyana Edition</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">P</span>
                <div>
                  <strong className="text-[var(--text-primary)]">PTS</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Pali Text Society (London)</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">T</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Thai</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Royal Thai Edition</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2 col-span-2 sm:col-span-2">
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">O</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Other</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Extra-canonical &amp; Special Editions</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 10. Attributions, Credits, License & Contact */}
        <section id="topic-attributions" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[var(--accent)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Attributions &amp; Resource Credits
            </h3>
          </div>

          <div className="space-y-3 text-[11.5px]">
            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">1. Digital Roman Pāḷi Tipiṭaka Text</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                The digital Pāḷi text is adapted from the official VRI TEI XML corpus (<a href="https://github.com/VipassanaTech/tipitaka-xml" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">tipitaka-xml <ExternalLink size={10} /></a>). Sub-chapter chunking follows <a href="https://tipitaka.org/romn/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">tipitaka.org/romn <ExternalLink size={10} /></a>. Freely made available for non-commercial Dhamma study with attribution to the Vipassana Research Institute.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">2. Pāḷi Script Converter &amp; Pāḷi-Sinhala Dictionary</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                Script transliteration engine powered by <a href="https://github.com/Path-Nirvana-Foundation/pali-script-converter" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">Path Nirvana Foundation <ExternalLink size={10} /></a>. Pāḷi-Sinhala dictionary data used with permission from Path Nirvana Foundation (<a href="https://github.com/pnfo/pali-sinhala-dictionary" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">pali-sinhala-dictionary <ExternalLink size={10} /></a>).
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">3. Digital Pāḷi Dictionary (DPD)</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                DPD dictionary data, grammatical modules, and styles obtained from <a href="https://digitalpalidictionary.github.io" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">Digital Pāḷi Dictionary <ExternalLink size={10} /></a> by Ven. Bodhirasa and contributors, licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">CC BY-NC 4.0</a>.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">4. Pāḷi Text Society&apos;s Pāḷi-English Dictionary (PTS PED)</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                Digitized PTS dictionary data adapted from <a href="https://buddhadust.net" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Buddhadust</a>, based on the corrected 2015 reprint by K.R. Norman, William Pruitt, and Peter Jackson, published by <a href="https://palitextsociety.org" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">The Pāḷi Text Society <ExternalLink size={10} /></a> (CC BY-NC 3.0).
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">5. Sanskrit-English Dictionaries</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                Cologne Digital Sanskrit Dictionaries (<a href="https://www.sanskrit-lexicon.uni-koeln.de" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">Cologne University <ExternalLink size={10} /></a>) by Thomas Malten &amp; The Sanskrit Library (CC BY-NC-SA 3.0), including Monier-Williams (1899), V.S. Apte (1890), and Edgerton&apos;s Buddhist Hybrid Sanskrit Dictionary (1953).
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">6. Tipiṭaka Pāḷi-Myanmar (Abhidhān) Data</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                Adapted from Tipiṭaka App &amp; Tipiṭaka Abidan developed by Ven. Pn Daza.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">7. AI-Assisted Translations (Epitaka)</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                Multilingual translation datasets across 23 modern languages (24 reading layers including Pāḷi) adapted from the AI-Assisted Translation Project by <a href="https://epitaka.org/about" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">Epitaka <ExternalLink size={10} /></a>. Freely provided for non-commercial Dhamma study and cross-reference with the canonical Pāḷi root text.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
              <strong className="text-[var(--text-primary)]">8. License &amp; Usage Terms</strong>
              <p className="text-[11px] text-[var(--text-muted)]">
                This application is distributed under the <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Creative Commons Attribution-NonCommercial-ShareAlike 3.0 (CC BY-NC-SA 3.0)</a> and <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">CC BY-NC 4.0</a> licenses for non-commercial Dhamma dāna study.
                {' '}See our <a href="/terms_of_service.html" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Terms of Service</a> and <a href="/privacy_policy.html" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Privacy Policy</a>.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
              <div>
                <strong className="text-[var(--text-primary)] flex items-center gap-1.5">
                  <Mail size={14} className="text-[var(--accent)]" />
                  <span>Feedback &amp; Contact</span>
                </strong>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Email: <code className="font-mono text-[var(--accent)] select-all">tipitakapali.org@gmail.com</code> &middot; Web: <a href="https://tipitakapali.org" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">tipitakapali.org</a>
                </div>
              </div>
            </div>
          </div>

          {/* Store & App Download Links */}
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] flex flex-col items-center gap-2.5 text-center">
            <div className="text-xs font-bold text-[var(--text-primary)]">
              Install Tipiṭaka Pāḷi on your devices
            </div>
            <div className="text-[11px] text-[var(--text-muted)] max-w-md">
              Available on iOS, iPadOS, macOS, Android, Windows, and Linux with full offline capability.
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 mt-1">
              <a
                href="https://apps.apple.com/vn/app/tipitaka-pali-cst/id6743404213"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                title="Download on the App Store (iOS / iPadOS / macOS)"
              >
                <img
                  src="/download-on-the-app-store.svg"
                  alt="Download on the App Store"
                  className="h-[34px] sm:h-[36px] w-auto object-contain"
                />
              </a>
              {SHOW_ANDROID_BADGE && (
                <a
                  href="https://play.google.com/store/apps/details?id=org.tipitakapali.android"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                  title="Get it on Google Play (Android)"
                >
                  <img
                    src="/Google_Play_Store_badge_EN.svg"
                    alt="Get it on Google Play"
                    className="h-[34px] sm:h-[36px] w-auto object-contain"
                  />
                </a>
              )}
              <a
                href="https://github.com/tipitakapali/tipitakapali.org/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-transform duration-200 hover:scale-105 active:scale-95 inline-flex items-center shadow-2xs rounded-lg overflow-hidden shrink-0"
                title="Download for Desktop (Windows, macOS, Linux)"
              >
                <img
                  src="/download-for-desktop.svg"
                  alt="Download for Desktop"
                  className="h-[34px] sm:h-[36px] w-auto object-contain"
                />
              </a>
            </div>
          </div>

          {/* Closing Blessing */}
          <div className="text-center pt-2 border-t border-[var(--border-color)] text-[13px] font-bold text-[var(--accent)]">
            Ciraṃ tiṭṭhatu saddhammo, dhamme hontu sagāravā.
            <div className="text-[11px] font-normal text-[var(--text-muted)] mt-0.5 italic">
              &ldquo;May the True Dhamma endure long, and may all beings revere the Dhamma.&rdquo;
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
