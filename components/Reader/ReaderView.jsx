'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import WelcomeView from './WelcomeView';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';

import { transliterateHtml, convertPaliScript } from '../../services/transliterate';
import { smartScrollTo } from '../../services/scroll';

// Memoized Chapter Block with Pre-Buffering Intersection Observer
const ChapterBlock = memo(function ChapterBlock({
  chapter,
  html,
  isLoading,
  onVisible,
  paliScript = 'roman',
}) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (html || !sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onVisible(chapter.chapter_index);
        }
      },
      { rootMargin: '900px 0px' } // Pre-buffer 900px before scrolling into view
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [html, chapter.chapter_index, onVisible]);

  const displayHtml = React.useMemo(() => {
    if (!html) return null;
    if (paliScript && paliScript !== 'roman') {
      return transliterateHtml(html, paliScript);
    }
    return html;
  }, [html, paliScript]);

  if (displayHtml) {
    return <div dangerouslySetInnerHTML={{ __html: displayHtml }} />;
  }

  return (
    <div
      ref={sentinelRef}
      id={`chap-${chapter.chapter_index}`}
      data-chapter={chapter.chapter_index}
      className="chapter-placeholder py-8 px-4 my-6 border border-dashed border-[var(--border-color)] rounded-xl flex flex-col items-center justify-center gap-2 bg-[var(--bg-secondary)]/40 select-none"
    >
      <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)] text-center">
        {convertPaliScript(chapter.title, paliScript)}
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-1">
          <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span>Buffering text...</span>
        </div>
      ) : (
        <button
          className="text-xs px-3 py-1 mt-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer"
          onClick={() => onVisible(chapter.chapter_index)}
        >
          Load Section
        </button>
      )}
    </div>
  );
});


export default function ReaderView() {
  const {
    activeTab,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    getSavedScroll,
    targetScrollIntent,
    clearTargetScrollIntent,
    setIsSidebarOpen,
    isSidebarOpen,
    setIsHeaderVisible,
    addBookmark,
    removeBookmark,
    isBookmarked,
    bookmarks,
    activeParaNum,
    setActiveParaNum,
    activeEditionPages,
    setActiveEditionPages,
    openGoToModal,
  } = useTabs();


  const { settings, setIsZenMode } = useThemeSettings();
  const containerRef = useRef(null);
  const contentHeaderRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  const prevBookCodeRef = useRef(null);

  // Synchronously restore scroll position BEFORE browser paint (Zero jumping / bouncing!)
  useLayoutEffect(() => {
    if (!containerRef.current || !activeTab) return;

    if (prevBookCodeRef.current !== activeTab.bookCode) {
      prevBookCodeRef.current = activeTab.bookCode;

      if (!targetScrollIntent) {
        const savedScroll = getSavedScroll(activeTab.bookCode);
        // Instant synchronous scroll (no smooth animation)
        containerRef.current.scrollTop = savedScroll;
      }
    }
  }, [activeTab?.bookCode, getSavedScroll, targetScrollIntent]);

  // Handle Target Scroll Intent (Chapter jumping, Search jumping, Book TOC jumping, MAT jumping)
  useEffect(() => {
    if (!targetScrollIntent || !containerRef.current || !activeTab) return;

    const { chapterIdx, paraIndex, paraNum, page, pageSystem } = targetScrollIntent;

    if (chapterIdx !== undefined && chapterIdx !== null) {
      if (!activeTab.loadedChapters?.[chapterIdx]) {
        loadChapter(activeTab.bookCode, chapterIdx);
      }
      bufferAdjacentChapters(activeTab.bookCode, chapterIdx);
    }

    let retries = 0;
    const maxRetries = 40; // Check every 60ms for up to 2.4 seconds

    let timerId = null;

    // Safe DOM element finder by ID or data attributes (prevents selector SyntaxError on IDs with dots e.g. V3.0440)
    const findElement = (id, fallbackSelector = '') => {
      if (!containerRef.current) return null;
      if (id) {
        const byId = document.getElementById(id);
        if (byId && containerRef.current.contains(byId)) return byId;
        try {
          const escaped = containerRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
          if (escaped) return escaped;
        } catch (_) {}
      }
      if (fallbackSelector) {
        try {
          return containerRef.current.querySelector(fallbackSelector);
        } catch (_) {}
      }
      return null;
    };

    const attemptScroll = () => {
      if (!containerRef.current) return;

      // 1. Target page break
      if (page && pageSystem) {
        const cleanP = String(page).trim();
        const ed = String(pageSystem).toUpperCase();
        let pbEl = null;

        // Direct ID lookup (e.g. V0.0023, P3.0045, V3.0440, V1.0023)
        if (cleanP.includes('.')) {
          const parts = cleanP.split('.');
          const vol = parseInt(parts[0], 10);
          const num = parseInt(parts[1], 10);
          if (!isNaN(vol) && !isNaN(num)) {
            const padded = `${vol}.${String(num).padStart(4, '0')}`;
            pbEl =
              findElement(`${ed}${padded}`) ||
              findElement(`${ed}${cleanP}`) ||
              findElement(null, `[data-ed="${ed}"][data-page="${padded}"]`) ||
              findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]`);
          }
        } else {
          const num = parseInt(cleanP, 10);
          if (!isNaN(num)) {
            const paddedNum = String(num).padStart(4, '0');
            const knownAnchor =
              activeTab?.page_anchors?.[ed]?.[cleanP] || activeTab?.page_anchors?.[ed]?.[String(num)];
            if (knownAnchor) {
              pbEl = findElement(knownAnchor);
            }
            if (!pbEl) {
              pbEl =
                findElement(null, `[data-ed="${ed}"][data-page$=".${paddedNum}"]`) ||
                findElement(null, `[data-ed="${ed}"][data-page="${paddedNum}"]`) ||
                findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]`);
            }
          }
        }

        if (pbEl) {
          // If pbEl is hidden by CSS (e.g. showPageBreaks is false), resolve to its enclosing paragraph
          const targetEl =
            pbEl.getClientRects().length > 0
              ? pbEl
              : pbEl.closest('p') || pbEl.parentElement || pbEl;

          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = targetEl.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          if (settings.pulseAnimation) {
            targetEl.classList.remove('pulse-highlight');
            void targetEl.offsetWidth;
            targetEl.classList.add('pulse-highlight');
          }
          const foundPNum = targetEl.getAttribute?.('data-para') || pbEl.getAttribute?.('data-para');
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }

      // 2. Target paragraph by index
      if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
        const el =
          findElement(`pindex-${paraIndex}`) ||
          findElement(null, `p[data-pindex="${paraIndex}"]`) ||
          findElement(null, `[data-pindex="${paraIndex}"]`);
        if (el) {
          const targetEl =
            el.getClientRects().length > 0
              ? el
              : el.closest('p') || el.parentElement || el;

          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = targetEl.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          if (settings.pulseAnimation) {
            targetEl.classList.remove('pulse-highlight');
            void targetEl.offsetWidth;
            targetEl.classList.add('pulse-highlight');
          }
          const foundPNum = targetEl.getAttribute?.('data-para');
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }

      // 3. Target paragraph by number
      if (paraNum) {
        const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
        const targetInt = parseInt(cleanPara, 10);

        let el =
          findElement(`para${cleanPara}`) ||
          findElement(`para-${cleanPara}`) ||
          findElement(cleanPara) ||
          findElement(null, `p[data-para="${cleanPara}"]`) ||
          findElement(null, `[data-para="${cleanPara}"]`);

        // Check ranged paragraph elements (data-para-first <= targetInt <= data-para-last)
        if (!el && !isNaN(targetInt)) {
          const rangedParas = containerRef.current.querySelectorAll('[data-para-first]');
          for (const p of rangedParas) {
            const first = parseInt(p.getAttribute('data-para-first'), 10);
            const last = parseInt(p.getAttribute('data-para-last'), 10);
            if (!isNaN(first) && !isNaN(last) && targetInt >= first && targetInt <= last) {
              el = p;
              break;
            }
          }
        }

        // Fallback: nearest paragraph <= targetInt
        if (!el && !isNaN(targetInt)) {
          const allParas = containerRef.current.querySelectorAll('[data-para]');
          let bestEl = null;
          let bestDiff = Infinity;
          for (const p of allParas) {
            const pNum = parseInt(p.getAttribute('data-para'), 10);
            if (!isNaN(pNum) && pNum <= targetInt) {
              const diff = targetInt - pNum;
              if (diff < bestDiff) {
                bestDiff = diff;
                bestEl = p;
              }
            }
          }
          if (bestEl) el = bestEl;
        }

        if (el) {
          const targetEl =
            el.getClientRects().length > 0
              ? el
              : el.closest('p') || el.parentElement || el;

          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = targetEl.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          if (settings.pulseAnimation) {
            targetEl.classList.remove('pulse-highlight');
            void targetEl.offsetWidth;
            targetEl.classList.add('pulse-highlight');
          }
          const foundPNum = targetEl.getAttribute?.('data-para') || cleanPara;
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }




      // 4. Target chapter
      if (chapterIdx !== undefined && chapterIdx !== null && !paraNum && paraIndex === undefined && !page) {
        if (chapterIdx === 0) {
          smartScrollTo(containerRef.current, 0, { scrollMotion: settings?.scrollMotion || 'fast' });
          saveTabScroll(activeTab.bookCode, 0);
          const firstP = containerRef.current.querySelector('[data-para]');
          if (firstP) {
            const pNum = firstP.getAttribute('data-para');
            if (pNum) setActiveParaNum(pNum);
          }
          clearTargetScrollIntent();
          return;
        }

        const target =
          containerRef.current.querySelector(`#chap-${chapterIdx}`) ||
          containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`);

        if (target) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          if (settings.pulseAnimation) {
            target.classList.remove('pulse-highlight');
            void target.offsetWidth;
            target.classList.add('pulse-highlight');
          }

          // Detect first paragraph in the chapter
          let nextEl = target.nextElementSibling;
          while (nextEl) {
            if (nextEl.hasAttribute && nextEl.hasAttribute('data-para')) {
              const pNum = nextEl.getAttribute('data-para');
              if (pNum) {
                setActiveParaNum(pNum);
                break;
              }
            }
            const innerP = nextEl.querySelector ? nextEl.querySelector('[data-para]') : null;
            if (innerP) {
              const pNum = innerP.getAttribute('data-para');
              if (pNum) {
                setActiveParaNum(pNum);
                break;
              }
            }
            nextEl = nextEl.nextElementSibling;
          }

          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }



      retries++;
      if (retries < maxRetries) {
        timerId = setTimeout(attemptScroll, 60);
      } else {
        clearTargetScrollIntent();
      }
    };

    timerId = setTimeout(attemptScroll, 40);
    return () => clearTimeout(timerId);
  }, [
    targetScrollIntent,
    activeTab,
    settings.pulseAnimation,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    clearTargetScrollIntent,
    setActiveParaNum,
  ]);


  // Detect active edition page numbers across loaded chapters
  const detectActiveEditionPages = useCallback(() => {
    if (!containerRef.current || !activeTab) return;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + 80;

    const pbElements = container.querySelectorAll('span.pb[data-ed][data-page]');
    if (pbElements.length === 0) return;

    const pages = {};
    const firstSeen = {};

    for (const pb of pbElements) {
      const ed = pb.getAttribute('data-ed');
      const page = pb.getAttribute('data-page');
      if (!firstSeen[ed]) {
        firstSeen[ed] = page;
      }
      const rect = pb.getBoundingClientRect();
      if (rect.top <= targetY) {
        pages[ed] = page;
      }
    }

    for (const [ed, firstPage] of Object.entries(firstSeen)) {
      if (!pages[ed]) {
        pages[ed] = firstPage;
      }
    }

    if (Object.keys(pages).length > 0) {
      setActiveEditionPages((prev) => {
        const isDiff =
          Object.keys(pages).some((k) => prev[k] !== pages[k]) ||
          Object.keys(prev).some((k) => prev[k] !== pages[k]);
        return isDiff ? pages : prev;
      });
    }
  }, [activeTab, setActiveEditionPages]);

  // Initial and chapter content change detection
  useEffect(() => {
    const timer = setTimeout(() => {
      detectActiveEditionPages();
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab?.bookCode, activeTab?.loadedChapters, detectActiveEditionPages]);

  // Direct fast scroll listener
  const handleScroll = useCallback(
    (e) => {
      const top = e.target.scrollTop;
      const delta = top - lastScrollTopRef.current;
      lastScrollTopRef.current = top;

      // When navigation tree is closed: hide header on scroll down, restore on scroll up
      if (!isSidebarOpen) {
        if (top <= 30) {
          setIsHeaderVisible(true);
        } else if (delta > 6 && top > 60) {
          setIsHeaderVisible(false);
        } else if (delta < -6) {
          setIsHeaderVisible(true);
        }
      }

      if (contentHeaderRef.current) {
        contentHeaderRef.current.classList.remove('hidden-scroll');
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        if (activeTab && containerRef.current) {
          saveTabScroll(activeTab.bookCode, top);

          // Detect active paragraph in reading viewport
          const container = containerRef.current;
          const containerRect = container.getBoundingClientRect();
          const targetY = containerRect.top + 80;

          const paraElements = container.querySelectorAll('p[data-pindex]');
          let foundParaNum = null;

          for (const p of paraElements) {
            const rect = p.getBoundingClientRect();
            if (rect.bottom >= targetY) {
              const paraNum = p.getAttribute('data-para');
              if (paraNum) {
                foundParaNum = paraNum;
                break;
              }
              let prev = p.previousElementSibling;
              while (prev) {
                const prevNum = prev.getAttribute('data-para');
                if (prevNum) {
                  foundParaNum = prevNum;
                  break;
                }
                prev = prev.previousElementSibling;
              }
              break;
            }
          }

          if (foundParaNum) {
            setActiveParaNum(foundParaNum);
          }

          detectActiveEditionPages();
        }
      }, 100);
    },
    [activeTab, saveTabScroll, setIsZenMode, setActiveParaNum, detectActiveEditionPages, isSidebarOpen, setIsHeaderVisible]
  );

  const handleReaderClick = useCallback((e) => {
    const pEl = e.target.closest('p[data-pindex]');
    if (pEl) {
      let pNum = pEl.getAttribute('data-para');
      if (!pNum) {
        let prev = pEl.previousElementSibling;
        while (prev) {
          pNum = prev.getAttribute('data-para');
          if (pNum) break;
          prev = prev.previousElementSibling;
        }
      }
      if (pNum) {
        setActiveParaNum(pNum);
      }
    }
  }, [setActiveParaNum]);



  const handleBreadcrumbClick = () => {
    document.body.classList.remove('zen-mode');
    setIsSidebarOpen(true);
    if (contentHeaderRef.current) {
      contentHeaderRef.current.classList.remove('hidden-scroll');
    }
  };

  const handleChapterVisible = useCallback(
    (chapIdx) => {
      if (!activeTab) return;
      loadChapter(activeTab.bookCode, chapIdx);
      bufferAdjacentChapters(activeTab.bookCode, chapIdx);
    },
    [activeTab, loadChapter, bufferAdjacentChapters]
  );

  const editionStatsList = React.useMemo(() => {
    if (!activeEditionPages || Object.keys(activeEditionPages).length === 0) return [];
    const EDITION_LABELS = {
      M: 'Myanmar',
      V: 'VRI',
      P: 'PTS',
      T: 'Thai',
      O: 'Other',
    };
    return ['M', 'V', 'P', 'T', 'O']
      .filter((ed) => activeEditionPages[ed])
      .map((ed) => {
        const rawPage = String(activeEditionPages[ed]);
        let formatted = rawPage;
        if (rawPage.includes('.')) {
          const parts = rawPage.split('.');
          const vol = parseInt(parts[0], 10);
          const pNum = parseInt(parts[1], 10);
          if (!isNaN(vol) && !isNaN(pNum)) {
            formatted = vol === 0 ? String(pNum) : `${vol}.${pNum}`;
          }
        }
        return {
          ed,
          page: formatted,
          label: EDITION_LABELS[ed] || ed,
        };
      });
  }, [activeEditionPages]);

  const handleQuickBookmark = () => {
    if (!activeTab) return;
    const currentChapIdx = activeTab.currentChapterIdx || 0;
    const currentChap = activeTab.chapters?.[currentChapIdx];

    addBookmark({
      bookCode: activeTab.bookCode,
      bookTitle: activeTab.title,
      nikaya: activeTab.nikaya,
      chapterIdx: currentChapIdx,
      chapterTitle: currentChap?.title || '',
      paraIndex: currentChap?.para_index || 0,
      snippet: `${activeTab.title} — ${currentChap?.title || `Chapter ${currentChapIdx + 1}`}`,
    });
  };

  if (!activeTab) {
    return (
      <main className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]">
        <WelcomeView />
      </main>
    );
  }

  const currentChap = activeTab.chapters?.[activeTab.currentChapterIdx || 0];
  const isCurrentBookmarked = bookmarks.some(
    (b) => b.bookCode === activeTab.bookCode && b.chapterIdx === (activeTab.currentChapterIdx || 0)
  );

  return (
    <main
      className="content-area flex-1 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Dynamic Auto-Hiding Breadcrumbs Bar */}
      <div
        ref={contentHeaderRef}
        className="content-header sticky top-0 z-30 transition-all duration-200 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] text-xs select-none"
      >
        <div
          className="breadcrumbs truncate text-xs flex-1 cursor-pointer flex items-center gap-1.5"
          onClick={handleBreadcrumbClick}
          title="Click to reveal full navigation and sidebar"
        >
          <span>{convertPaliScript('Tipiṭaka', settings?.paliScript)}</span>
          <span className="opacity-40">›</span>
          <span className="truncate opacity-75">{convertPaliScript(activeTab.nikaya || activeTab.category || '', settings?.paliScript)}</span>
          <span className="opacity-40">›</span>
          <span className="current truncate font-semibold text-[var(--accent)]">{convertPaliScript(activeTab.title, settings?.paliScript)}</span>
          {currentChap && currentChap.title !== activeTab.title && (
            <>
              <span className="opacity-40">›</span>
              <span className="truncate text-[var(--text-muted)]">{convertPaliScript(currentChap.title, settings?.paliScript)}</span>
            </>
          )}
        </div>

        {/* Right Controls: Live Edition Page Stats + Quick Bookmark */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Subtle Live Page Statistics for all editions */}
          {editionStatsList.length > 0 && (
            <div
              onClick={() => openGoToModal('page', null)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border-color)]/60 hover:border-[var(--border-color)] transition cursor-pointer shrink-0 select-none font-mono"
              title="Current Reading Page across Editions • Click to Go to Page"
            >
              <span className="text-[9px] sm:text-[9.5px] font-sans font-semibold uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                Page:
              </span>
              <div className="flex items-center gap-1">
                {editionStatsList.map(({ ed, page, label }, idx) => (
                  <React.Fragment key={ed}>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        openGoToModal('page', ed);
                      }}
                      className="inline-flex items-center gap-0.5 hover:text-[var(--accent)] hover:underline transition"
                      title={`${label}: Page ${page}`}
                    >
                      <strong className="font-semibold text-[var(--text-secondary)]">{ed}</strong>
                      <span className="opacity-90">{page}</span>
                    </span>
                    {idx < editionStatsList.length - 1 && (
                      <span className="opacity-30 text-[8px]">•</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Quick Bookmark Button in Breadcrumb Header */}
          <button
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition shrink-0 cursor-pointer"
            onClick={handleQuickBookmark}
            title={isCurrentBookmarked ? 'Bookmarked' : 'Bookmark this chapter'}
          >
            {isCurrentBookmarked ? (
              <BookmarkCheck size={14} className="text-[var(--accent)]" />
            ) : (
              <Bookmark size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Lazy-Loaded Chapter Content Stream */}
      <div className="reader-wrapper flex-1 flex justify-center px-3 sm:px-6" onClick={handleReaderClick}>
        <div
          className="reader-container w-full"
          style={{ maxWidth: 'var(--reader-max-width, 880px)' }}
        >

          {activeTab.chapters && activeTab.chapters.length > 0 ? (
            activeTab.chapters.map((chap) => (
              <ChapterBlock
                key={chap.chapter_index}
                chapter={chap}
                html={activeTab.loadedChapters?.[chap.chapter_index]}
                isLoading={Boolean(activeTab.loadingChapters?.[chap.chapter_index])}
                onVisible={handleChapterVisible}
                paliScript={settings.paliScript}
              />
            ))
          ) : (
            <div dangerouslySetInnerHTML={{ __html: activeTab.html }} />
          )}
        </div>
      </div>
    </main>
  );
}
