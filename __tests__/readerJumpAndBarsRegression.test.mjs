import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const React = require("react");

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
const noopComp = () => null;
const transMod = compileModule("services/transliterate.js", {});
const scrollMod = compileModule("services/scroll.js", {});

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
  "../../services/scroll": scrollMod,
  "../../services/api": {
    fetchChapterTranslations: async () => ({}),
    fetchChapterBundle: async () => null,
    isLocalDynamicHost: () => false,
    fetchPaliSentences: async () => ({}),
    fetchChapterLinks: async () => ({}),
    getCachedChapterTranslations: () => null,
    getCachedPaliSentences: () => null,
    getCachedChapterLinks: () => null,
    prefetchLinkedPreview: noop,
    prefetchLinkedPreviewsBatch: noop,
  },
});

function defineHiddenLinks(obj) {
  for (const key of ["parentNode", "parentElement", "nextSibling", "previousSibling"]) {
    Object.defineProperty(obj, key, {
      value: null,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return obj;
}

function createMiniDomElement(tagName, attrs = {}, children = [], rect = null) {
  const el = defineHiddenLinks({
    nodeType: 1,
    tagName: String(tagName || "DIV").toUpperCase(),
    attributes: { ...attrs },
    childNodes: [],
    children: [],
    _rect: rect || { top: 100, bottom: 132, left: 0, right: 600, width: 600, height: 32 },
    _hiddenRects: false,
    classList: {
      _set: new Set(String(attrs.class || "").split(/\s+/).filter(Boolean)),
      contains(cls) {
        return this._set.has(cls);
      },
      add(...clsList) {
        clsList.forEach((c) => this._set.add(c));
      },
      remove(...clsList) {
        clsList.forEach((c) => this._set.delete(c));
      },
      toggle(cls, force) {
        if (force === undefined) {
          if (this._set.has(cls)) {
            this._set.delete(cls);
            return false;
          }
          this._set.add(cls);
          return true;
        }
        if (force) this._set.add(cls);
        else this._set.delete(cls);
        return Boolean(force);
      },
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? String(this.attributes[name])
        : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    getBoundingClientRect() {
      return this._hiddenRects
        ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
        : this._rect;
    },
    getClientRects() {
      return this._hiddenRects ? [] : [this._rect];
    },
    get textContent() {
      return this.childNodes.map((c) => c.textContent || "").join("");
    },
    matches(selector) {
      return matchesSelectorGroup(this, selector);
    },
    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelectorGroup(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (matchesSelectorGroup(child, selector)) results.push(child);
          visit(child);
        }
      };
      visit(this);
      return results;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  });

  for (const child of children) {
    appendMiniNode(el, child);
  }
  return el;
}

function createMiniText(text) {
  return defineHiddenLinks({
    nodeType: 3,
    textContent: String(text),
  });
}

function appendMiniNode(parent, child) {
  if (typeof child === "string") {
    child = createMiniText(child);
  }
  const prev = parent.childNodes[parent.childNodes.length - 1] || null;
  if (prev) prev.nextSibling = child;
  child.previousSibling = prev;
  child.parentNode = parent;
  child.parentElement = parent;
  parent.childNodes.push(child);
  if (child.nodeType === 1) {
    parent.children.push(child);
  }
  return child;
}

function matchesSingleCompound(el, rawCompound) {
  let s = rawCompound.trim();
  if (!s || !el || el.nodeType !== 1) return false;

  const notMatches = [];
  s = s.replace(/:not\(([^)]+)\)/g, (_, inner) => {
    notMatches.push(inner.trim());
    return "";
  });
  for (const neg of notMatches) {
    if (matchesSelectorGroup(el, neg)) return false;
  }

  const attrMatches = [];
  s = s.replace(/\[([^\]=$*^~|]+)(?:([*^$|~]?=)"([^"]*)")?\]/g, (_, attr, op, val) => {
    attrMatches.push({ attr: attr.trim(), op: op || null, val: val ?? null });
    return "";
  });
  for (const { attr, op, val } of attrMatches) {
    const actual = el.getAttribute(attr);
    if (actual === null) return false;
    if (op === "=") {
      if (actual !== val) return false;
    } else if (op === "$=") {
      if (!actual.endsWith(val)) return false;
    } else if (op === "*=") {
      if (!actual.includes(val)) return false;
    }
  }

  const idMatches = [];
  s = s.replace(/#([A-Za-z0-9_.-]+)/g, (_, id) => {
    idMatches.push(id);
    return "";
  });
  for (const id of idMatches) {
    if (el.getAttribute("id") !== id) return false;
  }

  const classMatches = [];
  s = s.replace(/\.([A-Za-z0-9_-]+)/g, (_, cls) => {
    classMatches.push(cls);
    return "";
  });
  for (const cls of classMatches) {
    if (!el.classList.contains(cls)) return false;
  }

  const tag = s.trim();
  if (tag && tag !== "*" && el.tagName !== tag.toUpperCase()) {
    return false;
  }
  return true;
}

function matchesSelectorChain(el, chainStr) {
  const parts = chainStr.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!matchesSingleCompound(el, parts[parts.length - 1])) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (cur && !matchesSingleCompound(cur, parts[i])) {
      cur = cur.parentElement;
    }
    if (!cur) return false;
    cur = cur.parentElement;
  }
  return true;
}

function matchesSelectorGroup(el, selectorGroup) {
  const topParts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorGroup.length; i++) {
    const ch = selectorGroup[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      topParts.push(selectorGroup.slice(start, i));
      start = i + 1;
    }
  }
  topParts.push(selectorGroup.slice(start));
  return topParts.some((part) => matchesSelectorChain(el, part));
}

// =========================================================================
// Task 1: FTS Highlight & Sub-Paragraph Anchor Resolution (Sentence & Para)
// =========================================================================

test("Task 1: highlightTranslationText supports FTS5 prefix/wildcard tokens while keeping 2-char words bounded", () => {
  const { highlightTranslationText } = transMod;

  const prefixOut = highlightTranslationText(
    "Cultivating mindfulness of breathing brings peace.",
    "mindful",
  );
  assert.match(
    prefixOut,
    /<mark class="search-hit">mindfulness<\/mark>/,
    "3+ char FTS prefix query must highlight inflected word in translation",
  );

  const wildcardOut = highlightTranslationText(
    "Unmindfulness leads to heedlessness.",
    "*fulness",
  );
  assert.match(
    wildcardOut,
    /<mark class="search-hit">Unmindfulness<\/mark>/,
    "Leading wildcard query must highlight suffix matches",
  );

  const shortBounded = highlightTranslationText("Mind in meditation", "in");
  assert.equal(
    shortBounded,
    'Mind <mark class="search-hit">in</mark> meditation',
    "2-letter token without wildcard must not match inside 'Mind'",
  );
});

test("Task 1: pickBestSearchHitAnchor & findPassageSubTarget resolve Pāḷi and Translation hits accurately in sentence mode (.sent-pair-pali)", () => {
  const { pickBestSearchHitAnchor, findPassageSubTarget } = readerMod;

  const paliHitMark = createMiniDomElement(
    "mark",
    { class: "search-hit" },
    ["satipaṭṭhāna"],
    { top: 750, bottom: 774, left: 20, right: 140, width: 120, height: 24 },
  );
  const enHitMark = createMiniDomElement(
    "mark",
    { class: "search-hit" },
    ["mindfulness"],
    { top: 780, bottom: 804, left: 20, right: 140, width: 120, height: 24 },
  );

  const pair1 = createMiniDomElement(
    "div",
    { class: "sent-pair", "data-line": "1" },
    [
      createMiniDomElement("div", {
        class: "sent-pair-pali reader-pali-trans-block reader-trans-block",
        "data-trans-lang": "pali",
      }, ["Evaṃ me sutaṃ."]),
      createMiniDomElement("div", {
        class: "sent-pair-trans reader-trans-block",
        "data-trans-lang": "en",
      }, ["Thus have I heard."]),
    ],
    { top: 120, bottom: 200, left: 0, right: 600, width: 600, height: 80 },
  );

  const pair2 = createMiniDomElement(
    "div",
    { class: "sent-pair", "data-line": "2" },
    [
      createMiniDomElement("div", {
        class: "sent-pair-pali reader-pali-trans-block reader-trans-block",
        "data-trans-lang": "pali",
      }, ["Ekāyano ayaṃ bhikkhave maggo ", paliHitMark, "."]),
      createMiniDomElement("div", {
        class: "sent-pair-trans reader-trans-block",
        "data-trans-lang": "en",
      }, ["Mendicants, this is the direct path for ", enHitMark, "."]),
      createMiniDomElement("div", {
        class: "sent-pair-trans reader-trans-block",
        "data-trans-lang": "vi",
      }, ["Này các Tỳ-khưu, đây là con đường độc nhất."]),
    ],
    { top: 410, bottom: 810, left: 0, right: 600, width: 600, height: 400 },
  );

  const row = createMiniDomElement(
    "div",
    { class: "reader-para-row", "data-pindex": "12" },
    [createMiniDomElement("div", { class: "reader-sent-pairs" }, [pair1, pair2])],
    { top: 120, bottom: 810, left: 0, right: 600, width: 600, height: 690 },
  );

  // On a compact viewport (vpHeight=600 -> maxComfortSpan=270, 774-410=364 > 270), anchors directly on paliHitMark
  const paliAnchor = pickBestSearchHitAnchor(row, {
    isTransTarget: false,
    targetTransLang: "pali",
    vpHeight: 600,
  });
  assert.equal(
    paliAnchor,
    paliHitMark,
    "Pāḷi FTS hit inside .sent-pair-pali must not be filtered out as a translation block",
  );

  // On a tall viewport (vpHeight=1000 -> maxComfortSpan=450, 364 <= 450), anchors cleanly on enclosing .sent-pair
  const paliPairAnchor = pickBestSearchHitAnchor(row, {
    isTransTarget: false,
    targetTransLang: "pali",
    vpHeight: 1000,
  });
  assert.equal(paliPairAnchor, pair2);

  // English FTS search with multiple translations enabled: picks enHitMark inside [data-trans-lang="en"]
  const enAnchor = pickBestSearchHitAnchor(row, {
    isTransTarget: true,
    targetTransLang: "en",
    vpHeight: 600,
  });
  assert.equal(enAnchor, enHitMark);

  // Translation snippet fallback when no <mark> is present
  const prevDoc = global.document;
  global.document = {
    createRange: () => ({
      setStart: noop,
      setEnd: noop,
      getClientRects: () => [{ top: 760, bottom: 784, left: 20, right: 200, width: 180, height: 24 }],
      getBoundingClientRect: () => ({ top: 760, bottom: 784, left: 20, right: 200, width: 180, height: 24 }),
    }),
  };
  try {
    const transSub = findPassageSubTarget(row, {
      snippet: "...con đường độc nhất...",
      isTransTarget: true,
      targetTransLang: "vi",
    });
    assert.equal(
      transSub?.anchor,
      pair2,
      "Translation snippet fallback must locate the matching .sent-pair even without <mark>",
    );
  } finally {
    global.document = prevDoc;
  }
});

// =========================================================================
// Task 2: Bold Definition & Linked Definition Passage Open Options
// =========================================================================

test("Task 2: DictionaryModal buildBoldPassageOpenOpts & shouldCloseDictOnReaderOpen extract real bold_definitions.db fields accurately", () => {
  const dictMod = compileModule("components/DictionaryModal.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "../context/DictionaryContext": {
      useDictionary: () => ({}),
      DEFAULT_DICT_ORDER: [],
      DEFAULT_DICT_ENABLED: {},
    },
    "../context/TabContext": { useTabs: () => ({}) },
    "../context/ThemeSettingsContext": { useThemeSettings: () => ({ settings: {} }) },
    "./BoldDefinitionSection": { __esModule: true, default: noopComp },
    "../services/transliterate": transMod,
    "../services/api": {
      fetchDictionaryInflection: async () => null,
      fetchDictionarySuggestions: async () => [],
    },
    "../services/dpdFeedback": { restoreMinifiedLinks: (s) => s },
  });

  const { buildBoldPassageOpenOpts, shouldCloseDictOnReaderOpen } = dictMod;

  const boldDbPath = path.resolve(rootDir, "server_api/db/bold_definitions.db");
  const db = new DatabaseSync(boldDbPath, { readOnly: true });
  let sampleRow;
  try {
    sampleRow = db
      .prepare(
        "SELECT book_code, chapter_index, para_index, para_num, line_id, word, ending, sentence_html FROM bold_definitions WHERE id = 1",
      )
      .get();
  } finally {
    db.close();
  }

  assert.ok(sampleRow, "Expected bold_definitions row id=1 in bold_definitions.db");
  const opts = buildBoldPassageOpenOpts(sampleRow, "abhidhammo");
  assert.equal(opts.lang, "pali");
  assert.equal(opts.targetChapterIdx, sampleRow.chapter_index);
  assert.equal(opts.targetParaIndex, sampleRow.para_index);
  assert.equal(opts.targetLineId, sampleRow.line_id);
  assert.ok(opts.targetBold && !opts.targetBold.includes("<b>"), "targetBold must extract clean inner text of <b>...</b>");
  assert.ok(opts.targetSnippet && !opts.targetSnippet.includes("<"), "targetSnippet must strip HTML tags from sentence_html");

  assert.equal(shouldCloseDictOnReaderOpen({ dockMode: "modal", isPinned: true, viewportWidth: 1440 }), true);
  assert.equal(shouldCloseDictOnReaderOpen({ dockMode: "side", isPinned: false, viewportWidth: 1440 }), true);
  assert.equal(shouldCloseDictOnReaderOpen({ dockMode: "side", isPinned: true, viewportWidth: 390 }), true);
  assert.equal(shouldCloseDictOnReaderOpen({ dockMode: "side", isPinned: true, viewportWidth: 1440 }), false);
});

test("Task 2: LinkedDefinitionModal extracts chosenLine.pali_html bold/snippet and findPassageSubTarget disambiguates multiple <strong class='bld'> glosses", () => {
  let capturedOpen = null;
  let closedModal = false;
  let closedDict = false;

  const linkedMod = compileModule("components/Reader/LinkedDefinitionModal.jsx", {
    react: Object.assign({}, React, {
      __esModule: true,
      default: React,
      useState: (init) => [typeof init === "function" ? init() : init, noop],
      useEffect: noop,
      useLayoutEffect: noop,
      useRef: (v) => ({ current: v }),
    }),
    "lucide-react": iconProxy,
    "../../services/api": {
      fetchLinkedPreview: async () => null,
      getCachedLinkedPreview: () => ({
        book_code: "s0102a.att",
        chapter_index: 2,
        target_para_index: 45,
        target_line_id: 4,
        lines: [
          { line_id: 3, para_index: 45, pali_html: "3. Tattha katamo?" },
          { line_id: 4, para_index: 45, is_target: true, pali_html: "4. <b>Maggo</b>ti ariyaṭṭhaṅgiko maggo vuccati." },
        ],
      }),
    },
    "../../services/transliterate": transMod,
    "../../services/translationFormat": compileModule("services/translationFormat.js", {}),
    "../../context/TabContext": {
      useTabs: () => ({
        openBook: (code, opts) => {
          capturedOpen = { code, opts };
        },
      }),
    },
    "../../context/ThemeSettingsContext": {
      useThemeSettings: () => ({
        settings: { paliScript: "roman", translations: { english: true }, translationOrder: ["pali", "english"] },
      }),
      resolveTranslationTextColor: () => "#222",
    },
    "../../context/DictionaryContext": {
      useDictionary: () => ({
        openDictionary: noop,
        isOpen: true,
        closeDictionary: () => {
          closedDict = true;
        },
        dockMode: "side",
        isPinned: false,
      }),
    },
  });

  const prevWin = global.window;
  global.window = { innerWidth: 1280 };
  try {
    const tree = linkedMod.default({
      link: {
        word: "maggo",
        target_book: "s0102a.att",
        target_book_title: "Mahāvagga-aṭṭhakathā",
        target_chapter: 2,
        target_para_index: 45,
        target_para_num: "112",
        target_line_id: 4,
      },
      activeLangs: ["en"],
      currentScript: "roman",
      onClose: () => {
        closedModal = true;
      },
    });
    const collectNodeText = (n) => {
      if (typeof n === "string" || typeof n === "number") return String(n);
      if (!n || typeof n !== "object") return "";
      if (Array.isArray(n)) return n.map(collectNodeText).join(" ");
      return collectNodeText(n.props?.children);
    };
    const findButtonByText = (node, label) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const item of node) {
          const hit = findButtonByText(item, label);
          if (hit) return hit;
        }
        return null;
      }
      if (node.type === "button" && collectNodeText(node).includes(label)) {
        return node;
      }
      return findButtonByText(node.props?.children, label);
    };
    const openBtn = findButtonByText(tree, "Open in Reader");
    assert.ok(openBtn, "Open in Reader button must exist");
    openBtn.props.onClick();

    assert.equal(closedModal, true);
    assert.equal(closedDict, true, "Unpinned dictionary must close when opening passage in reader");
    assert.equal(capturedOpen?.code, "s0102a.att");
    assert.equal(capturedOpen?.opts?.lang, "pali");
    assert.equal(capturedOpen?.opts?.targetParaIndex, 45);
    assert.equal(capturedOpen?.opts?.targetLineId, 4);
    assert.equal(capturedOpen?.opts?.targetBold, "Maggo");
    assert.equal(
      capturedOpen?.opts?.targetSnippet,
      "Maggoti ariyaṭṭhaṅgiko maggo vuccati.",
      "Leading sentence number '4. ' and HTML tags must be stripped from chosenLine.pali_html",
    );
    assert.ok(global.window.__tpoModalClosedAt > 0, "__tpoModalClosedAt must be stamped before modal close");
  } finally {
    global.window = prevWin;
  }

  const { findPassageSubTarget } = readerMod;
  const bld1 = createMiniDomElement("strong", { class: "bld" }, ["Maggo"], { top: 150, bottom: 174, left: 0, right: 60, width: 60, height: 24 });
  const bld2 = createMiniDomElement("strong", { class: "bld" }, ["Maggo"], { top: 680, bottom: 704, left: 0, right: 60, width: 60, height: 24 });
  const inlinePb = createMiniDomElement("span", { class: "pb", "data-ed": "M", "data-page": "1.0042" }, []);
  const para = createMiniDomElement("p", { "data-pindex": "45" }, [
    bld1,
    "ti lokiyo maggo. ",
    bld2,
    inlinePb,
    "ti ariyaṭṭhaṅgiko maggo vuccati.",
  ]);

  const hit = findPassageSubTarget(para, {
    word: "maggo",
    bold: "Maggo",
    snippet: "Maggoti ariyaṭṭhaṅgiko maggo vuccati.",
    paliScript: "roman",
  });
  assert.equal(hit?.anchor, bld2, "Must pick the second <strong class='bld'> matching the gloss snippet even across inline .pb");
});

// =========================================================================
// Task 3: Offline Mobile WebView Auto-Hide & Recents/History Scroll Toggle
// =========================================================================

test("Task 3: Real tipitakaWebBridgeScript handles HistoryModal (.modal-backdrop), programmatic jumps, and window-scroll toggle", () => {
  const dartSrc = fs.readFileSync(
    path.resolve(
      rootDir,
      "tipitakapali_org_app/lib/features/webview/tipitaka_webview_screen.dart",
    ),
    "utf8",
  );
  const match = dartSrc.match(
    /const String _languageMenuBridgeScript = r'''([\s\S]*?)''';/,
  );
  assert.ok(match, "Expected _languageMenuBridgeScript in tipitaka_webview_screen.dart");
  const bridgeJs = match[1];

  const docListeners = new Map();
  const winListeners = new Map();
  let currentScrollY = 0;
  let currentScrollHeight = 4000;
  let modalOpen = true;

  const bodyClassSet = new Set(["window-scroll"]);
  const scrollingEl = {
    get scrollTop() {
      return currentScrollY;
    },
    get scrollHeight() {
      return currentScrollHeight;
    },
    clientHeight: 800,
  };

  const docObj = {
    head: { appendChild: noop },
    scrollingElement: scrollingEl,
    documentElement: scrollingEl,
    body: {
      get scrollTop() {
        return currentScrollY;
      },
      get scrollHeight() {
        return currentScrollHeight;
      },
      classList: {
        contains: (c) => bodyClassSet.has(c),
        toggle: (c, force) => {
          if (force) bodyClassSet.add(c);
          else bodyClassSet.delete(c);
          return Boolean(force);
        },
        add: (c) => bodyClassSet.add(c),
        remove: (c) => bodyClassSet.delete(c),
      },
    },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    querySelectorAll: () => [],
    querySelector: (sel) => {
      if (modalOpen && sel.includes(".modal-backdrop")) return { id: "history-modal" };
      if (sel.includes('main.content-area:not([data-toc-view="true"])')) {
        return { id: "reader-main" };
      }
      return null;
    },
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
  };

  let fakeNow = 100000;
  const winObj = {
    innerHeight: 800,
    get scrollY() {
      return currentScrollY;
    },
    get pageYOffset() {
      return currentScrollY;
    },
    location: { hostname: "127.0.0.1" },
    localStorage: { getItem: () => null, setItem: noop },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    getComputedStyle: () => ({
      getPropertyValue: () => "#ffffff",
      backgroundColor: "rgb(255, 255, 255)",
    }),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    addEventListener: (type, fn) => {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchEvent: (evt) => {
      for (const fn of winListeners.get(evt.type) || []) fn(evt);
    },
  };
  winObj.window = winObj;
  winObj.document = docObj;
  winObj.Date = { now: () => fakeNow };
  winObj.setTimeout = () => 1;
  winObj.clearTimeout = noop;
  winObj.setInterval = () => 1;

  vm.runInNewContext(bridgeJs, winObj);

  const emitDoc = (type, evt) => {
    for (const fn of docListeners.get(type) || []) fn(evt);
  };

  // 1. User taps a book item inside HistoryModal (.modal-backdrop)
  const historyItemTarget = {
    closest: (sel) => (sel.includes(".modal-backdrop") ? { id: "history-modal" } : null),
  };
  emitDoc("touchstart", { type: "touchstart", target: historyItemTarget, touches: [{ clientY: 300 }] });
  emitDoc("touchend", { type: "touchend", target: historyItemTarget, touches: [] });

  modalOpen = false;
  winObj.__tpoModalClosedAt = fakeNow;
  winObj.__tpoProgrammaticScroll = true;
  winObj.dispatchEvent({ type: "tipitaka:show-bars" });
  fakeNow += 80;
  currentScrollY = 1200;
  emitDoc("scroll", { type: "scroll", target: docObj });
  fakeNow += 80;
  currentScrollY = 1280;
  emitDoc("scroll", { type: "scroll", target: docObj });

  assert.equal(
    bodyClassSet.has("tpo-bars-hidden"),
    false,
    "Opening a book from HistoryModal + programmatic jump must NOT auto-hide .book-tabs-bar / footer",
  );

  // 2. User scrolls down in window-scroll mode -> hides bars
  winObj.__tpoProgrammaticScroll = false;
  fakeNow += 1000;
  const readerTouchTarget = { closest: () => null };
  emitDoc("touchstart", { type: "touchstart", target: readerTouchTarget, touches: [{ clientY: 500 }] });
  emitDoc("touchmove", { type: "touchmove", target: readerTouchTarget, touches: [{ clientY: 420 }] });
  currentScrollY = 1340;
  emitDoc("scroll", { type: "scroll", target: docObj });

  assert.equal(
    bodyClassSet.has("tpo-bars-hidden"),
    true,
    "User downward scroll in window-scroll mode must hide bars cleanly",
  );

  // 3. After the 0.24s CSS transition settles, user scrolls UP on document in window-scroll mode -> reveals bars
  fakeNow += 340;
  emitDoc("touchstart", { type: "touchstart", target: readerTouchTarget, touches: [{ clientY: 420 }] });
  emitDoc("touchmove", { type: "touchmove", target: readerTouchTarget, touches: [{ clientY: 470 }] });
  currentScrollY = 1305;
  emitDoc("scroll", { type: "scroll", target: docObj });

  assert.equal(
    bodyClassSet.has("tpo-bars-hidden"),
    false,
    "User upward scroll on document in window-scroll mode must reveal .tabs-scroll-container and bottom bar",
  );

  // 4. Short chapter (maxScroll <= 80) must never trap bars hidden
  bodyClassSet.add("tpo-bars-hidden");
  currentScrollHeight = 840;
  currentScrollY = 30;
  fakeNow += 400;
  emitDoc("scroll", { type: "scroll", target: docObj });
  assert.equal(
    bodyClassSet.has("tpo-bars-hidden"),
    false,
    "Short chapters (maxScroll <= 80) must automatically reveal hidden bars",
  );
});

test("Task 3: computeNextHeaderVisibility forces bars visible on short chapters (maxScroll <= 80)", () => {
  const { computeNextHeaderVisibility } = scrollMod;

  const res = computeNextHeaderVisibility({
    top: 40,
    isHeaderVisible: false,
    upPeakY: 0,
    downPeakY: 40,
    viewportHeight: 800,
    scrollHeight: 850,
    isJumping: false,
  });
  assert.equal(res.nextVisible, true);
});

// =========================================================================
// Task 4: GoTo Page Number (abh03m7.mul & Multi-Volume / Skipped Pages)
// =========================================================================

test("Task 4: abh03m7.mul page jumps resolve unnumbered-para pages, skipped V 519 page, and exact chunk index", () => {
  const gotoMod = compileModule("components/GoToModal.jsx", {
    react: Object.assign({}, React, { __esModule: true, default: React }),
    "lucide-react": iconProxy,
    "../context/TabContext": { useTabs: () => ({}) },
    "../context/ThemeSettingsContext": { useThemeSettings: () => ({ settings: {} }) },
    "../services/transliterate": transMod,
    "../services/api": { fetchBookTocOnly: async () => null },
  });

  const { resolveBookPageTarget, extractEditionVolumes } = gotoMod;
  const { splitChapterHtmlIntoChunks, findTargetChunkIndex, resolveMeasurablePbAnchor } = readerMod;

  const decodeZ = (txt, zBuf) => {
    if (txt && typeof txt === "string") return txt;
    if (!zBuf) return "";
    return zlib.inflateSync(zBuf).toString("utf8");
  };

  const tipiDbPath = path.resolve(rootDir, "server_api/db/tipitaka.db");
  const db = new DatabaseSync(tipiDbPath, { readOnly: true });
  let abhMeta;
  let abhCh3Html;
  let abhCh7Html;
  let abh08Meta;
  try {
    const abhBook = db.prepare("SELECT meta_json, meta_z FROM books WHERE code = ?").get("abh03m7.mul");
    abhMeta = JSON.parse(decodeZ(abhBook.meta_json, abhBook.meta_z));
    const abhCh3Row = db
      .prepare("SELECT html, html_z FROM chapters WHERE book_code = ? AND chapter_index = 3")
      .get("abh03m7.mul");
    abhCh3Html = decodeZ(abhCh3Row.html, abhCh3Row.html_z);
    const abhCh7Row = db
      .prepare("SELECT html, html_z FROM chapters WHERE book_code = ? AND chapter_index = 7")
      .get("abh03m7.mul");
    abhCh7Html = decodeZ(abhCh7Row.html, abhCh7Row.html_z);
    const abh08Book = db.prepare("SELECT meta_json, meta_z FROM books WHERE code = ?").get("abh08t.nrf");
    abh08Meta = JSON.parse(decodeZ(abh08Book.meta_json, abh08Book.meta_z));
  } finally {
    db.close();
  }

  // 1. abh03m7.mul M page 250 (page_to_para has NO entry for 250!)
  const m250 = resolveBookPageTarget({
    pageInput: "250",
    edition: "M",
    editionRange: abhMeta.edition_ranges.M,
    pageToChapter: abhMeta.page_to_chapter.M,
    pageToPara: abhMeta.page_to_para?.M,
    pageAnchors: abhMeta.page_anchors?.M,
  });
  assert.equal(m250.ok, true);
  assert.equal(m250.targetChapterIdx, 3);
  assert.equal(m250.targetPage, "1.0250");
  assert.equal(m250.targetParaNum, undefined, "Must NOT inject a bogus fallback paraNum");

  // 2. Chunk resolution on abh03m7.mul ch3 (2,551 paragraphs = 86 chunks):
  // Even if paraNum='1' is passed, page='250' MUST take precedence and mount the middle chunk!
  const chunks = splitChapterHtmlIntoChunks(abhCh3Html);
  assert.ok(chunks.length > 80, `Expected >80 chunks for abh03m7.mul ch3, got ${chunks.length}`);
  const chunkIdx250 = findTargetChunkIndex(chunks, {
    page: "250",
    pageSystem: "M",
    paraNum: "1",
  });
  assert.ok(
    chunkIdx250 > 20,
    `Expected M page 250 to resolve to deep chunk (>20), got chunk ${chunkIdx250}`,
  );
  assert.match(chunks[chunkIdx250].rawHtml, /data-ed="M"[^>]*data-page="1\.0250"/);

  // 3. abh03m7.mul V page 519 (skipped print page within V range 1–529, located in chapter 7!)
  const v519 = resolveBookPageTarget({
    pageInput: "519",
    edition: "V",
    editionRange: abhMeta.edition_ranges.V,
    pageToChapter: abhMeta.page_to_chapter.V,
    pageToPara: abhMeta.page_to_para?.V,
    pageAnchors: abhMeta.page_anchors?.V,
  });
  assert.equal(v519.ok, true, "Skipped print page V 519 within 1-529 must resolve to nearest page");
  assert.equal(v519.targetChapterIdx, 7);
  const ch7Chunks = splitChapterHtmlIntoChunks(abhCh7Html);
  const chunkIdxV519 = findTargetChunkIndex(ch7Chunks, {
    page: "519",
    pageSystem: "V",
  });
  assert.ok(chunkIdxV519 >= 0 && chunkIdxV519 < ch7Chunks.length);
  assert.match(ch7Chunks[chunkIdxV519].rawHtml, /data-ed="V"[^>]*data-page="1\.05(?:18|20)"/);

  // 4. Out-of-bounds page number is rejected with a clear range error
  const outOfBounds = resolveBookPageTarget({
    pageInput: "999",
    edition: "M",
    editionRange: abhMeta.edition_ranges.M,
    pageToChapter: abhMeta.page_to_chapter.M,
    pageToPara: abhMeta.page_to_para?.M,
    pageAnchors: abhMeta.page_anchors?.M,
  });
  assert.equal(outOfBounds.ok, false);
  assert.ok(outOfBounds.error);

  // 5. Multi-volume edition including vol 0 (abh08t.nrf M has volumes [0, 1, 2])
  const abh08Vols = extractEditionVolumes(abh08Meta.page_to_chapter.M);
  assert.deepEqual(abh08Vols.map((v) => v.vol), [0, 1, 2]);
  const vol0Target = resolveBookPageTarget({
    pageInput: "5",
    edition: "M",
    editionRange: abh08Meta.edition_ranges.M,
    pageToChapter: abh08Meta.page_to_chapter.M,
    pageToPara: abh08Meta.page_to_para?.M,
    pageAnchors: abh08Meta.page_anchors?.M,
    selectedVolume: 0,
  });
  assert.equal(vol0Target.ok, true);
  assert.ok(vol0Target.targetChapterIdx >= 0);

  // 6. Hidden .pb span (e.g. body.hide-pb) inside a tall paragraph resolves to adjacent text Range
  const hiddenPb = createMiniDomElement("span", { class: "pb", "data-ed": "M", "data-page": "0.0250" }, []);
  hiddenPb._hiddenRects = true;
  createMiniDomElement(
    "p",
    { "data-pindex": "900" },
    ["First half of paragraph. ", hiddenPb, "Second half starting at page 250."],
    { top: 100, bottom: 1600, left: 0, right: 600, width: 600, height: 1500 },
  );
  const prevDoc = global.document;
  global.document = {
    createRange: () => ({
      setStart: noop,
      setEnd: noop,
      getClientRects: () => [{ top: 845, bottom: 869, left: 40, right: 52, width: 12, height: 24 }],
      getBoundingClientRect: () => ({ top: 845, bottom: 869, left: 40, right: 52, width: 12, height: 24 }),
    }),
  };
  try {
    const pbAnchor = resolveMeasurablePbAnchor(hiddenPb, false);
    assert.equal(
      pbAnchor.getBoundingClientRect().top,
      845,
      "Hidden .pb inside a multi-screen paragraph must anchor to the exact adjacent text line",
    );
  } finally {
    global.document = prevDoc;
  }
});
