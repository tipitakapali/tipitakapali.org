'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const DEFAULT_SETTINGS = {
  theme: 'light',
  accentColor: 'burgundy',
  fontFamily: 'gentium',
  fontSize: 25,
  lineHeight: 1.85,
  textAlign: 'left',
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
  },
};

const ThemeSettingsContext = createContext();

export function ThemeSettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('tipitaka_advanced_settings');
      if (saved) {
        setSettingsState((prev) => ({ ...prev, ...JSON.parse(saved) }));
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
        localStorage.setItem('tipitaka_advanced_settings', JSON.stringify(updated));
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
        localStorage.setItem('tipitaka_advanced_settings', JSON.stringify(updated));
      } catch (e) {
        console.error('Error saving settings to localStorage:', e);
      }
      return updated;
    });
  };

  const resetToDefaults = () => {
    setSettingsState(DEFAULT_SETTINGS);
    try {
      localStorage.setItem('tipitaka_advanced_settings', JSON.stringify(DEFAULT_SETTINGS));
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
