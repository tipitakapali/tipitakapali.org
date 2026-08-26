'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Book, X, History, Menu } from 'lucide-react';
import { useTabs } from '../context/TabContext';



import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript } from '../services/transliterate';

export default function BookTabsBar() {
  const {
    openTabs,
    activeBookCode,
    switchTab,
    closeTab,
    reorderTabs,
    recentHistory,
    setIsHistoryOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    setIsHeaderVisible,
  } = useTabs();
  const { settings, isZenMode, setIsZenMode } = useThemeSettings();

  const tabsScrollRef = useRef(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dropPosition, setDropPosition] = useState(null); // 'left' | 'right'

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

  const handleOpenNavAndExitZen = () => {
    setIsZenMode(false);
    setIsSidebarOpen(true);
    setIsHeaderVisible(true);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('zen-mode');
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedIndex === null || draggedIndex === index) {
      if (dragOverIndex !== null) {
        setDragOverIndex(null);
        setDropPosition(null);
      }
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const pos = e.clientX < midX ? 'left' : 'right';

    if (dragOverIndex !== index || dropPosition !== pos) {
      setDragOverIndex(index);
      setDropPosition(pos);
    }
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
      setDropPosition(null);
    }
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== targetIndex) {
      let finalIndex = targetIndex;
      if (dropPosition === 'right' && draggedIndex < targetIndex) {
        finalIndex = targetIndex;
      } else if (dropPosition === 'left' && draggedIndex > targetIndex) {
        finalIndex = targetIndex;
      }
      reorderTabs(draggedIndex, finalIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDropPosition(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDropPosition(null);
  };

  return (
    <div className="book-tabs-bar select-none" onWheel={handleWheel}>
      {/* Menu Icon before tabs when Navigation is closed or in Zen Mode */}
      {(!isSidebarOpen || isZenMode) && (
        <button
          className="zen-menu-btn flex items-center justify-center h-[28px] px-2 mb-[3px] rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border-color)] transition shrink-0 cursor-pointer"
          onClick={handleOpenNavAndExitZen}
          title="Open Navigation Tree (Ctrl+B)"
          aria-label="Open Navigation Tree"
        >
          <Menu size={16} />
        </button>
      )}

      <div className="tabs-scroll-container" ref={tabsScrollRef}>
        {openTabs.map((tab, idx) => {
          const isActive = tab.bookCode === activeBookCode;
          const isDragging = draggedIndex === idx;
          const isOver = dragOverIndex === idx;
          const displayTitle = convertPaliScript(tab.title, settings?.paliScript);

          return (
            <div
              key={tab.bookCode}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`book-tab group cursor-grab active:cursor-grabbing ${isActive ? 'active' : ''} ${
                isDragging ? 'is-dragging' : ''
              } ${isOver && dropPosition === 'left' ? 'drag-over-left' : ''} ${
                isOver && dropPosition === 'right' ? 'drag-over-right' : ''
              }`}
              title={`${displayTitle} (${tab.bookCode}) — Drag to reorder`}
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
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.bookCode, e);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        className="new-tab-btn flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer shrink-0"
        onClick={() => setIsHistoryOpen(true)}
        title="Recent Reading History"
        aria-label="Recent Reading History"
      >
        <History size={14} className="text-[var(--accent)]" />
        {recentHistory.length > 0 && (
          <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
            {recentHistory.length}
          </span>
        )}
      </button>
    </div>
  );
}
