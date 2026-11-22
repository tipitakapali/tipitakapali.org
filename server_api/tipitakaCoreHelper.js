'use strict';

const zlib = require('zlib');

const _packCacheByDb = new WeakMap();
const _transPackCacheByDb = new WeakMap();
const MAX_PACK_CACHE = 40;

const GUID_RE = /^(.+?):c(\d+):n[^:]*:p(\d+)$/;

function getTableSet(db) {
  if (!db) return new Set();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
    .all();
  return new Set(rows.map((r) => r.name));
}

function hasChapterTransPack(db) {
  return getTableSet(db).has('chapter_trans_pack');
}

function decodeChapterTransPackBlob(buf) {
  const map = new Map();
  if (!buf) return map;
  const raw = Buffer.isBuffer(buf) ? zlib.inflateSync(buf).toString('utf8') : String(buf);
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) return map;

  for (const item of rows) {
    if (!Array.isArray(item) || item.length < 3) continue;
    const paraIndex = Number(item[0]);
    if (!Number.isFinite(paraIndex)) continue;
    const paraNum = item[1] !== undefined && item[1] !== null ? String(item[1]) : null;
    const translation = item[2] !== undefined && item[2] !== null ? String(item[2]) : null;
    const sents = [];
    if (Array.isArray(item[3])) {
      for (const s of item[3]) {
        if (!Array.isArray(s) || s.length < 2) continue;
        const lineId = Number(s[0]);
        const txt = s[1] !== undefined && s[1] !== null ? String(s[1]) : '';
        if (Number.isFinite(lineId) && txt) {
          sents.push({ line_id: lineId, translation: txt });
        }
      }
    }
    map.set(paraIndex, {
      paraIndex,
      paraNum,
      translation,
      sentences: sents,
    });
  }
  return map;
}

function readChapterTranslationPack(db, bookCode, chapterIndex) {
  const empty = new Map();
  if (!db || !bookCode) return empty;

  let packCache = _transPackCacheByDb.get(db);
  if (!packCache) {
    packCache = new Map();
    _transPackCacheByDb.set(db, packCache);
  }
  const key = `${bookCode}#${chapterIndex}`;
  const cached = packCache.get(key);
  if (cached) {
    packCache.delete(key);
    packCache.set(key, cached);
    return cached;
  }

  let res = empty;
  try {
    if (hasChapterTransPack(db)) {
      const row = db
        .prepare('SELECT data_z FROM chapter_trans_pack WHERE book_code = ? AND chapter_index = ? LIMIT 1')
        .get(bookCode, chapterIndex);
      if (row && row.data_z) {
        res = decodeChapterTransPackBlob(row.data_z);
      }
    }
  } catch (_) {}

  if (packCache.size >= MAX_PACK_CACHE) {
    packCache.delete(packCache.keys().next().value);
  }
  packCache.set(key, res);
  return res;
}

function getColumnSet(db, tableName) {
  if (!db) return new Set();
  try {
    const safe = `"${String(tableName).replace(/"/g, '""')}"`;
    return new Set(db.prepare(`PRAGMA table_info(${safe})`).all().map((r) => r.name));
  } catch (_) {
    return new Set();
  }
}

function decodeTextOrZlib(rawText, compressedBuf) {
  if (compressedBuf && Buffer.isBuffer(compressedBuf) && compressedBuf.length > 0) {
    return zlib.inflateSync(compressedBuf).toString('utf8');
  }
  return rawText !== undefined && rawText !== null ? String(rawText) : null;
}

function decodeChapterPackBlob(buf) {
  const rows = JSON.parse(zlib.inflateSync(buf).toString('utf8'));
  const paliMap = new Map();
  const sentMap = new Map();
  if (!Array.isArray(rows)) return { paliMap, sentMap };

  for (const item of rows) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const pi = Number(item[0]);
    const rawPt = item[1] !== undefined && item[1] !== null ? String(item[1]) : null;
    const sents = Array.isArray(item[2]) ? item[2] : null;
    if (sents) {
      const normalizedSents = sents.map((s) => ({ lineId: Number(s[0]), text: String(s[1] || '') }));
      sentMap.set(pi, normalizedSents);
      paliMap.set(pi, rawPt !== null ? rawPt : normalizedSents.map((s) => s.text).join(' '));
    } else if (rawPt !== null) {
      paliMap.set(pi, rawPt);
    }
  }
  return { paliMap, sentMap };
}

function readChapterPack(db, bookCode, chapterIndex) {
  if (!db) return { paliMap: new Map(), sentMap: new Map() };
  let packCache = _packCacheByDb.get(db);
  if (!packCache) {
    packCache = new Map();
    _packCacheByDb.set(db, packCache);
  }
  const key = `${bookCode}#${chapterIndex}`;
  const cached = packCache.get(key);
  if (cached) {
    packCache.delete(key);
    packCache.set(key, cached);
    return cached;
  }

  let res = { paliMap: new Map(), sentMap: new Map() };
  try {
    const row = db
      .prepare(
        'SELECT ctp.data_z FROM chapter_text_pack ctp ' +
          'JOIN books b ON b.id = ctp.book_id ' +
          'WHERE b.code = ? AND ctp.chapter_index = ? LIMIT 1'
      )
      .get(bookCode, chapterIndex);
    if (row && row.data_z) {
      res = decodeChapterPackBlob(row.data_z);
    }
  } catch (_) {}

  if (packCache.size >= MAX_PACK_CACHE) {
    packCache.delete(packCache.keys().next().value);
  }
  packCache.set(key, res);
  return res;
}

function hasPaliSentencesSupport(dbTipitaka, paliSentDb) {
  if (paliSentDb) return true;
  if (!dbTipitaka) return false;
  const tables = getTableSet(dbTipitaka);
  return tables.has('chapter_text_pack') || tables.has('pali_sentences');
}

function readBookSentences(dbTipitaka, paliSentDb, bookCode) {
  if (paliSentDb) {
    try {
      const rows = paliSentDb
        .prepare(
          'SELECT chapter_index, para_index, line_id, sentence ' +
            'FROM pali_sentences WHERE book_code = ? ORDER BY chapter_index, para_index, line_id'
        )
        .all(bookCode);
      if (rows.length > 0) return rows;
    } catch (_) {}
  }

  if (!dbTipitaka) return [];
  const tables = getTableSet(dbTipitaka);

  if (tables.has('pali_sentences')) {
    try {
      const rows = dbTipitaka
        .prepare(
          'SELECT chapter_index, para_index, line_id, sentence ' +
            'FROM pali_sentences WHERE book_code = ? ORDER BY chapter_index, para_index, line_id'
        )
        .all(bookCode);
      if (rows.length > 0) return rows;
    } catch (_) {}
  }

  if (tables.has('chapter_text_pack')) {
    try {
      const chapRows = dbTipitaka
        .prepare(
          'SELECT ctp.chapter_index, ctp.data_z FROM chapter_text_pack ctp ' +
            'JOIN books b ON b.id = ctp.book_id ' +
            'WHERE b.code = ? ORDER BY ctp.chapter_index'
        )
        .all(bookCode);
      const out = [];
      for (const cr of chapRows) {
        const { sentMap } = decodeChapterPackBlob(cr.data_z);
        const pKeys = Array.from(sentMap.keys()).sort((a, b) => a - b);
        for (const pi of pKeys) {
          for (const s of sentMap.get(pi)) {
            out.push({
              chapter_index: cr.chapter_index,
              para_index: pi,
              line_id: s.lineId,
              sentence: s.text,
            });
          }
        }
      }
      return out;
    } catch (_) {}
  }

  return [];
}

function readChapterSentences(dbTipitaka, paliSentDb, bookCode, chapterIndex) {
  if (paliSentDb) {
    try {
      const rows = paliSentDb
        .prepare(
          'SELECT para_index, line_id, sentence FROM pali_sentences ' +
            'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id'
        )
        .all(bookCode, chapterIndex);
      if (rows.length > 0) {
        const map = new Map();
        for (const r of rows) {
          if (!map.has(r.para_index)) map.set(r.para_index, []);
          map.get(r.para_index).push({ lineId: r.line_id, text: r.sentence });
        }
        return map;
      }
    } catch (_) {}
  }

  if (!dbTipitaka) return new Map();
  const tables = getTableSet(dbTipitaka);
  if (tables.has('pali_sentences')) {
    try {
      const rows = dbTipitaka
        .prepare(
          'SELECT para_index, line_id, sentence FROM pali_sentences ' +
            'WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id'
        )
        .all(bookCode, chapterIndex);
      if (rows.length > 0) {
        const map = new Map();
        for (const r of rows) {
          if (!map.has(r.para_index)) map.set(r.para_index, []);
          map.get(r.para_index).push({ lineId: r.line_id, text: r.sentence });
        }
        return map;
      }
    } catch (_) {}
  }

  if (tables.has('chapter_text_pack')) {
    return readChapterPack(dbTipitaka, bookCode, chapterIndex).sentMap;
  }

  return new Map();
}

function hydrateCanonRows(dbTipitaka, rows, fallbackBookCode = null) {
  if (!dbTipitaka || !Array.isArray(rows) || rows.length === 0) return rows;
  const needsHydration = rows.some((r) => r && (r.pali_text === null || r.pali_text === undefined));
  if (!needsHydration) return rows;

  const tables = getTableSet(dbTipitaka);
  if (!tables.has('chapter_text_pack')) return rows;

  for (const r of rows) {
    if (!r || (r.pali_text !== null && r.pali_text !== undefined)) continue;
    const bc = r.book_code || fallbackBookCode;
    if (!bc || r.chapter_index === undefined || r.chapter_index === null || r.para_index === undefined) continue;
    const { paliMap } = readChapterPack(dbTipitaka, bc, Number(r.chapter_index));
    const txt = paliMap.get(Number(r.para_index));
    if (txt !== undefined) {
      r.pali_text = txt;
    }
  }
  return rows;
}

function tryParseGuid(guid) {
  if (!guid) return null;
  const m = GUID_RE.exec(String(guid).trim());
  if (!m) return null;
  return {
    bookCode: m[1],
    chapterIndex: parseInt(m[2], 10),
    paraIndex: parseInt(m[3], 10),
  };
}

module.exports = {
  getTableSet,
  getColumnSet,
  decodeTextOrZlib,
  decodeChapterPackBlob,
  readChapterPack,
  hasChapterTransPack,
  decodeChapterTransPackBlob,
  readChapterTranslationPack,
  hasPaliSentencesSupport,
  readBookSentences,
  readChapterSentences,
  hydrateCanonRows,
  tryParseGuid,
};
