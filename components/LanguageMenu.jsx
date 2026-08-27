'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Languages, ChevronDown, Check, Globe, Sparkles, ChevronUp, Rows3, Columns2 } from 'lucide-react';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { PALI_SCRIPTS_LIST } from '../services/transliterate';

const TRANSLATIONS = [
  { id: 'english', label: 'English', flag: '🇬🇧', desc: 'English Translation • -not available-' },
  { id: 'myanmar', label: 'မြန်မာ', flag: '🇲🇲', desc: 'Myanmar Translation • -not available-' },
  { id: 'vietnamese', label: 'Bản dịch Tiếng Việt', flag: '🇻🇳', desc: 'Vietnamese translation • -not available-' },
  { id: 'sinhala', label: 'සිංහල', flag: '🇱🇰', desc: 'Sinhala Translation • -not available-' },
  { id: 'thai', label: 'ไทย', flag: '🇹🇭', desc: 'Thai Translation • -not available-' },
  { id: 'german', label: 'Deutsch', flag: '🇩🇪', desc: 'German Translation • -not available-' },
  { id: 'japanese', label: '日本語', flag: '🇯🇵', desc: 'Japanese Translation • -not available-' },
  { id: 'khmer', label: 'ភាសាខ្មែរ', flag: '🇰🇭', desc: 'Khmer Translation • -not available-' },
  { id: 'korean', label: '한국어', flag: '🇰🇷', desc: 'Korean Translation • -not available-' },
  { id: 'russian', label: 'Русский', flag: '🇷🇺', desc: 'Russian Translation • -not available-' },
];

export default function LanguageMenu() {
  const { settings, updateSetting } = useThemeSettings();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const translationOrder = useMemo(() => {
    const order = settings.translationOrder;
    if (Array.isArray(order) && order.length > 0) {
      // Merge with TRANSLATIONS to handle added/removed ids gracefully
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
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer ${
          isOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
        }`}
	  title="Pāḷi script and translation Language"
	  aria-label="Pāḷi  script and translation Language"
      >
        <Languages size={14} className="text-[var(--accent)]" />
        <span className="hidden sm:inline">Language</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-80 sm:w-[340px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[100] overflow-hidden text-[var(--text-primary)] animate-fade-in flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="px-3.5 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--accent)]">
              <Globe size={14} />
	      <span>Pāḷi script and translation Language</span>
            </div>
          </div>

          <div className="p-3.5 space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Section 1: Pali Script as a Select Dropdown */}
            <div>
              <label
                htmlFor="paliScriptSelect"
                className="block text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
              >
	      Pāḷi script (17 scripts)
              </label>
              <select
                id="paliScriptSelect"
                value={settings.paliScript || 'roman'}
                onChange={(e) => {
                  updateSetting('paliScript', e.target.value);
                  setIsOpen(false);
                }}
                className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg p-2 text-xs font-semibold outline-none cursor-pointer focus:border-[var(--accent)] transition"
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
              <span className="block text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Translation display
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDisplayModeChange('stack')}
                  aria-label="Translation below Pāḷi (vertical)"
                  title="Translation below Pāḷi (vertical)"
                  className={`p-2.5 rounded-lg border text-left transition flex items-center justify-center cursor-pointer ${
                    translationDisplayMode === 'stack'
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                      : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Rows3 size={14} />
                    Stack
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDisplayModeChange('side')}
                  aria-label="Pāḷi | Translation (horizontal)"
                  title="Pāḷi | Translation (horizontal)"
                  className={`p-2.5 rounded-lg border text-left transition flex items-center justify-center cursor-pointer ${
                    translationDisplayMode === 'side'
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                      : 'bg-[var(--bg-card)] border-[var(--border-color)] hover:border-gray-400 text-[var(--text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Columns2 size={14} />
                    Side by side
                  </span>
                </button>
              </div>
            </div>

            {/* Section 3: Multi-Translation Layers (movable order) */}
            <div className="pt-3 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Translation
                </span>
                <span className="text-[10px] text-[var(--accent)] font-semibold flex items-center gap-1">
                  <Sparkles size={10} />
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
                      className={`px-2 py-1.5 rounded-lg border flex items-center justify-between gap-2 transition select-none ${
                        isChecked
                          ? 'bg-[var(--bg-card)] border-[var(--border-color)]'
                          : 'bg-[var(--bg-secondary)]/40 border-[var(--border-color)]/50 opacity-80'
                      }`}
                    >
                      <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                        <span className="text-sm shrink-0">{trans.flag}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{trans.label}</div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">{trans.desc}</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTranslation(trans.id)}
                          className="accent-[var(--accent)] w-3.5 h-3.5 rounded cursor-pointer shrink-0"
                        />
                      </label>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveTranslation(trans.id, 'up')}
                          disabled={isFirst}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                          title="Move up"
                          aria-label="Move translation up"
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveTranslation(trans.id, 'down')}
                          disabled={isLast}
                          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
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
              <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                Use ▲ ▼ to change order — order controls display priority when multiple translations are enabled.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

