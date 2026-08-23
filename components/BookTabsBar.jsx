'use client';

import React, { useRef, useEffect } from 'react';
import { Book, X, Plus } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript } from '../services/transliterate';

export default function BookTabsBar() {
  const { openTabs, activeBookCode, switchTab, closeTab } = useTabs();
  const { settings } = useThemeSettings();
  const tabsScrollRef = useRef(null);

  useEffect(() => {
    if (tabsScrollRef.current) {
      const activeEl = tabsScrollRef.current.querySelector('.book-tab.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeBookCode]);

  const handleWheel = (e) => {
    if (tabsScrollRef.current && e.deltaY !== 0) {
      e.preventDefault();
      tabsScrollRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleNewTab = () => {
    const treeInput = document.getElementById('treeFilterInput');
    if (treeInput) {
      treeInput.focus();
    }
  };

  return (
    <div className="book-tabs-bar" onWheel={handleWheel}>
      <div className="tabs-scroll-container" ref={tabsScrollRef}>
        {openTabs.map((tab) => {
          const isActive = tab.bookCode === activeBookCode;
          const displayTitle = convertPaliScript(tab.title, settings?.paliScript);
          return (
            <div
              key={tab.bookCode}
              className={`book-tab ${isActive ? 'active' : ''}`}
              title={`${displayTitle} (${tab.bookCode})`}
              onClick={() => switchTab(tab.bookCode)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.bookCode, e);
                }
              }}
            >
              <Book size={12} className="tab-icon shrink-0 opacity-80" />
              <span className="tab-title truncate">{displayTitle}</span>
              <button
                className="tab-close-btn"
                title="Close tab (Middle click)"
                onClick={(e) => closeTab(tab.bookCode, e)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button className="new-tab-btn" onClick={handleNewTab} title="Explore library & open books">
        <Plus size={13} />
        <span>Open Book</span>
      </button>
    </div>
  );
}
