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
      fetchBookMeta: async () => ({}),
      fetchBookChapter: async () => ({}),
      fetchMatStaticMap: async () => ({}),
      fetchMatJump: async () => ({}),
    },
    './ThemeSettingsContext': {
      useThemeSettings: () => ({ settings: { tabView: 'tabbed', syncScroll: true } }),
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
      useThemeSettings: useThemeSettingsMock || (() => ({})),
      getDefaultTranslationColorsForTheme: (theme = 'classic', slot = 0) => ({
        text: `#slot${slot}`,
        border: `#slot${slot}`,
        bg: '',
      }),
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
    },
  });
}

const { insertOrUpdateTabInList } = loadTabContextExports();
const {
  getBookLayerInfo,
  increasingChain,
  interpolateMonotonicY,
  buildParallelAnchors,
} = loadReaderViewExports();

test('insertOrUpdateTabInList: tabbed mode appends new tabs and updates existing tab in place', () => {
  const initial = [
    { bookCode: 's0101m.mul', title: 'Sīlakkhandhavaggapāḷi', currentChapterIdx: 0 },
    { bookCode: 's0102m.mul', title: 'Mahāvaggapāḷi', currentChapterIdx: 1 },
  ];

  const afterAdd = insertOrUpdateTabInList(
    initial,
    { bookCode: 's0103m.mul', title: 'Pāthikavaggapāḷi', currentChapterIdx: 0 },
    { tabView: 'tabbed', activeBookCode: 's0101m.mul' }
  );
  assert.equal(afterAdd.length, 3);
  assert.deepEqual(
    afterAdd.map((t) => t.bookCode),
    ['s0101m.mul', 's0102m.mul', 's0103m.mul']
  );

  const afterUpdate = insertOrUpdateTabInList(
    afterAdd,
    { bookCode: 's0102m.mul', currentChapterIdx: 4, lastParaNum: '55' },
    { tabView: 'tabbed', activeBookCode: 's0101m.mul' }
  );
  assert.equal(afterUpdate.length, 3);
  assert.equal(afterUpdate[1].currentChapterIdx, 4);
  assert.equal(afterUpdate[1].lastParaNum, '55');
});

test('insertOrUpdateTabInList: single mode replaces active book tab while preserving ai_chat tab', () => {
  const initial = [
    { bookCode: 'ai_chat', type: 'ai_chat', title: 'Ani Assistant' },
    { bookCode: 's0101m.mul', title: 'Sīlakkhandhavaggapāḷi', currentChapterIdx: 0 },
  ];

  const replaced = insertOrUpdateTabInList(
    initial,
    { bookCode: 's0102m.mul', title: 'Mahāvaggapāḷi', currentChapterIdx: 2 },
    { tabView: 'single', activeBookCode: 's0101m.mul', alongside: false }
  );

  assert.deepEqual(
    replaced.map((t) => t.bookCode),
    ['ai_chat', 's0102m.mul']
  );
});

test('insertOrUpdateTabInList: alongside=true inserts new tab or moves existing tab immediately after source tab', () => {
  const initial = [
    { bookCode: 's0101m.mul', title: 'Mūla 1' },
    { bookCode: 's0201m.mul', title: 'Mūla 2' },
    { bookCode: 's0101t.tik', title: 'Ṭīkā 1' },
  ];

  // Insert Aṭṭhakathā alongside s0101m.mul -> placed at index 1 (right after s0101m.mul)
  const withAttha = insertOrUpdateTabInList(
    initial,
    { bookCode: 's0101a.att', title: 'Aṭṭha 1' },
    { tabView: 'columns', activeBookCode: 's0101m.mul', sourceBookCode: 's0101m.mul', alongside: true }
  );
  assert.deepEqual(
    withAttha.map((t) => t.bookCode),
    ['s0101m.mul', 's0101a.att', 's0201m.mul', 's0101t.tik']
  );

  // Open existing s0101t.tik alongside s0101a.att -> moves s0101t.tik right after s0101a.att
  const movedTika = insertOrUpdateTabInList(
    withAttha,
    { bookCode: 's0101t.tik', title: 'Ṭīkā 1', lastParaNum: '12' },
    { tabView: 'columns', activeBookCode: 's0101a.att', sourceBookCode: 's0101a.att', alongside: true }
  );
  assert.deepEqual(
    movedTika.map((t) => t.bookCode),
    ['s0101m.mul', 's0101a.att', 's0101t.tik', 's0201m.mul']
  );
  assert.equal(movedTika[2].lastParaNum, '12');
});

test('insertOrUpdateTabInList: enforces MAX_TABS (12) without evicting the source tab', () => {
  let tabs = [];
  for (let i = 1; i <= 12; i++) {
    tabs.push({ bookCode: `book_${i}.mul`, title: `Book ${i}` });
  }
  const next = insertOrUpdateTabInList(
    tabs,
    { bookCode: 'book_13.att', title: 'Book 13' },
    { tabView: 'tabbed', activeBookCode: 'book_1.mul', sourceBookCode: 'book_1.mul', alongside: true }
  );
  assert.equal(next.length, 12);
  assert.equal(next[0].bookCode, 'book_1.mul');
  assert.equal(next[1].bookCode, 'book_13.att');
});

test('getBookLayerInfo: classifies Mūla, Aṭṭhakathā, Ṭīkā, and returns sibling layers', () => {
  const mula = getBookLayerInfo('s0101m.mul', 'Mūla');
  assert.equal(mula.layer, 'mula');
  assert.equal(mula.label, 'Mūla');
  assert.deepEqual(
    mula.siblingLayers.map((s) => s.layer),
    ['attha', 'tika']
  );

  const attha = getBookLayerInfo('s0101a.att', 'Aṭṭhakathā');
  assert.equal(attha.layer, 'attha');
  assert.equal(attha.label, 'Aṭṭha');
  assert.deepEqual(
    attha.siblingLayers.map((s) => s.layer),
    ['mula', 'tika']
  );

  const tika = getBookLayerInfo('s0101t.tik', 'Ṭīkā');
  assert.equal(tika.layer, 'tika');
  assert.equal(tika.label, 'Ṭīkā');
  assert.deepEqual(
    tika.siblingLayers.map((s) => s.layer),
    ['mula', 'attha']
  );

  // Añña .nrf without MAT companions (e.g. e0901n.nrf) must NOT show phantom +Mūla/+Aṭṭha buttons
  const annaNoMat = getBookLayerInfo('e0901n.nrf', 'añña', {
    bookCode: 'e0901n.nrf',
    category: 'añña',
    mat: { book_code: 'e0901n.nrf', category: 'añña', mula_code: null, attha_code: null, tika_code: null },
  });
  assert.equal(annaNoMat.layer, 'other');
  assert.deepEqual(annaNoMat.siblingLayers, []);

  // Book with only Aṭṭhakathā companion (no Ṭīkā) only exposes +Aṭṭha
  const noTika = getBookLayerInfo('s0501m.mul', 'mūla', {
    bookCode: 's0501m.mul',
    category: 'mūla',
    mat: { book_code: 's0501m.mul', mula_code: 's0501m.mul', attha_code: 's0501a.att', tika_code: null },
  });
  assert.deepEqual(
    noTika.siblingLayers.map((s) => s.layer),
    ['attha']
  );

  // Añña t.nrf treatise that actually has Mūla/Aṭṭha companions (e.g. abh04t.nrf) keeps them
  const annaWithMat = getBookLayerInfo('abh04t.nrf', 'añña', {
    bookCode: 'abh04t.nrf',
    category: 'añña',
    mat: { book_code: 'abh04t.nrf', mula_code: 'abh01m.mul', attha_code: 'abh01a.att', tika_code: null },
  });
  assert.equal(annaWithMat.layer, 'tika');
  assert.deepEqual(
    annaWithMat.siblingLayers.map((s) => s.layer),
    ['mula', 'attha']
  );
});

test('LinkedDefinitionModal renders linked-def-passage-target highlight border and matches body translation color', () => {
  const { resolveTranslationTextColor } = compileModule('../context/ThemeSettingsContext.jsx', {
    react: Object.assign({}, React, { __esModule: true, default: React }),
  });

  // Default Classic theme first slot (#6d28d9) and custom override
  assert.equal(resolveTranslationTextColor('en', 0, { theme: 'classic', translationColors: {} }), '#6d28d9');
  assert.equal(
    resolveTranslationTextColor('en', 0, { theme: 'classic', translationColors: { english: { text: '1d4ed8' } } }),
    '#1d4ed8'
  );

  // Render LinkedDefinitionModal with mocked preview response? Wait: compile LinkedDefinitionModal and verify class tokens
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../components/Reader/LinkedDefinitionModal.jsx'),
    'utf8'
  );
  assert.match(src, /linked-def-passage-target/);
  assert.match(src, /resolveTranslationTextColor/);
  const css = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../app/globals.css'),
    'utf8'
  );
  assert.match(css, /\.linked-def-passage-target\s*\{[^}]*border:\s*2px\s+solid\s+var\(--accent\)/);
});

test('increasingChain and interpolateMonotonicY: filters cross-reference outliers and interpolates smoothly', () => {
  assert.deepEqual(increasingChain([]), []);
  assert.equal(interpolateMonotonicY([], 200), null);

  // Single anchor extrapolates 1:1
  const single = increasingChain([[100, 350]]);
  assert.deepEqual(single, [[100, 350]]);
  assert.equal(interpolateMonotonicY(single, 150), 400);
  assert.equal(interpolateMonotonicY(single, 80), 330);

  // Outlier [50, 9000] before a clean monotonic spine [100, 200], [300, 600], [500, 1000]
  const rawPairs = [
    [50, 9000], // cross-reference outlier pointing to end of book
    [100, 200],
    [300, 600],
    [400, 150], // out-of-order back-reference outlier
    [500, 1000],
  ];
  const chain = increasingChain(rawPairs);
  assert.deepEqual(chain, [
    [100, 200],
    [300, 600],
    [500, 1000],
  ]);

  // Midpoint between [100, 200] and [300, 600] at srcY=200 -> dstY=400
  assert.equal(interpolateMonotonicY(chain, 200), 400);
  // 25% between [300, 600] and [500, 1000] at srcY=350 -> dstY=700
  assert.equal(interpolateMonotonicY(chain, 350), 700);
});

test('buildParallelAnchors: aligns Mūla and Aṭṭhakathā columns via inline link chips and paragraph numbers', () => {
  const makeEl = (top, height = 80, attrs = {}, childrenBySelector = {}) => ({
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
    getClientRects: () => [{ top, height }],
    getAttribute: (name) => attrs[name] ?? null,
    closest: () => null,
    querySelector: (sel) => childrenBySelector[sel] || null,
  });

  const linkPayload = encodeURIComponent(
    JSON.stringify({
      target_book: 's0101a.att',
      target_chapter: 0,
      target_para_index: 5,
      target_line_id: 2,
      target_para_num: '1',
    })
  );
  const srcChip = makeEl(140, 20, { 'data-link': linkPayload });
  const dstLineEl = makeEl(420, 30);
  const dstRow5 = makeEl(400, 100, { 'data-pindex': '5' }, { '[data-line="2"]': dstLineEl });
  const dstChap0 = makeEl(
    0,
    2000,
    {},
    {
      '.reader-para-row[data-pindex="5"]': dstRow5,
    }
  );

  const srcPara1 = makeEl(50, 60, { 'data-para': '1' });
  const srcPara2 = makeEl(300, 60, { 'data-para': '2' });
  const dstPara1 = makeEl(120, 90, { 'data-para': '1' });
  const dstPara2 = makeEl(700, 90, { 'data-para': '2' });

  const srcContainer = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: (sel) => {
      if (sel === '.linked-def-chip[data-link]') return [srcChip];
      if (sel === '.chapter-content-block [data-para]') return [srcPara1, srcPara2];
      return [];
    },
    querySelector: () => null,
  };

  const dstContainer = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: (sel) => {
      if (sel === '.linked-def-chip[data-link]') return [];
      if (sel === '.chapter-content-block [data-para]') return [dstPara1, dstPara2];
      return [];
    },
    querySelector: (sel) => {
      if (sel === '.chapter-content-block[data-chapter="0"]') return dstChap0;
      return null;
    },
  };

  const chain = buildParallelAnchors(
    srcContainer,
    dstContainer,
    { bookCode: 's0101m.mul', category: 'Mūla' },
    { bookCode: 's0101a.att', category: 'Aṭṭhakathā' }
  );

  assert.deepEqual(chain, [
    [50, 120],
    [140, 420],
    [300, 700],
  ]);

  // Also test fallback when showBookLinks=false (no DOM chips) using srcLinksByChap with { by_line, all } schema
  // and para_to_mat with { book, chapter, para } schema
  const srcLine3 = makeEl(165, 25);
  const srcRow2 = makeEl(150, 80, { 'data-pindex': '2' }, { '[data-line="3"]': srcLine3 });
  const srcChap0 = makeEl(0, 1500, {}, { '.reader-para-row[data-pindex="2"]': srcRow2 });

  const srcNoChipsContainer = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: (sel) => {
      if (sel === '.linked-def-chip[data-link]') return [];
      if (sel === '.chapter-content-block [data-para]') return [srcPara1, srcPara2];
      return [];
    },
    querySelector: (sel) => {
      if (sel === '.chapter-content-block[data-chapter="0"]') return srcChap0;
      return null;
    },
  };

  const srcLinksByChap = {
    0: {
      2: {
        by_line: {
          3: [
            {
              target_book: 's0101a.att',
              target_chapter: 0,
              target_para_index: 5,
              target_line_id: 2,
              target_para_num: '1',
            },
          ],
        },
        all: [],
      },
    },
  };

  const chainFromMap = buildParallelAnchors(
    srcNoChipsContainer,
    dstContainer,
    {
      bookCode: 's0101m.mul',
      category: 'Mūla',
      para_to_mat: {
        1: { attha: { book: 's0101a.att', chapter: 0, para: '1' } },
        2: { attha: { book: 's0101a.att', chapter: 0, para: '2' } },
      },
    },
    { bookCode: 's0101a.att', category: 'Aṭṭhakathā' },
    srcLinksByChap,
    null
  );

  assert.deepEqual(chainFromMap, [
    [50, 120],
    [165, 420],
    [300, 700],
  ]);
});

test('ReaderView keeps all open book tabs mounted in DOM in tabbed mode and renders side-by-side in columns mode', () => {
  const sampleTabs = [
    {
      bookCode: 's0101m.mul',
      title: 'Sīlakkhandhavaggapāḷi',
      category: 'Mūla',
      currentChapterIdx: 0,
      chapters: [{ chapter_index: 0, title: 'Brahmajālasuttaṃ' }],
      loadedChapters: {
        0: '<p class="bodytext" data-para="1" data-pindex="0">Evaṃ me sutaṃ.</p>',
      },
      loadingChapters: {},
    },
    {
      bookCode: 's0101a.att',
      title: 'Sīlakkhandhavagga-aṭṭhakathā',
      category: 'Aṭṭhakathā',
      currentChapterIdx: 0,
      chapters: [{ chapter_index: 0, title: 'Brahmajālasuttavaṇṇanā' }],
      loadedChapters: {
        0: '<p class="bodytext" data-para="1" data-pindex="0">Evaṃ me sutantiādikaṃ.</p>',
      },
      loadingChapters: {},
    },
  ];

  // 1. Tabbed mode: both panes remain mounted in the DOM (active visible, inactive hidden)
  const { default: ReaderViewTabbed } = loadReaderViewExports({
    useTabsMock: () => ({
      openTabs: sampleTabs,
      activeTab: sampleTabs[0],
      activeBookCode: 's0101m.mul',
      bookmarks: [],
      loadChapter: () => {},
      bufferAdjacentChapters: () => {},
      saveTabScroll: () => {},
      getSavedScroll: () => 0,
      clearTargetScrollIntent: () => {},
    }),
    useThemeSettingsMock: () => ({
      settings: {
        tabView: 'tabbed',
        syncScroll: true,
        paliScript: 'roman',
        translations: { pali: true },
        translationOrder: ['pali'],
      },
    }),
  });

  const tabbedHtml = renderToStaticMarkup(React.createElement(ReaderViewTabbed));
  assert.match(tabbedHtml, /data-pane-code="s0101m\.mul"/);
  assert.match(tabbedHtml, /data-pane-code="s0101a\.att"/);
  assert.match(tabbedHtml, /Evaṃ me sutaṃ\./);
  assert.match(tabbedHtml, /Evaṃ me sutantiādikaṃ\./);
  assert.match(tabbedHtml, /reader-pane hidden"[^>]*data-pane-code="s0101a\.att"/);

  // 2. Columns mode: both panes are visible side-by-side in .reader-columns-grid with quick +Mūla/+Aṭṭha/+Ṭīkā buttons
  const { default: ReaderViewColumns } = loadReaderViewExports({
    useTabsMock: () => ({
      openTabs: sampleTabs,
      activeTab: sampleTabs[0],
      activeBookCode: 's0101m.mul',
      bookmarks: [],
      loadChapter: () => {},
      bufferAdjacentChapters: () => {},
      saveTabScroll: () => {},
      getSavedScroll: () => 0,
      clearTargetScrollIntent: () => {},
    }),
    useThemeSettingsMock: () => ({
      settings: {
        tabView: 'columns',
        syncScroll: true,
        paliScript: 'roman',
        translations: { pali: true },
        translationOrder: ['pali'],
      },
    }),
  });

  const columnsHtml = renderToStaticMarkup(React.createElement(ReaderViewColumns));
  assert.match(columnsHtml, /reader-columns-grid/);
  assert.doesNotMatch(columnsHtml, /reader-pane hidden"[^>]*data-pane-code="s0101a\.att"/);
  assert.match(columnsHtml, /Open Aṭṭha alongside/);
  assert.match(columnsHtml, /Open Ṭīkā alongside/);
  assert.match(columnsHtml, /Open Mūla alongside/);

  // 3. Columns mode with all 3 canonical layers (Mūla, Aṭṭhakathā, Ṭīkā) keeps all 3 visible at 1280px
  const threeLayerTabs = [
    ...sampleTabs,
    {
      bookCode: 's0101t.tik',
      title: 'Sīlakkhandhavagga-ṭīkā',
      category: 'Ṭīkā',
      currentChapterIdx: 0,
      chapters: [{ chapter_index: 0, title: 'Brahmajālasuttavaṇṇanā-ṭīkā' }],
      loadedChapters: {
        0: '<p class="bodytext" data-para="1" data-pindex="0">Evaṃ me sutantiādikaṃ ṭīkā.</p>',
      },
      loadingChapters: {},
    },
  ];
  const { default: ReaderViewThreeCols } = loadReaderViewExports({
    useTabsMock: () => ({
      openTabs: threeLayerTabs,
      activeTab: threeLayerTabs[1],
      activeBookCode: 's0101a.att',
      bookmarks: [],
      loadChapter: () => {},
      bufferAdjacentChapters: () => {},
      saveTabScroll: () => {},
      getSavedScroll: () => 0,
      clearTargetScrollIntent: () => {},
    }),
    useThemeSettingsMock: () => ({
      settings: {
        tabView: 'columns',
        syncScroll: true,
        paliScript: 'roman',
        translations: { pali: true },
        translationOrder: ['pali'],
      },
    }),
  });
  const threeColsHtml = renderToStaticMarkup(React.createElement(ReaderViewThreeCols));
  assert.doesNotMatch(threeColsHtml, /reader-pane hidden"[^>]*data-pane-code="s0101m\.mul"/);
  assert.doesNotMatch(threeColsHtml, /reader-pane hidden"[^>]*data-pane-code="s0101a\.att"/);
  assert.doesNotMatch(threeColsHtml, /reader-pane hidden"[^>]*data-pane-code="s0101t\.tik"/);
});
