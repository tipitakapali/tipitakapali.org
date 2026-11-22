'use strict';

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { convertAnyToRoman, normalizePaliForSearch } = require('./transliterate');

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

// Database references
const dbs = {};
const tableChars = {};
const stmtCache = new Map();
let goldendict = null;

function prepareCached(dbKey, sql) {
  const key = `${dbKey}:${sql}`;
  let stmt = stmtCache.get(key);
  if (!stmt) {
    stmt = dbs[dbKey].prepare(sql);
    stmtCache.set(key, stmt);
  }
  return stmt;
}

function groupWordsByPartition(words, dbKey, useSplitter = false) {
  const groups = new Map();
  for (const w of words) {
    const fchar = getFChar(w, dbKey, useSplitter);
    let list = groups.get(fchar);
    if (!list) {
      list = [];
      groups.set(fchar, list);
    }
    list.push(w);
  }
  return groups;
}

// Initialize databases
const DB_FILES = {
  DPD: 'dpd_tipitakapali.db',
  SYN: 'dpd_synonyms_tipitakapali.db',
  SPLI: 'dpd_splitter_tipitakapali.db',
  INF: 'dpd_inflection_tipitakapali.db',
  PTS: resolveDbPath('ptsped2015ed_tipitakapali.db') ? 'ptsped2015ed_tipitakapali.db' : 'legacy_ptsped2015ed_tipitakapali.db',
  ABD: 'abhidhan_tipitakapali.db',
  PSD: 'palisinh.db',
  SANS: 'ap_bh_mw_sanskrit.db',
};

function getTableCharsFromDb(db) {
  try {
    const query = `
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      AND name NOT IN ('sqlite_sequence', 'android_metadata', 'misc', 'synonyms', 'zmisc')
      AND name NOT LIKE 'sqlite_%'
    `;
    const tables = db.prepare(query).all();
    return tables.map((t) => t.name.slice(0, 3));
  } catch (e) {
    console.error('[DictEngine] Error querying tables from db:', e.message);
    return [];
  }
}

const DICT_SOURCE_IDS = {
  DPD: 0,
  SPLI: 1,
  PTS: 2,
  ABD: 3,
  PSD: 4,
  SANS: 5,
};

function decodeZlibOrText(val) {
  if (val === undefined || val === null) return '';
  if (Buffer.isBuffer(val)) return zlib.inflateSync(val).toString('utf8');
  if (val instanceof Uint8Array) return zlib.inflateSync(Buffer.from(val)).toString('utf8');
  return String(val);
}

function prefixUpperBound(prefix) {
  if (!prefix) return '\uFFFF';
  const last = prefix.charCodeAt(prefix.length - 1);
  return prefix.slice(0, -1) + String.fromCharCode(last + 1);
}

function extractShortPreview(rawDefi) {
  let html = String(rawDefi || '');
  if (!html) return null;
  if (html.startsWith('@')) {
    const secondAt = html.indexOf('@', 1);
    if (secondAt > 0) html = html.slice(secondAt + 1);
  }
  const summaryMatch = html.match(/<div[^>]*class=["']?dpd["']?[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  const raw = summaryMatch ? summaryMatch[1] : html;
  const plain = raw
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return plain.length > 96 ? `${plain.slice(0, 96)}…` : plain;
}

function initDictDatabases() {
  try {
    const unifiedPath = resolveDbPath('dictionaries.db');
    if (unifiedPath) {
      try {
        const udb = new Database(unifiedPath, { readonly: true });
        udb.exec(`
          PRAGMA synchronous = NORMAL;
          PRAGMA temp_store = MEMORY;
          PRAGMA query_only = 1;
          PRAGMA cache_size = -32000;
          PRAGMA mmap_size = 268435456;
        `);
        const hasEntries = udb
          .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='dict_entries' LIMIT 1")
          .get();
        if (hasEntries) {
          dbs.UNIFIED = udb;
          console.log(`[DictEngine] Connected UNIFIED V2 dictionary database from: ${unifiedPath}`);
        } else {
          udb.close();
        }
      } catch (e) {
        console.warn('[DictEngine] Failed to open dictionaries.db, falling back to legacy DBs:', e.message);
      }
    }

    if (!dbs.UNIFIED) {
      for (const [key, filename] of Object.entries(DB_FILES)) {
        const fullPath = resolveDbPath(filename);
        if (fullPath) {
          const db = new Database(fullPath, { readonly: true });
          db.exec(`
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA query_only = 1;
            PRAGMA cache_size = -16000;
            PRAGMA mmap_size = 268435456;
          `);
          dbs[key] = db;
          tableChars[key] = getTableCharsFromDb(db);
          console.log(`[DictEngine] Connected ${key} (${tableChars[key].length} partition tables) from: ${fullPath}`);
        } else {
          console.warn(`[DictEngine] Database file missing for ${key}: ${filename}`);
        }
      }
    }

    // Load goldendict helper if available
    const goldenPath = resolveDbPath('dpd_goldendict.js');
    if (goldenPath) {
      goldendict = require(goldenPath);
      console.log(`[DictEngine] Loaded DPD goldendict processor (${Object.keys(goldendict.family_root_json || {}).length} root families) from: ${goldenPath}`);
    }

    return true;
  } catch (err) {
    console.error('[DictEngine] Initialization failed:', err);
    return false;
  }
}

// Prefix partition helper
function getFChar(word, dbKey, useSplitter = false) {
  const chars = tableChars[dbKey] || [];
  if (!word || word.length === 0) return 'misc';
  if (word.length === 1) return chars.includes('0000000z') ? '0000000z' : 'misc';

  let prefix = word.slice(0, 2) + 'z';
  if (useSplitter) {
    if (prefix === 'misc' || !chars.includes(prefix)) {
      return 'zmisc';
    }
  } else {
    if (!chars.includes(prefix)) {
      return 'misc';
    }
  }
  return prefix;
}
const reDPDLinks = [
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#0@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSdAL2PzavyrtXgGmtNrZAMyh3hV6g3fU0chxhWFxunQEZtH0g/viewform', 'L#1@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#2@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfKUBx-icfRCWmhHqUwzX60BVQE21s_NERNfU2VvbjEfE371A/viewform', 'L#3@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform', 'L#4@'],
];

// Server-side: only restore minified links and footer classes.
// Feedback template (#z3@{id}={lemma}_fb@) is left as-is for client-side replacement
// via services/dpdFeedback.js (fetched once on first visit from ##tipitakapalidpdfeedback).
function restoreMinifiedLinksAndFeedback(html) {
  if (!html || typeof html !== 'string') return '';

  // Restore minified link codes L#0@ through L#4@
  reDPDLinks.forEach(([link, code]) => {
    html = html.replaceAll(code, link);
  });

  // Normalize footer class names to dpd-footer
  html = html.replaceAll('class=footer', 'class="dpd-footer"');
  html = html.replaceAll('class="footer"', 'class="dpd-footer"');

  return html;
}

// Restore DPD encoded json/family data
function restoreDpdDefi(df) {
  if (!df || typeof df !== 'string') return '';
  if (!df.startsWith('@')) return restoreMinifiedLinksAndFeedback(df);

  const secondIndex = df.indexOf('@', 1);
  if (secondIndex <= 0) return restoreMinifiedLinksAndFeedback(df);

  const jsonString = df.slice(1, secondIndex);
  let defi = df.slice(secondIndex + 1);

  if (!goldendict) return restoreMinifiedLinksAndFeedback(defi);

  try {
    const fData = JSON.parse(jsonString);
    if (Object.keys(fData).length <= 2) return restoreMinifiedLinksAndFeedback(defi);

    const lemma = fData.lemma;
    if (fData.family_compounds && goldendict.makeFamilyCompoundHtml) {
      defi = defi.replaceAll(`${lemma}_fc`, goldendict.makeFamilyCompoundHtml(fData));
    }
    if (fData.family_idioms && goldendict.makeFamilyIdioms) {
      defi = defi.replaceAll(`${lemma}_fi`, goldendict.makeFamilyIdioms(fData));
    }
    if (fData.family_root && goldendict.makeFamilyRootHtml && goldendict.family_root_json?.[fData.family_root]) {
      defi = defi.replaceAll(`${lemma}_fr`, goldendict.makeFamilyRootHtml(fData, goldendict.family_root_json[fData.family_root]));
    }
    if (fData.family_sets && goldendict.makeFamilySets) {
      defi = defi.replaceAll(`${lemma}_fs`, goldendict.makeFamilySets(fData));
    }
    if (fData.family_word && goldendict.makeFamilyWordHtml) {
      defi = defi.replaceAll(`${lemma}_fw`, goldendict.makeFamilyWordHtml(fData));
    }
  } catch (e) {
    console.error('[DictEngine] Error restoring DPD family data:', e.message);
  }

  return restoreMinifiedLinksAndFeedback(defi);
}

// Query synonyms for word — with in-memory LRU to share across DPD + others (single DB hit per word)
const SYN_CACHE_MAX = 3000;
const synCache = new Map();
function getSynonyms(word) {
  if (!dbs.UNIFIED && !dbs.SYN) return [];
  if (synCache.has(word)) {
    const cached = synCache.get(word);
    synCache.delete(word);
    synCache.set(word, cached);
    return cached;
  }
  try {
    let result = [];
    if (dbs.UNIFIED) {
      const rows = prepareCached('UNIFIED', 'SELECT word FROM dict_synonyms WHERE synonym = ? LIMIT 64').all(word);
      result = rows.map((r) => r.word);
    } else {
      const fchar = getFChar(word, 'SYN', false);
      const rows = prepareCached('SYN', `SELECT word FROM "${fchar}" WHERE synonym = ?`).all(word);
      result = rows.map((r) => r.word);
    }
    if (synCache.size >= SYN_CACHE_MAX) {
      const firstKey = synCache.keys().next().value;
      synCache.delete(firstKey);
    }
    synCache.set(word, result);
    return result;
  } catch (e) {
    return [];
  }
}

function queryUnifiedEntries(wordsToQuery, sourceId) {
  const unique = wordsToQuery.filter(Boolean);
  if (!dbs.UNIFIED || unique.length === 0) return [];
  const out = [];
  const chunkSize = 400;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = prepareCached(
      'UNIFIED',
      `SELECT word, defi_z FROM dict_entries WHERE source_id = ? AND word IN (${placeholders})`
    ).all(sourceId, ...chunk);
    for (const r of rows) {
      out.push({ word: r.word, defi: decodeZlibOrText(r.defi_z) });
    }
  }
  return out;
}

// Single-word DPD Query — accepts cachedSyns to avoid duplicate SYN query (see lookupDPDFast/lookupOthers)
function lookupSingleDPD(word, cachedSyns = null) {
  if (word.startsWith('##')) {
    try {
      if (dbs.UNIFIED) {
        const row = prepareCached(
          'UNIFIED',
          'SELECT word, defi_z FROM dict_entries WHERE source_id = ? AND word = ? LIMIT 1'
        ).get(DICT_SOURCE_IDS.DPD, word);
        if (row) {
          return [{ word: row.word, isExact: true, html: restoreMinifiedLinksAndFeedback(decodeZlibOrText(row.defi_z)) }];
        }
        return [];
      }
      const row = prepareCached('DPD', 'SELECT word, defi FROM misc WHERE word = ? LIMIT 1').get(word);
      if (row) {
        return [{ word: row.word, isExact: true, html: restoreMinifiedLinksAndFeedback(row.defi) }];
      }
    } catch (e) {
      console.error('[DictEngine] Error querying misc table for', word, e.message);
    }
    return [];
  }

  const syns = cachedSyns !== null ? cachedSyns : getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  if (dbs.UNIFIED) {
    try {
      const rows = queryUnifiedEntries(wordsToQuery, DICT_SOURCE_IDS.DPD);
      for (const r of rows) {
        let df = restoreDpdDefi(r.defi);
        const isExact = r.word.toLowerCase() === word;
        if (isExact) {
          df = df.replaceAll('class=p1w', 'class=p2w');
          exactMatches.push({ word: r.word, isExact: true, html: df });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html: df });
        }
      }
    } catch (e) {
      console.error('[DictEngine] DPD V2 lookup error for', word, e.message);
    }
    return [...exactMatches, ...relatedMatches];
  }

  for (const [fchar, groupWords] of groupWordsByPartition(wordsToQuery, 'DPD', false)) {
    try {
      const placeholders = groupWords.map(() => '?').join(',');
      const rows = prepareCached(
        'DPD',
        `SELECT word, defi FROM "${fchar}" WHERE word IN (${placeholders})`
      ).all(...groupWords);
      for (const r of rows) {
        let df = restoreDpdDefi(r.defi);
        const isExact = r.word.toLowerCase() === word;
        if (isExact) {
          df = df.replaceAll('class=p1w', 'class=p2w');
          exactMatches.push({ word: r.word, isExact: true, html: df });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html: df });
        }
      }
    } catch (e) {
      console.error('[DictEngine] DPD lookup error for', groupWords.join(','), 'table:', fchar, e.message);
    }
  }

  return [...exactMatches, ...relatedMatches];
}

function normalizeDictWord(rawWord) {
  if (!rawWord || typeof rawWord !== 'string') return '';
  if (rawWord.startsWith('##')) return rawWord.trim();
  let text = rawWord;
  // 1. Replace all ṁ / Ṁ with ṃ
  text = text.replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'ṃ');
  // 2. Separate attached quote particles e.g. ’’ti, ’ti, ”ti, ’’pi, ’va
  text = text.replace(/([’'”"»›]+)(ti|pi|va|eva|iti|api|nti|တိ|ති|ति)\b/gi, ' $2');
  // 3. Strip quotes
  text = text.replace(/[‘’“”"''`«»‹›„]/g, ' ');
  // 4. Strip punctuation
  text = text.replace(/[.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`၊။]/g, ' ');
  // 5. Clean leading root symbols
  text = text.replace(/^[√\s\d.-]+/, ' ');
  // 6. Lowercase & trim
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Query DPD Dictionary (supports multi-word phrases) — cachedSyns reused from caller to avoid duplicate SYN hit
function lookupDPD(rawWord, cachedSyns = null) {
  if (!dbs.UNIFIED && !dbs.DPD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleDPD(word, cachedSyns);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleDPD(tok));
    }
    return results;
  }

  return lookupSingleDPD(word, cachedSyns);
}

// Single-word PTS Query — accepts cachedSyns (shared synonym lookup)
function lookupSinglePTS(word, cachedSyns = null) {
  const syns = cachedSyns !== null ? cachedSyns : getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  if (dbs.UNIFIED) {
    try {
      for (const r of queryUnifiedEntries(wordsToQuery, DICT_SOURCE_IDS.PTS)) {
        const isExact = r.word.toLowerCase() === word;
        const html = `<div class="pts15"><span class="${isExact ? 'pp2w' : 'pp1w'}">${r.word}</span><br>${r.defi}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] PTS V2 lookup error:', e.message);
    }
    return [...exactMatches, ...relatedMatches];
  }

  for (const [fchar, groupWords] of groupWordsByPartition(wordsToQuery, 'PTS', false)) {
    try {
      const placeholders = groupWords.map(() => '?').join(',');
      const rows = prepareCached(
        'PTS',
        `SELECT word, defi FROM "${fchar}" WHERE word IN (${placeholders})`
      ).all(...groupWords);
      for (const r of rows) {
        const isExact = r.word.toLowerCase() === word;
        const html = `<div class="pts15"><span class="${isExact ? 'pp2w' : 'pp1w'}">${r.word}</span><br>${r.defi}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] PTS lookup error:', e.message);
    }
  }

  return [...exactMatches, ...relatedMatches];
}

// Query PTS PED Dictionary (supports multi-word phrases) — cachedSyns shared
function lookupPTS(rawWord, cachedSyns = null) {
  if (!dbs.UNIFIED && !dbs.PTS) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSinglePTS(word, cachedSyns);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSinglePTS(tok));
    }
    return results;
  }

  return lookupSinglePTS(word, cachedSyns);
}

// Single-word Abhidhān Query — accepts cachedSyns
function lookupSingleABD(word, cachedSyns = null) {
  const syns = cachedSyns !== null ? cachedSyns : getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  if (dbs.UNIFIED) {
    try {
      for (const r of queryUnifiedEntries(wordsToQuery, DICT_SOURCE_IDS.ABD)) {
        const isExact = r.word.toLowerCase() === word;
        const html = `<div class="tmmAbhidhan"><span class="${isExact ? 'pm2w' : 'pm1w'}">${r.word}</span><br>${r.defi}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] ABD V2 lookup error:', e.message);
    }
    return [...exactMatches, ...relatedMatches];
  }

  for (const [fchar, groupWords] of groupWordsByPartition(wordsToQuery, 'ABD', false)) {
    try {
      const placeholders = groupWords.map(() => '?').join(',');
      const rows = prepareCached(
        'ABD',
        `SELECT word, defi FROM "${fchar}" WHERE word IN (${placeholders})`
      ).all(...groupWords);
      for (const r of rows) {
        const isExact = r.word.toLowerCase() === word;
        const html = `<div class="tmmAbhidhan"><span class="${isExact ? 'pm2w' : 'pm1w'}">${r.word}</span><br>${r.defi}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] ABD lookup error:', e.message);
    }
  }

  return [...exactMatches, ...relatedMatches];
}

// Query Abhidhānappadīpikā (supports multi-word phrases) — cachedSyns shared
function lookupABD(rawWord, cachedSyns = null) {
  if (!dbs.UNIFIED && !dbs.ABD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleABD(word, cachedSyns);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleABD(tok));
    }
    return results;
  }

  return lookupSingleABD(word, cachedSyns);
}

// Single-word PSD Query — accepts cachedSyns
function lookupSinglePSD(word, cachedSyns = null) {
  const syns = cachedSyns !== null ? cachedSyns : getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  if (dbs.UNIFIED) {
    try {
      for (const r of queryUnifiedEntries(wordsToQuery, DICT_SOURCE_IDS.PSD)) {
        const isExact = r.word.toLowerCase() === word;
        let df = r.defi;
        if (isExact) {
          df = df.replaceAll('class=psdW', 'class=p2w');
        }
        const html = `<div class="psinh26">${df}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, source: '', html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, source: '', html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] PSD V2 lookup error:', e.message);
    }
    return [...exactMatches, ...relatedMatches];
  }

  for (const [fchar, groupWords] of groupWordsByPartition(wordsToQuery, 'PSD', false)) {
    try {
      const placeholders = groupWords.map(() => '?').join(',');
      const rows = prepareCached(
        'PSD',
        `SELECT word, defi, source FROM "${fchar}" WHERE word IN (${placeholders})`
      ).all(...groupWords);
      for (const r of rows) {
        const isExact = r.word.toLowerCase() === word;
        let df = r.defi;
        if (isExact) {
          df = df.replaceAll('class=psdW', 'class=p2w');
        }
        const html = `<div class="psinh26">${df}</div>`;
        if (isExact) {
          exactMatches.push({ word: r.word, isExact: true, source: r.source, html });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, source: r.source, html });
        }
      }
    } catch (e) {
      console.error('[DictEngine] PSD lookup error:', e.message);
    }
  }

  return [...exactMatches, ...relatedMatches];
}

// Query Pāli-Sinhala Dictionary (supports multi-word phrases) — cachedSyns shared
function lookupPSD(rawWord, cachedSyns = null) {
  if (!dbs.UNIFIED && !dbs.PSD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSinglePSD(word, cachedSyns);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSinglePSD(tok));
    }
    return results;
  }

  return lookupSinglePSD(word, cachedSyns);
}

// Single-word Sanskrit Query
function lookupSingleSANS(word) {
  const matches = [];

  if (dbs.UNIFIED) {
    try {
      const rows = prepareCached(
        'UNIFIED',
        'SELECT word, defi_z FROM dict_entries WHERE source_id = ? AND word = ?'
      ).all(DICT_SOURCE_IDS.SANS, word);
      for (const r of rows) {
        const isExact = r.word.toLowerCase() === word;
        let df = decodeZlibOrText(r.defi_z);
        if (isExact) {
          df = df.replaceAll('class=p1w', 'class=p3w');
        }
        const html = `<div class="sanskritSection">${df}</div>`;
        matches.push({ word: r.word, isExact, html });
      }
    } catch (e) {
      console.error('[DictEngine] SANS V2 lookup error:', e.message);
    }
    return matches;
  }

  const fchar = getFChar(word, 'SANS', false);
  try {
    const rows = prepareCached('SANS', `SELECT word, defi FROM "${fchar}" WHERE word = ?`).all(word);
    for (const r of rows) {
      const isExact = r.word.toLowerCase() === word;
      let df = r.defi;
      if (isExact) {
        df = df.replaceAll('class=p1w', 'class=p3w');
      }
      const html = `<div class="sanskritSection">${df}</div>`;
      matches.push({ word: r.word, isExact, html });
    }
  } catch (e) {
    console.error('[DictEngine] SANS lookup error:', e.message);
  }

  return matches;
}

// Query Sanskrit (supports multi-word phrases)
function lookupSANS(rawWord) {
  if (!dbs.UNIFIED && !dbs.SANS) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleSANS(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleSANS(tok));
    }
    return results;
  }

  return lookupSingleSANS(word);
}

function formatSplitterRows(rows) {
  const results = [];
  for (const r of rows) {
    const elements = (r.defi || '').split('@').filter((x) => x && x.trim().length > 0);
    const decHtml = elements
      .map((el) => `<p class="dec">${el.replaceAll('+', ' <span class="dec-plus">+</span> ')}</p>`)
      .join('');

    const encodedWord = encodeURIComponent(r.word);
    const improveLink = `https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform?usp=pp_url&entry.438735500=${encodedWord}&entry.326955045=Deconstructor&entry.1433863141=Tipitakapali.org%209999-12-12`;

    const html = `
        <div class="dpd-splitter-section">
          <div class="splitter-headword">
            <span class="p2w font-bold text-indigo-600 dark:text-indigo-400 text-sm sm:text-base">${r.word}</span>
          </div>
          <div class="splitter-body mt-2 space-y-1.5">
            ${decHtml}
          </div>
          <p class="dpd-footer">These DPD word breakups are code-generated. <a href="${improveLink}" class="link" target="_blank">Improve it</a>.</p>
        </div>
      `;
    results.push({
      word: r.word,
      isExact: true,
      isSplitter: true,
      breakups: elements,
      html,
    });
  }
  return results;
}

// Single-word Splitter Query
function lookupSingleSplitter(word) {
  if (dbs.UNIFIED) {
    try {
      const rows = prepareCached(
        'UNIFIED',
        'SELECT word, defi_z FROM dict_entries WHERE source_id = ? AND word = ?'
      ).all(DICT_SOURCE_IDS.SPLI, word);
      return formatSplitterRows(
        rows.map((r) => ({ word: r.word, defi: decodeZlibOrText(r.defi_z) }))
      );
    } catch (e) {
      console.error('[DictEngine] Splitter V2 lookup error:', e.message);
      return [];
    }
  }

  const fchar = getFChar(word, 'SPLI', true);
  try {
    const rows = prepareCached('SPLI', `SELECT word, defi FROM "${fchar}" WHERE word = ?`).all(word);
    return formatSplitterRows(rows);
  } catch (e) {
    console.error('[DictEngine] Splitter lookup error:', e.message);
    return [];
  }
}

// Query Splitter / Deconstructor (supports multi-word phrases)
function lookupSplitter(rawWord) {
  if (!dbs.UNIFIED && !dbs.SPLI) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleSplitter(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleSplitter(tok));
    }
    return results;
  }

  return lookupSingleSplitter(word);
}

// Query Inflection table (declension & conjugation)
function lookupINF(rawQuery) {
  if (!dbs.UNIFIED && !dbs.INF) return null;
  if (!rawQuery) return null;

  let clean = rawQuery.replace(/^(declension_|conjugation_)/, '').trim();

  if (dbs.UNIFIED) {
    try {
      const row = prepareCached(
        'UNIFIED',
        'SELECT word, html_z FROM dict_inflections WHERE key = ? LIMIT 1'
      ).get(clean);
      if (row && row.html_z) {
        return { word: row.word, query: rawQuery, html: decodeZlibOrText(row.html_z) };
      }
      if (clean.includes('_')) {
        const baseWord = clean.split('_')[0];
        const baseRow = prepareCached(
          'UNIFIED',
          'SELECT word, html_z FROM dict_inflections WHERE key = ? LIMIT 1'
        ).get(baseWord);
        if (baseRow && baseRow.html_z) {
          return { word: baseRow.word, query: rawQuery, html: decodeZlibOrText(baseRow.html_z) };
        }
      }
    } catch (e) {
      console.error('[DictEngine] INF V2 lookup error for', rawQuery, e.message);
    }
    return null;
  }

  const fchar = getFChar(clean, 'DPD', false);

  try {
    const row = prepareCached('INF', `SELECT word, defi FROM "${fchar}" WHERE word = ?`).get(clean);
    if (row && row.defi) {
      return { word: row.word, query: rawQuery, html: row.defi };
    }

    // Fallback: try prefix before underscore (e.g. 'buddha_1' -> 'buddha')
    if (clean.includes('_')) {
      const baseWord = clean.split('_')[0];
      const baseFChar = getFChar(baseWord, 'DPD', false);
      const baseRow = prepareCached('INF', `SELECT word, defi FROM "${baseFChar}" WHERE word = ?`).get(baseWord);
      if (baseRow && baseRow.defi) {
        return { word: baseRow.word, query: rawQuery, html: baseRow.defi };
      }
    }
  } catch (e) {
    console.error('[DictEngine] INF lookup error for', rawQuery, 'table:', fchar, e.message);
  }

  return null;
}

// Server In-Memory Dictionary Cache: Re-enabled for sub-millisecond lookups
const ENABLE_DICT_CACHE = true;

// Bounded in-memory LRU caches for dictionary queries (< 0.01ms response time)
const DICT_CACHE_MAX = 3000;
const SUGGEST_CACHE_MAX = 1500;
const dictCache = new Map();
const dpdCache = new Map();
const othersCache = new Map();
const suggestCache = new Map();

function diacriticCharVariants(ch) {
  switch (ch) {
    case 'a': case 'ā': return ['a', 'ā'];
    case 'i': case 'ī': return ['i', 'ī'];
    case 'u': case 'ū': return ['u', 'ū'];
    case 't': case 'ṭ': return ['t', 'ṭ'];
    case 'd': case 'ḍ': return ['d', 'ḍ'];
    case 'n': case 'ṇ': case 'ñ': case 'ṅ': return ['n', 'ṇ', 'ñ', 'ṅ'];
    case 'm': case 'ṃ': case 'ṁ': return ['m', 'ṃ', 'ṁ'];
    case 'l': case 'ḷ': return ['l', 'ḷ'];
    default: return [ch];
  }
}

function buildDiacriticGlob(foldedQuery) {
  let out = '';
  for (let i = 0; i < foldedQuery.length; i++) {
    const ch = foldedQuery[i];
    const vars = diacriticCharVariants(ch);
    if (vars.length > 1) {
      out += `[${vars.join('')}]`;
    } else if (ch === '[' || ch === '*' || ch === '?') {
      out += `[${ch}]`;
    } else {
      out += ch;
    }
  }
  return `${out}*`;
}

function expandDiacriticPrefixTables(foldedQuery, tables) {
  if (foldedQuery.length < 2) return [];
  const firstVars = diacriticCharVariants(foldedQuery[0]);
  const secondVars = diacriticCharVariants(foldedQuery[1]);
  const out = [];
  for (const c1 of firstVars) {
    for (const c2 of secondVars) {
      const cand = `${c1}${c2}z`;
      if (tables.includes(cand)) out.push(cand);
    }
  }
  return out;
}

function suggestWords(rawPrefix, rawLimit = 15) {
  const parsedLimit = Number.isFinite(Number(rawLimit)) ? Math.floor(Number(rawLimit)) : 15;
  const limit = Math.min(Math.max(parsedLimit, 1), 30);
  const romanized = convertAnyToRoman(rawPrefix || '');
  const clean = normalizeDictWord(romanized);
  if (clean.length < 2 || clean.startsWith('##')) {
    return { query: clean, suggestions: [] };
  }

  const cacheKey = `${clean}|${limit}`;
  if (ENABLE_DICT_CACHE) {
    const cached = suggestCache.get(cacheKey);
    if (cached) {
      suggestCache.delete(cacheKey);
      suggestCache.set(cacheKey, cached);
      return cached;
    }
  }

  const foldedQuery = normalizePaliForSearch(clean);
  const results = [];
  const seen = new Set();

  const addCandidate = (word, rawDefi) => {
    const w = String(word || '').trim();
    if (!w) return;
    const key = w.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const isExact =
      key === clean ||
      (foldedQuery.length > 0 && normalizePaliForSearch(key) === foldedQuery);
    results.push({
      word: w,
      preview: rawDefi ? extractShortPreview(rawDefi) : null,
      isExact,
    });
  };

  if (dbs.UNIFIED) {
    try {
      const cleanUpper = prefixUpperBound(clean);
      const exactRows = prepareCached(
        'UNIFIED',
        'WITH top_words AS (' +
          '  SELECT word, MIN(source_id * 1000000000 + id) AS best_key ' +
          '  FROM dict_entries ' +
          '  WHERE source_id IN (0, 2) AND word >= ? AND word < ? ' +
          '  GROUP BY word ' +
          '  ORDER BY CASE WHEN word = ? THEN 0 ELSE 1 END, length(word), word ' +
          '  LIMIT ?' +
          ') ' +
          'SELECT d.word, d.defi_z ' +
          'FROM top_words t ' +
          'JOIN dict_entries d ON d.id = (t.best_key % 1000000000) ' +
          'ORDER BY CASE WHEN d.word = ? THEN 0 ELSE 1 END, length(d.word), d.word'
      ).all(clean, cleanUpper, clean, limit, clean);
      for (const r of exactRows) {
        addCandidate(r.word, decodeZlibOrText(r.defi_z));
        if (results.length >= limit) break;
      }

      if (foldedQuery.length >= 2 && (clean === foldedQuery || results.length < limit)) {
        const foldedUpper = prefixUpperBound(foldedQuery);
        const foldedRows = prepareCached(
          'UNIFIED',
          'WITH top_words AS (' +
            '  SELECT word, MIN(source_id * 1000000000 + id) AS best_key ' +
            '  FROM dict_entries ' +
            '  WHERE source_id IN (0, 2) AND folded >= ? AND folded < ? ' +
            '  GROUP BY word ' +
            '  ORDER BY length(word), word ' +
            '  LIMIT ?' +
            ') ' +
            'SELECT d.word, d.defi_z ' +
            'FROM top_words t ' +
            'JOIN dict_entries d ON d.id = (t.best_key % 1000000000) ' +
            'ORDER BY length(d.word), d.word'
        ).all(foldedQuery, foldedUpper, limit * 2);
        for (const r of foldedRows) {
          addCandidate(r.word, decodeZlibOrText(r.defi_z));
        }
      }
    } catch (e) {
      console.error('[DictEngine] suggest V2 error:', e.message);
    }
  } else {
    const queryLegacy = (dbKey) => {
      if (!dbs[dbKey]) return;
      const chars = tableChars[dbKey] || [];
      const escGlob = clean.replace(/\[/g, '[[]').replace(/\*/g, '[*]').replace(/\?/g, '[?]');
      const primaryTable = getFChar(clean, dbKey, false);
      if (chars.includes(primaryTable) || primaryTable === 'misc') {
        try {
          const rows = prepareCached(
            dbKey,
            `SELECT word, MIN(defi) AS defi FROM "${primaryTable}" ` +
              'WHERE word GLOB ? GROUP BY word ' +
              'ORDER BY CASE WHEN word = ? THEN 0 ELSE 1 END, length(word), word LIMIT ?'
          ).all(`${escGlob}*`, clean, limit);
          for (const r of rows) {
            addCandidate(r.word, r.defi);
            if (results.length >= limit) break;
          }
        } catch (_) {}
      }
      if (foldedQuery.length >= 2 && (clean === foldedQuery || results.length < limit)) {
        const diacriticGlob = buildDiacriticGlob(foldedQuery);
        const candidateTables = expandDiacriticPrefixTables(foldedQuery, chars);
        const perTableLimit = candidateTables.length > 1 ? Math.min(limit, 8) : limit;
        for (const t of candidateTables) {
          try {
            const rows = prepareCached(
              dbKey,
              `SELECT word, MIN(defi) AS defi FROM "${t}" ` +
                'WHERE word GLOB ? GROUP BY word ' +
                'ORDER BY length(word), word LIMIT ?'
            ).all(diacriticGlob, perTableLimit);
            for (const r of rows) {
              addCandidate(r.word, r.defi);
            }
          } catch (_) {}
        }
      }
    };
    queryLegacy('DPD');
    if (results.length < limit) {
      queryLegacy('PTS');
    }
  }

  results.sort((a, b) => {
    if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
    const aPrefix = a.word.toLowerCase().startsWith(clean);
    const bPrefix = b.word.toLowerCase().startsWith(clean);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    if (a.word.length !== b.word.length) return a.word.length - b.word.length;
    return a.word.localeCompare(b.word);
  });

  const payload = {
    query: clean,
    suggestions: results.slice(0, limit),
  };

  if (ENABLE_DICT_CACHE) {
    if (suggestCache.size >= SUGGEST_CACHE_MAX) {
      const firstKey = suggestCache.keys().next().value;
      suggestCache.delete(firstKey);
    }
    suggestCache.set(cacheKey, payload);
  }
  return payload;
}

// Priority 1: Fast DPD lookup (Digital Pāḷi Dictionary + Synonyms)
function lookupDPDFast(rawWord, useSplitter = false) {
  const word = normalizeDictWord(rawWord);
  if (!word) {
    return {
      word: '',
      hasResults: false,
      synonyms: [],
      counts: { dpd: 0, pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
      dpd: [],
      pts: [],
      abd: [],
      psd: [],
      sans: [],
      splitter: [],
    };
  }

  const cacheKey = `${word}_${useSplitter ? '1' : '0'}`;
  if (ENABLE_DICT_CACHE) {
    const cached = dpdCache.get(cacheKey);
    if (cached) {
      dpdCache.delete(cacheKey);
      dpdCache.set(cacheKey, cached);
      return cached;
    }
  }

  const syns = getSynonyms(word);
  const dpd = lookupDPD(word, syns);

  const result = {
    word,
    hasResults: dpd.length > 0,
    synonyms: syns,
    counts: {
      dpd: dpd.length,
      pts: 0,
      abd: 0,
      psd: 0,
      sans: 0,
      splitter: 0,
    },
    dpd,
    pts: [],
    abd: [],
    psd: [],
    sans: [],
    splitter: [],
  };

  if (ENABLE_DICT_CACHE) {
    if (dpdCache.size >= DICT_CACHE_MAX) {
      const firstKey = dpdCache.keys().next().value;
      dpdCache.delete(firstKey);
    }
    dpdCache.set(cacheKey, result);
  }

  return result;
}

// Priority 2: Async background lookup for secondary dictionaries (PTS, ABD, PSD, SANS, Splitter)
function lookupOthers(rawWord) {
  const word = normalizeDictWord(rawWord);
  if (!word) {
    return {
      word: '',
      hasResults: false,
      counts: { pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
      pts: [],
      abd: [],
      psd: [],
      sans: [],
      splitter: [],
    };
  }

  if (ENABLE_DICT_CACHE) {
    const cached = othersCache.get(word);
    if (cached) {
      othersCache.delete(word);
      othersCache.set(word, cached);
      return cached;
    }
  }

  // Share single SYN lookup across PTS/ABD/PSD (synCache ensures cross-request reuse too)
  const sharedSyns = getSynonyms(word);
  const pts = lookupPTS(word, sharedSyns);
  const abd = lookupABD(word, sharedSyns);
  const psd = lookupPSD(word, sharedSyns);
  const sans = lookupSANS(word);
  const splitter = lookupSplitter(word);

  const result = {
    word,
    hasResults: pts.length > 0 || abd.length > 0 || psd.length > 0 || sans.length > 0 || splitter.length > 0,
    counts: {
      pts: pts.length,
      abd: abd.length,
      psd: psd.length,
      sans: sans.length,
      splitter: splitter.length,
    },
    pts,
    abd,
    psd,
    sans,
    splitter,
  };

  if (ENABLE_DICT_CACHE) {
    if (othersCache.size >= DICT_CACHE_MAX) {
      const firstKey = othersCache.keys().next().value;
      othersCache.delete(firstKey);
    }
    othersCache.set(word, result);
  }

  return result;
}

function lookupAll(rawWord) {
  const word = normalizeDictWord(rawWord);
  if (!word) {
    return {
      word: '',
      hasResults: false,
      synonyms: [],
      counts: { dpd: 0, pts: 0, abd: 0, psd: 0, sans: 0, splitter: 0 },
      dpd: [],
      pts: [],
      abd: [],
      psd: [],
      sans: [],
      splitter: [],
    };
  }

  if (ENABLE_DICT_CACHE) {
    const cached = dictCache.get(word);
    if (cached) {
      dictCache.delete(word);
      dictCache.set(word, cached);
      return cached;
    }
  }

  const dpdRes = lookupDPDFast(word);
  const othersRes = lookupOthers(word);

  const result = {
    word,
    hasResults: dpdRes.hasResults || othersRes.hasResults,
    synonyms: dpdRes.synonyms,
    counts: {
      dpd: dpdRes.counts.dpd,
      pts: othersRes.counts.pts,
      abd: othersRes.counts.abd,
      psd: othersRes.counts.psd,
      sans: othersRes.counts.sans,
      splitter: othersRes.counts.splitter,
    },
    dpd: dpdRes.dpd,
    pts: othersRes.pts,
    abd: othersRes.abd,
    psd: othersRes.psd,
    sans: othersRes.sans,
    splitter: othersRes.splitter,
  };

  if (ENABLE_DICT_CACHE) {
    if (dictCache.size >= DICT_CACHE_MAX) {
      const firstKey = dictCache.keys().next().value;
      dictCache.delete(firstKey);
    }
    dictCache.set(word, result);
  }

  return result;
}

function closeDatabases() {
  stmtCache.clear();
  synCache.clear();
  dictCache.clear();
  dpdCache.clear();
  othersCache.clear();
  suggestCache.clear();
  for (const [key, dbInstance] of Object.entries(dbs)) {
    try {
      if (dbInstance && typeof dbInstance.close === 'function') {
        dbInstance.close();
      }
    } catch (e) {}
    delete dbs[key];
    delete tableChars[key];
  }
}

// Initialize on module import
initDictDatabases();

module.exports = {
  initDictDatabases,
  lookupAll,
  lookupDPDFast,
  lookupOthers,
  lookupDPD,
  lookupPTS,
  lookupABD,
  lookupPSD,
  lookupSANS,
  lookupINF,
  lookupSplitter,
  suggestWords,
  getSynonyms,
  closeDatabases,
};
