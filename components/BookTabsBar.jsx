'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Book, X, History, Bot, ExternalLink, Columns, Layers, Square, Link2, Unlink2 } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';

export default function BookTabsBar() {
  const {
    openTabs,
    activeBookCode,
    switchTab,
    openAlongside,
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
  const { settings, updateSetting, isZenMode, setIsZenMode } = useThemeSettings();

  const isHidden = !isHeaderVisible && !isSidebarOpen;
  const tabView = settings?.tabView || 'columns';
  const syncScroll = settings?.syncScroll === true;

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const bookTabs = useMemo(
    () => openTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat'),
    [openTabs]
  );

  // Determine which bookCodes are currently visible side-by-side in 'columns' mode
  const visibleColumnCodes = useMemo(() => {
    if (tabView !== 'columns' || viewportWidth < 900 || bookTabs.length <= 1 || activeBookCode === 'ai_chat') {
      return new Set();
    }
    const maxCols = viewportWidth >= 1100 ? 3 : 2;
    if (bookTabs.length <= maxCols) {
      return new Set(bookTabs.map((t) => t.bookCode));
    }
    const activeIdx = Math.max(0, bookTabs.findIndex((t) => t.bookCode === activeBookCode));
    let start = maxCols === 2 ? activeIdx : Math.max(0, activeIdx - 1);
    if (start + maxCols > bookTabs.length) {
      start = Math.max(0, bookTabs.length - maxCols);
    }
    return new Set(bookTabs.slice(start, start + maxCols).map((t) => t.bookCode));
  }, [tabView, viewportWidth, bookTabs, activeBookCode]);


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
      tab,
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

          const isInColumnView = visibleColumnCodes.has(tab.bookCode);

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
                isInColumnView && !isActive ? 'in-column-view' : ''
              } ${
                isAiTab ? 'book-tab-ai' : ''
              } ${
                isDragging ? 'is-dragging' : ''
              } ${isOver && dropPosition === 'left' ? 'drag-over-left' : ''} ${
                isOver && dropPosition === 'right' ? 'drag-over-right' : ''
              }`}
              title={`${displayTitle} (${tab.bookCode}) — Drag to reorder, right click for menu`}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  const ch = (tab.currentChapterIdx ?? 0) + 1;
                  const p = tab.lastParaNum;
                  const url = `/book/${tab.bookCode}/${ch}${p ? `#para${p}` : ''}`;
                  if (typeof window !== 'undefined') {
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }
                  return;
                }
                switchTab(tab.bookCode);
              }}
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
              {isInColumnView && !isActive && (
                <span
                  className="hidden min-[900px]:inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-75 shrink-0"
                  title="Visible in parallel column"
                />
              )}
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

      {/* View Mode & Parallel Column Controls (wide screens) */}
      <div className="hidden min-[900px]:flex items-center gap-1 shrink-0 mr-1">
        {tabView === 'columns' && bookTabs.length > 1 && (
          <button
            type="button"
            onClick={() => updateSetting('syncScroll', !syncScroll)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition cursor-pointer ${
              syncScroll
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-primary)]'
            }`}
            title={
              syncScroll
                ? 'Synchronized column scrolling is ON (Mūla / Aṭṭhakathā / Ṭīkā scroll together)'
                : 'Synchronized column scrolling is OFF (click to enable)'
            }
          >
            {syncScroll ? <Link2 size={12} /> : <Unlink2 size={12} />}
            <span>Sync</span>
          </button>
        )}

        <div
          className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5"
          role="group"
          aria-label="Tab view mode"
        >
          <button
            type="button"
            onClick={() => updateSetting('tabView', 'single')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold transition cursor-pointer ${
              tabView === 'single'
                ? 'bg-[var(--bg-card)] text-[var(--accent)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title="Single tab mode: opening a book replaces the current tab"
          >
            <Square size={11} />
            <span className="hidden xl:inline">Single</span>
          </button>
          <button
            type="button"
            onClick={() => updateSetting('tabView', 'tabbed')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold transition cursor-pointer ${
              tabView === 'tabbed'
                ? 'bg-[var(--bg-card)] text-[var(--accent)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title="Multi-tab mode: keep multiple books open in tabs"
          >
            <Layers size={11} />
            <span className="hidden xl:inline">Tabs</span>
          </button>
          <button
            type="button"
            onClick={() => updateSetting('tabView', 'columns')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold transition cursor-pointer ${
              tabView === 'columns'
                ? 'bg-[var(--bg-card)] text-[var(--accent)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title="Columns mode: view open books side-by-side (Mūla / Aṭṭhakathā / Ṭīkā)"
          >
            <Columns size={11} />
            <span className="hidden xl:inline">Columns</span>
          </button>
        </div>
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
          className="fixed z-[9999] min-w-[175px] py-1 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-xl text-xs text-[var(--text-primary)] animate-fade-in select-none font-medium"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.bookCode !== 'ai_chat' && (
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] transition cursor-pointer flex items-center justify-between"
              onClick={() => {
                const tabItem = contextMenu.tab || openTabs[contextMenu.tabIndex];
                openAlongside(contextMenu.bookCode, {
                  targetChapterIdx: tabItem?.currentChapterIdx ?? null,
                  targetParaNum: tabItem?.lastParaNum ?? null,
                  sourceBookCode: activeBookCode,
                });
                setContextMenu(null);
              }}
            >
              <span>Open Alongside</span>
              <Columns size={12} className="opacity-70" />
            </button>
          )}

          <button
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] hover:text-[var(--accent)] transition cursor-pointer flex items-center justify-between"
            onClick={() => {
              const tabItem = contextMenu.tab || openTabs[contextMenu.tabIndex];
              const ch = (tabItem?.currentChapterIdx ?? 0) + 1;
              const p = tabItem?.lastParaNum;
              const url = `/book/${contextMenu.bookCode}/${ch}${p ? `#para${p}` : ''}`;
              if (typeof window !== 'undefined') {
                window.open(url, '_blank', 'noopener,noreferrer');
              }
              setContextMenu(null);
            }}
          >
            <span>Open in New Window</span>
            <ExternalLink size={12} className="opacity-70" />
          </button>

          <div className="my-1 border-t border-[var(--border-color)]" />

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
