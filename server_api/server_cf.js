'use strict';

/**
 * server_cf.js — Cloudflare-First Tipiṭaka Backend (Dynamic Ops Only)
 * ==================================================================
 * Lightweight companion to server.js for the static Cloudflare Pages deployment
 * (see deploy_static_cloudflare.py).
 *
 * All static data — navigation tree, books list, book chapters, TOCs, and MAT
 * cross-references — is pre-exported as JSON and served from Cloudflare's edge
 * (/api/tree, /api/books, /api/book/:code, ...) with zero serverless latency.
 *
 * This server therefore serves ONLY the operations that must stay dynamic:
 *   - GET  /api/search                  Full-Text FTS5 search (520k+ paragraphs)
 *   - GET  /api/dict/lookup             Dictionary lookup (DPD, PTS, ABD, PSD, SANS, splitter)
 *   - POST /api/dict/lookup             Same, via POST body
 *   - GET  /api/dict/inf                Inflection (morphology) lookup
 *   - POST /api/dict/inf                Same, via POST body
 *   - POST /api/dpd /api/pts /api/abd /api/psd /api/sans /api/inf   Legacy HTML endpoints
 *   - GET  /api/health                  Health & metrics (used by edge /api/health proxy)
 *   - GET  /                            Service status
 *
 * Same port (8400), CORS, compression, Velthuis normalization, and LRU search
 * cache as server.js so the existing reverse proxy keeps working unchanged.
 *
 * Run:  node server_cf.js          (or: npm run start:cf)
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const compress = require('@fastify/compress');

// Same internal port used by the existing api.tipitakapali.org reverse proxy.
// Override with PORT when running in another environment.
const PORT = parseInt(process.env.PORT || '8400', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Locate FTS5 full-text-search database (fallback: main tipitaka.db contains paragraphs_fts too)
const FTS_DB_CANDIDATES = [
  path.join(__dirname, 'db', 'fts_tipitaka.db'),
  path.join(__dirname, 'fts_tipitaka.db'),
  path.join(__dirname, 'db', 'tipitaka.db'),
  path.join(__dirname, 'tipitaka.db'),
];

const FTS_DB_PATH = FTS_DB_CANDIDATES.find((p) => fs.existsSync(p));
if (!FTS_DB_PATH) {
  console.error('ERROR: no FTS database (fts_tipitaka.db or tipitaka.db) found in candidates:', FTS_DB_CANDIDATES);
  process.exit(1);
}

// Initialize SQLite FTS connection (Native Fast Synchronous Engine, read-only)
const dbFts = new Database(FTS_DB_PATH, { readonly: true });
dbFts.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA query_only = 1;
`);
console.log(`[Database] Using FTS5 SQLite database at: ${FTS_DB_PATH}`);

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

// High-Throughput In-Memory Search Results Cache (LRU)
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

// Server Cache Control Toggle: Re-enabled for ultra-low latency serving
const ENABLE_HTTP_CACHE = true;

function applyCacheHeader(reply, publicHeader = 'public, max-age=86400, stale-while-revalidate=604800') {
  if (ENABLE_HTTP_CACHE) {
    reply.header('Cache-Control', publicHeader);
  } else {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}

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

async function main() {
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  });

  await fastify.register(compress, {
    global: true,
    threshold: 512,
  });

  fastify.get('/', async () => {
    return {
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Fastify API (Cloudflare-First)',
      status: 'online',
      version: '3.0.0',
      note: 'Static data (tree, books, chapters, TOC, MAT) is served from Cloudflare Pages edge. This server handles only dynamic operations.',
      features: ['fts5-search', 'lru-search-cache', 'dictionary-dpd-pts-abd-psd-sans', 'inflection'],
      endpoints: [
        'GET /api/search?q=...&mat=...&pitaka=...&book=...&distance=...&sort=...',
        'GET /api/dict/lookup?w=...&dict=all|dpd|others|pts|abd|psd|sans|splitter',
        'POST /api/dict/lookup',
        'GET /api/dict/inf?w=...',
        'POST /api/dict/inf',
        'POST /api/dpd',
        'POST /api/pts',
        'POST /api/abd',
        'POST /api/psd',
        'POST /api/sans',
        'POST /api/inf',
        'GET /api/health',
      ],
    };
  });

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

      const countRow = dbFts.prepare(countSql).get(...params);
      const total = countRow ? countRow.total : 0;

      const rows = dbFts.prepare(querySql).all(...params, limit, offset);

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

  // Legacy fastify endpoints for compatibility with external references (GoldenDict etc.)
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

  // Health and metrics endpoint (used by the Cloudflare edge /api/health proxy)
  fastify.get('/api/health', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'healthy',
      version: '3.0.0',
      mode: 'cloudflare-first-dynamic-only',
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      cache_metrics: {
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
    console.log(`[Fastify] Cloudflare-First Server listening at http://${HOST}:${PORT} (dynamic ops only)`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
