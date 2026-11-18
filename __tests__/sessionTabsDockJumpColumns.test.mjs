import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function compileModule(relPath, stubs = {}) {
  const fullPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const { code } = transform(src, {
    transforms: ['jsx', 'imports'],
    filePath: fullPath,
  });

  const mod = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  fn(mod.exports, localRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

function loadTabContextExports() {
  return compileModule('../context/TabContext.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    '../services/api': {
      fetchBook: async () => ({}),
      fetchChapter: async () => ({}),
      fetchMat: async () => ({}),
      fetchMatJump: async () => ({}),
      lookupBookInfo: () => null,
      fetchBookTocOnly: async () => ({}),
    },
    './ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { tabView: 'tabbed', syncScroll: true }, updateSetting: () => {} }),
    },
  });
}

function loadReaderViewExports({ useTabsMock, useThemeSettingsMock } = {}) {
  const noopComp = () => null;
  return compileModule('../components/Reader/ReaderView.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    './WelcomeView': { __esModule: true, default: noopComp },
    './MeditationLoader': { __esModule: true, default: noopComp },
    './BookTocView': { __esModule: true, default: noopComp },
    './LinkedDefinitionModal': { __esModule: true, default: noopComp },
    '../AiChat/AiChatView': { __esModule: true, default: noopComp },
    '../../context/TabContext': {
      useTabs: useTabsMock || (() => ({})),
    },
    '../../context/ThemeSettingsContext': {
      useThemeSettings: useThemeSettingsMock || (() => ({ settings: { paliScript: 'roman', translations: { pali: true } } })),
      getDefaultTranslationColorsForTheme: () => ({ pali: null, langs: {} }),
    },
    '../../context/DictionaryContext': {
      useDictionary: () => ({
        openDictionary: () => {},
        clickToLookupEnabled: false,
        clickLookupMode: 'double',
        isOpen: false,
        dockMode: 'side',
      }),
    },
    '../../services/transliterate': {
      transliterateHtml: (h) => h,
      convertPaliScript: (s) => s,
      highlightHtmlText: (h) => h,
      highlightTranslationText: (t) => t,
      capitalizePali: (s) => s,
      convertAnyToRoman: (s) => s,
      cleanDictionaryQuery: (s) => s,
    },
    '../../services/scroll': {
      smartScrollTo: () => {},
    },
    '../../services/api': {
      fetchChapterTranslations: async () => ({ translations: {}, sentences: {} }),
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({ paragraphs: {} }),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });
}

function loadBookTabsBarExports({ useTabsMock, useThemeSettingsMock } = {}) {
  const noopComp = () => null;
  return compileModule('../components/BookTabsBar.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    '../context/TabContext': {
      useTabs: useTabsMock || (() => ({
        openTabs: [],
        activeBookCode: null,
        switchTab: () => {},
        openAlongside: () => {},
        closeTab: () => {},
        closeOtherTabs: () => {},
        closeAllTabs: () => {},
        closeLeftTabs: () => {},
        closeRightTabs: () => {},
        reorderTabs: () => {},
        recentHistory: [],
        setIsHistoryOpen: () => {},
        isSidebarOpen: false,
        isHeaderVisible: true,
        setIsSidebarOpen: () => {},
        setIsHeaderVisible: () => {},
      })),
    },
    '../context/ThemeSettingsContext': {
      useThemeSettings: useThemeSettingsMock || (() => ({ settings: { tabView: 'columns', paliScript: 'roman' }, updateSetting: () => {} })),
    },
    '../services/transliterate': {
      convertPaliScript: (s) => s,
      capitalizePali: (s) => s,
    },
  });
}

// =========================================================================
// Task 4: Tab persistence & restoration (offline + web)
// =========================================================================

test('parseSavedTabsSnapshot restores books, TOC tabs, ai_chat, script prefixes, and active tab cleanly', () => {
  const { parseSavedTabsSnapshot } = loadTabContextExports();
  const saved = JSON.stringify([
    {
      bookCode: 's0102m.mul',
      title: 'Mahāvaggapāḷi',
      nikaya: 'Dīghanikāyo',
      currentChapterIdx: 8,
      lastParaNum: '373',
      viewMode: 'reader',
      isTocView: false,
    },
    {
      bookCode: 's0102a.att',
      title: 'Mahāvagga-aṭṭhakathā',
      currentChapterIdx: null,
      viewMode: 'toc',
      isTocView: true,
      scriptPrefix: 'si',
    },
    {
      bookCode: 'ai_chat',
      type: 'ai_chat',
      title: 'Ani Assistant',
    },
  ]);

  const res = parseSavedTabsSnapshot(saved, 's0102a.att');
  assert.equal(res.tabs.length, 3);
  assert.equal(res.activeBookCode, 's0102a.att');
  assert.deepEqual(res.scriptPrefixes, { 's0102a.att': 'si' });

  assert.equal(res.tabs[0].bookCode, 's0102m.mul');
  assert.equal(res.tabs[0].currentChapterIdx, 8);
  assert.equal(res.tabs[0].lastParaNum, '373');
  assert.equal(res.tabs[0].needsHydration, true);
  assert.equal(res.tabs[0].title, 'Mahāvaggapāḷi');

  assert.equal(res.tabs[1].isTocView, true);
  assert.equal(res.tabs[1].viewMode, 'toc');
  assert.equal(res.tabs[1].currentChapterIdx, null);
  assert.equal(res.tabs[1].scriptPrefix, 'si');

  assert.equal(res.tabs[2].type, 'ai_chat');
  assert.equal(res.tabs[2].bookCode, 'ai_chat');
  assert.equal(res.tabs[2].needsHydration, undefined);
});

test('parseSavedTabsSnapshot handles corrupt JSON, duplicates, MAX_TABS cap, and stale active code', () => {
  const { parseSavedTabsSnapshot } = loadTabContextExports();

  const corrupt = parseSavedTabsSnapshot('{bad json', 's0101m.mul');
  assert.deepEqual(corrupt, { tabs: [], activeBookCode: null, scriptPrefixes: {} });

  const many = Array.from({ length: 16 }, (_, i) => ({
    bookCode: i === 1 ? 's0100m.mul.xml' : `s010${i}m.mul`,
    currentChapterIdx: i,
  }));
  many[0] = { bookCode: 's0100m.mul', currentChapterIdx: 2 };

  const res = parseSavedTabsSnapshot(many, 'nonexistent.mul');
  assert.equal(res.tabs.length, 12);
  assert.equal(res.tabs[0].bookCode, 's0100m.mul');
  assert.equal(res.tabs.filter((t) => t.bookCode === 's0100m.mul').length, 1);
  assert.equal(res.activeBookCode, 's0100m.mul');
});

test('hasDeepLinkInLocation distinguishes root app launch from URL deep links', () => {
  const { hasDeepLinkInLocation } = loadTabContextExports();
  assert.equal(hasDeepLinkInLocation({ pathname: '/', search: '' }), false);
  assert.equal(hasDeepLinkInLocation({ pathname: '/', search: '?l=en' }), false);
  assert.equal(hasDeepLinkInLocation({ pathname: '/book/s0102m.mul/9', search: '' }), true);
  assert.equal(hasDeepLinkInLocation({ pathname: '/', search: '?book=s0102m.mul' }), true);
  assert.equal(hasDeepLinkInLocation({ pathname: '/', search: '?tab=ai' }), true);
  assert.equal(hasDeepLinkInLocation({ pathname: '/', search: '?q=satipatthana' }), true);
});

// =========================================================================
// Task 1: Jump accuracy, dynamic sticky inset, & non-aborting settle watcher
// =========================================================================

test('computeAnchorScrollTarget respects dynamic sticky top inset and clamps at zero', () => {
  const { computeAnchorScrollTarget } = loadReaderViewExports();

  // Window-scroll where app-header (52) + tabs (38) + content-header (36) + pad (14) = 140px sticky inset
  const targetOffset = computeAnchorScrollTarget({
    elementTopViewport: 1450,
    viewportTop: 0,
    currentScroll: 8000,
    stickyInset: 140,
  });
  assert.equal(targetOffset, 9310);

  // Near top of book clamps safely to 0
  const clamped = computeAnchorScrollTarget({
    elementTopViewport: 40,
    viewportTop: 0,
    currentScroll: 20,
    stickyInset: 140,
  });
  assert.equal(clamped, 0);
});

test('Task 1 source guarantees: openBook pre-resolves chapter via TOC, ChapterBlock preserves height, and processScrollTop does not self-cancel jumps', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const tabCtxSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');

  assert.match(tabCtxSrc, /hasParaTarget\s*&&\s*!hasTargetChapter[\s\S]{0,200}fetchBookTocOnly/);
  assert.match(readerSrc, /measuredHeightRef\.current > 220 \? \{ minHeight: measuredHeightRef\.current \} : undefined/);
  assert.match(readerSrc, /new ResizeObserver\(\(\) => \{\s*const cur = paraJumpRef\.current;/);
  assert.doesNotMatch(readerSrc, /if\s*\(\s*!isProgrammaticScrollRef\.current\s*\)\s*\{\s*cancelJump\(\)/);
});

// =========================================================================
// Task 3: Zero layout shift on Left/Right dictionary dock open/close/resize
// =========================================================================

test('computeBlockCompensationDelta keeps reading line exact when docked dictionary reflows width', () => {
  const { computeBlockCompensationDelta } = loadReaderViewExports();

  // Before opening Right dock: reading line 40% down inside paragraph sits at viewport Y = 240.
  // After Right dock opens: reader narrows, chapters above grow (+900px) and this paragraph grows (200px -> 300px),
  // placing its top at viewport Y = 1090 -> new anchorY = 1090 + 0.4 * 300 = 1210.
  const deltaExpand = computeBlockCompensationDelta({
    rectTopAfter: 1090,
    rectHeightAfter: 300,
    subRatio: 0.4,
    anchorViewportYBefore: 240,
  });
  assert.equal(deltaExpand, 970);

  // After closing dock: content above shrinks (-900px), paragraph shrinks (300px -> 200px),
  // rectTopAfter moves up to -120 -> new anchorY = -120 + 0.4 * 200 = -40 -> delta = -280.
  const deltaCollapse = computeBlockCompensationDelta({
    rectTopAfter: -120,
    rectHeightAfter: 200,
    subRatio: 0.4,
    anchorViewportYBefore: 240,
  });
  assert.equal(deltaCollapse, -280);

  // Clicked-word anchor (subRatio = 0.5) staying put gives 0 delta.
  const deltaExact = computeBlockCompensationDelta({
    rectTopAfter: 300,
    rectHeightAfter: 20,
    subRatio: 0.5,
    anchorViewportYBefore: 310,
  });
  assert.equal(deltaExact, 0);
});

test('DictionaryContext, DictionaryModal, and TabContext emit before-layout-shift events synchronously', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const dictCtxSrc = fs.readFileSync(path.join(rootDir, 'context/DictionaryContext.jsx'), 'utf8');
  const dictModalSrc = fs.readFileSync(path.join(rootDir, 'components/DictionaryModal.jsx'), 'utf8');
  const tabCtxSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');

  assert.match(dictCtxSrc, /tipitaka:before-layout-shift[\s\S]{0,160}setDockModeState/);
  assert.match(dictCtxSrc, /tipitaka:before-layout-shift[\s\S]{0,160}setIsOpen\(true\)/);
  assert.match(dictCtxSrc, /tipitaka:before-layout-shift[\s\S]{0,160}setIsOpen\(false\)/);
  assert.match(dictModalSrc, /tipitaka:before-layout-shift/);
  assert.match(dictModalSrc, /tipitaka:layout-shift-resize/);
  assert.match(tabCtxSrc, /toggleSidebar[\s\S]{0,160}tipitaka:before-layout-shift/);
});

// =========================================================================
// Task 2: Per-column live reading title, 4-col wide layout, & Open Tabs count button
// =========================================================================

test('detectLiveSectionTitleFromElements picks active visible sutta heading', () => {
  const { detectLiveSectionTitleFromElements } = loadReaderViewExports();
  const headings = [
    { textContent: '1. Brahmajālasuttaṃ', getBoundingClientRect: () => ({ top: -400, width: 500, height: 30 }) },
    { textContent: '9. Mahāsatipaṭṭhānasuttaṃ', getBoundingClientRect: () => ({ top: 110, width: 500, height: 32 }) },
    { textContent: '10. Pāyāsisuttaṃ', getBoundingClientRect: () => ({ top: 900, width: 500, height: 30 }) },
    { textContent: 'Hidden heading', getBoundingClientRect: () => ({ top: 120, width: 0, height: 0 }) },
  ];
  assert.equal(detectLiveSectionTitleFromElements(headings, 100), '9. Mahāsatipaṭṭhānasuttaṃ');

  const nearTopOnly = [
    { textContent: 'Paribbājakakathā', getBoundingClientRect: () => ({ top: 220, width: 400, height: 24 }) },
  ];
  assert.equal(detectLiveSectionTitleFromElements(nearTopOnly, 100), 'Paribbājakakathā');
});

test('getMaxColumnsForWidth / getBookTabsMaxCols and computeOpenTabsPopoverPosition behave properly across breakpoints', () => {
  const { getMaxColumnsForWidth } = loadReaderViewExports();
  const { getBookTabsMaxCols, computeOpenTabsPopoverPosition } = loadBookTabsBarExports();

  assert.equal(getMaxColumnsForWidth(960), 2);
  assert.equal(getMaxColumnsForWidth(1280), 3);
  assert.equal(getMaxColumnsForWidth(1440), 4);
  assert.equal(getBookTabsMaxCols(1280), 3);
  assert.equal(getBookTabsMaxCols(1440), 4);

  const pos = computeOpenTabsPopoverPosition(
    { top: 52, bottom: 88, right: 1278 },
    1280,
    800,
    300,
    380
  );
  assert.ok(pos.left >= 8 && pos.left + pos.width <= 1280 - 8);
  assert.equal(pos.top, 92);

  // Near bottom flips upward cleanly
  const posUp = computeOpenTabsPopoverPosition(
    { top: 720, bottom: 756, right: 1270 },
    1280,
    800,
    300,
    380
  );
  assert.ok(posUp.top < 720);
});

test('ReaderView renders prominent per-column reading title in columns mode and BookTabsBar renders tab count button when >= 2 tabs', () => {
  const tabs = [
    {
      bookCode: 's0101m.mul',
      title: 'Sīlakkhandhavaggapāḷi',
      nikaya: 'Dīghanikāyo',
      category: 'Mūla',
      currentChapterIdx: 0,
      chapters: [{ chapter_index: 0, title: '1. Brahmajālasuttaṃ' }],
      loadedChapters: { 0: '<p data-para="1" data-pindex="0">Evaṃ me sutaṃ</p>' },
      loadingChapters: {},
      para_to_chapter: { '1': 0 },
    },
    {
      bookCode: 's0102m.mul',
      title: 'Mahāvaggapāḷi',
      nikaya: 'Dīghanikāyo',
      category: 'Mūla',
      currentChapterIdx: 8,
      chapters: [{ chapter_index: 8, title: '9. Mahāsatipaṭṭhānasuttaṃ' }],
      loadedChapters: { 8: '<p data-para="373" data-pindex="1340">Evaṃ me sutaṃ</p>' },
      loadingChapters: {},
      para_to_chapter: { '373': 8 },
    },
  ];

  const { default: ReaderView } = loadReaderViewExports({
    useTabsMock: () => ({
      openTabs: tabs,
      activeTab: tabs[1],
      activeBookCode: 's0102m.mul',
      bookmarks: [],
      tabScrollIntents: {},
      getSavedScroll: () => 0,
    }),
    useThemeSettingsMock: () => ({
      settings: { tabView: 'columns', paliScript: 'roman', translations: { pali: true } },
    }),
  });

  const html = renderToStaticMarkup(React.createElement(ReaderView));
  assert.match(html, /column-live-title/);
  assert.match(html, /1\. Brahmajālasuttaṃ/);
  assert.match(html, /9\. Mahāsatipaṭṭhānasuttaṃ/);

  const { default: BookTabsBar } = loadBookTabsBarExports({
    useTabsMock: () => ({
      openTabs: tabs,
      activeBookCode: 's0102m.mul',
      switchTab: () => {},
      openAlongside: () => {},
      closeTab: () => {},
      closeOtherTabs: () => {},
      closeAllTabs: () => {},
      closeLeftTabs: () => {},
      closeRightTabs: () => {},
      reorderTabs: () => {},
      recentHistory: [],
      setIsHistoryOpen: () => {},
      isSidebarOpen: false,
      isHeaderVisible: true,
      setIsSidebarOpen: () => {},
      setIsHeaderVisible: () => {},
    }),
  });

  const barHtml = renderToStaticMarkup(React.createElement(BookTabsBar));
  assert.match(barHtml, /tab-count-btn/);
  assert.match(barHtml, /aria-label="Open tabs \(2\)"/);
  assert.doesNotMatch(barHtml, /role="menu"/);

  // Single tab open: count button omitted
  const { default: BookTabsBarSingle } = loadBookTabsBarExports({
    useTabsMock: () => ({
      openTabs: [tabs[0]],
      activeBookCode: tabs[0].bookCode,
      switchTab: () => {},
      openAlongside: () => {},
      closeTab: () => {},
      closeOtherTabs: () => {},
      closeAllTabs: () => {},
      closeLeftTabs: () => {},
      closeRightTabs: () => {},
      reorderTabs: () => {},
      recentHistory: [],
      setIsHistoryOpen: () => {},
      isSidebarOpen: false,
      isHeaderVisible: true,
      setIsSidebarOpen: () => {},
      setIsHeaderVisible: () => {},
    }),
  });
  const singleBarHtml = renderToStaticMarkup(React.createElement(BookTabsBarSingle));
  assert.doesNotMatch(singleBarHtml, /tab-count-btn/);
});

test('parseSavedTabsSnapshot preserves lastParaIndex & fromSavedSession, and filters invalid paraIndex', () => {
  const { parseSavedTabsSnapshot } = loadTabContextExports();
  const saved = JSON.stringify([
    {
      bookCode: 's0102m.mul',
      currentChapterIdx: 8,
      lastParaNum: '373',
      lastParaIndex: 1343,
    },
    {
      bookCode: 's0101m.mul',
      currentChapterIdx: 0,
      lastParaIndex: -5,
    },
  ]);

  const res = parseSavedTabsSnapshot(saved, 's0102m.mul');
  assert.equal(res.tabs[0].fromSavedSession, true);
  assert.equal(res.tabs[0].lastParaIndex, 1343);
  assert.equal(res.tabs[1].fromSavedSession, true);
  assert.equal(res.tabs[1].lastParaIndex, undefined);
});

test('detectLiveSectionTitleFromElements strips footnote/pb/link noise when cloneNode is supported', () => {
  const { detectLiveSectionTitleFromElements } = loadReaderViewExports();
  const noteNode = { removeCalled: false, remove() { this.removeCalled = true; } };
  const fakeClone = {
    querySelectorAll: () => [noteNode],
    get textContent() {
      return noteNode.removeCalled ? '9. Mahāsatipaṭṭhānasuttaṃ' : '9. Mahāsatipaṭṭhānasuttaṃ [note]';
    },
  };
  const headings = [
    {
      textContent: '9. Mahāsatipaṭṭhānasuttaṃ [note]',
      querySelector: (sel) => (sel.includes('.note') ? noteNode : null),
      cloneNode: () => fakeClone,
      getBoundingClientRect: () => ({ top: 105, width: 400, height: 30 }),
    },
  ];
  assert.equal(detectLiveSectionTitleFromElements(headings, 100), '9. Mahāsatipaṭṭhānasuttaṃ');
});

test('fetchBook never sends chapter=null in query string', async () => {
  const prevFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      json: async () => ({ code: 's0102m.mul', chapters: [] }),
    };
  };
  try {
    const { fetchBook } = compileModule('../services/api.js', {
      './transliterate': {
        splitScriptCode: (code) => ({ bookCode: code, scriptId: null, prefix: null }),
      },
      './dpdFeedback': {
        saveFeedbackTemplateToStorage: () => {},
      },
    });
    await fetchBook('s0102m.mul', { chapter: null, buffer: 1 });
    assert.equal(requestedUrls.length, 1);
    assert.doesNotMatch(requestedUrls[0], /chapter=null/);
    assert.match(requestedUrls[0], /\?buffer=1$/);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('Regression guards for Tasks 1-4: click scroll preservation, fine anchor priority, reactive hydration, layout-effect window-scroll', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');
  const tabCtxSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  const pageSrc = fs.readFileSync(path.join(rootDir, 'app/page.js'), 'utf8');

  // Task 3: clicking a word saves getScrollTop() (not containerRef.current?.scrollTop which is 0 in window-scroll)
  assert.match(readerSrc, /saveTabPosition\(activeTab\.bookCode,\s*chapIdx,\s*pNum,\s*getScrollTop\(\),\s*pIdx\)/);
  // Task 3: fine-grained .sent-pair / .reader-trans-block candidates checked before tall .reader-para-row
  assert.match(readerSrc, /const fineCandidates = container\.querySelectorAll\(\s*'\.sent-pair/);
  // Task 1: Pali search hit skips translation blocks but NOT .reader-pali-trans-block
  assert.match(readerSrc, /\.reader-trans-block:not\(\.reader-pali-trans-block\)/);
  // Task 4: reactive hydration of visible columns + fallback to paraIndex on cold restore
  assert.match(tabCtxSrc, /hydrateSessionTab/);
  assert.match(readerSrc, /tab\?\.fromSavedSession/);
  // Task 1: window-scroll toggled in useLayoutEffect before child effects
  assert.match(pageSrc, /useIsoLayoutEffect\(\(\)\s*=>\s*\{[\s\S]{0,120}window-scroll/);
});

test('Task 3 fix: selectClickedWordAnchor queries .reader-clicked-word / [data-clicked-word="true"] and handles bounds', () => {
  const { selectClickedWordAnchor } = loadReaderViewExports();
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');

  assert.doesNotMatch(readerSrc, /\.clicked-word-highlight/);

  const seenSelectors = [];
  const inBandEl = {
    getBoundingClientRect: () => ({ top: 200, bottom: 224, height: 24, width: 80 }),
  };
  const mockContainer = {
    querySelector: (sel) => {
      seenSelectors.push(sel);
      return inBandEl;
    },
  };

  const res = selectClickedWordAnchor(mockContainer, 120, 700);
  assert.equal(seenSelectors[0], '.reader-clicked-word, [data-clicked-word="true"]');
  assert.deepEqual(res, {
    anchorEl: inBandEl,
    subRatio: 0.5,
    viewportY: 212,
  });

  // Out-of-band or zero-height clicked element returns null
  const outOfBandContainer = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ top: 40, bottom: 60, height: 20, width: 80 }),
    }),
  };
  assert.equal(selectClickedWordAnchor(outOfBandContainer, 120, 700), null);

  const zeroHeightContainer = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ top: 200, bottom: 200, height: 0, width: 0 }),
    }),
  };
  assert.equal(selectClickedWordAnchor(zeroHeightContainer, 120, 700), null);
  assert.equal(selectClickedWordAnchor(null, 120, 700), null);
});

test('Task 1 & Task 2 review fixes: openBook loads prev chapter after setOpenTabs, guards targetChapIdx, and BookTabsBar portals Open Tabs popover', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const tabCtxSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  const tabsBarSrc = fs.readFileSync(path.join(rootDir, 'components/BookTabsBar.jsx'), 'utf8');

  // Task 1: in openBook's new-tab branch, setOpenTabs(nextTabs) and openTabsRef.current = nextTabs happen before loadChapter(cleanCode, targetChapIdx - 1)
  const setOpenTabsIdx = tabCtxSrc.lastIndexOf('setOpenTabs(nextTabs);');
  const prevChapLoadIdx = tabCtxSrc.lastIndexOf('loadChapter(cleanCode, targetChapIdx - 1);');
  assert.ok(setOpenTabsIdx !== -1 && prevChapLoadIdx !== -1);
  assert.ok(
    prevChapLoadIdx > setOpenTabsIdx && prevChapLoadIdx - setOpenTabsIdx < 450,
    'loadChapter(cleanCode, targetChapIdx - 1) must run after setOpenTabs(nextTabs) so loadingChapters is not overwritten'
  );
  assert.match(tabCtxSrc, /openTabsRef\.current\s*=\s*nextTabs;/);

  // Task 1: null-safe chapter param in updateUrlParams
  assert.match(tabCtxSrc, /chapter:\s*\(targetChapIdx\s*\?\?\s*0\)\s*\+\s*1/);

  // Task 2: Open Tabs popover and context menu are portaled to document.body with SSR guard
  assert.match(tabsBarSrc, /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]/);
  assert.match(tabsBarSrc, /typeof document !== ['"]undefined['"]\s*&&\s*document\.body\s*\?\s*createPortal\(openTabsPopover/);
  assert.match(tabsBarSrc, /typeof document !== ['"]undefined['"]\s*&&\s*document\.body\s*\?\s*createPortal\(tabContextMenu/);
  // Task 2: Closing from 2 tabs to 1 tab closes the popover and outside-click works even without tabsMenuBtnRef
  assert.match(tabsBarSrc, /if\s*\(isTabsPopoverOpen\s*&&\s*openTabs\.length\s*<\s*2\)\s*\{\s*setIsTabsPopoverOpen\(false\)/);
  assert.match(tabsBarSrc, /!\s*tabsMenuBtnRef\.current\s*\|\|\s*!\s*tabsMenuBtnRef\.current\.contains/);
});

test('Task 1 behavioral fix: cancelJump does not depend on paneScrollIntent or disconnect active jump watchers on intent clear', () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');

  assert.match(readerSrc, /const paneScrollIntentRef = useRef\(paneScrollIntent\);/);
  assert.match(readerSrc, /if\s*\(paneScrollIntentRef\.current\)\s*\{\s*clearTargetScrollIntent\(tab\.bookCode\);/);
  const cancelMatch = readerSrc.match(/const cancelJump = useCallback\([\s\S]*?\},\s*\[([^\]]*)\]\);/);
  assert.ok(cancelMatch, 'cancelJump useCallback must exist');
  assert.doesNotMatch(cancelMatch[1], /paneScrollIntent/);
});

test('Task 1 behavioral simulation: openBook preserves loadingChapters[targetChapIdx - 1] and avoids NaN chapter in updateUrlParams', async () => {
  let stateSlots = [];
  let slotIdx = 0;
  let capturedCtx = null;
  const pendingChapterResolvers = [];
  const fetchedChapters = [];

  const mockReact = {
    __esModule: true,
    default: null,
    createElement: (_type, props) => ({ props }),
    createContext: () => ({
      Provider: ({ value }) => {
        capturedCtx = value;
        return null;
      },
    }),
    useContext: () => ({}),
    useState: (init) => {
      const idx = slotIdx++;
      if (!(idx in stateSlots)) {
        stateSlots[idx] = typeof init === 'function' ? init() : init;
      }
      const setter = (upd) => {
        stateSlots[idx] = typeof upd === 'function' ? upd(stateSlots[idx]) : upd;
      };
      return [stateSlots[idx], setter];
    },
    useRef: (init) => {
      const idx = slotIdx++;
      if (!(idx in stateSlots)) {
        stateSlots[idx] = { current: init };
      }
      return stateSlots[idx];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
  };
  mockReact.default = mockReact;

  const { TabProvider } = compileModule('../context/TabContext.jsx', {
    react: mockReact,
    '../services/api': {
      fetchBookTocOnly: async () => ({
        code: 's0102m.mul',
        title: 'Mahāvaggapāḷi',
        chapters: Array.from({ length: 10 }, (_, i) => ({ chapter_index: i, para_index: i * 100 })),
      }),
      fetchBook: async () => ({
        code: 's0102m.mul',
        title: 'Mahāvaggapāḷi',
        chapter_count: 10,
        chapters: Array.from({ length: 10 }, (_, i) => ({ chapter_index: i, para_index: i * 100 })),
        toc: [],
        para_to_chapter: {},
        chapters_data: { 8: '<p data-pindex="820">Mahāsatipaṭṭhānasuttaṃ</p>' },
      }),
      fetchChapter: (code, chIdx) => {
        fetchedChapters.push(`${code}:${chIdx}`);
        return new Promise((resolve) => {
          pendingChapterResolvers.push({ chIdx, resolve });
        });
      },
      fetchMat: async () => null,
      fetchMatJump: async () => null,
      lookupBookInfo: () => ({ title: 'Mahāvaggapāḷi', nikaya: 'Dīghanikāyo', category: 'Mūla' }),
    },
    './ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { tabView: 'tabbed', syncScroll: true }, updateSetting: () => {} }),
    },
  });

  const renderProvider = () => {
    slotIdx = 0;
    const el = TabProvider({ children: null });
    capturedCtx = el.props?.value || capturedCtx;
  };
  renderProvider();

  await capturedCtx.openBook('s0102m.mul', { targetParaIndex: 820 });
  renderProvider();

  const tab = capturedCtx.openTabs.find((t) => t.bookCode === 's0102m.mul');
  assert.ok(tab, 's0102m.mul tab must be created');
  assert.equal(tab.currentChapterIdx, 8);
  assert.equal(tab.loadingChapters[7], true, 'loadingChapters[targetChapIdx - 1] must remain true while chapter 7 loads');
  assert.equal(fetchedChapters.filter((x) => x === 's0102m.mul:7').length, 1, 'chapter 7 should only be fetched once');

  // Resolve chapter 7 fetch and verify loadingChapters[7] flips to false
  const ch7Resolver = pendingChapterResolvers.find((r) => r.chIdx === 7);
  assert.ok(ch7Resolver);
  ch7Resolver.resolve({ html: '<p>Chapter 7</p>' });
  await new Promise((r) => setTimeout(r, 0));
  renderProvider();
  const updatedTab = capturedCtx.openTabs.find((t) => t.bookCode === 's0102m.mul');
  assert.equal(updatedTab.loadingChapters[7], false);
  assert.equal(updatedTab.loadedChapters[7], '<p>Chapter 7</p>');

  // Also test openBook with targetPage only (targetChapIdx remains null) -> no NaN chapter
  const prevWin = globalThis.window;
  const pushedUrls = [];
  globalThis.window = {
    location: new URL('https://tipitakapali.org/'),
    history: {
      replaceState: (_s, _t, url) => pushedUrls.push(url),
    },
  };
  try {
    await capturedCtx.openBook('s0101m.mul', { targetPage: '10', targetPageSystem: 'M' });
    assert.ok(pushedUrls.every((u) => !String(u).includes('NaN')), `URL must never contain NaN: ${pushedUrls.join(', ')}`);
    assert.ok(pushedUrls.some((u) => u === '/book/s0101m.mul/1'));
  } finally {
    globalThis.window = prevWin;
  }
});

test('Task 1 (+Aṭṭha column open): jumpToMat preserves window-scroll offset and ReaderView transfers scroll on useWindowScroll transition', async () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');

  // ReaderView transfers savedScroll when useWindowScroll toggles (e.g. 1 pane -> 2 columns)
  // BEFORE anchorPinRef compensation runs, and guards scroll listeners with useWindowScrollRef.current
  const transitionIdx = readerSrc.indexOf('if (prevUseWindowScrollRef.current === useWindowScroll) return;');
  const anchorCompIdx = readerSrc.indexOf('if (!anchorPinRef.current.active) return;');
  assert.ok(transitionIdx !== -1 && anchorCompIdx !== -1, 'Both layout effects must exist');
  assert.ok(
    transitionIdx < anchorCompIdx,
    'useWindowScroll transition scroll transfer must run BEFORE anchor compensation layout effect'
  );
  assert.match(readerSrc, /if\s*\(useWindowScrollRef\.current\)\s*return;/);
  assert.match(readerSrc, /if\s*\(!useWindowScrollRef\.current\)\s*return;/);

  // Behavioral simulation: Mūla is open in window-scroll mode scrolled to window.scrollY = 1850 at para 6,
  // user clicks +Aṭṭha -> jumpToMat saves 1850 (not container.scrollTop = 0), emits before-layout-shift,
  // and opens Aṭṭha alongside while keeping Mūla active.
  let stateSlots = [];
  let slotIdx = 0;
  let capturedCtx = null;
  const dispatchedEvents = [];

  const mockReact = {
    __esModule: true,
    default: null,
    createElement: (_type, props) => ({ props }),
    createContext: () => ({
      Provider: ({ value }) => {
        capturedCtx = value;
        return null;
      },
    }),
    useContext: () => ({}),
    useState: (init) => {
      const idx = slotIdx++;
      if (!(idx in stateSlots)) {
        stateSlots[idx] = typeof init === 'function' ? init() : init;
      }
      const setter = (upd) => {
        stateSlots[idx] = typeof upd === 'function' ? upd(stateSlots[idx]) : upd;
      };
      return [stateSlots[idx], setter];
    },
    useRef: (init) => {
      const idx = slotIdx++;
      if (!(idx in stateSlots)) {
        stateSlots[idx] = { current: init };
      }
      return stateSlots[idx];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn) => fn(),
  };
  mockReact.default = mockReact;

  const { TabProvider } = compileModule('../context/TabContext.jsx', {
    react: mockReact,
    '../services/api': {
      fetchBookTocOnly: async () => ({ code: 's0101a.att', chapters: [{ chapter_index: 0 }, { chapter_index: 1 }] }),
      fetchBook: async (code) =>
        code === 's0101m.mul'
          ? {
              code: 's0101m.mul',
              title: 'Sīlakkhandhavaggapāḷi',
              chapter_count: 13,
              chapters: [{ chapter_index: 0, title: '1. Brahmajālasuttaṃ' }],
              toc: [],
              para_to_chapter: { '1': 0, '6': 0 },
              para_to_mat: { '6': { attha: { book: 's0101a.att', chapter: 1, para: '6' } } },
              mat: { book_code: 's0101m.mul', mula_code: 's0101m.mul', attha_code: 's0101a.att' },
              chapters_data: { 0: '<p data-para="6" data-pindex="5">Para 6</p>' },
            }
          : {
              code: 's0101a.att',
              title: 'Sīlakkhandhavagga-aṭṭhakathā',
              chapter_count: 13,
              chapters: [
                { chapter_index: 0, title: 'Nidāna' },
                { chapter_index: 1, title: 'Brahmajālasuttavaṇṇanā' },
              ],
              toc: [],
              para_to_chapter: { '6': 1 },
              mat: { book_code: 's0101a.att', mula_code: 's0101m.mul', attha_code: 's0101a.att' },
              chapters_data: { 1: '<p data-para="6" data-pindex="12">Para 6 Attha</p>' },
            },
      fetchChapter: async () => ({ html: '<p>Chapter</p>' }),
      fetchMat: async () => ({ book_code: 's0101m.mul', mula_code: 's0101m.mul', attha_code: 's0101a.att' }),
      fetchMatJump: async () => ({ attha: { book: 's0101a.att', chapter: 1, para: '6' } }),
      lookupBookInfo: (c) => ({ title: c, nikaya: 'Dīghanikāyo', category: 'Mūla' }),
    },
    './ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { tabView: 'columns', syncScroll: false }, updateSetting: () => {} }),
    },
  });

  const renderProvider = () => {
    slotIdx = 0;
    const el = TabProvider({ children: null });
    capturedCtx = el.props?.value || capturedCtx;
  };
  renderProvider();

  await capturedCtx.openBook('s0101m.mul', { targetChapterIdx: 0 });
  renderProvider();

  const prevWin = globalThis.window;
  const prevDoc = globalThis.document;
  const prevCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.window = {
    innerWidth: 1280,
    scrollY: 1850,
    location: new URL('http://localhost:3000/book/s0101m.mul/1'),
    history: { replaceState: () => {} },
    dispatchEvent: (ev) => dispatchedEvents.push(ev),
  };
  globalThis.document = {
    documentElement: { scrollTop: 1850 },
    body: { classList: { contains: (cls) => cls === 'window-scroll' } },
    querySelector: () => ({ scrollTop: 0, offsetParent: {} }),
  };

  try {
    await capturedCtx.jumpToMat('attha', {
      alongside: true,
      sourceBookCode: 's0101m.mul',
      sourceParaNum: '6',
      sourceChapterIdx: 0,
    });
    renderProvider();

    assert.equal(
      capturedCtx.getSavedScroll('s0101m.mul'),
      1850,
      'jumpToMat must preserve window.scrollY (1850) instead of overwriting with main.scrollTop (0)'
    );
    assert.ok(
      dispatchedEvents.some((ev) => ev.type === 'tipitaka:before-layout-shift' && ev.detail?.shiftsLayout === true),
      'openAlongside must emit tipitaka:before-layout-shift so reading anchor is captured before column reflow'
    );
    assert.equal(capturedCtx.activeBookCode, 's0101m.mul', 'Mūla must remain active column');
    assert.deepEqual(
      capturedCtx.openTabs.map((t) => t.bookCode),
      ['s0101m.mul', 's0101a.att']
    );
  } finally {
    globalThis.window = prevWin;
    globalThis.document = prevDoc;
    globalThis.CustomEvent = prevCustomEvent;
  }
});
