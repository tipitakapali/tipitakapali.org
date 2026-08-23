'use client';

import React from 'react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';

export default function FloatingMenuBtn() {
  const { isSidebarOpen, setIsSidebarOpen } = useTabs();
  const { isZenMode, setIsZenMode } = useThemeSettings();

  const handleToggle = () => {
    if (isZenMode || !isSidebarOpen) {
      // Restore everything
      setIsZenMode(false);
      setIsSidebarOpen(true);
    } else {
      // Hide everything (Zen Mode)
      setIsZenMode(true);
      setIsSidebarOpen(false);
    }
  };

  return (
    <button
      className="floating-toggle-btn"
      id="toggleHeaderFooterBtn"
      title={isZenMode ? 'Show UI & Navigation' : 'Hide UI & Navigation (Zen Mode)'}
      onClick={handleToggle}
    >
      ☰
    </button>
  );
}
