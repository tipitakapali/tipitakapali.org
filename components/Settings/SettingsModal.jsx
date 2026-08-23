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
} from 'lucide-react';
import { useThemeSettings } from '../../context/ThemeSettingsContext';

const TABS = [
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'themes', label: 'Themes & Colors', icon: Palette },
  { id: 'display', label: 'Display Options', icon: Eye },
  { id: 'layout', label: 'Layout & Tree', icon: Layout },
  { id: 'backup', label: 'Backup & Reset', icon: Sliders },
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

  const [activeTab, setActiveTab] = useState('typography');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);

  if (!isSettingsOpen) return null;

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
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-5 sm:space-y-6">
            {/* 1. Typography Tab */}
            {activeTab === 'typography' && (
              <div className="space-y-5">
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

            {/* 2. Themes & Colors Tab */}
            {activeTab === 'themes' && (
              <div className="space-y-5">
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

            {/* 3. Display Options Tab */}
            {activeTab === 'display' && (
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  Reader Text Elements & Markers
                </div>

                <div className="space-y-2.5">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer hover:border-[var(--accent-border)] transition">
                    <div>
                      <div className="text-xs font-semibold">Page Number Breaks</div>
                      <div className="text-[11px] text-[var(--text-muted)]">Show [VRI 1.23], [PTS 2.45], [Thai 1.10] edition markers</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showPageBreaks}
                      onChange={(e) => updateSetting('showPageBreaks', e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 rounded"
                    />
                  </label>

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

            {/* 4. Layout & Tree Tab */}
            {activeTab === 'layout' && (
              <div className="space-y-5">
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

                <div className="pt-3 border-t border-[var(--border-color)] space-y-2.5">
                  <label className="flex items-center justify-between p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] cursor-pointer">
                    <span className="text-xs font-semibold">Pulsing animation on search jump</span>
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

            {/* 5. Backup & Reset Tab */}
            {activeTab === 'backup' && (
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  Settings Backup & Migration
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleExport}
                    className="p-3 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg flex items-center justify-center gap-2 text-xs font-semibold hover:border-[var(--accent)] transition"
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

                {importSuccess && <div className="text-xs text-emerald-600 font-semibold text-center">Settings successfully imported!</div>}
                {importError && <div className="text-xs text-red-600 font-semibold text-center">{importError}</div>}

                <div className="pt-4 border-t border-[var(--border-color)]">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Reset Preferences
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Reset all typography, theme, and reader preferences to default settings?')) {
                        resetToDefaults();
                      }
                    }}
                    className="w-full py-2.5 px-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 transition flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={14} />
                    <span>Reset All Settings to Defaults</span>
                  </button>
                </div>
              </div>
            )}

            {/* 6. Help & Guide Tab */}
            {activeTab === 'help' && (
              <div className="space-y-4 animate-fade-in text-xs text-[var(--text-secondary)]">
                <div>
                  <h4 className="font-bold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
                    <Keyboard size={15} className="text-[var(--accent)]" />
                    <span>Keyboard Shortcuts</span>
                  </h4>
                  <div className="space-y-1.5 mt-2">
                    <div className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)]">
                      <span>Open Search Dialog</span>
                      <kbd className="px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[10px] font-bold">/</kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)]">
                      <span>Toggle Navigation Sidebar</span>
                      <kbd className="px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[10px] font-bold">Ctrl + B</kbd>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-color)]">
                      <span>Close Modals / Overlays</span>
                      <kbd className="px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-[10px] font-bold">Esc</kbd>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[var(--border-color)]">
                  <h4 className="font-bold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
                    <BookOpen size={15} className="text-[var(--accent)]" />
                    <span>Features & Reading Guide</span>
                  </h4>
                  <ul className="space-y-1.5 list-disc pl-4 text-[11.5px] leading-relaxed text-[var(--text-secondary)] mt-2">
                    <li><strong>Lazy Loading & Streaming</strong>: Large multi-megabyte books are streamed chapter-by-chapter with zero lag and predictive pre-buffering.</li>
                    <li><strong>Session Resumption</strong>: All open tabs and your reading progress are automatically saved and restored when you revisit the app.</li>
                    <li><strong>Bookmarking</strong>: Click the bookmark icon in the breadcrumb header or footer to save your reading location with timestamps.</li>
                    <li><strong>Pāḷi Dictionary Look-up</strong>: Click the <em>Dict</em> button in the footer to search PTS, DPD, and CPED dictionaries with virtual diacritic keys.</li>
                    <li><strong>Table of Contents (TOC)</strong>: Click <em>TOC</em> in the footer to view clean hierarchical headings with live reading position tracking.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>Settings automatically saved to browser storage.</span>
          <button
            onClick={closeSettingsModal}
            className="px-4 py-1.5 bg-[var(--accent)] text-white font-medium rounded-md hover:bg-[var(--accent-hover)] transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
