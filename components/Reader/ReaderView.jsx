'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import WelcomeView from './WelcomeView';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';

import { transliterateHtml, convertPaliScript, highlightHtmlText, capitalizePali } from '../../services/transliterate';
import { smartScrollTo } from '../../services/scroll';

// Memoized Chapter Block with Pre-Buffering Intersection Observer
const ChapterBlock = memo(function ChapterBlock({
  chapter,
  html,
  isLoading,
  onVisible,
  paliScript = 'roman',
  searchHighlight = null,
  highlightSearchTerms = true,
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
    let processed = html;
    if (paliScript && paliScript !== 'roman') {
      processed = transliterateHtml(processed, paliScript);
    }
    if (highlightSearchTerms && searchHighlight?.query && searchHighlight.query.trim()) {
      processed = highlightHtmlText(
        processed,
        searchHighlight.query.trim(),
        paliScript,
        searchHighlight.paraIndex,
        searchHighlight.paraNum
      );
    }
    return processed;
  }, [html, paliScript, searchHighlight, highlightSearchTerms]);

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
        {convertPaliScript(capitalizePali(chapter.title), paliScript)}
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
    isHeaderVisible,
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
    addToHistory,
    saveTabPosition,
    searchHighlight,
  } = useTabs();


  const { settings, setIsZenMode } = useThemeSettings();
  const containerRef = useRef(null);
  const contentHeaderRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const scrollAccDeltaRef = useRef(0);
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

  // Handle Target Scroll Intent (Chapter jumping, Search jumping, Book TOC jumping, MAT jumping, Bookmarks, History)
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

      // 1. Target paragraph by number (Highest Priority for Bookmarks, History, MAT, and GoTo)
      if (paraNum) {
        const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
        const targetInt = parseInt(cleanPara, 10);

        // Ensure the chapter containing this paragraph is loaded
        if (activeTab.para_to_chapter && activeTab.para_to_chapter[cleanPara] !== undefined) {
          const chapForPara = activeTab.para_to_chapter[cleanPara];
          if (!activeTab.loadedChapters?.[chapForPara]) {
            loadChapter(activeTab.bookCode, chapForPara);
            bufferAdjacentChapters(activeTab.bookCode, chapForPara);
          }
        }

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
          const scope = (chapterIdx !== undefined && chapterIdx !== null)
            ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`) || containerRef.current
            : containerRef.current;
          const allParas = scope.querySelectorAll('[data-para]');
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

      // 2. Target page break
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

      // 3. Target paragraph by index (within chapter if given)
      if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
        const scope = (chapterIdx !== undefined && chapterIdx !== null)
          ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`) || containerRef.current
          : containerRef.current;
        const el =
          scope.querySelector(`[id="pindex-${paraIndex}"]`) ||
          scope.querySelector(`p[data-pindex="${paraIndex}"]`) ||
          scope.querySelector(`[data-pindex="${paraIndex}"]`) ||
          findElement(`pindex-${paraIndex}`);

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

      // 4. Target chapter header
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
      if (!ed || !page) continue;

      if (!firstSeen[ed]) {
        firstSeen[ed] = page;
      }

      // If span.pb is hidden with display:none (hide-pb setting), getBoundingClientRect() on pb returns 0.
      // Measuring the parent paragraph element gives the exact viewport position in both visible and hidden modes!
      const hostEl = pb.closest('p[data-pindex], .chapter-divider, p') || pb.parentElement || pb;
      const rect = hostEl.getBoundingClientRect();
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

  // Direct fast scroll listener with hysteresis to prevent shaking/blinking
  const handleScroll = useCallback(
    (e) => {
      const top = e.target.scrollTop;
      const delta = top - lastScrollTopRef.current;
      lastScrollTopRef.current = top;

      // When navigation tree is closed: smooth hysteresis directional auto-hide
      if (!isSidebarOpen) {
        if (top <= 40) {
          scrollAccDeltaRef.current = 0;
          setIsHeaderVisible(true);
        } else {
          // Accumulate delta in current scroll direction
          if ((delta > 0 && scrollAccDeltaRef.current < 0) || (delta < 0 && scrollAccDeltaRef.current > 0)) {
            scrollAccDeltaRef.current = delta;
          } else {
            scrollAccDeltaRef.current += delta;
          }

          if (scrollAccDeltaRef.current > 30 && top > 70) {
            setIsHeaderVisible(false);
          } else if (scrollAccDeltaRef.current < -25) {
            setIsHeaderVisible(true);
          }
        }
      } else {
        scrollAccDeltaRef.current = 0;
        setIsHeaderVisible(true);
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
          let foundPIndex = null;
          let foundSnippet = '';
          let foundChapterIdx = activeTab.currentChapterIdx || 0;

          for (const p of paraElements) {
            const rect = p.getBoundingClientRect();
            if (rect.bottom >= targetY) {
              foundPIndex = p.getAttribute('data-pindex');
              foundParaNum = p.getAttribute('data-para');
              if (!foundParaNum) {
                let prev = p.previousElementSibling;
                while (prev) {
                  const prevNum = prev.getAttribute('data-para');
                  if (prevNum) {
                    foundParaNum = prevNum;
                    break;
                  }
                  prev = prev.previousElementSibling;
                }
              }

              // Extract text snippet
              const text = p.textContent?.replace(/\s+/g, ' ').trim() || '';
              if (text) {
                foundSnippet = text.length > 130 ? text.slice(0, 130) + '...' : text;
              }

              // Detect chapter
              if (foundParaNum && activeTab.para_to_chapter?.[foundParaNum] !== undefined) {
                foundChapterIdx = activeTab.para_to_chapter[foundParaNum];
              } else {
                const chapBlock = p.closest('[data-chapter]');
                if (chapBlock) {
                  const cIdx = parseInt(chapBlock.getAttribute('data-chapter'), 10);
                  if (!isNaN(cIdx)) foundChapterIdx = cIdx;
                }
              }
              break;
            }
          }

          if (foundParaNum) {
            setActiveParaNum(foundParaNum);
          }

          // Continuously save tab reading position (chapter, paragraph, scroll offset)
          saveTabPosition(activeTab.bookCode, foundChapterIdx, foundParaNum, top);

          // Automatically record user's exact reading position into History
          addToHistory({
            bookCode: activeTab.bookCode,
            bookTitle: activeTab.title,
            nikaya: activeTab.nikaya,
            chapterIdx: foundChapterIdx,
            chapterTitle: activeTab.chapters?.[foundChapterIdx]?.title || '',
            paraNum: foundParaNum || undefined,
            paraIndex: foundPIndex ? parseInt(foundPIndex, 10) : undefined,
            snippet:
              foundSnippet ||
              `${activeTab.title} — ${activeTab.chapters?.[foundChapterIdx]?.title || `Chapter ${foundChapterIdx + 1}`}${
                foundParaNum ? ` (Para ${foundParaNum})` : ''
              }`,
          });

          detectActiveEditionPages();
        }
      }, 120);
    },
    [activeTab, saveTabScroll, saveTabPosition, setActiveParaNum, detectActiveEditionPages, isSidebarOpen, setIsHeaderVisible, addToHistory]
  );

  const handleReaderClick = useCallback((e) => {
    const pEl = e.target.closest('p[data-pindex]');
    if (pEl && activeTab) {
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
      const pIdx = pEl.getAttribute('data-pindex');
      let chapIdx = activeTab.currentChapterIdx || 0;
      if (pNum && activeTab.para_to_chapter?.[pNum] !== undefined) {
        chapIdx = activeTab.para_to_chapter[pNum];
      }
      const text = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
      const snip = text.length > 130 ? text.slice(0, 130) + '...' : text;

      saveTabPosition(activeTab.bookCode, chapIdx, pNum, containerRef.current?.scrollTop);

      addToHistory({
        bookCode: activeTab.bookCode,
        bookTitle: activeTab.title,
        nikaya: activeTab.nikaya,
        chapterIdx: chapIdx,
        chapterTitle: activeTab.chapters?.[chapIdx]?.title || '',
        paraNum: pNum || undefined,
        paraIndex: pIdx ? parseInt(pIdx, 10) : undefined,
        snippet: snip || `${activeTab.title} — ${activeTab.chapters?.[chapIdx]?.title || `Chapter ${chapIdx + 1}`}`,
      });
    }
  }, [activeTab, setActiveParaNum, saveTabPosition, addToHistory]);



  const handleBreadcrumbClick = () => {
    document.body.classList.remove('zen-mode');
    setIsSidebarOpen(true);
    setIsHeaderVisible(true);
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
    
    // Find current paragraph & snippet robustly
    let currentPara = activeParaNum;
    let currentChapIdx = activeTab.currentChapterIdx || 0;
    let paraSnippet = '';

    if (!currentPara && typeof document !== 'undefined' && containerRef.current) {
      const targetY = containerRef.current.getBoundingClientRect().top + 80;
      const paraElements = containerRef.current.querySelectorAll('p[data-pindex]');
      for (const p of paraElements) {
        const rect = p.getBoundingClientRect();
        if (rect.bottom >= targetY) {
          let pNum = p.getAttribute('data-para');
          if (!pNum) {
            let prev = p.previousElementSibling;
            while (prev) {
              pNum = prev.getAttribute('data-para');
              if (pNum) break;
              prev = prev.previousElementSibling;
            }
          }
          if (pNum) {
            currentPara = pNum;
            break;
          }
        }
      }
    }

    if (currentPara && activeTab.para_to_chapter?.[currentPara] !== undefined) {
      currentChapIdx = activeTab.para_to_chapter[currentPara];
    }

    const currentChap = activeTab.chapters?.[currentChapIdx];

    if (typeof document !== 'undefined' && currentPara) {
      const pEl =
        containerRef.current?.querySelector(`[data-para="${currentPara}"]`) ||
        document.querySelector(`[data-para="${currentPara}"]`);
      if (pEl) {
        paraSnippet = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (paraSnippet.length > 130) paraSnippet = paraSnippet.slice(0, 130) + '...';
      }
    }

    const isAlreadyBookmarked = bookmarks.some(
      (b) =>
        b.bookCode === activeTab.bookCode &&
        b.chapterIdx === currentChapIdx &&
        (currentPara ? String(b.paraNum) === String(currentPara) : true)
    );

    if (isAlreadyBookmarked) {
      const existing = bookmarks.find(
        (b) =>
          b.bookCode === activeTab.bookCode &&
          b.chapterIdx === currentChapIdx &&
          (currentPara ? String(b.paraNum) === String(currentPara) : true)
      );
      if (existing) removeBookmark(existing.id);
    } else {
      addBookmark({
        id: `${activeTab.bookCode}_${currentChapIdx}_${currentPara || '0'}`,
        bookCode: activeTab.bookCode,
        bookTitle: activeTab.title,
        nikaya: activeTab.nikaya,
        chapterIdx: currentChapIdx,
        chapterTitle: currentChap?.title || '',
        paraNum: currentPara || undefined,
        snippet:
          paraSnippet ||
          `${activeTab.title} — ${currentChap?.title || `Chapter ${currentChapIdx + 1}`}${
            currentPara ? ` (Para ${currentPara})` : ''
          }`,
      });
    }
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
    (b) =>
      b.bookCode === activeTab.bookCode &&
      b.chapterIdx === (activeTab.currentChapterIdx || 0) &&
      (activeParaNum ? String(b.paraNum) === String(activeParaNum) : true)
  );

  const isContentHeaderHidden = !isHeaderVisible && !isSidebarOpen;

  return (
    <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden bg-[var(--bg-primary)]">
      {/* Dynamic Auto-Hiding Breadcrumbs Bar (Outside of main scroll area to prevent jitter/shaking) */}
      <div
        ref={contentHeaderRef}
        className={`content-header z-30 transition-all duration-200 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] text-xs select-none shrink-0 ${
          isContentHeaderHidden ? 'hidden-scroll' : ''
        }`}
      >
        <div
          className="breadcrumbs truncate text-xs flex-1 cursor-pointer flex items-center gap-1.5"
          onClick={handleBreadcrumbClick}
          title="Click to reveal full navigation and sidebar"
        >
          {(activeTab.nikaya || activeTab.category) && (
            <>
              <span className="truncate opacity-75">{convertPaliScript(capitalizePali(activeTab.nikaya || activeTab.category), settings?.paliScript)}</span>
              <span className="opacity-40">›</span>
            </>
          )}
          <span className="current truncate font-semibold text-[var(--accent)]">{convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}</span>
          {currentChap && capitalizePali(currentChap.title) !== capitalizePali(activeTab.title) && (
            <>
              <span className="opacity-40">›</span>
              <span className="truncate text-[var(--text-muted)]">{convertPaliScript(capitalizePali(currentChap.title), settings?.paliScript)}</span>
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
            title={
              isCurrentBookmarked
                ? `Bookmarked${activeParaNum ? ` (Para ${activeParaNum})` : ''} — Click to remove`
                : `Bookmark this place${activeParaNum ? ` (Para ${activeParaNum})` : ''}`
            }
          >
            {isCurrentBookmarked ? (
              <BookmarkCheck size={14} className="text-[var(--accent)]" />
            ) : (
              <Bookmark size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Main Scrollable Reading Container */}
      <main
        className="content-area flex-1 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]"
        ref={containerRef}
        onScroll={handleScroll}
      >
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
                  paliScript={settings?.paliScript}
                  searchHighlight={searchHighlight}
                  highlightSearchTerms={settings?.highlightSearchTerms ?? true}
                />
              ))
            ) : (
              <div
                dangerouslySetInnerHTML={{
                  __html: (function () {
                    if (!activeTab.html) return '';
                    let processed = activeTab.html;
                    if (settings?.paliScript && settings.paliScript !== 'roman') {
                      processed = transliterateHtml(processed, settings.paliScript);
                    }
                    if ((settings?.highlightSearchTerms ?? true) && searchHighlight?.query && searchHighlight.query.trim()) {
                      processed = highlightHtmlText(
                        processed,
                        searchHighlight.query.trim(),
                        settings?.paliScript,
                        searchHighlight.paraIndex,
                        searchHighlight.paraNum
                      );
                    }
                    return processed;
                  })(),
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
