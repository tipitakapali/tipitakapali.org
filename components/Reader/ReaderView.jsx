'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import WelcomeView from './WelcomeView';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';

import { transliterateHtml, convertPaliScript } from '../../services/transliterate';

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
    addBookmark,
    removeBookmark,
    bookmarks,
    activeParaNum,
    setActiveParaNum,
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

    const attemptScroll = () => {
      if (!containerRef.current) return;

      // 1. Target page break
      if (page && pageSystem) {
        const cleanP = String(page).trim();
        const pbEl =
          containerRef.current.querySelector(`span.pb[data-ed="${pageSystem}"][data-page="${cleanP}"]`) ||
          containerRef.current.querySelector(`span.pb[data-ed="${pageSystem}"][data-page*="${cleanP}"]`);
        if (pbEl) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = pbEl.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          containerRef.current.scrollTo({ top: offset, behavior: 'smooth' });

          if (settings.pulseAnimation) {
            pbEl.classList.remove('pulse-highlight');
            void pbEl.offsetWidth;
            pbEl.classList.add('pulse-highlight');
          }
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }

      // 2. Target paragraph by index
      if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
        const el =
          containerRef.current.querySelector(`#pindex-${paraIndex}`) ||
          containerRef.current.querySelector(`[data-pindex="${paraIndex}"]`);
        if (el) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = el.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          containerRef.current.scrollTo({ top: offset, behavior: 'smooth' });

          if (settings.pulseAnimation) {
            el.classList.remove('pulse-highlight');
            void el.offsetWidth;
            el.classList.add('pulse-highlight');
          }
          const foundPNum = el.getAttribute('data-para');
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }

      // 3. Target paragraph by number
      if (paraNum) {
        const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
        let el =
          containerRef.current.querySelector(`#para${cleanPara}`) ||
          containerRef.current.querySelector(`#para-${cleanPara}`) ||
          containerRef.current.querySelector(`[data-para="${cleanPara}"]`) ||
          containerRef.current.querySelector(`strong.paranum[id="para-${cleanPara}"]`) ||
          containerRef.current.querySelector(`[id="${paraNum}"]`);

        // If exact paragraph element not found yet, check nearest available <= cleanPara
        if (!el) {
          const targetInt = parseInt(cleanPara, 10);
          if (!isNaN(targetInt)) {
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
        }

        if (el) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = el.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          containerRef.current.scrollTo({ top: offset, behavior: 'smooth' });

          if (settings.pulseAnimation) {
            el.classList.remove('pulse-highlight');
            void el.offsetWidth;
            el.classList.add('pulse-highlight');
          }
          const foundPNum = el.getAttribute('data-para') || cleanPara;
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          clearTargetScrollIntent();
          return;
        }
      }

      // 4. Target chapter
      if (chapterIdx !== undefined && chapterIdx !== null && !paraNum && paraIndex === undefined && !page) {
        if (chapterIdx === 0) {
          containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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
          containerRef.current.scrollTo({ top: offset, behavior: 'smooth' });

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


  // Direct fast scroll listener
  const handleScroll = useCallback(
    (e) => {
      const top = e.target.scrollTop;
      const delta = top - lastScrollTopRef.current;
      lastScrollTopRef.current = top;

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
        }
      }, 100);
    },
    [activeTab, saveTabScroll, setIsZenMode, setActiveParaNum]
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
        className="content-header sticky top-0 z-30 transition-all duration-200 flex items-center justify-between"
      >
        <div
          className="breadcrumbs truncate text-xs flex-1 cursor-pointer"
          onClick={handleBreadcrumbClick}
          title="Click to reveal full navigation and header"
        >
          <span>{convertPaliScript('Tipiṭaka', settings?.paliScript)}</span>
          <span>›</span>
          <span className="truncate">{convertPaliScript(activeTab.nikaya || activeTab.category || '', settings?.paliScript)}</span>
          <span>›</span>
          <span className="current truncate font-semibold text-[var(--accent)]">{convertPaliScript(activeTab.title, settings?.paliScript)}</span>
          {currentChap && currentChap.title !== activeTab.title && (
            <>
              <span>›</span>
              <span className="truncate text-[var(--text-muted)]">{convertPaliScript(currentChap.title, settings?.paliScript)}</span>
            </>
          )}
        </div>

        {/* Quick Bookmark Button in Breadcrumb Header */}
        <button
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition shrink-0 ml-2 cursor-pointer"
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

      {/* Lazy-Loaded Chapter Content Stream */}
      <div className="reader-wrapper flex-1 flex justify-center px-3 sm:px-6" onClick={handleReaderClick}>
        <div className="reader-container max-w-[860px] w-full">

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
