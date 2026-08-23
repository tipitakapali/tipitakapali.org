'use client';

import React from 'react';
import { HelpCircle, X, Keyboard, BookOpen, Search, Settings, ListTree, Globe, Layers } from 'lucide-react';

export default function HelpModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in text-[var(--text-primary)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HelpCircle size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm font-bold">Tipiṭaka Reader — Help & Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Keyboard Shortcuts */}
          <div>
            <h3 className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Keyboard size={14} />
              <span>Keyboard Shortcuts</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Search 217 Books</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">/</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Toggle Navigation Tree</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Ctrl + B</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Close Modals / Popups</span>
                <kbd className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono font-bold text-[11px] text-[var(--accent)]">Esc</kbd>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Zen Mode (Hide UI)</span>
                <span className="text-[11px] text-[var(--text-muted)]">Click Breadcrumbs or Hide</span>
              </div>
            </div>
          </div>

          {/* Page Editions Guide */}
          <div>
            <h3 className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers size={14} />
              <span>Page Numbering & Edition Abbreviations</span>
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mb-2">
              Letter codes in page breaks e.g. <code className="font-mono text-[var(--accent)] bg-[var(--bg-secondary)] px-1 py-0.5 rounded">[V 1.0023]</code>:
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">V</span>
                <div>
                  <strong className="text-[var(--text-primary)]">VRI</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Vipassana Research Institute</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">M</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Myanmar</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Chaṭṭha Saṅgāyana (Burmese)</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">P</span>
                <div>
                  <strong className="text-[var(--text-primary)]">PTS</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Pali Text Society (London)</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2">
                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">T</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Thai</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Royal Thai Edition</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] flex items-center gap-2 col-span-2">
                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">O</span>
                <div>
                  <strong className="text-[var(--text-primary)]">Other</strong>
                  <div className="text-[10px] text-[var(--text-muted)]">Other Extra-canonical & Special Editions</div>
                </div>
              </div>
            </div>
          </div>

          {/* Key Features */}
          <div>
            <h3 className="text-xs font-bold text-[var(--accent)] uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <BookOpen size={14} />
              <span>Features & Navigation</span>
            </h3>
            <ul className="space-y-2 text-[var(--text-secondary)] leading-relaxed">
              <li className="flex items-start gap-2">
                <ListTree size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--text-primary)]">Book TOC</strong>: Click the Book TOC button in the bottom footer to see the full hierarchy of chapters, suttas, and subheads with live reading position tracking.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Globe size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--text-primary)]">Language & Pali Scripts</strong>: Toggle between Roman Latin, Devanagari, Myanmar, Sinhala, Thai, and Khmer scripts via the header menu.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Search size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--text-primary)]">Full-Text Search</strong>: Fast FTS5 search across all 520,000+ Pali paragraphs with diacritic matching and keyword highlighting.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Settings size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[var(--text-primary)]">Advanced Settings</strong>: Customize Gentium/Garamond typography, 4 color themes, page-break markers, and footnote toggles.
                </div>
              </li>
            </ul>
          </div>
        </div>


        {/* Footer */}
        <div className="px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs hover:opacity-90 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
