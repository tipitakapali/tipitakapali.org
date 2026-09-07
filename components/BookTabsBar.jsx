'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Book, X, History, Bot } from 'lucide-react';
import { useTabs } from '../context/TabContext';



import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';

export default function BookTabsBar() {
  const {
    openTabs,
    activeBookCode,
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeLeftTabs,
    closeRightTabs,
    reorderTabs,
    recentHistory,
    setIsHistoryOpen,
    isSidebarOpen,
    isHeaderVisible,
    setIsSidebarOpen,
    setIsHeaderVisible,
  } = useTabs();
  const { settings, isZenMode, setIsZenMode } = useThemeSettings();

  const isHidden = !isHeaderVisible && !isSidebarOpen;


  const tabsScrollRef = useRef(null);
  const menuRef = useRef(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [dropPosition, setDropPosition] = useState(null); // 'left' | 'right'
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const scrollToActiveTab = useCallback((behavior = 'smooth') => {
    if (!tabsScrollRef.current) return;
    const container = tabsScrollRef.current;
    const activeEl = container.querySelector('.book-tab.active');
    if (!activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = activeEl.getBoundingClientRect();

    // Check if the tab is already fully visible with safety margin
    const isFullyVisible =
      tabRect.left >= containerRect.left + 16 &&
      tabRect.right <= containerRect.right - 16;

    if (!isFullyVisible) {
      const tabOffsetLeft = activeEl.offsetLeft;
      const targetScrollLeft = tabOffsetLeft - (container.clientWidth / 2) + (activeEl.clientWidth / 2);

      container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior,
      });
    }
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      scrollToActiveTab('smooth');
    });
    const timer = setTimeout(() => {
      scrollToActiveTab('smooth');
    }, 60);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timer);
    };
  }, [activeBookCode, openTabs.length, scrollToActiveTab]);

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

  const handleContextMenu = (e, tab, idx) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 160;
    const menuHeight = 180;
    const x = typeof window !== 'undefined' ? Math.min(e.clientX, window.innerWidth - menuWidth - 10) : e.clientX;
    const y = typeof window !== 'undefined' ? Math.min(e.clientY, window.innerHeight - menuHeight - 10) : e.clientY;

    setContextMenu({
      visible: true,
      x,
      y,
      bookCode: tab.bookCode,
      tabIndex: idx,
    });
  };

  return (
    <div className={`book-tabs-bar select-none ${isHidden ? 'hidden-tabs-bar' : ''}`} onWheel={handleWheel}>
      <div className="tabs-scroll-container" ref={tabsScrollRef}>
        {openTabs.map((tab, idx) => {
          const isActive = tab.bookCode === activeBookCode;
          const isAiTab = tab.type === 'ai_chat' || tab.bookCode === 'ai_chat';
          const isDragging = draggedIndex === idx;
          const isOver = dragOverIndex === idx;
          const textType = (() => {
            const code = (tab.bookCode || '').toLowerCase();
            const cat = (tab.category || '').toLowerCase();
            if (code.endsWith('.mul') || code.includes('m.mul') || cat.includes('mūla') || cat.includes('mula')) return 'mula';
            if (code.endsWith('.att') || code.includes('a.att') || cat.includes('aṭṭha') || cat.includes('attha')) return 'attha';
            if (code.endsWith('.tik') || code.includes('t.tik') || cat.includes('ṭīkā') || cat.includes('tika')) return 'tika';
            return 'other';
          })();
          const displayTitle = isAiTab
            ? (!tab.title || tab.title.includes('Vīmaṃsā') || tab.title.includes('Vimamsa') || tab.title.includes('Ani (AI Nissaya)')
                ? 'Ani Assistant'
                : tab.title)
            : convertPaliScript(capitalizePali(tab.title), settings?.paliScript);

          return (
            <div
              key={tab.bookCode}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onContextMenu={(e) => handleContextMenu(e, tab, idx)}
              className={`book-tab group cursor-grab active:cursor-grabbing ${isActive ? 'active' : ''} ${
                isAiTab ? 'book-tab-ai' : ''
              } ${
                isDragging ? 'is-dragging' : ''
              } ${isOver && dropPosition === 'left' ? 'drag-over-left' : ''} ${
                isOver && dropPosition === 'right' ? 'drag-over-right' : ''
              }`}
              title={`${displayTitle} (${tab.bookCode}) — Drag to reorder, right click for menu`}
              onClick={() => switchTab(tab.bookCode)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.bookCode, e);
                }
              }}
            >
              {isAiTab ? (
                <Bot size={12} className="tab-icon text-violet-600 dark:text-violet-400 shrink-0" />
              ) : (
                <Book size={12} className={`tab-icon tab-icon-${textType} shrink-0 opacity-90`} />
              )}
              <span className={`tab-title truncate ${isAiTab ? 'font-semibold text-violet-700 dark:text-violet-300' : ''}`}>
                {displayTitle}
              </span>
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
        title="Recent opened books"
        aria-label="Recent opened books"
      >
        <History size={14} className="text-[var(--accent)]" />
        {recentHistory.length > 0 && (
          <span className="text-[9.5px] px-1 py-0.2 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] font-mono border border-[var(--border-color)]">
            {recentHistory.length}
          </span>
        )}
      </button>


      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[160px] py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-xl text-xs text-[var(--text-primary)] animate-fade-in select-none font-medium"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] transition cursor-pointer flex items-center justify-between"
            onClick={() => {
              closeTab(contextMenu.bookCode);
              setContextMenu(null);
            }}
          >
            <span>Close</span>
          </button>

          <button
            disabled={openTabs.length <= 1}
            className={`w-full text-left px-3 py-1.5 transition flex items-center justify-between ${
              openTabs.length <= 1
                ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                : 'hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] cursor-pointer'
            }`}
            onClick={() => {
              if (openTabs.length > 1) {
                closeOtherTabs(contextMenu.bookCode);
                setContextMenu(null);
              }
            }}
          >
            <span>Close Others</span>
          </button>

          <div className="my-1 border-t border-[var(--border-color)]" />

          <button
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] transition cursor-pointer flex items-center justify-between"
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
          >
            <span>Close All</span>
          </button>

          <button
            disabled={contextMenu.tabIndex <= 0}
            className={`w-full text-left px-3 py-1.5 transition flex items-center justify-between ${
              contextMenu.tabIndex <= 0
                ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                : 'hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] cursor-pointer'
            }`}
            onClick={() => {
              if (contextMenu.tabIndex > 0) {
                closeLeftTabs(contextMenu.bookCode);
                setContextMenu(null);
              }
            }}
          >
            <span>Close Left Tabs</span>
          </button>

          <button
            disabled={contextMenu.tabIndex >= openTabs.length - 1}
            className={`w-full text-left px-3 py-1.5 transition flex items-center justify-between ${
              contextMenu.tabIndex >= openTabs.length - 1
                ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                : 'hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] cursor-pointer'
            }`}
            onClick={() => {
              if (contextMenu.tabIndex < openTabs.length - 1) {
                closeRightTabs(contextMenu.bookCode);
                setContextMenu(null);
              }
            }}
          >
            <span>Close Right Tabs</span>
          </button>
        </div>
      )}
    </div>
  );
}
