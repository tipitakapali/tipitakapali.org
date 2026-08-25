'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';

export const HELP_SECTIONS = [
  { id: 'all', label: 'All Topics', icon: HelpCircle },
  { id: 'search', label: 'Full-Text Search', icon: Search },
  { id: 'dict', label: 'Dictionaries', icon: BookA },
  { id: 'velthuis', label: 'Velthuis Typing', icon: Keyboard },
  { id: 'mat', label: 'MAT Navigation', icon: Layers },
  { id: 'features', label: 'Reader Features', icon: BookOpen },
  { id: 'shortcuts', label: 'Shortcuts & Editions', icon: Sliders },
  { id: 'attributions', label: 'Attributions & Credits', icon: ShieldCheck },
];

export default function HelpGuideContent({ defaultTab = 'all', showTabBar = true }) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <div className="space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed">
      {/* Sub-tab Filter Bar */}
      {showTabBar && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-[var(--border-color)] scrollbar-none sticky top-0 bg-[var(--bg-primary)] z-10">
          {HELP_SECTIONS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-xs font-semibold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 1. Introduction & Overview */}
      {(activeTab === 'all' || activeTab === 'features') && (
        <div className="space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
        </div>
      )}

      {/* 2. Full-Text Search (FTS5) */}
      {(activeTab === 'all' || activeTab === 'search') && (
        <div className="space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
                  <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Hierarchical canonical order: Mūla $\rightarrow$ Aṭṭhakathā $\rightarrow$ Ṭīkā, Vinaya $\rightarrow$ Sutta $\rightarrow$ Abhidhamma.</div>
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
        </div>
      )}

      {/* 3. Integrated Dictionaries */}
      {(activeTab === 'all' || activeTab === 'dict') && (
        <div className="space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
        </div>
      )}

      {/* 4. Velthuis Typing Scheme */}
      {(activeTab === 'all' || activeTab === 'velthuis') && (
        <div className="space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
              <strong>Examples:</strong> Type <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">nibbaana</code> $\rightarrow$ <strong>nibbāna</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">buddha.m</code> $\rightarrow$ <strong>buddhaṃ</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">sa,,naa</code> $\rightarrow$ <strong>saññā</strong>.
            </span>
          </div>
        </div>
      )}

      {/* 5. MAT Relational Navigation */}
      {(activeTab === 'all' || activeTab === 'mat') && (
        <div className="space-y-3 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
        </div>
      )}

      {/* 6. Shortcuts, Page Editions & Gestures */}
      {(activeTab === 'all' || activeTab === 'shortcuts') && (
        <div className="space-y-4">
          {/* Keyboard Shortcuts */}
          <div className="bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)] space-y-3">
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
        </div>
      )}

      {/* 7. Attributions, Credits, License & Contact */}
      {(activeTab === 'all' || activeTab === 'attributions') && (
        <div className="space-y-4 bg-[var(--bg-card)] p-4 sm:p-5 rounded-xl border border-[var(--border-color)]">
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
        </div>
      )}
    </div>
  );
}
