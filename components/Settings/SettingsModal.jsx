'use client';

import React, { useState } from 'react';
import {
  X,
  Type,
  Palette,
  Eye,
  Layout,
  RotateCcw,
  Download,
  Upload,
  Check,
  Sparkles,
  Sliders,
  AlignJustify,
  AlignLeft,
  HelpCircle,
  Keyboard,
  BookOpen,
  Search,
  Layers,
  BookA,
  PanelLeft,
  PanelRight,
  Maximize2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { useDictionary, AVAILABLE_DICTIONARIES } from '../../context/DictionaryContext';
import HelpGuideContent from '../Help/HelpGuideContent';

const TABS = [
  { id: 'backup', label: 'Backup & Reset', icon: RotateCcw },
  { id: 'dictionary', label: 'Dictionary', icon: BookA },
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'layout', label: 'Layout & Tree', icon: Layout },
  { id: 'themes', label: 'Themes & Colors', icon: Palette },
  { id: 'display', label: 'Display Options', icon: Eye },
  { id: 'help', label: 'Help & Guide', icon: HelpCircle },
];

const FONTS = [
  { id: 'gentium', label: 'Gentium Plus', family: '"Gentium Plus", serif', desc: 'Standard Tipitaka Roman font with complete diacritics' },
  { id: 'garamond', label: 'EB Garamond', family: '"EB Garamond", serif', desc: 'Elegant classical serif with rich typography' },
  { id: 'serif', label: 'Georgia / System Serif', family: 'Georgia, serif', desc: 'Clean, legible serif on all operating systems' },
  { id: 'system', label: 'System Sans-Serif', family: '-apple-system, BlinkMacSystemFont, sans-serif', desc: 'Modern crisp sans-serif typeface' },
];

const THEMES = [
  { id: 'light', label: 'Light (Classic)', bg: '#fdfdfc', fg: '#1f2328', border: '#e2e0d5', accent: '#8b2500' },
  { id: 'sepia', label: 'Warm Sepia', bg: '#fbf0d9', fg: '#433422', border: '#dfcd9f', accent: '#9c4113' },
  { id: 'dark', label: 'Dark Charcoal', bg: '#1e1f20', fg: '#e4e6eb', border: '#3a3b3c', accent: '#d97736' },
  { id: 'oled', label: 'OLED Black', bg: '#000000', fg: '#f0f0f0', border: '#222222', accent: '#e07a3c' },
];

const ACCENTS = [
  { id: 'burgundy', label: 'Burgundy', color: '#8b2500' },
  { id: 'saffron', label: 'Saffron Gold', color: '#b26a00' },
  { id: 'emerald', label: 'Forest Emerald', color: '#1b6e4a' },
  { id: 'indigo', label: 'Royal Indigo', color: '#304ffe' },
  { id: 'slate', label: 'Deep Slate', color: '#455a64' },
];

export default function SettingsModal() {
  const {
    settings,
    isSettingsOpen,
    closeSettingsModal,
    updateSetting,
    updateSettings,
    resetToDefaults,
  } = useThemeSettings();

  const {
    dockMode,
    setDockMode,
    fontSizeMultiplier,
    setFontSizeMultiplier,
    clickToLookupEnabled,
    setClickToLookupEnabled,
    clickLookupMode,
    setClickLookupMode,
    dictOrder,
    dictEnabled,
    moveDictUp,
    moveDictDown,
    toggleDictEnabled,
  } = useDictionary();

  const [activeTab, setActiveTab] = useState('backup');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  if (!isSettingsOpen) return null;

  const handleExecuteReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.error('Failed to clear storage:', e);
    }
    resetToDefaults();
    setShowResetConfirm(false);
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleExport = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = 'tipitaka-reader-settings.json';
    a.click();
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        updateSettings(parsed);
        setImportSuccess(true);
        setImportError('');
        setTimeout(() => setImportSuccess(false), 2500);
      } catch (err) {
        setImportError('Invalid JSON file format.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in" onClick={closeSettingsModal}>
      <div
        className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] text-[var(--text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-base text-[var(--accent)]">
            <Sliders size={18} />
            <span>Reader & Settings Preference</span>
          </div>
          <button
            className="p-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-card)] transition"
            onClick={closeSettingsModal}
            title="Close Settings (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Tabs Sidebar + Content Panel */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
          {/* Responsive Tabs (Horizontal strip on mobile, vertical sidebar on sm+) */}
          <div className="w-full sm:w-48 bg-[var(--bg-sidebar)] border-b sm:border-b-0 sm:border-r border-[var(--border-color)] p-1.5 sm:p-2 flex flex-row sm:flex-col gap-1 shrink-0 overflow-x-auto sm:overflow-y-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-medium rounded-lg text-left whitespace-nowrap shrink-0 transition ${
                    isActive
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content Panel */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {/* 1. Backup & Reset Tab */}
            {activeTab === 'backup' && (
              <div className="p-3.5 sm:p-5 space-y-5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Settings Backup & Migration
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handleExport}
                      className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg flex items-center justify-center gap-2 text-xs font-semibold hover:border-[var(--accent)] transition cursor-pointer"
                    >
                      <Download size={15} />
                      <span>Export Settings (JSON)</span>
                    </button>

                    <label className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg flex items-center justify-center gap-2 text-xs font-semibold hover:border-[var(--accent)] transition cursor-pointer">
                      <Upload size={15} />
                      <span>Import Settings (JSON)</span>
                      <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                  </div>

                  {importSuccess && <div className="text-xs text-emerald-600 font-semibold text-center mt-2">Settings successfully imported!</div>}
                  {importError && <div className="text-xs text-red-600 font-semibold text-center mt-2">{importError}</div>}
                </div>

                <div className="pt-4 border-t border-[var(--border-color)]">
                  <div className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1.5">
                    Reset Application & Clear Storage
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mb-3">
                    It will restore TipitakaPali.org to the default settings. And the reset will also delete TipitakaPali.org&apos;s saved tabs, book positions, bookmarks, search history, dictionary order.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full py-2.5 px-4 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 rounded-lg text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/60 transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                  >
                    <RotateCcw size={14} />
                    <span>Reset All Settings & Clear Storage</span>
                  </button>
                </div>
              </div>
            )}

            {/* 2. Dictionary Tab */}
            {activeTab === 'dictionary' && (
              <div className="p-3.5 sm:p-5 space-y-5">
                {/* 1. Word Lookup Trigger */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      Dictionary Word Lookup Trigger
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">Enable Click Lookup</span>
                      <input
                        type="checkbox"
                        checked={clickToLookupEnabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setClickToLookupEnabled(enabled);
                          updateSetting('dictLookupTrigger', enabled ? (clickLookupMode || 'single') : 'off');
                        }}
                        className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={!clickToLookupEnabled}
                      onClick={() => {
                        updateSetting('dictLookupTrigger', 'single');
                        setClickLookupMode('single');
                      }}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                        clickToLookupEnabled && (clickLookupMode === 'single' || settings.dictLookupTrigger === 'single')
                          ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                          : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--accent-border)]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-[var(--text-primary)]">Single Click</span>
                        {clickToLookupEnabled && (clickLookupMode === 'single' || settings.dictLookupTrigger === 'single') && (
                          <Check size={14} className="text-[var(--accent)]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                        Click any Pāḷi word once in the reader to look up definitions instantly.
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={!clickToLookupEnabled}
                      onClick={() => {
                        updateSetting('dictLookupTrigger', 'double');
                        setClickLookupMode('double');
                      }}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                        clickToLookupEnabled && (clickLookupMode === 'double' || settings.dictLookupTrigger === 'double')
                          ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                          : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--accent-border)]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-[var(--text-primary)]">Double Click</span>
                        {clickToLookupEnabled && (clickLookupMode === 'double' || settings.dictLookupTrigger === 'double') && (
                          <Check size={14} className="text-[var(--accent)]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                        Double-click words to look up (preserves standard browser text selection).
                      </p>
                    </button>
                  </div>
                </div>

                {/* 2. Dictionary Panel Dock Mode */}
                <div className="pt-3 border-t border-[var(--border-color)]">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Dictionary Panel Dock Mode
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'left', label: 'Left Dock', icon: PanelLeft, desc: 'Docked left (Tree docks right)' },
                      { id: 'modal', label: 'Center Modal', icon: Maximize2, desc: 'Floating center popup' },
                      { id: 'side', label: 'Right Dock', icon: PanelRight, desc: 'Docked right (Tree docks left)' },
                    ].map((m) => {
                      const Icon = m.icon;
                      const isSelected = dockMode === m.id || (m.id === 'side' && dockMode === 'right');
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setDockMode(m.id)}
                          className={`p-2.5 text-left rounded-lg border transition flex flex-col justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-[var(--accent)] text-white border-[var(--accent)] font-semibold shadow-xs'
                              : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] hover:border-gray-400'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 text-xs font-bold">
                            <Icon size={14} />
                            <span>{m.label}</span>
                          </div>
                          <div
                            className={`text-[10px] mt-1 leading-tight ${
                              isSelected ? 'text-white/80' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {m.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Dictionary Font Size */}
                <div className="pt-3 border-t border-[var(--border-color)]">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    <span className="flex items-center gap-1.5">
                      <BookA size={14} className="text-[var(--accent)]" />
                      <span>Dictionary Font Size</span>
                    </span>
                    <span className="font-mono text-[var(--accent)] font-bold">
                      {Math.round(fontSizeMultiplier * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-2.5">
                    <button
                      type="button"
                      onClick={() => setFontSizeMultiplier((f) => Math.max(0.7, parseFloat((f - 0.1).toFixed(1))))}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
                      title="Smaller font"
                    >
                      A-
                    </button>
                    <input
                      type="range"
                      min="0.7"
                      max="1.8"
                      step="0.05"
                      value={fontSizeMultiplier}
                      onChange={(e) => setFontSizeMultiplier(parseFloat(e.target.value))}
                      className="flex-1 accent-[var(--accent)] cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setFontSizeMultiplier((f) => Math.min(1.8, parseFloat((f + 0.1).toFixed(1))))}
                      className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--border-color)] text-xs font-bold text-[var(--text-primary)] transition cursor-pointer"
                      title="Larger font"
                    >
                      A+
                    </button>
                  </div>
                </div>

                {/* 4. Active Dictionaries & Display Order */}
                <div className="pt-3 border-t border-[var(--border-color)] space-y-2.5">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      Enabled Dictionaries & Result Order
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Toggle dictionaries on/off and arrange result tab priority using the up/down arrows.
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {dictOrder.map((dictId, idx) => {
                      const dictInfo = AVAILABLE_DICTIONARIES.find((d) => d.id === dictId) || {
                        id: dictId,
                        label: dictId.toUpperCase(),
                        shortLabel: dictId.toUpperCase(),
                        desc: '',
                        badge: '',
                        badgeClass: '',
                      };
                      const isEnabled = dictEnabled[dictId] !== false;

                      return (
                        <div
                          key={dictId}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 transition ${
                            isEnabled
                              ? 'bg-[var(--bg-card)] border-[var(--border-color)]'
                              : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)] opacity-60'
                          }`}
                        >
                          {/* Checkbox and Label */}
                          <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleDictEnabled(dictId)}
                              className="accent-[var(--accent)] w-4 h-4 rounded cursor-pointer shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                                  {dictInfo.label}
                                </span>
                                {dictInfo.badge && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold shrink-0 ${dictInfo.badgeClass}`}>
                                    {dictInfo.badge}
                                  </span>
                                )}
                              </div>
                              {dictInfo.desc && (
                                <div className="text-[11px] text-[var(--text-muted)] truncate">
                                  {dictInfo.desc}
                                </div>
                              )}
                            </div>
                          </label>

                          {/* Reorder Buttons: Up & Down */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveDictUp(dictId)}
                              disabled={idx === 0}
                              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                              title="Move dictionary up"
                              aria-label="Move dictionary up"
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveDictDown(dictId)}
                              disabled={idx === dictOrder.length - 1}
                              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer border border-[var(--border-color)]"
                              title="Move dictionary down"
                              aria-label="Move dictionary down"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 3. Typography Tab */}
            {activeTab === 'typography' && (
              <div className="p-3.5 sm:p-5 space-y-5">
                {/* Font Family */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Reader Font Family
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {FONTS.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => updateSetting('fontFamily', f.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          settings.fontFamily === f.id
                            ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-[var(--accent-border)]'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-semibold" style={{ fontFamily: f.family }}>
                            {f.label}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mt-0.5">{f.desc}</div>
                        </div>
                        {settings.fontFamily === f.id && <Check size={16} className="text-[var(--accent)]" />}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Font Size & Line Height */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      <span>Font Size</span>
                      <span className="font-mono text-[var(--accent)]">{settings.fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="32"
                      step="1"
                      value={settings.fontSize}
                      onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))}
                      className="w-full accent-[var(--accent)] cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
                      <span>Line Height</span>
                      <span className="font-mono text-[var(--accent)]">{settings.lineHeight}</span>
                    </div>
                    <input
                      type="range"
                      min="1.4"
                      max="2.6"
                      step="0.05"
                      value={settings.lineHeight}
                      onChange={(e) => updateSetting('lineHeight', parseFloat(e.target.value))}
                      className="w-full accent-[var(--accent)] cursor-pointer"
                    />
                  </div>
                </div>

                {/* Text Alignment & Paragraph Indent */}
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[var(--border-color)]">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Text Alignment
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateSetting('textAlign', 'left')}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium border flex items-center justify-center gap-1.5 transition ${
                          settings.textAlign === 'left'
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <AlignLeft size={14} />
                        <span>Left</span>
                      </button>
                      <button
                        onClick={() => updateSetting('textAlign', 'justify')}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium border flex items-center justify-center gap-1.5 transition ${
                          settings.textAlign === 'justify'
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <AlignJustify size={14} />
                        <span>Justified</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                      Paragraph Style
                    </label>
                    <label className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer mt-1">
                      <input
                        type="checkbox"
                        checked={settings.paragraphIndent}
                        onChange={(e) => updateSetting('paragraphIndent', e.target.checked)}
                        className="accent-[var(--accent)] rounded"
                      />
                      <span>Traditional Tipitaka Indents</span>
                    </label>
                  </div>
                </div>

                {/* Live Preview Box */}
                <div className="p-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                    Live Typography Preview
                  </div>
                  <p
                    className="leading-relaxed"
                    style={{
                      fontFamily: FONTS.find((f) => f.id === settings.fontFamily)?.family,
                      fontSize: `${settings.fontSize}px`,
                      lineHeight: settings.lineHeight,
                      textAlign: settings.textAlign,
                    }}
                  >
                    <strong className="text-[var(--accent)] font-bold mr-1.5">1.</strong>
                    Evaṃ me sutaṃ— ekaṃ samayaṃ bhagavā sāvatthiyaṃ viharati jetavane anāthapiṇḍikassa ārāme.
                  </p>
                </div>
              </div>
            )}

            {/* 4. Layout & Tree Tab */}
            {activeTab === 'layout' && (
              <div className="p-3.5 sm:p-5 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Reader Column Width
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: '760px', label: 'Narrow (760px)' },
                      { id: '880px', label: 'Standard (880px)' },
                      { id: '1100px', label: 'Wide (1100px)' },
                    ].map((w) => (
                      <button
                        key={w.id}
                        onClick={() => updateSetting('readerMaxWidth', w.id)}
                        className={`py-2 px-2 text-xs font-medium rounded-md border text-center transition ${
                          settings.readerMaxWidth === w.id
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border-color)]">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Sidebar Tree Density
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'compact', label: 'Compact' },
                      { id: 'normal', label: 'Normal' },
                      { id: 'spacious', label: 'Spacious' },
                    ].map((d) => (
                      <button
                        key={d.id}
                        onClick={() => updateSetting('treeDensity', d.id)}
                        className={`py-2 px-2 text-xs font-medium rounded-md border text-center transition ${
                          settings.treeDensity === d.id
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border-color)]">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Scroll Navigation & Motion Sickness Reduction
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'fast', label: '⚡ Fast & Smooth', desc: 'Rapid 150ms ease-out, zero motion sickness' },
                      { id: 'instant', label: '🚀 Instant (0ms)', desc: 'Direct jump, zero motion' },
                      { id: 'smooth', label: '🌊 Standard', desc: 'Standard browser smooth scrolling' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateSetting('scrollMotion', m.id)}
                        className={`p-2.5 text-left rounded-lg border transition flex flex-col justify-between ${
                          (settings.scrollMotion || 'instant') === m.id
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)] font-semibold shadow-xs'
                            : 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] hover:border-gray-400'
                        }`}
                      >
                        <div className="text-xs font-bold">{m.label}</div>
                        <div
                          className={`text-[10px] mt-1 leading-tight ${
                            (settings.scrollMotion || 'instant') === m.id ? 'text-white/80' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {m.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border-color)] space-y-2.5">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer">
                    <span className="text-xs font-semibold">Pulsing animation on target highlight</span>
                    <input
                      type="checkbox"
                      checked={settings.pulseAnimation}
                      onChange={(e) => updateSetting('pulseAnimation', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer">
                    <span className="text-xs font-semibold">Highlight search keywords in target paragraph</span>
                    <input
                      type="checkbox"
                      checked={settings.highlightSearchTerms}
                      onChange={(e) => updateSetting('highlightSearchTerms', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* 5. Themes & Colors Tab */}
            {activeTab === 'themes' && (
              <div className="p-3.5 sm:p-5 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
                    Color Theme
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {THEMES.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => updateSetting('theme', t.id)}
                        className={`p-3.5 rounded-lg border-2 cursor-pointer transition flex items-center justify-between ${
                          settings.theme === t.id ? 'border-[var(--accent)] shadow-md' : 'border-[var(--border-color)] hover:border-gray-400'
                        }`}
                        style={{ backgroundColor: t.bg, color: t.fg }}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-4 h-4 rounded-full border"
                            style={{ backgroundColor: t.accent, borderColor: t.border }}
                          />
                          <span className="text-xs font-bold">{t.label}</span>
                        </div>
                        {settings.theme === t.id && <Check size={16} style={{ color: t.accent }} />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--border-color)]">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
                    Accent Color Accent
                  </label>
                  <div className="grid grid-cols-5 gap-2.5">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => updateSetting('accentColor', a.id)}
                        className={`p-2.5 rounded-lg border flex flex-col items-center gap-1.5 text-[11px] font-medium transition ${
                          settings.accentColor === a.id
                            ? 'border-[var(--accent)] bg-[var(--accent-light)] font-bold'
                            : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-gray-300'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full shadow-sm" style={{ backgroundColor: a.color }} />
                        <span className="text-center truncate w-full">{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 6. Display Options Tab */}
            {activeTab === 'display' && (
              <div className="p-3.5 sm:p-5 space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  Reader Text Elements & Markers
                </div>

                <div className="space-y-2.5">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:border-[var(--accent-border)] transition">
                    <div>
                      <div className="text-xs font-semibold">Page Number Breaks (<code className="font-mono text-[var(--accent)] text-[11px]">pb</code>)</div>
                      <div className="text-[11px] text-[var(--text-muted)]">Show or hide Roman & script edition markers e.g. [M 1.0029], [V 1.0031], [T 1.0042], [P 1.0010]</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showPageBreaks}
                      onChange={(e) => updateSetting('showPageBreaks', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>

                  <div className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold">Breadcrumb Page Edition</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Default edition indicator shown in breadcrumbs
                      </div>
                    </div>
                    <select
                      value={settings.defaultEditionPage || 'M'}
                      onChange={(e) => updateSetting('defaultEditionPage', e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] font-semibold outline-none focus:border-[var(--accent)] cursor-pointer shrink-0"
                    >
                      <option value="M">Myanmar (M) [Default]</option>
                      <option value="V">VRI (V)</option>
                      <option value="P">PTS (P)</option>
                      <option value="T">Thai (T)</option>
                      <option value="all">All Editions</option>
                    </select>
                  </div>

                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:border-[var(--accent-border)] transition">
                    <div>
                      <div className="text-xs font-semibold">Paragraph Numbers</div>
                      <div className="text-[11px] text-[var(--text-muted)]">Show canonical paragraph numbers (1., 2., 3., etc.)</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showParaNumbers}
                      onChange={(e) => updateSetting('showParaNumbers', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:border-[var(--accent-border)] transition">
                    <div>
                      <div className="text-xs font-semibold">Editorial Notes & Footnotes</div>
                      <div className="text-[11px] text-[var(--text-muted)]">Show footnote reference markers in the text</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showFootnotes}
                      onChange={(e) => updateSetting('showFootnotes', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:border-[var(--accent-border)] transition">
                    <div>
                      <div className="text-xs font-semibold">Chapter Divider Headings</div>
                      <div className="text-[11px] text-[var(--text-muted)]">Show clear section banners at chapter boundaries</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showChapterHeadings}
                      onChange={(e) => updateSetting('showChapterHeadings', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* 7. Help & Guide Tab */}
            {activeTab === 'help' && (
              <div className="animate-fade-in flex-1 flex flex-col">
                <HelpGuideContent defaultTab="all" showTabBar={true} />
              </div>
            )}

          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>Settings automatically saved to browser storage.</span>
          <button
            onClick={closeSettingsModal}
            className="px-4 py-1.5 bg-[var(--accent)] text-white font-medium rounded-md hover:bg-[var(--accent-hover)] transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>

      {/* Confirmation Dialog for Resetting All Data */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in" onClick={() => setShowResetConfirm(false)}>
          <div
            className="w-full max-w-md bg-[var(--bg-primary)] border border-rose-300 dark:border-rose-900 rounded-2xl shadow-2xl p-5 space-y-4 text-[var(--text-primary)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-600 flex items-center justify-center shrink-0">
                <RotateCcw size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">Reset All Settings & Storage?</h4>
                <p className="text-xs text-[var(--text-muted)]">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              It will restore TipitakaPali.org to the default settings. And the reset will also delete TipitakaPali.org&apos;s saved tabs, book positions, bookmarks, search history, dictionary order.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-3.5 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] text-xs font-medium hover:bg-[var(--bg-secondary)] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition cursor-pointer"
              >
                Yes, Reset Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
