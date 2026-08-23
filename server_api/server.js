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

// Prepared Statements for ultra-low latency execution
const stmtGetTreeMeta = db.prepare("SELECT value FROM site_metadata WHERE key = 'tree_json'");
const stmtGetBooks = db.prepare('SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id');
const stmtGetBook = db.prepare('SELECT id, code, title, nikaya, category, xml_content, chapter_count FROM books WHERE code = ?');
const stmtGetChapters = db.prepare('SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index');
function formatChapterTitle(title) {
  if (!title) return '';
  return title
    .replace(/^([a-zñāīūṃṅṭḍṇḷ])/i, (m) => m.toUpperCase())
    .replace(/(\d+\.\s*)([a-zñāīūṃṅṭḍṇḷ])/gi, (m, p1, p2) => `${p1}${p2.toUpperCase()}`)
    .replace(/([\(\-\/\s])([a-zñāīūṃṅṭḍṇḷ])/gi, (m, p1, p2) => `${p1}${p2.toUpperCase()}`);
}

const stmtGetToc = db.prepare('SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index FROM book_toc WHERE book_code = ? ORDER BY item_index');




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

// In-Memory Book Chapter Cache for sub-millisecond lazy loading and buffering
const bookParsedCache = new Map();

// Load CST4 Authoritative Books Catalog

const CST_CATALOG_PATH = path.join(__dirname, 'cst_books_catalog.json');
let cstCatalog = {};
if (fs.existsSync(CST_CATALOG_PATH)) {
  try {
    cstCatalog = JSON.parse(fs.readFileSync(CST_CATALOG_PATH, 'utf8'));
    console.log(`[CST4 Catalog] Loaded ${Object.keys(cstCatalog).length} books metadata`);
  } catch (e) {
    console.warn('[CST4 Catalog] Failed to parse cst_books_catalog.json:', e.message);
  }
}

/**
 * CST4-compliant Paragraph Span Parser (Ported from CST.Core.Search.BookMarkers)
 * Expands full ranges (16-26) and abbreviated continuation ranges (196-7 -> 196..197, 266-7-8 -> 266..268)
 */
function tryParseParagraphSpan(n) {
  if (!n || typeof n !== 'string') return null;
  const rawParts = n.split('-');
  let previous = null;
  let first = 0;
  let last = 0;
  let any = false;

  for (const raw of rawParts) {
    const part = raw.trim();
    if (!part) continue;
    if (!/^\d+$/.test(part)) break;

    // Expand abbreviated continuation: e.g. "196-7" -> 196 to 197
    let expanded = part;
    if (previous && part.length < previous.length) {
      expanded = previous.slice(0, previous.length - part.length) + part;
    }
    const val = parseInt(expanded, 10);
    if (isNaN(val)) break;

    if (!any) {
      first = val;
      any = true;
    }
    last = val;
    previous = expanded;
  }

  if (any && last < first) last = first;
  if (!any) return null;
  return { first, last };
}

/**
 * Splits and converts Tipitaka XML into clean chapter HTML snippets with exact CST4 anchors.
 */
function parseBookChaptersHtml(xmlContent, chapters) {
  const m = xmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  let body = m ? m[1] : xmlContent;

  const chapterByPara = new Map();
  for (const c of chapters) {
    chapterByPara.set(c.para_index || 0, c);
  }

  const pRegex = /<(p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>([\s\S]*?)<\/\1>/g;
  const chapterParas = new Map();
  const paraToChapter = {};
  const paraToIndex = {};
  const pageToChapter = { V: {}, P: {}, T: {}, M: {}, O: {} };
  const pageToPara = { V: {}, P: {}, T: {}, M: {}, O: {} };
  const pageAnchors = { V: {}, P: {}, T: {}, M: {}, O: {} };
  let currentChapIdx = 0;
  let paraCounter = 0;

  for (const c of chapters) {
    chapterParas.set(c.chapter_index, []);
  }
  if (!chapterParas.has(0)) {
    chapterParas.set(0, []);
  }

  let match;
  while ((match = pRegex.exec(body)) !== null) {
    if (chapterByPara.has(paraCounter)) {
      currentChapIdx = chapterByPara.get(paraCounter).chapter_index || 0;
    }

    const tag = match[1];
    const rend = match[2];
    const nAttr = match[3];
    let inner = match[4];

    // Index page breaks before HTML conversion with exact CST4 anchors (e.g. V0.0023, P3.0045)
    const pbRegex = /<pb\s+ed="([^"]+)"\s+n="([^"]+)"\s*\/?>/g;
    let pbMatch;
    while ((pbMatch = pbRegex.exec(inner)) !== null) {
      const ed = pbMatch[1].toUpperCase();
      const page = pbMatch[2]; // e.g. "0.0023" or "3.0045"
      if (!pageToChapter[ed]) pageToChapter[ed] = {};
      if (!pageToPara[ed]) pageToPara[ed] = {};
      if (!pageAnchors[ed]) pageAnchors[ed] = {};

      const pbAnchorId = `${ed}${page}`;
      pageToChapter[ed][page] = currentChapIdx;
      pageAnchors[ed][page] = pbAnchorId;
      if (nAttr) pageToPara[ed][page] = nAttr;

      if (page.includes('.')) {
        const parts = page.split('.');
        const vol = parseInt(parts[0], 10);
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) {
          const shortNum = String(num); // e.g. "23"
          const volDotNum = `${vol}.${shortNum}`; // e.g. "0.23" or "3.45"
          pageToChapter[ed][volDotNum] = currentChapIdx;
          pageToChapter[ed][shortNum] = currentChapIdx;
          pageAnchors[ed][volDotNum] = pbAnchorId;
          if (!pageAnchors[ed][shortNum]) pageAnchors[ed][shortNum] = pbAnchorId;
          if (nAttr) {
            pageToPara[ed][volDotNum] = nAttr;
            if (!pageToPara[ed][shortNum]) pageToPara[ed][shortNum] = nAttr;
          }
        }
      }
    }

    inner = inner.replace(/<hi\s+rend="bold">([^<]+)<\/hi>/g, '<strong class="bld">$1</strong>');
    if (nAttr) {
      inner = inner.replace(/<hi\s+rend="paranum">([^<]+)<\/hi>/g, `<strong class="paranum" id="para-${nAttr}">$1</strong>`);
    } else {
      inner = inner.replace(/<hi\s+rend="paranum">([^<]+)<\/hi>/g, '<strong class="paranum">$1</strong>');
    }
    inner = inner.replace(/<hi\s+rend="dot">([^<]+)<\/hi>/g, '<span class="dot">$1</span>');
    inner = inner.replace(/<pb\s+ed="([^"]+)"\s+n="([^"]+)"\s*\/?>/g, (m, ed, n) => {
      const uEd = ed.toUpperCase();
      return `<span id="${uEd}${n}" class="pb" title="Page ${uEd} ${n}" data-ed="${uEd}" data-page="${n}">[${uEd} ${n}]</span>`;
    });
    inner = inner.replace(/<note>([\s\S]*?)<\/note>/g, '<span class="note" title="Footnote">[$1]</span>');

    const attrParts = [`data-pindex="${paraCounter}"`];
    if (nAttr) {
      attrParts.push(`id="para${nAttr}"`);
      attrParts.push(`data-para="${nAttr}"`);

      const span = tryParseParagraphSpan(nAttr);
      if (span) {
        attrParts.push(`data-para-first="${span.first}"`);
        attrParts.push(`data-para-last="${span.last}"`);
        for (let pNum = span.first; pNum <= span.last; pNum++) {
          const strNum = String(pNum);
          if (paraToChapter[strNum] === undefined) {
            paraToChapter[strNum] = currentChapIdx;
            paraToIndex[strNum] = paraCounter;
          }
        }
      } else {
        paraToChapter[nAttr] = currentChapIdx;
        paraToIndex[nAttr] = paraCounter;
      }
    } else {
      attrParts.push(`id="pindex-${paraCounter}"`);
    }
    const attrs = ' ' + attrParts.join(' ');
    const pTag = `<p class="${rend || 'bodytext'}"${attrs}>${inner}</p>`;

    if (!chapterParas.has(currentChapIdx)) {
      chapterParas.set(currentChapIdx, []);
    }
    chapterParas.get(currentChapIdx).push(pTag);
    paraCounter++;
  }

  const result = new Map();
  for (const c of chapters) {
    const chIdx = c.chapter_index;
    const paras = chapterParas.get(chIdx) || [];
    const headerHtml = `<div id="chap-${chIdx}" class="chapter-anchor" data-chapter="${chIdx}"></div>`;
    result.set(chIdx, `${headerHtml}\n${paras.join('\n')}`);
  }

  // Precompute paragraph range directly in backend (excluding non-integer page attributes)
  let paraMin = Infinity;
  let paraMax = -Infinity;
  let paraCount = 0;
  for (const k of Object.keys(paraToChapter)) {
    const n = parseInt(k, 10);
    if (!isNaN(n)) {
      if (n < paraMin) paraMin = n;
      if (n > paraMax) paraMax = n;
      paraCount++;
    }
  }
  const paraRange =
    paraCount === 0
      ? { min: 1, max: 1, total: 0 }
      : { min: paraMin, max: paraMax, total: paraCount };

  // Precompute edition ranges directly in backend
  const editionRanges = {};
  for (const sys of ['V', 'P', 'T', 'M', 'O']) {
    const pMap = pageToChapter[sys] || {};
    const uniquePages = new Set();
    let minNum = Infinity;
    let maxNum = -Infinity;
    for (const p of Object.keys(pMap)) {
      let n = NaN;
      if (p.includes('.')) {
        const parts = p.split('.');
        n = parseInt(parts[1], 10);
      } else {
        n = parseInt(p, 10);
      }
      if (!isNaN(n)) {
        uniquePages.add(n);
        if (n < minNum) minNum = n;
        if (n > maxNum) maxNum = n;
      }
    }
    if (uniquePages.size === 0) {
      editionRanges[sys] = {
        available: false,
        count: 0,
        minNum: 1,
        maxNum: 1,
        label: 'Unavailable',
        hint: '1',
      };
    } else {
      editionRanges[sys] = {
        available: true,
        count: uniquePages.size,
        minNum,
        maxNum,
        label: `Page ${minNum} – ${maxNum}`,
        hint: `e.g. ${minNum} to ${maxNum}`,
      };
    }
  }

  return {
    chapterHtmls: result,
    paraToChapter,
    paraToIndex,
    pageToChapter,
    pageToPara,
    pageAnchors,
    paraRange,
    editionRanges,
  };
}


function getOrParseBook(cleanCode) {
  if (bookParsedCache.has(cleanCode)) {
    return bookParsedCache.get(cleanCode);
  }

  const book = stmtGetBook.get(cleanCode);
  if (!book) return null;

  const chapters = stmtGetChapters.all(cleanCode);
  const toc = stmtGetToc.all(cleanCode);
  const parsedData = parseBookChaptersHtml(book.xml_content, chapters);

  const parsed = {
    metadata: {
      code: book.code,
      title: book.title,
      nikaya: book.nikaya,
      category: book.category,
      chapter_count: book.chapter_count,
      chapters: chapters,
      toc: toc,
      para_to_chapter: parsedData.paraToChapter,
      para_to_index: parsedData.paraToIndex,
      page_to_chapter: parsedData.pageToChapter,
      page_to_para: parsedData.pageToPara,
      page_anchors: parsedData.pageAnchors,
      para_range: parsedData.paraRange,
      edition_ranges: parsedData.editionRanges,
      book_type: cstCatalog[cleanCode]?.bookType || 'Whole',
      mat: cstCatalog[cleanCode]?.mat || (stmtGetMat ? (stmtGetMat.get(cleanCode) || null) : null),
    },
    chapterHtmls: parsedData.chapterHtmls,
  };


  bookParsedCache.set(cleanCode, parsed);
  return parsed;
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
      version: '2.0.0',
      features: ['lazy-loading', 'chapter-buffering', 'full-text-search'],
      endpoints: [
        'GET /api/tree',
        'GET /api/books',
        'GET /api/book/:code?chapter=0&buffer=1',
        'GET /api/book/:code/chapter/:chapterIndex',
        'GET /api/book/:code/toc',
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

  // Get specific book with lazy-load and chapter buffering support
  fastify.get('/api/book/:code', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const rawCode = req.params.code;
    let cleanCode = rawCode.replace('.xml', '');
    let resolvedChapFromCode = undefined;

    let parsed = getOrParseBook(cleanCode);
    if (!parsed) {
      const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        cleanCode = chapSuffixMatch[1];
        resolvedChapFromCode = parseInt(chapSuffixMatch[2], 10);
        parsed = getOrParseBook(cleanCode);
      }
    }

    if (!parsed) {
      reply.code(404);
      return { error: `Book '${cleanCode}' not found` };
    }

    const isFullRequested = req.query.full === 'true';
    const reqChap = req.query.chapter !== undefined
      ? parseInt(req.query.chapter, 10)
      : (resolvedChapFromCode !== undefined ? resolvedChapFromCode : 0);
    const bufferCount = req.query.buffer !== undefined ? parseInt(req.query.buffer, 10) : 1;


    const chaptersData = {};
    const totalChaps = parsed.metadata.chapters.length;

    if (isFullRequested) {
      // Return all chapters
      for (const [idx, html] of parsed.chapterHtmls.entries()) {
        chaptersData[idx] = html;
      }
    } else {
      // Include target chapter + buffer chapters (e.g. idx-1, idx, idx+1, idx+2)
      const startIdx = Math.max(0, reqChap - bufferCount);
      const endIdx = Math.min(totalChaps - 1, reqChap + bufferCount);

      for (let i = startIdx; i <= endIdx; i++) {
        if (parsed.chapterHtmls.has(i)) {
          chaptersData[i] = parsed.chapterHtmls.get(i);
        }
      }
    }

    // Build unified html string from loaded chapters
    const loadedHtmlArray = Object.keys(chaptersData)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => chaptersData[k]);

    return {
      ...parsed.metadata,
      initial_chapter: reqChap,
      chapters_data: chaptersData,
      html: loadedHtmlArray.join('\n'),
    };
  });

  // Get specific chapter HTML for instant on-demand loading
  fastify.get('/api/book/:code/chapter/:chapterIndex', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    const cleanCode = req.params.code.replace('.xml', '');
    const chapIdx = parseInt(req.params.chapterIndex, 10);

    const parsed = getOrParseBook(cleanCode);
    if (!parsed) {
      reply.code(404);
      return { error: `Book '${cleanCode}' not found` };
    }

    if (!parsed.chapterHtmls.has(chapIdx)) {
      reply.code(404);
      return { error: `Chapter ${chapIdx} not found in book '${cleanCode}'` };
    }

    return {
      book_code: cleanCode,
      chapter_index: chapIdx,
      html: parsed.chapterHtmls.get(chapIdx),
    };
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
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rss_mb: Math.round(memory.rss / (1024 * 1024)),
        heap_used_mb: Math.round(memory.heapUsed / (1024 * 1024)),
        heap_total_mb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
      cached_books: bookParsedCache.size,
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
