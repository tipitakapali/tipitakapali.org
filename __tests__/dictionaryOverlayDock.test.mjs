import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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

function createDictionaryModalHarness(overrides = {}) {
  const noop = () => {};
  const iconStub = (name) => (props) => React.createElement('svg', { 'data-icon': name, ...props });
  const dictCtx = {
    isOpen: true,
    queryWord: 'dhamma',
    displayWord: 'dhamma',
    activeDictTab: 'dpd',
    dockMode: 'side',
    isPinned: false,
    fontSizeMultiplier: 1,
    history: ['dhamma'],
    historyIndex: 0,
    lookupData: {
      word: 'dhamma',
      hasResults: true,
      counts: { dpd: 1, bold_def: 0, pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
      dpd: [{ word: 'dhamma', html: '<div class="dpd"><p>doctrine</p></div>' }],
      bold_def: [],
      pts: [],
      abd: [],
      psd: [],
      sans: [],
      splitter: [],
    },
    isLoading: false,
    isBackgroundLoading: false,
    error: null,
    openDictionary: noop,
    closeDictionary: noop,
    performLookup: noop,
    goBack: noop,
    setDictTab: noop,
    setDockMode: noop,
    togglePinned: noop,
    setFontSizeMultiplier: noop,
    setDisplayWord: noop,
    clearDictionaryInput: noop,
    dictOrder: ['dpd', 'bold_def', 'abd', 'pts', 'psd', 'sans', 'splitter'],
    dictEnabled: { dpd: true, bold_def: true, abd: true, pts: true, psd: true, sans: true, splitter: true },
    lookupHistory: ['dhamma'],
    clearLookupHistory: noop,
    removeLookupHistoryItem: noop,
    ...overrides.dict,
  };

  const tabCtx = {
    openBook: noop,
    openAlongside: noop,
    isHeaderVisible: true,
    isSidebarOpen: false,
    ...overrides.tabs,
  };

  const { default: DictionaryModal } = compileModule('../components/DictionaryModal.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: (_t, prop) => iconStub(String(prop)) }),
    '../context/DictionaryContext': {
      useDictionary: () => dictCtx,
      DEFAULT_DICT_ORDER: ['dpd', 'bold_def', 'abd', 'pts', 'psd', 'sans', 'splitter'],
      DEFAULT_DICT_ENABLED: { dpd: true, bold_def: true, abd: true, pts: true, psd: true, sans: true, splitter: true },
    },
    '../context/ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { paliScript: 'roman' } }),
    },
    '../context/TabContext': {
      useTabs: () => tabCtx,
    },
    './BoldDefinitionSection': { __esModule: true, default: () => null },
    '../services/transliterate': {
      typeVelthuis: (s) => s,
      convertAnyToRoman: (s) => s,
      convertPaliScript: (s) => s,
      cleanDictionaryQuery: (s) => s,
    },
    '../services/api': {
      fetchDictionaryInflection: async () => ({}),
    },
    '../services/dpdFeedback': {
      restoreMinifiedLinks: (s) => s,
    },
  });

  return DictionaryModal;
}

test('DictionaryContext defaults isPinned=false, persists togglePinned, and emits before-layout-shift', () => {
  const storage = new Map();
  const dispatched = [];
  const prevWin = globalThis.window;
  const prevLS = globalThis.localStorage;

  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.window = {
    innerWidth: 1280,
    dispatchEvent: (ev) => dispatched.push(ev),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.CustomEvent =
    globalThis.CustomEvent ||
    class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };

  let stateSlots = [];
  let slotIdx = 0;
  let capturedCtx = null;
  const mockReact = {
    __esModule: true,
    default: null,
    createElement: (_t, props) => ({ props }),
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

  try {
    const { DictionaryProvider } = compileModule('../context/DictionaryContext.jsx', {
      react: mockReact,
      '../services/api': {
        fetchDictionaryLookup: async () => ({}),
        fetchDictionaryInflection: async () => ({}),
        getFeedbackTemplateFromDb: async () => {},
      },
      '../services/transliterate': {
        convertAnyToRoman: (s) => s,
        cleanDictionaryQuery: (s) => s,
      },
      '../services/dpdFeedback': {
        restoreMinifiedLinks: (s) => s,
      },
      './ThemeSettingsContext': {
        useThemeSettings: () => ({ settings: {} }),
      },
      './TabContext': {
        normalizeLangCode: (s) => s,
      },
    });

    const render = () => {
      slotIdx = 0;
      const el = DictionaryProvider({ children: null });
      capturedCtx = el.props?.value || capturedCtx;
    };
    render();

    assert.equal(capturedCtx.dockMode, 'side');
    assert.equal(capturedCtx.isPinned, false, 'Side dictionary must default to unpinned floating overlay');

    capturedCtx.togglePinned();
    render();
    assert.equal(capturedCtx.isPinned, true);
    assert.equal(storage.get('tipitaka_dict_pinned_v1'), 'true');
    assert.ok(
      dispatched.some(
        (ev) =>
          ev.type === 'tipitaka:before-layout-shift' &&
          ev.detail?.source === 'dictionary-pin' &&
          ev.detail?.pinned === true &&
          ev.detail?.shiftsLayout === true
      ),
      'togglePinned must dispatch before-layout-shift synchronously with shiftsLayout: true'
    );

    // When pinned, openDictionary/closeDictionary report shiftsLayout: true
    dispatched.length = 0;
    capturedCtx.openDictionary();
    capturedCtx.closeDictionary();
    assert.ok(
      dispatched.some((ev) => ev.detail?.source === 'dictionary-open' && ev.detail?.shiftsLayout === true),
      'openDictionary in pinned side mode should report shiftsLayout: true'
    );
    assert.ok(
      dispatched.some((ev) => ev.detail?.source === 'dictionary-close' && ev.detail?.shiftsLayout === true),
      'closeDictionary in pinned side mode should report shiftsLayout: true'
    );

    capturedCtx.setIsPinned(false);
    render();
    assert.equal(capturedCtx.isPinned, false);
    assert.equal(storage.get('tipitaka_dict_pinned_v1'), 'false');

    // When unpinned (default floating mode), open/close/dock-switch must report shiftsLayout: false
    dispatched.length = 0;
    capturedCtx.openDictionary();
    capturedCtx.setDockMode('left');
    capturedCtx.closeDictionary();
    const layoutShiftEvents = dispatched.filter((ev) => ev.type === 'tipitaka:before-layout-shift');
    assert.equal(layoutShiftEvents.length, 3);
    assert.ok(
      layoutShiftEvents.every((ev) => ev.detail?.shiftsLayout === false),
      'floating dictionary open/dock/close must report shiftsLayout: false so reader scroll is never shifted'
    );
  } finally {
    globalThis.window = prevWin;
    globalThis.localStorage = prevLS;
  }
});

test('DictionaryModal renders Right & Left Dock as non-shifting dict-floating overlay by default, and supports dict-pinned and modal modes', () => {
  // 1. Default Right Dock (unpinned -> dict-floating)
  const RightFloat = createDictionaryModalHarness({ dict: { dockMode: 'side', isPinned: false } });
  const rightHtml = renderToStaticMarkup(React.createElement(RightFloat));
  assert.match(rightHtml, /<aside[^>]*class="[^"]*dict-dock-panel dock-side dict-floating/);
  assert.doesNotMatch(rightHtml, /dict-pinned/);
  assert.doesNotMatch(rightHtml, /dict-overlay/);
  assert.match(rightHtml, /aria-label="Pāḷi Dictionary"/);
  assert.match(rightHtml, /aria-pressed="false"/);
  assert.match(rightHtml, /overscroll-contain/);
  assert.equal((rightHtml.match(/dict-resizer-handle-left/g) || []).length, 1);

  // 2. Left Dock (unpinned -> dict-floating, single right-edge resizer handle)
  const LeftFloat = createDictionaryModalHarness({ dict: { dockMode: 'left', isPinned: false } });
  const leftHtml = renderToStaticMarkup(React.createElement(LeftFloat));
  assert.match(leftHtml, /<aside[^>]*class="[^"]*dict-dock-panel dock-left dict-floating/);
  assert.equal(
    (leftHtml.match(/dict-resizer-handle-right/g) || []).length,
    1,
    'Left dock should have exactly one right-edge resizer handle'
  );

  // 3. Header hidden -> adds dict-header-hidden
  const HiddenHeaderFloat = createDictionaryModalHarness({
    dict: { dockMode: 'side', isPinned: false },
    tabs: { isHeaderVisible: false, isSidebarOpen: false },
  });
  const hiddenHeaderHtml = renderToStaticMarkup(React.createElement(HiddenHeaderFloat));
  assert.match(hiddenHeaderHtml, /dict-floating dict-header-hidden/);

  // 4. Pinned mode -> adds dict-pinned and removes dict-floating
  const PinnedDock = createDictionaryModalHarness({ dict: { dockMode: 'side', isPinned: true } });
  const pinnedHtml = renderToStaticMarkup(React.createElement(PinnedDock));
  assert.match(pinnedHtml, /<aside[^>]*class="[^"]*dict-dock-panel dock-side dict-pinned/);
  assert.doesNotMatch(pinnedHtml, /dict-floating/);
  assert.match(pinnedHtml, /aria-pressed="true"/);

  // 5. Center Modal mode -> renders .dict-overlay + role="dialog" without Pin button
  const ModalMode = createDictionaryModalHarness({ dict: { dockMode: 'modal', isPinned: false } });
  const modalHtml = renderToStaticMarkup(React.createElement(ModalMode));
  assert.match(modalHtml, /class="dict-overlay/);
  assert.match(modalHtml, /role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(modalHtml, /Pin dictionary panel/);
});

test('Header Dict button toggles open/close with aria-expanded and data-dict-trigger', () => {
  const calls = [];
  const iconStub = (name) => (props) => React.createElement('svg', { 'data-icon': name, ...props });
  const makeHeader = (isDictOpen) =>
    compileModule('../components/Header.jsx', {
      react: Object.assign({}, React, { __esModule: true, default: React }),
      'lucide-react': new Proxy({}, { get: (_t, prop) => iconStub(String(prop)) }),
      './LanguageMenu': { __esModule: true, default: () => null },
      './HelpModal': { __esModule: true, default: () => null },
      '../context/ThemeSettingsContext': {
        useThemeSettings: () => ({ settings: { theme: 'classic' }, updateSetting: () => {}, openSettingsModal: () => {} }),
      },
      '../context/TabContext': {
        useTabs: () => ({
          toggleSidebar: () => {},
          isSidebarOpen: false,
          isHeaderVisible: true,
          openSearchModal: () => {},
          setIsBookmarkOpen: () => {},
          openAiChatTab: () => {},
        }),
      },
      '../context/DictionaryContext': {
        useDictionary: () => ({
          isOpen: isDictOpen,
          openDictionary: () => calls.push('open'),
          closeDictionary: () => calls.push('close'),
        }),
      },
    }).default;

  const ClosedHeader = makeHeader(false);
  const closedHtml = renderToStaticMarkup(React.createElement(ClosedHeader));
  assert.match(closedHtml, /data-dict-trigger="true"/);
  assert.match(closedHtml, /aria-expanded="false"/);

  const OpenHeader = makeHeader(true);
  const openHtml = renderToStaticMarkup(React.createElement(OpenHeader));
  assert.match(openHtml, /aria-expanded="true"/);
});

test('CSS & SettingsModal invariants for floating non-shifting side dictionary', () => {
  const css = fs.readFileSync(path.join(rootDir, 'app/globals.css'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(rootDir, 'components/Settings/SettingsModal.jsx'), 'utf8');

  // Floating dock uses fixed positioning above content and expands to top: 0 when header is hidden (web + Flutter WebView)
  assert.match(css, /aside\.dict-dock-panel\.dict-floating[\s\S]*?position:\s*fixed;/);
  assert.match(css, /body\.tpo-bars-hidden aside\.dict-dock-panel\.dict-floating[\s\S]*?top:\s*0;/);
  assert.match(css, /body:has\(\.app-header\.hidden-header\) aside\.dict-dock-panel\.dict-floating[\s\S]*?top:\s*0;/);

  // window-scroll sticky positioning is scoped to .dict-pinned only so it never overrides .dict-floating
  assert.match(css, /body\.window-scroll aside\.dict-dock-panel\.dict-pinned/);
  assert.doesNotMatch(css, /body\.window-scroll aside\.dict-dock-panel\s*,/);

  // Keyframes and reduced-motion support exist
  assert.match(css, /@keyframes dictSlideLeft/);
  assert.match(css, /@keyframes dictSlideRight/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  // SettingsModal exposes Pin side panel toggle
  assert.match(settingsSrc, /Pin side panel beside text/);
  assert.match(settingsSrc, /setIsPinned/);

  // ReaderView ignores shiftsLayout === false and clears stale anchorPinRef
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');
  assert.match(readerSrc, /e\?\.detail\?\.shiftsLayout === false/);
  assert.match(readerSrc, /captureReadingAnchor[\s\S]{0,120}anchorPinRef\.current\.active = false/);

  // DictionaryModal uses rendered width on resize, preventScroll on focus, and <=256px history dropdown
  const dictModalSrc = fs.readFileSync(path.join(rootDir, 'components/DictionaryModal.jsx'), 'utf8');
  assert.match(dictModalSrc, /getBoundingClientRect\?\.\(\)\.width \|\| dictWidth/);
  assert.match(dictModalSrc, /focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.doesNotMatch(dictModalSrc, /historyDropdownRef[\s\S]{0,120}sm:w-72/);
});

test('shouldDismissUnpinnedDictionaryOnClick closes unpinned panel on empty space click, keeps open on word/panel/pinned/interactive clicks', () => {
  const noopComp = () => null;
  const { shouldDismissUnpinnedDictionaryOnClick } = compileModule('../components/DictionaryModal.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    '../context/DictionaryContext': {
      useDictionary: () => ({}),
      DEFAULT_DICT_ORDER: ['dpd'],
      DEFAULT_DICT_ENABLED: { dpd: true },
    },
    '../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: {} }) },
    '../context/TabContext': { useTabs: () => ({}) },
    './BoldDefinitionSection': { __esModule: true, default: noopComp },
    '../services/transliterate': {
      typeVelthuis: (s) => s,
      convertAnyToRoman: (s) => s,
      convertPaliScript: (s) => s,
      cleanDictionaryQuery: (s) => s,
    },
    '../services/api': { fetchDictionaryInflection: async () => ({}) },
    '../services/dpdFeedback': { restoreMinifiedLinks: (s) => s },
  });

  const makeTarget = (matchedSelector = null) => ({
    closest: (sel) => {
      if (!matchedSelector) return null;
      return sel.includes(matchedSelector) ? {} : null;
    },
  });
  const panelEl = { contains: (t) => t === panelChild };
  const panelChild = makeTarget();
  const emptySpaceEl = makeTarget();

  // 1. Unpinned side mode + empty space click -> dismisses (true)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    true
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: false, dockMode: 'left', panelEl, now: 1000 }
    ),
    true
  );

  // 2. Word click (marked via nativeEvent or event) -> stays open (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl, __tpoWordClicked: true },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl, nativeEvent: { __tpoWordClicked: true } },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );

  // 3. Pinned mode -> empty space click does NOT dismiss (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: true, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );

  // 4. Inside dictionary panel -> stays open (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: panelChild },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );

  // 4b. Detached target inside dictionary panel (e.g. React unmounted .dp9 on setIsLoading(true)) -> stays open via composedPath / __tpoInsideDictPanel / startedInsidePanel
  const detachedChild = makeTarget(); // panelEl.contains(detachedChild) === false
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: detachedChild, composedPath: () => [detachedChild, panelEl, {}] },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: detachedChild, nativeEvent: { __tpoInsideDictPanel: true } },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: detachedChild },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, startedInsidePanel: true, now: 1000 }
    ),
    false
  );

  // 5. Dictionary trigger button / interactive controls -> stays open (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: makeTarget('[data-dict-trigger]') },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: makeTarget('button') },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: makeTarget('a[href]') },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );

  // 6. Drag text selection -> stays open (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, selectionText: 'Evaṃ me sutaṃ', now: 1000 }
    ),
    false
  );

  // 7. Just finished resizing (< 250ms) -> stays open (false)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: false, dockMode: 'side', panelEl, lastResizeEndTime: 900, now: 1000 }
    ),
    false
  );

  // 8. Modal mode or closed -> false (handled by modal pointerdown overlay)
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: true, isPinned: false, dockMode: 'modal', panelEl, now: 1000 }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedDictionaryOnClick(
      { target: emptySpaceEl },
      { isOpen: false, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
    ),
    false
  );

  // 9. Other open modals (.modal-backdrop / .fixed.inset-0 / [aria-modal="true"]) -> stays open (false)
  for (const modalSel of ['.modal-backdrop', '.fixed.inset-0', '[aria-modal="true"]']) {
    assert.equal(
      shouldDismissUnpinnedDictionaryOnClick(
        { target: makeTarget(modalSel) },
        { isOpen: true, isPinned: false, dockMode: 'side', panelEl, now: 1000 }
      ),
      false
    );
  }

  // 10. Empty-space click handler calls closeDictionary({ suppressGhostClick: false }) directly without setting __tipitaka_dict_just_closed
  const dictModalSrc = fs.readFileSync(path.join(rootDir, 'components/DictionaryModal.jsx'), 'utf8');
  const emptyHandlerMatch = dictModalSrc.match(/const handleEmptySpaceClick = \(e\) => \{([\s\S]*?)\n    \};/);
  assert.ok(emptyHandlerMatch, 'handleEmptySpaceClick should exist');
  assert.match(emptyHandlerMatch[1], /closeDictionary\(\{\s*suppressGhostClick:\s*false\s*\}\)/);
  assert.doesNotMatch(emptyHandlerMatch[1], /handleSafeDismiss\(/);

  // 11. Panel elements capture clicks/pointerdowns so unmounted in-dictionary word clicks never trigger empty-space dismissal
  assert.match(dictModalSrc, /onPointerDownCapture=\{markPointerDownInsideDictPanel\}/);
  assert.match(dictModalSrc, /onClickCapture=\{markInsideDictPanel\}/);
  assert.match(dictModalSrc, /e\.nativeEvent\.__tpoWordClicked\s*=\s*true/);
  assert.match(dictModalSrc, /e\.nativeEvent\.__tpoInsideDictPanel\s*=\s*true/);
  assert.match(dictModalSrc, /clearTimeout\(timer\);\s*pointerDownInsidePanelRef\.current\s*=\s*false;/);
});

test('isPointInsideRangeRects distinguishes actual word glyphs from empty margins and end-of-line space', () => {
  const noopComp = () => null;
  const { isPointInsideRangeRects } = compileModule('../components/Reader/ReaderView.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    './WelcomeView': { __esModule: true, default: noopComp },
    './MeditationLoader': { __esModule: true, default: noopComp },
    './BookTocView': { __esModule: true, default: noopComp },
    './LinkedDefinitionModal': { __esModule: true, default: noopComp },
    '../AiChat/AiChatView': { __esModule: true, default: noopComp },
    '../../context/TabContext': { useTabs: () => ({}) },
    '../../context/ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: {} }),
      getDefaultTranslationColorsForTheme: () => ({}),
    },
    '../../context/DictionaryContext': { useDictionary: () => ({}) },
    '../../services/transliterate': {
      transliterateHtml: (h) => h,
      convertPaliScript: (s) => s,
      highlightHtmlText: (h) => h,
      highlightTranslationText: (t) => t,
      capitalizePali: (s) => s,
      convertAnyToRoman: (s) => s,
      cleanDictionaryQuery: (s) => s,
    },
    '../../services/scroll': { smartScrollTo: () => {} },
    '../../services/api': {
      fetchChapterTranslations: async () => ({}),
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });

  const singleLineRange = {
    getClientRects: () => [{ left: 200, right: 280, top: 300, bottom: 328, width: 80, height: 28 }],
  };
  assert.equal(isPointInsideRangeRects(singleLineRange, 240, 314, 4), true, 'click inside word rect');
  assert.equal(isPointInsideRangeRects(singleLineRange, 283, 314, 4), true, 'click within 4px tolerance');
  assert.equal(isPointInsideRangeRects(singleLineRange, 450, 314, 4), false, 'empty space to right of short line');
  assert.equal(isPointInsideRangeRects(singleLineRange, 100, 314, 4), false, 'empty left margin');
  assert.equal(isPointInsideRangeRects(singleLineRange, 240, 345, 4), false, 'empty vertical gap between paragraphs');

  // Wrapped word spanning two lines
  const wrappedRange = {
    getClientRects: () => [
      { left: 720, right: 780, top: 300, bottom: 328, width: 60, height: 28 },
      { left: 200, right: 245, top: 332, bottom: 360, width: 45, height: 28 },
    ],
  };
  assert.equal(isPointInsideRangeRects(wrappedRange, 220, 344, 4), true);
  assert.equal(isPointInsideRangeRects(wrappedRange, 500, 344, 4), false);

  // Mock range with no layout geometry falls back safely to true
  assert.equal(isPointInsideRangeRects({ getClientRects: () => [] }, 0, 0, 4), true);
});

test('dpd-toggle-play-btn is enlarged, longer, and meets mobile 44px touch target requirements', () => {
  const css = fs.readFileSync(path.join(rootDir, 'app/globals.css'), 'utf8');
  const dictModalSrc = fs.readFileSync(path.join(rootDir, 'components/DictionaryModal.jsx'), 'utf8');

  const baseRuleMatch = css.match(/\.dp9\s+\.dpd-toggle-play-btn\s*\{([\s\S]*?)\}/);
  assert.ok(baseRuleMatch, 'Base .dp9 .dpd-toggle-play-btn rule must exist');
  const baseRule = baseRuleMatch[1];

  const baseInline = baseRule.match(/min-inline-size:\s*(\d+)px/);
  const baseBlock = baseRule.match(/min-block-size:\s*(\d+)px/);
  assert.ok(baseInline && Number(baseInline[1]) >= 64, 'Base button must be noticeably longer (>=64px)');
  assert.ok(baseBlock && Number(baseBlock[1]) >= 28, 'Base button must be taller (>=28px)');
  assert.match(baseRule, /touch-action:\s*manipulation/);
  assert.match(baseRule, /max-inline-size:\s*100%/);

  const mobileMediaMatch = css.match(
    /@media\s*\(pointer:\s*coarse\),\s*\(hover:\s*none\),\s*\(max-width:\s*767px\)\s*\{\s*\.dp9\s+\.dpd-toggle-play-btn\s*\{([\s\S]*?)\}/
  );
  assert.ok(mobileMediaMatch, 'Mobile/coarse-pointer media query for .dp9 .dpd-toggle-play-btn must exist');
  const mobileRule = mobileMediaMatch[1];
  const mobileInline = mobileRule.match(/min-inline-size:\s*(\d+)px/);
  const mobileBlock = mobileRule.match(/min-block-size:\s*(\d+)px/);
  assert.ok(mobileInline && Number(mobileInline[1]) >= 96, 'Mobile button must be long (>=96px)');
  assert.ok(mobileBlock && Number(mobileBlock[1]) >= 44, 'Mobile button must meet 44px WCAG 2.5.5 touch height');

  // Guard :hover for hover-capable pointers so iOS touch does not leave sticky hover,
  // provide keyboard :focus-visible outline, and prevent SVG compression.
  assert.match(
    css,
    /@media\s*\(hover:\s*hover\)\s*\{\s*\.dp9\s+\.dpd-toggle-play-btn:hover\s*\{/
  );
  assert.match(css, /\.dp9\s+\.dpd-toggle-play-btn:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(css, /\.dp9\s+\.dpd-toggle-play-btn\s+svg\s*\{[\s\S]*?flex-shrink:\s*0/);

  // Verify accessible button markup and scaled SVG icon in DictionaryModal
  assert.match(
    dictModalSrc,
    /class="dpd-toggle-play-btn"[^>]*aria-label="Toggle buttons"[^>]*aria-expanded="false"/
  );
  assert.match(
    dictModalSrc,
    /dpd-toggle-play-btn[\s\S]*?<svg[^>]*width="16"[^>]*height="16"[^>]*aria-hidden="true"/
  );
  assert.match(dictModalSrc, /toggleBtn\.setAttribute\('aria-expanded',\s*'true'\)/);
  assert.match(dictModalSrc, /toggleBtn\.setAttribute\('aria-expanded',\s*'false'\)/);
  // Keep aria-label steady so aria-expanded alone conveys state without redundancy
  assert.doesNotMatch(dictModalSrc, /toggleBtn\.setAttribute\('aria-label',/);
});

test('WebView buildLocalServerRecoveryScript recovers failed loopback fetches and ignores external/aborted fetches', async () => {
  const webviewDart = fs.readFileSync(
    path.join(rootDir, 'tipitakapali_org_app/lib/features/webview/tipitaka_webview_screen.dart'),
    'utf8'
  );
  const scriptMatch = webviewDart.match(
    /String buildLocalServerRecoveryScript\(\)\s*\{\s*return r'''([\s\S]*?)''';\s*\}/
  );
  assert.ok(scriptMatch, 'buildLocalServerRecoveryScript() must be present in tipitaka_webview_screen.dart');
  const recoveryJs = scriptMatch[1];

  const listeners = { document: {}, window: {} };
  const recoveryCalls = [];
  let serverAlive = false;
  let forceRebindNeeded = false;
  let nextPortChanged = false;
  let fetchAttempts = [];

  const mockDocument = {
    visibilityState: 'visible',
    addEventListener(type, fn) {
      listeners.document[type] = listeners.document[type] || [];
      listeners.document[type].push(fn);
    },
  };

  const sandbox = {
    URL,
    Promise,
    Error,
    TypeError,
    setTimeout,
    clearTimeout,
    document: mockDocument,
    window: null,
  };
  let hangNextCallHandler = false;
  const mockWindow = {
    __tpoRecoveryTimeoutMs: 60,
    __tpoBridgeWaitMs: 60,
    __tpoPortRemountHoldMs: 500,
    location: { href: 'http://127.0.0.1:8899/book/s0101m.mul', origin: 'http://127.0.0.1:8899', hostname: '127.0.0.1' },
    addEventListener(type, fn) {
      listeners.window[type] = listeners.window[type] || [];
      listeners.window[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners.window[type]) return;
      listeners.window[type] = listeners.window[type].filter((f) => f !== fn);
    },
    flutter_inappwebview: {
      callHandler(name, payload) {
        recoveryCalls.push({ name, payload });
        if (hangNextCallHandler) {
          hangNextCallHandler = false;
          return new Promise(() => {}); // Never resolves: must hit timeout & clear activeRecovery
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            if (nextPortChanged) {
              resolve({ ok: true, restarted: true, portChanged: true });
              return;
            }
            if (forceRebindNeeded && !payload?.forceRebind) {
              resolve({ ok: true, restarted: false, portChanged: false });
              return;
            }
            serverAlive = true;
            forceRebindNeeded = false;
            resolve({ ok: true, restarted: true, portChanged: false });
          }, 10);
        });
      },
    },
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      fetchAttempts.push(url);
      if (url.startsWith('https://')) {
        throw new TypeError('Load failed');
      }
      if (!serverAlive) {
        throw new TypeError('Load failed');
      }
      return { ok: true, status: 200, url };
    },
  };
  sandbox.window = mockWindow;
  vm.runInNewContext(recoveryJs, sandbox);

  // 1. Parallel dictionary lookups while server socket is dead deduplicate into 1 recovery call & all succeed
  const [r1, r2, r3] = await Promise.all([
    mockWindow.fetch('/api/dict/lookup?w=dhamma&dict=dpd'),
    mockWindow.fetch('/api/dict/lookup?w=dhamma&dict=others'),
    mockWindow.fetch('/api/dict/lookup?w=dhamma&dict=bold_def'),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 200);
  assert.equal(recoveryCalls.length, 1, 'Parallel failed loopback fetches must share one recovery call');
  assert.equal(recoveryCalls[0].name, 'ensureLocalServerAlive');

  // 2. When first retry still hits a stale keep-alive socket, second recovery escalates with forceRebind=true
  serverAlive = false;
  forceRebindNeeded = true;
  recoveryCalls.length = 0;
  const bookRes = await mockWindow.fetch('/api/book/s0101m.mul?tocOnly=true');
  assert.equal(bookRes.status, 200);
  assert.equal(recoveryCalls.length, 2);
  assert.equal(recoveryCalls[0].payload.forceRebind, false);
  assert.equal(recoveryCalls[1].payload.forceRebind, true);

  // 3. External HTTPS URL failures must NOT trigger local server recovery
  recoveryCalls.length = 0;
  await assert.rejects(
    () => mockWindow.fetch('https://api.tipitakapali.org/api/ai/tools'),
    /Load failed/
  );
  assert.equal(recoveryCalls.length, 0);

  // 4. Aborted local fetch must NOT trigger local server recovery
  serverAlive = false;
  recoveryCalls.length = 0;
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => mockWindow.fetch('/api/dict/lookup?w=nibbana', { signal: ac.signal }),
    /Load failed/
  );
  assert.equal(recoveryCalls.length, 0);

  // 5. visibilitychange hidden -> visible proactively calls ensureLocalServerAlive
  mockDocument.visibilityState = 'hidden';
  for (const fn of listeners.document.visibilitychange || []) fn();
  mockDocument.visibilityState = 'visible';
  for (const fn of listeners.document.visibilitychange || []) fn();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(recoveryCalls.length, 1);
  assert.equal(recoveryCalls[0].payload.reason, 'visibility_resume');

  // 6. Hung native callHandler times out cleanly without deadlocking subsequent recoveries
  serverAlive = false;
  hangNextCallHandler = true;
  recoveryCalls.length = 0;
  await assert.rejects(() => mockWindow.fetch('/api/dict/lookup?w=metta&dict=dpd'), /Load failed/);
  assert.equal(recoveryCalls.length, 1);
  // Immediately subsequent fetch recovers normally because activeRecovery was cleared
  const afterTimeout = await mockWindow.fetch('/api/dict/lookup?w=metta&dict=dpd');
  assert.equal(afterTimeout.status, 200);
  assert.equal(recoveryCalls.length, 2);

  // 7. Early fetch before native bridge attaches waits for flutterInAppWebViewPlatformReady
  serverAlive = false;
  recoveryCalls.length = 0;
  const savedBridge = mockWindow.flutter_inappwebview;
  mockWindow.flutter_inappwebview = null;
  setTimeout(() => {
    mockWindow.flutter_inappwebview = savedBridge;
    for (const fn of [...(listeners.window.flutterInAppWebViewPlatformReady || [])]) fn();
  }, 15);
  const lateBridgeRes = await mockWindow.fetch('/api/book/s0101m.mul?tocOnly=true');
  assert.equal(lateBridgeRes.status, 200);
  assert.equal(recoveryCalls.length, 1);

  // 8. portChanged hold honors caller AbortSignal immediately without waiting out the remount timer
  serverAlive = false;
  nextPortChanged = true;
  const acRemount = new AbortController();
  const remountStart = Date.now();
  const remountPromise = mockWindow.fetch('/api/book/s0101m.mul?tocOnly=true', { signal: acRemount.signal });
  setTimeout(() => acRemount.abort(), 30);
  await assert.rejects(() => remountPromise, /Load failed/);
  assert.ok(Date.now() - remountStart < 300, 'portChanged hold must reject promptly when caller aborts');
  nextPortChanged = false;
});

test('TabContext avoids false 404 on transient network errors for known books and DictionaryContext retries after error', () => {
  const tabCtxMod = compileModule('../context/TabContext.jsx', {
    react: React,
    '../services/api': {
      fetchBook: async () => ({}),
      fetchChapter: async () => ({}),
      fetchChapterBundle: async () => ({}),
      isLocalDynamicHost: () => false,
      fetchMat: async () => null,
      fetchMatJump: async () => null,
      lookupBookInfo: () => null,
      fetchBookTocOnly: async () => ({}),
    },
    '../services/transliterate': { splitScriptCode: (c) => ({ bookCode: c, prefix: null }) },
    './ThemeSettingsContext': { useThemeSettings: () => ({ settings: {}, updateSetting: () => {} }) },
  });

  const { shouldTreatBookLoadErrorAsNotFound } = tabCtxMod;
  const knownBook = { title: 'Dīghanikāya', nikaya: 'Sutta' };

  // Transient network error (TypeError: Load failed, no HTTP status) on a known tree book is NOT a 404
  assert.equal(shouldTreatBookLoadErrorAsNotFound(new TypeError('Load failed'), knownBook), false);
  // HTTP 500/503 server restart errors are NOT a 404
  assert.equal(shouldTreatBookLoadErrorAsNotFound(Object.assign(new Error('503'), { status: 503 }), knownBook), false);
  // Real HTTP 404 / 400 IS a 404 even if bookInfo existed
  assert.equal(shouldTreatBookLoadErrorAsNotFound(Object.assign(new Error('404'), { status: 404 }), knownBook), true);
  assert.equal(shouldTreatBookLoadErrorAsNotFound(Object.assign(new Error('400'), { status: 400 }), knownBook), true);
  // Unknown book code (not in tree) still shows 404
  assert.equal(shouldTreatBookLoadErrorAsNotFound(new Error('Failed'), null), true);

  // Verify services/api.js attaches HTTP status and DictionaryContext does not cache failed lookups on repeat tap
  const apiSrc = fs.readFileSync(path.join(rootDir, 'services/api.js'), 'utf8');
  assert.match(apiSrc, /err\.status\s*=\s*res\.status/);
  const dictCtxSrc = fs.readFileSync(path.join(rootDir, 'context/DictionaryContext.jsx'), 'utf8');
  assert.match(dictCtxSrc, /!lookupDataRef\.current\?\._hadError/);
  assert.match(dictCtxSrc, /mergedData\._hadError\s*=\s*true/);
});
