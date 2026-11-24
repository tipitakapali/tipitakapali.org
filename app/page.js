'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useMemo, Suspense } from 'react';

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
import { parseClientRouteLocation } from '../services/clientRouteParser';
import {
  DEFAULT_SEO_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  SITE_URL,
  buildCanonicalPath,
  isValidTranslationLang,
  getTranslationLangMeta,
  getPaliScriptMeta,
} from '../services/seoMetadata';

export function MainAppContent({ params: rawParams, ssrContent = null, initialRoute = null }) {
  const params = rawParams && typeof rawParams.then === 'function' ? React.use(rawParams) : rawParams;
  const { openBook, openAiChatTab, openSearchModal, updateUrlParams, openTabs, activeTab, activeBookCode, isSidebarOpen, isHeaderVisible, setIsSidebarOpen, setIsHeaderVisible, isNotFound, isBookmarkOpen, setIsBookmarkOpen, isHistoryOpen, setIsHistoryOpen } = useTabs();
  const { settings } = useThemeSettings();
  const hasInitializedRef = useRef(false);

  const { pageTitle, pageDesc, canonicalUrl, preserveSsrMeta } = useMemo(() => {
    if (isNotFound) {
      return {
        pageTitle: 'Lost in Saṃsāra (404) — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
        pageDesc: 'The requested page could not be found on TipitakaPali.org. Return to the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon.',
        canonicalUrl: null,
        preserveSsrMeta: false,
      };
    }

    if (activeTab?.type === 'ai_chat' || activeTab?.bookCode === 'ai_chat' || activeBookCode === 'ai_chat') {
      return {
        pageTitle: 'Ani (AI Nissaya) Study Companion | Tipiṭaka Pāḷi',
        pageDesc: 'AI-powered Dhamma research companion for the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon with concept-group search, bold definitions, and canonical citations.',
        canonicalUrl: `${SITE_URL}/`,
        preserveSsrMeta: false,
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
        preserveSsrMeta: false,
      };
    }

    const cleanCode = splitScriptCode(activeTab.bookCode || '').bookCode;
    const isTocView = Boolean(activeTab.isTocView || activeTab.viewMode === 'toc');
    const currentChapIdx =
      !isTocView && typeof activeTab.currentChapterIdx === 'number' && activeTab.currentChapterIdx >= 0
        ? activeTab.currentChapterIdx
        : null;
    const currentChapNum = currentChapIdx !== null ? currentChapIdx + 1 : null;
    const currentChap = currentChapIdx !== null ? activeTab.chapters?.[currentChapIdx] : null;

    // Detect active route context (clean /translation/{lang}/..., /book/{script}., or ?l={lang})
    let routeTransLang = null;
    let routeScriptPrefix = null;
    if (typeof window !== 'undefined') {
      const p = window.location?.pathname || '/';
      if (p.startsWith('/translation/')) {
        const segs = p.replace(/^\/translation\//, '').split('/').filter(Boolean);
        if (segs[0] && isValidTranslationLang(segs[0])) {
          routeTransLang = segs[0];
        }
      } else if (p.startsWith('/book/')) {
        const segs = p.replace(/^\/book\//, '').split('/').filter(Boolean);
        if (segs[0]) {
          const sp = splitScriptCode(segs[0]);
          if (sp.prefix) routeScriptPrefix = sp.prefix;
        }
        const qL = new URLSearchParams(window.location?.search || '').get('l');
        if (qL && isValidTranslationLang(qL)) {
          routeTransLang = qL;
        }
      }
    } else if (initialRoute) {
      routeTransLang = initialRoute.translationLang || null;
      routeScriptPrefix = initialRoute.scriptPrefix || null;
    }

    const computedCanonicalPath = cleanCode
      ? buildCanonicalPath({
          bookCode: cleanCode,
          scriptPrefix: routeTransLang ? null : routeScriptPrefix,
          translationLang: routeTransLang,
          chapterNum: currentChapNum,
        })
      : '/';
    const computedCanonicalUrl = `${SITE_URL}${computedCanonicalPath}`;

    // When still viewing the exact SSR-rendered route, keep the server-rendered
    // SEO title, description, robots & canonical intact so JS hydration never drifts from initial SSR HTML.
    const sameAsInitialSsr = Boolean(
      initialRoute &&
        ((initialRoute.canonicalUrl && initialRoute.canonicalUrl === computedCanonicalUrl) ||
          (initialRoute.bookCode === cleanCode &&
            (initialRoute.chapterNum || null) === (currentChapNum || null) &&
            (initialRoute.translationLang || null) === (routeTransLang || null) &&
            (initialRoute.scriptPrefix || null) === (routeTransLang ? null : routeScriptPrefix || null)))
    );

    const activeScript = routeTransLang
      ? 'roman'
      : (getPaliScriptMeta(routeScriptPrefix)?.scriptId || settings?.paliScript || 'roman');

    const bookTitle = convertPaliScript(capitalizePali(activeTab.title), activeScript);
    const rawChapTitle = currentChap?.title
      ? String(currentChap.title).trim().replace(/^\d+\.\s*/, '').trim() || currentChap.title
      : '';
    const chapTitle = rawChapTitle ? convertPaliScript(capitalizePali(rawChapTitle), activeScript) : '';
    const nikaya = activeTab.nikaya ? convertPaliScript(capitalizePali(activeTab.nikaya), activeScript) : '';
    const langMeta = routeTransLang ? getTranslationLangMeta(routeTransLang) : null;
    const langSuffix = langMeta
      ? (langMeta.code === 'en' ? ' — English Translation' : ` — ${langMeta.native} (${langMeta.name})`)
      : '';

    const tipitakaLabel = convertPaliScript('Tipiṭaka Pāḷi', activeScript);
    const fullAppTitle = convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', activeScript);

    let docTitle = '';
    let subject = '';

    if (chapTitle && chapTitle !== bookTitle) {
      subject = `Ch. ${currentChapNum}: ${chapTitle} — ${bookTitle}`;
      docTitle = `${subject}${langSuffix} | ${tipitakaLabel}`;
    } else if (nikaya && nikaya !== bookTitle) {
      subject = `${bookTitle} (${nikaya})`;
      docTitle = `${subject}${langSuffix} | ${tipitakaLabel}`;
    } else {
      subject = bookTitle;
      docTitle = `${bookTitle}${langSuffix} | ${fullAppTitle}`;
    }

    return {
      pageTitle: docTitle,
      pageDesc: langMeta
        ? `Read ${subject} in ${langMeta.native} (${langMeta.name}) alongside original Pāḷi with DPD dictionary, 387K+ bold definitions, and fast full-text search.`
        : `Read ${subject} in original Pāḷi (17 scripts) with 23 modern translations, DPD dictionary, 387K+ bold definitions, and fast full-text search.`,
      canonicalUrl: computedCanonicalUrl,
      preserveSsrMeta: sameAsInitialSsr,
    };
  }, [
    isNotFound,
    activeTab,
    activeTab?.bookCode,
    activeTab?.title,
    activeTab?.isTocView,
    activeTab?.viewMode,
    activeTab?.currentChapterIdx,
    activeTab?.chapters,
    activeTab?.nikaya,
    activeBookCode,
    settings?.paliScript,
    initialRoute,
  ]);

  // Dynamic Browser, Search & SEO friendly Title, Meta & Canonical Synchronizer
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // On SSR /book/*, /chapter/*, or /translation/* routes, keep SSR metadata intact until activeTab loads
    const pathname = window.location?.pathname || '/';
    if (!activeTab && !isNotFound && (pathname.startsWith('/book/') || pathname.startsWith('/chapter/') || pathname.startsWith('/translation/'))) {
      return;
    }

    if (preserveSsrMeta && !isNotFound) {
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
  }, [pageTitle, pageDesc, canonicalUrl, preserveSsrMeta, activeTab, isNotFound]);

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
    const parsed = parseClientRouteLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      params,
      initialRoute,
    });

    // Clean up legacy URL parameters: migrate ?db=... / ?lang=... into ?l=... or remove if pali
    if (parsed.needsLegacyParamCleanup) {
      updateUrlParams({
        l: parsed.cleanQueryL,
        db: null,
        lang: null,
      });
    }

    if (parsed.tabParam === 'ai' || parsed.tabParam === 'ai_chat' || parsed.bookParam === 'ai_chat') {
      openAiChatTab();
      return;
    }

    if (parsed.query && !parsed.bookParam) {
      openSearchModal(parsed.query);
    } else if (parsed.bookParam) {
      let targetChapterIdx = undefined;
      if (parsed.chapterParam !== null && parsed.chapterParam !== undefined) {
        const chNum = parseInt(parsed.chapterParam, 10);
        if (!Number.isNaN(chNum)) {
          targetChapterIdx = Math.max(0, chNum > 0 ? chNum - 1 : 0);
        }
      }

      openBook(parsed.bookParam, {
        targetChapterIdx,
        targetParaNum: parsed.explicitParaNum,
        targetParaIndex: parsed.explicitParaIndex,
        highlightQuery: parsed.query || undefined,
        searchQuery: parsed.query || undefined,
        lang: parsed.effectiveLang || undefined,
        l: parsed.effectiveLang || undefined,
        fromTranslationRoute: parsed.fromTranslationRoute,
      });
    }
  }, [openBook, openAiChatTab, openSearchModal, updateUrlParams, params, initialRoute]);

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
  const isTocTab = Boolean(activeTab?.viewMode === 'toc' || activeTab?.isTocView);
  const useWindowScroll = !isNotFound && !isAiTab && !isTocTab && !isColumnsActive && Boolean(activeTab?.bookCode);

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
            <ReaderView ssrContent={ssrContent} />
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
