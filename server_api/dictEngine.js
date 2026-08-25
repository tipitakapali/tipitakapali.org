'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Locate dictionary database directory
const CANDIDATE_DIRS = [
  process.env.DICT_DB_DIR,
  path.resolve(__dirname, '..', '..', 'ref', 'apitipitakapali', 'db'),
  path.resolve(__dirname, '..', 'ref', 'apitipitakapali', 'db'),
  path.resolve(__dirname, 'dict_db'),
  '/home/administrator/tipitaka-xml-vri/ref/apitipitakapali/db',
].filter(Boolean);

let DB_DIR = CANDIDATE_DIRS.find((d) => fs.existsSync(d));
if (!DB_DIR) {
  console.warn('[DictEngine] Warning: Dictionary database directory not found in candidate locations:', CANDIDATE_DIRS);
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

const DPD_FEEDBACK_TEMPLATE = `<p>ID <b>#tpo_id@ #tpo_word@</b></p><p>Digital Pāḷi Dictionary is a work in progress, made available for testing and feedback purposes.</p><p><a class="link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org" target="_blank">Add a missing word</a><span>. Please use this </span><a class="link" href="https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform?usp=pp_url&entry.1433863141=Tipitakapali.org" target="_blank">online form</a> to add missing words, especially from Vinaya, commentaries, and other later texts. If you prefer to work offline, here is a <a class="link" href="https://github.com/digitalpalidictionary/dpd-db/raw/main/docs/DPD%20Add%20Words.xlsx" download="true" target="_blank">spreadsheet to download</a><span>, fill in and submit.</span></p><p><a class="link" href="https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform?usp=pp_url&entry.438735500=#tpo_link@&entry.1433863141=Tipitakapali.org" target="_blank">Correct a mistake</a><span>. Did you spot a mistake in the dictionary? Please report it. It generally takes less than a minute and your corrections and suggestions help to improve the quality of this dictionary for everyone who uses it.</span></p><p><a class="link" href="https://digitalpalidictionary.github.io/" target="_blank">Visit the DPD website</a><span>. Get more detailed information about installation and upgrades, advanced settings and features.</span></p><p><a class="link" href="mailto:digitalpalidictionary@gmail.com?subject=Help%20with%20DPD">Help with coding or Pāḷi</a><span>. If you'd like to support the project, please get in touch.</span></p>`;

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
    let st = DPD_FEEDBACK_TEMPLATE.replaceAll('#tpo_id@', id || '');
    st = st.replaceAll('#tpo_word@', lemma || '');
    st = st.replaceAll('#tpo_link@', encodeURIComponent(lemma || ''));
    html = html.replace(entireMatchStr, st);
  });

  reDPDLinks.forEach(([link, code]) => {
    html = html.replaceAll(code, link);
  });

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

// Query DPD Dictionary
function lookupDPD(rawWord, useSplitter = false) {
  if (!dbs.DPD) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

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

  // If no main DPD entries found, check splitter
  if (exactMatches.length === 0 && relatedMatches.length === 0 && dbs.SPLI) {
    return lookupSplitter(word);
  }

  return [...exactMatches, ...relatedMatches];
}

// Query PTS PED Dictionary
function lookupPTS(rawWord) {
  if (!dbs.PTS) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

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
        const html = `<span class="${isExact ? 'pp2w' : 'pp1w'}">${r.word}</span><br>${r.defi}`;
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

// Query Abhidhānappadīpikā (Pāli-Myanmar)
function lookupABD(rawWord) {
  if (!dbs.ABD) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

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
        const html = `<span class="${isExact ? 'pm2w' : 'pm1w'}">${r.word}</span> ${r.defi}`;
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

// Query Pāli-Sinhala Dictionary
function lookupPSD(rawWord) {
  if (!dbs.PSD) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

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
          exactMatches.push({ word: r.word, isExact: true, source: r.source, html: df });
        } else {
          relatedMatches.push({ word: r.word, isExact: false, source: r.source, html: df });
        }
      }
    } catch (e) {
      console.error('[DictEngine] PSD lookup error:', e.message);
    }
  }

  return [...exactMatches, ...relatedMatches];
}

// Query Sanskrit (Apte / Monier-Williams)
function lookupSANS(rawWord) {
  if (!dbs.SANS) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

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
      matches.push({ word: r.word, isExact, html: df });
    }
  } catch (e) {
    console.error('[DictEngine] SANS lookup error:', e.message);
  }

  return matches;
}

// Query Splitter / Deconstructor
function lookupSplitter(rawWord) {
  if (!dbs.SPLI) return [];
  const word = rawWord.toLowerCase().trim();
  if (!word) return [];

  const fchar = getFChar(word, 'SPLI', true);
  const results = [];

  try {
    const rows = dbs.SPLI.prepare(`SELECT word, defi FROM ${fchar} WHERE word = ?`).all(word);
    for (const r of rows) {
      const elements = (r.defi || '').split('@').filter((x) => x && x.trim().length > 0);
      const decHtml = elements
        .map((el) => `<p class="dec">${el.replaceAll('+', ' + ')}</p>`)
        .join('');

      const html = `
        <section class="dp9 dpd-splitter-section">
          <span class="p2w font-bold text-[var(--accent)] text-sm">${r.word}</span>
          <div class="dpd mt-1 p-2 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]/50 text-xs">
            ${decHtml}
            <p class="footer text-[10px] text-[var(--text-muted)] mt-1.5 pt-1 border-t border-[var(--border-color)]">
              DPD Deconstructor computed compound split.
            </p>
          </div>
        </section>
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

// Bounded in-memory LRU cache for dictionary queries (< 0.01ms response time)
const DICT_CACHE_MAX = 3000;
const dictCache = new Map();

function lookupAll(rawWord) {
  const word = (rawWord || '').toLowerCase().trim();
  if (!word) {
    return {
      word: '',
      hasResults: false,
      synonyms: [],
      dpd: [],
      pts: [],
      abd: [],
      psd: [],
      sans: [],
      splitter: [],
    };
  }

  const cached = dictCache.get(word);
  if (cached) {
    return cached;
  }

  const syns = getSynonyms(word);
  const dpd = lookupDPD(word);
  const pts = lookupPTS(word);
  const abd = lookupABD(word);
  const psd = lookupPSD(word);
  const sans = lookupSANS(word);
  const splitter = dpd.some((d) => d.isSplitter) ? [] : lookupSplitter(word);

  const hasResults =
    dpd.length > 0 ||
    pts.length > 0 ||
    abd.length > 0 ||
    psd.length > 0 ||
    sans.length > 0 ||
    splitter.length > 0;

  const result = {
    word,
    hasResults,
    synonyms: syns,
    counts: {
      dpd: dpd.length,
      pts: pts.length,
      abd: abd.length,
      psd: psd.length,
      sans: sans.length,
      splitter: splitter.length,
    },
    dpd,
    pts,
    abd,
    psd,
    sans,
    splitter,
  };

  // LRU cache insertion
  if (dictCache.size >= DICT_CACHE_MAX) {
    const firstKey = dictCache.keys().next().value;
    dictCache.delete(firstKey);
  }
  dictCache.set(word, result);

  return result;
}

// Initialize on module import
initDictDatabases();

module.exports = {
  initDictDatabases,
  lookupAll,
  lookupDPD,
  lookupPTS,
  lookupABD,
  lookupPSD,
  lookupSANS,
  lookupINF,
  lookupSplitter,
  getSynonyms,
};
