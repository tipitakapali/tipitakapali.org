'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  HelpCircle,
  Keyboard,
  BookOpen,
  Search,
  Layers,
  Sparkles,
  BookA,
  ArrowRightLeft,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Mail,
  Sliders,
  Filter,
  Languages,
  ChevronDown,
  Check,
} from 'lucide-react';

export const HELP_SECTIONS = [
  { id: 'topic-overview', label: 'Tipiṭaka Reader Overview', icon: BookOpen },
  { id: 'topic-search', label: 'Full-Text Search (FTS5)', icon: Search },
  { id: 'topic-dict', label: 'Integrated Dictionaries', icon: BookA },
  { id: 'topic-velthuis', label: 'Velthuis Pāḷi Typing', icon: Keyboard },
  { id: 'topic-mat', label: 'MAT Cross-Navigation', icon: Layers },
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
            Tipiṭaka Pāḷi Reader (CST Edition)
          </h3>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
          <strong>Tipitakapali.org</strong> provides a clean, modern, and high-performance study environment for reading the <strong>Chaṭṭha Saṅgāyana Tipiṭaka (CST)</strong> Pāḷi Canon along with its ancient commentaries, sub-commentaries, and extra-canonical treatises.
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
              <span>17+ Pāḷi Scripts</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Instant real-time transliteration into Roman, Myanmar, Sinhala, Devanagari, Thai, Khmer, Lao, Bengali, Telugu, Kannada, Cyrillic, and more.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Full-Text Search (FTS5) */}
      <section id="topic-search" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-[var(--accent)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">
            High-Performance Full-Text Search (FTS5)
          </h3>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Search instantaneously across all <strong>217 books</strong> and <strong>520,000+ canonical paragraphs</strong> powered by a dedicated SQLite FTS5 prefix engine.
        </p>

        {/* Search Controls Breakdown */}
        <div className="space-y-2.5 text-[11.5px]">
          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
            <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Filter size={14} className="text-[var(--accent)]" />
              <span>Literature Group & Piṭaka Filtering</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Narrow your search results to specific textual strata or collections:
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
              <span>Word Distance & Proximity Search (NEAR)</span>
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
                <strong>2, 3, 5, 8, 10 words:</strong> Matches terms occurring within $N$ words of each other using <code className="font-mono text-[var(--accent)]">NEAR()</code>.
              </li>
              <li className="p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                <strong>Prefix Wildcards:</strong> Fast prefix search (<code className="font-mono text-[var(--accent)]">dha*</code>, <code className="font-mono text-[var(--accent)]">buddha*</code>) using dedicated 3-char prefix index.
              </li>
            </ul>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1.5">
            <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Layers size={14} className="text-[var(--accent)]" />
              <span>Result Sorting Modes</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1 text-[11px]">
              <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                <strong className="text-[var(--accent)]">Piṭaka Order (Default)</strong>
                <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Hierarchical canonical order: Mūla → Aṭṭhakathā → Ṭīkā, Vinaya → Sutta → Abhidhamma.</div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                <strong>Relevant</strong>
                <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Ranked by term density and keyword match frequency.</div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)] border border-[var(--border-color)]">
                <strong>BM25</strong>
                <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Statistical BM25 probabilistic relevance scoring.</div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[var(--accent-light)] border border-[var(--accent-border)] text-[11.5px] text-[var(--text-primary)] flex items-start gap-2">
            <Sparkles size={15} className="text-[var(--accent)] shrink-0 mt-0.5" />
            <div>
              <strong>Footnotes & Variant Readings Included:</strong> The search index preserves all scholarly variant readings (e.g. <code className="font-mono text-[var(--accent)]">syā.</code>, <code className="font-mono text-[var(--accent)]">ka.</code>, <code className="font-mono text-[var(--accent)]">pī.</code>) and manuscript annotations.
            </div>
          </div>
        </div>
      </section>

      {/* 3. Integrated Dictionaries */}
      <section id="topic-dict" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
        <div className="flex items-center gap-2">
          <BookA size={16} className="text-[var(--accent)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">
            Integrated Pāḷi & Sanskrit Dictionaries
          </h3>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Click or tap any Pāḷi word while reading to immediately view rich grammatical definitions, root families, inflection tables, and compound breakdowns:
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
              <span>DPD Compound Splitter</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">Sandhi</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Automatically resolves and splits long Pāḷi compound words (Samāsa) and Sandhi euphonic junctions into individual lexical units.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
              <span>PTS Pāḷi-English Dictionary (2015)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">Classic</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              The authoritative Pāḷi Text Society dictionary edited by Rhys Davids & Stede, updated with the 2015 corrected reprint.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
              <span>Classical & Sanskrit Lexicons</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold">Comparative</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Abhidhānappadīpikā (Pāḷi-Pāḷi), Pāḷi-Sinhala, and Cologne Sanskrit lexicons (Monier-Williams, V.S. Apte, Edgerton Buddhist Hybrid Sanskrit).
            </p>
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[11.5px] space-y-1">
          <strong>Customizable Dictionary Layout:</strong> In Settings, choose between <em>Center Modal</em>, <em>Left Sidebar</em>, <em>Right Sidebar</em>, or <em>Embedded Drawer</em> according to your screen size and reading style.
        </div>
      </section>

      {/* 4. Velthuis Typing Scheme */}
      <section id="topic-velthuis" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
        <div className="flex items-center gap-2">
          <Keyboard size={16} className="text-[var(--accent)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">
            Velthuis Pāḷi Typing System
          </h3>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Type Pāḷi with standard Latin keyboards. The search bar, dictionary lookup, and TOC filters automatically convert input in real time:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px] mt-2">
          <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <div className="font-bold text-[var(--text-primary)] text-xs mb-1">Long Vowels & Niggahīta</div>
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
            <div className="font-bold text-[var(--text-primary)] text-xs mb-1">Retroflex & Nasals</div>
            <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
              <span className="text-[var(--text-secondary)]">.t, .d, .n, .l</span>
              <span className="font-bold text-[var(--accent)]">ṭ, ḍ, ṇ, ḷ</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-[var(--border-color)]/40 font-mono">
              <span className="text-[var(--text-secondary)]">~n or ,,n</span>
              <span className="font-bold text-[var(--accent)]">ñ</span>
            </div>
            <div className="flex justify-between py-0.5 font-mono">
              <span className="text-[var(--text-secondary)]">"n or n..</span>
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
      </section>

      {/* 5. MAT Relational Navigation */}
      <section id="topic-mat" className="scroll-mt-14 space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-[var(--accent)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">
            MAT (Mūla · Aṭṭhakathā · Ṭīkā) Cross-Navigation
          </h3>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Seamlessly navigate across commentary layers with one-click cross-referencing:
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
            <div className="text-[10.5px] text-[var(--text-muted)]">Expositions by Ācariya Buddhaghosa, Dhammapāla, and ancient Mahāvihāra elders.</div>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-purple-500/30 space-y-1">
            <span className="font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 text-[10px] uppercase tracking-wider inline-block">
              Ṭīkā
            </span>
            <div className="font-semibold text-[var(--text-primary)] mt-1">Sub-Commentaries</div>
            <div className="text-[10.5px] text-[var(--text-muted)]">Detailed philosophical and linguistic sub-commentaries clarifying the Aṭṭhakathā.</div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[12px] space-y-1.5">
          <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
            <ArrowRightLeft size={14} className="text-[var(--accent)]" />
            <span>How to Use the MAT Button</span>
          </div>
          <p className="text-[11.5px]">
            While reading any paragraph, click the <strong>MAT</strong> button in the bottom floating toolbar. The reader displays linked commentary and sub-commentary books and jumps straight to the corresponding paragraph.
          </p>
        </div>
      </section>

      {/* 6. Shortcuts, Page Editions & Gestures */}
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
              <span>Open Help & Guide</span>
              <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">? or F1</kbd>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
              <span>Close Overlays & Modals</span>
              <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Esc</kbd>
            </div>
          </div>
        </div>

        {/* Page Editions Guide */}
        <div className="bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] space-y-3">
          <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
            <Layers size={16} className="text-[var(--accent)]" />
            <span>Page Break Editions & Letter Abbreviations</span>
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
                <div className="text-[10px] text-[var(--text-muted)]">Extra-canonical & Special Editions</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Attributions, Credits, License & Contact */}
      <section id="topic-attributions" className="scroll-mt-14 space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] transition duration-300">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--accent)]" />
          <h3 className="font-bold text-sm text-[var(--text-primary)]">
            Attributions & Resource Credits
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
            <strong className="text-[var(--text-primary)]">2. Pāḷi Script Converter & Pāḷi-Sinhala Dictionary</strong>
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
            <strong className="text-[var(--text-primary)]">4. Pāḷi Text Society's Pāḷi-English Dictionary (PTS PED)</strong>
            <p className="text-[11px] text-[var(--text-muted)]">
              Digitized PTS dictionary data adapted from <a href="https://buddhadust.net" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Buddhadust</a>, based on the corrected 2015 reprint by K.R. Norman, William Pruitt, and Peter Jackson, published by <a href="https://palitextsociety.org" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">The Pāḷi Text Society <ExternalLink size={10} /></a> (CC BY-NC 3.0).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <strong className="text-[var(--text-primary)]">5. Sanskrit-English Dictionaries</strong>
            <p className="text-[11px] text-[var(--text-muted)]">
              Cologne Digital Sanskrit Dictionaries (<a href="https://www.sanskrit-lexicon.uni-koeln.de" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline inline-flex items-center gap-0.5">Cologne University <ExternalLink size={10} /></a>) by Thomas Malten & The Sanskrit Library (CC BY-NC-SA 3.0), including Monier-Williams (1899), V.S. Apte (1890), and Edgerton's Buddhist Hybrid Sanskrit Dictionary (1953).
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <strong className="text-[var(--text-primary)]">6. Tipiṭaka Pāḷi-Myanmar (Abhidhān) Data</strong>
            <p className="text-[11px] text-[var(--text-muted)]">
              Adapted from Tipiṭaka App & Tipiṭaka Abidan developed by Ven. Pn Daza.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-1">
            <strong className="text-[var(--text-primary)]">7. License & Usage Terms</strong>
            <p className="text-[11px] text-[var(--text-muted)]">
              This application is distributed under the <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Creative Commons Attribution-NonCommercial-ShareAlike 3.0 (CC BY-NC-SA 3.0)</a> and <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">CC BY-NC 4.0</a> licenses for non-commercial Dhamma dāna study.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
            <div>
              <strong className="text-[var(--text-primary)] flex items-center gap-1.5">
                <Mail size={14} className="text-[var(--accent)]" />
                <span>Feedback & Contact</span>
              </strong>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Email: <code className="font-mono text-[var(--accent)] select-all">tipitakapali.org@gmail.com</code> &middot; Web: <a href="https://tipitakapali.org" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">tipitakapali.org</a>
              </div>
            </div>
          </div>
        </div>

        {/* Closing Blessing */}
        <div className="text-center pt-2 border-t border-[var(--border-color)] text-[13px] font-bold text-[var(--accent)]">
          Ciraṃ tiṭṭhatu saddhammo, dhamme hontu sagāravā.
          <div className="text-[11px] font-normal text-[var(--text-muted)] mt-0.5 italic">
            "May the True Dhamma endure long, and may all beings revere the Dhamma."
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
