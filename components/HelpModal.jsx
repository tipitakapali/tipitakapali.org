'use client';

import React from 'react';
import { HelpCircle, X } from 'lucide-react';
import HelpGuideContent from './Help/HelpGuideContent';

export default function HelpModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in text-[var(--text-primary)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <HelpCircle size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm sm:text-base font-bold">TipitakaPali.org — Help & User Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="overflow-y-auto flex-1 flex flex-col">
          <HelpGuideContent defaultTab="all" showTabBar={true} />
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[var(--text-muted)] hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[10px] text-[var(--accent)] font-bold">?</kbd> to open this guide anytime
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs hover:opacity-90 transition cursor-pointer ml-auto"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
}
