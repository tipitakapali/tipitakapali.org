'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const DEFAULT_TRANSLATION_ORDER = ['english', 'myanmar', 'vietnamese', 'sinhala', 'thai', 'german', 'japanese', 'khmer', 'korean', 'russian'];

const SETTINGS_STORAGE_KEY = 'tipitaka_advanced_settings_v2';

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
    english: false,
    vietnamese: false,
    myanmar: false,
    thai: false,
    sinhala: false,
    german: false,
    japanese: false,
    khmer: false,
    russian: false,
    korean: false,
  },
  translationOrder: [...DEFAULT_TRANSLATION_ORDER],
  translationDisplayMode: 'stack', // 'stack' | 'side'
};

const ThemeSettingsContext = createContext();

export function ThemeSettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

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
          // Ensure translations object has all keys
          merged.translations = { ...prev.translations, ...(parsed.translations || {}) };
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
