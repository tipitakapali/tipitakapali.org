'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import Header from '../components/Header';
import BookTabsBar from '../components/BookTabsBar';
import NavigationTree from '../components/NavigationTree/NavigationTree';
import ReaderView from '../components/Reader/ReaderView';
import Footer from '../components/Footer';
import SearchModal from '../components/Search/SearchModal';
import SettingsModal from '../components/Settings/SettingsModal';
import DictionaryModal from '../components/DictionaryModal';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';

export function MainAppContent({ params: rawParams }) {
  const params = rawParams && typeof rawParams.then === 'function' ? React.use(rawParams) : rawParams;
  const { openBook, openSearchModal, activeTab, activeBookCode } = useTabs();
  const { settings } = useThemeSettings();
  const hasInitializedRef = useRef(false);


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

    if (!activeTab) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        const search = window.location.search;
        const hasUrlBook = path.startsWith('/book/') || path.startsWith('/chapter/') || search.includes('book=');
        if (hasUrlBook) {
          // A book is currently loading from URL params; keep server-rendered title
          return;
        }
      }
      document.title = convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', settings?.paliScript);
      setMetaDesc('Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.');
      return;
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

    // Clean, search & bookmark-friendly title format matching breadcrumbs
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

    document.title = docTitle;
    setMetaDesc(`Complete ${subject} with rich typography, multi-script support, and full-text search.`);
  }, [
    activeTab,
    activeTab?.bookCode,
    activeTab?.title,
    activeTab?.currentChapterIdx,
    activeTab?.chapters,
    activeTab?.nikaya,
    settings?.paliScript,
  ]);

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
      });
    }


  }, [openBook, openSearchModal, params]);

  return (
    <div className="h-screen h-[100dvh] w-full max-w-full flex flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header />
      <BookTabsBar />
      <div className="app-body flex-1 min-h-0 flex overflow-hidden relative w-full max-w-full">
        <NavigationTree />
        <ReaderView />
      </div>
      <Footer />
      <SearchModal />
      <SettingsModal />
      <DictionaryModal />
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

