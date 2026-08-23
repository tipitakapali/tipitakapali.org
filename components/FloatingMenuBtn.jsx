'use client';

import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';

export default function FloatingMenuBtn() {
  const { isSidebarOpen, setIsSidebarOpen } = useTabs();
  const { isZenMode, setIsZenMode } = useThemeSettings();

  const isCollapsed = isZenMode || !isSidebarOpen;

  const handleToggle = () => {
    if (isCollapsed) {
      // Restore UI: show Navigation, Header & Footer
      setIsZenMode(false);
      setIsSidebarOpen(true);
    } else {
      // Expand Reader: hide Navigation, Header & Footer (Zen Mode)
      setIsZenMode(true);
      setIsSidebarOpen(false);
    }
  };

  return (
    <button
      className="floating-toggle-btn"
      id="toggleHeaderFooterBtn"
      title={isCollapsed ? 'Show Navigation, Header & Footer (Contract Reader)' : 'Zen Reading Mode (Expand Reader)'}
      onClick={handleToggle}
      aria-label={isCollapsed ? 'Show Navigation, Header & Footer' : 'Zen Reading Mode'}
    >
      {isCollapsed ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  );
}
