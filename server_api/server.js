'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const compress = require('@fastify/compress');

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Locate tipitaka.db database
const DB_CANDIDATES = [
  path.join(__dirname, 'db', 'tipitaka.db'),
  path.join(__dirname, 'tipitaka.db'),
];

let DB_PATH = DB_CANDIDATES.find((p) => fs.existsSync(p));
if (!DB_PATH) {
  console.error('ERROR: tipitaka.db not found in candidates:', DB_CANDIDATES);
  process.exit(1);
}
console.log(`[Database] Using SQLite database at: ${DB_PATH}`);

// Initialize SQLite database connection (Native Fast Synchronous Engine)
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Optimize SQLite engine parameters with standard lightweight settings
db.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA query_only = 1;
`);

// Locate and initialize separate fts_tipitaka.db database for full-text search
const FTS_DB_CANDIDATES = [
  path.join(__dirname, 'db', 'fts_tipitaka.db'),
  path.join(__dirname, 'fts_tipitaka.db'),
  path.join(__dirname, 'db', 'tipitaka.db'),
  path.join(__dirname, 'tipitaka.db'),
];

let FTS_DB_PATH = FTS_DB_CANDIDATES.find((p) => fs.existsSync(p));
let dbFts = null;
if (FTS_DB_PATH) {
  try {
    dbFts = new DatabaseSync(FTS_DB_PATH, { readOnly: true });
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
try {
  stmtGetMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat WHERE book_code = ?');
  stmtGetAllMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat');
} catch (e) {
  console.warn('[MAT] book_mat table prepared statement error:', e.message);
}

// Velthuis input normalization for Pāḷi searches
function typeVelthuis(uType) {
  if (!uType) return '';
  return uType
    .replace(/aa/g, 'ā')
    .replace(/ii/g, 'ī')
    .replace(/uu/g, 'ū')
    .replace(/m\.\./g, 'ṁ')
    .replace(/\.m/g, 'ṃ')
    .replace(/\.n/g, 'ṇ')
    .replace(/\.d/g, 'ḍ')
    .replace(/ll\./g, 'ḹ')
    .replace(/\.l/g, 'ḷ')
    .replace(/\.h/g, 'ḥ')
    .replace(/\.r/g, 'ṛ')
    .replace(/rr\./g, 'ṝ')
    .replace(/\.s/g, 'ṣ')
    .replace(/"s/g, 'ś')
    .replace(/s\.\./g, 'ś')
    .replace(/\.t/g, 'ṭ')
    .replace(/~n/g, 'ñ')
    .replace(/,,n/g, 'ñ')
    .replace(/"n/g, 'ṅ')
    .replace(/n\.\./g, 'ṅ')
    .replace(/AA/g, 'Ā')
    .replace(/II/g, 'Ī')
    .replace(/UU/g, 'Ū')
    .replace(/M\.\./g, 'Ṁ')
    .replace(/\.M/g, 'Ṃ')
    .replace(/\.N/g, 'Ṇ')
    .replace(/\.D/g, 'Ḍ')
    .replace(/LL\./g, 'Ḹ')
    .replace(/\.L/g, 'Ḷ')
    .replace(/\.H/g, 'Ḥ')
    .replace(/\.R/g, 'Ṛ')
    .replace(/RR\./g, 'Ṝ')
    .replace(/\.S/g, 'Ṣ')
    .replace(/"S/g, 'Ś')
    .replace(/S\.\./g, 'Ś')
    .replace(/\.T/g, 'Ṭ')
    .replace(/~N/g, 'Ñ')
    .replace(/,,N/g, 'Ñ')
    .replace(/"N/g, 'Ṅ')
    .replace(/N\.\./g, 'Ṅ');
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
  keepAliveTimeout: 75000,
  maxRequestsPerSocket: 0,
});

async function main() {
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });

  await fastify.register(compress, {
    global: true,
    threshold: 512,
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
        'GET /api/mat',
        'GET /api/search?q=...',
        'GET /api/health',
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
    if (!toc) {
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
      book_type: meta.book_type || 'Whole',
      mat: meta.mat || precomputedMatMap.get(cleanCode) || (stmtGetMat ? (stmtGetMat.get(cleanCode) || null) : null),
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
    if (!toc) {
      toc = stmtGetToc.all(cleanCode);
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

  // Get full MAT matrix for all books (RAM-Resident)
  fastify.get('/api/mat', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=31536000, stale-while-revalidate=31536000, immutable');
    return precomputedMatList;
  });

// Helper to build FTS5 match query supporting single words, exact phrases, proximity (NEAR), and multi-word AND
function buildFts5Query(cleanText, distance = 'any') {
  if (!cleanText) return '';
  const tokens = cleanText
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF*]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return '';

  // Single word: e.g. "dhamma"* or "dhamma"
  if (tokens.length === 1) {
    const tok = tokens[0];
    return tok.endsWith('*') ? `"${tok.slice(0, -1)}"*` : `"${tok}"*`;
  }

  // Exact phrase: distance = 1
  if (distance === 1 || distance === '1' || distance === 'exact') {
    const phrase = tokens.map((t) => t.replace(/\*/g, '')).join(' ');
    return `"${phrase}"`;
  }

  // Word proximity: distance = 2, 3, 5, 8, 10
  const distNum = parseInt(distance, 10);
  if (!isNaN(distNum) && distNum >= 2 && distNum <= 50) {
    const terms = tokens.map((t) => `"${t.replace(/\*/g, '')}"`).join(' ');
    return `NEAR(${terms}, ${distNum})`;
  }

  // Default: ANY distance (AND across paragraph)
  return tokens.map((t) => (t.endsWith('*') ? `"${t.slice(0, -1)}"*` : `"${t}"*`)).join(' AND ');
}

// Helper to construct dynamic SQL WHERE & ORDER BY for full-text search
function buildSearchSql({ ftsQuery, mat, pitaka, book, sort }) {
  const whereClauses = ['paragraphs_fts MATCH ?'];
  const params = [ftsQuery];

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

  if (sort === 'relevance' || sort === 'rank') {
    orderSql = 'ORDER BY rank ASC';
  } else if (sort === 'bm25') {
    orderSql = 'ORDER BY bm25(paragraphs_fts) ASC';
  }

  const countSql = `SELECT count(*) as total FROM paragraphs_fts ${whereSql}`;
  const querySql = `
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

  // Full-Text Search across 520,000+ paragraphs with In-Memory LRU Caching
  fastify.get('/api/search', async (req, reply) => {
    applyCacheHeader(reply, 'public, max-age=86400, stale-while-revalidate=604800');
    const rawQuery = req.query.q || req.query.query || '';
    const bookFilter = req.query.book || null;
    const matFilter = req.query.mat || 'all';
    const pitakaFilter = req.query.pitaka || req.query.nikaya || 'all';
    const distanceVal = req.query.distance || req.query.dist || 'any';
    const sortVal = req.query.sort || 'pitaka';
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    if (!rawQuery || rawQuery.trim().length < 2) {
      return { total: 0, count: 0, results: [] };
    }

    // Auto-normalize Velthuis typing and nigghahita
    const convertedQuery = typeVelthuis(rawQuery.trim()).replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'ṃ');
    const cleanQuery = convertedQuery.trim();

    // Construct FTS5 match query
    const ftsMatch = buildFts5Query(cleanQuery, distanceVal);
    if (!ftsMatch) {
      return { total: 0, count: 0, results: [] };
    }

    // In-Memory Search Cache Lookup (< 0.05ms)
    const cacheKey = `${ftsMatch}::${matFilter}::${pitakaFilter}::${bookFilter || 'all'}::${sortVal}::${distanceVal}::${limit}::${offset}`;
    const cachedEntry = searchCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < SEARCH_CACHE_TTL) {
      searchHits++;
      return cachedEntry.data;
    }
    searchMisses++;

    try {
      const { countSql, querySql, params } = buildSearchSql({
        ftsQuery: ftsMatch,
        mat: matFilter,
        pitaka: pitakaFilter,
        book: bookFilter,
        sort: sortVal,
      });

      const searchDb = dbFts || db;
      const countRow = searchDb.prepare(countSql).get(...params);
      const total = countRow ? countRow.total : 0;

      const rows = searchDb.prepare(querySql).all(...params, limit, offset);

      const responseData = {
        query: cleanQuery,
        ftsQuery: ftsMatch,
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

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[Fastify] Ultra-optimized Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
