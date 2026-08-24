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
  path.join(__dirname, 'tipitaka.db'),
  path.join(__dirname, '..', '..', 'web_app2', 'tipitaka.db'),
  path.join(__dirname, '..', '..', 'tipitaka_latin2.db'),
  path.join(__dirname, '..', '..', 'tipitaka.db'),
  path.join(__dirname, '..', 'web_app2', 'tipitaka.db'),
  path.join(__dirname, '..', 'tipitaka_latin2.db'),
  path.join(__dirname, '..', 'tipitaka.db'),
];

let DB_PATH = DB_CANDIDATES.find((p) => fs.existsSync(p));
if (!DB_PATH) {
  console.error('ERROR: tipitaka.db not found in candidates:', DB_CANDIDATES);
  process.exit(1);
}
console.log(`[Database] Using SQLite database at: ${DB_PATH}`);

// Initialize SQLite database connection (Native Fast Synchronous Engine)
const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Prepared Statements for ultra-low latency direct execution (Zero runtime parsing)
const stmtGetTreeMeta = db.prepare("SELECT value FROM site_metadata WHERE key = 'tree_json'");
const stmtGetBooks = db.prepare('SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id');
const stmtGetBook = db.prepare('SELECT id, code, title, nikaya, category, chapter_count, meta_json FROM books WHERE code = ?');
const stmtGetChapters = db.prepare('SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index');
const stmtGetChapterHtml = db.prepare('SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ?');
const stmtGetChaptersRangeHtml = db.prepare('SELECT chapter_index, html FROM chapters WHERE book_code = ? AND chapter_index BETWEEN ? AND ? ORDER BY chapter_index');
const stmtGetAllChaptersHtml = db.prepare('SELECT chapter_index, html FROM chapters WHERE book_code = ? ORDER BY chapter_index');
const stmtGetToc = db.prepare('SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index FROM book_toc WHERE book_code = ? ORDER BY item_index');
const stmtGetBookXml = db.prepare('SELECT xml_filename, xml_content FROM books_xml WHERE book_code = ?');

function formatChapterTitle(title) {
  if (!title) return '';
  return title
    .replace(/^([a-zñāīūṃṅṭḍṇḷ])/i, (m) => m.toUpperCase())
    .replace(/(\d+\.\s*)([a-zñāīūṃṅṭḍṇḷ])/gi, (m, p1, p2) => `${p1}${p2.toUpperCase()}`)
    .replace(/([\(\-\/\s])([a-zñāīūṃṅṭḍṇḷ])/gi, (m, p1, p2) => `${p1}${p2.toUpperCase()}`);
}

let stmtGetMat = null;
let stmtGetAllMat = null;
try {
  stmtGetMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat WHERE book_code = ?');
  stmtGetAllMat = db.prepare('SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat');
} catch (e) {
  console.warn('[MAT] book_mat table prepared statement error:', e.message);
}
const stmtSearchCount = db.prepare('SELECT count(*) as total FROM paragraphs_fts WHERE paragraphs_fts MATCH ?');

const stmtSearch = db.prepare(`
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
  WHERE paragraphs_fts MATCH ? 
  ORDER BY rank
  LIMIT ? OFFSET ?
`);

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

// Initialize Fastify app
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  disableRequestLogging: false,
});

async function main() {
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });

  await fastify.register(compress, {
    global: true,
    threshold: 1024,
  });

  fastify.get('/', async (req, reply) => {
    return {
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Fastify API',
      status: 'online',
      version: '2.1.0',
      features: ['precomputed-chapters', 'sub-millisecond-serving', 'raw-xml-isolated', 'full-text-search'],
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

  // Navigation tree endpoint
  fastify.get('/api/tree', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const treeJsonPath = path.join(__dirname, 'tree.json');
    if (fs.existsSync(treeJsonPath)) {
      try {
        const raw = fs.readFileSync(treeJsonPath, 'utf8');
        return cleanTree(JSON.parse(raw));
      } catch (err) {
        req.log.warn({ err }, 'Failed to read tree.json from disk, falling back to db');
      }
    }

    try {
      const meta = stmtGetTreeMeta.get();
      if (meta && meta.value) {
        return cleanTree(JSON.parse(meta.value));
      }
    } catch (err) {
      req.log.warn({ err }, 'Failed to read tree_json from site_metadata');
    }

    const fallbackPath = path.join(__dirname, '..', 'web_app2', 'tree.json');
    if (fs.existsSync(fallbackPath)) {
      try {
        const raw = fs.readFileSync(fallbackPath, 'utf8');
        return cleanTree(JSON.parse(raw));
      } catch (e) {}
    }

    reply.code(500);
    return { error: 'Navigation tree not found' };
  });

  // List all 217 books
  fastify.get('/api/books', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const rows = stmtGetBooks.all();
    return {
      total: rows.length,
      books: rows,
    };
  });

  // Get specific book with precomputed chapters and instant buffering support
  fastify.get('/api/book/:code', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const rawCode = req.params.code;
    let cleanCode = rawCode.replace('.xml', '');
    let resolvedChapFromCode = undefined;

    let book = stmtGetBook.get(cleanCode);
    if (!book) {
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        resolvedChapFromCode = parseInt(chapSuffixMatch[2], 10);
        book = stmtGetBook.get(cleanCode);
      }
    }

    if (!book) {
      reply.code(404);
      return { error: `Book '${cleanCode}' not found` };
    }

    const chapters = stmtGetChapters.all(cleanCode);
    const toc = stmtGetToc.all(cleanCode);
    let meta = {};
    if (book.meta_json) {
      try {
        meta = JSON.parse(book.meta_json);
      } catch (e) {}
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
      mat: meta.mat || (stmtGetMat ? (stmtGetMat.get(cleanCode) || null) : null),
      initial_chapter: reqChap,
      chapters_data: chaptersData,
      html: loadedHtmlArray.join('\n'),
    };
  });

  // Get specific chapter HTML instantly from precomputed table (< 0.1ms)
  fastify.get('/api/book/:code/chapter/:chapterIndex', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
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

  // Get raw TEI XML source for a book (isolated from reader path)
  fastify.get('/api/book/:code/xml', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const cleanCode = req.params.code.replace('.xml', '');
    const xmlRow = stmtGetBookXml.get(cleanCode);
    if (!xmlRow) {
      reply.code(404);
      return { error: `Raw XML for '${cleanCode}' not found` };
    }
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    return xmlRow.xml_content;
  });

  // Get hierarchical TOC for a book
  fastify.get('/api/book/:code/toc', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const cleanCode = req.params.code.replace('.xml', '');
    const toc = stmtGetToc.all(cleanCode);
    return {
      book_code: cleanCode,
      total: toc.length,
      toc: toc,
    };
  });

  // Get MAT (Mūla / Aṭṭhakathā / Ṭīkā) cross-reference relations for a book
  fastify.get('/api/book/:code/mat', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const rawCode = req.params.code;
    let cleanCode = rawCode.replace('.xml', '');

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

    if (stmtGetMat) {
      const mat = stmtGetMat.get(cleanCode);
      if (mat) return mat;
    }

    reply.code(404);
    return { error: `No MAT relationship found for '${cleanCode}'` };
  });


  // Get full MAT matrix for all books
  fastify.get('/api/mat', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    if (!stmtGetAllMat) {
      reply.code(500);
      return { error: 'MAT database index not initialized' };
    }
    const rows = stmtGetAllMat.all();
    return rows;
  });


  // Full-Text Search across 520,000+ paragraphs
  fastify.get('/api/search', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    const query = req.query.q || req.query.query || '';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

    if (!query || query.trim().length < 2) {
      return { total: 0, count: 0, results: [] };
    }

    const cleanQuery = query.trim();

    const sanitized = cleanQuery
      .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w}"*`)
      .join(' AND ');

    if (!sanitized) {
      return { total: 0, count: 0, results: [] };
    }

    try {
      const countRow = stmtSearchCount.get(sanitized);
      const total = countRow ? countRow.total : 0;
      const rows = stmtSearch.all(sanitized, limit, offset);

      return {
        query: cleanQuery,
        total: total,
        count: rows.length,
        offset: offset,
        limit: limit,
        results: rows,
      };
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

  // Health and metrics endpoint
  fastify.get('/api/health', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'healthy',
      mode: 'precomputed-sqlite',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rss_mb: Math.round(memory.rss / (1024 * 1024)),
        heap_used_mb: Math.round(memory.heapUsed / (1024 * 1024)),
        heap_total_mb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    };
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`[Fastify] Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
