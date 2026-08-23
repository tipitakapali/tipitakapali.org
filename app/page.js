'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import Header from '../components/Header';
import BookTabsBar from '../components/BookTabsBar';
import NavigationTree from '../components/NavigationTree/NavigationTree';
import ReaderView from '../components/Reader/ReaderView';
import Footer from '../components/Footer';
import SearchModal from '../components/Search/SearchModal';
import SettingsModal from '../components/Settings/SettingsModal';
import FloatingMenuBtn from '../components/FloatingMenuBtn';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript } from '../services/transliterate';

function MainAppContent() {
  const { openBook, openSearchModal, activeTab } = useTabs();
  const { settings } = useThemeSettings();
  const hasInitializedRef = useRef(false);

  // Dynamic Browser, Search & SEO friendly Title Synchronizer
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!activeTab) {
      document.title = convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka', settings?.paliScript);
      return;
    }

    const currentChapIdx = activeTab.currentChapterIdx || 0;
    const currentChap = activeTab.chapters?.[currentChapIdx];

    const bookTitle = convertPaliScript(activeTab.title, settings?.paliScript);
    const chapTitle = currentChap?.title ? convertPaliScript(currentChap.title, settings?.paliScript) : '';
    const nikaya = activeTab.nikaya ? convertPaliScript(activeTab.nikaya, settings?.paliScript) : '';

    // Clean, search & bookmark-friendly title format matching breadcrumbs
    if (chapTitle && chapTitle !== bookTitle) {
      document.title = `${bookTitle} › ${chapTitle} | Tipiṭaka`;
    } else if (nikaya && nikaya !== bookTitle) {
      document.title = `${bookTitle} (${nikaya}) | Tipiṭaka`;
    } else {
      document.title = `${bookTitle} | Chaṭṭha Saṅgāyana Tipiṭaka`;
    }
  }, [
    activeTab?.bookCode,
    activeTab?.title,
    activeTab?.currentChapterIdx,
    activeTab?.chapters,
    activeTab?.nikaya,
    settings?.paliScript,
  ]);

  // Read URL search parameters strictly once on initial mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || params.get('search');
    const bookParam = params.get('book') || params.get('book_code');
    const chapterParam = params.get('chapter') || params.get('c');
    const paraParam = params.get('para') || params.get('p') || params.get('pindex');

    if (query) {
      openSearchModal(query);
    } else if (bookParam) {
      // 1-based index in URL (chapter=1 -> internal index 0)
      let targetChapterIdx = 0;
      if (chapterParam !== null && chapterParam !== undefined) {
        const parsed = parseInt(chapterParam, 10);
        targetChapterIdx = Math.max(0, parsed > 0 ? parsed - 1 : 0);
      }

      openBook(bookParam, {
        targetChapterIdx,
        targetParaIndex: paraParam ? parseInt(paraParam, 10) : undefined,
      });
    }
  }, [openBook, openSearchModal]);

  return (
    <div className="h-screen h-[100dvh] w-full max-w-full flex flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header />
      <BookTabsBar />
      <div className="app-body flex-1 flex overflow-hidden relative w-full max-w-full">
        <NavigationTree />
        <ReaderView />
      </div>
      <Footer />
      <SearchModal />
      <SettingsModal />
      <FloatingMenuBtn />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">Loading Tipiṭaka...</div>}>
      <MainAppContent />
    </Suspense>
  );
}
