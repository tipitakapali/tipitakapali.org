'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const DEFAULT_TRANSLATION_ORDER = [
  'pali',
  'english',
  'vietnamese',
  'myanmar',
  'my_nissaya',
  'sinhala',
  'chinese',
  'khmer',
  'thai',
  'lao',
  'tamil',
  'hindi',
  'marathi',
  'indonesian',
  'czech',
  'german',
  'spanish',
  'french',
  'japanese',
  'portuguese',
  'russian',
  'korean',
  'nepali',
  'bengali',
];

const SETTINGS_STORAGE_KEY = 'tipitaka_advanced_settings_v7';

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

// Detect mobile device vs computer browser
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
  const isSmallScreen = window.innerWidth < 768;
  const isIPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1 && window.innerWidth <= 1024;
  return isMobileUa || isSmallScreen || isIPad;
}

export function isComputerBrowser() {
  return !isMobileDevice();
}

// Responsive default tabView: 'tabbed' (Tabs) on mobile / small screens (<900px),
// 'columns' (Columns) on larger desktop screens (>=900px).
export function getDefaultTabView(viewportWidth = null) {
  if (typeof viewportWidth === 'number' && Number.isFinite(viewportWidth)) {
    return viewportWidth < 900 ? 'tabbed' : 'columns';
  }
  if (typeof window === 'undefined') return 'columns';
  if (window.innerWidth < 900 || isMobileDevice()) {
    return 'tabbed';
  }
  return 'columns';
}

const DEFAULT_SETTINGS = {
  theme: 'classic',
  accentColor: 'burgundy',
  fontFamily: 'default',
  fontSize: 22,
  lineHeight: 1.85,
  textAlign: 'justify',
  paragraphIndent: false,
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
  openMatInNewWindow: false,
  openMatInNewColumn: false,
  tabView: 'columns', // 'single' | 'tabbed' | 'columns'
  syncScroll: false,
  showBookLinks: true,
  translations: {
    pali: true,
    english: true,
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
    indonesian: false,
    nepali: false,
    bengali: false,
    spanish: false,
    french: false,
    portuguese: false,
    russian: false,
    czech: false,
    marathi: false,
    my_nissaya: false,
  },
  translationOrder: [...DEFAULT_TRANSLATION_ORDER],
  translationDisplayMode: 'stack', // 'stack' (Vertical) | 'side' (Pali left) | 'side_rev' (Translation left)
  translationGranularity: 'sentence', // 'para' (paragraph) | 'sentence' (sentence lines)
  translationColors: {},
  showTranslationBorders: false,
  translationFontSize: null, // null = same size as Pāḷi (fontSize)
};

const ThemeSettingsContext = createContext();

export function ThemeSettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const isStorageLoadedRef = useRef(false);
  const preLoadOverridesRef = useRef([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
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

            // If my_nissaya was at the old default position (end of list), move it right under myanmar
            const myIdx = merged.translationOrder.indexOf('myanmar');
            const nissayaIdx = merged.translationOrder.indexOf('my_nissaya');
            if (myIdx !== -1 && nissayaIdx !== -1 && nissayaIdx > myIdx + 1 && nissayaIdx >= merged.translationOrder.length - 2) {
              merged.translationOrder.splice(nissayaIdx, 1);
              merged.translationOrder.splice(myIdx + 1, 0, 'my_nissaya');
            }

            if (merged.translationOrder.length === 0) merged.translationOrder = [...DEFAULT_TRANSLATION_ORDER];
          }

          if (!['stack', 'side', 'side_rev'].includes(merged.translationDisplayMode)) {
            merged.translationDisplayMode = 'stack';
          }
          if (!['para', 'sentence'].includes(merged.translationGranularity)) {
            merged.translationGranularity = 'sentence';
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
          const deviceDefaultTabView = getDefaultTabView();
          if (!['single', 'tabbed', 'columns'].includes(merged.tabView)) {
            merged.tabView = deviceDefaultTabView;
          } else if (!parsed.tabViewExplicit && merged.tabView === 'columns' && deviceDefaultTabView === 'tabbed') {
            merged.tabView = 'tabbed';
          }
          if (typeof merged.syncScroll !== 'boolean') {
            merged.syncScroll = false;
          }
          if (!parsed.openMatInNewWindowExplicit) {
            merged.openMatInNewWindow = false;
          }

          // If fontFamily was legacy default 'gentium' without explicit customization, or unsupported/empty, set to 'default'
          const VALID_FONT_FAMILIES = ['default', 'gentium', 'garamond', 'serif', 'system'];
          if (!merged.fontFamily || !VALID_FONT_FAMILIES.includes(merged.fontFamily) || (merged.fontFamily === 'gentium' && !parsed.fontFamilyExplicit)) {
            merged.fontFamily = 'default';
          }

          // Replay any deep-link setting overrides (e.g. /translation/vi/... or /book/hi....)
          // queued by child effects before localStorage finished hydrating.
          let finalMerged = merged;
          if (preLoadOverridesRef.current.length > 0) {
            for (const ov of preLoadOverridesRef.current) {
              const nextVal =
                typeof ov.value === 'function'
                  ? ov.value(finalMerged[ov.key], finalMerged)
                  : ov.value;
              finalMerged = { ...finalMerged, [ov.key]: nextVal };
            }
          }

          try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(finalMerged));
          } catch (e) {}
          return finalMerged;
        });
      } else {
        const deviceDefaultTabView = getDefaultTabView();
        const needsInitialUpdate =
          deviceDefaultTabView !== DEFAULT_SETTINGS.tabView || preLoadOverridesRef.current.length > 0;
        if (needsInitialUpdate) {
          setSettingsState((prev) => {
            const hasTabViewOverride = preLoadOverridesRef.current.some((ov) => ov.key === 'tabView');
            const next = hasTabViewOverride ? prev : { ...prev, tabView: deviceDefaultTabView };
            if (preLoadOverridesRef.current.length > 0) {
              try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
              } catch (e) {}
            }
            return next;
          });
        }
      }
    } catch (e) {
      console.error('Error loading settings from localStorage:', e);
    }
    isStorageLoadedRef.current = true;
    preLoadOverridesRef.current = [];
    setIsMounted(true);
  }, []);

  const updateSetting = (key, value) => {
    if (!isStorageLoadedRef.current) {
      preLoadOverridesRef.current.push({ key, value });
    }
    setSettingsState((prev) => {
      const finalVal = typeof value === 'function' ? value(prev[key], prev) : value;
      if (finalVal === prev[key]) return prev;
      const updated = { ...prev, [key]: finalVal };
      if (key === 'openMatInNewWindow') {
        updated.openMatInNewWindowExplicit = true;
      }
      if (key === 'fontFamily') {
        updated.fontFamilyExplicit = true;
      }
      if (key === 'tabView') {
        updated.tabViewExplicit = true;
      }
      if (isStorageLoadedRef.current) {
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.error('Error saving settings to localStorage:', e);
        }
      }
      return updated;
    });
  };

  const updateSettings = (newObj) => {
    setSettingsState((prev) => {
      const sanitized = { ...newObj };
      if ('openMatInNewWindow' in sanitized) {
        sanitized.openMatInNewWindowExplicit = true;
      }
      if ('fontFamily' in sanitized) {
        sanitized.fontFamilyExplicit = true;
      }
      if ('tabView' in sanitized) {
        sanitized.tabViewExplicit = true;
      }
      const updated = { ...prev, ...sanitized };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.error('Error saving settings to localStorage:', e);
      }
      return updated;
    });
  };

  const resetToDefaults = () => {
    const defaults = { ...DEFAULT_SETTINGS, tabView: getDefaultTabView() };
    setSettingsState(defaults);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(defaults));
    } catch (e) {}
  };

  const openSettingsModal = () => setIsSettingsOpen(true);
  const closeSettingsModal = () => setIsSettingsOpen(false);

  const openLanguageMenu = () => setIsLanguageMenuOpen(true);
  const closeLanguageMenu = () => setIsLanguageMenuOpen(false);

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
    root.style.setProperty(
      '--trans-font-size-base',
      `${settings.translationFontSize || settings.fontSize}px`
    );
    root.style.setProperty('--line-height-base', `${settings.lineHeight}`);
    root.style.setProperty('--reader-max-width', settings.readerMaxWidth);
    root.style.setProperty('--reader-text-align', settings.textAlign);

    // Apply Display Classes on body
    document.body.classList.toggle('hide-pb', !settings.showPageBreaks);
    document.body.classList.toggle('hide-trans-borders', settings.showTranslationBorders === false);
    document.body.classList.toggle('hide-paranum', !settings.showParaNumbers);
    document.body.classList.toggle('hide-footnotes', !settings.showFootnotes);
    document.body.classList.toggle('hide-chap-heading', !settings.showChapterHeadings);
    document.body.classList.toggle('no-indent', !settings.paragraphIndent);
  }, [settings, isMounted]);

  // Prime script & reader fonts to avoid FOIT/layout shift when switching scripts or fonts
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fonts) {
      if (settings.paliScript && settings.paliScript !== 'roman') {
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
      } else {
        if (settings.fontFamily === 'gentium') {
          document.fonts.load('1em "Gentium Plus"').catch(() => {});
        } else if (settings.fontFamily === 'garamond') {
          document.fonts.load('1em "EB Garamond"').catch(() => {});
        } else {
          document.fonts.load('1em "Noto Sans"').catch(() => {});
          document.fonts.load('1em "DejaVu Sans"').catch(() => {});
        }
      }
    }
  }, [settings.paliScript, settings.fontFamily]);

  return (
    <ThemeSettingsContext.Provider
      value={{
        settings,
        isSettingsOpen,
        isMounted,
        updateSetting,
        updateSettings,
        resetToDefaults,
        openSettingsModal,
        closeSettingsModal,
        isLanguageMenuOpen,
        setIsLanguageMenuOpen,
        openLanguageMenu,
        closeLanguageMenu,
      }}
    >
      {children}
    </ThemeSettingsContext.Provider>
  );
}

export const THEME_TRANSLATION_PALETTES = {
  classic: [
    '#772e03', // 1st: Deep Umber Brown (requested)
    '#1e3a8a', // 2nd: Navy Blue 900 (requested)
    '#0e7491', // 3rd: Deep Teal Cyan (requested)
    '#166534', // 4th: Forest Emerald
    '#9a3412', // 5th: Burnt Sienna
    '#9d174d', // 6th: Deep Rose Berry
    '#3f6212', // 7th: Olive Moss
    '#334155', // 8th: Cool Slate
  ],
  default: [
    '#772e03', // 1st: Deep Umber Brown
    '#1e3a8a', // 2nd: Navy Blue 900
    '#0e7491', // 3rd: Deep Teal Cyan
    '#15803d', // 4th: Emerald 700
    '#9a3412', // 5th: Rust Sienna
    '#9d174d', // 6th: Berry Rose
    '#4338ca', // 7th: Indigo 700
    '#334155', // 8th: Slate 700
  ],
  sepia: [
    '#772e03', // 1st: Deep Umber Brown
    '#1e40af', // 2nd: Cobalt Blue
    '#0f766e', // 3rd: Jade Teal
    '#854d0e', // 4th: Ochre Bronze
    '#9f1239', // 5th: Carmine Rose
    '#166534', // 6th: Bodhi Green
    '#9a3412', // 7th: Terracotta
    '#3730a3', // 8th: Deep Indigo
  ],
  dark: [
    '#c4b5fd', // 1st: Soft Lavender Violet
    '#93c5fd', // 2nd: Periwinkle Sky
    '#67e8f9', // 3rd: Lagoon Cyan
    '#86efac', // 4th: Sage Mint
    '#fdba74', // 5th: Warm Apricot
    '#f9a8d4', // 6th: Blossom Rose
    '#fcd34d', // 7th: Soft Amber
    '#cbd5e1', // 8th: Silver Mist
  ],
  oled: [
    '#d8b4fe', // 1st: Orchid Violet
    '#93c5fd', // 2nd: Ice Blue
    '#67e8f9', // 3rd: Aqua Mist
    '#6ee7b7', // 4th: Spring Emerald
    '#fed7aa', // 5th: Warm Sand
    '#f9a8d4', // 6th: Rosewater
    '#fde68a', // 7th: Buttercream
    '#e2e8f0', // 8th: Moonlight Slate
  ],
  dusk: [
    '#bd93f9', // 1st: Dracula Purple
    '#8be9fd', // 2nd: Dracula Cyan
    '#5eead4', // 3rd: Seafoam Teal
    '#a7f3d0', // 4th: Calm Mint
    '#ffb86c', // 5th: Dracula Orange
    '#ff92df', // 6th: Soft Dracula Pink
    '#f1fa8c', // 7th: Dracula Soft Yellow
    '#cdd6f4', // 8th: Lavender Mist
  ],
};

export function getDefaultTranslationSlotColor(theme = 'classic', slotIndex = 0) {
  const palette = THEME_TRANSLATION_PALETTES[theme] || THEME_TRANSLATION_PALETTES.classic;
  const idx = ((Number(slotIndex) || 0) % palette.length + palette.length) % palette.length;
  return palette[idx];
}

export function getDefaultTranslationColorsForTheme(theme = 'classic', slotIndex = 0) {
  const color = getDefaultTranslationSlotColor(theme, slotIndex);
  return {
    text: color,
    border: color,
    bg: '',
  };
}

const TRANSLATION_CODE_TO_KEY = {
  en: 'english',
  vi: 'vietnamese',
  my: 'myanmar',
  my_nissaya: 'my_nissaya',
  si: 'sinhala',
  zh: 'chinese',
  km: 'khmer',
  th: 'thai',
  lo: 'lao',
  ta: 'tamil',
  hi: 'hindi',
  de: 'german',
  ja: 'japanese',
  ko: 'korean',
  id: 'indonesian',
  ne: 'nepali',
  be: 'bengali',
  es: 'spanish',
  fr: 'french',
  pt: 'portuguese',
  ru: 'russian',
  cs: 'czech',
  mr: 'marathi',
};

function formatThemeCssColor(val) {
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return trimmed;
}

/** Resolve the effective text color for a translation language matching ReaderView rules. */
export function resolveTranslationTextColor(langCode, slotIndex = null, settings = null) {
  const theme = settings?.theme || 'classic';
  const rawKey = String(langCode || '').trim().toLowerCase();
  const fullKey = TRANSLATION_CODE_TO_KEY[rawKey] || rawKey;
  const customMap = settings?.translationColors || {};

  if (rawKey === 'pali') {
    return formatThemeCssColor(customMap?.pali?.text) || '';
  }

  const custom = customMap[fullKey] || customMap[rawKey] || {};
  const customText = formatThemeCssColor(custom.text);
  if (customText) return customText;

  let resolvedIdx = typeof slotIndex === 'number' && slotIndex >= 0 ? slotIndex : null;
  if (resolvedIdx === null) {
    const order = Array.isArray(settings?.translationOrder)
      ? settings.translationOrder
      : DEFAULT_TRANSLATION_ORDER;
    const enabledMap = settings?.translations || DEFAULT_SETTINGS.translations;
    const activeTransKeys = [];
    for (const id of order) {
      if (id !== 'pali' && enabledMap[id]) activeTransKeys.push(id);
    }
    for (const [id, on] of Object.entries(enabledMap)) {
      if (id !== 'pali' && on && !activeTransKeys.includes(id)) {
        activeTransKeys.push(id);
      }
    }
    const found = activeTransKeys.indexOf(fullKey);
    resolvedIdx = found >= 0 ? found : 0;
  }

  return getDefaultTranslationSlotColor(theme, resolvedIdx);
}

export function useThemeSettings() {
  const context = useContext(ThemeSettingsContext);
  if (!context) {
    throw new Error('useThemeSettings must be used within a ThemeSettingsProvider');
  }
  return context;
}
