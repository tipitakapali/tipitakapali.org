'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Locate dictionary database directory (strictly server_api/db)
const DB_DIR = path.resolve(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
  console.warn('[DictEngine] Warning: Dictionary database directory not found at:', DB_DIR);
} else {
  console.log(`[DictEngine] Dictionary databases directory: ${DB_DIR}`);
}

// Database references
const dbs = {};
const tableChars = {};
let goldendict = null;

// Initialize databases
const DB_FILES = {
  DPD: 'dpd_tipitakapali.db',
  SYN: 'dpd_synonyms_tipitakapali.db',
  SPLI: 'dpd_splitter_tipitakapali.db',
  INF: 'dpd_inflection_tipitakapali.db',
  PTS: 'ptsped2015ed_tipitakapali.db',
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

function initDictDatabases() {
  if (!DB_DIR) return false;

  try {
    for (const [key, filename] of Object.entries(DB_FILES)) {
      const fullPath = path.join(DB_DIR, filename);
      if (fs.existsSync(fullPath)) {
        const db = new DatabaseSync(fullPath, { readOnly: true });
        db.exec(`
          PRAGMA synchronous = NORMAL;
          PRAGMA temp_store = MEMORY;
          PRAGMA query_only = 1;
        `);
        dbs[key] = db;
        tableChars[key] = getTableCharsFromDb(db);
        console.log(`[DictEngine] Connected ${key} (${tableChars[key].length} partition tables)`);
      } else {
        console.warn(`[DictEngine] Database file missing: ${fullPath}`);
      }
    }

    // Load goldendict helper if available
    const goldenPath = path.join(DB_DIR, 'dpd_goldendict.js');
    if (fs.existsSync(goldenPath)) {
      goldendict = require(goldenPath);
      console.log(`[DictEngine] Loaded DPD goldendict processor (${Object.keys(goldendict.family_root_json || {}).length} root families)`);
    }

    // Load dynamic DPD feedback template from misc table in DPD database (payload ##tipitakapalidpdfeedback)
    try {
      if (dbs.DPD) {
        const row = dbs.DPD.prepare("SELECT defi FROM misc WHERE word = '##tipitakapalidpdfeedback' LIMIT 1").get();
        if (row && row.defi) {
          dpdFeedbackTemplate = row.defi;
          console.log('[DictEngine] Loaded dynamic DPD feedback template from misc table');
        }
      }
    } catch (e) {
      console.warn('[DictEngine] Could not load dynamic feedback template from misc table:', e.message);
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
  if (word.length === 1) return '0000000z';

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

const DPD_FEEDBACK_TEMPLATE = `<p>ID <b>#tpo_id@ #tpo_word@</b></p><p>Digital Pāḷi Dictionary is a work in progress, made available for testing and feedback purposes.</p><p><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">Add a missing word</a><span>. Please use this </span><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">online form</a> to add missing words, especially from Vinaya, commentaries, and other later texts. If you prefer to work offline, here is a <a class="dpd-link" href="https://github.com/digitalpalidictionary/dpd-db/raw/main/misc/DPD%20Add%20Words.xlsx" download="true" target="_blank">spreadsheet to download</a><span>, fill in and submit. </span></p><p><a class="dpd-link" href="https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform?usp=pp_url&entry.438735500=#tpo_link@&entry.1433863141=Tipitakapali.org+2026-03-03" target="_blank">Correct a mistake</a><span>. Did you spot a mistake in the dictionary? Please report it. It generally takes less than a minute and your corrections and suggestions help to improve the quality of this dictionary for everyone who uses it.</span></p><p><a class="dpd-link" href="https://github.com/digitalpalidictionary/dpd-db/releases">Get updated</a><span>. You are using DPD Tipitakapali.org updated on <b>2026-03-03</b>. Check for an update every full moon uposatha day.</span></p><p><a class="dpd-link" href="https://digitalpalidictionary.github.io/">Visit the website</a><span>. Get more detailed information about installation and upgrades, advanced settings and features.</span></p><p><a class="dpd-link" href="mailto:digitalpalidictionary@gmail.com?subject=I'd%20like%20to%20help%20with%20code!&body=Please%20let%20me%20know%20how%20I%20can%20get%20involved%20with%20the%20development%20of%20DPD.">Help with coding</a><span>. If you're a coder and would like to support the project, please get in touch.</span></p><p><a class="dpd-link" href="mailto:digitalpalidictionary@gmail.com?subject=I%20want%20to%20help%20with%20DPD!&body=Please%20let%20me%20know%20how%20I%20can%20get%20involved%20with%20the%20development%20of%20DPD.">Help with Pāḷi</a><span>. If you have Pāḷi grammar skills and would like to assist, please make email contact.</span></p><p><a class="dpd-link" href="https://forms.gle/gJ7ouhJriYREPm1s8" target="_blank">Join the mailing list</a><span>. Get notified of updates and new features as soon as they become available.</span></p>`;

let dpdFeedbackTemplate = DPD_FEEDBACK_TEMPLATE;

const reDPDLinks = [
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#0@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSdAL2PzavyrtXgGmtNrZAMyh3hV6g3fU0chxhWFxunQEZtH0g/viewform', 'L#1@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform', 'L#2@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfKUBx-icfRCWmhHqUwzX60BVQE21s_NERNfU2VvbjEfE371A/viewform', 'L#3@'],
  ['https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform', 'L#4@'],
];

function restoreMinifiedLinksAndFeedback(html) {
  if (!html || typeof html !== 'string') return '';
  const regex = /#z3@(.*?)_fb@/g;
  let m;
  const feedbackMatchIds = [];
  while ((m = regex.exec(html)) !== null) {
    feedbackMatchIds.push([m[0], m[1]]);
  }

  feedbackMatchIds.forEach(([entireMatchStr, idAndLemma]) => {
    const [id, lemma] = (idAndLemma || '').split('=');
    let st = dpdFeedbackTemplate.replaceAll('#tpo_id@', id || '');
    st = st.replaceAll('#tpo_word@', lemma || '');
    st = st.replaceAll('#tpo_link@', (lemma || '').replaceAll(' ', '%20'));
    html = html.replace(entireMatchStr, st);
  });

  reDPDLinks.forEach(([link, code]) => {
    html = html.replaceAll(code, link);
  });

  // Normalize footer class names to dpd-footer and ensure closing tag
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

// Query synonyms for word
function getSynonyms(word) {
  if (!dbs.SYN) return [];
  try {
    const fchar = getFChar(word, 'SYN', false);
    const rows = dbs.SYN.prepare(`SELECT word FROM ${fchar} WHERE synonym = ?`).all(word);
    return rows.map((r) => r.word);
  } catch (e) {
    return [];
  }
}

// Single-word DPD Query
function lookupSingleDPD(word) {
  if (word.startsWith('##')) {
    try {
      const row = dbs.DPD.prepare("SELECT word, defi FROM misc WHERE word = ? LIMIT 1").get(word);
      if (row) {
        return [{ word: row.word, isExact: true, html: restoreMinifiedLinksAndFeedback(row.defi) }];
      }
    } catch (e) {
      console.error('[DictEngine] Error querying misc table for', word, e.message);
    }
    return [];
  }

  const syns = getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  for (const w of wordsToQuery) {
    const fchar = getFChar(w, 'DPD', false);
    try {
      const rows = dbs.DPD.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(w);
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
      console.error('[DictEngine] DPD lookup error for', w, 'table:', fchar, e.message);
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

// Query DPD Dictionary (supports multi-word phrases)
function lookupDPD(rawWord) {
  if (!dbs.DPD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleDPD(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleDPD(tok));
    }
    return results;
  }

  return lookupSingleDPD(word);
}

// Single-word PTS Query
function lookupSinglePTS(word) {
  const syns = getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  for (const w of wordsToQuery) {
    const fchar = getFChar(w, 'PTS', false);
    try {
      const rows = dbs.PTS.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(w);
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

// Query PTS PED Dictionary (supports multi-word phrases)
function lookupPTS(rawWord) {
  if (!dbs.PTS) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSinglePTS(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSinglePTS(tok));
    }
    return results;
  }

  return lookupSinglePTS(word);
}

// Single-word Abhidhān Query
function lookupSingleABD(word) {
  const syns = getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  for (const w of wordsToQuery) {
    const fchar = getFChar(w, 'ABD', false);
    try {
      const rows = dbs.ABD.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(w);
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

// Query Abhidhānappadīpikā (supports multi-word phrases)
function lookupABD(rawWord) {
  if (!dbs.ABD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSingleABD(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSingleABD(tok));
    }
    return results;
  }

  return lookupSingleABD(word);
}

// Single-word PSD Query
function lookupSinglePSD(word) {
  const syns = getSynonyms(word);
  const wordsToQuery = [...new Set([word, ...syns])];

  const exactMatches = [];
  const relatedMatches = [];

  for (const w of wordsToQuery) {
    const fchar = getFChar(w, 'PSD', false);
    try {
      const rows = dbs.PSD.prepare(`SELECT word, defi, source FROM ${fchar} WHERE word = ?`).all(w);
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

// Query Pāli-Sinhala Dictionary (supports multi-word phrases)
function lookupPSD(rawWord) {
  if (!dbs.PSD) return [];
  const word = normalizeDictWord(rawWord);
  if (!word) return [];

  if (word.includes(' ')) {
    const fullMatches = lookupSinglePSD(word);
    if (fullMatches.length > 0) return fullMatches;

    const tokens = [...new Set(word.split(/\s+/).filter(Boolean))].slice(0, 20);
    const results = [];
    for (const tok of tokens) {
      results.push(...lookupSinglePSD(tok));
    }
    return results;
  }

  return lookupSinglePSD(word);
}

// Single-word Sanskrit Query
function lookupSingleSANS(word) {
  const fchar = getFChar(word, 'SANS', false);
  const matches = [];

  try {
    const rows = dbs.SANS.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(word);
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
  if (!dbs.SANS) return [];
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

// Single-word Splitter Query
function lookupSingleSplitter(word) {
  const fchar = getFChar(word, 'SPLI', true);
  const results = [];

  try {
    const rows = dbs.SPLI.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(word);
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
  } catch (e) {
    console.error('[DictEngine] Splitter lookup error:', e.message);
  }

  return results;
}

// Query Splitter / Deconstructor (supports multi-word phrases)
function lookupSplitter(rawWord) {
  if (!dbs.SPLI) return [];
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
  if (!dbs.INF) return null;
  if (!rawQuery) return null;

  let clean = rawQuery.replace(/^(declension_|conjugation_)/, '').trim();
  const fchar = getFChar(clean, 'DPD', false);

  try {
    const row = dbs.INF.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).get(clean);
    if (row && row.defi) {
      return { word: row.word, query: rawQuery, html: row.defi };
    }

    // Fallback: try prefix before underscore (e.g. 'buddha_1' -> 'buddha')
    if (clean.includes('_')) {
      const baseWord = clean.split('_')[0];
      const baseFChar = getFChar(baseWord, 'DPD', false);
      const baseRow = dbs.INF.prepare(`SELECT word, defi FROM ${baseFChar} WHERE word = ?`).get(baseWord);
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
const dictCache = new Map();
const dpdCache = new Map();
const othersCache = new Map();

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
    if (cached) return cached;
  }

  const syns = getSynonyms(word);
  const dpd = lookupDPD(word, useSplitter);

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
    if (cached) return cached;
  }

  const pts = lookupPTS(word);
  const abd = lookupABD(word);
  const psd = lookupPSD(word);
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
  getSynonyms,
};
