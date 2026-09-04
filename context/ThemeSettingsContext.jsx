'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const DEFAULT_TRANSLATION_ORDER = [
  'pali',
  'english',
  'vietnamese',
  'myanmar',
  'sinhala',
  'chinese',
  'khmer',
  'thai',
  'lao',
  'tamil',
  'hindi',
  'german',
  'japanese',
  'korean',
  'portuguese',
  'russian',
  'my_nissaya',
];

const SETTINGS_STORAGE_KEY = 'tipitaka_advanced_settings_v4';

// One-per-theme page background (matches --bg-primary in globals.css). iOS Safari tints
// its chrome to this value. Key 'default' is the :root background (no data-theme attr set).
const THEME_BACKGROUND = {
  classic: '#f0eee5',
  sepia: '#fbf0d9',
  dark: '#18191a',
  oled: '#000000',
  dusk: '#282a36',
  default: '#fdfdfc',
};

// meta[name=theme-color] + standalone status bar update when theme changes.
function applyBrowserThemeColor(theme) {
  if (typeof document !== 'undefined') return;
  const bg = THEME_BACKGROUND[theme] || THEME_BACKGROUND.default;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', bg);
  // For dark themes, tint the standalone (added-to-homescreen) status bar transparent dark.
  const dark = theme === 'dark' || theme === 'oled' || theme === 'dusk';
  const sb = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (sb) sb.setAttribute('content', dark ? 'black-translucent' : 'default');
}

const DEFAULT_SETTINGS = {
  theme: 'classic',
  accentColor: 'burgundy',
  fontFamily: 'gentium',
  fontSize: 22,
  lineHeight: 1.85,
  textAlign: 'justify',
  paragraphIndent: true,
  readerMaxWidth: '880px',
  showPageBreaks: false,
  showParaNumbers: true,
  showFootnotes: true,
  showChapterHeadings: true,
  treeDensity: 'normal',
  highlightSearchTerms: true,
  pulseAnimation: true,
  scrollMotion: 'instant', // 'fast' | 'instant' | 'smooth'
  paliScript: 'roman',
  dictLookupTrigger: 'single', // 'single' | 'double'
  defaultEditionPage: 'M', // 'M' (Myanmar) | 'V' (VRI) | 'P' (PTS) | 'T' (Thai) | 'all' (All editions)
  translations: {
    pali: true,
    english: false,
    vietnamese: false,
    myanmar: false,
    sinhala: false,
    chinese: false,
    khmer: false,
    thai: false,
    lao: false,
    tamil: false,
    hindi: false,
    german: false,
    japanese: false,
    korean: false,
    portuguese: false,
    russian: false,
    my_nissaya: false,
  },
  translationOrder: [...DEFAULT_TRANSLATION_ORDER],
  translationDisplayMode: 'stack', // 'stack' | 'side'
  translationColors: {},
};

const ThemeSettingsContext = createContext();

export function ThemeSettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    try {
      let saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!saved) {
        // Upgrade from v3 if exists: retain all user preferences (theme, font, etc.) but apply new default translationOrder
        const prevSaved = localStorage.getItem('tipitaka_advanced_settings_v3');
        if (prevSaved) {
          try {
            const prevParsed = JSON.parse(prevSaved);
            const { translationOrder, ...rest } = prevParsed;
            saved = JSON.stringify({ ...rest, translationOrder: [...DEFAULT_TRANSLATION_ORDER] });
          } catch (e) {}
        }
      }
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge and migrate translationOrder / translationDisplayMode for older saves
        setSettingsState((prev) => {
          const merged = { ...prev, ...parsed };
          // Ensure translationOrder exists and contains all known ids
          if (!Array.isArray(merged.translationOrder) || merged.translationOrder.length === 0) {
            merged.translationOrder = [...DEFAULT_TRANSLATION_ORDER];
          } else {
            if (!merged.translationOrder.includes('pali')) {
              merged.translationOrder.unshift('pali');
            }
            const seen = new Set(merged.translationOrder);
            for (const id of DEFAULT_TRANSLATION_ORDER) {
              if (!seen.has(id)) merged.translationOrder.push(id);
            }
            // Filter out stale ids not in default list (keep custom order but drop unknowns)
            merged.translationOrder = merged.translationOrder.filter((id) => DEFAULT_TRANSLATION_ORDER.includes(id));
            if (merged.translationOrder.length === 0) merged.translationOrder = [...DEFAULT_TRANSLATION_ORDER];
          }
          if (!['stack', 'side'].includes(merged.translationDisplayMode)) {
            merged.translationDisplayMode = 'stack';
          }
          merged.translationColors =
            merged.translationColors && typeof merged.translationColors === 'object'
              ? merged.translationColors
              : {};
          // Ensure translations object has all keys and pali defaults to true
          merged.translations = { ...prev.translations, ...(parsed.translations || {}) };
          if (merged.translations.pali === undefined) {
            merged.translations.pali = true;
          }
          // Ensure at least one language layer (defaulting to pali) remains active
          const hasAnyActive = Object.values(merged.translations).some(Boolean);
          if (!hasAnyActive) {
            merged.translations.pali = true;
          }
          return merged;
        });
      }
    } catch (e) {
      console.error('Error loading settings from localStorage:', e);
    }
    setIsMounted(true);
  }, []);

  const updateSetting = (key, value) => {
    setSettingsState((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error('Error saving settings to localStorage:', e);
      }
      return updated;
    });
  };

  const updateSettings = (newObj) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...newObj };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error('Error saving settings to localStorage:', e);
      }
      return updated;
    });
  };

  const resetToDefaults = () => {
    setSettingsState(DEFAULT_SETTINGS);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch (e) {}
  };

  const toggleZenMode = () => {
    setIsZenMode((prev) => !prev);
  };

  const openSettingsModal = () => setIsSettingsOpen(true);
  const closeSettingsModal = () => setIsSettingsOpen(false);

  // Apply CSS Variables & Attributes to Root
  useEffect(() => {
    if (!isMounted) return;

    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    applyBrowserThemeColor(settings.theme);
    root.setAttribute('data-accent', settings.accentColor);
    root.setAttribute('data-font', settings.fontFamily);
    root.setAttribute('data-density', settings.treeDensity);
    root.setAttribute('data-script', settings.paliScript || 'roman');
    root.setAttribute('data-translation-mode', settings.translationDisplayMode || 'stack');

    root.style.setProperty('--font-size-base', `${settings.fontSize}px`);
    root.style.setProperty('--line-height-base', `${settings.lineHeight}`);
    root.style.setProperty('--reader-max-width', settings.readerMaxWidth);
    root.style.setProperty('--reader-text-align', settings.textAlign);

    // Apply Display Classes on body
    document.body.classList.toggle('hide-pb', !settings.showPageBreaks);
    document.body.classList.toggle('hide-paranum', !settings.showParaNumbers);
    document.body.classList.toggle('hide-footnotes', !settings.showFootnotes);
    document.body.classList.toggle('hide-chap-heading', !settings.showChapterHeadings);
    document.body.classList.toggle('no-indent', !settings.paragraphIndent);
    document.body.classList.toggle('zen-mode', isZenMode);
  }, [settings, isZenMode, isMounted]);

  // Prime script fonts to avoid FOIT/layout shift when switching scripts
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts && settings.paliScript && settings.paliScript !== 'roman') {
      const scriptFontMap = {
        sinhala: '1em "UN-Abhaya"',
        myanmar: '1em "Pyidaungsu"',
        devanagari: '1em "Noto Sans Devanagari"',
        thai: '1em "THSarabunPali"',
        laos: '1em "Noto Sans Lao"',
        khmer: '1em "Noto Sans Khmer"',
        bengali: '1em "Noto Sans Bengali"',
        gurmukhi: '1em "Noto Sans Gurmukhi"',
        gujarati: '1em "Noto Sans Gujarati"',
        telugu: '1em "Noto Sans Telugu"',
        kannada: '1em "Noto Sans Kannada"',
        malayalam: '1em "Noto Sans Malayalam"',
        taitham: '1em "Noto Sans Tai Tham"',
        brahmi: '1em "Noto Sans Brahmi"',
        tibetan: '1em "Noto Serif Tibetan"',
        cyrillic: '1em "Noto Sans"',
      };
      const fontDesc = scriptFontMap[settings.paliScript];
      if (fontDesc) {
        document.fonts.load(fontDesc).catch(() => {});
      }
    }
  }, [settings.paliScript]);

  return (
    <ThemeSettingsContext.Provider
      value={{
        settings,
        isZenMode,
        isSettingsOpen,
        isMounted,
        updateSetting,
        updateSettings,
        resetToDefaults,
        toggleZenMode,
        setIsZenMode,
        openSettingsModal,
        closeSettingsModal,
      }}
    >
      {children}
    </ThemeSettingsContext.Provider>
  );
}

export function useThemeSettings() {
  const context = useContext(ThemeSettingsContext);
  if (!context) {
    throw new Error('useThemeSettings must be used within a ThemeSettingsProvider');
  }
  return context;
}
