'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Languages, X, Globe, Sparkles, ChevronUp, ChevronDown, Rows3, Columns2 } from 'lucide-react';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { PALI_SCRIPTS_LIST } from '../services/transliterate';

const TRANSLATIONS = [
  // Pinned to top (user's preferred priority)
  { id: 'english', label: 'English', flag: '🇬🇧', desc: 'English Translation • -coming soon-' },
  { id: 'vietnamese', label: 'Tiếng Việt', flag: '🇻🇳', desc: 'Vietnamese translation • -coming soon-' },
  { id: 'myanmar', label: 'မြန်မာ', flag: '🇲🇲', desc: 'Myanmar Translation • -coming soon-' },
  { id: 'sinhala', label: 'සිංහල', flag: '🇱🇰', desc: 'Sinhala Translation • -coming soon-' },
  { id: 'chinese', label: '中文', flag: '🇨🇳', desc: 'Chinese Translation • -coming soon-' },
  { id: 'khmer', label: 'ភាសាខ្មែរ', flag: '🇰🇭', desc: 'Khmer Translation • -coming soon-' },
  { id: 'thai', label: 'ไทย', flag: '🇹🇭', desc: 'Thai Translation • -coming soon-' },
  { id: 'lao', label: 'ລາວ', flag: '🇱🇦', desc: 'Lao Translation • -coming soon-' },
  { id: 'tamil', label: 'தமிழ்', flag: '🇮🇳', desc: 'Tamil Translation • -coming soon-' },
  // Alphabetical by language name
  { id: 'german', label: 'Deutsch', flag: '🇩🇪', desc: 'German Translation • -coming soon-' },
  { id: 'japanese', label: '日本語', flag: '🇯🇵', desc: 'Japanese Translation • -coming soon-' },
  { id: 'korean', label: '한국어', flag: '🇰🇷', desc: 'Korean Translation • -coming soon-' },
  { id: 'portuguese', label: 'Português', flag: '🇵🇹', desc: 'Portuguese Translation • -coming soon-' },
  { id: 'russian', label: 'Русский', flag: '🇷🇺', desc: 'Russian Translation • -coming soon-' },
];

export default function LanguageMenu() {
  const { settings, updateSetting } = useThemeSettings();
  const [isOpen, setIsOpen] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const translationOrder = useMemo(() => {
    const order = settings.translationOrder;
    if (Array.isArray(order) && order.length > 0) {
      const knownIds = TRANSLATIONS.map((t) => t.id);
      const filtered = order.filter((id) => knownIds.includes(id));
      for (const id of knownIds) if (!filtered.includes(id)) filtered.push(id);
      return filtered;
    }
    return TRANSLATIONS.map((t) => t.id);
  }, [settings.translationOrder]);

  const orderedTranslations = useMemo(() => {
    const map = new Map(TRANSLATIONS.map((t) => [t.id, t]));
    return translationOrder.map((id) => map.get(id)).filter(Boolean);
  }, [translationOrder]);

  const translationDisplayMode = settings.translationDisplayMode || 'stack';

  const handleToggleTranslation = (tId) => {
    const current = settings.translations || {};
    const updated = {
      ...current,
      [tId]: !current[tId],
    };
    updateSetting('translations', updated);
  };

  const handleMoveTranslation = (dictId, direction) => {
    const idx = translationOrder.indexOf(dictId);
    if (idx === -1) return;
    const next = [...translationOrder];
    if (direction === 'up' && idx > 0) {
      const tmp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = tmp;
    } else if (direction === 'down' && idx < next.length - 1) {
      const tmp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = tmp;
    } else {
      return;
    }
    updateSetting('translationOrder', next);
  };

  const handleDisplayModeChange = (mode) => {
    if (!['stack', 'side'].includes(mode)) return;
    updateSetting('translationDisplayMode', mode);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer ${
          isOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
        }`}
        title="Pāḷi script and translation Language"
        aria-label="Pāḷi script and translation Language"
      >
        <Languages size={14} className="text-[var(--accent)]" />
        <span className="hidden sm:inline">Language</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4 animate-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh] text-[var(--text-primary)] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-sm sm:text-base text-[var(--accent)]">
                <Globe size={18} />
                <span>Pāḷi Script & Translation Language</span>
              </div>
              <button
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
                onClick={() => setIsOpen(false)}
                title="Close (Esc)"
                aria-label="Close language modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {/* Section 1: Pali Script Selection */}
              <div>
                <label
                  htmlFor="paliScriptSelect"
                  className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
                >
                  Pāḷi Script ({PALI_SCRIPTS_LIST.length} scripts)
                </label>
                <select
                  id="paliScriptSelect"
                  value={settings.paliScript || 'roman'}
                  onChange={(e) => {
                    updateSetting('paliScript', e.target.value);
                  }}
                  className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-xl p-2.5 text-xs font-semibold outline-none cursor-pointer focus:border-[var(--accent)] transition shadow-sm"
                >
                  {PALI_SCRIPTS_LIST.map((script) => (
                    <option key={script.id} value={script.id}>
                      {script.native} — {script.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Section 2: Translation Display Mode */}
              <div className="pt-3 border-t border-[var(--border-color)]">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Translation Display Mode
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleDisplayModeChange('stack')}
                    aria-label="Translation below Pāḷi (vertical)"
                    title="Translation below Pāḷi (vertical)"
                    className={`p-2.5 rounded-xl border text-left transition flex items-center justify-center cursor-pointer ${
                      translationDisplayMode === 'stack'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <Rows3 size={15} />
                      Stack (Vertical)
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisplayModeChange('side')}
                    aria-label="Pāḷi | Translation (horizontal)"
                    title="Pāḷi | Translation (horizontal)"
                    className={`p-2.5 rounded-xl border text-left transition flex items-center justify-center cursor-pointer ${
                      translationDisplayMode === 'side'
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                        : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      <Columns2 size={15} />
                      Side by Side
                    </span>
                  </button>
                </div>
              </div>

              {/* Section 3: Multi-Translation Layers */}
              <div className="pt-3 border-t border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Translation Languages
                  </span>
                  <span className="text-[10px] text-[var(--accent)] font-semibold flex items-center gap-1">
                    <Sparkles size={11} />
                    <span>Toggle on/off</span>
                  </span>
                </div>

                <div className="space-y-1.5">
                  {orderedTranslations.map((trans, idx) => {
                    const isChecked = Boolean(settings.translations?.[trans.id]);
                    const isFirst = idx === 0;
                    const isLast = idx === orderedTranslations.length - 1;
                    return (
                      <div
                        key={trans.id}
                        className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2.5 transition select-none ${
                          isChecked
                            ? 'bg-[var(--bg-card)] border-[var(--border-color)] shadow-xs'
                            : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)]/60 opacity-75'
                        }`}
                      >
                        <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                          <span className="text-base shrink-0">{trans.flag}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate text-[var(--text-primary)]">{trans.label}</div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{trans.desc}</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleTranslation(trans.id)}
                            className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer shrink-0"
                          />
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveTranslation(trans.id, 'up')}
                            disabled={isFirst}
                            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                            title="Move up"
                            aria-label="Move translation up"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveTranslation(trans.id, 'down')}
                            disabled={isLast}
                            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                            title="Move down"
                            aria-label="Move translation down"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10.5px] text-[var(--text-muted)] mt-2">
                  Use ▲ ▼ to change order — controls display priority when multiple translations are active.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-xs font-bold rounded-lg shadow-sm hover:opacity-90 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


