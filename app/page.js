'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react';

import Header from '../components/Header';
import BookTabsBar from '../components/BookTabsBar';
import NavigationTree from '../components/NavigationTree/NavigationTree';
import ReaderView from '../components/Reader/ReaderView';
import Footer from '../components/Footer';
import SearchModal from '../components/Search/SearchModal';
import SettingsModal from '../components/Settings/SettingsModal';
import DictionaryModal from '../components/DictionaryModal';
import TtsPlayer from '../components/Tts/TtsPlayer';
import BookmarkModal from '../components/BookmarkModal';
import HistoryModal from '../components/HistoryModal';
import NotFoundView from '../components/NotFoundView';
import { useTabs, normalizeLangCode } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali, splitScriptCode } from '../services/transliterate';
import { DEFAULT_SEO_TITLE, DEFAULT_SEO_DESCRIPTION, SITE_URL } from '../services/seoMetadata';
export function MainAppContent({ params: rawParams }) {
  const params = rawParams && typeof rawParams.then === 'function' ? React.use(rawParams) : rawParams;
  const { openBook, openAiChatTab, openSearchModal, updateUrlParams, openTabs, activeTab, activeBookCode, isSidebarOpen, isHeaderVisible, setIsSidebarOpen, setIsHeaderVisible, isNotFound, isBookmarkOpen, setIsBookmarkOpen, isHistoryOpen, setIsHistoryOpen } = useTabs();
  const { settings } = useThemeSettings();
  const hasInitializedRef = useRef(false);




  const { pageTitle, pageDesc, canonicalUrl } = useMemo(() => {
    if (isNotFound) {
      return {
        pageTitle: 'Lost in Saṃsāra (404) — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
        pageDesc: 'The requested page could not be found on TipitakaPali.org. Return to the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon.',
        canonicalUrl: null,
      };
    }

    if (activeTab?.type === 'ai_chat' || activeTab?.bookCode === 'ai_chat' || activeBookCode === 'ai_chat') {
      return {
        pageTitle: 'Ani (AI Nissaya) Study Companion | Tipiṭaka Pāḷi',
        pageDesc: 'AI-powered Dhamma research companion for the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon with concept-group search, bold definitions, and canonical citations.',
        canonicalUrl: `${SITE_URL}/`,
      };
    }

    if (!activeTab) {
      const isNonRoman = settings?.paliScript && settings.paliScript !== 'roman';
      return {
        pageTitle: isNonRoman
          ? `${convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', settings.paliScript)} — TipitakaPali.org`
          : DEFAULT_SEO_TITLE,
        pageDesc: DEFAULT_SEO_DESCRIPTION,
        canonicalUrl: `${SITE_URL}/`,
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

    const cleanCode = splitScriptCode(activeTab.bookCode || '').bookCode;

    return {
      pageTitle: docTitle,
      pageDesc: `Read ${subject} in original Pāḷi (17 scripts) with 23 modern translations, DPD dictionary, 387K+ bold definitions, and fast full-text search.`,
      canonicalUrl: cleanCode ? `${SITE_URL}/book/${cleanCode}` : `${SITE_URL}/`,
    };
  }, [
    isNotFound,
    activeTab,
    activeTab?.bookCode,
    activeTab?.title,
    activeTab?.currentChapterIdx,
    activeTab?.chapters,
    activeTab?.nikaya,
    activeBookCode,
    settings?.paliScript,
  ]);

  // Dynamic Browser, Search & SEO friendly Title, Meta & Canonical Synchronizer
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // On prerendered /book/* or /chapter/* routes, keep SSR metadata intact until activeTab loads
    const pathname = window.location?.pathname || '/';
    if (!activeTab && !isNotFound && (pathname.startsWith('/book/') || pathname.startsWith('/chapter/'))) {
      return;
    }

    const setMetaContent = (selector, attrName, attrVal, content) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const setCanonicalHref = (href) => {
      let link = document.querySelector('link[rel="canonical"]');
      if (!href) {
        if (link) link.remove();
        return;
      }
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', href);
    };

    document.title = pageTitle;
    setMetaContent('meta[name="description"]', 'name', 'description', pageDesc);
    setMetaContent('meta[property="og:title"]', 'property', 'og:title', pageTitle);
    setMetaContent('meta[property="og:description"]', 'property', 'og:description', pageDesc);
    if (isNotFound) {
      setMetaContent('meta[name="robots"]', 'name', 'robots', 'noindex, nofollow');
    }
    setCanonicalHref(canonicalUrl);

    // Re-assert title after Next.js layout metadata reconciliation passes
    const timers = [
      setTimeout(() => {
        if (document.title !== pageTitle) {
          document.title = pageTitle;
        }
      }, 100),
      setTimeout(() => {
        if (document.title !== pageTitle) {
          document.title = pageTitle;
        }
      }, 400),
    ];

    return () => timers.forEach(t => clearTimeout(t));
  }, [pageTitle, pageDesc, canonicalUrl, activeTab, isNotFound]);

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

    if (query && !bookParam) {
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
        highlightQuery: query || undefined,
        searchQuery: query || undefined,
        lang: cleanL || undefined,
        l: cleanL || undefined,
      });
    }
  }, [openBook, openAiChatTab, openSearchModal, updateUrlParams, params]);

  const isAiTab = activeTab?.type === 'ai_chat' || activeTab?.bookCode === 'ai_chat';
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const bookTabCount = useMemo(
    () => (openTabs || []).filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat').length,
    [openTabs]
  );
  const isColumnsActive =
    settings?.tabView === 'columns' && viewportWidth >= 900 && bookTabCount > 1 && !isAiTab;
  const useWindowScroll = !isNotFound && !isAiTab && !isColumnsActive && Boolean(activeTab?.bookCode);

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('window-scroll', useWindowScroll);
    document.body.classList.toggle('window-scroll', useWindowScroll);
    return () => {
      document.documentElement.classList.remove('window-scroll');
      document.body.classList.remove('window-scroll');
    };
  }, [useWindowScroll]);

  if (isNotFound) {
    return <NotFoundView />;
  }

  return (
    <div
      className={
        useWindowScroll
          ? 'min-h-screen min-h-[100dvh] w-full max-w-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]'
          : 'h-screen h-[100dvh] w-full max-w-full flex flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]'
      }
    >
      <Header />
      <div
        className={
          useWindowScroll
            ? 'app-main-flex flex flex-1 min-h-0 overflow-x-clip relative w-full max-w-full'
            : 'app-main-flex flex flex-1 min-h-0 overflow-hidden overflow-x-clip relative w-full max-w-full'
        }
        style={{ overflowX: 'clip' }}
      >
        <NavigationTree />
        <div
          className={
            useWindowScroll
              ? 'flex flex-col flex-1 min-w-0 w-full max-w-full'
              : 'flex flex-col flex-1 min-h-0 overflow-hidden w-full max-w-full'
          }
          style={{ order: 10 }}
        >
          <BookTabsBar />
          <div
            className={
              useWindowScroll
                ? 'app-body flex-1 flex relative w-full max-w-full'
                : 'app-body flex-1 min-h-0 flex overflow-hidden relative w-full max-w-full'
            }
          >
            <ReaderView />
          </div>
          {!isAiTab && activeTab?.bookCode && <Footer />}
        </div>
        <DictionaryModal />
      </div>


      <SearchModal />
      <SettingsModal />
      <TtsPlayer />
      <BookmarkModal isOpen={isBookmarkOpen} onClose={() => setIsBookmarkOpen(false)} />
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />
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

