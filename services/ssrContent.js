import zlib from 'zlib';
import { convertPaliScript } from './transliterate.js';
import { TRANSLATION_LANGS, isValidTranslationLang } from './seoMetadata.js';

const IS_STATIC_EXPORT =
  process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

const DEFAULT_MAX_PARAGRAPHS = 120;
const DEFAULT_MAX_CHARS = 50000;
const FETCH_TIMEOUT_MS = 2500;

let _runtimeDepsPromise = null;
let _sqliteDriver = undefined; // { type: 'better-sqlite3' | 'node-sqlite', Ctor } | null
const _dbHandles = new Map(); // filename -> db handle | null
const _availLangsCache = new Map(); // `${bookCode}|${chapterIndex ?? 'book'}` -> Set<string> | null
const _transChapsCache = new Map(); // `${langCode}|${bookCode}` -> Set<number> | null

/**
 * Load Node runtime modules via webpackIgnore/turbopackIgnore so Next.js/Turbopack
 * never attempts to statically trace or copy the 37GB server_api/db/*.db directory
 * during `next build`.
 */
async function getRuntimeDeps() {
  if (!_runtimeDepsPromise) {
    _runtimeDepsPromise = (async () => {
      const [fsMod, pathMod, moduleMod] = await Promise.all([
        import(/* webpackIgnore: true */ 'node:fs'),
        import(/* webpackIgnore: true */ 'node:path'),
        import(/* webpackIgnore: true */ 'node:module'),
      ]);
      return {
        fs: fsMod.default || fsMod,
        path: pathMod.default || pathMod,
        createRequire: moduleMod.createRequire || moduleMod.default?.createRequire,
      };
    })();
  }
  return _runtimeDepsPromise;
}

function resolveProjectRoot(pathMod) {
  const baseDir = process.env.TIPITAKA_ROOT_DIR || process.cwd();
  const normalizedBase = pathMod.normalize(baseDir);
  const standaloneSuffix = `${pathMod.sep}.next${pathMod.sep}standalone`;
  if (normalizedBase.endsWith(standaloneSuffix)) {
    return normalizedBase.slice(0, -standaloneSuffix.length);
  }
  return normalizedBase;
}

function resolveDbDir(fsMod, pathMod) {
  // Respect an explicit DB_DIR override so operators/tests can disable local DBs cleanly
  if (process.env.DB_DIR) {
    return fsMod.existsSync(process.env.DB_DIR) ? process.env.DB_DIR : null;
  }
  const root = resolveProjectRoot(pathMod);
  const candidates = [];
  if (process.env.USER_DATA_PATH) candidates.push(pathMod.resolve(process.env.USER_DATA_PATH, 'db'));
  candidates.push(pathMod.resolve(root, 'server_api', 'db'));

  for (const dir of candidates) {
    if (dir && fsMod.existsSync(dir)) return dir;
  }
  return null;
}

async function getSqliteDriver(deps) {
  if (_sqliteDriver !== undefined) return _sqliteDriver;

  const { fs: fsMod, path: pathMod, createRequire } = deps;
  const root = resolveProjectRoot(pathMod);

  // 1. Prefer server_api's native better-sqlite3 at runtime
  if (typeof createRequire === 'function') {
    try {
      const pkgPath = pathMod.resolve(root, 'server_api', 'package.json');
      if (fsMod.existsSync(pkgPath)) {
        const serverReq = createRequire(pkgPath);
        const BetterSqlite3 = serverReq('better-sqlite3');
        if (typeof BetterSqlite3 === 'function') {
          _sqliteDriver = { type: 'better-sqlite3', Ctor: BetterSqlite3 };
          return _sqliteDriver;
        }
      }
    } catch (_) {}
  }

  // 2. Fallback to Node built-in node:sqlite (Node 22.5+ / 24 / 26)
  try {
    const nodeSqlite = await import(/* webpackIgnore: true */ 'node:sqlite');
    const Ctor = nodeSqlite.DatabaseSync || nodeSqlite.default?.DatabaseSync;
    if (typeof Ctor === 'function') {
      _sqliteDriver = { type: 'node-sqlite', Ctor };
      return _sqliteDriver;
    }
  } catch (_) {}

  _sqliteDriver = null;
  return null;
}

async function openReadOnlyDb(filename) {
  if (_dbHandles.has(filename)) {
    return _dbHandles.get(filename);
  }

  const deps = await getRuntimeDeps();
  const dbDir = resolveDbDir(deps.fs, deps.path);
  if (!dbDir) {
    _dbHandles.set(filename, null);
    return null;
  }

  const fullPath = deps.path.resolve(dbDir, filename);
  if (!deps.fs.existsSync(fullPath)) {
    _dbHandles.set(filename, null);
    return null;
  }

  const driver = await getSqliteDriver(deps);
  if (!driver) {
    _dbHandles.set(filename, null);
    return null;
  }

  try {
    const db =
      driver.type === 'better-sqlite3'
        ? new driver.Ctor(fullPath, { readonly: true })
        : new driver.Ctor(fullPath, { readOnly: true });
    _dbHandles.set(filename, db);
    return db;
  } catch (err) {
    console.warn(`[ssrContent] Failed to open ${filename}:`, err?.message || err);
    _dbHandles.set(filename, null);
    return null;
  }
}

function stripChapterHtmlToParagraphs(html) {
  if (!html || typeof html !== 'string') return [];
  const paragraphs = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  let seq = 0;
  while ((m = pRe.exec(html)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const piMatch = attrs.match(/data-pindex="(\d+)"/i);
    const pnMatch = attrs.match(/data-para="([^"]+)"/i);
    const clsMatch = attrs.match(/class="([^"]+)"/i);
    const cleaned = inner
      .replace(/<span\b[^>]*class="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<span\b[^>]*class="[^"]*\bnote\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;
    paragraphs.push({
      paraIndex: piMatch ? parseInt(piMatch[1], 10) : seq++,
      paraNum: pnMatch ? pnMatch[1] : null,
      isHeading: Boolean(clsMatch && /\b(chapter|subhead|subsubhead|title|book|nikaya)\b/i.test(clsMatch[1])),
      pali: cleaned,
    });
  }
  return paragraphs;
}

async function readPaliChapterFromDb(bookCode, chapterIndex) {
  const db = await openReadOnlyDb('tipitaka.db');
  if (!db) return null;

  // 1. Prefer chapters.html / chapters.html_z (100% coverage in tipitaka.db) so heading
  //    classification (<p class="chapter|subhead|title|...">) and data-para numbers are exact.
  try {
    const row = db
      .prepare('SELECT html, html_z FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1')
      .get(bookCode, chapterIndex);
    if (row) {
      let html = row.html ? String(row.html) : '';
      if (!html && row.html_z) {
        const buf = Buffer.isBuffer(row.html_z) ? row.html_z : Buffer.from(row.html_z);
        html = zlib.inflateSync(buf).toString('utf8');
      }
      if (html) {
        const parsed = stripChapterHtmlToParagraphs(html);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch (_) {}

  // 2. Fallback to chapter_text_pack (note: item[1] === null is a compression dedup flag when
  //    pali_text equals the sentence join, NOT a heading marker, so keep isHeading: false).
  try {
    const row = db
      .prepare(
        'SELECT ctp.data_z FROM chapter_text_pack ctp ' +
          'JOIN books b ON b.id = ctp.book_id ' +
          'WHERE b.code = ? AND ctp.chapter_index = ? LIMIT 1'
      )
      .get(bookCode, chapterIndex);

    if (row && row.data_z) {
      const buf = Buffer.isBuffer(row.data_z) ? row.data_z : Buffer.from(row.data_z);
      const packed = JSON.parse(zlib.inflateSync(buf).toString('utf8'));
      if (Array.isArray(packed) && packed.length > 0) {
        const paragraphs = [];
        for (const item of packed) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const paraIndex = Number(item[0]);
          const rawText = item[1] !== null && item[1] !== undefined ? String(item[1]).trim() : '';
          let text = rawText;
          if (!text && Array.isArray(item[2])) {
            text = item[2]
              .map((s) => (Array.isArray(s) ? String(s[1] || '').trim() : ''))
              .filter(Boolean)
              .join(' ');
          }
          if (!text) continue;
          paragraphs.push({
            paraIndex,
            paraNum: null,
            isHeading: false,
            pali: text,
          });
        }
        if (paragraphs.length > 0) return paragraphs;
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Return the set of 0-based chapter indices that have translated paragraphs in
 * `translation_{langCode}.db` for `bookCode`, or `null` if local SQLite DB is absent.
 */
export async function getTranslatedChapterIndices(bookCode, langCode) {
  if (IS_STATIC_EXPORT || !bookCode || !isValidTranslationLang(langCode)) return null;
  const cacheKey = `${langCode}|${bookCode}`;
  if (_transChapsCache.has(cacheKey)) {
    return _transChapsCache.get(cacheKey);
  }
  const db = await openReadOnlyDb(`translation_${langCode}.db`);
  if (!db) {
    return null;
  }
  try {
    const rows = db
      .prepare(
        'SELECT DISTINCT chapter_index FROM paragraph_translations ' +
          'WHERE book_code = ? ORDER BY chapter_index ASC'
      )
      .all(bookCode);
    const set = new Set(rows.map((r) => Number(r.chapter_index)));
    _transChapsCache.set(cacheKey, set);
    return set;
  } catch (_) {
    return null;
  }
}

/**
 * Return the Set of translation language codes that actually have translated paragraphs
 * for `(bookCode, chapterIndex)` (or any chapter in `bookCode` when `chapterIndex === null`).
 * Returns `null` when local SQLite DBs are unavailable or during static export.
 */
export async function getAvailableTranslationLangs(bookCode, chapterIndex = null) {
  if (IS_STATIC_EXPORT || !bookCode) return null;
  const safeChap =
    chapterIndex !== null && chapterIndex !== undefined && Number.isInteger(chapterIndex) && chapterIndex >= 0
      ? chapterIndex
      : null;
  const cacheKey = `${bookCode}|${safeChap === null ? 'book' : safeChap}`;
  if (_availLangsCache.has(cacheKey)) {
    return _availLangsCache.get(cacheKey);
  }

  const available = new Set();
  let openedAnyDb = false;

  for (const t of TRANSLATION_LANGS) {
    const db = await openReadOnlyDb(`translation_${t.code}.db`);
    if (!db) continue;
    openedAnyDb = true;
    try {
      const row =
        safeChap !== null
          ? db
              .prepare(
                'SELECT 1 AS ok FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? LIMIT 1'
              )
              .get(bookCode, safeChap)
          : db
              .prepare(
                'SELECT 1 AS ok FROM paragraph_translations WHERE book_code = ? LIMIT 1'
              )
              .get(bookCode);
      if (row) {
        available.add(t.code);
      }
    } catch (_) {}
  }

  if (!openedAnyDb) {
    return null;
  }
  _availLangsCache.set(cacheKey, available);
  return available;
}

async function readTranslationChapterFromDb(bookCode, chapterIndex, langCode) {
  if (!isValidTranslationLang(langCode)) return null;
  const db = await openReadOnlyDb(`translation_${langCode}.db`);
  if (!db) return null;

  try {
    const rows = db
      .prepare(
        'SELECT para_index, para_num, translation FROM paragraph_translations ' +
          'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index ASC'
      )
      .all(bookCode, chapterIndex);

    const map = new Map();
    for (const r of rows) {
      if (r.translation && String(r.translation).trim()) {
        map.set(Number(r.para_index), {
          paraNum: r.para_num !== null && r.para_num !== undefined ? String(r.para_num) : null,
          text: String(r.translation).trim(),
        });
      }
    }
    return map;
  } catch (_) {
    return null;
  }
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPaliChapterFromApi(bookCode, chapterIndex) {
  const baseUrl = (process.env.BACKEND_API_URL || 'http://127.0.0.1:8400').replace(/\/+$/, '');
  const data = await fetchJsonWithTimeout(
    `${baseUrl}/api/book/${encodeURIComponent(bookCode)}/chapter/${chapterIndex}`
  );
  if (data && typeof data.html === 'string') {
    return stripChapterHtmlToParagraphs(data.html);
  }
  return null;
}

async function fetchTranslationChapterFromApi(bookCode, chapterIndex, langCode) {
  if (!isValidTranslationLang(langCode)) return null;
  const baseUrl = (process.env.BACKEND_API_URL || 'http://127.0.0.1:8400').replace(/\/+$/, '');
  const data = await fetchJsonWithTimeout(
    `${baseUrl}/api/book/${encodeURIComponent(bookCode)}/chapter/${chapterIndex}/translation?lang=${encodeURIComponent(langCode)}`
  );
  const paraObj = data?.translations?.[langCode];
  if (!paraObj || typeof paraObj !== 'object') return null;

  const map = new Map();
  for (const [piStr, txt] of Object.entries(paraObj)) {
    if (txt && String(txt).trim()) {
      map.set(Number(piStr), { paraNum: null, text: String(txt).trim() });
    }
  }
  return map;
}

function cleanTranslationPlainText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\r\n/g, '\n')
    .trim();
}

export async function getSsrChapterContent({
  bookCode,
  chapterIndex = 0,
  scriptId = null,
  translationLang = null,
  isBookRoot = false,
  maxParagraphs = DEFAULT_MAX_PARAGRAPHS,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  if (IS_STATIC_EXPORT || !bookCode) return null;

  let safeChapIdx = Number.isInteger(chapterIndex) && chapterIndex >= 0 ? chapterIndex : 0;

  // On book root translation pages (e.g. /translation/my_nissaya/s0502m.mul where Ch. 1 has 0
  // translated paragraphs but Ch. 3 has real translations), automatically pick the first
  // translated chapter so crawlers always receive genuine translated text in SSR HTML.
  if (isBookRoot && translationLang && isValidTranslationLang(translationLang)) {
    const presentChaps = await getTranslatedChapterIndices(bookCode, translationLang);
    if (presentChaps && presentChaps.size > 0 && !presentChaps.has(safeChapIdx)) {
      safeChapIdx = Math.min(...presentChaps);
    }
  }

  let paliRows = await readPaliChapterFromDb(bookCode, safeChapIdx);
  let source = paliRows ? 'sqlite' : 'none';
  if (!paliRows) {
    paliRows = await fetchPaliChapterFromApi(bookCode, safeChapIdx);
    if (paliRows) source = 'api';
  }

  let transMap = null;
  if (translationLang && isValidTranslationLang(translationLang)) {
    transMap = await readTranslationChapterFromDb(bookCode, safeChapIdx, translationLang);
    if (transMap === null) {
      transMap = await fetchTranslationChapterFromApi(bookCode, safeChapIdx, translationLang);
    }
  }

  if ((!paliRows || paliRows.length === 0) && (!transMap || transMap.size === 0)) {
    return null;
  }

  const combined = [];
  let charBudget = 0;
  let truncated = false;
  let translatedCount = 0;

  if (paliRows && paliRows.length > 0) {
    for (const row of paliRows) {
      if (combined.length >= maxParagraphs || charBudget >= maxChars) {
        truncated = true;
        break;
      }
      const paliDisplay =
        scriptId && !translationLang ? convertPaliScript(row.pali, scriptId) : row.pali;
      const trEntry = transMap ? transMap.get(row.paraIndex) : null;
      const trText = trEntry ? cleanTranslationPlainText(trEntry.text) : null;
      if (trText) translatedCount += 1;

      charBudget += (paliDisplay?.length || 0) + (trText?.length || 0);
      combined.push({
        paraIndex: row.paraIndex,
        paraNum: trEntry?.paraNum || row.paraNum || null,
        isHeading: Boolean(row.isHeading),
        pali: paliDisplay,
        translation: trText,
      });
    }
  } else if (transMap && transMap.size > 0) {
    const keys = Array.from(transMap.keys()).sort((a, b) => a - b);
    for (const pi of keys) {
      if (combined.length >= maxParagraphs || charBudget >= maxChars) {
        truncated = true;
        break;
      }
      const trEntry = transMap.get(pi);
      const trText = cleanTranslationPlainText(trEntry.text);
      if (!trText) continue;
      translatedCount += 1;
      charBudget += trText.length;
      combined.push({
        paraIndex: pi,
        paraNum: trEntry.paraNum || null,
        isHeading: false,
        pali: null,
        translation: trText,
      });
    }
  }

  return {
    bookCode,
    chapterIndex: safeChapIdx,
    scriptId: translationLang ? null : scriptId,
    translationLang: translationLang || null,
    source,
    totalParagraphs: paliRows ? paliRows.length : transMap ? transMap.size : combined.length,
    translatedCount,
    truncated,
    paragraphs: combined,
  };
}
