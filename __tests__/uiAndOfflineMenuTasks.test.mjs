import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

const noop = () => {};
const iconProxy = new Proxy(
  {},
  {
    get: (_, prop) => (props) =>
      React.createElement('svg', { 'data-icon': String(prop), ...props }),
  }
);

// =========================================================================
// Task 1: Tipitaka Tree Non-Shifting Floating Overlay
// =========================================================================

test('NavigationTree renders floating overlay by default (tree-floating) and pinned (tree-pinned) when pinned', () => {
  const makeNavTree = (tabOverrides = {}) =>
    compileModule('../components/NavigationTree/NavigationTree.jsx', {
      react: React,
      'lucide-react': iconProxy,
      './TreeNode': { __esModule: true, default: () => null },
      '../HelpModal': { __esModule: true, default: () => null },
      '../../services/api': { fetchTree: async () => [] },
      '../../context/TabContext': {
        useTabs: () => ({
          isSidebarOpen: true,
          setIsSidebarOpen: noop,
          treeSelectedNode: null,
          isTreePinned: false,
          toggleTreePinned: noop,
          isHeaderVisible: true,
          ...tabOverrides,
        }),
      },
      '../../context/ThemeSettingsContext': {
        useThemeSettings: () => ({ settings: { paliScript: 'roman' } }),
      },
      '../../context/DictionaryContext': {
        useDictionary: () => ({ isOpen: false, closeDictionary: noop }),
      },
      '../../services/transliterate': {
        typeVelthuis: (v) => v,
        convertPaliScript: (v) => v,
        normalizePaliForSearch: (v) => v,
      },
    });

  const unpinnedMod = makeNavTree({ isTreePinned: false });
  const unpinnedHtml = renderToStaticMarkup(React.createElement(unpinnedMod.default));
  assert.match(unpinnedHtml, /class="app-sidebar dock-left tree-floating\b/);
  assert.doesNotMatch(unpinnedHtml, /tree-pinned/);
  assert.match(unpinnedHtml, /aria-label="Pin Navigation Tree"/);
  assert.match(unpinnedHtml, /aria-pressed="false"/);

  const pinnedMod = makeNavTree({ isTreePinned: true });
  const pinnedHtml = renderToStaticMarkup(React.createElement(pinnedMod.default));
  assert.match(pinnedHtml, /class="app-sidebar dock-left tree-pinned\b/);
  assert.doesNotMatch(pinnedHtml, /tree-floating/);
  assert.match(pinnedHtml, /aria-label="Unpin Navigation Tree"/);
  assert.match(pinnedHtml, /aria-pressed="true"/);
});

test('shouldDismissUnpinnedTreeOnClick closes unpinned tree on empty/outside click and ignores triggers, modals, selections, and pinned state', () => {
  const navMod = compileModule('../components/NavigationTree/NavigationTree.jsx', {
    react: React,
    'lucide-react': iconProxy,
    './TreeNode': { __esModule: true, default: () => null },
    '../HelpModal': { __esModule: true, default: () => null },
    '../../services/api': { fetchTree: async () => [] },
    '../../context/TabContext': { useTabs: () => ({}) },
    '../../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: {} }) },
    '../../context/DictionaryContext': { useDictionary: () => ({}) },
    '../../services/transliterate': {
      typeVelthuis: (v) => v,
      convertPaliScript: (v) => v,
      normalizePaliForSearch: (v) => v,
    },
  });

  const { shouldDismissUnpinnedTreeOnClick } = navMod;
  const panelEl = { contains: (node) => Boolean(node?._insidePanel) };
  const makeTarget = ({ insidePanel = false, closestMatch = null } = {}) => ({
    _insidePanel: insidePanel,
    closest: (sel) => (closestMatch && sel.includes(closestMatch) ? {} : null),
  });

  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget() },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl }
    ),
    true
  );

  // Inside tree panel -> keep open
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget({ insidePanel: true }) },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl }
    ),
    false
  );

  // Sidebar toggle trigger -> keep open so Header button handles toggle cleanly
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget({ closestMatch: '[data-sidebar-trigger]' }) },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl }
    ),
    false
  );

  // Open dialog/modal -> ignore
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget({ closestMatch: '[aria-modal="true"]' }) },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl }
    ),
    false
  );

  // Active text selection -> ignore
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget() },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl, selectionText: 'dhamma' }
    ),
    false
  );

  // Recent resize -> ignore
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget() },
      { isOpen: true, isPinned: false, dockPosition: 'left', panelEl, lastResizeEndTime: 1000, now: 1100 }
    ),
    false
  );

  // Pinned or floating-window dock mode -> never auto-dismiss
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget() },
      { isOpen: true, isPinned: true, dockPosition: 'left', panelEl }
    ),
    false
  );
  assert.equal(
    shouldDismissUnpinnedTreeOnClick(
      { target: makeTarget() },
      { isOpen: true, isPinned: false, dockPosition: 'float', panelEl }
    ),
    false
  );
});

test('Header tree triggers carry data-sidebar-trigger + aria-expanded, and globals.css / TabContext wire non-shifting floating tree', () => {
  const headerMod = compileModule('../components/Header.jsx', {
    react: React,
    'lucide-react': iconProxy,
    './LanguageMenu': { __esModule: true, default: () => null },
    './HelpModal': { __esModule: true, default: () => null },
    '../context/ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { theme: 'classic' }, updateSetting: noop, openSettingsModal: noop }),
    },
    '../context/DictionaryContext': {
      useDictionary: () => ({ openDictionary: noop, closeDictionary: noop, isOpen: false }),
    },
    '../context/TabContext': {
      useTabs: () => ({
        toggleSidebar: noop,
        isSidebarOpen: true,
        isHeaderVisible: true,
        openSearchModal: noop,
        setIsBookmarkOpen: noop,
        openAiChatTab: noop,
      }),
    },
  });

  const headerHtml = renderToStaticMarkup(React.createElement(headerMod.default));
  const triggerMatches = headerHtml.match(/data-sidebar-trigger="true"/g) || [];
  assert.equal(triggerMatches.length, 2);
  assert.match(headerHtml, /data-sidebar-trigger="true"[^>]*aria-expanded="true"/);

  const cssSrc = fs.readFileSync(path.join(rootDir, 'app/globals.css'), 'utf8');
  assert.match(cssSrc, /aside\.app-sidebar\.tree-floating\s*\{[^}]*position:\s*fixed/);
  assert.match(cssSrc, /aside\.app-sidebar\.tree-pinned\.dock-left\.collapsed/);
  assert.match(cssSrc, /aside\.app-sidebar\.tree-pinned\.dock-right\.collapsed/);
  assert.match(cssSrc, /body\.window-scroll aside\.app-sidebar\.tree-pinned/);

  const tabSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  assert.match(tabSrc, /TREE_PINNED_STORAGE_KEY\s*=\s*'tipitaka_tree_pinned_v1'/);
  assert.match(tabSrc, /shiftsLayout:\s*Boolean\(isTreePinnedRef\.current && window\.innerWidth >= 768\)/);
});

// =========================================================================
// Task 2: Word Click Lookup Inside Dictionary Panel & Unpinned Reader Click
// =========================================================================

test('extractWordFromPointerEvent resolves words in TEXT_NODE, ELEMENT_NODE, multiple Pāḷi scripts, combining marks, and rejects outside rects', () => {
  const dictMod = compileModule('../components/DictionaryModal.jsx', {
    react: React,
    'lucide-react': iconProxy,
    '../context/DictionaryContext': {
      useDictionary: () => ({}),
      DEFAULT_DICT_ORDER: [],
      DEFAULT_DICT_ENABLED: {},
    },
    '../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: {} }) },
    '../context/TabContext': { useTabs: () => ({}) },
    './BoldDefinitionSection': { __esModule: true, default: () => null },
    '../services/transliterate': compileModule('../services/transliterate.js', {}),
    '../services/api': { fetchDictionaryInflection: async () => null },
    '../services/dpdFeedback': { restoreMinifiedLinks: (s) => s },
  });

  const { extractWordFromPointerEvent } = dictMod;
  const origDoc = globalThis.document;

  try {
    const createNodeRange = (rect) => ({
      setStart() {},
      setEnd() {},
      selectNodeContents() {},
      getClientRects: () => (rect ? [rect] : []),
    });

    // 1. Direct TEXT_NODE hit in Devanagari + combining marks
    const devTextNode = { nodeType: 3, textContent: 'नमो बुद्धाय धम्मो' };
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: devTextNode, startOffset: 5 }),
      createRange: () => createNodeRange({ left: 10, top: 10, right: 100, bottom: 30, width: 90, height: 20 }),
    };
    assert.equal(extractWordFromPointerEvent({ clientX: 40, clientY: 20 }), 'बुद्धाय');

    // 2. ELEMENT_NODE hit (e.g. clicking inside <b>dhamma</b>) + NFD combining diacritics
    const bTextNode = { nodeType: 3, textContent: 'samādhiṃ' };
    const bElNode = { nodeType: 1, childNodes: [bTextNode] };
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: bElNode, startOffset: 0 }),
      createRange: () => createNodeRange({ left: 50, top: 20, right: 120, bottom: 40, width: 70, height: 20 }),
      createTreeWalker: () => ({ nextNode: () => null }),
    };
    assert.equal(extractWordFromPointerEvent({ clientX: 80, clientY: 30 }), 'samādhiṃ');

    // 3. Rejects click far outside glyph rect
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: devTextNode, startOffset: 1 }),
      createRange: () => createNodeRange({ left: 10, top: 10, right: 40, bottom: 25, width: 30, height: 15 }),
    };
    assert.equal(extractWordFromPointerEvent({ clientX: 250, clientY: 20 }), '');
  } finally {
    globalThis.document = origDoc;
  }
});

test('DictionaryModal clears stale non-dragged selection, cleans homonym jump digits, and allows non-href links', () => {
  const dictSrc = fs.readFileSync(path.join(rootDir, 'components/DictionaryModal.jsx'), 'utf8');
  assert.match(dictSrc, /window\.getSelection\(\)\?\.removeAllRanges\?\.\(\)/);
  assert.match(dictSrc, /\.replace\(\/\\s\+\\d\+\(\?:\\\.\\d\+\)\*\\s\*\$\/,\s*''\)/);
  assert.match(dictSrc, /'button, input, a\[href\], a\.dpd-button, a\.button/);
  assert.doesNotMatch(dictSrc, /'button, input, a, select/);

  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');
  assert.match(readerSrc, /function resolveReaderTextNodeAndOffset\(/);
});

// =========================================================================
// Task 3: Do Not Reload All Last Opened Pages on App Reopen
// =========================================================================

test('TabContext startup mount preserves bookmarks/history/scrolls without auto-restoring STORAGE_KEYS.TABS or ACTIVE', () => {
  const tabSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  const mountBlockMatch = tabSrc.match(/useIsomorphicLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\]\);/);
  assert.ok(mountBlockMatch, 'expected mount useIsomorphicLayoutEffect in TabContext.jsx');
  const mountBlock = mountBlockMatch[0];

  assert.match(mountBlock, /STORAGE_KEYS\.BOOKMARKS/);
  assert.match(mountBlock, /STORAGE_KEYS\.HISTORY/);
  assert.match(mountBlock, /STORAGE_KEYS\.SCROLL/);
  assert.doesNotMatch(mountBlock, /STORAGE_KEYS\.TABS/);
  assert.doesNotMatch(mountBlock, /STORAGE_KEYS\.ACTIVE/);
  assert.doesNotMatch(mountBlock, /restoredSessionRef\.current\s*=\s*true/);
});

// =========================================================================
// Task 4: Tab View Mode Order ("Columns Tabs Single") & Sync Next to Columns
// =========================================================================

test('BookTabsBar renders Sync immediately next to Columns with order Columns -> Tabs -> Single, matching SettingsModal', () => {
  const bookTabsMod = compileModule('../components/BookTabsBar.jsx', {
    react: React,
    'lucide-react': iconProxy,
    '../context/TabContext': {
      useTabs: () => ({
        openTabs: [
          { bookCode: 's0101m.mul', title: 'Sīlakkhandhavagga', type: 'book' },
          { bookCode: 's0101a.att', title: 'Sīlakkhandhavagga-aṭṭhakathā', type: 'book' },
        ],
        activeBookCode: 's0101m.mul',
        switchTab: noop,
        openAlongside: noop,
        closeTab: noop,
        closeOtherTabs: noop,
        closeAllTabs: noop,
        closeLeftTabs: noop,
        closeRightTabs: noop,
        reorderTabs: noop,
        recentHistory: [],
        setIsHistoryOpen: noop,
        isSidebarOpen: false,
        isHeaderVisible: true,
        setIsSidebarOpen: noop,
        setIsHeaderVisible: noop,
      }),
    },
    '../context/ThemeSettingsContext': {
      useThemeSettings: () => ({
        settings: { tabView: 'columns', syncScroll: true, paliScript: 'roman', maxColumns: 3 },
        updateSetting: noop,
      }),
    },
    '../services/transliterate': { convertPaliScript: (s) => s, capitalizePali: (s) => s },
    '../services/api': {
      lookupBookInfo: async () => null,
      fetchMat: async () => null,
    },
    './Reader/ReaderView': {
      getBookLayerInfo: () => ({ label: 'Mūla', layer: 'mula', siblings: [] }),
    },
    'react-dom': { createPortal: (node) => node },
  });

  const html = renderToStaticMarkup(React.createElement(bookTabsMod.default));
  const groupMatch = html.match(/aria-label="Tab view mode"[\s\S]*?<\/div>/);
  assert.ok(groupMatch, 'expected Tab view mode button group');
  const groupHtml = groupMatch[0];

  const colIdx = groupHtml.indexOf('>Columns<');
  const tabsIdx = groupHtml.indexOf('>Tabs<');
  const singleIdx = groupHtml.indexOf('>Single<');
  assert.ok(colIdx !== -1 && tabsIdx !== -1 && singleIdx !== -1, 'all 3 view mode labels rendered');
  assert.ok(colIdx < tabsIdx && tabsIdx < singleIdx, `expected Columns < Tabs < Single, got ${colIdx}, ${tabsIdx}, ${singleIdx}`);

  // Sync button sits immediately before the Tab view mode group (directly adjacent to Columns)
  const syncIdx = html.indexOf('>Sync<');
  const groupStartIdx = html.indexOf('role="group" aria-label="Tab view mode"');
  assert.ok(syncIdx !== -1 && syncIdx < groupStartIdx, 'Sync button renders directly before [Columns | Tabs | Single] group');

  // Verify SettingsModal also uses Parallel Columns -> Multi-Tabs -> Single Tab order
  const settingsSrc = fs.readFileSync(path.join(rootDir, 'components/Settings/SettingsModal.jsx'), 'utf8');
  const sCol = settingsSrc.indexOf("{ id: 'columns'");
  const sTab = settingsSrc.indexOf("{ id: 'tabbed'");
  const sSingle = settingsSrc.indexOf("{ id: 'single'");
  assert.ok(sCol !== -1 && sCol < sTab && sTab < sSingle);
});

// =========================================================================
// Task 5: Redesigned 2-Zone Language Menu (Web & Offline)
// =========================================================================

function loadLanguageMenuWithSettings(settingsOverrides = {}, envStub = {}) {
  return compileModule('../components/LanguageMenu.jsx', {
    react: React,
    'lucide-react': iconProxy,
    '../context/ThemeSettingsContext': {
      useThemeSettings: () => ({
        settings: {
          theme: 'classic',
          paliScript: 'roman',
          translationDisplayMode: 'stack',
          translationGranularity: 'sentence',
          showTranslationBorders: true,
          showBookLinks: true,
          translations: { pali: true, english: true },
          translationOrder: ['pali', 'english', 'vietnamese'],
          translationColors: {},
          ...settingsOverrides,
        },
        updateSetting: noop,
        isLanguageMenuOpen: true,
        setIsLanguageMenuOpen: noop,
      }),
      getDefaultTranslationSlotColor: () => '#2563eb',
    },
    '../services/transliterate': {
      PALI_SCRIPTS_LIST: [{ id: 'roman', label: 'Roman', native: 'Roman' }],
    },
    '../services/api': {
      invalidateSearchDatabasesCache: noop,
    },
    ...envStub,
  });
}

test('LanguageMenu renders 2 zones (Enabled including Pali + order/colors; Available with info + switch) in web mode', () => {
  const mod = loadLanguageMenuWithSettings();
  const html = renderToStaticMarkup(
    React.createElement(mod.default, { forceOfflineMode: false })
  );

  assert.match(html, /data-tpo-native-lang-menu="1"/);

  const enabledZoneMatch = html.match(/<section data-zone="enabled"[\s\S]*?<\/section>/);
  const availZoneMatch = html.match(/<section data-zone="available"[\s\S]*?<\/section>/);
  assert.ok(enabledZoneMatch, 'Enabled section rendered');
  assert.ok(availZoneMatch, 'Available section rendered');

  const enabledHtml = enabledZoneMatch[0];
  const availHtml = availZoneMatch[0];

  // Enabled includes Pali + English, with Customize colors + reorder buttons + switch
  assert.match(enabledHtml, /data-lang-id="pali"/);
  assert.match(enabledHtml, /data-lang-id="english"/);
  assert.doesNotMatch(enabledHtml, /data-lang-id="vietnamese"/);
  assert.match(enabledHtml, /Customize colors for Pāḷi/);
  assert.match(enabledHtml, /Move English up/);
  assert.match(enabledHtml, /type="checkbox" switch=""/);

  // Available has Vietnamese with info + switch, and web mode does NOT render Check / Databases / Download / Delete
  assert.match(availHtml, /data-lang-id="vietnamese"/);
  assert.doesNotMatch(availHtml, /data-lang-id="pali"/);
  assert.match(availHtml, /Bản dịch Tiếng Việt/);
  assert.match(availHtml, /type="checkbox" switch=""/);
  assert.doesNotMatch(html, /aria-label="Check for translation updates"/);
  assert.doesNotMatch(html, />Databases</);
  assert.doesNotMatch(availHtml, /aria-label="Download Vietnamese"/);
});

test('LanguageMenu offline mode renders Check in footer (no Databases button, no As Sentence download icon), Update on enabled/outdated, Download and Delete on available', () => {
  const mod = loadLanguageMenuWithSettings();
  const html = renderToStaticMarkup(
    React.createElement(mod.default, {
      forceOfflineMode: true,
      initialOfflineState: {
        installedCodes: ['en', 'vi'],
        ftsCodes: ['en', 'vi'],
        updates: {
          en: { version: 2, updated: '2026-11-18', zipSize: 1000, dbSize: 2000 },
          vi: { version: 3, updated: '2026-11-18', zipSize: 1000, dbSize: 2000 },
        },
        catalog: {
          en: { version: 2, zipSize: 148680191 },
          vi: { version: 3, zipSize: 120000000 },
          my: { version: 1, zipSize: 95000000 },
        },
        hasPaliSentences: false,
        fetchedLiveRelease: true,
      },
    })
  );

  // Task 1: Databases button removed; Check button with RefreshCw icon moved to footer before Restore default
  assert.doesNotMatch(html, />Databases</);
  assert.doesNotMatch(html, />Check for Update</);
  assert.match(html, /aria-label="Check for translation updates"[^>]*>[\s\S]*?data-icon="RefreshCw"[\s\S]*?<span>Check<\/span><\/button>/);
  const checkBtnIdx = html.indexOf('aria-label="Check for translation updates"');
  const restoreBtnIdx = html.indexOf('>Restore default<');
  assert.ok(checkBtnIdx !== -1 && restoreBtnIdx !== -1 && checkBtnIdx < restoreBtnIdx, 'Check button sits in footer before Restore default');

  // Task 2: "As Sentence" button does NOT render a Download icon even when hasPaliSentences is false
  const asSentenceMatch = html.match(/<button[^>]*aria-label="Show Pāḷi and translations sentence by sentence"[\s\S]*?<\/button>/);
  assert.ok(asSentenceMatch, 'As Sentence button rendered');
  assert.doesNotMatch(asSentenceMatch[0], /data-icon="Download"/);

  assert.match(html, /2 downloaded \/ 23/);
  assert.match(html, /2 translation updates available/);
  const availSectionEndIdx = html.lastIndexOf('</section>');
  const updateBannerIdx = html.indexOf('2 translation updates available');
  assert.ok(
    availSectionEndIdx !== -1 &&
      updateBannerIdx > availSectionEndIdx &&
      updateBannerIdx < checkBtnIdx,
    'Offline update status banner sits pinned above footer directly above Check button'
  );
  assert.match(html, /<button[^>]*whitespace-nowrap[^>]*aria-label="Check for translation updates"/);

  const enabledHtml = html.match(/<section data-zone="enabled"[\s\S]*?<\/section>/)?.[0] || '';
  const availHtml = html.match(/<section data-zone="available"[\s\S]*?<\/section>/)?.[0] || '';

  // Enabled English shows Update button when update available; Pali does not
  assert.match(enabledHtml, /aria-label="Update English"/);
  assert.doesNotMatch(enabledHtml, /aria-label="Update Pāḷi/);

  // Available Vietnamese is downloaded + outdated -> shows Update + Delete + switch
  assert.match(availHtml, /aria-label="Update Tiếng Việt"/);
  assert.match(availHtml, /aria-label="Delete Tiếng Việt"/);
  assert.match(availHtml, /Downloaded \+ Search/);

  // Available Myanmar is NOT downloaded -> shows Download (size) + switch, no Delete
  assert.match(availHtml, /aria-label="Download မြန်မာ"/);
  assert.match(availHtml, /Download \(90\.6 MB\)/);
  assert.doesNotMatch(availHtml, /aria-label="Delete မြန်မာ"/);
});

test('moveEnabledLanguageOrder swaps adjacent enabled items cleanly across disabled gaps', () => {
  const mod = loadLanguageMenuWithSettings();
  const { moveEnabledLanguageOrder } = mod;

  const order = ['pali', 'english', 'myanmar', 'sinhala', 'vietnamese'];
  const enabled = ['pali', 'english', 'vietnamese'];

  // Moving 'vietnamese' UP swaps it directly before 'english', skipping disabled 'myanmar'/'sinhala'
  const movedUp = moveEnabledLanguageOrder(order, enabled, 'vietnamese', 'up');
  assert.deepEqual(
    movedUp.filter((id) => enabled.includes(id)),
    ['pali', 'vietnamese', 'english']
  );

  // Moving 'english' DOWN swaps it after 'vietnamese'
  const movedDown = moveEnabledLanguageOrder(order, enabled, 'english', 'down');
  assert.deepEqual(
    movedDown.filter((id) => enabled.includes(id)),
    ['pali', 'vietnamese', 'english']
  );
});

test('Review fixes: sibling text node boundary hit, 767px mobile breakpoint, sidebar triggers, and offline FTS cache sync', () => {
  const dictMod = compileModule('../components/DictionaryModal.jsx', {
    react: React,
    'lucide-react': iconProxy,
    '../context/DictionaryContext': {
      useDictionary: () => ({}),
      DEFAULT_DICT_ORDER: [],
      DEFAULT_DICT_ENABLED: {},
    },
    '../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: {} }) },
    '../context/TabContext': { useTabs: () => ({}) },
    './BoldDefinitionSection': { __esModule: true, default: () => null },
    '../services/transliterate': compileModule('../services/transliterate.js', {}),
    '../services/api': { fetchDictionaryInflection: async () => null },
    '../services/dpdFeedback': { restoreMinifiedLinks: (s) => s },
  });

  const origDoc = globalThis.document;
  try {
    // Sibling text node boundary: "masc. " ends at x=100, <b>buddha</b> starts at x=101;
    // clicking at x=104 must resolve "buddha" instead of snapping to "masc. " within 6px tolerance.
    const prefixNode = { nodeType: 3, textContent: 'masc. ' };
    const boldTextNode = { nodeType: 3, textContent: 'buddha' };
    const boldEl = { nodeType: 1, childNodes: [boldTextNode] };
    const pEl = { nodeType: 1, childNodes: [prefixNode, boldEl] };

    const makeRect = (left, right) => [{ left, top: 10, right, bottom: 30, width: right - left, height: 20 }];
    const nodeRect = (node) => {
      if (node === prefixNode) return makeRect(50, 100);
      if (node === boldTextNode) return makeRect(101, 160);
      return makeRect(50, 160);
    };

    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: pEl, startOffset: 1 }),
      createRange: () => {
        let targetNode = null;
        return {
          setStart(n) { targetNode = n; },
          setEnd() {},
          selectNodeContents(n) { targetNode = n; },
          getClientRects: () => nodeRect(targetNode),
        };
      },
      createTreeWalker: (root) => {
        const nodes = root === prefixNode ? [prefixNode] : root === boldEl ? [boldTextNode] : [prefixNode, boldTextNode];
        let idx = 0;
        return { nextNode: () => nodes[idx++] || null };
      },
    };

    assert.equal(dictMod.extractWordFromPointerEvent({ clientX: 104, clientY: 20 }), 'buddha');
  } finally {
    globalThis.document = origDoc;
  }

  // 768px desktop breakpoint not clobbered by mobile drawer rule
  const cssSrc = fs.readFileSync(path.join(rootDir, 'app/globals.css'), 'utf8');
  assert.match(cssSrc, /@media\s*\(max-width:\s*767px\)\s*\{\s*\.tree-action-dock/);

  // TabContext wraps setIsSidebarOpen with before-layout-shift and WelcomeView/ReaderView mark triggers
  const tabSrc = fs.readFileSync(path.join(rootDir, 'context/TabContext.jsx'), 'utf8');
  assert.match(tabSrc, /const setIsSidebarOpen = useCallback\(/);
  const welcomeSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/WelcomeView.jsx'), 'utf8');
  assert.match(welcomeSrc, /data-sidebar-trigger="true"/);
  const readerSrc = fs.readFileSync(path.join(rootDir, 'components/Reader/ReaderView.jsx'), 'utf8');
  assert.match(readerSrc, /data-sidebar-trigger="true"[\s\S]{0,140}onClick=\{handleBreadcrumbClick\}/);

  // SearchModal & api.js support live FTS cache invalidation on offline delete/download/update
  const apiSrc = fs.readFileSync(path.join(rootDir, 'services/api.js'), 'utf8');
  assert.match(apiSrc, /export function invalidateSearchDatabasesCache\(/);
  const searchSrc = fs.readFileSync(path.join(rootDir, 'components/Search/SearchModal.jsx'), 'utf8');
  assert.match(searchSrc, /tipitaka:fts-databases-changed/);
});
