'use client';

import React from 'react';
import { HelpCircle, X, Keyboard, BookOpen, Search, Settings, ListTree, Globe } from 'lucide-react';

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
