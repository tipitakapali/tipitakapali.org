import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadReaderViewExports({ fetchPaliSentencesMock } = {}) {
  const readerViewPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../components/Reader/ReaderView.jsx'
  );
  const src = fs.readFileSync(readerViewPath, 'utf8');
  const { code } = transform(src, {
    transforms: ['jsx', 'imports'],
    filePath: readerViewPath,
  });

  const noopComp = () => null;
  const stubs = {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    './WelcomeView': { __esModule: true, default: noopComp },
    './MeditationLoader': { __esModule: true, default: noopComp },
    './BookTocView': { __esModule: true, default: noopComp },
    './LinkedDefinitionModal': { __esModule: true, default: noopComp },
    '../AiChat/AiChatView': { __esModule: true, default: noopComp },
    '../../context/TabContext': { useTabs: () => ({}) },
    '../../context/ThemeSettingsContext': {
      useThemeSettings: () => ({}),
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
      fetchPaliSentences: fetchPaliSentencesMock || (async () => ({})),
      fetchChapterLinks: async () => ({}),
    },
  };

  const mod = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  fn(mod.exports, localRequire, mod, readerViewPath, path.dirname(readerViewPath));
  return mod.exports;
}

const {
  getSentenceDisplayFlags,
  injectPaliSentencesIntoHtml,
  injectTranslationsIntoHtml,
  ChapterBlock,
} = loadReaderViewExports();

const SAMPLE_PALI_HTML =
  '<p class="bodytext" data-para="1" data-pindex="0"><strong class="paranum">1</strong>. Evaṃ me sutaṃ. <span class="pb" data-ed="M" data-page="1">M.1</span> Ekaṃ samayaṃ bhagavā.</p>';

const SAMPLE_SINGLE_SENT_PALI_HTML =
  '<p class="bodytext" data-para="2" data-pindex="1"><strong class="paranum">2</strong>. Single sentence paragraph.</p>';

const SAMPLE_GATHA_HTML =
  '<p class="gatha1" data-para="3" data-pindex="2">Sabbe saṅkhārā aniccā ti, yadā paññāya passati.</p>';

const SAMPLE_PALI_SENTS = {
  0: [
    { line: 1, text: 'Evaṃ me sutaṃ.' },
    { line: 2, text: 'Ekaṃ samayaṃ bhagavā.' },
  ],
  1: [{ line: 1, text: 'Single sentence paragraph.' }],
};

const SAMPLE_TRANS = {
  en: {
    0: 'Thus have I heard. At one time the Blessed One.',
    1: 'First part. Second part.',
    2: 'All conditioned things are impermanent. When one sees with wisdom.',
  },
  my_nissaya: {
    0: 'Evaṃ: ဤသို့ | me: အကျွန်ုပ်သည် | sutaṃ: ကြားအပ်ပြီ',
  },
};

const SAMPLE_TRANS_SENTS = {
  en: {
    0: [
      { line_id: 1, translation: 'Thus have I heard.' },
      { line_id: 2, translation: 'At one time the Blessed One.' },
    ],
    1: [
      { line_id: 1, translation: 'First part.' },
      { line_id: 2, translation: 'Second part.' },
    ],
    2: [
      { line_id: 1, translation: 'All conditioned things are impermanent.' },
      { line_id: 2, translation: 'When one sees with wisdom.' },
    ],
  },
};

test('getSentenceDisplayFlags: no translations enabled (Pali alone) disables sentence mode and numbers in all layouts', () => {
  for (const mode of ['stack', 'side', 'side_rev']) {
    const flags = getSentenceDisplayFlags({
      sentenceMode: true,
      hasActiveTrans: false,
      isPaliEnabled: true,
      orderedLayers: [{ id: 'pali', type: 'pali' }],
      translationDisplayMode: mode,
    });
    assert.equal(flags.effectiveSentenceMode, false, `mode=${mode} effectiveSentenceMode`);
    assert.equal(flags.showSentenceNumbers, false, `mode=${mode} showSentenceNumbers`);
  }
});

test('getSentenceDisplayFlags: Stacked layout with translations keeps sentence mode on, but hides sentence numbers', () => {
  const flags = getSentenceDisplayFlags({
    sentenceMode: true,
    hasActiveTrans: true,
    isPaliEnabled: true,
    orderedLayers: [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
    ],
    translationDisplayMode: 'stack',
  });
  assert.equal(flags.effectiveSentenceMode, true);
  assert.equal(flags.showSentenceNumbers, false);
  assert.equal(flags.isSideActive, false);
});

test('getSentenceDisplayFlags: Side-by-side layouts with Pali + translation show sentence numbers', () => {
  for (const mode of ['side', 'side_rev']) {
    const flags = getSentenceDisplayFlags({
      sentenceMode: true,
      hasActiveTrans: true,
      isPaliEnabled: true,
      orderedLayers: [
        { id: 'pali', type: 'pali' },
        { id: 'english', type: 'trans', lang: 'en' },
      ],
      translationDisplayMode: mode,
    });
    assert.equal(flags.effectiveSentenceMode, true);
    assert.equal(flags.showSentenceNumbers, true);
    assert.equal(flags.isSideActive, true);
  }
});

test('getSentenceDisplayFlags: Side-by-side with Pali disabled and single translation hides sentence numbers; 2 translations shows them', () => {
  const oneTrans = getSentenceDisplayFlags({
    sentenceMode: true,
    hasActiveTrans: true,
    isPaliEnabled: false,
    orderedLayers: [{ id: 'english', type: 'trans', lang: 'en' }],
    translationDisplayMode: 'side',
  });
  assert.equal(oneTrans.effectiveSentenceMode, true);
  assert.equal(oneTrans.showSentenceNumbers, false);

  const twoTrans = getSentenceDisplayFlags({
    sentenceMode: true,
    hasActiveTrans: true,
    isPaliEnabled: false,
    orderedLayers: [
      { id: 'english', type: 'trans', lang: 'en' },
      { id: 'vietnamese', type: 'trans', lang: 'vi' },
    ],
    translationDisplayMode: 'side',
  });
  assert.equal(twoTrans.effectiveSentenceMode, true);
  assert.equal(twoTrans.showSentenceNumbers, true);
});

test('ChapterBlock renders Pali alone as paragraph when sentenceMode=true and activeLangs is empty', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChapterBlock, {
      chapter: { chapter_index: 0, title: 'Brahmajālasuttaṃ' },
      bookCode: 's0101m.mul',
      html: SAMPLE_PALI_HTML,
      isLoading: false,
      onVisible: () => {},
      isCurrentOrTarget: true,
      paliScript: 'roman',
      activeLangs: [],
      orderedLayers: [{ id: 'pali', type: 'pali' }],
      isPaliEnabled: true,
      translationDisplayMode: 'stack',
      sentenceMode: true,
      showBookLinks: false,
    })
  );
  assert.doesNotMatch(markup, /pali-sent/);
  assert.doesNotMatch(markup, /pali-sent-num/);
  assert.doesNotMatch(markup, /reader-chapter-trans-loading/);
  assert.match(markup, /Evaṃ me sutaṃ\./);
  assert.match(markup, /Ekaṃ samayaṃ bhagavā\./);
});

test('Pali alone (no translations enabled) renders as normal paragraph even with custom Pali colors', () => {
  const flags = getSentenceDisplayFlags({
    sentenceMode: true,
    hasActiveTrans: false,
    isPaliEnabled: true,
    orderedLayers: [{ id: 'pali', type: 'pali' }],
    translationDisplayMode: 'stack',
  });
  const paliHtml = flags.effectiveSentenceMode
    ? injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
        showSentenceNumbers: flags.showSentenceNumbers,
      })
    : SAMPLE_PALI_HTML;

  const out = injectTranslationsIntoHtml(
    paliHtml,
    {},
    [{ id: 'pali', type: 'pali' }],
    true,
    'stack',
    { pali: { bg: '#fef3c7' } },
    null,
    true,
    null,
    'classic'
  );
  assert.doesNotMatch(out, /pali-sent/);
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.match(out, /Evaṃ me sutaṃ\./);
  assert.match(out, /data-ed="M"/);
});

test('Stacked layout with sentence-aligned translation renders paired rows with zero sentence numbers and preserves page breaks', () => {
  const paliHtml = injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
    showSentenceNumbers: false,
  });
  const out = injectTranslationsIntoHtml(
    paliHtml,
    SAMPLE_TRANS,
    [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
    ],
    true,
    'stack',
    {},
    null,
    true,
    SAMPLE_TRANS_SENTS,
    'classic'
  );
  assert.match(out, /reader-sent-pairs/);
  assert.match(out, /sent-pair/);
  assert.doesNotMatch(out, /sent-pair-num/);
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.doesNotMatch(out, /trans-sent-num/);
  assert.match(out, /data-ed="M"/);
  assert.match(out, /Thus have I heard\./);
  assert.match(out, /At one time the Blessed One\./);
});

test('Stacked layout fallback (paragraph-only translation like my_nissaya + sentence-split Pali) shows no sentence numbers', () => {
  const paliHtml = injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
    showSentenceNumbers: false,
  });
  const out = injectTranslationsIntoHtml(
    paliHtml,
    SAMPLE_TRANS,
    [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
      { id: 'my_nissaya', type: 'trans', lang: 'my_nissaya' },
    ],
    true,
    'stack',
    {},
    null,
    true,
    SAMPLE_TRANS_SENTS,
    'classic'
  );
  assert.match(out, /reader-trans-stack-row/);
  assert.match(out, /class="pali-sent"/);
  assert.match(out, /class="trans-sent"/);
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.doesNotMatch(out, /trans-sent-num/);
});

test('Stacked layout with 1-sentence Pali + multi-sentence translation or gatha shows no sentence numbers', () => {
  const combinedHtml = SAMPLE_SINGLE_SENT_PALI_HTML + SAMPLE_GATHA_HTML;
  const paliHtml = injectPaliSentencesIntoHtml(combinedHtml, SAMPLE_PALI_SENTS, {
    showSentenceNumbers: false,
  });
  const out = injectTranslationsIntoHtml(
    paliHtml,
    SAMPLE_TRANS,
    [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
    ],
    true,
    'stack',
    {},
    null,
    true,
    SAMPLE_TRANS_SENTS,
    'classic'
  );
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.doesNotMatch(out, /trans-sent-num/);
  assert.doesNotMatch(out, /sent-pair-num/);
});

test('Stacked layout with Pali disabled and sentence-split translation shows no sentence numbers', () => {
  const out = injectTranslationsIntoHtml(
    SAMPLE_PALI_HTML,
    SAMPLE_TRANS,
    [{ id: 'english', type: 'trans', lang: 'en' }],
    false,
    'stack',
    {},
    null,
    true,
    SAMPLE_TRANS_SENTS,
    'classic'
  );
  assert.match(out, /class="trans-sent"/);
  assert.doesNotMatch(out, /trans-sent-num/);
  assert.doesNotMatch(out, /pali-sent-num/);
});

test('Stacked layout when a paragraph has missing translation still shows no sentence numbers', () => {
  const paliHtml = injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
    showSentenceNumbers: false,
  });
  const out = injectTranslationsIntoHtml(
    paliHtml,
    { en: {} },
    [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
    ],
    true,
    'stack',
    {},
    null,
    true,
    { en: {} },
    'classic'
  );
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.doesNotMatch(out, /trans-sent-num/);
});

test('Side-by-side layout (side and side_rev) with Pali + translation DOES show sentence numbers', () => {
  for (const mode of ['side', 'side_rev']) {
    const paliHtml = injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
      showSentenceNumbers: true,
    });
    const out = injectTranslationsIntoHtml(
      paliHtml,
      SAMPLE_TRANS,
      [
        { id: 'pali', type: 'pali' },
        { id: 'english', type: 'trans', lang: 'en' },
      ],
      true,
      mode,
      {},
      null,
      true,
      SAMPLE_TRANS_SENTS,
      'classic'
    );
    assert.match(out, /reader-trans-side-row/);
    assert.match(out, /<span class="pali-sent-num">1<\/span>/);
    assert.match(out, /<span class="pali-sent-num">2<\/span>/);
    assert.match(out, /<span class="trans-sent-num">1<\/span>/);
    assert.match(out, /<span class="trans-sent-num">2<\/span>/);
  }
});

test('Paragraph mode (sentenceMode=false) never injects sentence spans or numbers in any layout', () => {
  for (const mode of ['stack', 'side', 'side_rev']) {
    const out = injectTranslationsIntoHtml(
      SAMPLE_PALI_HTML,
      SAMPLE_TRANS,
      [
        { id: 'pali', type: 'pali' },
        { id: 'english', type: 'trans', lang: 'en' },
      ],
      true,
      mode,
      {},
      null,
      false,
      SAMPLE_TRANS_SENTS,
      'classic'
    );
    assert.doesNotMatch(out, /pali-sent/);
    assert.doesNotMatch(out, /trans-sent/);
    assert.doesNotMatch(out, /sent-pair/);
  }
});

test('Empty/null HTML inputs handled safely without throwing', () => {
  assert.equal(injectPaliSentencesIntoHtml('', SAMPLE_PALI_SENTS), '');
  assert.equal(injectPaliSentencesIntoHtml(null, SAMPLE_PALI_SENTS), null);
  assert.equal(injectTranslationsIntoHtml('', SAMPLE_TRANS, []), '');
  assert.equal(injectTranslationsIntoHtml(null, SAMPLE_TRANS, []), null);
});

test('Stacked mode strips pre-existing pali-sent-num badges even in stack fallback rows', () => {
  const preNumberedPali = injectPaliSentencesIntoHtml(SAMPLE_PALI_HTML, SAMPLE_PALI_SENTS, {
    showSentenceNumbers: true,
  });
  assert.match(preNumberedPali, /pali-sent-num/);
  const out = injectTranslationsIntoHtml(
    preNumberedPali,
    SAMPLE_TRANS,
    [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
      { id: 'my_nissaya', type: 'trans', lang: 'my_nissaya' },
    ],
    true,
    'stack',
    {},
    null,
    true,
    SAMPLE_TRANS_SENTS,
    'classic'
  );
  assert.match(out, /reader-trans-stack-row/);
  assert.doesNotMatch(out, /pali-sent-num/);
  assert.doesNotMatch(out, /trans-sent-num/);
});

test('ChapterBlock renders Pali alone as paragraph even in side/side_rev modes', () => {
  for (const mode of ['stack', 'side', 'side_rev']) {
    const markup = renderToStaticMarkup(
      React.createElement(ChapterBlock, {
        chapter: { chapter_index: 0, title: 'Brahmajālasuttaṃ' },
        bookCode: 's0101m.mul',
        html: SAMPLE_PALI_HTML,
        isLoading: false,
        onVisible: () => {},
        isCurrentOrTarget: true,
        paliScript: 'roman',
        activeLangs: [],
        orderedLayers: [{ id: 'pali', type: 'pali' }],
        isPaliEnabled: true,
        translationDisplayMode: mode,
        sentenceMode: true,
        showBookLinks: false,
      })
    );
    assert.doesNotMatch(markup, /pali-sent/);
    assert.doesNotMatch(markup, /pali-sent-num/);
  }
});

test('server_api/server.js imports readChapterSentences and exposes has_pali_sentences', () => {
  const serverPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../server_api/server.js'
  );
  const serverSrc = fs.readFileSync(serverPath, 'utf8');
  assert.match(
    serverSrc,
    /\{[^}]*\breadChapterSentences\b[^}]*\}\s*=\s*require\(['"]\.\/tipitakaCoreHelper['"]\)/,
    'server_api/server.js must import readChapterSentences from ./tipitakaCoreHelper'
  );
  assert.match(
    serverSrc,
    /fastify\.get\(['"]\/api\/translations['"][\s\S]*?has_pali_sentences:\s*Boolean\(getPaliSentencesDb\(\)\)/,
    '/api/translations should expose has_pali_sentences'
  );
});

test('services/api.js fetchPaliSentences falls back to whole-book endpoint when per-chapter endpoint fails on localhost', async () => {
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const compileSvc = (relPath, stubs) => {
    const fullPath = path.join(rootDir, relPath);
    const src = fs.readFileSync(fullPath, 'utf8');
    const { code } = transform(src, { transforms: ['imports'], filePath: fullPath });
    const mod = { exports: {} };
    const localRequire = (spec) => (Object.prototype.hasOwnProperty.call(stubs, spec) ? stubs[spec] : require(spec));
    new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
      mod.exports,
      localRequire,
      mod,
      fullPath,
      path.dirname(fullPath)
    );
    return mod.exports;
  };

  const apiMod = compileSvc('services/api.js', {
    './transliterate': compileSvc('services/transliterate.js', {}),
    './dpdFeedback': compileSvc('services/dpdFeedback.js', {}),
  });

  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.window = { location: { hostname: 'localhost', port: '3000', protocol: 'http:' } };
  globalThis.fetch = async (url) => {
    const u = String(url);
    calledUrls.push(u);
    if (u.includes('/chapter/0/pali_sentences')) {
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    }
    if (u.endsWith('/api/book/s0101m.mul/pali_sentences')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          book_code: 's0101m.mul',
          chapters: {
            0: SAMPLE_PALI_SENTS,
            1: { 0: [{ line: 1, text: 'Chap 1 sent.' }] },
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${u}`);
  };

  try {
    assert.equal(apiMod.isLocalDynamicHost(), true);
    const ch0 = await apiMod.fetchPaliSentences('s0101m.mul', 0);
    assert.deepEqual(calledUrls, [
      '/api/book/s0101m.mul/chapter/0/pali_sentences',
      '/api/book/s0101m.mul/pali_sentences',
    ]);
    assert.deepEqual(ch0.paragraphs, SAMPLE_PALI_SENTS);
    assert.deepEqual(ch0.chapters['0'], SAMPLE_PALI_SENTS);
    // Subsequent chapter lookup resolves synchronously from warmed whole-book cache
    const cachedCh1 = apiMod.getCachedPaliSentences('s0101m.mul', 1);
    assert.deepEqual(cachedCh1, { 0: [{ line: 1, text: 'Chap 1 sent.' }] });
  } finally {
    globalThis.window = prevWindow;
    globalThis.fetch = prevFetch;
  }
});

test('ChapterBlock bundle mode falls back to fetchPaliSentences when bundle omits pali_sentences', async () => {
  const readerViewPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../components/Reader/ReaderView.jsx'
  );
  const src = fs.readFileSync(readerViewPath, 'utf8');
  const { code } = transform(src, { transforms: ['jsx', 'imports'], filePath: readerViewPath });

  const effects = [];
  const stateValues = [];
  const reactStub = {
    Fragment: Symbol('Fragment'),
    createElement: () => null,
    memo: (c) => c,
    forwardRef: (c) => c,
    createContext: () => ({ Provider: () => null }),
    useContext: () => ({}),
    useRef: (init) => ({ current: init }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useState: (init) => {
      const idx = stateValues.length;
      const initial = typeof init === 'function' ? init() : init;
      stateValues.push(initial);
      return [initial, (next) => {
        stateValues[idx] = typeof next === 'function' ? next(stateValues[idx]) : next;
      }];
    },
    useEffect: (fn) => {
      effects.push(fn);
    },
    useLayoutEffect: () => {},
  };

  let bundleCalls = 0;
  let paliFallbackCalls = 0;
  const noopComp = () => null;
  const stubs = {
    react: Object.assign({}, reactStub, { __esModule: true, default: reactStub }),
    'lucide-react': new Proxy({}, { get: () => noopComp }),
    './WelcomeView': { __esModule: true, default: noopComp },
    './MeditationLoader': { __esModule: true, default: noopComp },
    './BookTocView': { __esModule: true, default: noopComp },
    './LinkedDefinitionModal': { __esModule: true, default: noopComp },
    '../AiChat/AiChatView': { __esModule: true, default: noopComp },
    '../../context/TabContext': { useTabs: () => ({}) },
    '../../context/ThemeSettingsContext': {
      useThemeSettings: () => ({}),
      getDefaultTranslationColorsForTheme: () => ({ text: '#000', border: '#000', bg: '' }),
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
      isLocalDynamicHost: () => true,
      fetchChapterBundle: async () => {
        bundleCalls++;
        return {
          book_code: 's0101m.mul',
          chapter_index: 0,
          languages: ['en'],
          translations: SAMPLE_TRANS,
          sentences: SAMPLE_TRANS_SENTS,
          // intentionally omit pali_sentences (old server_api/server.js behavior)
        };
      },
      fetchChapterTranslations: async () => ({}),
      getCachedChapterTranslations: () => null,
      fetchPaliSentences: async () => {
        paliFallbackCalls++;
        return { book_code: 's0101m.mul', chapter_index: 0, paragraphs: SAMPLE_PALI_SENTS };
      },
      getCachedPaliSentences: () => null,
      fetchChapterLinks: async () => ({}),
      getCachedChapterLinks: () => null,
    },
  };

  const mod = { exports: {} };
  const localRequire = (spec) => (Object.prototype.hasOwnProperty.call(stubs, spec) ? stubs[spec] : require(spec));
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports,
    localRequire,
    mod,
    readerViewPath,
    path.dirname(readerViewPath)
  );

  mod.exports.ChapterBlock({
    chapter: { chapter_index: 0, title: 'Brahmajālasuttaṃ' },
    bookCode: 's0101m.mul',
    html: SAMPLE_PALI_HTML,
    isLoading: false,
    onVisible: () => {},
    isCurrentOrTarget: true,
    paliScript: 'roman',
    activeLangs: ['en'],
    orderedLayers: [
      { id: 'pali', type: 'pali' },
      { id: 'english', type: 'trans', lang: 'en' },
    ],
    isPaliEnabled: true,
    translationDisplayMode: 'stack',
    sentenceMode: true,
    showBookLinks: false,
  });

  const cleanups = [];
  for (const eff of effects) {
    const c = eff();
    if (typeof c === 'function') cleanups.push(c);
  }
  await new Promise((r) => setTimeout(r, 20));
  for (const c of cleanups) c();

  assert.equal(bundleCalls, 1, 'ChapterBlock should call fetchChapterBundle on localhost');
  assert.equal(paliFallbackCalls, 1, 'ChapterBlock should fall back to fetchPaliSentences when bundle lacks pali_sentences');
  assert.ok(
    stateValues.some((v) => v && v[0] && Array.isArray(v[0]) && v[0].length === 2),
    'Fallback paliSentMap state should be populated with chapter sentence splits'
  );
});
