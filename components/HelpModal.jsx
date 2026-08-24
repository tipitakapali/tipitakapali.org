'use client';

import React, { useState } from 'react';
import {
  HelpCircle,
  X,
  Keyboard,
  BookOpen,
  Search,
  Settings,
  ListTree,
  Globe,
  Layers,
  Sparkles,
  BookA,
  ArrowRightLeft,
  Navigation,
  CheckCircle2,
} from 'lucide-react';

const HELP_TABS = [
  { id: 'all', label: 'All Topics', icon: HelpCircle },
  { id: 'velthuis', label: 'Velthuis Typing', icon: Keyboard },
  { id: 'search', label: 'Full-Text Search', icon: Search },
  { id: 'mat', label: 'MAT Navigation', icon: Layers },
  { id: 'shortcuts', label: 'Shortcuts & Editions', icon: BookOpen },
];

export default function HelpModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('all');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in text-[var(--text-primary)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <HelpCircle size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm sm:text-base font-bold">Tipiṭaka Reader — Help & User Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selector Bar */}
        <div className="px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border-color)] flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
          {HELP_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-xs font-semibold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 text-xs text-[var(--text-secondary)] leading-relaxed">
          {/* 1. Velthuis Pāḷi Typing System */}
          {(activeTab === 'all' || activeTab === 'velthuis') && (
            <div className="space-y-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Keyboard size={16} className="text-[var(--accent)]" />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">
                  Velthuis Pāḷi Typing System
                </h3>
              </div>
              <p className="text-[12px] text-[var(--text-muted)]">
                You can easily type Pāḷi words with complete diacritics without installing any special keyboard. The system automatically converts standard ASCII combinations in real-time in the <strong>Search Bar</strong>, <strong>Pāḷi Dictionary</strong>, and <strong>TOC Filter</strong>:
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
                  <strong>Examples:</strong> Type <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">nibbaana</code> $\rightarrow$ <strong>nibbāna</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">dhammacakka</code> $\rightarrow$ <strong>dhammacakka</strong>, <code className="font-mono bg-[var(--bg-card)] px-1 rounded text-[var(--accent)]">sa.mgha</code> $\rightarrow$ <strong>saṃgha</strong>.
                </span>
              </div>
            </div>
          )}

          {/* 2. Full-Text Search (FTS5) */}
          {(activeTab === 'all' || activeTab === 'search') && (
            <div className="space-y-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-[var(--accent)]" />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">
                  Full-Text Search (FTS5)
                </h3>
              </div>
              <p className="text-[12px] text-[var(--text-muted)]">
                Instant full-text search across all <strong>217 books</strong> and <strong>520,000+ paragraphs</strong> powered by high-performance SQLite FTS5:
              </p>

              <ul className="space-y-2 text-[12px]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[var(--text-primary)]">Instant Access:</strong> Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[11px] font-bold text-[var(--accent)]">/</kbd> anywhere to immediately open the search dialog.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[var(--text-primary)]">Contextual Snippets:</strong> Search results highlight your keyword with match badges in authentic Tipiṭaka context.
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-[var(--text-primary)]">Direct Paragraph Jump:</strong> Clicking any search result automatically opens the book and scrolls directly to the exact paragraph with a pulsing border highlight.
                  </div>
                </li>
              </ul>
            </div>
          )}

          {/* 3. MAT (Mūla · Aṭṭhakathā · Ṭīkā) Relational Navigation */}
          {(activeTab === 'all' || activeTab === 'mat') && (
            <div className="space-y-3 bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-[var(--accent)]" />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">
                  MAT (Mūla · Aṭṭhakathā · Ṭīkā) Navigation
                </h3>
              </div>
              <p className="text-[12px] text-[var(--text-muted)]">
                The canonical Pāḷi literature is structured across 3 interconnected commentary layers:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11.5px]">
                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-emerald-500/30 space-y-1">
                  <span className="font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 text-[10px] uppercase tracking-wider inline-block">
                    Mūla (Root)
                  </span>
                  <div className="font-semibold text-[var(--text-primary)] mt-1">The Pāḷi Canon</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">The primary discourses, Vinaya rules, and Abhidhamma treatises.</div>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-amber-500/30 space-y-1">
                  <span className="font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-[10px] uppercase tracking-wider inline-block">
                    Aṭṭhakathā
                  </span>
                  <div className="font-semibold text-[var(--text-primary)] mt-1">Commentaries</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Classical commentaries by Ācariya Buddhaghosa, Dhammapāla, and ancient elders.</div>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-purple-500/30 space-y-1">
                  <span className="font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 text-[10px] uppercase tracking-wider inline-block">
                    Ṭīkā
                  </span>
                  <div className="font-semibold text-[var(--text-primary)] mt-1">Sub-commentaries</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">In-depth philosophical and grammatical sub-commentaries.</div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[12px] space-y-1.5">
                <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <ArrowRightLeft size={14} className="text-[var(--accent)]" />
                  <span>How to use the MAT Button</span>
                </div>
                <p className="text-[11.5px]">
                  While reading any paragraph, click the <strong>MAT</strong> button in the bottom footer bar. The reader will show the connected root text or commentaries and jump straight to the corresponding paragraph without losing your place.
                </p>
              </div>
            </div>
          )}

          {/* 4. Page Editions & Keyboard Shortcuts */}
          {(activeTab === 'all' || activeTab === 'shortcuts') && (
            <div className="space-y-4">
              {/* Keyboard Shortcuts */}
              <div className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] space-y-3">
                <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                  <Keyboard size={16} className="text-[var(--accent)]" />
                  <span>Keyboard Shortcuts</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px]">
                  <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">Search 217 Books</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">/</kbd>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">Toggle Navigation Sidebar</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Ctrl + B</kbd>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">Open Help & Guide</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">? or F1</kbd>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                    <span className="text-[var(--text-secondary)]">Close Overlays / Modals</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Esc</kbd>
                  </div>
                </div>
              </div>

              {/* Page Editions Guide */}
              <div className="bg-[var(--bg-card)] p-4 rounded-xl border border-[var(--border-color)] space-y-3">
                <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                  <Layers size={16} className="text-[var(--accent)]" />
                  <span>Page Break Editions & Letter Abbreviations</span>
                </h3>
                <p className="text-[11.5px] text-[var(--text-muted)]">
                  Page break markers e.g. <code className="font-mono text-[var(--accent)] bg-[var(--bg-secondary)] px-1 py-0.5 rounded">[M 1.0029]</code> or <code className="font-mono text-[var(--accent)] bg-[var(--bg-secondary)] px-1 py-0.5 rounded">[V 1.0031]</code> represent page boundaries in major historical printed editions:
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
                      <div className="text-[10px] text-[var(--text-muted)]">Chaṭṭha Saṅgāyana (Burmese)</div>
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
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[var(--text-muted)] hidden sm:inline">
            Press <kbd className="px-1.5 py-0.2 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[10px] text-[var(--accent)] font-bold">?</kbd> to open this guide anytime
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs hover:opacity-90 transition cursor-pointer ml-auto"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

