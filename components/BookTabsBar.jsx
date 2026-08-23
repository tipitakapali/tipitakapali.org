'use client';

import React, { useRef, useEffect } from 'react';
import { Book, X, History } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript } from '../services/transliterate';

export default function BookTabsBar() {
  const { openTabs, activeBookCode, switchTab, closeTab, recentHistory, setIsHistoryOpen } = useTabs();
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

      <button
        className="new-tab-btn flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer shrink-0"
        onClick={() => setIsHistoryOpen(true)}
        title="Recent Reading History"
      >
        <History size={13} className="text-[var(--accent)]" />
        <span>History</span>
        {recentHistory.length > 0 && (
          <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
            {recentHistory.length}
          </span>
        )}
      </button>
    </div>
  );
}

