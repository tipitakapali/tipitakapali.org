'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react';
import { Minimize2 } from 'lucide-react';

import Header from '../components/Header';
import BookTabsBar from '../components/BookTabsBar';
import NavigationTree from '../components/NavigationTree/NavigationTree';
import ReaderView from '../components/Reader/ReaderView';
import Footer from '../components/Footer';
import SearchModal from '../components/Search/SearchModal';
import SettingsModal from '../components/Settings/SettingsModal';
import DictionaryModal from '../components/DictionaryModal';
import NotFound from './not-found';
import { useTabs, normalizeLangCode } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';
export function MainAppContent({ params: rawParams }) {
  const params = rawParams && typeof rawParams.then === 'function' ? React.use(rawParams) : rawParams;
  const { openBook, openAiChatTab, openSearchModal, updateUrlParams, activeTab, activeBookCode, isSidebarOpen, isHeaderVisible, setIsSidebarOpen, setIsHeaderVisible, isNotFound } = useTabs();
  const { settings, isZenMode, setIsZenMode } = useThemeSettings();
  const hasInitializedRef = useRef(false);

  const isEkaActive = isZenMode;




  const { pageTitle, pageDesc } = useMemo(() => {
    if (isNotFound) {
      return {
        pageTitle: 'Lost in Saṃsāra (404) | Tipiṭaka Pāḷi',
        pageDesc: 'The page you seek has wandered — like all conditioned things, it is anicca, impermanent.',
      };
    }

    if (activeTab?.type === 'ai_chat' || activeTab?.bookCode === 'ai_chat') {
      return {
        pageTitle: 'Ani Assistant | Tipiṭaka Pāḷi',
        pageDesc: 'AI-powered Dhamma study companion for the Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon.',
      };
    }

    if (!activeTab) {
      return {
        pageTitle: convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', settings?.paliScript),
        pageDesc: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
      };
    }

    const currentChapIdx = activeTab.currentChapterIdx || 0;
    const currentChap = activeTab.chapters?.[currentChapIdx];

    const bookTitle = convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript);
    const chapTitle = currentChap?.title ? convertPaliScript(capitalizePali(currentChap.title), settings?.paliScript) : '';
    const nikaya = activeTab.nikaya ? convertPaliScript(capitalizePali(activeTab.nikaya), settings?.paliScript) : '';

    const tipitakaLabel = convertPaliScript('Tipiṭaka Pāḷi', settings?.paliScript);
    const fullAppTitle = convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', settings?.paliScript);

    let docTitle = '';
    let subject = '';

    if (chapTitle && chapTitle !== bookTitle) {
      subject = `${bookTitle} › ${chapTitle}`;
      docTitle = `${subject} | ${tipitakaLabel}`;
    } else if (nikaya && nikaya !== bookTitle) {
      subject = `${bookTitle} (${nikaya})`;
      docTitle = `${subject} | ${tipitakaLabel}`;
    } else {
      subject = bookTitle;
      docTitle = `${bookTitle} | ${fullAppTitle}`;
    }

    return {
      pageTitle: docTitle,
      pageDesc: `Complete ${subject} with rich typography, multi-script support, and full-text search.`,
    };
  }, [
    isNotFound,
    activeTab,
    activeTab?.bookCode,
    activeTab?.title,
    activeTab?.currentChapterIdx,
    activeTab?.chapters,
    activeTab?.nikaya,
    settings?.paliScript,
  ]);

  // Dynamic Browser, Search & SEO friendly Title & Meta Synchronizer
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const setMetaDesc = (content) => {
      let el = document.querySelector('meta[name="description"]');
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', 'description');
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);

      // Also sync OpenGraph description if present
      const ogEl = document.querySelector('meta[property="og:description"]');
      if (ogEl) ogEl.setAttribute('content', content);
    };

    document.title = pageTitle;
    setMetaDesc(pageDesc);

    // Re-assert title after React 19 / Next.js layout metadata reconciliation pass
    const timer = setTimeout(() => {
      if (document.title !== pageTitle) {
        document.title = pageTitle;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [pageTitle, pageDesc]);

  // Listen for dynamic hash navigation (e.g. user changes URL hash or clicks an anchor link)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
      if (!hash) return;
      const numMatch = hash.match(/^(?:para-?|p)?(\d+)$/i);
      if (numMatch && activeBookCode) {
        openBook(activeBookCode, { targetParaNum: numMatch[1] });
      } else if (hash.startsWith('pindex-') && activeBookCode) {
        const pindex = parseInt(hash.replace('pindex-', ''), 10);
        if (!isNaN(pindex)) {
          openBook(activeBookCode, { targetParaIndex: pindex });
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeBookCode, openBook]);

  // Read URL search parameters and route params strictly once on initial mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || urlParams.get('search');
    const rawLang = urlParams.get('l') || urlParams.get('lang') || urlParams.get('db');
    const normLang = rawLang ? normalizeLangCode(rawLang) : null;
    const cleanL = normLang && normLang !== 'pali' ? normLang : null;

    // Clean up legacy URL parameters: migrate ?db=... / ?lang=... into ?l=... or remove if pali
    if (
      urlParams.has('db') ||
      urlParams.has('lang') ||
      (urlParams.has('l') && urlParams.get('l') !== cleanL)
    ) {
      updateUrlParams({
        l: cleanL,
        db: null,
        lang: null,
      });
    }

    // Check pathname: e.g. /book/s0505m.mul, /book/s0201m.mul/2, /chapter/s0201m.mul1, /chapter/s0201m.mul/2
    const pathname = window.location.pathname;
    let pathBook = null;
    let pathChapter = null;

    if (pathname.startsWith('/book/') || pathname.startsWith('/chapter/')) {
      const rawPath = pathname.replace(/^\/(?:book|chapter)\//, '');
      const parts = rawPath.split('/');
      if (parts[0]) pathBook = decodeURIComponent(parts[0]);
      if (parts[1]) pathChapter = decodeURIComponent(parts[1]);

      if (pathBook) {
        const chapSuffixMatch = pathBook.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
        if (chapSuffixMatch) {
          pathBook = chapSuffixMatch[1];
          if (pathChapter === null || pathChapter === undefined) {
            // Suffix 0 -> index 0 (ch 1), Suffix 1 -> index 1 (ch 2), etc.
            pathChapter = parseInt(chapSuffixMatch[2], 10) + 1;
          }
        }
      }
    }

    if (params?.slug?.[0]) {
      const slug0 = decodeURIComponent(params.slug[0]);
      const chapSuffixMatch = slug0.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        if (!pathBook) pathBook = chapSuffixMatch[1];
        if (pathChapter === null || pathChapter === undefined) {
          pathChapter = parseInt(chapSuffixMatch[2], 10) + 1;
        }
      }
    }

    // Extract hash e.g. #para57, #para-57, #57, #pindex-134
    const hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
    let hashParaNum = null;
    let hashParaIndex = null;
    if (hash) {
      const numMatch = hash.match(/^(?:para-?|p)?(\d+)$/i);
      if (numMatch) {
        hashParaNum = numMatch[1];
      } else if (hash.startsWith('pindex-')) {
        hashParaIndex = parseInt(hash.replace('pindex-', ''), 10);
      }
    }

    const bookParam =
      pathBook ||
      params?.code ||
      params?.slug?.[0] ||
      urlParams.get('book') ||
      urlParams.get('book_code');

    const chapterParam =
      pathChapter ||
      params?.slug?.[1] ||
      urlParams.get('chapter') ||
      urlParams.get('c');

    const explicitParaNum =
      hashParaNum ||
      urlParams.get('para') ||
      urlParams.get('p') ||
      urlParams.get('paranum');

    const explicitParaIndex =
      hashParaIndex ||
      (urlParams.get('pindex') ? parseInt(urlParams.get('pindex'), 10) : undefined);

    const tabParam = urlParams.get('tab');
    if (tabParam === 'ai' || tabParam === 'ai_chat' || bookParam === 'ai_chat') {
      openAiChatTab();
      return;
    }

    if (query) {
      openSearchModal(query);
    } else if (bookParam) {
      let targetChapterIdx = undefined;
      if (chapterParam !== null && chapterParam !== undefined) {
        const parsed = parseInt(chapterParam, 10);
        targetChapterIdx = Math.max(0, parsed > 0 ? parsed - 1 : 0);
      }

      openBook(bookParam, {
        targetChapterIdx,
        targetParaNum: explicitParaNum,
        targetParaIndex: explicitParaIndex,
        lang: cleanL || undefined,
        l: cleanL || undefined,
      });
    }
  }, [openBook, openAiChatTab, openSearchModal, updateUrlParams, params]);

  // Full exit Eka mode handler — restores app header, book tabs bar, breadcrumbs, and footer (leaves sidebar as-is)
  const handleExitZen = useCallback(() => {
    setIsZenMode(false);
    setIsHeaderVisible(true);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('zen-mode');
    }
  }, [setIsZenMode, setIsHeaderVisible]);

  // Keyboard shortcut to exit Eka mode
  useEffect(() => {
    if (!isEkaActive) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleExitZen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEkaActive, handleExitZen]);

  // Red alert + halo on the exit button when Eka mode is entered.
  // Restores to the normal calm button after 3 seconds.
  const [ekaAlert, setEkaAlert] = useState(false);
  useEffect(() => {
    if (!isEkaActive) return;
    setEkaAlert(true);
    const t = setTimeout(() => setEkaAlert(false), 3000);
    return () => clearTimeout(t);
  }, [isEkaActive]);

  if (isNotFound) {
    return <NotFound />;
  }

  return (
    <div className="h-screen h-[100dvh] w-full max-w-full flex flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <title>{pageTitle}</title>
      <Header />
      <div className="flex flex-1 min-h-0 overflow-hidden relative w-full max-w-full">
        <NavigationTree />
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden w-full max-w-full" style={{ order: 10 }}>
          <BookTabsBar />
          <div className="app-body flex-1 min-h-0 flex overflow-hidden relative w-full max-w-full">
            <ReaderView />
            {/* Floating Exit Eka Mode Button - Aligned near the text reading column */}
            {isEkaActive && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 sm:px-6 z-40">
                <div
                  className="w-full flex justify-end pointer-events-none"
                  style={{ maxWidth: 'var(--reader-max-width, 880px)' }}
                >
                  <span className="relative inline-flex pointer-events-none">
                    {ekaAlert && (
                      <>
                        <span aria-hidden="true" className="eka-halo" />
                        <span aria-hidden="true" className="eka-ping" />
                        <span aria-hidden="true" className="eka-ping" style={{ animationDelay: '0.5s' }} />
                        <span aria-hidden="true" className="eka-ping" style={{ animationDelay: '1s' }} />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleExitZen}
                      className={`pointer-events-auto w-9 h-9 rounded-full backdrop-blur-md border flex items-center justify-center cursor-pointer select-none group mr-1 sm:mr-0 transition-all ${
                        ekaAlert
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-white opacity-100 shadow-[0_0_36px_color-mix(in_srgb,var(--accent)_75%,transparent)] scale-125'
                          : 'bg-[var(--bg-card)]/90 hover:bg-[var(--accent)] hover:text-white hover:border-[var(--accent)] border-[var(--border-color)] text-[var(--accent)] shadow-xl hover:shadow-2xl hover:scale-110 active:scale-95 opacity-80 hover:opacity-100'
                      }`}
                      title="Exit Eka Mode (Esc)"
                      aria-label="Exit Eka Mode"
                    >
                      <Minimize2 size={ekaAlert ? 20 : 16} className="group-hover:rotate-90 transition-transform duration-300" />
                    </button>
                  </span>
                </div>
                <style>{`
                  .eka-halo {
                    position: absolute;
                    inset: -28px;
                    border-radius: 9999px;
                    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 34%, transparent) 0%, color-mix(in srgb, var(--accent) 14%, transparent) 55%, transparent 74%);
                    pointer-events: none;
                    animation: ekaHalo 1.5s ease-in-out infinite;
                  }
                  @keyframes ekaHalo {
                    0%, 100% { opacity: 0.65; transform: scale(1); }
                    50% { opacity: 1; transform: scale(1.1); }
                  }
                  .eka-ping {
                    position: absolute;
                    inset: -8px;
                    border-radius: 9999px;
                    border: 4px solid color-mix(in srgb, var(--accent) 85%, transparent);
                    opacity: 0;
                    pointer-events: none;
                    animation: ekaPing 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
                  }
                  @keyframes ekaPing {
                    0% { transform: scale(1); opacity: 0.9; }
                    100% { transform: scale(4.5); opacity: 0; }
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .eka-halo, .eka-ping { animation: none !important; }
                    .eka-ping { display: none; }
                  }
                `}</style>
              </div>
            )}
          </div>
          <Footer />
        </div>
        <DictionaryModal />
      </div>


      <SearchModal />
      <SettingsModal />
    </div>
  );
}



export default function Home({ params }) {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">Loading Tipiṭaka...</div>}>
      <MainAppContent params={params} />
    </Suspense>
  );
}

