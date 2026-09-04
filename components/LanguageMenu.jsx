'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Languages,
  X,
  Globe,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  Rows3,
  Columns2,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { PALI_SCRIPTS_LIST } from '../services/transliterate';

export const TRANSLATIONS = [
  { id: 'pali', label: 'Pāḷi (Root Canon)', flag: '☸️', desc: 'Chaṭṭha Saṅgāyana Tipiṭaka • CST Edition', color: '#8b2500' },
  { id: 'english', label: 'English', flag: '🇬🇧', desc: 'English Translation • 1.28M sentences', color: '#2563eb' },
  { id: 'vietnamese', label: 'Tiếng Việt', flag: '🇻🇳', desc: 'Bản dịch Tiếng Việt • 1.28M câu', color: '#dc2626' },
  { id: 'myanmar', label: 'မြန်မာ', flag: '🇲🇲', desc: 'မြန်မာဘာသာပြန် • 1.28M စာကြောင်း', color: '#059669' },
  { id: 'sinhala', label: 'සිංහල', flag: '🇱🇰', desc: 'සිංහල පරිවර්තනය • 1.21M වාක්‍ය', color: '#d97706' },
  { id: 'chinese', label: '中文', flag: '🇨🇳', desc: '中文翻译 • 1.27M 句', color: '#e11d48' },
  { id: 'khmer', label: 'ភាសាខ្មែរ', flag: '🇰🇭', desc: 'ការបកប្រែជាភាសាខ្មែរ • 912K ប្រយោគ', color: '#0891b2' },
  { id: 'thai', label: 'ไทย', flag: '🇹🇭', desc: 'ฉบับแปลภาษาไทย • 1.27M ประโยค', color: '#7c3aed' },
  { id: 'lao', label: 'ລາວ', flag: '🇱🇦', desc: 'ການແປພາສາລາວ • 420K ປະໂຫຍກ', color: '#ea580c' },
  { id: 'tamil', label: 'தமிழ்', flag: '🇮🇳', desc: 'தமிழ் மொழிபெயர்ப்பு • 1.22M வாக்கியங்கள்', color: '#c2410c' },
  { id: 'hindi', label: 'हिन्दी', flag: '🇮🇳', desc: 'हिन्दी अनुवाद • 410K वाक्य', color: '#ca8a04' },
  { id: 'german', label: 'Deutsch', flag: '🇩🇪', desc: 'Deutsche Übersetzung • 1.28M Sätze', color: '#475569' },
  { id: 'japanese', label: '日本語', flag: '🇯🇵', desc: '日本語訳 • 1.25M 文', color: '#db2777' },
  { id: 'portuguese', label: 'Português', flag: '🇵🇹', desc: 'Tradução em Português • 1.22M frases', color: '#16a34a' },
  { id: 'russian', label: 'Русский', flag: '🇷🇺', desc: 'Русский перевод • 248K предложений', color: '#0284c7' },
  { id: 'my_nissaya', label: 'မြန်မာ နိဿယ', flag: '🇲🇲', desc: 'Myanmar Nissaya • 570K စာကြောင်း', color: '#0d9488' },
  { id: 'korean', label: '한국어', flag: '🇰🇷', desc: 'Korean Translation • -coming soon-', color: '#4f46e5' },
];

export default function LanguageMenu() {
  const { settings, updateSetting } = useThemeSettings();
  const [isOpen, setIsOpen] = useState(false);

  // AI translation disclaimer popup state
  const [disclaimerModalOpen, setDisclaimerModalOpen] = useState(false);
  const [pendingLangId, setPendingLangId] = useState(null);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (disclaimerModalOpen) {
          setDisclaimerModalOpen(false);
          setPendingLangId(null);
        } else if (isOpen) {
          setIsOpen(false);
        }
      }
    };
    if (isOpen || disclaimerModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, disclaimerModalOpen]);

  const activeCount = useMemo(() => {
    const current = settings.translations || {};
    return TRANSLATIONS.filter((t) => (t.id === 'pali' ? current.pali !== false : Boolean(current[t.id]))).length;
  }, [settings.translations]);

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

  const applyToggleTranslation = (tId) => {
    const current = settings.translations || {};
    const isPali = tId === 'pali';
    const isCurrentlyChecked = isPali ? current.pali !== false : Boolean(current[tId]);
    const updated = {
      ...current,
      [tId]: !isCurrentlyChecked,
    };
    updateSetting('translations', updated);
  };

  const handleToggleTranslation = (tId) => {
    const current = settings.translations || {};
    const isPali = tId === 'pali';
    const isCurrentlyChecked = isPali ? current.pali !== false : Boolean(current[tId]);
    const willBeChecked = !isCurrentlyChecked;

    if (!willBeChecked) {
      // Prevent disabling if this is the only active language
      if (activeCount <= 1) {
        return;
      }
      applyToggleTranslation(tId);
      return;
    }

    // If enabling a translation (not Pali):
    if (!isPali) {
      const alreadyAccepted =
        typeof window !== 'undefined' &&
        localStorage.getItem('tipitaka_ai_trans_disclaimer_accepted');
      if (!alreadyAccepted) {
        setPendingLangId(tId);
        setDisclaimerModalOpen(true);
        return;
      }
    }

    applyToggleTranslation(tId);
  };

  const handleConfirmDisclaimer = () => {
    if (dontShowAgain && typeof window !== 'undefined') {
      localStorage.setItem('tipitaka_ai_trans_disclaimer_accepted', 'true');
    }
    if (pendingLangId) {
      applyToggleTranslation(pendingLangId);
      setPendingLangId(null);
    }
    setDisclaimerModalOpen(false);
  };

  const handleCancelDisclaimer = () => {
    setPendingLangId(null);
    setDisclaimerModalOpen(false);
  };

  const handleMoveTranslation = (dictId, direction) => {
    const idx = translationOrder.indexOf(dictId);
    if (idx === -1) return;
    const next = [...translationOrder];
    if (direction === 'top' && idx > 0) {
      const [item] = next.splice(idx, 1);
      next.unshift(item);
    } else if (direction === 'up' && idx > 0) {
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
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="paliScriptSelect"
                    className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    Pāḷi Script ({PALI_SCRIPTS_LIST.length} scripts)
                  </label>
                  <a
                    href="/pali-script-converter.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--accent)] font-semibold hover:underline inline-flex items-center gap-1"
                    title="Open standalone script converter"
                  >
                    <span>Script Converter</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
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

              {/* Section 3: Multi-Translation Layers (including Pāḷi) */}
              <div className="pt-3 border-t border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Languages & Display Order
                  </span>
                  <span className="text-[10px] text-[var(--accent)] font-semibold flex items-center gap-1">
                    <Sparkles size={11} />
                    <span>Toggle on/off</span>
                  </span>
                </div>

                <div className="space-y-1.5">
                  {orderedTranslations.map((trans, idx) => {
                    const isChecked =
                      trans.id === 'pali'
                        ? settings.translations?.pali !== false
                        : Boolean(settings.translations?.[trans.id]);
                    const isFirst = idx === 0;
                    const isLast = idx === orderedTranslations.length - 1;
                    const isOnlyActive = isChecked && activeCount <= 1;
                    return (
                      <div
                        key={trans.id}
                        className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2.5 transition select-none ${
                          isChecked
                            ? 'bg-[var(--bg-card)] border-[var(--border-color)] shadow-xs'
                            : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)]/60 opacity-75'
                        }`}
                      >
                        {/* Language color indicator bar matching Task 5 border */}
                        <span
                          className="w-1 self-stretch rounded-full shrink-0"
                          style={{ backgroundColor: trans.color }}
                          title={`Color code: ${trans.label}`}
                        />

                        <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                          <span className="text-base shrink-0">{trans.flag}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate text-[var(--text-primary)]">
                              {trans.label}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{trans.desc}</div>
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isOnlyActive}
                            onChange={() => handleToggleTranslation(trans.id)}
                            className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                            title={isOnlyActive ? 'At least one language layer must remain active' : undefined}
                          />
                        </label>
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Task 1: Move to Top Button */}
                          <button
                            type="button"
                            onClick={() => handleMoveTranslation(trans.id, 'top')}
                            disabled={isFirst}
                            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                            title="Move to top"
                            aria-label="Move translation to top"
                          >
                            <ChevronsUp size={13} />
                          </button>
                          {/* Move Up */}
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
                          {/* Move Down */}
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
                  Use ⤒ ▲ ▼ to reorder layers. Pāḷi text can be moved or disabled if you wish to read translations only.
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

      {/* Task 3: AI-Assisted Translation Disclaimer Popup */}
      {disclaimerModalOpen && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-fade-in text-[var(--text-primary)]"
          onClick={handleCancelDisclaimer}
        >
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-bold text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle size={17} />
                <span>AI-Assisted Translation Notice</span>
              </div>
              <button
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
                onClick={handleCancelDisclaimer}
                title="Close (Esc)"
                aria-label="Close disclaimer modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p>
                The translations provided here are part of an{' '}
                <strong className="text-[var(--text-primary)]">AI-Assisted Translation Project</strong> adapted from{' '}
                <a
                  href="https://epitaka.org/about"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] underline font-semibold inline-flex items-center gap-0.5"
                >
                  Epitaka <ExternalLink size={10} />
                </a>.
              </p>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5 text-[11.5px] text-[var(--text-primary)]">
                <div className="font-bold flex items-center gap-1.5 text-amber-600">
                  <span>Please Read with Discernment & Wisdom</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[var(--text-secondary)]">
                  <li>
                    These translations are generated using artificial intelligence and <strong>may contain inaccuracies or mistakes</strong>.
                  </li>
                  <li>
                    They are <strong>not authoritative</strong> and should be treated as study aids rather than definitive renderings.
                  </li>
                  <li>
                    Please <strong>check against the original Pāḷi canonical text</strong> and consult venerable teacher commentaries when clarifying doctrinal nuance.
                  </li>
                </ul>
              </div>

              <label className="flex items-center gap-2 pt-1 text-[11.5px] text-[var(--text-muted)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="accent-[var(--accent)] w-3.5 h-3.5 rounded cursor-pointer"
                />
                <span>Do not show this notice again</span>
              </label>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCancelDisclaimer}
                className="px-3.5 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisclaimer}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-xs font-bold rounded-lg shadow-sm hover:opacity-90 transition cursor-pointer"
              >
                I Understand & Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
