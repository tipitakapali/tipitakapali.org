'use client';

import React, { useState, useRef, useEffect } from 'react';
import { BookA, X, Search, Sparkles, ExternalLink, HelpCircle, Keyboard } from 'lucide-react';
import { typeVelthuis } from '../services/transliterate';

export default function DictionaryModal({ isOpen, onClose }) {
  const [word, setWord] = useState('');
  const [showVelthuisHelp, setShowVelthuisHelp] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in text-[var(--text-primary)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BookA size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm font-bold">Pāḷi Dictionary Look-up</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search input & Velthuis typing support info */}
        <div className="p-4 border-b border-[var(--border-color)] space-y-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type Pali word (e.g. nibbaana, dhamma, anatta)..."
              value={word}
              onChange={(e) => setWord(typeVelthuis(e.target.value))}
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 pl-9 pr-3 text-xs outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] px-0.5">
            <div className="flex items-center gap-1.5">
              <Keyboard size={13} className="text-[var(--accent)]" />
              <span>Velthuis typing is supported</span>
            </div>
            <button
              onClick={() => setShowVelthuisHelp((prev) => !prev)}
              className="flex items-center gap-1 text-[var(--accent)] hover:underline font-semibold cursor-pointer"
              title="How to type Velthuis diacritics"
            >
              <HelpCircle size={13} />
              <span>{showVelthuisHelp ? 'Hide guide' : 'Typing guide'}</span>
            </button>
          </div>

          {/* Velthuis Scheme Guide Table */}
          {showVelthuisHelp && (
            <div className="p-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-[11px] space-y-2 animate-fade-in">
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>Velthuis Pāḷi Typing Shortcuts</span>
                <span className="text-[10px] font-normal text-[var(--text-muted)]">Type as you speak</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px]">
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">aa, ii, uu</span>
                  <span className="font-bold text-[var(--accent)]">ā, ī, ū</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.m, m..</span>
                  <span className="font-bold text-[var(--accent)]">ṃ, ṁ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.t, .d</span>
                  <span className="font-bold text-[var(--accent)]">ṭ, ḍ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.n, .l</span>
                  <span className="font-bold text-[var(--accent)]">ṇ, ḷ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">~n, ,,n</span>
                  <span className="font-bold text-[var(--accent)]">ñ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">"n, n..</span>
                  <span className="font-bold text-[var(--accent)]">ṅ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.h, .r</span>
                  <span className="font-bold text-[var(--accent)]">ḥ, ṛ</span>
                </div>
                <div className="flex justify-between border-b border-[var(--border-color)]/50 py-0.5">
                  <span className="text-[var(--text-muted)]">.s, "s</span>
                  <span className="font-bold text-[var(--accent)]">ṣ, ś</span>
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] italic">
                * Uppercase is also supported (e.g. AA → Ā, .N → Ṇ).
              </div>
            </div>
          )}
        </div>

        {/* Dictionary Preview & Resources */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
            <div className="flex items-center gap-1.5 font-bold text-[var(--accent)] mb-1">
              <Sparkles size={13} />
              <span>Integrated Pali Dictionaries</span>
            </div>
            <p className="text-[var(--text-secondary)] leading-relaxed text-[11.5px]">
              Type any Pali term above or double-click any word in the text to lookup definitions across PTS Pali-English Dictionary, Digital Pāḷi Dictionary (DPD), and Concise Pali-English Dictionary.
            </p>
          </div>

          {word.trim().length > 0 && (
            <div className="space-y-2">
              <div className="font-bold text-[var(--text-primary)]">
                External Dictionary Lookups for "{word.trim()}":
              </div>
              <div className="space-y-1.5">
                <a
                  href={`https://suttacentral.net/define/${encodeURIComponent(word.trim())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-lg border border-[var(--border-color)] hover:border-[var(--accent)] bg-[var(--bg-card)] flex items-center justify-between transition group"
                >
                  <span className="font-semibold">SuttaCentral DPD Dictionary</span>
                  <ExternalLink size={13} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                </a>
                <a
                  href={`https://dsal.uchicago.edu/cgi-bin/app/pali_query.py?qs=${encodeURIComponent(word.trim())}&searchhws=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 rounded-lg border border-[var(--border-color)] hover:border-[var(--accent)] bg-[var(--bg-card)] flex items-center justify-between transition group"
                >
                  <span className="font-semibold">PTS Pali-English Dictionary</span>
                  <ExternalLink size={13} className="text-[var(--text-muted)] group-hover:text-[var(--accent)]" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
