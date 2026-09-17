'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const compress = require('@fastify/compress');
const { initAiController, registerAiRoutes } = require('./aiController');
const { initLogEngine, registerLogRoutes, logAsync, closeLogDb } = require('./logEngine');
const { initReaderSubmissionsEngine, registerReaderSubmissionsRoutes, closeReaderSubmissionsDb } = require('./readerSubmissionsEngine');

// Keep the same internal port used by the existing api.tipitakapali.org reverse proxy.
// Override with PORT when running in another environment.
// Default to 0.0.0.0; override with other for security reasons when needed.
const PORT = parseInt(process.env.PORT || '8400', 10);
const HOST = process.env.HOST || '0.0.0.0';

function getDbCandidates(filename) {
  const candidates = [];
  if (process.env.USER_DATA_PATH) {
    candidates.push(path.join(process.env.USER_DATA_PATH, 'db', filename));
    candidates.push(path.join(process.env.USER_DATA_PATH, 'db_tpo', filename));
    candidates.push(path.join(process.env.USER_DATA_PATH, filename));
  }
  if (process.env.DB_DIR) {
    candidates.push(path.join(process.env.DB_DIR, filename));
  }
  if (process.env.PROCESS_RESOURCES_PATH) {
    candidates.push(path.join(process.env.PROCESS_RESOURCES_PATH, 'db', filename));
    candidates.push(path.join(process.env.PROCESS_RESOURCES_PATH, filename));
  }
  candidates.push(path.join(__dirname, 'db', filename));
  candidates.push(path.join(__dirname, filename));
  return candidates;
}

function resolveDbPath(filename) {
  const candidates = getDbCandidates(filename);
  const found = candidates.find((p) => fs.existsSync(p));
  return found ? path.resolve(found) : null;
}

// Locate tipitaka.db database
let DB_PATH = resolveDbPath('tipitaka.db');
if (!DB_PATH) {
  console.error('ERROR: tipitaka.db not found in candidates:', getDbCandidates('tipitaka.db'));
  process.exit(1);
}
console.log(`[Database] Using SQLite database at: ${DB_PATH}`);

// Initialize SQLite database connection (Native Fast Synchronous Engine)
const db = new Database(DB_PATH, { readonly: true });

// Optimize SQLite engine parameters with standard lightweight settings
db.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA query_only = 1;
`);

// Locate and initialize separate fts_tipitaka.db database for full-text search
let FTS_DB_PATH = resolveDbPath('fts_tipitaka.db') || DB_PATH;
let dbFts = null;
if (FTS_DB_PATH) {
  try {
    dbFts = new Database(FTS_DB_PATH, { readonly: true });
    dbFts.exec(`
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA query_only = 1;
    `);
    console.log(`[Database] Using FTS5 SQLite database at: ${FTS_DB_PATH}`);
  } catch (err) {
    console.warn('[Database] FTS database initialization error:', err.message);
  }
}

// Translation FTS database cache & resolver
const translationFtsDbs = new Map();

const LANG_NAME_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  burmese: 'my',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  russian: 'ru',
  my_nissaya: 'my_nissaya',
  nissaya: 'my_nissaya',
};

function getSearchDatabase(targetParam) {
  const norm = String(targetParam || '').trim().toLowerCase();
  if (!norm || norm === 'pali' || norm === 'tipitaka' || norm === 'fts_tipitaka.db' || norm === 'fts_tipitaka') {
    return { db: dbFts || db, key: 'pali', isPali: true, dbName: 'fts_tipitaka.db' };
  }

  let lang = norm;
  const m = norm.match(/(?:fts_)?translation_([a-z_]+)(?:\.db)?$/i);
  if (m) {
    lang = m[1];
  } else {
    lang = norm.replace(/\.db$/, '');
  }

  if (LANG_NAME_TO_CODE[lang]) {
    lang = LANG_NAME_TO_CODE[lang];
  }

  if (translationFtsDbs.has(lang)) {
    return { db: translationFtsDbs.get(lang), key: lang, isPali: false, dbName: `fts_translation_${lang}.db` };
  }

  const filename = `fts_translation_${lang}.db`;
  const ftsPath = resolveDbPath(filename);
  if (ftsPath && fs.existsSync(ftsPath)) {
    try {
      const transDb = new Database(ftsPath, { readonly: true });
      transDb.exec(`
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA query_only = 1;
      `);
      translationFtsDbs.set(lang, transDb);
      console.log(`[Database] Using translation FTS5 SQLite database for '${lang}' at: ${ftsPath}`);
      return { db: transDb, key: lang, isPali: false, dbName: filename };
    } catch (err) {
      console.warn(`[Database] Error opening translation FTS DB ${filename}:`, err.message);
    }
  }

  return { db: dbFts || db, key: 'pali', isPali: true, dbName: 'fts_tipitaka.db', notFound: lang };
}

// Prepared Statements for ultra-low latency direct execution (Zero runtime parsing)
const stmtGetTreeMeta = db.prepare("SELECT value FROM site_metadata WHERE key = 'tree_json'");
const stmtGetBooks = db.prepare('SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id');
const stmtGetBook = db.prepare('SELECT id, code, title, nikaya, category, chapter_count, meta_json FROM books WHERE code = ?');
const stmtGetChapters = db.prepare('SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index');
const stmtGetChapterHtml = db.prepare('SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ?');
const stmtGetChaptersRangeHtml = db.prepare('SELECT chapter_index, html FROM chapters WHERE book_code = ? AND chapter_index BETWEEN ? AND ? ORDER BY chapter_index');
const stmtGetAllChaptersHtml = db.prepare('SELECT chapter_index, html FROM chapters WHERE book_code = ? ORDER BY chapter_index');
const stmtGetToc = db.prepare('SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index FROM book_toc WHERE book_code = ? ORDER BY item_index');

let stmtGetMat = null;
let stmtGetAllMat = null;
let stmtGetMatParaChap = null;
let stmtGetMatPara = null;
let stmtGetMatParaSub = null;
let stmtGetMatChapter = null;
let stmtGetCanonPara = null;
let stmtGetClosestCanonPara = null;
let stmtGetClosestMatParaChap = null;
let stmtGetMatParaSibs = null;
let stmtGetCanonByGuid = null;
try {
  stmtGetMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat WHERE book_code = ?');
  stmtGetAllMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat');
  stmtGetMatParaChap = db.prepare('SELECT mula_book, mula_chapter, mula_para, mula_title, attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title, source_para FROM mat_para_map WHERE source_book = ? AND source_chapter = ? AND source_para = ?');
  stmtGetClosestMatParaChap = db.prepare('SELECT mula_book, mula_chapter, mula_para, mula_title, attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title, source_para FROM mat_para_map WHERE source_book = ? AND source_chapter = ? AND CAST(source_para AS INTEGER) > 0 ORDER BY ABS(CAST(source_para AS INTEGER) - ?) ASC LIMIT 1');
  stmtGetMatParaSub = db.prepare('SELECT mula_book, mula_chapter, mula_para, mula_title, attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title, source_para FROM mat_para_map WHERE source_book = ? AND sub_book = ? AND source_para = ?');
  stmtGetMatPara = db.prepare('SELECT mula_book, mula_chapter, mula_para, mula_title, attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title, source_para FROM mat_para_map WHERE source_book = ? AND source_para = ?');
  stmtGetMatChapter = db.prepare('SELECT mula_book, mula_chapter, mula_title, attha_book, attha_chapter, attha_title, tika_book, tika_chapter, tika_title FROM mat_chapter_map WHERE source_book = ? AND source_chapter = ?');
  stmtGetMatParaSibs = db.prepare('SELECT mula_book, mula_chapter, mula_para, mula_title, attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title, source_para FROM mat_para_map WHERE source_book = ? AND source_chapter = ?');
  stmtGetCanonPara = db.prepare('SELECT guid, book_code, chapter_index, para_num, mula_guid, mula_book, mula_chapter, mula_para, attha_guid, attha_book, attha_chapter, attha_para, tika_guid, tika_book, tika_chapter, tika_para, match_quality FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND (para_num = ? OR (para_first <= ? AND para_last >= ?)) LIMIT 1');
  stmtGetClosestCanonPara = db.prepare('SELECT guid, book_code, chapter_index, para_num, mula_guid, mula_book, mula_chapter, mula_para, attha_guid, attha_book, attha_chapter, attha_para, tika_guid, tika_book, tika_chapter, tika_para, match_quality FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_first IS NOT NULL ORDER BY ABS(para_first - ?) ASC LIMIT 1');
  stmtGetCanonByGuid = db.prepare('SELECT * FROM canon_paragraphs WHERE guid = ? LIMIT 1');
} catch (e) {
  console.warn('[MAT] book_mat/canon_paragraphs table prepared statement error:', e.message);
}

// Initialize translation engine for fast SQLite translation querying
const { getTranslationEngine } = require('./translationEngine');
const translationEngine = getTranslationEngine();

// Pāḷi transliteration and Velthuis input normalization
const { typeVelthuis, convertAnyToRoman } = require('./transliterate');

// Pāḷi sentence store: prebuilt epitaka segmentation
// (server_api/db/pali_sentences.db, via build_pali_sentences_db.py).
// Line numbers align with translation line_ids by construction.
let paliSentDb = null;
let stmtGetPaliSentencesDb = null;

function getPaliSentencesDb() {
  if (stmtGetPaliSentencesDb) return true;
  const p = resolveDbPath('pali_sentences.db');
  if (!p) return false;
  try {
    paliSentDb = new Database(p, { readonly: true });
    paliSentDb.exec(`
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA query_only = 1;
    `);
    stmtGetPaliSentencesDb = paliSentDb.prepare(
      'SELECT chapter_index, para_index, line_id, sentence FROM pali_sentences WHERE book_code = ? ORDER BY chapter_index, para_index, line_id'
    );
    console.log(`[Database] Using Pali sentences DB at: ${p}`);
    return true;
  } catch (err) {
    console.warn('[Database] Pali sentences DB error:', err.message);
    return false;
  }
}

// Clean top-level Tipiṭaka root if present
function cleanTree(data) {
  if (
    Array.isArray(data) &&
    data.length === 1 &&
    ['tipiṭaka', 'tipitaka'].includes(data[0].text?.toLowerCase()) &&
    data[0].children
  ) {
    return data[0].children;
  }
  return data;
}

// ===========================================================================
// PRE-COMPUTED IN-MEMORY RAM DATA STRUCTURES (Sub-millisecond Serving)
// ===========================================================================

// 1. Load CST Books Catalog into RAM
let cstCatalog = {};
const catalogPath = path.join(__dirname, 'cst_books_catalog.json');
if (fs.existsSync(catalogPath)) {
  try {
    cstCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    console.warn('Failed to load cst_books_catalog.json:', e);
  }
}

// 2. Pre-computed Tree in RAM
let precomputedTree = null;
const treeJsonPath = path.join(__dirname, 'tree.json');
if (fs.existsSync(treeJsonPath)) {
  try {
    precomputedTree = cleanTree(JSON.parse(fs.readFileSync(treeJsonPath, 'utf8')));
  } catch (e) {}
}
if (!precomputedTree) {
  try {
    const meta = stmtGetTreeMeta.get();
    if (meta && meta.value) precomputedTree = cleanTree(JSON.parse(meta.value));
  } catch (e) {}
}

// 3. Pre-computed Books List in RAM
const allBooksRows = stmtGetBooks.all();
const precomputedBooksList = {
  total: allBooksRows.length,
  books: allBooksRows,
};

// 4. Pre-computed Full MAT Matrix in RAM
let precomputedMatList = [];
const precomputedMatMap = new Map();
if (stmtGetAllMat) {
  try {
    precomputedMatList = stmtGetAllMat.all();
    for (const row of precomputedMatList) {
      precomputedMatMap.set(row.book_code, row);
    }
  } catch (e) {}
}

// 5. In-Memory TOC & Book Meta Cache (On-Demand)
const bookMetaCache = new Map();
const tocCache = new Map();

// 6. High-Throughput In-Memory Search Results Cache (LRU)
const searchCache = new Map();
const SEARCH_CACHE_MAX = 1000;
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let searchHits = 0;
let searchMisses = 0;

// Initialize Fastify app
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'warn',
  },
  // trustProxy -> req.ip reflects the real client IP from X-Forwarded-For set by
  // the api.tipitakapali.org reverse proxy (needed for accurate visitor logs).
  trustProxy: true,
  keepAliveTimeout: 75000,
  maxRequestsPerSocket: 0,
});

async function main() {
  await fastify.register(cors, {
    origin: true,
    // POST is required for the cross-origin Ani AI chat endpoint (/api/ai/chat,
    // /api/ai/search_batch, /api/ai/tool-call) called from the static site at
    // https://tipitakapali.org (see getApiBase in services/api.js).
    // PATCH is required for submissions approval workflow from editorial dashboard.
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  if (compress) {
    try {
      await fastify.register(compress, {
        global: true,
        threshold: 512,
      });
    } catch (err) {
      console.warn('[Fastify] Warning: @fastify/compress registration skipped:', err.message);
    }
  }

  // Visitor logging: open logs.db, serve GET /log, and record every API request
  // (non-blocking, see logAsync -> setImmediate). Skips itself, health checks and
  // static assets so the log only contains real visitors.
  initLogEngine();
  registerLogRoutes(fastify);

  // Reader contributions & terminology submissions engine
  initReaderSubmissionsEngine();
  registerReaderSubmissionsRoutes(fastify);

  fastify.addHook('onResponse', (req, reply) => {
    const url = req.url || '';
    if (
      req.method === 'OPTIONS' ||
      url === '/' ||
      url.startsWith('/log') ||
      url.startsWith('/api/health') ||
      /\.(ico|png|jpe?g|gif|svg|webp|css|js|mjs|woff2?|ttf|map|html?)$/i.test(url)
    ) {
      return;
    }
    const payload = { url, status: reply.statusCode, ...(req.query || {}) };
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      for (const key of Object.keys(req.body).slice(0, 8)) {
        payload[key] = req.body[key];
      }
    }
    logAsync(payload, req.ip, reply.statusCode >= 400 ? 'Error' : 'OK');
  });

  fastify.get('/', async (req, reply) => {
    return {
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Fastify API',
      status: 'online',
      version: '3.0.0',
      features: ['2gb-mmap-sqlite', 'ram-resident-catalog', 'lru-search-cache', 'precomputed-chapters', 'sub-millisecond-serving'],
      endpoints: [
        'GET /api/tree',
        'GET /api/books',
        'GET /api/book/:code?chapter=0&buffer=1',
        'GET /api/book/:code/chapter/:chapterIndex',
        'GET /api/book/:code/toc',
        'GET /api/book/:code/xml',
        'GET /api/book/:code/mat',
        'GET /api/book/:code/mat_jump?para=..&chapter=..',
        'GET /api/mat',
        'GET /api/search?q=...',
        'GET /api/health',
        'GET /log?filter=day|week|hour&timezone=Europe/Berlin (live visitor log)',
      ],
    };
  });

// Server Cache Control Toggle: Re-enabled for ultra-low latency sub-millisecond serving
const ENABLE_HTTP_CACHE = true;

function applyCacheHeader(reply, publicHeader = 'public, max-age=86400, stale-while-revalidate=604800') {
  if (ENABLE_HTTP_CACHE) {
    reply.header('Cache-Control', publicHeader);
  } else {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}

  // Navigation tree endpoint (1 Year Immutable Cache + RAM-Resident)
  fastify.get('/api/tree', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    if (precomputedTree) return precomputedTree;

    const treeJsonPath = path.join(__dirname, 'tree.json');
    if (fs.existsSync(treeJsonPath)) {
      try {
        const raw = fs.readFileSync(treeJsonPath, 'utf8');
        precomputedTree = cleanTree(JSON.parse(raw));
        return precomputedTree;
      } catch (err) {
        req.log.warn({ err }, 'Failed to read tree.json from disk');
      }
    }

    try {
      const meta = stmtGetTreeMeta.get();
      if (meta && meta.value) {
        precomputedTree = cleanTree(JSON.parse(meta.value));
        return precomputedTree;
      }
    } catch (err) {}

    reply.code(500);
    return { error: 'Navigation tree not found' };
  });

  // List all 217 books (1 Year Immutable Cache + RAM-Resident)
  fastify.get('/api/books', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    return precomputedBooksList;
  });

  // Get specific book with precomputed chapters and instant buffering support
  fastify.get('/api/book/:code', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    const rawCode = req.params.code;
    let cleanCode = rawCode.replace('.xml', '');
    let resolvedChapFromCode = undefined;

    let cachedMeta = bookMetaCache.get(cleanCode);
    if (!cachedMeta) {
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        resolvedChapFromCode = parseInt(chapSuffixMatch[2], 10);
        cachedMeta = bookMetaCache.get(cleanCode);
      }
    }

    let book, chapters, meta;
    if (cachedMeta) {
      book = cachedMeta.rawBook;
      chapters = cachedMeta.chapters;
      meta = cachedMeta.meta;
      bookMetaCache.delete(cleanCode);
      bookMetaCache.set(cleanCode, cachedMeta);
    } else {
      book = stmtGetBook.get(cleanCode);
      if (!book) {
        reply.code(404);
        return { error: `Book '${cleanCode}' not found` };
      }
      chapters = stmtGetChapters.all(cleanCode);
      meta = {};
      if (book.meta_json) {
        try {
          meta = JSON.parse(book.meta_json);
        } catch (e) {}
      }
      if (bookMetaCache.size > 100) {
        const firstKey = bookMetaCache.keys().next().value;
        bookMetaCache.delete(firstKey);
      }
      bookMetaCache.set(cleanCode, { rawBook: book, chapters, meta });
    }

    let toc = tocCache.get(cleanCode);
    if (toc) {
      tocCache.delete(cleanCode);
      tocCache.set(cleanCode, toc);
    } else {
      toc = stmtGetToc.all(cleanCode);
      if (tocCache.size > 100) {
        const firstKey = tocCache.keys().next().value;
        tocCache.delete(firstKey);
      }
      tocCache.set(cleanCode, toc);
    }

    const isTocOnly = req.query.tocOnly === 'true' || req.query.tocOnly === '1';
    if (isTocOnly) {
      // Lightweight TOC-only response for initial book click — no chapter HTML
      return {
        code: book.code,
        title: book.title,
        nikaya: book.nikaya,
        category: book.category,
        chapter_count: book.chapter_count,
        chapters: chapters,
        toc: toc,
        para_to_chapter: meta.para_to_chapter || {},
        para_to_index: meta.para_to_index || {},
        page_to_chapter: meta.page_to_chapter || {},
        page_to_para: meta.page_to_para || {},
        page_anchors: meta.page_anchors || {},
        para_range: meta.para_range || { min: 1, max: 1, total: 0 },
        edition_ranges: meta.edition_ranges || {},
        book_type: meta.book_type || 'Whole',
        mat: meta.mat || precomputedMatMap.get(cleanCode) || (stmtGetMat ? (stmtGetMat.get(cleanCode) || null) : null),
        sub_books: meta.sub_books || null,
        sub_book: meta.sub_book || null,
        chapter_to_sub_book: meta.chapter_to_sub_book || null,
        sub_books_para_to_chapter: meta.sub_books_para_to_chapter || null,
        attha_start_chapter: meta.attha_start_chapter !== undefined ? meta.attha_start_chapter : null,
        tika_start_chapter: meta.tika_start_chapter !== undefined ? meta.tika_start_chapter : null,
        chapter_to_mat: meta.chapter_to_mat || null,
        para_to_mat: meta.para_to_mat || null,
        sub_books_para_to_mat: meta.sub_books_para_to_mat || null,
        initial_chapter: null,
        chapters_data: {},
        html: '',
        viewMode: 'toc',
      };
    }

    const isFullRequested = req.query.full === 'true';
    const reqChap = req.query.chapter !== undefined
      ? parseInt(req.query.chapter, 10)
      : (resolvedChapFromCode !== undefined ? resolvedChapFromCode : 0);
    const bufferCount = req.query.buffer !== undefined ? parseInt(req.query.buffer, 10) : 1;

    const chaptersData = {};
    const totalChaps = chapters.length;

    if (isFullRequested) {
      const allRows = stmtGetAllChaptersHtml.all(cleanCode);
      for (const r of allRows) {
        chaptersData[r.chapter_index] = r.html;
      }
    } else {
      const startIdx = Math.max(0, reqChap - bufferCount);
      const endIdx = Math.min(totalChaps - 1, reqChap + bufferCount);
      const rangeRows = stmtGetChaptersRangeHtml.all(cleanCode, startIdx, endIdx);
      for (const r of rangeRows) {
        chaptersData[r.chapter_index] = r.html;
      }
    }

    const loadedHtmlArray = Object.keys(chaptersData)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => chaptersData[k]);

    return {
      code: book.code,
      title: book.title,
      nikaya: book.nikaya,
      category: book.category,
      chapter_count: book.chapter_count,
      chapters: chapters,
      toc: toc,
      para_to_chapter: meta.para_to_chapter || {},
      para_to_index: meta.para_to_index || {},
      page_to_chapter: meta.page_to_chapter || {},
      page_to_para: meta.page_to_para || {},
      page_anchors: meta.page_anchors || {},
      para_range: meta.para_range || { min: 1, max: 1, total: 0 },
      edition_ranges: meta.edition_ranges || {},
      mat: meta.mat
        ? {
            ...meta.mat,
            split_targets: meta.split_targets || meta.mat.split_targets || null,
            sub_book: meta.sub_book || meta.mat.sub_book || null,
            sub_books: meta.sub_books || meta.mat.sub_books || null,
            mula_chapter: meta.mula_chapter !== undefined ? meta.mula_chapter : meta.mat.mula_chapter,
            mula_chapter_offset: meta.mula_chapter_offset !== undefined ? meta.mula_chapter_offset : meta.mat.mula_chapter_offset,
            attha_chapter_offset: meta.attha_chapter_offset !== undefined ? meta.attha_chapter_offset : meta.mat.attha_chapter_offset,
          }
        : precomputedMatMap.get(cleanCode) || (stmtGetMat ? (stmtGetMat.get(cleanCode) || null) : null),
      sub_books: meta.sub_books || null,
      sub_book: meta.sub_book || null,
      chapter_to_sub_book: meta.chapter_to_sub_book || null,
      sub_books_para_to_chapter: meta.sub_books_para_to_chapter || null,
      attha_start_chapter: meta.attha_start_chapter !== undefined ? meta.attha_start_chapter : null,
      tika_start_chapter: meta.tika_start_chapter !== undefined ? meta.tika_start_chapter : null,
      chapter_to_mat: meta.chapter_to_mat || null,
      para_to_mat: meta.para_to_mat || null,
      sub_books_para_to_mat: meta.sub_books_para_to_mat || null,
      split_targets: meta.split_targets || null,
      mula_chapter: meta.mula_chapter !== undefined ? meta.mula_chapter : null,
      mula_chapter_offset: meta.mula_chapter_offset !== undefined ? meta.mula_chapter_offset : null,
      attha_chapter_offset: meta.attha_chapter_offset !== undefined ? meta.attha_chapter_offset : null,
      initial_chapter: reqChap,
      chapters_data: chaptersData,
      html: loadedHtmlArray.join('\n'),
    };
  });

  // Get specific chapter HTML instantly from precomputed table (< 0.1ms)
  fastify.get('/api/book/:code/chapter/:chapterIndex', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    let cleanCode = req.params.code.replace('.xml', '');
    const chapIdx = parseInt(req.params.chapterIndex, 10);

    let row = stmtGetChapterHtml.get(cleanCode, chapIdx);
    if (!row) {
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        row = stmtGetChapterHtml.get(cleanCode, chapIdx);
      }
    }

    if (!row || row.html === null || row.html === undefined) {
      reply.code(404);
      return { error: `Chapter ${chapIdx} not found in book '${cleanCode}'` };
    }

    return {
      book_code: cleanCode,
      chapter_index: chapIdx,
      html: row.html,
    };
  });

  // Get hierarchical TOC for a book (In-Memory Cached)
  fastify.get('/api/book/:code/toc', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    const cleanCode = req.params.code.replace('.xml', '');
    let toc = tocCache.get(cleanCode);
    if (toc) {
      tocCache.delete(cleanCode);
      tocCache.set(cleanCode, toc);
    } else {
      toc = stmtGetToc.all(cleanCode);
      if (tocCache.size > 100) {
        const firstKey = tocCache.keys().next().value;
        tocCache.delete(firstKey);
      }
      tocCache.set(cleanCode, toc);
    }
    return {
      book_code: cleanCode,
      total: toc.length,
      toc: toc,
    };
  });

  // Get MAT cross-reference relations for a book (In-Memory Lookup)
  fastify.get('/api/book/:code/mat', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    let cleanCode = req.params.code.replace('.xml', '');

    const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      cleanCode = chapSuffixMatch[1];
    }

    let bookMeta = bookMetaCache.get(cleanCode)?.meta;
    if (!bookMeta) {
      const row = stmtGetBook.get(cleanCode);
      if (row?.meta_json) {
        try { bookMeta = JSON.parse(row.meta_json); } catch (e) {}
      }
    }
    if (bookMeta?.mat) {
      return {
        book_code: cleanCode,
        ...bookMeta.mat,
        split_targets: bookMeta.split_targets || bookMeta.mat.split_targets || null,
        sub_book: bookMeta.sub_book || bookMeta.mat.sub_book || null,
        sub_books: bookMeta.sub_books || bookMeta.mat.sub_books || null,
        mula_chapter: bookMeta.mula_chapter !== undefined ? bookMeta.mula_chapter : bookMeta.mat.mula_chapter,
        mula_chapter_offset: bookMeta.mula_chapter_offset !== undefined ? bookMeta.mula_chapter_offset : bookMeta.mat.mula_chapter_offset,
        attha_chapter_offset: bookMeta.attha_chapter_offset !== undefined ? bookMeta.attha_chapter_offset : bookMeta.mat.attha_chapter_offset,
      };
    }

    const cstMat = cstCatalog[cleanCode]?.mat;
    if (cstMat) {
      return {
        book_code: cleanCode,
        category: cstCatalog[cleanCode]?.matn?.toLowerCase() || '',
        ...cstMat,
      };
    }

    const memoryMat = precomputedMatMap.get(cleanCode);
    if (memoryMat) return memoryMat;

    if (stmtGetMat) {
      const mat = stmtGetMat.get(cleanCode);
      if (mat) return mat;
    }

    reply.code(404);
    return { error: `No MAT relationship found for '${cleanCode}'` };
  });

  // Per-book Pāḷi sentence splits for sentence display mode. Prebuilt from
  // epitaka.db segmentation (build_pali_sentences_db.py); line numbers align
  // with translation line_ids by construction. Static export precomputes the
  // same payload as pali_sentences.json.
  const paliSentencesCache = new Map();
  fastify.get('/api/book/:code/pali_sentences', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    let cleanCode = req.params.code.replace('.xml', '');
    const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      cleanCode = chapSuffixMatch[1];
    }
    if (paliSentencesCache.has(cleanCode)) return paliSentencesCache.get(cleanCode);
    if (!getPaliSentencesDb()) {
      reply.code(500);
      return { error: 'Pali sentences unavailable' };
    }
    try {
      const chapters = {};
      const rows = stmtGetPaliSentencesDb.all(cleanCode);
      for (const r of rows) {
        const ch = String(r.chapter_index);
        if (!chapters[ch]) chapters[ch] = {};
        const key = String(r.para_index);
        if (!chapters[ch][key]) chapters[ch][key] = [];
        chapters[ch][key].push({ line: r.line_id, text: r.sentence });
      }
      const payload = { book_code: cleanCode, chapters };
      if (paliSentencesCache.size > 217) paliSentencesCache.clear();
      paliSentencesCache.set(cleanCode, payload);
      return payload;
    } catch (err) {
      reply.code(404);
      return { error: `No Pali sentences found for '${cleanCode}'` };
    }
  });

  // Precomputed Canon-wide MAT Jump Resolver (immutable per DB build: cacheable)
  fastify.get('/api/book/:code/mat_jump', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    let cleanCode = req.params.code.replace('.xml', '');
    const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      cleanCode = chapSuffixMatch[1];
    }

    const pStr = req.query.para ? String(req.query.para).replace(/^(?:para-?|p)/i, '').trim() : null;
    let baseP = pStr;
    if (baseP && baseP.includes('-')) {
      baseP = baseP.split('-')[0].trim();
    }
    const cIdx = req.query.chapter !== undefined && req.query.chapter !== null ? parseInt(req.query.chapter, 10) : null;

    const catEntry = cstCatalog[cleanCode] || {};
    let subKey = catEntry.sub_book || null;
    if (!subKey && catEntry.chapter_to_sub_book && cIdx !== null) {
      subKey = catEntry.chapter_to_sub_book[cIdx] || catEntry.chapter_to_sub_book[String(cIdx)];
    }
    if (!subKey && catEntry.sub_books && cIdx !== null) {
      for (const [k, v] of Object.entries(catEntry.sub_books)) {
        const cr = v.chapter_range || v.tika_chapter_range;
        if (cr && cIdx >= cr[0] && cIdx <= cr[1]) {
          subKey = k;
          break;
        }
      }
    }

    let matchQuality = 'exact';
    let matchedSourcePara = pStr;

    // Canon-wide Ground-Truth GUID Paragraph Map lookup (return deferred to the
    // decision below: a fine canon answer (exact/span/closest-para) wins outright,
    // but a coarse 'section' pointer must NOT shadow a real para-level mat link —
    // e.g. s0201m.mul ch0 para 9 has no Attha, and must resolve to closest Attha
    // para 8, not to the canon section anchor (s0201a.att ch0 para 1).
    let canonRow = null;
    if (pStr && cIdx !== null && !isNaN(cIdx) && stmtGetCanonPara) {
      const pNum = parseInt(baseP, 10);
      const queryNum = isNaN(pNum) ? -1 : pNum;
      canonRow = stmtGetCanonPara.get(cleanCode, cIdx, pStr, queryNum, queryNum);
      if (!canonRow && queryNum > 0 && stmtGetClosestCanonPara) {
        canonRow = stmtGetClosestCanonPara.get(cleanCode, cIdx, queryNum);
        if (canonRow) {
          matchQuality = 'closest';
          matchedSourcePara = canonRow.para_num;
        }
      }
    }
    // Snapshot the canon verdict now: the mat lookups below reuse matchQuality /
    // matchedSourcePara for their own outcomes.
    const canonFine = !!canonRow && (canonRow.match_quality === 'exact' || canonRow.match_quality === 'span' || matchQuality === 'closest');
    const canonQualityOut = matchQuality !== 'exact' ? matchQuality : canonRow?.match_quality;
    const canonMatchedOut = matchedSourcePara;
    const canonResponse = () => ({
      source_book: cleanCode,
      source_chapter: cIdx,
      source_para: pStr,
      source_guid: canonRow.guid,
      match_quality: canonQualityOut,
      matched_source_para: canonMatchedOut,
      mula: canonRow.mula_book ? {
        book: canonRow.mula_book,
        chapter: canonRow.mula_chapter,
        para: canonRow.mula_para,
        guid: canonRow.mula_guid,
        title: cstCatalog[canonRow.mula_book]?.title || null,
      } : null,
      attha: canonRow.attha_book ? {
        book: canonRow.attha_book,
        chapter: canonRow.attha_chapter,
        para: canonRow.attha_para,
        guid: canonRow.attha_guid,
        title: cstCatalog[canonRow.attha_book]?.title || null,
      } : null,
      tika: canonRow.tika_book ? {
        book: canonRow.tika_book,
        chapter: canonRow.tika_chapter,
        para: canonRow.tika_para,
        guid: canonRow.tika_guid,
        title: cstCatalog[canonRow.tika_book]?.title || null,
      } : null,
    });
    if (canonFine) {
      return canonResponse();
    }

    let paraRow = null;
    if (pStr && cIdx !== null && !isNaN(cIdx) && stmtGetMatParaChap) {
      paraRow = stmtGetMatParaChap.get(cleanCode, cIdx, pStr) || (baseP !== pStr ? stmtGetMatParaChap.get(cleanCode, cIdx, baseP) : null);
    }
    if (!paraRow && pStr && subKey && stmtGetMatParaSub) {
      paraRow = stmtGetMatParaSub.get(cleanCode, subKey, pStr) || (baseP !== pStr ? stmtGetMatParaSub.get(cleanCode, subKey, baseP) : null);
    }
    if (!paraRow && pStr && !subKey && stmtGetMatPara) {
      paraRow = stmtGetMatPara.get(cleanCode, pStr) || (baseP !== pStr ? stmtGetMatPara.get(cleanCode, baseP) : null);
    }
    if (!paraRow && pStr && cIdx !== null && !isNaN(cIdx) && stmtGetClosestMatParaChap) {
      const pNum = parseInt(baseP, 10);
      if (!isNaN(pNum) && pNum > 0) {
        paraRow = stmtGetClosestMatParaChap.get(cleanCode, cIdx, pNum);
        if (paraRow) {
          matchQuality = 'closest';
          matchedSourcePara = paraRow.source_para;
        }
      }
    }
    // Neighbor fill (same rule as the static edge path in services/api.js fetchMatJump):
    // an exact row may name book/chapter with a null para for a layer (e.g. s0201m.mul
    // ch0 para 9 -> attha para null). Borrow chapter+para from the closest same-chapter
    // row that has one, so clients can offer closest-para jumps instead of chapter-only.
    if (paraRow && cIdx !== null && !isNaN(cIdx) && stmtGetMatParaSibs) {
      try {
        const selfNum = parseInt(String(baseP).split('-')[0], 10);
        if (!isNaN(selfNum)) {
          const sibs = stmtGetMatParaSibs.all(cleanCode, cIdx);
          for (const layer of ['mula', 'attha', 'tika']) {
            const bKey = `${layer}_book`;
            const pKey = `${layer}_para`;
            if (!paraRow[bKey] || (paraRow[pKey] !== null && paraRow[pKey] !== undefined)) continue;
            let best = null;
            let bestDiff = Infinity;
            let bestNum = Infinity;
            for (const r of sibs) {
              if (r[bKey] !== paraRow[bKey]) continue;
              const rp = r[pKey];
              if (rp === null || rp === undefined) continue;
              const rn = parseInt(String(r.source_para).split('-')[0], 10);
              if (isNaN(rn)) continue;
              const diff = Math.abs(rn - selfNum);
              if (diff < bestDiff || (diff === bestDiff && rn < bestNum)) {
                best = r;
                bestDiff = diff;
                bestNum = rn;
              }
            }
            if (best) {
              paraRow[`${layer}_chapter`] = best[`${layer}_chapter`];
              paraRow[`${layer}_para`] = best[`${layer}_para`];
              if (!paraRow[`${layer}_title`]) paraRow[`${layer}_title`] = best[`${layer}_title`];
            }
          }
        }
      } catch (e) {}
    }
    // A coarse canon section pointer is still more actionable than a bare chapter
    // fallback — but only when mat offers no real para link at all.
    const matHasPara = !!paraRow && ['mula', 'attha', 'tika'].some(
      (l) => paraRow[`${l}_book`] && paraRow[`${l}_para`] !== null && paraRow[`${l}_para`] !== undefined
    );
    if (!matHasPara && canonRow) {
      return canonResponse();
    }
    let chapRow = null;
    if (cIdx !== null && !isNaN(cIdx) && stmtGetMatChapter) {
      chapRow = stmtGetMatChapter.get(cleanCode, cIdx);
    }
    if (!paraRow && chapRow) {
      matchQuality = 'chapter';
    }

    const formatLayer = (prefix, pRow, cRow) => {
      const book = pRow?.[`${prefix}_book`] || cRow?.[`${prefix}_book`];
      if (!book) return null;
      return {
        book,
        chapter: pRow?.[`${prefix}_chapter`] !== undefined && pRow?.[`${prefix}_chapter`] !== null
          ? pRow[`${prefix}_chapter`]
          : (cRow?.[`${prefix}_chapter`] ?? 0),
        para: pRow?.[`${prefix}_para`] || null,
        title: pRow?.[`${prefix}_title`] || cRow?.[`${prefix}_title`] || null,
      };
    };

    return {
      source_book: cleanCode,
      source_chapter: cIdx,
      source_para: pStr,
      match_quality: matchQuality,
      matched_source_para: matchedSourcePara,
      mula: formatLayer('mula', paraRow, chapRow),
      attha: formatLayer('attha', paraRow, chapRow),
      tika: formatLayer('tika', paraRow, chapRow),
    };
  });

  // Get single paragraph by canonical GUID (ideal for LLMs & translations)
  fastify.get('/api/paragraph/:guid', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, s-maxage=604800');
    const guid = req.params.guid;
    if (!stmtGetCanonByGuid) {
      reply.code(500);
      return { error: 'Database not initialized' };
    }
    const row = stmtGetCanonByGuid.get(guid);
    if (!row) {
      reply.code(404);
      return { error: `Paragraph not found: ${guid}` };
    }
    return row;
  });

  // Batch query paragraphs for LLM translation chunks
  fastify.get('/api/paragraphs', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=3600');
    const book = req.query.book;
    const chapter = req.query.chapter !== undefined ? parseInt(req.query.chapter, 10) : null;
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    let rows;
    if (book && chapter !== null) {
      rows = db.prepare('SELECT global_id, guid, book_code, sub_book, chapter_index, chapter_title, sutta_title, para_index, para_num, rend, pali_text, word_count, mula_guid, attha_guid, tika_guid FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? ORDER BY para_index LIMIT ? OFFSET ?').all(book, chapter, limit, offset);
    } else if (book) {
      rows = db.prepare('SELECT global_id, guid, book_code, sub_book, chapter_index, chapter_title, sutta_title, para_index, para_num, rend, pali_text, word_count, mula_guid, attha_guid, tika_guid FROM canon_paragraphs WHERE book_code = ? ORDER BY para_index LIMIT ? OFFSET ?').all(book, limit, offset);
    } else {
      rows = db.prepare('SELECT global_id, guid, book_code, sub_book, chapter_index, chapter_title, sutta_title, para_index, para_num, rend, pali_text, word_count, mula_guid, attha_guid, tika_guid FROM canon_paragraphs ORDER BY global_id LIMIT ? OFFSET ?').all(limit, offset);
    }
    return { count: rows.length, paragraphs: rows };
  });

  // Get full MAT matrix for all books (RAM-Resident)
  fastify.get('/api/mat', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    return precomputedMatList;
  });

  // ==========================================
  // Translation API Endpoints
  // ==========================================

  // List available translation languages and metadata
  fastify.get('/api/translations', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=3600, stale-while-revalidate=86400');
    return {
      available: translationEngine.getAvailableLanguages(),
    };
  });

  // Fetch translations for a book & chapter across one or more languages
  fastify.get('/api/book/:code/translation', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    const rawCode = req.params.code;
    const chapParam = req.query.chapter !== undefined ? req.query.chapter : (req.query.chapterIndex !== undefined ? req.query.chapterIndex : 0);
    const langsParam = req.query.lang || req.query.langs || 'en';
    const isDetailed = req.query.detailed === 'true' || req.query.detailed === '1';
    const withSentences = req.query.sentences === 'true' || req.query.sentences === '1';

    let requestedLangs = [];
    if (langsParam === 'all') {
      requestedLangs = translationEngine.getAvailableLanguages().map((l) => l.code);
    } else {
      requestedLangs = langsParam.split(',').map((s) => s.trim()).filter(Boolean);
    }

    if (isDetailed) {
      return translationEngine.getChapterTranslationsDetailed(rawCode, chapParam, requestedLangs);
    }
    return translationEngine.getChapterTranslations(rawCode, chapParam, requestedLangs, withSentences);
  });

  // Chapter-in-path translation convenience alias
  fastify.get('/api/book/:code/chapter/:chapterIndex/translation', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    const rawCode = req.params.code;
    const chapParam = req.params.chapterIndex;
    const langsParam = req.query.lang || req.query.langs || 'en';
    const isDetailed = req.query.detailed === 'true' || req.query.detailed === '1';
    const withSentences = req.query.sentences === 'true' || req.query.sentences === '1';

    let requestedLangs = [];
    if (langsParam === 'all') {
      requestedLangs = translationEngine.getAvailableLanguages().map((l) => l.code);
    } else {
      requestedLangs = langsParam.split(',').map((s) => s.trim()).filter(Boolean);
    }

    if (isDetailed) {
      return translationEngine.getChapterTranslationsDetailed(rawCode, chapParam, requestedLangs);
    }
    return translationEngine.getChapterTranslations(rawCode, chapParam, requestedLangs, withSentences);
  });

  // Lookup translation by canonical GUID across languages
  fastify.get('/api/translation/guid/:guid', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    const guid = req.params.guid;
    const langsParam = req.query.lang || req.query.langs || 'all';
    let requestedLangs = [];
    if (langsParam === 'all') {
      requestedLangs = translationEngine.getAvailableLanguages().map((l) => l.code);
    } else {
      requestedLangs = langsParam.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return translationEngine.getGuidTranslation(guid, requestedLangs);
  });

// Helper to detect prefix/contains substring search (indicated by leading *)
function checkIsContainsSearch(cleanText) {
  if (!cleanText) return false;
  return /(?:^|\s)\*(\S+)/.test(cleanText);
}

// Helper to extract clean terms for contains substring search
function extractContainsTerms(cleanText) {
  if (!cleanText) return [];
  return cleanText
    .split(/\s+/)
    .map((t) => t.replace(/^\*+/, '').replace(/\*+$/, '').trim())
    .filter((t) => t.length > 0);
}

// Helper to highlight matched terms in content for contains search and format snippet
function highlightContainsSearch(content, terms, snippetLen = 200) {
  if (!content || !terms || terms.length === 0) return content || '';
  const escapedTerms = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let firstIdx = -1;
  let firstTermLen = 0;
  for (const term of escapedTerms) {
    const regex = new RegExp(term, 'gi');
    const match = regex.exec(content);
    if (match && (firstIdx === -1 || match.index < firstIdx)) {
      firstIdx = match.index;
      firstTermLen = match[0].length;
    }
  }

  if (firstIdx < 0) return content.length > snippetLen ? content.slice(0, snippetLen) + '...' : content;

  const halfLen = Math.max(Math.floor(snippetLen / 2), 20);
  let start = Math.max(0, firstIdx - halfLen);
  let end = Math.min(content.length, firstIdx + firstTermLen + halfLen);

  let result = content.substring(start, end);
  if (start > 0) result = '... ' + result;
  if (end < content.length) result = result + ' ...';

  const sortedTerms = [...escapedTerms].sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    const regex = new RegExp(`(${term})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }

  return result;
}

// Helper to build FTS5 match query supporting single words, exact phrases, proximity (NEAR), and multi-word AND
function buildFts5Query(cleanText, distance = 'any') {
  if (!cleanText) return '';
  const tokens = String(cleanText)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M}\u200C\u200D\s*]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return '';

  // Single word: e.g. "dhamma"* or "dhamma"
  if (tokens.length === 1) {
    const tok = tokens[0];
    const cleanTok = tok.replace(/\*/g, '');
    return tok.endsWith('*') ? `"${tok.slice(0, -1)}"*` : `"${cleanTok}"*`;
  }

  // Exact phrase: distance = 1
  if (distance === 1 || distance === '1' || distance === 'exact') {
    const phrase = tokens.map((t) => t.replace(/\*/g, '')).join(' ');
    return `"${phrase}"`;
  }

  // Word proximity: distance = 2, 3, 5, 8, 10
  const distNum = parseInt(distance, 10);
  if (!isNaN(distNum) && distNum >= 2 && distNum <= 50) {
    const terms = tokens.map((t) => {
      const rawT = t.replace(/\*/g, '');
      return `"${rawT}"*`;
    }).join(' ');
    return `NEAR(${terms}, ${distNum})`;
  }

  // Default: ANY distance (AND across paragraph)
  return tokens
    .map((t) => (t.endsWith('*') ? `"${t.slice(0, -1)}"*` : `"${t.replace(/\*/g, '')}"*`))
    .join(' AND ');
}

// Helper to construct dynamic SQL WHERE & ORDER BY for full-text search
function buildSearchSql({ ftsQuery, isContains = false, containsTerms = [], mat, pitaka, book, sort }) {
  const whereClauses = [];
  const params = [];

  if (isContains) {
    for (const term of containsTerms) {
      const lower = term.toLowerCase();
      const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
      if (lower !== cap) {
        whereClauses.push("(content LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')");
        params.push(lower, cap);
      } else {
        whereClauses.push("content LIKE '%' || ? || '%'");
        params.push(lower);
      }
    }
  } else {
    whereClauses.push('paragraphs_fts MATCH ?');
    params.push(ftsQuery);
  }

  // 1. Specific Book Filter
  if (book && book !== 'all') {
    const cleanBook = book.replace('.xml', '');
    whereClauses.push('book_code = ?');
    params.push(cleanBook);
  }

  // 2. MAT Filter: Mūla, Aṭṭhakathā, Ṭīkā, Añña
  if (mat && mat !== 'all') {
    const matList = mat
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const matConditions = [];
    for (const m of matList) {
      if (m === 'mula' || m === 'm' || m === 'mul') {
        matConditions.push("book_code LIKE '%.mul%'");
      } else if (m === 'attha' || m === 'a' || m === 'att') {
        matConditions.push("book_code LIKE '%.att%'");
      } else if (m === 'tika' || m === 't' || m === 'tik') {
        matConditions.push("book_code LIKE '%.tik%'");
      } else if (m === 'anna' || m === 'anya' || m === 'e') {
        matConditions.push("(book_code NOT LIKE '%.mul%' AND book_code NOT LIKE '%.att%' AND book_code NOT LIKE '%.tik%')");
      }
    }
    if (matConditions.length > 0) {
      whereClauses.push(`(${matConditions.join(' OR ')})`);
    }
  }

  // 3. Piṭaka / Nikāya Filter
  if (pitaka && pitaka !== 'all') {
    const pitList = pitaka
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const pitConditions = [];
    for (const p of pitList) {
      if (p === 'vinaya' || p === 'vi' || p === 'vin') {
        pitConditions.push("(book_code LIKE 'vin%' OR book_code LIKE 'vi%' OR book_code LIKE 'v0%')");
      } else if (p === 'sutta' || p === 'su' || p === 's') {
        pitConditions.push("(book_code LIKE 's0%' OR book_code LIKE 's1%' OR book_code LIKE 's2%')");
      } else if (p === 'digha' || p === 's01') {
        pitConditions.push("book_code LIKE 's01%'");
      } else if (p === 'majjhima' || p === 's02') {
        pitConditions.push("book_code LIKE 's02%'");
      } else if (p === 'samyutta' || p === 's03') {
        pitConditions.push("book_code LIKE 's03%'");
      } else if (p === 'anguttara' || p === 's04') {
        pitConditions.push("book_code LIKE 's04%'");
      } else if (p === 'khuddaka' || p === 's05') {
        pitConditions.push("book_code LIKE 's05%'");
      } else if (p === 'abhidhamma' || p === 'abh' || p === 'ab') {
        pitConditions.push("book_code LIKE 'abh%'");
      } else if (p === 'anna' || p === 'anya' || p === 'e') {
        pitConditions.push("book_code LIKE 'e%'");
      }
    }
    if (pitConditions.length > 0) {
      whereClauses.push(`(${pitConditions.join(' OR ')})`);
    }
  }

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

  // 4. Sorting logic (Default: Piṭaka canonical order)
  let orderSql = `
    ORDER BY 
      CASE 
        WHEN book_code LIKE '%.mul%' THEN 1
        WHEN book_code LIKE '%.att%' THEN 2
        WHEN book_code LIKE '%.tik%' THEN 3
        ELSE 4
      END ASC,
      CASE 
        WHEN book_code LIKE 'vin%' OR book_code LIKE 'vi%' OR book_code LIKE 'v0%' THEN 1
        WHEN book_code LIKE 's01%' THEN 2
        WHEN book_code LIKE 's02%' THEN 3
        WHEN book_code LIKE 's03%' THEN 4
        WHEN book_code LIKE 's04%' THEN 5
        WHEN book_code LIKE 's05%' THEN 6
        WHEN book_code LIKE 'abh%' THEN 7
        WHEN book_code LIKE 'e%'   THEN 8
        ELSE 9
      END ASC,
      book_code ASC,
      para_index ASC,
      rowid ASC
  `;

  if (!isContains) {
    if (sort === 'relevance' || sort === 'rank') {
      orderSql = 'ORDER BY rank ASC';
    } else if (sort === 'bm25') {
      orderSql = 'ORDER BY bm25(paragraphs_fts) ASC';
    }
  }

  const countSql = `SELECT count(*) as total FROM paragraphs_fts ${whereSql}`;
  const querySql = isContains
    ? `
      SELECT 
        rowid,
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index,
        para_rend,
        content
      FROM paragraphs_fts 
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `
    : `
      SELECT 
        rowid,
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index,
        para_rend,
        snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) as snippet
      FROM paragraphs_fts 
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

  return { countSql, querySql, params };
}

  // List available FTS search databases (Pāḷi + translation languages)
  fastify.get('/api/search/databases', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=3600, stale-while-revalidate=86400');
    const databases = [
      {
        id: 'fts_tipitaka.db',
        key: 'pali',
        name: 'Pāḷi CST',
        native_name: 'Pāḷi CST',
        flag: '☸️',
        is_pali: true,
      },
    ];

    const transLangs = translationEngine.getAvailableLanguages();
    for (const t of transLangs) {
      const filename = `fts_translation_${t.code}.db`;
      const ftsPath = resolveDbPath(filename);
      if (ftsPath && fs.existsSync(ftsPath)) {
        databases.push({
          id: filename,
          key: t.code,
          name: t.name,
          native_name: t.native_name,
          flag: t.flag,
          total_paragraphs: t.total_paragraphs,
          is_pali: false,
        });
      }
    }
    return { databases };
  });

  // Full-Text Search across 520,000+ paragraphs with In-Memory LRU Caching
  fastify.get('/api/search', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    const rawQuery = String(req.query.q || req.query.query || '').trim().normalize('NFC');
    const dbParam = req.query.l || req.query.db || req.query.lang || 'pali';
    const target = getSearchDatabase(dbParam);
    const isPali = target.isPali;
    const targetKey = target.key;
    const targetDbName = target.dbName;
    const searchDb = target.db;

    const bookFilter = req.query.book || null;
    const matFilter = req.query.mat || 'all';
    const pitakaFilter = req.query.pitaka || req.query.nikaya || 'all';
    const distanceVal = req.query.distance || req.query.dist || 'any';
    const sortVal = req.query.sort || 'pitaka';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    if (!rawQuery || rawQuery.length < 1) {
      return { total: 0, count: 0, db: targetDbName, lang: targetKey, is_translation: !isPali, results: [] };
    }

    // Transliterate 17 Pāḷi scripts & Velthuis typing for Pāḷi searches (all normalized to NFC)
    const cleanQuery = isPali
      ? convertAnyToRoman(rawQuery).trim().normalize('NFC')
      : rawQuery;

    const isContains = checkIsContainsSearch(cleanQuery);
    const containsTerms = isContains ? extractContainsTerms(cleanQuery) : [];

    if (isContains && containsTerms.length === 0) {
      return { total: 0, count: 0, db: targetDbName, lang: targetKey, is_translation: !isPali, results: [] };
    }

    // Construct FTS5 match query if standard search
    const ftsMatch = !isContains ? buildFts5Query(cleanQuery, distanceVal) : null;
    if (!isContains && !ftsMatch) {
      return { total: 0, count: 0, db: targetDbName, lang: targetKey, is_translation: !isPali, results: [] };
    }

    // In-Memory Search Cache Lookup (< 0.05ms)
    const cacheKey = isContains
      ? `contains::${targetDbName}::${containsTerms.join('+')}::${matFilter}::${pitakaFilter}::${bookFilter || 'all'}::${sortVal}::${limit}::${offset}`
      : `fts::${targetDbName}::${ftsMatch}::${matFilter}::${pitakaFilter}::${bookFilter || 'all'}::${sortVal}::${distanceVal}::${limit}::${offset}`;

    const cachedEntry = searchCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < SEARCH_CACHE_TTL) {
      searchHits++;
      searchCache.delete(cacheKey);
      searchCache.set(cacheKey, cachedEntry);
      return cachedEntry.data;
    }
    searchMisses++;

    try {
      const { countSql, querySql, params } = buildSearchSql({
        ftsQuery: ftsMatch,
        isContains,
        containsTerms,
        mat: matFilter,
        pitaka: pitakaFilter,
        book: bookFilter,
        sort: sortVal,
      });

      const countRow = searchDb.prepare(countSql).get(...params);
      const total = countRow ? countRow.total : 0;

      const rows = searchDb.prepare(querySql).all(...params, limit, offset);

      if (isContains) {
        for (const row of rows) {
          row.snippet = highlightContainsSearch(row.content, containsTerms, 200);
          delete row.content;
        }
      }

      if (!isPali) {
        for (const row of rows) {
          row.is_translation = true;
          row.lang = targetKey;
          row.db = targetDbName;
        }
      }

      const responseData = {
        query: cleanQuery,
        ftsQuery: isContains ? `*${containsTerms.join(' ')}` : ftsMatch,
        is_contains: isContains,
        db: targetDbName,
        lang: targetKey,
        is_translation: !isPali,
        total: total,
        count: rows.length,
        offset: offset,
        limit: limit,
        mat: matFilter,
        pitaka: pitakaFilter,
        distance: distanceVal,
        sort: sortVal,
        results: rows,
      };

      // Store in LRU Cache
      if (searchCache.size >= SEARCH_CACHE_MAX) {
        const firstKey = searchCache.keys().next().value;
        searchCache.delete(firstKey);
      }
      searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

      return responseData;
    } catch (err) {
      req.log.error({ err }, 'Search query failed');
      return {
        query: cleanQuery,
        db: targetDbName,
        lang: targetKey,
        is_translation: !isPali,
        total: 0,
        count: 0,
        error: err.message,
        results: [],
      };
    }
  });

  // ==========================================
  // Dictionary API Endpoints
  // ==========================================
  const dictEngine = require('./dictEngine');

  fastify.get('/api/dict/lookup', async (req, reply) => {
    const rawWord = req.query.w || req.query.word || req.query.q || '';
    const dictType = (req.query.dict || req.query.dictionary || 'all').toLowerCase();
    const useSplitter = req.query.d === 'yes';

    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');

    if (!rawWord.trim()) {
      return { word: '', hasResults: false, error: 'Empty word query' };
    }

    if (dictType === 'all') {
      return dictEngine.lookupAll(rawWord);
    } else if (dictType === 'dpd') {
      return dictEngine.lookupDPDFast(rawWord, useSplitter);
    } else if (dictType === 'others' || dictType === 'rest') {
      return dictEngine.lookupOthers(rawWord);
    } else if (dictType === 'pts') {
      return { word: rawWord, results: dictEngine.lookupPTS(rawWord) };
    } else if (dictType === 'abd') {
      return { word: rawWord, results: dictEngine.lookupABD(rawWord) };
    } else if (dictType === 'psd') {
      return { word: rawWord, results: dictEngine.lookupPSD(rawWord) };
    } else if (dictType === 'sans') {
      return { word: rawWord, results: dictEngine.lookupSANS(rawWord) };
    } else if (dictType === 'splitter') {
      return { word: rawWord, results: dictEngine.lookupSplitter(rawWord) };
    } else {
      return dictEngine.lookupAll(rawWord);
    }
  });

  fastify.post('/api/dict/lookup', async (req, reply) => {
    const body = req.body || {};
    const rawWord = body.w || body.word || body.q || '';
    const dictType = (body.dict || body.dictionary || 'all').toLowerCase();
    const useSplitter = body.d === 'yes';

    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');

    if (!rawWord.trim()) {
      return { word: '', hasResults: false, error: 'Empty word query' };
    }

    if (dictType === 'all') {
      return dictEngine.lookupAll(rawWord);
    } else if (dictType === 'dpd') {
      return dictEngine.lookupDPDFast(rawWord, useSplitter);
    } else if (dictType === 'others' || dictType === 'rest') {
      return dictEngine.lookupOthers(rawWord);
    } else if (dictType === 'pts') {
      return { word: rawWord, results: dictEngine.lookupPTS(rawWord) };
    } else if (dictType === 'abd') {
      return { word: rawWord, results: dictEngine.lookupABD(rawWord) };
    } else if (dictType === 'psd') {
      return { word: rawWord, results: dictEngine.lookupPSD(rawWord) };
    } else if (dictType === 'sans') {
      return { word: rawWord, results: dictEngine.lookupSANS(rawWord) };
    } else if (dictType === 'splitter') {
      return { word: rawWord, results: dictEngine.lookupSplitter(rawWord) };
    } else {
      return dictEngine.lookupAll(rawWord);
    }
  });

  fastify.get('/api/dict/inf', async (req, reply) => {
    const query = req.query.w || req.query.id || req.query.word || '';
    applyCacheHeader(reply, 'public, max-age=604800');
    if (!query) return { error: 'Empty inflection query' };
    const res = dictEngine.lookupINF(query);
    if (!res) return { word: query, html: '' };
    return res;
  });

  fastify.post('/api/dict/inf', async (req, reply) => {
    const body = req.body || {};
    const query = body.w || body.id || body.word || '';
    applyCacheHeader(reply, 'public, max-age=604800');
    if (!query) return { error: 'Empty inflection query' };
    const res = dictEngine.lookupINF(query);
    if (!res) return { word: query, html: '' };
    return res;
  });

  // Legacy fastify endpoints for compatibility with external references
  fastify.post('/api/dpd', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupDPD(word, req.body?.d === 'yes');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res.map((r) => r.html).join('\n\n');
  });

  fastify.post('/api/pts', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupPTS(word);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res.map((r) => r.html).join('\n\n');
  });

  fastify.post('/api/abd', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupABD(word);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res.map((r) => r.html).join('\n\n');
  });

  fastify.post('/api/psd', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupPSD(word);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res.map((r) => r.html).join('\n\n');
  });

  fastify.post('/api/sans', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupSANS(word);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res.map((r) => r.html).join('\n\n');
  });

  fastify.post('/api/inf', async (req, reply) => {
    const word = req.body?.w || req.query?.w || '';
    const res = dictEngine.lookupINF(word);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return res ? res.html : '';
  });

  // Initialize Ani (AI Nissaya) Controller & Register Endpoints
  initAiController({ db, dbFts, resolveDbPath });
  registerAiRoutes(fastify);

  // Health and metrics endpoint
  fastify.get('/api/health', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'healthy',
      version: '3.0.0',
      mode: 'precomputed-cache-standard-sqlite',
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      cache_metrics: {
        books_in_ram: precomputedBooksList.total,
        warmed_books_metadata: bookMetaCache.size,
        cached_tocs: tocCache.size,
        search_cache_entries: searchCache.size,
        search_cache_hits: searchHits,
        search_cache_misses: searchMisses,
        search_hit_rate: searchHits + searchMisses > 0 ? `${((searchHits / (searchHits + searchMisses)) * 100).toFixed(1)}%` : '0%',
      },
      memory: {
        rss_mb: Math.round(memory.rss / (1024 * 1024)),
        heap_used_mb: Math.round(memory.heapUsed / (1024 * 1024)),
        heap_total_mb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    };
  });

  const gracefulShutdown = async () => {
    try {
      await fastify.close();
      if (db && typeof db.close === 'function') db.close();
      if (dbFts && dbFts !== db && typeof dbFts.close === 'function') dbFts.close();
      if (dictEngine && typeof dictEngine.closeDatabases === 'function') {
        dictEngine.closeDatabases();
      }
      closeLogDb();
      closeReaderSubmissionsDb();
    } catch (e) {}
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
  process.on('message', (msg) => {
    if (msg && msg.type === 'shutdown') gracefulShutdown();
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[Fastify] Ultra-optimized Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
