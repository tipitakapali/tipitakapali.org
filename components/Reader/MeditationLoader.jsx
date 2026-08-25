'use client';

import React from 'react';
import { BookOpen, Sparkles } from 'lucide-react';
import { convertPaliScript, capitalizePali } from '../../services/transliterate';

export default function MeditationLoader({ bookTitle, chapterIdx, paraNum, paliScript = 'roman' }) {
  const displayTitle = bookTitle ? convertPaliScript(capitalizePali(bookTitle), paliScript) : 'Tipiṭaka Pāḷi';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-[var(--bg-primary)] animate-fade-in min-h-[50vh]">
      {/* Concentric Breathing Meditation Pulse Animation */}
      <div className="relative flex items-center justify-center mb-6">
        <div className="absolute w-24 h-24 rounded-full bg-[var(--accent)]/10 animate-ping duration-1000" />
        <div className="absolute w-20 h-20 rounded-full bg-[var(--accent)]/15 animate-pulse" />
        <div className="relative w-14 h-14 rounded-full bg-[var(--accent-light)] border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)] shadow-md">
          <BookOpen size={24} className="animate-bounce duration-700" />
        </div>
      </div>

      {/* Book Title & Target Section */}
      <h2 className="text-base sm:text-lg font-bold text-[var(--text-primary)] max-w-md truncate px-2 mb-1">
        {displayTitle}
      </h2>

      {/* Target badge */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-4">
        {chapterIdx !== undefined && (
          <span className="px-2 py-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)] font-medium">
            Section {chapterIdx + 1}
          </span>
        )}
        {paraNum && (
          <span className="px-2 py-0.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] font-mono font-bold">
            Para {paraNum}
          </span>
        )}
      </div>

      {/* Contemplation Breathing Quote */}
      <div className="max-w-md px-4 py-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)]/60 text-xs text-[var(--text-secondary)] shadow-2xs space-y-1">
        <div className="font-serif italic text-[12.5px] text-[var(--accent)] flex items-center justify-center gap-1.5 leading-relaxed">
          <Sparkles size={13} className="shrink-0" />
          <span>{convertPaliScript('Ekāyano ayaṃ, bhikkhave, maggo ... yadidaṃ cattāro satipaṭṭhānā.', paliScript)}</span>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          "This is the one-way path, monks... namely, the four foundations of mindfulness."
        </p>
      </div>
    </div>
  );
}
