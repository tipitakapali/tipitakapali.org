'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check, Globe, Sparkles } from 'lucide-react';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { PALI_SCRIPTS_LIST } from '../services/transliterate';

const TRANSLATIONS = [
  { id: 'english', label: 'English Translation', flag: '🇬🇧', desc: 'Bhikkhu Bodhi & PTS editions' },
  { id: 'vietnamese', label: 'Bản dịch Tiếng Việt', flag: '🇻🇳', desc: 'HT. Thích Minh Châu' },
  { id: 'myanmar', label: 'Myanmar Translation', flag: '🇲🇲', desc: 'Pitaka translation committee' },
  { id: 'thai', label: 'Thai Translation', flag: '🇹🇭', desc: 'Mahachulalongkornrajavidyalaya' },
  { id: 'sinhala', label: 'Sinhala Translation', flag: '🇱🇰', desc: 'Buddha Jayanthi Tipitaka' },
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

  const activeTranslationCount = Object.values(settings.translations || {}).filter(Boolean).length;

  const handleToggleTranslation = (tId) => {
    const current = settings.translations || {};
    const updated = {
      ...current,
      [tId]: !current[tId],
    };
    updateSetting('translations', updated);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer ${
          isOpen ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]' : ''
        }`}
        title="Pali script and translation Language"
        aria-label="Pali script and translation Language"
      >
        <Languages size={14} className="text-[var(--accent)]" />
        <span className="hidden sm:inline">Language</span>
        {activeTranslationCount > 0 && (
          <span className="text-[8.5px] sm:text-[9px] px-1 rounded bg-[var(--accent)] text-white font-bold">
            {activeTranslationCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-72 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl z-[100] overflow-hidden text-[var(--text-primary)] animate-fade-in">
          {/* Header */}
          <div className="px-3.5 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--accent)]">
              <Globe size={14} />
              <span>Pali script and translation Language</span>
            </div>
          </div>

          <div className="p-3.5 space-y-4">
            {/* Section 1: Pali Script as a Select Dropdown */}
            <div>
              <label
                htmlFor="paliScriptSelect"
                className="block text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
              >
                Pali script (17 scripts)
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

            {/* Section 2: Multi-Translation Layers */}
            <div className="pt-3 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  AI translation
                </span>
                <span className="text-[10px] text-[var(--accent)] font-semibold flex items-center gap-1">
                  <Sparkles size={10} />
                  <span>Toggle on/off</span>
                </span>
              </div>

              <div className="space-y-1">
                {TRANSLATIONS.map((trans) => {
                  const isChecked = Boolean(settings.translations?.[trans.id]);
                  return (
                    <label
                      key={trans.id}
                      className="px-2.5 py-1.5 rounded-lg border border-transparent hover:bg-[var(--bg-secondary)] cursor-pointer flex items-center justify-between transition select-none"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{trans.flag}</span>
                        <div>
                          <div className="text-xs font-semibold">{trans.label}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{trans.desc}</div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleTranslation(trans.id)}
                        className="accent-[var(--accent)] w-3.5 h-3.5 rounded cursor-pointer"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

