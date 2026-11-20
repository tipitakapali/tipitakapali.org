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
  assert.doesNotMatch(html, /aria-describedby="fts-db-help"/);
  assert.match(html, /enterKeyHint="search"|enterkeyhint="search"/i);

  // <select id="fts-db-select"> must NOT be inside the <form>, and MUST appear ABOVE the collapsible Filters & Sort section
  const formEndIdx = html.indexOf("</form>");
  const langBarIdx = html.indexOf('class="search-lang-bar"');
  const selectIdx = html.indexOf('id="fts-db-select"');
  const detailsIdx = html.indexOf('class="search-filters-disclosure"');
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
    detailsIdx > selectIdx && groupIdx > detailsIdx,
    "Collapsible filters & sort <details> must appear strictly below the Language selector and wrap Group:",
  );

  // Collapsible <details> starts collapsed (no open attribute) and wraps Group, Piṭaka, Distance, Sort
  const detailsOpenTag = html.match(/<details\b[^>]*class="search-filters-disclosure"[^>]*>/)?.[0] || "";
  assert.ok(detailsOpenTag, "Filters disclosure <details> must be rendered");
  assert.doesNotMatch(detailsOpenTag, /\bopen\b/, "Filters disclosure must start collapsed by default");
  assert.match(html, /<summary class="search-filters-summary">[\s\S]*?Filters &amp; Sort[\s\S]*?<\/summary>/);
  assert.match(html, />Piṭaka:<[\s\S]*>Distance:<[\s\S]*>Sort:</);

  // Visible label present; persistent instruction text removed for more result space
  assert.match(
    html,
    /<label[^>]*for="fts-db-select"[^>]*>[\s\S]*Language to search:/,
  );
  assert.doesNotMatch(html, /fts-db-help/);
  assert.doesNotMatch(html, /Searching Tipiṭaka Pāḷi CST text/);
  assert.doesNotMatch(html, /Choose a translation database to search in the target language/);

  // Source also includes contextual empty-state tip when zero results are found
  const searchSrc = fs.readFileSync(
    path.join(rootDir, "components/Search/SearchModal.jsx"),
    "utf8",
  );
  assert.match(searchSrc, /Tip: You are searching/);
  assert.match(searchSrc, /switch "Language to search" above/);

  // CSS styles .search-lang-bar, .search-filters-disclosure, and hides duplicate native webkit cancel icon
  const cssSrc = fs.readFileSync(path.join(rootDir, "app/globals.css"), "utf8");
  assert.match(cssSrc, /\.search-lang-bar\s*\{/);
  assert.match(cssSrc, /\.search-filters-disclosure\s*\{/);
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

test("Offline performance optimizations: transliterate caching, single-pass data-link-ref injection, binary search helpers, and isolated preview LRU cache", async () => {
  // 1. Transliteration Roman fast-path + scriptStrCache equivalence + tag preservation
  const transMod = compileModule("services/transliterate.js", {});
  assert.equal(transMod.convertPaliScript("Evaṃ me sutaṃ.", "roman"), "Evaṃ me sutaṃ.");
  assert.equal(
    transMod.transliterateHtml('<p class="bodytext" data-para="1">   </p>', "thai"),
    '<p class="bodytext" data-para="1">   </p>',
  );
  const romanSample =
    '<p class="bodytext" data-para="1"><span class="pb" data-ed="M" data-page="1.0001"></span>Evaṃ me sutaṃ. Ekaṃ samayaṃ bhagavā.</p>';
  const thai1 = transMod.transliterateHtml(romanSample, "thai");
  const thai2 = transMod.transliterateHtml(romanSample, "thai");
  assert.equal(thai1, thai2);
  assert.match(thai1, /data-ed="M" data-page="1\.0001"/);
  assert.notEqual(thai1, romanSample);

  const myan1 = transMod.transliterateHtml(romanSample, "myanmar");
  const myan2 = transMod.transliterateHtml(romanSample, "myanmar");
  assert.equal(myan1, myan2);
  assert.notEqual(myan1, romanSample);

  // 2. ReaderView single-pass translation + data-link-ref injection, legacy fallback, and binary-search helpers
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
    "../../services/transliterate": transMod,
    "../../services/scroll": compileModule("services/scroll.js", {}),
    "../../services/api": {
      fetchChapterTranslations: async () => ({}),
      fetchChapterBundle: async () => null,
      isLocalDynamicHost: () => false,
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });

  const sampleChapterLinks = {
    0: {
      all: [
        {
          word: "bhagavā",
          target_book: "vin01a.att",
          target_chapter: 2,
          target_para_index: 5,
          target_para_num: "12",
          target_line_id: 1,
          label: "Bhagavā",
        },
      ],
      by_line: {},
    },
  };
  const injectedHtml = readerMod.injectTranslationsIntoHtml(
    '<p class="bodytext" data-pindex="0" data-para="1">Evaṃ me sutaṃ.</p>',
    { en: { 0: "Thus have I heard." } },
    [
      { id: "pali", type: "pali" },
      { id: "en", lang: "en", type: "trans" },
    ],
    true,
    "stack",
    {},
    null,
    false,
    null,
    "classic",
    {
      showBookLinks: true,
      chapterLinks: sampleChapterLinks,
      paliScript: "roman",
      bookCode: "s0101m.mul",
      chapterIndex: 0,
    },
  );
  assert.match(injectedHtml, /data-link-ref="s0101m\.mul\|0\|0\|_all\|0"/);
  assert.doesNotMatch(injectedHtml, /\sdata-link="/);
  assert.match(injectedHtml, /Thus have I heard\./);

  const refMatch = injectedHtml.match(/data-link-ref="([^"]+)"/);
  assert.ok(refMatch);
  const refChip = {
    getAttribute: (name) => (name === "data-link-ref" ? refMatch[1] : null),
  };
  const resolvedRef = readerMod.resolveChipLinkElement(refChip);
  assert.equal(resolvedRef.word, "bhagavā");
  assert.equal(resolvedRef.target_book, "vin01a.att");
  assert.equal(readerMod.resolveChipLinkElement(refChip), resolvedRef);

  const legacyChip = {
    getAttribute: (name) =>
      name === "data-link"
        ? JSON.stringify({ word: "evaṃ", target_book: "s0101a.att" })
        : null,
  };
  assert.equal(readerMod.resolveChipLinkElement(legacyChip).word, "evaṃ");

  // Binary search paragraph locator (>16 items + hidden 0x0 item handling)
  const paraList = Array.from({ length: 24 }, (_, idx) => ({
    id: idx,
    getBoundingClientRect: () =>
      idx === 12
        ? { top: 0, bottom: 0, width: 0, height: 0 }
        : { top: idx * 100, bottom: idx * 100 + 80, width: 320, height: 80 },
  }));
  assert.equal(readerMod.findFirstElementWithBottomAtOrBelow(paraList, 1320).id, 13);
  assert.equal(readerMod.findFirstElementWithBottomAtOrBelow(paraList, 0).id, 0);
  assert.equal(readerMod.findFirstElementWithBottomAtOrBelow(paraList, 5000), null);

  // Binary search active edition page numbers + firstSeen fallback when cursor is above first pb
  const mockPbs = [
    { ed: "M", page: "1.0001", top: 200 },
    { ed: "P", page: "1.0001", top: 220 },
    { ed: "M", page: "1.0002", top: 600 },
    { ed: "V", page: "1.0001", top: 900 },
    { ed: "M", page: "1.0003", top: 1200 },
  ].map((item) => {
    const host = { getBoundingClientRect: () => ({ top: item.top, bottom: item.top + 30 }) };
    return {
      parentElement: host,
      getAttribute: (k) => (k === "data-ed" ? item.ed : k === "data-page" ? item.page : null),
    };
  });
  assert.deepEqual(readerMod.findActiveEditionPagesFromElements(mockPbs, 750), {
    M: "1.0002",
    P: "1.0001",
    V: "1.0001",
  });
  assert.deepEqual(readerMod.findActiveEditionPagesFromElements(mockPbs, 100), {
    M: "1.0001",
    P: "1.0001",
    V: "1.0001",
  });

  // 3. services/api.js preview LRU isolation (150 previews do not evict chapter cache)
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  globalThis.window = { location: { hostname: "127.0.0.1", port: "8899", protocol: "http:" } };
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (String(url).includes("/links/preview")) {
      return {
        ok: true,
        json: async () => ({ book_code: "s0101a.att", lines: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({ book_code: "s0101m.mul", chapter_index: 0, paragraphs: { 0: { all: [] } } }),
    };
  };
  try {
    const apiMod = compileModule("services/api.js", {
      "./transliterate": transMod,
      "./dpdFeedback": compileModule("services/dpdFeedback.js", {}),
    });
    assert.equal(apiMod.isLocalDynamicHost(), true);
    await apiMod.fetchChapterLinks("s0101m.mul", 0);
    assert.ok(apiMod.getCachedChapterLinks("s0101m.mul", 0));

    for (let i = 0; i < 150; i++) {
      await apiMod.fetchLinkedPreview({
        book: "s0101a.att",
        chapter: 0,
        paraIndex: i,
        word: `w${i}`,
        langs: ["en"],
      });
    }
    assert.equal(
      apiMod.getCachedLinkedPreview({
        book: "s0101a.att",
        chapter: 0,
        paraIndex: 0,
        word: "w0",
        langs: ["en"],
      }),
      null,
      "Oldest preview beyond 120-entry LRU limit should be evicted",
    );
    assert.ok(
      apiMod.getCachedLinkedPreview({
        book: "s0101a.att",
        chapter: 0,
        paraIndex: 149,
        word: "w149",
        langs: ["en"],
      }),
      "Most recent preview should remain cached",
    );
    assert.ok(
      apiMod.getCachedChapterLinks("s0101m.mul", 0),
      "150 preview fetches must not evict chapter cache entries",
    );
    assert.equal(fetchCount, 151);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = prevFetch;
  }
});

test("Ani (AI Nissaya) toggles header visibility on scroll while keeping chat input footer permanently visible", () => {
  const scrollMod = compileModule("services/scroll.js", {});
  assert.equal(typeof scrollMod.computeNextHeaderVisibility, "function");

  // Scroll down >36px past top (>64px) hides header; scroll up >=24px reveals it
  const hiddenStep = scrollMod.computeNextHeaderVisibility({
    top: 120,
    isHeaderVisible: true,
    upPeakY: 80,
    downPeakY: 120,
    viewportHeight: 700,
    scrollHeight: 2000,
  });
  assert.equal(hiddenStep.nextVisible, false);

  const revealedStep = scrollMod.computeNextHeaderVisibility({
    top: 90,
    isHeaderVisible: false,
    upPeakY: 120,
    downPeakY: 120,
    viewportHeight: 700,
    scrollHeight: 2000,
  });
  assert.equal(revealedStep.nextVisible, true);

  const nearTopStep = scrollMod.computeNextHeaderVisibility({
    top: 12,
    isHeaderVisible: false,
    upPeakY: 200,
    downPeakY: 200,
    viewportHeight: 700,
    scrollHeight: 2000,
  });
  assert.equal(nearTopStep.nextVisible, true);

  const noop = () => {};
  const noopComp = () => null;
  const renderAniWithHeader = (isHeaderVisible) => {
    const mod = compileModule("components/AiChat/AiChatView.jsx", {
      react: Object.assign({}, React, { __esModule: true, default: React }),
      "lucide-react": iconProxy,
      "./AiMarkdown": { __esModule: true, default: noopComp },
      "./AiSettingsModal": {
        __esModule: true,
        default: noopComp,
        getStoredAiSettings: () => ({ answerModel: "gemini-2.5-flash" }),
        DEFAULT_AI_SETTINGS: { answerModel: "gemini-2.5-flash" },
      },
      "./CitationQuickviewModal": { __esModule: true, default: noopComp },
      "../../services/aiClientAgent": { runClientAiAgent: async () => {} },
      "../../context/TabContext": {
        useTabs: () => ({
          openBook: noop,
          isHeaderVisible,
          setIsHeaderVisible: noop,
          isSidebarOpen: false,
        }),
      },
      "../../context/ThemeSettingsContext": {
        useThemeSettings: () => ({ settings: { paliScript: "roman" } }),
      },
      "../../services/transliterate": compileModule("services/transliterate.js", {}),
      "../../services/api": { getApiBase: () => "" },
      "../../services/scroll": scrollMod,
    });
    return renderToStaticMarkup(React.createElement(mod.default, {}));
  };

  const visibleHtml = renderAniWithHeader(true);
  assert.match(visibleHtml, /<header[^>]*class="[^"]*ai-chat-header[^"]*"/);
  assert.doesNotMatch(visibleHtml, /<header[^>]*hidden-scroll/);

  const hiddenHtml = renderAniWithHeader(false);
  assert.match(hiddenHtml, /<header[^>]*class="[^"]*ai-chat-header[^"]*hidden-scroll[^"]*"/);
  assert.match(hiddenHtml, /<div[^>]*class="[^"]*ai-chat-messages[^"]*min-h-0[^"]*"/);
  assert.match(hiddenHtml, /<footer[^>]*class="[^"]*ai-chat-footer[^"]*"/);
  assert.doesNotMatch(hiddenHtml, /<footer[^>]*hidden-(?:footer|scroll)/);
  assert.match(hiddenHtml, /<textarea[^>]*Ask Ani about Pāḷi grammar/);

  const aniSrc = fs.readFileSync(
    path.join(rootDir, "components", "AiChat", "AiChatView.jsx"),
    "utf8",
  );
  assert.match(aniSrc, /handleMessagesScroll[\s\S]*computeNextHeaderVisibility[\s\S]*setIsHeaderVisible\(nextVisible\)/);

  const cssSrc = fs.readFileSync(path.join(rootDir, "app", "globals.css"), "utf8");
  assert.match(cssSrc, /\.ai-chat-header\.hidden-scroll\s*\{/);
  assert.match(cssSrc, /\.ai-chat-footer\s*\{[\s\S]*?opacity:\s*1\s*!important;/);
});

test("iOS/offline reader smoothness: chunked large chapters, lazy +N more link chips, non-blocking links, no paragraph content-visibility, and rAF-cached WebView scroll bridge", () => {
  const transMod = compileModule("services/transliterate.js", {});
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
    "../../services/transliterate": transMod,
    "../../services/scroll": compileModule("services/scroll.js", {}),
    "../../services/api": {
      fetchChapterTranslations: async () => ({}),
      fetchChapterBundle: async () => null,
      isLocalDynamicHost: () => false,
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });

  // 1. Small chapters stay in a single chunk; empty inputs return []
  assert.deepEqual(readerMod.splitChapterHtmlIntoChunks(""), []);
  assert.deepEqual(readerMod.splitChapterHtmlIntoChunks(null), []);
  const smallHtml = Array.from(
    { length: 20 },
    (_, i) => `<p class="bodytext" data-pindex="${i}" data-para="${i + 1}">Para ${i + 1}</p>`,
  ).join("\n");
  const smallChunks = readerMod.splitChapterHtmlIntoChunks(smallHtml);
  assert.equal(smallChunks.length, 1);
  assert.equal(smallChunks[0].rawHtml, smallHtml);

  // 2. Large chapters (>50 paragraphs) split losslessly with carry-forward metadata
  const bigParts = ['<div id="chap-1" class="chapter-anchor" data-chapter="1"></div>'];
  for (let i = 0; i < 125; i++) {
    if (i === 0) {
      bigParts.push(`<p class="chapter" data-pindex="${i}">Verañjakaṇḍavaṇṇanā</p>`);
    } else if (i === 62) {
      bigParts.push(`<p class="subhead" data-pindex="${i}">Paṭhamapārājikaṃ</p>`);
    } else if (i === 95) {
      bigParts.push(
        `<p class="bodytext" data-pindex="${i}" data-para="100-105" data-para-first="100" data-para-last="105"><span class="pb" data-ed="M" data-page="1.0042"></span>Evaṃ me sutaṃ specialterm.</p>`,
      );
    } else {
      const pb =
        i % 25 === 0
          ? `<span class="pb" data-ed="M" data-page="1.${String(i).padStart(4, "0")}"></span>`
          : "";
      const paraAttr = i % 3 === 0 ? ` data-para="${i}"` : "";
      bigParts.push(`<p class="bodytext" data-pindex="${i}"${paraAttr}>${pb}Paragraph text ${i}.</p>`);
    }
  }
  const bigHtml = bigParts.join("\n");
  const bigChunks = readerMod.splitChapterHtmlIntoChunks(bigHtml, 30);
  assert.equal(bigChunks.length, 5);
  assert.equal(
    bigChunks.map((c) => c.rawHtml).join(""),
    bigHtml,
    "Chunk splitting must be 100% lossless byte-for-byte",
  );
  assert.equal(bigChunks[0].lastHeading, "Verañjakaṇḍavaṇṇanā");
  assert.equal(bigChunks[2].lastHeading, "Paṭhamapārājikaṃ");
  assert.ok(bigChunks[1].prevParaNum, "Subsequent chunks must carry forward previous data-para");
  assert.equal(bigChunks[3].lastPbByEd.M, "1.0100");
  assert.ok(bigChunks[3].edPages.some((p) => p.ed === "M" && p.page === "1.0042"));

  // 3. findTargetChunkIndex resolves paraIndex, exact/ranged paraNum, edition page, and search query
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, { paraIndex: 95 }), 3);
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, { paraNum: "103" }), 3);
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, { page: "1.42", pageSystem: "M" }), 3);
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, { page: "42", pageSystem: "M" }), 3);
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, { searchQuery: "specialterm" }), 3);
  assert.equal(readerMod.findTargetChunkIndex(bigChunks, {}), 0);

  // 4. detectLiveSectionTitleFromElements reads carry-forward heading from virtualized chunk placeholders
  const carriedHeading = readerMod.detectLiveSectionTitleFromElements(
    [
      {
        getAttribute: (k) => (k === "data-chunk-last-heading" ? "Paṭhamapārājikaṃ" : null),
        getBoundingClientRect: () => ({ top: -400, bottom: -10, width: 320, height: 390 }),
      },
    ],
    120,
  );
  assert.equal(carriedHeading, "Paṭhamapārājikaṃ");

  // 5. estimateChunkHeight scales cleanly with active languages and sentence mode
  const paliEst = readerMod.estimateChunkHeight(bigChunks[0], {
    isPaliEnabled: true,
    activeLangCount: 0,
    effectiveSentenceMode: false,
    isMobile: true,
  });
  const sentEst = readerMod.estimateChunkHeight(bigChunks[0], {
    isPaliEnabled: true,
    activeLangCount: 1,
    effectiveSentenceMode: true,
    isMobile: true,
  });
  assert.ok(paliEst >= 240);
  assert.ok(sentEst > paliEst);

  // 6. Lazy +N more link chip hydration: initial HTML omits hidden chips beyond 3, hydrates on demand
  const manyLinks = Array.from({ length: 8 }, (_, idx) => ({
    word: `dhamma${idx}`,
    target_book: "vin01t1.tik",
    target_book_title: "Sāratthadīpanī-Ṭīkā-1",
    target_category: "ṭīkā",
    target_chapter: 1,
    target_para_index: 10 + idx,
    target_para_num: String(idx + 1),
    is_source: false,
  }));
  const injectedWithMany = readerMod.injectTranslationsIntoHtml(
    '<p class="bodytext" data-pindex="7" data-para="1">Evaṃ me sutaṃ.</p>',
    { en: { 7: "Thus have I heard." } },
    [
      { id: "pali", type: "pali" },
      { id: "en", lang: "en", type: "trans" },
    ],
    true,
    "stack",
    {},
    null,
    false,
    null,
    "classic",
    {
      showBookLinks: true,
      chapterLinks: { 7: { all: manyLinks, by_line: {} } },
      paliScript: "roman",
      bookCode: "vin01a.att",
      chapterIndex: 1,
    },
  );
  const initialChipCount = (injectedWithMany.match(/class="linked-def-chip /g) || []).length;
  assert.equal(initialChipCount, 3, "Only first 3 link chips should render initially");
  const moreRefMatch = injectedWithMany.match(/data-links-more-ref="([^"]+)"/);
  assert.ok(moreRefMatch, "Empty more-group must carry data-links-more-ref for lazy hydration");
  assert.match(injectedWithMany, /\+5 more/);

  const hydratedMoreHtml = readerMod.renderMoreLinkChipsFromRef(moreRefMatch[1]);
  assert.equal((hydratedMoreHtml.match(/class="linked-def-chip /g) || []).length, 5);
  assert.match(hydratedMoreHtml, /dhamma3/);
  assert.match(hydratedMoreHtml, /dhamma7/);
  const hydratedRefMatch = hydratedMoreHtml.match(/data-link-ref="([^"]+)"/);
  assert.ok(hydratedRefMatch);
  const resolvedHydrated = readerMod.resolveChipLinkElement({
    getAttribute: (k) => (k === "data-link-ref" ? hydratedRefMatch[1] : null),
  });
  assert.equal(resolvedHydrated?.word, "dhamma3");
  assert.equal(readerMod.renderMoreLinkChipsFromRef("invalid|ref"), "");

  // 7. ChapterBlock windowing when IntersectionObserver is present mounts only initial chunks
  const prevIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class FakeIO {
    observe() {}
    disconnect() {}
  };
  try {
    const renderedBig = renderToStaticMarkup(
      React.createElement(readerMod.ChapterBlock, {
        chapter: { chapter_index: 1, title: "verañjakaṇḍavaṇṇanā" },
        bookCode: "vin01a.att",
        html: bigHtml,
        isLoading: false,
        onVisible: () => {},
        isCurrentOrTarget: true,
        targetParaIndex: 95,
      }),
    );
    // Target chunk is 3 -> forced window is [2, 3, 4], so chunks 0 & 1 are virtualized placeholders
    assert.match(renderedBig, /data-chunk-index="0"[^>]*data-chunk-virtualized="1"/);
    assert.match(renderedBig, /data-chunk-index="1"[^>]*data-chunk-virtualized="1"/);
    assert.match(renderedBig, /specialterm/, "Target chunk 3 must be mounted immediately on frame 1");
    assert.match(renderedBig, /class="pb hidden" data-ed="M"/, "Virtualized chunk must carry hidden pb markers");
  } finally {
    if (prevIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = prevIO;
  }

  // 8. Regression guards: no paragraph content-visibility: auto in globals.css,
  // non-blocking links in ReaderView, and rAF/cached scroll metrics in WebView bridge
  const cssSrc = fs.readFileSync(path.join(rootDir, "app", "globals.css"), "utf8");
  assert.doesNotMatch(
    cssSrc,
    /\.reader-para-row:nth-child[\s\S]*content-visibility:\s*auto/,
    "globals.css must not apply content-visibility: auto to reader paragraphs (causes iOS WKWebView blank fast-scroll frames & hangs)",
  );
  assert.doesNotMatch(
    cssSrc,
    /@supports\s+not\s*\(\s*content-visibility:\s*auto\s*\)[\s\S]*\.chapter-content-block/,
  );

  const readerSrc = fs.readFileSync(
    path.join(rootDir, "components", "Reader", "ReaderView.jsx"),
    "utf8",
  );
  assert.match(readerSrc, /fetchChapterBundle\([\s\S]*?links:\s*false/);

  const webviewSrc = fs.readFileSync(
    path.join(
      rootDir,
      "tipitakapali_org_app",
      "lib",
      "features",
      "webview",
      "tipitaka_webview_screen.dart",
    ),
    "utf8",
  );
  assert.match(webviewSrc, /getCachedMaxScroll/);
  assert.match(webviewSrc, /getCachedBarsToggleBlocked/);
  assert.match(webviewSrc, /scrollRafPending/);
});

test("Review fixes: above-viewport scroll anchoring, anchorEnd preceding chapter, nearest-para/translation chunk lookup, single-trip loadChapter bundle, and observer/scroll-thrash guards", () => {
  const transMod = compileModule("services/transliterate.js", {});
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
      getDefaultTranslationColorsForTheme: () => ({ text: "#000", border: "#000", bg: "" }),
    },
    "../../context/DictionaryContext": { useDictionary: () => ({}) },
    "../../services/transliterate": transMod,
    "../../services/scroll": compileModule("services/scroll.js", {}),
    "../../services/api": {
      fetchChapterTranslations: async () => ({}),
      fetchChapterBundle: async () => null,
      isLocalDynamicHost: () => false,
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });

  // 1. computeAboveViewportScrollDelta prevents iOS WKWebView / overflow-anchor:none scroll jumps
  assert.equal(
    readerMod.computeAboveViewportScrollDelta({
      rectTop: -4000,
      rectBottom: -500,
      prevHeight: 2000,
      nextHeight: 3500,
      viewportTop: 0,
    }),
    1500,
    "Growing chunk strictly above viewport must return +delta",
  );
  assert.equal(
    readerMod.computeAboveViewportScrollDelta({
      rectTop: -4000,
      rectBottom: -2000,
      prevHeight: 3500,
      nextHeight: 2000,
      viewportTop: 0,
    }),
    -1500,
    "Shrinking chunk strictly above viewport must return -delta",
  );
  assert.equal(
    readerMod.computeAboveViewportScrollDelta({
      rectTop: -200,
      rectBottom: 900,
      prevHeight: 600,
      nextHeight: 1100,
      viewportTop: 0,
    }),
    0,
    "Partially visible chunk must not shift scrollTop",
  );
  assert.equal(
    readerMod.computeAboveViewportScrollDelta({
      rectTop: 400,
      rectBottom: 1900,
      prevHeight: 1000,
      nextHeight: 1500,
      viewportTop: 0,
    }),
    0,
    "Below-viewport chunk must not shift scrollTop",
  );

  // 2. findTargetChunkIndex supports nearest-para fallback, padded vol.page, and translation search
  const bigParts = [];
  for (let i = 0; i < 125; i++) {
    const paraAttr = i % 5 === 0 ? ` data-para="${i * 2}"` : "";
    const pb = i === 95 ? `<span class="pb" data-ed="M" data-page="1.0042"></span>` : "";
    bigParts.push(`<p class="bodytext" data-pindex="${i}"${paraAttr}>${pb}Text ${i}</p>`);
  }
  const bigHtml = bigParts.join("\n");
  const chunks = readerMod.splitChapterHtmlIntoChunks(bigHtml, 30);
  // para 191 doesn't exist exactly; nearest <= 191 is para 190 at pindex 95 (chunk 3)
  assert.equal(readerMod.findTargetChunkIndex(chunks, { paraNum: "191" }), 3);
  assert.equal(readerMod.findTargetChunkIndex(chunks, { page: "01.42", pageSystem: "M" }), 3);
  assert.equal(
    readerMod.findTargetChunkIndex(chunks, {
      searchQuery: "enlightenment",
      translations: { en: { 95: "The path to enlightenment." } },
    }),
    3,
  );

  // 3. ChapterBlock anchorEnd mounts trailing chunks for preceding chapter & reserves tall loading height
  const prevIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class FakeIO {
    observe() {}
    disconnect() {}
  };
  try {
    const renderedPrevChap = renderToStaticMarkup(
      React.createElement(readerMod.ChapterBlock, {
        chapter: { chapter_index: 0, title: "ganthārambhakathā" },
        bookCode: "vin01a.att",
        html: bigHtml,
        isLoading: false,
        onVisible: () => {},
        isCurrentOrTarget: true,
        anchorEnd: true,
      }),
    );
    assert.match(renderedPrevChap, /data-chunk-index="0"[^>]*data-chunk-virtualized="1"/);
    assert.match(renderedPrevChap, /data-chunk-index="1"[^>]*data-chunk-virtualized="1"/);
    assert.match(renderedPrevChap, /Text 124/, "Preceding chapter with anchorEnd must mount final chunks");

    const renderedLoading = renderToStaticMarkup(
      React.createElement(readerMod.ChapterBlock, {
        chapter: { chapter_index: 0, title: "ganthārambhakathā" },
        bookCode: "vin01a.att",
        html: bigHtml,
        isLoading: false,
        onVisible: () => {},
        isCurrentOrTarget: true,
        activeLangs: ["en"],
        orderedLayers: [
          { id: "pali", type: "pali" },
          { id: "en", type: "trans", lang: "en" },
        ],
      }),
    );
    assert.match(renderedLoading, /data-trans-loading="1"/);
    assert.match(renderedLoading, /justify-start/, "Tall loading block must keep spinner visible at top");
    const minHMatch = renderedLoading.match(/min-height:(\d+)px/);
    assert.ok(minHMatch && Number(minHMatch[1]) > 2000, "Tall chapter loading box must reserve realistic height to prevent downstream chapter fetch cascade");
  } finally {
    if (prevIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = prevIO;
  }

  // 4. Static guards for observer attachment, unmount leak, scroll thrashing, and single-roundtrip TabContext bundle
  const readerSrc = fs.readFileSync(path.join(rootDir, "components", "Reader", "ReaderView.jsx"), "utf8");
  assert.match(readerSrc, /\(!isCurrentOrTarget\s*&&\s*!isWithinDomWindow\)/);
  assert.doesNotMatch(readerSrc, /forcedMountedChunksRef\.current\.has\(idx\)\)\s*continue/);
  assert.doesNotMatch(readerSrc, /topDelta\s*<\s*120/);
  assert.match(readerSrc, /\[activeBookCodeForPane,\s*loadChapter,\s*bufferAdjacentChapters\]/);

  const tabCtxSrc = fs.readFileSync(path.join(rootDir, "context", "TabContext.jsx"), "utf8");
  assert.match(tabCtxSrc, /fetchChapterBundle\(cleanCode,\s*chapterIdx,\s*\{[\s\S]*?includeHtml:\s*true/);
  assert.match(tabCtxSrc, /centerIdx\s*\+\s*2/);

  const dartApiSrc = fs.readFileSync(
    path.join(rootDir, "tipitakapali_org_app", "lib", "core", "server", "tipitaka_web_api.dart"),
    "utf8",
  );
  assert.match(dartApiSrc, /BoldDefinitionIndexService\.isInFlight\(dbDirectoryPath\)/);
});

test("Round 2 smoothness fixes: batched above-viewport scroll compensation, zero forced IO offsetHeight, wider IO margins, openBook adjacent bundle prefetch, and non-blocking Dart warmUpIndexes", () => {
  const transMod = compileModule("services/transliterate.js", {});
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
    "../../services/transliterate": transMod,
    "../../services/scroll": compileModule("services/scroll.js", {}),
    "../../services/api": {
      fetchChapterTranslations: async () => ({}),
      fetchChapterBundle: async () => null,
      isLocalDynamicHost: () => false,
      fetchPaliSentences: async () => ({}),
      fetchChapterLinks: async () => ({}),
      getCachedChapterTranslations: () => null,
      getCachedPaliSentences: () => null,
      getCachedChapterLinks: () => null,
      prefetchLinkedPreview: () => {},
      prefetchLinkedPreviewsBatch: () => {},
    },
  });

  // 1. Batched above-viewport scroll compensation handles multi-chunk shifts without thrashing
  assert.equal(readerMod.computeBatchedAboveViewportScrollDelta([], 0), 0);
  assert.equal(readerMod.computeBatchedAboveViewportScrollDelta(null, 0), 0);

  // Chunk 0 originally [-3000, -2000] grows +2000 -> [-3000, -1000]
  // Chunk 1 originally [-1100, -100] grows +500; pushed down +2000 by chunk 0 -> [+900, +2400]
  // Chunk 2 originally [-100, +1400] (straddling viewport) grows +500; pushed down +2500 -> [+2400, +4400]
  // Only chunks 0 and 1 were strictly above viewport -> exact total delta +2500.
  assert.equal(
    readerMod.computeBatchedAboveViewportScrollDelta(
      [
        { rectTop: -3000, rectBottom: -1000, prevHeight: 1000, nextHeight: 3000 },
        { rectTop: 900, rectBottom: 2400, prevHeight: 1000, nextHeight: 1500 },
        { rectTop: 2400, rectBottom: 4400, prevHeight: 1500, nextHeight: 2000 },
      ],
      0,
    ),
    2500,
    "Batched scroll compensation must adjust subsequent chunk rects for cumulative shifts above them",
  );

  // Two shrinking chunks strictly above viewport in one commit -> -(1000 + 400) = -1400
  assert.equal(
    readerMod.computeBatchedAboveViewportScrollDelta(
      [
        { rectTop: -3000, rectBottom: -2000, prevHeight: 2000, nextHeight: 1000 },
        { rectTop: -2000, rectBottom: -1500, prevHeight: 900, nextHeight: 500 },
        { rectTop: -1500, rectBottom: -400, prevHeight: 1100, nextHeight: 1100 },
      ],
      0,
    ),
    -1400,
  );

  // Chunks strictly below viewport must produce zero scroll shift
  assert.equal(
    readerMod.computeBatchedAboveViewportScrollDelta(
      [
        { rectTop: 800, rectBottom: 2300, prevHeight: 1000, nextHeight: 1500 },
        { rectTop: 2300, rectBottom: 3900, prevHeight: 1000, nextHeight: 1600 },
      ],
      0,
    ),
    0,
  );

  // Straddling chunk shrinking dramatically must NOT misclassify a below-viewport chunk as above viewport
  assert.equal(
    readerMod.computeBatchedAboveViewportScrollDelta(
      [
        // Chunk 0 straddled [-500, +200] (prevHeight=700) and shrank to 300 -> [-500, -200]
        { rectTop: -500, rectBottom: -200, prevHeight: 700, nextHeight: 300 },
        // Chunk 1 was below viewport [+200, +350] (prevHeight=150), pulled up by -400 to [-200, 0] while growing to 200
        { rectTop: -200, rectBottom: 0, prevHeight: 150, nextHeight: 200 },
      ],
      0,
    ),
    0,
  );

  // 2. openBook adjacent chapter bundle prefetch (buffer: 1) prevents chapter 1 'Loading happiness...' flash
  const tabCtxMod = compileModule("context/TabContext.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "../services/api": {
      fetchBook: async () => ({}),
      fetchChapter: async () => ({ html: "" }),
      fetchChapterBundle: async () => null,
      isLocalDynamicHost: () => true,
      fetchMat: async () => null,
      fetchMatJump: async () => null,
      lookupBookInfo: async () => null,
      fetchBookTocOnly: async () => null,
    },
    "../services/transliterate": transMod,
    "./ThemeSettingsContext": {
      useThemeSettings: () => ({ updateSetting: () => {}, settings: {} }),
    },
  });

  const calls = [];
  const mockFetchBundle = (code, idx, opts) => {
    calls.push({ code, idx, opts });
    return Promise.resolve({});
  };

  // Opening normal book at ch 0 with buffer: 1 (chapters 0 & 1 preloaded), ch 0 already prefetched
  const launchedCh0 = tabCtxMod.prefetchOpenBookAdjacentBundles({
    bookCode: "s0101m.mul",
    targetChapIdx: 0,
    chaptersData: { 0: "<p>ch0</p>", 1: "<p>ch1</p>" },
    settingsObj: {
      translations: { pali: true, english: true },
      translationOrder: ["pali", "english"],
      translationGranularity: "sentence",
    },
    prefetchedChapters: new Set([0]),
    isLocalHost: () => true,
    fetchBundle: mockFetchBundle,
  });
  assert.deepEqual(launchedCh0, [1]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, "s0101m.mul");
  assert.equal(calls[0].idx, 1);
  assert.deepEqual(calls[0].opts, {
    includeHtml: false,
    langs: ["en"],
    sentences: true,
    paliSentences: true,
    links: false,
  });

  // Opening mid-book chapter 2 with chapters 1, 2, 3 preloaded (ch 2 already prefetched) -> prefetches 3 and 1
  calls.length = 0;
  const launchedCh2 = tabCtxMod.prefetchOpenBookAdjacentBundles({
    bookCode: "s0101m.mul",
    targetChapIdx: 2,
    chaptersData: { 1: "<p>1</p>", 2: "<p>2</p>", 3: "<p>3</p>" },
    settingsObj: {
      translations: { pali: true, english: true },
      translationOrder: ["pali", "english"],
      translationGranularity: "paragraph",
    },
    extraLangCode: "vi",
    prefetchedChapters: new Set([2]),
    isLocalHost: () => true,
    fetchBundle: mockFetchBundle,
  });
  assert.deepEqual(launchedCh2, [3, 1]);
  assert.deepEqual(calls[0].opts.langs, ["en", "vi"]);

  // Single-chapter book: chapter 1 absent from chaptersData -> must NOT prefetch chapter 1
  calls.length = 0;
  assert.deepEqual(
    tabCtxMod.prefetchOpenBookAdjacentBundles({
      bookCode: "s0501m.mul",
      targetChapIdx: 0,
      chaptersData: { 0: "<p>only</p>" },
      settingsObj: { translations: { pali: true, english: true } },
      prefetchedChapters: new Set([0]),
      isLocalHost: () => true,
      fetchBundle: mockFetchBundle,
    }),
    [],
  );

  // Non-local host or no active translations -> no bundle prefetch
  assert.deepEqual(
    tabCtxMod.prefetchOpenBookAdjacentBundles({
      bookCode: "s0101m.mul",
      targetChapIdx: 0,
      chaptersData: { 0: "<p>0</p>", 1: "<p>1</p>" },
      settingsObj: { translations: { pali: true, english: true } },
      isLocalHost: () => false,
      fetchBundle: mockFetchBundle,
    }),
    [],
  );
  assert.deepEqual(
    tabCtxMod.prefetchOpenBookAdjacentBundles({
      bookCode: "s0101m.mul",
      targetChapIdx: 0,
      chaptersData: { 0: "<p>0</p>", 1: "<p>1</p>" },
      settingsObj: { translations: { pali: true } },
      isLocalHost: () => true,
      fetchBundle: mockFetchBundle,
    }),
    [],
  );

  // extraLangCode must respect settings.translationOrder so cache keys match ReaderView activeLangs
  const orderedPrefs = tabCtxMod.resolveBundlePrefsFromSettings(
    {
      translations: { pali: true, english: true },
      translationOrder: ["pali", "vietnamese", "english"],
      translationGranularity: "sentence",
    },
    "vi",
  );
  assert.deepEqual(orderedPrefs, {
    langs: ["vi", "en"],
    sentences: true,
    paliSentences: true,
  });

  // 3. Structural guards for batched layout effect, ResizeObserver passive height tracking,
  // synchronous cache render resolution, IO boundingClientRect preference, wider margins, and Dart guards
  const readerSrc = fs.readFileSync(path.join(rootDir, "components", "Reader", "ReaderView.jsx"), "utf8");
  const chapterChunkMatch = readerSrc.match(/const ChapterChunk = memo\([\s\S]*?\n\}\);/);
  assert.ok(chapterChunkMatch, "ChapterChunk component must exist");
  assert.doesNotMatch(
    chapterChunkMatch[0],
    /useIsomorphicLayoutEffect|scrollBy|scrollTop\s*\+=|offsetHeight/,
    "ChapterChunk must not run per-chunk layout effects or scroll writes",
  );
  assert.match(readerSrc, /computeBatchedAboveViewportScrollDelta\(measurements,\s*vpTop\)/);
  assert.match(readerSrc, /Math\.round\(entry\.boundingClientRect\?\.height \|\| 0\) \|\| el\.offsetHeight \|\| 0/);
  assert.match(readerSrc, /new ResizeObserver\(/);
  assert.match(readerSrc, /const renderSyncTrans =/);
  assert.match(readerSrc, /rootMargin:\s*'3600px 0px'/);
  assert.match(readerSrc, /rootMargin:\s*'6500px 0px'/);
  assert.match(readerSrc, /rootMargin:\s*'4500px 0px'/);

  const tabCtxSrc = fs.readFileSync(path.join(rootDir, "context", "TabContext.jsx"), "utf8");
  assert.match(tabCtxSrc, /prefetchOpenBookAdjacentBundles\(\{[\s\S]*?chaptersData:\s*bookData\.chapters_data/);

  const dartLocalServerSrc = fs.readFileSync(
    path.join(rootDir, "tipitakapali_org_app", "lib", "core", "server", "tipitaka_local_server.dart"),
    "utf8",
  );
  assert.match(dartLocalServerSrc, /case 'warmUpIndexes':[\s\S]*?unawaited\([\s\S]*?workerApi\.warmUpIndexes\(\)/);
});

test("Review fixes: fetchChapterLinks skips caching warming_up/error responses and ChapterBlock renders cached translations without Loading happiness flash", async () => {
  const transMod = compileModule("services/transliterate.js", {});
  const dpdFeedbackMod = compileModule("services/dpdFeedback.js", {});
  const apiMod = compileModule("services/api.js", {
    "./transliterate": transMod,
    "./dpdFeedback": dpdFeedbackMod,
  });

  const prevFetch = globalThis.fetch;
  const prevWindow = globalThis.window;
  let linkCalls = 0;
  let bundleCalls = 0;
  try {
    globalThis.window = { location: { hostname: "127.0.0.1" } };
    globalThis.fetch = async (url) => {
      if (String(url).includes("/links")) {
        linkCalls++;
        if (linkCalls === 1) {
          return {
            ok: true,
            json: async () => ({
              book_code: "s0101m.mul",
              chapter_index: 0,
              paragraphs: {},
              warming_up: true,
            }),
          };
        }
        if (linkCalls === 2) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            book_code: "s0101m.mul",
            chapter_index: 0,
            paragraphs: { 0: { all: [{ word: "evaṃ", target_book: "s0101a.att" }] } },
          }),
        };
      }
      if (String(url).includes("/bundle")) {
        bundleCalls++;
        return {
          ok: true,
          json: async () => ({
            book_code: "s0101m.mul",
            chapter_index: 1,
            translations: { en: { 0: "At one time." } },
            sentences: { en: { 0: [{ line_id: 1, translation: "At one time." }] } },
            pali_sentences: { 0: [{ line: 1, text: "Tena samayena." }] },
            links: {},
            links_warming_up: true,
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    // 1. warming_up: true response must NOT be cached
    const warmUpRes = await apiMod.fetchChapterLinks("s0101m.mul", 0);
    assert.deepEqual(warmUpRes.paragraphs, {});
    assert.equal(apiMod.getCachedChapterLinks("s0101m.mul", 0), null);

    // 2. HTTP error fallback must NOT be cached
    const errRes = await apiMod.fetchChapterLinks("s0101m.mul", 0);
    assert.deepEqual(errRes.paragraphs, {});
    assert.equal(apiMod.getCachedChapterLinks("s0101m.mul", 0), null);

    // 3. Ready response IS cached and returned on subsequent calls
    const readyRes = await apiMod.fetchChapterLinks("s0101m.mul", 0);
    assert.equal(readyRes.paragraphs[0].all[0].word, "evaṃ");
    assert.equal(linkCalls, 3);
    assert.ok(apiMod.getCachedChapterLinks("s0101m.mul", 0));

    const cachedRes = await apiMod.fetchChapterLinks("s0101m.mul", 0);
    assert.equal(cachedRes.paragraphs[0].all[0].word, "evaṃ");
    assert.equal(linkCalls, 3);

    // 4. Bundle with links_warming_up: true caches translations & pali_sentences, NOT empty links
    await apiMod.fetchChapterBundle("s0101m.mul", 1, {
      includeHtml: false,
      langs: ["en"],
      sentences: true,
      paliSentences: true,
      links: true,
    });
    assert.equal(bundleCalls, 1);
    assert.equal(apiMod.getCachedChapterLinks("s0101m.mul", 1), null);
    assert.equal(
      apiMod.getCachedChapterTranslations("s0101m.mul", 1, ["en"], { sentences: true })?.translations?.en?.[0],
      "At one time.",
    );

    // 5. ChapterBlock renders cached chapter 1 translations synchronously without 'Loading happiness...'
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
        getDefaultTranslationColorsForTheme: () => ({ text: "#000", border: "#000", bg: "" }),
      },
      "../../context/DictionaryContext": { useDictionary: () => ({}) },
      "../../services/transliterate": transMod,
      "../../services/scroll": compileModule("services/scroll.js", {}),
      "../../services/api": apiMod,
    });

    const markup = renderToStaticMarkup(
      React.createElement(readerMod.ChapterBlock, {
        chapter: { chapter_index: 1, title: "Sāmaññaphala" },
        bookCode: "s0101m.mul",
        html: '<p class="bodytext" data-pindex="0" data-para="1">Tena samayena.</p>',
        isLoading: false,
        onVisible: () => {},
        isCurrentOrTarget: true,
        activeLangs: ["en"],
        orderedLayers: [
          { id: "pali", type: "pali" },
          { id: "english", type: "trans", lang: "en" },
        ],
        isPaliEnabled: true,
        sentenceMode: true,
        showBookLinks: false,
      }),
    );
    assert.ok(markup.includes("At one time."), "Prefetched translation must render immediately on Frame 1");
    assert.ok(!markup.includes("Loading happiness"), "Prefetched chapter must NOT flash Loading happiness...");
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});



