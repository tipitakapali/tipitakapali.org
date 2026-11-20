import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const rootDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

function compileModule(relPath, stubs = {}) {
  const fullPath = path.resolve(rootDir, relPath);
  const src = fs.readFileSync(fullPath, "utf8");
  const { code } = transform(src, {
    transforms: ["jsx", "imports"],
    filePath: fullPath,
  });

  const mod = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    return require(specifier);
  };
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    code,
  );
  fn(mod.exports, localRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

const iconProxy = new Proxy(
  {},
  {
    get: (_, prop) => (props) =>
      React.createElement("svg", { "data-icon": String(prop), ...props }),
  },
);

const noop = () => {};

// =========================================================================
// Task 1: Full Text Search — FTS DB dropdown above Group + clear instructions
// =========================================================================

test('Task 1: SearchModal places "Language to search" selector above "Group:" outside search form with accessible instructions', () => {
  const searchMod = compileModule("components/Search/SearchModal.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "./SearchResultItem": { __esModule: true, default: () => null },
    "../../services/api": {
      searchTipitaka: async () => ({ results: [], total: 0 }),
      fetchSearchDatabases: async () => ({ databases: [] }),
      invalidateSearchDatabasesCache: noop,
    },
    "../../context/TabContext": {
      useTabs: () => ({
        isSearchOpen: true,
        closeSearchModal: noop,
        openBook: noop,
        initialSearchQuery: "",
        setInitialSearchQuery: noop,
        updateUrlParams: noop,
      }),
    },
    "../../context/ThemeSettingsContext": {
      useThemeSettings: () => ({
        settings: { paliScript: "roman", translations: { english: true } },
        updateSetting: noop,
      }),
    },
    "../../services/transliterate": compileModule(
      "services/transliterate.js",
      {},
    ),
  });

  const html = renderToStaticMarkup(React.createElement(searchMod.default));

  // Search form & filters live inside a semantic <search> landmark
  assert.match(html, /<search\b/);
  assert.match(html, /<\/search>/);

  // Full-width search input has proper search semantics and attributes
  assert.match(html, /<input[^>]*id="fts-search-input"[^>]*type="search"/);
  assert.match(html, /aria-describedby="fts-db-help"/);
  assert.match(html, /enterKeyHint="search"|enterkeyhint="search"/i);

  // <select id="fts-db-select"> must NOT be inside the <form>, and MUST appear ABOVE "Group:"
  const formEndIdx = html.indexOf("</form>");
  const langBarIdx = html.indexOf('class="search-lang-bar"');
  const selectIdx = html.indexOf('id="fts-db-select"');
  const groupIdx = html.indexOf(">Group:<");

  assert.ok(formEndIdx > 0, "Search header must contain a <form>");
  assert.ok(
    langBarIdx > formEndIdx,
    "Language selector bar must sit outside and below the search <form> so the input spans full width",
  );
  assert.ok(
    selectIdx > langBarIdx,
    "Select FTS database dropdown must live inside .search-lang-bar",
  );
  assert.ok(
    groupIdx > selectIdx,
    "Select FTS database dropdown must appear strictly ABOVE the Group filter toolbar",
  );

  // Visible label + persistent instruction text explaining Pāḷi CST vs translation selection
  assert.match(
    html,
    /<label[^>]*for="fts-db-select"[^>]*>[\s\S]*Language to search:/,
  );
  assert.match(
    html,
    /<p[^>]*id="fts-db-help"[^>]*>[^<]*Searching Tipiṭaka Pāḷi CST text\. Choose a translation database to search in the target language\./,
  );

  // Source also includes contextual empty-state tip when zero results are found
  const searchSrc = fs.readFileSync(
    path.join(rootDir, "components/Search/SearchModal.jsx"),
    "utf8",
  );
  assert.match(searchSrc, /Tip: You are searching/);
  assert.match(searchSrc, /switch "Language to search" above/);

  // CSS styles the new .search-lang-bar and hides duplicate native webkit cancel icon
  const cssSrc = fs.readFileSync(path.join(rootDir, "app/globals.css"), "utf8");
  assert.match(cssSrc, /\.search-lang-bar\s*\{/);
  assert.match(cssSrc, /#fts-search-input::-webkit-search-cancel-button/);
});

// =========================================================================
// Task 2: Translation word clicks in Linked Definition & Bold Def + no underline
// =========================================================================

test("Task 2: LinkedDefinitionModal extracts and enables word clicks on both Pāḷi and translation languages (EN, VI, TH, ZH, MY)", () => {
  const linkedMod = compileModule(
    "components/Reader/LinkedDefinitionModal.jsx",
    {
      react: Object.assign({}, React, { __esModule: true, default: React }),
      "lucide-react": iconProxy,
      "../../services/api": {
        fetchLinkedPreview: async () => null,
        getCachedLinkedPreview: () => ({
          target_book: "s0101a.att",
          target_book_title: "Sīlakkhandhavagga-aṭṭhakathā",
          target_category: "aṭṭhakathā",
          target_chapter: 0,
          target_para_index: 5,
          target_para_num: "5",
          target_line_id: 1,
          lines: [
            {
              para_index: 5,
              para_num: "5",
              line_id: 1,
              pali_html: "<b>mettā</b>ti mettiyati",
              is_target: true,
              translations: {
                en: "Loving-kindness means friendliness toward beings.",
                vi: "Tâm từ nghĩa là lòng thương yêu chúng sinh.",
              },
            },
          ],
        }),
      },
      "../../services/transliterate": compileModule(
        "services/transliterate.js",
        {},
      ),
      "../../services/translationFormat": compileModule(
        "services/translationFormat.js",
        {},
      ),
      "../../context/TabContext": { useTabs: () => ({ openBook: noop }) },
      "../../context/DictionaryContext": {
        useDictionary: () => ({ openDictionary: noop }),
      },
      "../../context/ThemeSettingsContext": {
        useThemeSettings: () => ({
          settings: {
            theme: "classic",
            paliScript: "roman",
            translations: { english: true, vietnamese: true },
            translationOrder: ["english", "vietnamese"],
            translationColors: {},
          },
        }),
        resolveTranslationTextColor: () => "#1d4ed8",
      },
    },
  );

  const { extractLinkedWordAtOffset, extractClickedWord } = linkedMod;

  // Word extraction across scripts and translation languages
  assert.equal(
    extractLinkedWordAtOffset("mettāti mettiyati", 2, "pali")?.word,
    "mettāti",
  );
  assert.equal(
    extractLinkedWordAtOffset("Loving-kindness means friendliness.", 18, "en")
      ?.word,
    "means",
  );
  assert.equal(
    extractLinkedWordAtOffset("Tâm từ nghĩa là lòng thương.", 9, "vi")?.word,
    "nghĩa",
  );
  assert.equal(
    extractLinkedWordAtOffset("ความเมตตาต่อสรรพสัตว์", 5, "th")?.word,
    "เมตตา",
  );
  assert.equal(
    (extractLinkedWordAtOffset("慈悲喜舍", 0, "zh")?.word || "").length >= 1,
    true,
  );
  assert.equal(
    extractLinkedWordAtOffset("နမော တဿ ဘဂဝတော", 5, "my")?.word,
    "တဿ",
  );
  assert.equal(extractLinkedWordAtOffset("", 0, "en"), null);
  assert.equal(extractLinkedWordAtOffset("   ", 1, "en"), null);

  // extractClickedWord handles TEXT_NODE, ELEMENT_NODE, and rejects clicks outside glyph bounds
  const origDoc = globalThis.document;
  try {
    const makeRange = (rect) => ({
      setStart() {},
      setEnd() {},
      selectNodeContents() {},
      getClientRects: () => (rect ? [rect] : []),
    });
    const enNode = {
      nodeType: 3,
      textContent: "Loving kindness leads to peace",
    };
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: enNode, startOffset: 9 }),
      createRange: () =>
        makeRange({
          left: 10,
          top: 10,
          right: 90,
          bottom: 28,
          width: 80,
          height: 18,
        }),
    };
    assert.equal(
      extractClickedWord({ clientX: 40, clientY: 20 }, "en"),
      "kindness",
    );

    // Click far outside rect -> rejected
    assert.equal(extractClickedWord({ clientX: 400, clientY: 20 }, "en"), "");

    // ELEMENT_NODE hit (e.g. clicking inside <em>word</em>)
    const emChild = { nodeType: 3, textContent: "compassion" };
    const emEl = { nodeType: 1, childNodes: [emChild] };
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: emEl, startOffset: 0 }),
      createRange: () =>
        makeRange({
          left: 20,
          top: 10,
          right: 110,
          bottom: 28,
          width: 90,
          height: 18,
        }),
      createTreeWalker: () => ({ nextNode: () => null }),
    };
    assert.equal(
      extractClickedWord({ clientX: 60, clientY: 20 }, "en"),
      "compassion",
    );
  } finally {
    globalThis.document = origDoc;
  }

  // Rendered LinkedDefinitionModal attaches cursor-pointer and click handling to translation text too
  const html = renderToStaticMarkup(
    React.createElement(linkedMod.default, {
      onClose: noop,
      activeLangs: ["en", "vi"],
      currentScript: "roman",
      link: {
        target_book: "s0101a.att",
        target_book_title: "Sīlakkhandhavagga-aṭṭhakathā",
        target_category: "aṭṭhakathā",
        target_chapter: 0,
        target_para_index: 5,
        target_para_num: "5",
        target_line_id: 1,
        word: "mettā",
      },
    }),
  );

  assert.match(html, /linked-def-modal-backdrop/);
  assert.match(html, /linked-def-pali-text[^"]*cursor-pointer/);
  assert.match(html, /linked-def-trans-text[^"]*cursor-pointer/);
  assert.match(html, /Loving-kindness means friendliness/);
  assert.match(html, /Tâm từ nghĩa là lòng thương/);

  // Line selection guard skips both .linked-def-pali-text and .linked-def-trans-text
  const linkedSrc = fs.readFileSync(
    path.join(rootDir, "components/Reader/LinkedDefinitionModal.jsx"),
    "utf8",
  );
  assert.match(
    linkedSrc,
    /closest\([^)]*\.linked-def-pali-text,\s*\.linked-def-trans-text/,
  );
});

test("Task 2: BoldDefinitionSection allows translation word clicks, DictionaryModal segments translation languages, and clicked-word highlight has no underline", () => {
  const boldMod = compileModule("components/BoldDefinitionSection.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "../services/transliterate": compileModule("services/transliterate.js", {}),
    "../services/translationFormat": compileModule(
      "services/translationFormat.js",
      {},
    ),
    "../context/ThemeSettingsContext": {
      useThemeSettings: () => ({
        settings: {
          theme: "classic",
          paliScript: "roman",
          translations: { english: true, vietnamese: true },
          translationOrder: ["english", "vietnamese"],
          translationColors: {},
        },
      }),
      resolveTranslationTextColor: () => "#1d4ed8",
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(boldMod.default, {
      queryWord: "mettā",
      searchPrefix: "mett",
      results: [
        {
          id: 1,
          book_code: "s0101a.att",
          book_title: "Sīlakkhandhavagga-aṭṭhakathā",
          category: "aṭṭhakathā",
          chapter_index: 0,
          para_index: 5,
          para_num: "5",
          line_id: 1,
          bold_word: "mettā",
          pali_sentence: "mettāti mettiyati",
          translations: {
            en: "Loving-kindness is friendliness.",
            vi: "Tâm từ là lòng thân ái.",
          },
        },
      ],
      onOpenPassage: noop,
    }),
  );

  // Translation text container must NOT be blocked by .bold-def-nonlookup; only the small lang badge has it
  assert.match(html, /class="bold-def-trans-text[^"]*cursor-pointer[^"]*"/);
  assert.match(html, /data-trans-lang="en"/);
  assert.match(html, /data-trans-lang="vi"/);
  const transBlock = html.slice(html.indexOf("bold-def-trans-row"));
  assert.match(transBlock, /<span class="bold-def-nonlookup[^"]*">en<\/span>/);
  assert.doesNotMatch(
    html.slice(html.lastIndexOf("<div", html.indexOf("bold-def-trans-row"))),
    /class="[^"]*bold-def-nonlookup[^"]*"[^>]*data-trans-lang=/,
  );
  // Wrapper around translation rows must not carry bold-def-nonlookup
  const boldSrc = fs.readFileSync(
    path.join(rootDir, "components/BoldDefinitionSection.jsx"),
    "utf8",
  );
  assert.doesNotMatch(
    boldSrc,
    /bold-def-nonlookup[^>]*>\s*\{translations\.map/,
  );

  // DictionaryModal extracts translation words cleanly (including space-less Thai/Chinese via Intl.Segmenter)
  const dictMod = compileModule("components/DictionaryModal.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "../context/DictionaryContext": {
      useDictionary: () => ({}),
      DEFAULT_DICT_ORDER: [],
      DEFAULT_DICT_ENABLED: {},
    },
    "../context/ThemeSettingsContext": {
      useThemeSettings: () => ({ settings: {} }),
    },
    "../context/TabContext": { useTabs: () => ({}) },
    "./BoldDefinitionSection": { __esModule: true, default: () => null },
    "../services/transliterate": compileModule("services/transliterate.js", {}),
    "../services/api": { fetchDictionaryInflection: async () => null },
    "../services/dpdFeedback": { restoreMinifiedLinks: (s) => s },
  });

  const { extractWordBoundsAtTextOffset, extractWordFromPointerEvent } =
    dictMod;

  const enBounds = extractWordBoundsAtTextOffset(
    "Loving kindness leads to peace",
    9,
    "en",
  );
  assert.equal(
    "Loving kindness leads to peace".slice(enBounds.start, enBounds.end),
    "kindness",
  );

  const viBounds = extractWordBoundsAtTextOffset(
    "Tâm từ là lòng thân ái",
    11,
    "vi",
  );
  assert.equal(
    "Tâm từ là lòng thân ái".slice(viBounds.start, viBounds.end),
    "lòng",
  );

  const thText = "ความเมตตาต่อสรรพสัตว์";
  const thBounds = extractWordBoundsAtTextOffset(thText, 5, "th");
  assert.equal(thText.slice(thBounds.start, thBounds.end), "เมตตา");

  // extractWordFromPointerEvent reads ancestor [data-trans-lang] for Thai/English translation clicks
  const origDoc = globalThis.document;
  try {
    const langParent = {
      closest: (sel) =>
        sel === "[data-trans-lang]" ? { getAttribute: () => "th" } : null,
    };
    const thNode = {
      nodeType: 3,
      textContent: thText,
      parentElement: langParent,
    };
    globalThis.document = {
      caretRangeFromPoint: () => ({ startContainer: thNode, startOffset: 5 }),
      createRange: () => ({
        setStart() {},
        setEnd() {},
        getClientRects: () => [
          { left: 0, top: 0, right: 120, bottom: 24, width: 120, height: 24 },
        ],
      }),
    };
    assert.equal(
      extractWordFromPointerEvent({ clientX: 40, clientY: 12 }),
      "เมตตา",
    );
  } finally {
    globalThis.document = origDoc;
  }

  // CSS: ::highlight(reader-clicked-word) has color highlight ONLY (no underline),
  // and DictionaryModal stacks above LinkedDefinitionModal when open together
  const cssSrc = fs.readFileSync(path.join(rootDir, "app/globals.css"), "utf8");
  const hlMatch = cssSrc.match(
    /::highlight\(reader-clicked-word\)\s*\{([^}]*)\}/,
  );
  assert.ok(
    hlMatch,
    "::highlight(reader-clicked-word) rule must exist in globals.css",
  );
  assert.match(hlMatch[1], /background-color:\s*#ffff00/i);
  assert.match(hlMatch[1], /color:\s*#000000/i);
  assert.doesNotMatch(
    hlMatch[1],
    /text-decoration/i,
    "Clicked-word highlight must NOT include underline",
  );

  assert.match(
    cssSrc,
    /body:has\(\.linked-def-modal-backdrop\)\s+\.dict-overlay/,
  );
  assert.match(
    cssSrc,
    /body:has\(\.linked-def-modal-backdrop\)\s+aside\.dict-dock-panel/,
  );
  assert.match(cssSrc, /z-index:\s*1160\s*!important/);
});

// =========================================================================
// Task 3: Responsive default tabView & reliable mobile scroll bar toggling
// =========================================================================

test('Task 3: getDefaultTabView returns "tabbed" on mobile/small screens and "columns" on larger screens, migrating un-customized defaults', () => {
  const themeMod = compileModule("context/ThemeSettingsContext.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "../services/api": {
      fetchAvailableTranslations: async () => [],
      isOfflineApp: () => false,
    },
  });

  const { getDefaultTabView } = themeMod;

  // Small / mobile widths -> tabbed
  assert.equal(getDefaultTabView(320), "tabbed");
  assert.equal(getDefaultTabView(375), "tabbed");
  assert.equal(getDefaultTabView(767), "tabbed");
  assert.equal(getDefaultTabView(899), "tabbed");

  // Larger desktop / tablet-landscape widths -> columns
  assert.equal(getDefaultTabView(900), "columns");
  assert.equal(getDefaultTabView(1024), "columns");
  assert.equal(getDefaultTabView(1440), "columns");

  // ThemeSettingsContext tracks tabViewExplicit so legacy auto-saved 'columns' migrates on mobile
  const themeSrc = fs.readFileSync(
    path.join(rootDir, "context/ThemeSettingsContext.jsx"),
    "utf8",
  );
  assert.match(themeSrc, /tabViewExplicit/);
  assert.match(
    themeSrc,
    /!parsed\.tabViewExplicit && merged\.tabView === 'columns'/,
  );
  assert.match(
    themeSrc,
    /resetToDefaults[\s\S]*?tabView:\s*getDefaultTabView\(\)/,
  );

  // BookTabsBar & SettingsModal use responsive fallbacks instead of hardcoded 'columns'
  const tabsBarSrc = fs.readFileSync(
    path.join(rootDir, "components/BookTabsBar.jsx"),
    "utf8",
  );
  assert.match(
    tabsBarSrc,
    /settings\?\.tabView \|\| \(viewportWidth < 900 \? 'tabbed' : 'columns'\)/,
  );

  const settingsSrc = fs.readFileSync(
    path.join(rootDir, "components/Settings/SettingsModal.jsx"),
    "utf8",
  );
  assert.match(
    settingsSrc,
    /settings\.tabView \|\| \(isMobileScreen \? 'tabbed' : 'columns'\)/,
  );
});

test("Task 3: computeNextHeaderVisibility handles jitter, rapid direction reversal, bottom overscroll, and near-top cleanly", () => {
  const noopComp = () => null;
  const readerMod = compileModule("components/Reader/ReaderView.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "./WelcomeView": { __esModule: true, default: noopComp },
    "./MeditationLoader": { __esModule: true, default: noopComp },
    "./BookTocView": { __esModule: true, default: noopComp },
    "./LinkedDefinitionModal": { __esModule: true, default: noopComp },
    "../AiChat/AiChatView": { __esModule: true, default: noopComp },
    "../../context/TabContext": { useTabs: () => ({}) },
    "../../context/ThemeSettingsContext": {
      useThemeSettings: () => ({}),
      getDefaultTranslationColorsForTheme: () => ({
        text: "#000",
        border: "#000",
        bg: "",
      }),
    },
    "../../context/DictionaryContext": { useDictionary: () => ({}) },
    "../../services/transliterate": compileModule(
      "services/transliterate.js",
      {},
    ),
    "../../services/scroll": compileModule("services/scroll.js", {}),
    "../../services/api": {
      fetchChapterTranslations: async () => ({}),
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: noop,
      prefetchLinkedPreviewsBatch: noop,
    },
  });

  const { computeNextHeaderVisibility } = readerMod;
  assert.equal(typeof computeNextHeaderVisibility, "function");

  // Helper to simulate a sequence of scrollTop samples
  const runScrollTrace = (
    samples,
    { initialVisible = true, viewportHeight = 700, scrollHeight = 4000 } = {},
  ) => {
    let state = {
      isHeaderVisible: initialVisible,
      upPeakY: samples[0] ?? 0,
      downPeakY: samples[0] ?? 0,
    };
    const history = [];
    for (const top of samples) {
      const next = computeNextHeaderVisibility({
        top,
        isHeaderVisible: state.isHeaderVisible,
        upPeakY: state.upPeakY,
        downPeakY: state.downPeakY,
        viewportHeight,
        scrollHeight,
        isJumping: false,
      });
      state = {
        isHeaderVisible: next.nextVisible,
        upPeakY: next.upPeakY,
        downPeakY: next.downPeakY,
      };
      history.push({ top, visible: state.isHeaderVisible });
    }
    return history;
  };

  // 1. Scrolling down past 64px by >= 36px hides bars even with mobile touch micro-jitter (-1 / -2px)
  const downJitter = runScrollTrace([0, 20, 40, 60, 70, 82, 80, 95, 93, 112]);
  assert.equal(
    downJitter[downJitter.length - 1].visible,
    false,
    "Jittery downward scroll must still hide header/footer",
  );

  // 2. Scrolling up by >= 24px from middle of page reveals bars even with +2px touch wobble
  const upJitter = runScrollTrace([500, 490, 492, 480, 481, 470], {
    initialVisible: false,
  });
  assert.equal(
    upJitter[upJitter.length - 1].visible,
    true,
    "Jittery upward scroll must still reveal header/footer",
  );

  // 3. Returning near top (<= 24px) ALWAYS reveals bars even if step was small
  const nearTop = runScrollTrace([30, 20], { initialVisible: false });
  assert.equal(
    nearTop[1].visible,
    true,
    "Reaching near top must always reveal bars",
  );

  // 4. iOS bottom rubber-band overscroll (top > maxScroll = 3300) must NOT falsely reveal hidden bars
  const bottomBounce = runScrollTrace([3280, 3300, 3360, 3320, 3300], {
    initialVisible: false,
    viewportHeight: 700,
    scrollHeight: 4000,
  });
  assert.equal(
    bottomBounce.every((s) => s.visible === false),
    true,
    "Overscroll bounce at bottom must not falsely reveal bars",
  );

  // 5. Deliberate upward scroll starting right from the bottom (maxScroll = 3300) MUST reveal bars immediately (no deadzone!)
  const upFromBottom = runScrollTrace([3300, 3285, 3268], {
    initialVisible: false,
    viewportHeight: 700,
    scrollHeight: 4000,
  });
  assert.equal(
    upFromBottom[upFromBottom.length - 1].visible,
    true,
    "Scrolling up from very bottom must immediately reveal bars",
  );

  // 6. Programmatic jump suppresses visibility changes while tracking peaks accurately
  const jumpRes = computeNextHeaderVisibility({
    top: 1200,
    isHeaderVisible: true,
    upPeakY: 0,
    downPeakY: 0,
    viewportHeight: 700,
    scrollHeight: 4000,
    isJumping: true,
  });
  assert.equal(jumpRes.nextVisible, true);
  assert.equal(jumpRes.upPeakY, 1200);
  assert.equal(jumpRes.downPeakY, 1200);

  // Structural assertions on ReaderView.jsx & scroll.js for mobile scroll reliability
  const readerSrc = fs.readFileSync(
    path.join(rootDir, "components/Reader/ReaderView.jsx"),
    "utf8",
  );
  assert.match(readerSrc, /activeTabRef\.current/);
  assert.match(readerSrc, /processScrollTopRef\.current/);
  assert.match(readerSrc, /cancelSmartScroll\?\.\(containerRef\.current\)/);
  assert.match(readerSrc, /addEventListener\('touchmove', onUserInput/);

  const scrollMod = compileModule("services/scroll.js", {});
  assert.equal(typeof scrollMod.cancelSmartScroll, "function");
  // Calling cancelSmartScroll on null / unknown element is safe no-op
  assert.doesNotThrow(() => scrollMod.cancelSmartScroll(null));
  assert.doesNotThrow(() => scrollMod.cancelSmartScroll({}));
});

// =========================================================================
// Task 4: Ani Gemini reliability — parts extraction, retry/404 fallback, balanced bold defs, model filter
// =========================================================================

test("Task 4: aiClientAgent handles Gemini 3.x thinking parts, 503 retry, 404 fallback, abort signal, and balanced bold-def terms", async () => {
  const aiMod = compileModule("services/aiClientAgent.js", {
    "./api": {
      fetchAiEndpoint: async () => ({ ok: true, json: async () => ({}) }),
    },
  });

  const {
    extractGeminiTextFromParts,
    getGeminiFallbackModels,
    fetchGeminiWithRetry,
    mergeUnderstandingWithLocal,
  } = aiMod;

  // 1. extractGeminiTextFromParts skips thought parts and joins multi-part text cleanly
  assert.equal(
    extractGeminiTextFromParts([
      { text: "internal reasoning...", thought: true },
      { text: "Hello " },
      { text: "world!", thoughtSignature: "abc123" },
    ]),
    "Hello world!",
  );
  assert.equal(extractGeminiTextFromParts(null), "");
  assert.equal(extractGeminiTextFromParts([]), "");

  // 2. Fallback list excludes primary model and includes -latest aliases + concrete 3.x models
  const fb = getGeminiFallbackModels("gemini-flash-lite-latest");
  assert.equal(fb.includes("gemini-flash-lite-latest"), false);
  assert.equal(fb[0], "gemini-flash-latest");
  assert.equal(fb.includes("gemini-3.1-flash-lite"), true);

  // 3. Balanced bold-def terms across concept groups (1 primary Pāḷi term per concept group first)
  const merged = mergeUnderstandingWithLocal(
    {
      concept_groups: [
        {
          concept: "Anger",
          pali_terms: ["kodha", "dosa", "vyāpāda"],
          pali_stems: ["kodh*"],
          english_keywords: ["anger"],
        },
        {
          concept: "Loving-kindness",
          pali_terms: ["mettā", "averā"],
          pali_stems: ["mett*"],
          english_keywords: ["loving-kindness"],
        },
      ],
      canonical_pali_terms: ["kodha", "dosa", "vyāpāda", "mettā"],
      key_terms_for_bold_def: [],
    },
    null,
    "Overcoming anger with loving-kindness",
  );
  assert.ok(merged.key_terms_for_bold_def.includes("kodha"));
  assert.ok(merged.key_terms_for_bold_def.includes("mettā"));

  // 4. fetchGeminiWithRetry retries transient 503 and switches on 404 deprecated model
  const origFetch = globalThis.fetch;
  try {
    // Case A: 404 on gemini-2.5-flash immediately falls back to gemini-flash-lite-latest
    const calls404 = [];
    globalThis.fetch = async (url) => {
      calls404.push(url);
      if (url.includes("gemini-2.5-flash:")) {
        return { ok: false, status: 404, text: async () => "Model not found" };
      }
      return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
    };
    const r404 = await fetchGeminiWithRetry({
      model: "gemini-2.5-flash",
      apiKey: "test+key/special",
      payload: { contents: [] },
      timeoutMs: 5000,
      maxRetries: 1,
      allowFallback: true,
    });
    r404.cleanupAbort?.();
    assert.equal(r404.res.ok, true);
    assert.equal(r404.modelUsed, "gemini-flash-lite-latest");
    assert.equal(calls404.length, 2);
    assert.ok(
      calls404[0].includes("key=test%2Bkey%2Fspecial"),
      "API key must be URL-encoded",
    );

    // Case B: Transient 503 succeeds on retry
    let attempt503 = 0;
    globalThis.fetch = async () => {
      attempt503++;
      if (attempt503 === 1) {
        return { ok: false, status: 503, text: async () => "High demand" };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const r503 = await fetchGeminiWithRetry({
      model: "gemini-flash-lite-latest",
      apiKey: "dummy",
      payload: { contents: [] },
      timeoutMs: 5000,
      maxRetries: 1,
      allowFallback: true,
    });
    r503.cleanupAbort?.();
    assert.equal(r503.res.ok, true);
    assert.equal(attempt503, 2);

    // Case C: Pre-aborted signal throws AbortError immediately without calling fetch
    let fetchCalledOnAbort = false;
    globalThis.fetch = async () => {
      fetchCalledOnAbort = true;
      return { ok: true, status: 200 };
    };
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () =>
        fetchGeminiWithRetry({
          model: "gemini-flash-lite-latest",
          apiKey: "dummy",
          payload: { contents: [] },
          signal: ac.signal,
        }),
      (err) => err && err.name === "AbortError",
    );
    assert.equal(fetchCalledOnAbort, false);

    // Case D: HTTP 400 when thinkingConfig is unsupported strips thinkingConfig and retries once cleanly
    const thinkingPayloads = [];
    globalThis.fetch = async (_url, opts) => {
      const p = JSON.parse(opts.body);
      thinkingPayloads.push(p);
      if (p.generationConfig?.thinkingConfig) {
        return {
          ok: false,
          status: 400,
          text: async () => "thinkingConfig not supported",
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const r400 = await fetchGeminiWithRetry({
      model: "gemini-flash-lite-latest",
      apiKey: "dummy",
      payload: { contents: [], generationConfig: { temperature: 0.2 } },
      thinkingLevel: "low",
      timeoutMs: 5000,
      maxRetries: 1,
      allowFallback: false,
    });
    r400.cleanupAbort?.();
    assert.equal(r400.res.ok, true);
    assert.equal(thinkingPayloads.length, 2);
    assert.deepEqual(thinkingPayloads[0].generationConfig.thinkingConfig, {
      thinkingLevel: "low",
    });
    assert.equal(
      thinkingPayloads[1].generationConfig.thinkingConfig,
      undefined,
    );

    // Case D2: minimal -> low downgrade succeeds on second call when only MINIMAL is rejected (e.g. gemini-3.8-flash)
    const downgradePayloads = [];
    globalThis.fetch = async (_url, opts) => {
      const p = JSON.parse(opts.body);
      downgradePayloads.push(p);
      if (p.generationConfig?.thinkingConfig?.thinkingLevel === "minimal") {
        return {
          ok: false,
          status: 400,
          text: async () =>
            "Thinking level MINIMAL is not supported for this model.",
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const rDowngrade = await fetchGeminiWithRetry({
      model: "gemini-3.8-flash",
      apiKey: "dummy",
      payload: { contents: [], generationConfig: { temperature: 0.2 } },
      thinkingLevel: "minimal",
      timeoutMs: 5000,
      maxRetries: 1,
      allowFallback: false,
    });
    rDowngrade.cleanupAbort?.();
    assert.equal(rDowngrade.res.ok, true);
    assert.equal(downgradePayloads.length, 2);
    assert.deepEqual(downgradePayloads[0].generationConfig.thinkingConfig, {
      thinkingLevel: "minimal",
    });
    assert.deepEqual(downgradePayloads[1].generationConfig.thinkingConfig, {
      thinkingLevel: "low",
    });

    // Case E: Premature Gemini SSE EOF (finishReason: null + usageMetadata) seamlessly auto-continues until STOP
    const encoder = new TextEncoder();
    const makeStream = (chunks) =>
      new ReadableStream({
        start(ctl) {
          for (const ch of chunks) ctl.enqueue(encoder.encode(ch));
          ctl.close();
        },
      });
    let sseCalls = 0;
    let totalFetchCalls = 0;
    globalThis.fetch = async (url) => {
      totalFetchCalls++;
      if (url.includes("streamGenerateContent")) {
        sseCalls++;
        if (sseCalls === 1) {
          return {
            ok: true,
            status: 200,
            body: makeStream([
              'data: {"candidates":[{"content":{"parts":[{"text":"Mettā means lov"}]}}],"usageMetadata":{"candidatesTokenCount":12}}\n\n',
            ]),
          };
        }
        return {
          ok: true,
          status: 200,
          body: makeStream([
            'data: {"candidates":[{"content":{"parts":[{"text":"ing-kindness [s0101a.att:c0:p1-L1]."}]},"finishReason":"STOP"}],"usageMetadata":{"candidatesTokenCount":25}}\n\n',
          ]),
        };
      }
      if (totalFetchCalls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        intent: "term_analysis",
                        detected_language: "en",
                        concept_groups: [
                          {
                            concept: "Metta",
                            pali_terms: ["mettā"],
                            pali_stems: ["mett*"],
                            english_keywords: ["loving-kindness"],
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "final_answer",
                      args: { summary: "Ready" },
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    let fullStreamed = "";
    let streamedCites = [];
    await aiMod.runClientAiAgent({
      userQuery: "What is metta?",
      conversationHistory: [],
      aiSettings: {
        provider: "gemini",
        apiKey: "AIzaDummyTestKey",
        toolModel: "gemini-flash-lite-latest",
        answerModel: "gemini-flash-lite-latest",
      },
      onToken: (t) => {
        fullStreamed += t;
      },
      onCitations: (c) => {
        streamedCites = c;
      },
      onError: (e) => {
        throw e;
      },
    });
    assert.equal(
      sseCalls,
      2,
      "Premature SSE EOF with usageMetadata must trigger seamless continuation",
    );
    assert.equal(
      fullStreamed,
      "Mettā means loving-kindness [s0101a.att:c0:p1-L1].",
    );
    assert.equal(streamedCites.length, 1);
  } finally {
    globalThis.fetch = origFetch;
  }

  // 5. AiSettingsModal filters out non-chat media/audio/image/research models
  const settingsMod = compileModule("components/AiChat/AiSettingsModal.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "../../services/api": { fetchAiEndpoint: async () => ({ ok: true }) },
  });

  const filtered = settingsMod.filterGeminiChatModels([
    {
      name: "models/gemini-flash-lite-latest",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/gemini-3.1-flash-lite",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/gemini-2.5-flash-image",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/gemini-2.5-flash-preview-tts",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/lyria-3.5",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/nano-banana-pro-preview",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/gemini-3.5-transcribe",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/deep-research-pro-preview-12-2025",
      supportedGenerationMethods: ["generateContent"],
    },
    {
      name: "models/text-embedding-004",
      supportedGenerationMethods: ["embedContent"],
    },
  ]);
  assert.deepEqual(
    filtered.map((m) => m.id),
    ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"],
  );

  // 6. Server-side aiQueryUnderstanding also balances bold-def terms across concept groups
  const qu = require(
    path.join(rootDir, "server_api", "aiQueryUnderstanding.js"),
  );
  const serverUnd = qu.heuristicQueryUnderstanding(
    "How does the Buddha teach overcoming anger with loving-kindness?",
    [],
  );
  assert.ok(serverUnd.concept_groups.length >= 2);
  assert.ok(serverUnd.key_terms_for_bold_def.length >= 2);
});

// =========================================================================
// Task 5: Markdown for Agents Content Negotiation (Accept: text/markdown)
// =========================================================================

test("Markdown for Agents: prefersMarkdownAccept, renderMarkdownForPath, route handler headers (Content-Type: text/markdown & x-markdown-tokens), and proxy negotiation", async () => {
  const transliterateMod = compileModule("services/transliterate.js", {});
  const seoMod = compileModule("services/seoMetadata.js", {
    "./transliterate.js": transliterateMod,
  });
  const ssrCatMod = compileModule("services/ssrCatalog.js", {
    "./transliterate.js": transliterateMod,
    "./seoMetadata.js": seoMod,
  });
  const ssrContentMod = await import(
    path.join(rootDir, "services", "ssrContent.js")
  );
  const ssrMd = compileModule("services/ssrMarkdown.js", {
    "./transliterate.js": transliterateMod,
    "./seoMetadata.js": seoMod,
    "./ssrCatalog.js": ssrCatMod,
    "./ssrContent.js": ssrContentMod,
  });
  const {
    prefersMarkdownAccept,
    estimateMarkdownTokens,
    renderMarkdownForPath,
  } = ssrMd;

  // 1. Content negotiation Accept header parsing (HTML stays default for browsers)
  assert.equal(prefersMarkdownAccept(""), false);
  assert.equal(prefersMarkdownAccept(null), false);
  assert.equal(
    prefersMarkdownAccept(
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ),
    false,
    "Standard browser Accept header must default to HTML",
  );
  assert.equal(
    prefersMarkdownAccept("text/html;q=0.9, text/markdown;q=0.5"),
    false,
    "Lower q-weight for text/markdown than text/html must keep HTML",
  );
  assert.equal(prefersMarkdownAccept("text/markdown"), true);
  assert.equal(
    prefersMarkdownAccept("text/markdown, text/html;q=0.8, */*;q=0.5"),
    true,
  );
  assert.equal(
    prefersMarkdownAccept("text/html, text/markdown"),
    true,
    "Equal quality with explicit text/markdown negotiates markdown",
  );
  assert.equal(prefersMarkdownAccept("text/x-markdown"), true);
  assert.equal(prefersMarkdownAccept("text/markdown;q=0"), false);

  // 2. Render Markdown for /, /info, /pali-script-converter, /book/*, /translation/*
  const homeMd = await renderMarkdownForPath("/");
  assert.ok(homeMd && homeMd.status === 200);
  assert.match(homeMd.markdown, /^---\ntitle:/);
  assert.match(homeMd.markdown, /Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi/);
  assert.ok(homeMd.tokens > 500);

  const infoMd = await renderMarkdownForPath("/info");
  assert.ok(infoMd && infoMd.status === 200);
  assert.match(infoMd.markdown, /^---\ntitle: "About & User Guide/);
  assert.match(infoMd.markdown, /```json\n\{.*"@type":"WebPage".*\}\n```/s);

  const convMd = await renderMarkdownForPath("/pali-script-converter");
  assert.ok(convMd && convMd.status === 200);
  assert.match(convMd.markdown, /Pāḷi Script Converter/);

  const bookMd = await renderMarkdownForPath("/book/s0102m.mul/9");
  assert.ok(bookMd && bookMd.status === 200);
  assert.match(bookMd.markdown, /^---\ntitle: "Ch\. 9: Mahāsatipaṭṭhānasuttaṃ/);
  assert.match(bookMd.markdown, /\[s0102m\.mul:c8:p1341\]/);
  assert.match(bookMd.markdown, /Evaṃ me sutaṃ/);
  assert.match(bookMd.markdown, /```json\n\{.*"@type":"Chapter"/s);
  assert.ok(bookMd.tokens > 200);

  const hiBookMd = await renderMarkdownForPath("/book/hi.s0102m.mul/9");
  assert.ok(hiBookMd && hiBookMd.status === 200);
  assert.match(hiBookMd.markdown, /महासतिपट्ठानसुत्तं/);
  assert.match(hiBookMd.markdown, /एवं मे सुतं/);

  const viTransMd = await renderMarkdownForPath("/translation/vi/s0102m.mul/9");
  assert.ok(viTransMd && viTransMd.status === 200);
  assert.match(viTransMd.markdown, /Như vầy tôi đã nghe/);
  assert.match(viTransMd.markdown, /\*Pāḷi:\* .*Evaṃ me sutaṃ/);

  const notFoundMd = await renderMarkdownForPath("/book/nonexistent_book.mul");
  assert.equal(notFoundMd, null);

  // 3. Verify Route Handler (/api/markdown/[[...path]]) sets Content-Type: text/markdown & x-markdown-tokens
  const routeMod = compileModule("app/api/markdown/[[...path]]/route.js", {
    "next/server": {
      NextResponse: class MockNextResponse {
        constructor(body, init = {}) {
          this.body = body;
          this.status = init.status || 200;
          this.headers = new Map(
            Object.entries(init.headers || {}).map(([k, v]) => [
              k.toLowerCase(),
              v,
            ]),
          );
        }
      },
    },
    "../../../../services/ssrMarkdown.js": ssrMd,
  });

  const okResp = await routeMod.GET(
    {},
    { params: Promise.resolve({ path: ["book", "s0101m.mul"] }) },
  );
  assert.equal(okResp.status, 200);
  assert.equal(
    okResp.headers.get("content-type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(okResp.headers.get("vary"), "Accept");
  assert.ok(Number(okResp.headers.get("x-markdown-tokens")) > 100);
  assert.match(
    okResp.headers.get("content-signal"),
    /ai-train=yes, search=yes, ai-input=yes/,
  );

  const errResp = await routeMod.GET(
    {},
    { params: Promise.resolve({ path: ["book", "invalid.mul"] }) },
  );
  assert.equal(errResp.status, 404);
  assert.equal(
    errResp.headers.get("content-type"),
    "text/markdown; charset=utf-8",
  );
  assert.ok(
    Number(errResp.headers.get("x-markdown-tokens")) ===
      estimateMarkdownTokens(errResp.body),
  );

  // 4. Verify proxy.js rewrites Accept: text/markdown to /api/markdown/... while leaving HTML default
  const proxyActions = [];
  const proxyMod = compileModule("proxy.js", {
    "next/server": {
      NextResponse: {
        rewrite: (url) => {
          const headers = new Map();
          const resp = { type: "rewrite", url: String(url), headers };
          proxyActions.push(resp);
          return resp;
        },
        next: () => {
          const headers = new Map();
          const resp = { type: "next", headers };
          proxyActions.push(resp);
          return resp;
        },
        redirect: (url, status) => ({
          type: "redirect",
          url: String(url),
          status,
          headers: new Map(),
        }),
      },
    },
    "./services/ssrCatalog": compileModule("services/ssrCatalog.js", {
      "./transliterate.js": compileModule("services/transliterate.js", {}),
      "./seoMetadata.js": compileModule("services/seoMetadata.js", {
        "./transliterate.js": compileModule("services/transliterate.js", {}),
      }),
    }),
    "./services/ssrMarkdown": ssrMd,
  });

  const makeReq = (pathname, accept) => ({
    url: `https://tipitakapali.org${pathname}`,
    nextUrl: Object.assign(new URL(`https://tipitakapali.org${pathname}`), {
      clone() {
        return new URL(this.toString());
      },
    }),
    headers: {
      get: (k) => (k.toLowerCase() === "accept" ? accept : null),
    },
  });

  const mdRoot = proxyMod.proxy(makeReq("/", "text/markdown"));
  assert.equal(mdRoot.type, "rewrite");
  assert.equal(mdRoot.url, "https://tipitakapali.org/api/markdown");
  assert.equal(mdRoot.headers.get("Vary"), "Accept");

  const mdBook = proxyMod.proxy(
    makeReq("/book/s0101m.mul/1", "text/markdown, text/html;q=0.8"),
  );
  assert.equal(mdBook.type, "rewrite");
  assert.equal(
    mdBook.url,
    "https://tipitakapali.org/api/markdown/book/s0101m.mul/1",
  );

  const htmlBrowser = proxyMod.proxy(
    makeReq("/book/s0101m.mul/1", "text/html,application/xhtml+xml,*/*;q=0.8"),
  );
  assert.equal(
    htmlBrowser.type,
    "next",
    "Browser requests without text/markdown must receive HTML default",
  );
  assert.equal(htmlBrowser.headers.get("Vary"), "Accept");

  // 5. Verify VPS server_api/markdownEngine.js renders real book/chapter/script/translation markdown
  const serverRequire = createRequire(
    path.join(rootDir, "server_api", "package.json"),
  );
  const Database = serverRequire("better-sqlite3");
  const { createMarkdownEngine } = require(
    path.join(rootDir, "server_api", "markdownEngine.js"),
  );
  const { getTranslationEngine } = require(
    path.join(rootDir, "server_api", "translationEngine.js"),
  );
  const { getColumnSet, decodeTextOrZlib } = require(
    path.join(rootDir, "server_api", "tipitakaCoreHelper.js"),
  );
  const cstCatalog = JSON.parse(
    fs.readFileSync(
      path.join(rootDir, "server_api", "cst_books_catalog.json"),
      "utf8",
    ),
  );
  const db = new Database(
    path.join(rootDir, "server_api", "db", "tipitaka.db"),
    { readonly: true },
  );
  try {
    const hasChapterHtmlZ = getColumnSet(db, "chapters").has("html_z");
    const stmtGetChapters = db.prepare(
      "SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index",
    );
    const stmtGetChapterHtml = db.prepare(
      hasChapterHtmlZ
        ? "SELECT html, html_z FROM chapters WHERE book_code = ? AND chapter_index = ?"
        : "SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ?",
    );
    const mdEngine = createMarkdownEngine({
      cstCatalog,
      stmtGetChapters,
      stmtGetChapterHtml,
      hasChapterHtmlZ,
      decodeTextOrZlib,
      translationEngine: getTranslationEngine(),
    });

    const vpsDn1Ch1 = mdEngine.renderPath("/book/s0101m.mul/1");
    assert.ok(vpsDn1Ch1 && vpsDn1Ch1.status === 200);
    assert.match(vpsDn1Ch1.markdown, /Brahmajālasuttaṃ/);
    assert.match(vpsDn1Ch1.markdown, /Evaṃ me sutaṃ/);
    assert.match(vpsDn1Ch1.markdown, /\[s0101m\.mul:c0:p\d+\]/);
    assert.ok(vpsDn1Ch1.tokens > 500);

    const vpsSiDn1 = mdEngine.renderPath("/book/si.s0101m.mul/1");
    assert.ok(vpsSiDn1 && vpsSiDn1.status === 200);
    assert.match(vpsSiDn1.markdown, /බ්‍රහ්මජාලසුත්තං/);

    const vpsViDn2 = mdEngine.renderPath("/translation/vi/s0102m.mul/9");
    assert.ok(vpsViDn2 && vpsViDn2.status === 200);
    assert.match(vpsViDn2.markdown, /Như vầy tôi đã nghe/);
  } finally {
    db.close();
  }
});

test("Task 6: Mobile inputs, textareas, and selects enforce >= 16px font-size to prevent iOS/WKWebView auto-zoom while preserving pinch-zoom", () => {
  const globalsCss = fs.readFileSync(path.join(rootDir, "app", "globals.css"), "utf8");
  assert.match(
    globalsCss,
    /@media\s*\(pointer:\s*coarse\),\s*\(hover:\s*none\),\s*\(max-width:\s*767px\)\s*\{[\s\S]*font-size:\s*max\(1rem,\s*1em\);/,
    "app/globals.css must enforce >= 1rem font-size for mobile/touch text inputs, textareas, and selects",
  );
  assert.match(
    globalsCss,
    /input:not\(\[type="checkbox"\][^)]*\),\s*textarea,\s*select/,
    "app/globals.css anti-zoom rule must cover text inputs, textareas, and selects while excluding checkboxes/radios/ranges",
  );
  assert.match(
    globalsCss,
    /\.search-lang-control\s*\{\s*flex-wrap:\s*wrap;\s*max-width:\s*100%;\s*\}/,
    "app/globals.css must allow .search-lang-control to wrap without horizontal overflow on narrow mobile screens",
  );

  const paliFontsCss = fs.readFileSync(path.join(rootDir, "app", "pali-fonts.css"), "utf8");
  assert.match(
    paliFontsCss,
    /html\[data-script="thai"\]\s+\.welcome-view\s+input,\s*html\[data-script="thai"\]\s+\.dict-header-bar\s+input,\s*html\[data-script="thai"\]\s+\.modal-header\s+input\s*\{\s*font-size:\s*max\(1rem,\s*calc\(1em \* 1\.32\)\);/,
    "app/pali-fonts.css must keep Thai script inputs at least 1rem",
  );

  const searchSrc = fs.readFileSync(path.join(rootDir, "components", "Search", "SearchModal.jsx"), "utf8");
  assert.match(
    searchSrc,
    /id="fts-search-input"[\s\S]*text-base sm:text-sm/,
    "SearchModal #fts-search-input must use text-base sm:text-sm",
  );
  assert.match(
    searchSrc,
    /focus\(\{\s*preventScroll:\s*true\s*\}\)/,
    "SearchModal must call focus({ preventScroll: true })",
  );

  const aniSrc = fs.readFileSync(path.join(rootDir, "components", "AiChat", "AiChatView.jsx"), "utf8");
  assert.match(
    aniSrc,
    /<textarea[\s\S]*text-base sm:text-sm/,
    "AiChatView Ani textarea must use text-base sm:text-sm",
  );
  assert.match(
    aniSrc,
    /focus\(\{\s*preventScroll:\s*true\s*\}\)/,
    "AiChatView must call focus({ preventScroll: true })",
  );

  const dictSrc = fs.readFileSync(path.join(rootDir, "components", "DictionaryModal.jsx"), "utf8");
  assert.match(
    dictSrc,
    /Dictionary - multi words[\s\S]*text-base sm:text-sm/,
    "DictionaryModal search input must use text-base sm:text-sm",
  );

  const welcomeSrc = fs.readFileSync(path.join(rootDir, "components", "Reader", "WelcomeView.jsx"), "utf8");
  assert.match(
    welcomeSrc,
    /Full-text search[\s\S]*text-base sm:text-sm[\s\S]*Dictionary - multi words[\s\S]*text-base sm:text-sm/,
    "WelcomeView search and dictionary inputs must use text-base sm:text-sm",
  );

  const layoutSrc = fs.readFileSync(path.join(rootDir, "app", "layout.js"), "utf8");
  assert.ok(!layoutSrc.includes("userScalable: false"), "app/layout.js must keep pinch-zoom enabled");
  assert.ok(!layoutSrc.includes("maximumScale: 1"), "app/layout.js must not re-add maximumScale: 1");
});

