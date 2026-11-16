'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { convertAnyToRoman } = require('./transliterate');
const {
  getTableSet,
  getColumnSet,
  decodeTextOrZlib,
  decodeChapterPackBlob,
  readChapterPack,
  readChapterSentences,
} = require('./tipitakaCoreHelper');

const BOLD_DB_FILENAME = 'bold_definitions.db';
const SCHEMA_VERSION = '3';
const MAX_DISTINCT_WORDS = 25;
const MAX_OCCURRENCES_PER_WORD = 5;
const SHORT_SENTENCE_THRESHOLD = 100;

const PALI_VOWELS = 'aāiīuūeo';
const DIACRITICS_MAP = {
  'ā': 'a', 'ī': 'i', 'ū': 'u', 'ṅ': 'n', 'ñ': 'n',
  'ṭ': 't', 'ḍ': 'd', 'ṇ': 'n', 'ḷ': 'l', 'ṃ': 'm', 'ṁ': 'm',
};

function foldDiacritics(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[āīūṅñṭḍṇḷṃṁ]/g, (ch) => DIACRITICS_MAP[ch] || ch);
}

// Pāḷi stemmer mirroring epitaka_app's PaliStemmer.getStem / BoldDefinitionIndexService
const PALI_STEM_ENDINGS = [
  /ena$/,
  /e(?:h|bh)i$/,
  /ssa$/,
  /(?<=[āīū])naṃ$/,
  /smā$/,
  /mhā$/,
  /smiṃ$/,
  /mhi$/,
  /esu$/,
  /āni$/,
  /(?<=ā)yo$/,
  /(?<=i)yā$/,
  /(?<=ā)yaṃ?$/,
  /(?<=[āiīuū])su$/,
  /o$/,
  /e$/,
];

function stemPaliWord(word) {
  let stem = String(word || '').trim().toLowerCase().replace(/ṁ/g, 'ṃ');
  stem = stem.replace(/[\u104a\u104b\u2018\u2019",.?]/g, '');
  if (!stem) return '';
  for (const endRe of PALI_STEM_ENDINGS) {
    if (endRe.test(stem)) {
      stem = stem.replace(endRe, 'a');
      break;
    }
  }
  if (stem.endsWith('ṃ') && stem.length > 1) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function searchPrefixFor(word) {
  const roman = convertAnyToRoman(String(word || '')).toLowerCase().replace(/ṁ/g, 'ṃ').replace(/[^a-zāīūṭḍṅñṇḷṃ\s]/g, '').trim();
  if (!roman) return { cleaned: '', prefix: '' };
  let prefix = stemPaliWord(roman);
  if (prefix.length > 5 && PALI_VOWELS.includes(prefix[prefix.length - 1])) {
    prefix = prefix.slice(0, -1);
  }
  return { cleaned: roman, prefix };
}

function categoryFromBookCode(bookCode, rawCategory) {
  const lower = String(bookCode || '').toLowerCase();
  if (lower.endsWith('.mul')) return 'mūla';
  if (lower.endsWith('.att')) return 'aṭṭhakathā';
  if (lower.endsWith('.tik')) return 'ṭīkā';
  if (lower.endsWith('.nrf')) return 'anya';
  return (rawCategory || '').trim() || 'anya';
}

function decodeHtmlEntities(s) {
  if (!s.includes('&')) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanParagraphToHtmlWithB(innerHtml) {
  let s = String(innerHtml || '');
  s = s.replace(/<span\b[^>]*\bclass=["']?pb["']?[^>]*>[\s\S]*?<\/span>/gi, ' ');
  s = s.replace(/<strong\b[^>]*\bclass=["']?paranum["']?[^>]*>[\s\S]*?<\/strong>(?:\s*<span\b[^>]*\bclass=["']?dot["']?[^>]*>[\s\S]*?<\/span>)?\s*\.?\s*/gi, ' ');
  s = s.replace(/<strong\b[^>]*\bclass=["']?bld["']?[^>]*>([\s\S]*?)<\/strong>/gi, (_, inner) => {
    return `<b>${String(inner).replace(/<[^>]+>/g, '')}</b>`;
  });
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<(?!\/?b\b)[^>]+>/gi, '');
  s = decodeHtmlEntities(s);
  s = s.replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'Ṃ');
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function splitSentences(html) {
  if (!html) return [];
  const out = [];
  let parenDepth = 0;
  let inBold = false;
  let start = 0;
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith('<b>', i)) { inBold = true; i += 2; continue; }
    if (html.startsWith('</b>', i)) { inBold = false; i += 3; continue; }
    const ch = html[i];
    if (ch === '(' || ch === '[') { parenDepth++; continue; }
    if ((ch === ')' || ch === ']') && parenDepth > 0) { parenDepth--; continue; }
    if (!inBold && parenDepth === 0 && (ch === '.' || ch === '?' || ch === '!' || ch === '।')) {
      let j = i + 1;
      while (j < html.length && "’”\"')".includes(html[j])) j++;
      if (j === html.length || html[j] === ' ') {
        const seg = html.slice(start, j).trim();
        if (seg) out.push(seg);
        start = j;
        while (start < html.length && html[start] === ' ') start++;
        i = start - 1;
      }
    }
  }
  if (start < html.length) {
    const tail = html.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out;
}

const WORD_PUNCT_RE = /[‘’“”"'`«»‹›„.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§၊။\d]/g;

function cleanSentenceHtml(rawSent) {
  let s = String(rawSent || '');
  s = s.replace(/<strong\b[^>]*\bbld\b[^>]*>([\s\S]*?)<\/strong>/gi, (_, inner) => {
    return `<b>${String(inner).replace(/<[^>]+>/g, '')}</b>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/<(?!\/?b\b)[^>]+>/gi, '');
  s = decodeHtmlEntities(s);
  s = s.replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'Ṃ');
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function extractWordAndEnding(boldInner, immediateSuffix) {
  let w = String(boldInner || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(WORD_PUNCT_RE, ' ')
    .replace(/ṁ/g, 'ṃ')
    .replace(/Ṁ/g, 'ṃ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!w) return null;

  const suf = String(immediateSuffix || '').toLowerCase().replace(/ṁ/g, 'ṃ').trim();
  let ending = null;
  if (suf.startsWith('nti')) {
    if (PALI_VOWELS.includes(w[w.length - 1])) w = `${w}ṃ`;
    ending = suf.slice(1) || null;
  } else if (/^t[iī]/.test(suf)) {
    if (w.endsWith('n') && w.length >= 2) w = `${w.slice(0, -1)}ṃ`;
    ending = suf;
  } else if (suf) {
    ending = suf;
  }

  if (w.length < 2 || !/\p{L}/u.test(w)) return null;
  return { word: w, ending };
}

function normPali(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ṁ/g, 'ṃ')
    .replace(/<\/?(?:b|i|em|strong)\b[^>]*>/gi, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[’”"']+\s*(?=n?t[iī])/gi, '')
    .replace(/\s+-(?=\p{L})/gu, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PHRASE_PUNCT_RE = /[‘’“”"'«»‹›„.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`]+/g;

function buildLineNorm(rawText, lineId) {
  const base = String(rawText || '')
    .toLowerCase()
    .replace(/ṁ/g, 'ṃ')
    .replace(/<\/?(?:b|i|em|strong)\b[^>]*>/gi, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[’”"']+\s*(?=n?t[iī])/gi, '')
    .replace(/<[^>]+>/g, ' ');
  const normLine = base
    .replace(/\s+-(?=\p{L})/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normPhrase = normLine.replace(PHRASE_PUNCT_RE, ' ').replace(/\s+/g, ' ').trim();
  const normPhraseSpaced = base.replace(PHRASE_PUNCT_RE, ' ').replace(/\s+/g, ' ').trim();
  const normPhraseTi = normPhrase.replace(/\s+(?=n?t[iī](?:\s|$))/g, '');
  const normPhraseSpacedTi = normPhraseSpaced.replace(/\s+(?=n?t[iī](?:\s|$))/g, '');
  return {
    lineId: Number(lineId) || 1,
    normLine,
    normPhrase,
    normPhraseSpaced,
    normPhraseTi,
    normPhraseSpacedTi,
    tokens: new Set(normLine ? normLine.split(TOKEN_SPLIT_RE).filter(Boolean) : []),
  };
}

function vowelVariants(word) {
  if (!word) return [];
  const variants = new Set([word]);
  const swap = { 'ā': 'a', 'a': 'ā', 'ī': 'i', 'i': 'ī', 'ū': 'u', 'u': 'ū' };
  const alt = swap[word[word.length - 1]];
  if (alt) variants.add(word.slice(0, -1) + alt);
  return Array.from(variants);
}

function sandhiTokenVariants(word) {
  const out = new Set(vowelVariants(word));
  if (word.endsWith('ṃ') && word.length >= 3) {
    const stem = word.slice(0, -1);
    out.add(`${stem}nti`);
    out.add(`${stem}ntī`);
    out.add(`${stem}ntīti`);
  } else if (word.length >= 2) {
    for (const v of vowelVariants(word)) {
      out.add(`${v}ti`);
      out.add(`${v}tī`);
    }
  }
  return Array.from(out);
}

const INFLECTION_STEM_END_RE = /[aāiīuūeo]$/;
const VALID_INFLECTION_SUFFIX_RE = /^(?:[aāiīuūeoṃ]|[aāiīuū]ṃ|n?t[iī](?:ādi.*)?|a?(?:ssa|smiṃ|mhi|smā|mhā|naṃ)|ena|āya|āni|esu|īsu|ūsu|ehi|ebhi|pi|ca|va|no|to)$/;

function inflectionStem(word) {
  if (!word || word.length < 3) return null;
  let base = word.endsWith('ṃ') ? word.slice(0, -1) : word;
  if (INFLECTION_STEM_END_RE.test(base) && base.length >= 3) {
    base = base.slice(0, -1);
  }
  return base.length >= 2 ? base : null;
}

const TOKEN_SPLIT_RE = /[\s.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`‘’“”"'«»‹›„]+/;

function matchesInLine(lineOrNormText, lineTokensOrCandidate, maybeCandidate) {
  const line =
    typeof lineOrNormText === 'object' && lineOrNormText !== null && lineOrNormText.tokens
      ? lineOrNormText
      : buildLineNorm(lineOrNormText, 1);
  const candidate =
    typeof lineOrNormText === 'object' && lineOrNormText !== null && lineOrNormText.tokens
      ? lineTokensOrCandidate
      : maybeCandidate;
  const lineTokens =
    typeof lineOrNormText === 'object' && lineOrNormText !== null && lineOrNormText.tokens
      ? line.tokens
      : lineTokensOrCandidate;

  if (!line.normLine || !candidate) return false;
  const variants = vowelVariants(candidate);
  if (candidate.includes(' ')) {
    const firstWordLen = candidate.indexOf(' ');
    const startBound = firstWordLen >= 5 ? '(?:^|\\s|\\p{L}+)' : '(?:^|\\s)';
    const haystacks = [
      line.normPhrase,
      line.normPhraseSpaced,
      line.normPhraseTi,
      line.normPhraseSpacedTi,
    ];
    for (const hay of haystacks) {
      if (!hay) continue;
      for (const v of variants) {
        const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`${startBound}${esc}(?:$|\\s|n?t[iī])`, 'u').test(hay)) {
          return true;
        }
      }
      if (candidate.endsWith('ṃ') && candidate.length >= 4) {
        const stemEsc = candidate.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`${startBound}${stemEsc}nt[iī](?:$|\\s|\\p{L}*)`, 'u').test(hay)) {
          return true;
        }
      }
    }
    if (candidate.includes(' pe ')) {
      const peParts = candidate.split(/\s+pe\s+/).map((p) => p.trim()).filter(Boolean);
      if (peParts.length === 2 && peParts[0].length >= 4 && peParts[1].length >= 4) {
        const p1Esc = peParts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const p2Esc = peParts[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const peRe = new RegExp(`(?:^|\\s)${p1Esc}\\b[\\s\\S]{1,160}\\b${p2Esc}(?:$|\\s|n?t[iī])`, 'u');
        if (peRe.test(line.normPhrase) || peRe.test(line.normPhraseSpaced)) {
          return true;
        }
      }
    }
    const collapsed = candidate.replace(/\s+/g, '');
    if (collapsed.length >= 5 && matchesInLine(line, collapsed)) {
      return true;
    }
    return false;
  }
  const tokenVariants = sandhiTokenVariants(candidate);
  for (const v of tokenVariants) {
    if (lineTokens.has(v)) return true;
  }
  if (candidate.length >= 2) {
    for (const v of variants) {
      const tiPrefix = `${v}ti`;
      const tiiPrefix = `${v}tī`;
      for (const tok of lineTokens) {
        if (tok.startsWith(tiPrefix) || tok.startsWith(tiiPrefix)) return true;
      }
    }
  }
  const stem = inflectionStem(candidate);
  if (stem) {
    for (const tok of lineTokens) {
      if (tok.startsWith(stem) && VALID_INFLECTION_SUFFIX_RE.test(tok.slice(stem.length))) {
        return true;
      }
    }
  }
  if (candidate.length >= 5) {
    for (const v of variants) {
      for (const tok of lineTokens) {
        if (tok.length > v.length && (tok.startsWith(v) || tok.endsWith(v))) return true;
      }
    }
    if (candidate.endsWith('ṃ')) {
      const stemNt = `${candidate.slice(0, -1)}nt`;
      for (const tok of lineTokens) {
        if (tok.startsWith(stemNt) || tok.endsWith(stemNt)) return true;
      }
    }
  }
  return false;
}

class BoldLinkedEngine {
  constructor({ dbTipitaka, tipiDbPath, dbDir, getPaliSentDb, translationEngine }) {
    this.dbTipitaka = dbTipitaka;
    this.tipiDbPath = tipiDbPath;
    this.dbDir = dbDir;
    this.getPaliSentDb = getPaliSentDb;
    this.translationEngine = translationEngine;
    this.boldDb = null;
    this.chapterLinksCache = new Map();
  }

  getBoldDbPath() {
    return path.join(this.dbDir, BOLD_DB_FILENAME);
  }

  isBoldDbUpToDate(dstPath) {
    if (!this.tipiDbPath || !fs.existsSync(this.tipiDbPath) || !fs.existsSync(dstPath)) return false;
    const dstStat = fs.statSync(dstPath);
    if (dstStat.size === 0) return false;
    const srcStat = fs.statSync(this.tipiDbPath);
    let checkDb;
    try {
      checkDb = new Database(dstPath, { readonly: true });
      const rows = checkDb.prepare('SELECT key, value FROM meta').all();
      const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      if (
        meta.schema_version !== SCHEMA_VERSION ||
        meta.source_size !== String(srcStat.size) ||
        meta.source_mtime !== String(Math.floor(srcStat.mtimeMs))
      ) {
        return false;
      }
      const cnt = checkDb.prepare('SELECT COUNT(*) AS c FROM bold_definitions').get()?.c || 0;
      return cnt > 0;
    } catch (_) {
      return false;
    } finally {
      try { checkDb?.close(); } catch (_) {}
    }
  }

  ensureBoldDb() {
    if (this.boldDb) return this.boldDb;
    const dstPath = this.getBoldDbPath();
    if (!this.isBoldDbUpToDate(dstPath)) {
      this.buildBoldDb(dstPath);
    }
    if (fs.existsSync(dstPath)) {
      this.boldDb = new Database(dstPath, { readonly: true });
      this.boldDb.exec('PRAGMA temp_store = MEMORY; PRAGMA query_only = 1;');
    }
    return this.boldDb;
  }

  buildBoldDb(dstPath) {
    if (!this.dbTipitaka || !this.tipiDbPath || !fs.existsSync(this.tipiDbPath)) return;
    const srcStat = fs.statSync(this.tipiDbPath);
    const tmpPath = `${dstPath}.tmp`;
    for (const ext of ['', '-wal', '-shm']) {
      if (fs.existsSync(tmpPath + ext)) fs.unlinkSync(tmpPath + ext);
    }

    const booksMeta = new Map();
    for (const b of this.dbTipitaka.prepare('SELECT code, title, category FROM books').all()) {
      booksMeta.set(b.code, {
        title: b.title || b.code,
        category: categoryFromBookCode(b.code, b.category),
      });
    }

    const paraNumLookup = new Map();
    try {
      const stmt = this.dbTipitaka.prepare(
        "SELECT book_code, para_index, para_num FROM canon_paragraphs WHERE para_num IS NOT NULL AND para_num != ''"
      );
      for (const r of stmt.iterate()) {
        if (!paraNumLookup.has(r.book_code)) paraNumLookup.set(r.book_code, new Map());
        paraNumLookup.get(r.book_code).set(r.para_index, String(r.para_num).trim());
      }
    } catch (_) {}

    const dst = new Database(tmpPath);
    let totalRows = 0;
    try {
      dst.exec(`
        PRAGMA journal_mode = MEMORY;
        PRAGMA temp_store = MEMORY;
        PRAGMA synchronous = OFF;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE bold_definitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_code TEXT NOT NULL,
          book_title TEXT NOT NULL,
          category TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL DEFAULT 1,
          para_num TEXT,
          word TEXT NOT NULL,
          plain TEXT NOT NULL,
          ending TEXT,
          sentence_html TEXT NOT NULL,
          before_html TEXT,
          after_html TEXT
        );
      `);

      const insertStmt = dst.prepare(
        'INSERT INTO bold_definitions (book_code, book_title, category, chapter_index, para_index, line_id, para_num, word, plain, ending, sentence_html, before_html, after_html) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      );
      const tipiTables = getTableSet(this.dbTipitaka);
      const hasPack = tipiTables.has('chapter_text_pack');
      const hasInlinePaliSent = tipiTables.has('pali_sentences');
      const paliSentDb = this.getPaliSentDb ? this.getPaliSentDb() : null;
      const hasExternalPaliSent = Boolean(paliSentDb && getTableSet(paliSentDb).has('pali_sentences'));

      const packByBookChap = new Map();
      if (hasPack) {
        try {
          const packStmt = this.dbTipitaka.prepare(
            'SELECT b.code AS book_code, p.chapter_index, p.data_z FROM chapter_text_pack p JOIN books b ON b.id = p.book_id ORDER BY b.code, p.chapter_index'
          );
          for (const pr of packStmt.iterate()) {
            const { sentMap } = decodeChapterPackBlob(pr.data_z);
            if (sentMap && sentMap.size > 0) {
              packByBookChap.set(`${pr.book_code}|${pr.chapter_index}`, sentMap);
            }
          }
        } catch (_) {}
      }

      const loadPaliSentMapForChapter = (bookCode, chapterIndex) => {
        const dbSrc = hasExternalPaliSent ? paliSentDb : (hasInlinePaliSent ? this.dbTipitaka : null);
        if (!dbSrc) return null;
        try {
          const rows = dbSrc
            .prepare(
              'SELECT para_index, line_id, sentence FROM pali_sentences WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id'
            )
            .all(bookCode, chapterIndex);
          if (rows.length === 0) return null;
          const map = new Map();
          for (const r of rows) {
            if (!map.has(r.para_index)) map.set(r.para_index, []);
            map.get(r.para_index).push({ lineId: Number(r.line_id), text: r.sentence });
          }
          return map;
        } catch (_) {
          return null;
        }
      };

      const hasHtmlZ = getColumnSet(this.dbTipitaka, 'chapters').has('html_z');
      const chapStmt = this.dbTipitaka.prepare(
        hasHtmlZ
          ? 'SELECT book_code, chapter_index, html, html_z FROM chapters ORDER BY book_code, chapter_index'
          : 'SELECT book_code, chapter_index, html FROM chapters ORDER BY book_code, chapter_index'
      );

      const pTagRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      const pindexRe = /\bdata-pindex="(\d+)"/i;
      const paraRe = /\bdata-para="([^"]*)"/i;
      const clsRe = /\bclass="([^"]*)"/i;
      const boldSuffixRe = /<b>([^<]+)<\/b>[’”"']*([a-zA-ZāīūṭḍṅñṇḷṃṁĀĪŪṬḌṄÑṆḶṂṀ]*)/g;

      const emitSentencesForPara = (bookCode, bInfo, chapterIndex, paraIndex, paraNum, sentences) => {
        for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
          const rec = sentences[sIdx];
          const sent = rec.text;
          if (!sent || !sent.includes('<b>')) continue;
          const plainSent = sent.replace(/<[^>]+>/g, '').trim();
          const isShort = plainSent.length < SHORT_SENTENCE_THRESHOLD;
          const beforeHtml = isShort && sIdx > 0 ? sentences[sIdx - 1].text : null;
          const afterHtml = isShort && sIdx < sentences.length - 1 ? sentences[sIdx + 1].text : null;

          const seen = new Set();
          boldSuffixRe.lastIndex = 0;
          let bm;
          while ((bm = boldSuffixRe.exec(sent)) !== null) {
            const parsed = extractWordAndEnding(bm[1], bm[2]);
            if (!parsed) continue;
            const dKey = `${parsed.word}|${parsed.ending || ''}`;
            if (seen.has(dKey)) continue;
            seen.add(dKey);
            insertStmt.run(
              bookCode, bInfo.title, bInfo.category, chapterIndex,
              paraIndex, rec.lineId, paraNum, parsed.word, foldDiacritics(parsed.word),
              parsed.ending, sent, beforeHtml, afterHtml
            );
            totalRows++;
          }
        }
      };

      const tx = dst.transaction(() => {
        const processedChapters = new Set();
        for (const ch of chapStmt.iterate()) {
          const chapKey = `${ch.book_code}|${ch.chapter_index}`;
          processedChapters.add(chapKey);
          const bInfo = booksMeta.get(ch.book_code) || { title: ch.book_code, category: categoryFromBookCode(ch.book_code) };
          const bParaMap = paraNumLookup.get(ch.book_code);

          const packSentMap = packByBookChap.get(chapKey) || loadPaliSentMapForChapter(ch.book_code, ch.chapter_index);
          const boldParasInSentStore = new Set();

          if (packSentMap && packSentMap.size > 0) {
            for (const [paraIndex, rawSents] of packSentMap.entries()) {
              const cleanedSents = rawSents.map((s) => ({
                lineId: Number(s.lineId) || 1,
                text: cleanSentenceHtml(s.text),
              }));
              if (!cleanedSents.some((s) => s.text && s.text.includes('<b>'))) continue;
              boldParasInSentStore.add(paraIndex);
              const paraNum = bParaMap?.get(paraIndex) || null;
              emitSentencesForPara(ch.book_code, bInfo, ch.chapter_index, paraIndex, paraNum, cleanedSents);
            }
          }

          // Fallback to chapters.html for any paragraph not covered with <b> in sentence stores
          const html = decodeTextOrZlib(ch.html, hasHtmlZ ? ch.html_z : null) || '';
          if (!html.includes('bld')) continue;

          pTagRe.lastIndex = 0;
          let pm;
          while ((pm = pTagRe.exec(html)) !== null) {
            const attrs = pm[1] || '';
            const inner = pm[2] || '';
            if (!inner.includes('bld')) continue;
            const cls = clsRe.exec(attrs)?.[1] || '';
            if (/\b(nikaya|book|title)\b/i.test(cls)) continue;
            const pidxStr = pindexRe.exec(attrs)?.[1];
            if (!pidxStr) continue;
            const paraIndex = parseInt(pidxStr, 10);
            if (boldParasInSentStore.has(paraIndex)) continue;

            let paraNum = paraRe.exec(attrs)?.[1]?.trim() || null;
            if (!paraNum && bParaMap) paraNum = bParaMap.get(paraIndex) || null;

            const cleanedPara = cleanParagraphToHtmlWithB(inner);
            if (!cleanedPara.includes('<b>')) continue;
            const split = splitSentences(cleanedPara).map((txt, idx) => ({
              lineId: idx + 1,
              text: txt,
            }));
            emitSentencesForPara(ch.book_code, bInfo, ch.chapter_index, paraIndex, paraNum, split);
          }
        }

        // Index any remaining pack chapters not present in chapters table
        for (const [chapKey, packSentMap] of packByBookChap.entries()) {
          if (processedChapters.has(chapKey)) continue;
          const sep = chapKey.lastIndexOf('|');
          const bookCode = chapKey.slice(0, sep);
          const chapterIndex = parseInt(chapKey.slice(sep + 1), 10);
          const bInfo = booksMeta.get(bookCode) || { title: bookCode, category: categoryFromBookCode(bookCode) };
          const bParaMap = paraNumLookup.get(bookCode);
          for (const [paraIndex, rawSents] of packSentMap.entries()) {
            if (!rawSents.some((s) => s.text && s.text.includes('<b>'))) continue;
            const normalizedSents = rawSents.map((s) => ({
              lineId: Number(s.lineId) || 1,
              text: cleanSentenceHtml(s.text),
            }));
            const paraNum = bParaMap?.get(paraIndex) || null;
            emitSentencesForPara(bookCode, bInfo, chapterIndex, paraIndex, paraNum, normalizedSents);
          }
        }
      });
      tx();

      dst.exec(`
        CREATE INDEX idx_bdef_word ON bold_definitions(word);
        CREATE INDEX idx_bdef_plain ON bold_definitions(plain);
        CREATE INDEX idx_bdef_book_para ON bold_definitions(book_code, chapter_index, para_index);
        CREATE INDEX idx_bdef_loc ON bold_definitions(book_code, chapter_index, para_index, line_id);
        CREATE INDEX idx_bdef_book_pnum ON bold_definitions(book_code, para_num);
        CREATE INDEX idx_bdef_book_ch_pnum ON bold_definitions(book_code, chapter_index, para_num);
      `);
      const metaInsert = dst.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      metaInsert.run('schema_version', SCHEMA_VERSION);
      metaInsert.run('source_size', String(srcStat.size));
      metaInsert.run('source_mtime', String(Math.floor(srcStat.mtimeMs)));
      metaInsert.run('row_count', String(totalRows));
    } finally {
      dst.close();
    }
    fs.renameSync(tmpPath, dstPath);
    console.log(`[BoldLinked] Built ${dstPath} (${totalRows.toLocaleString()} bold entries)`);
  }

  lookupBoldDef(rawWord, enabledLangs = []) {
    const { cleaned, prefix } = searchPrefixFor(rawWord);
    if (!cleaned) return { word: '', search_prefix: '', hasResults: false, results: [] };
    const bdb = this.ensureBoldDb();
    if (!bdb) return { word: cleaned, search_prefix: prefix, hasResults: false, results: [] };

    const escGlob = (s) => s.replace(/\[/g, '[[]').replace(/\*/g, '[*]').replace(/\?/g, '[?]');
    let rows = bdb
      .prepare(`
        WITH ranked AS (
          SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                 para_num, word, plain, ending, sentence_html, before_html, after_html,
                 DENSE_RANK() OVER (ORDER BY length(word), word) AS word_rank,
                 ROW_NUMBER() OVER (
                   PARTITION BY word
                   ORDER BY CASE category WHEN 'aṭṭhakathā' THEN 1 WHEN 'ṭīkā' THEN 2 WHEN 'mūla' THEN 3 ELSE 4 END,
                            book_code, chapter_index, para_index, line_id
                 ) AS rn
          FROM bold_definitions
          WHERE word GLOB ?
        )
        SELECT book_code, book_title, category, chapter_index, para_index, line_id,
               para_num, word, plain, ending, sentence_html, before_html, after_html
        FROM ranked
        WHERE (word_rank <= ? OR word = ?) AND rn <= ?
        ORDER BY CASE WHEN word = ? THEN 0 ELSE 1 END, length(word), word,
                 CASE category WHEN 'aṭṭhakathā' THEN 1 WHEN 'ṭīkā' THEN 2 WHEN 'mūla' THEN 3 ELSE 4 END,
                 book_code, chapter_index, para_index, line_id
      `)
      .all(`${escGlob(prefix)}*`, MAX_DISTINCT_WORDS, cleaned, MAX_OCCURRENCES_PER_WORD, cleaned);

    if (rows.length === 0) {
      const fPrefix = foldDiacritics(prefix);
      const fCleaned = foldDiacritics(cleaned);
      rows = bdb
        .prepare(`
          WITH ranked AS (
            SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                   para_num, word, plain, ending, sentence_html, before_html, after_html,
                   DENSE_RANK() OVER (ORDER BY length(plain), plain) AS word_rank,
                   ROW_NUMBER() OVER (
                     PARTITION BY plain
                     ORDER BY CASE category WHEN 'aṭṭhakathā' THEN 1 WHEN 'ṭīkā' THEN 2 WHEN 'mūla' THEN 3 ELSE 4 END,
                              book_code, chapter_index, para_index, line_id
                   ) AS rn
            FROM bold_definitions
            WHERE plain GLOB ?
          )
          SELECT book_code, book_title, category, chapter_index, para_index, line_id,
                 para_num, word, plain, ending, sentence_html, before_html, after_html
          FROM ranked
          WHERE (word_rank <= ? OR plain = ?) AND rn <= ?
          ORDER BY CASE WHEN plain = ? THEN 0 ELSE 1 END, length(plain), plain,
                   CASE category WHEN 'aṭṭhakathā' THEN 1 WHEN 'ṭīkā' THEN 2 WHEN 'mūla' THEN 3 ELSE 4 END,
                   book_code, chapter_index, para_index, line_id
        `)
        .all(`${escGlob(fPrefix)}*`, MAX_DISTINCT_WORDS, fCleaned, MAX_OCCURRENCES_PER_WORD, fCleaned);
    }

    const uniqueLocs = new Map();
    for (const r of rows) {
      uniqueLocs.set(`${r.book_code}:${r.chapter_index}:${r.para_index}`, {
        book: r.book_code,
        chap: r.chapter_index,
        para: r.para_index,
      });
    }

    const sentTransByLine = new Map();
    const paraFallbackByLoc = new Map();
    const parasWithSentTrans = new Set();
    if (this.translationEngine && Array.isArray(enabledLangs) && enabledLangs.length > 0 && uniqueLocs.size > 0) {
      const byBook = new Map();
      for (const loc of uniqueLocs.values()) {
        if (!byBook.has(loc.book)) byBook.set(loc.book, new Set());
        byBook.get(loc.book).add(loc.para);
      }
      for (const rawLang of enabledLangs) {
        const code = this.translationEngine.ensureLanguage(rawLang);
        if (!code) continue;
        const entry = this.translationEngine.databases.get(code);
        if (!entry) continue;
        for (const [bookCode, paraSet] of byBook.entries()) {
          const params = Array.from(paraSet);
          const ph = params.map(() => '?').join(',');
          try {
            const stRows = entry.db
              .prepare(`SELECT chapter_index, para_index, line_id, translation FROM sentence_translations WHERE book_code = ? AND para_index IN (${ph})`)
              .all(bookCode, ...params);
            for (const sr of stRows) {
              const txt = String(sr.translation || '').trim();
              if (!txt) continue;
              const pKey = `${code}|${bookCode}:${sr.chapter_index}:${sr.para_index}`;
              parasWithSentTrans.add(pKey);
              const sKey = `${pKey}:${Number(sr.line_id)}`;
              sentTransByLine.set(sKey, txt);
            }
          } catch (_) {}
          try {
            const tRows = entry.db
              .prepare(`SELECT chapter_index, para_index, translation, sentences_json FROM paragraph_translations WHERE book_code = ? AND para_index IN (${ph})`)
              .all(bookCode, ...params);
            for (const tr of tRows) {
              const pKey = `${code}|${bookCode}:${tr.chapter_index}:${tr.para_index}`;
              if (tr.sentences_json) {
                try {
                  const dec = JSON.parse(tr.sentences_json);
                  if (Array.isArray(dec)) {
                    for (let idx = 0; idx < dec.length; idx++) {
                      const item = dec[idx];
                      if (typeof item === 'string') {
                        const txt = item.trim();
                        if (txt) {
                          parasWithSentTrans.add(pKey);
                          const sKey = `${pKey}:${idx + 1}`;
                          if (!sentTransByLine.has(sKey)) sentTransByLine.set(sKey, txt);
                        }
                      } else {
                        const txt = item && item.translation ? String(item.translation).trim() : '';
                        if (txt && item.line_id !== undefined) {
                          parasWithSentTrans.add(pKey);
                          const sKey = `${pKey}:${Number(item.line_id)}`;
                          if (!sentTransByLine.has(sKey)) sentTransByLine.set(sKey, txt);
                        }
                      }
                    }
                  }
                } catch (_) {}
              }
              const pTxt = String(tr.translation || '').trim();
              if (pTxt) paraFallbackByLoc.set(pKey, pTxt);
            }
          } catch (_) {}
        }
      }
    }

    const matByLoc = new Map();
    if (this.dbTipitaka && uniqueLocs.size > 0) {
      const byBook = new Map();
      for (const loc of uniqueLocs.values()) {
        if (!byBook.has(loc.book)) byBook.set(loc.book, new Set());
        byBook.get(loc.book).add(loc.para);
      }
      const bookTitleCache = new Map();
      const titleForBook = (code) => {
        if (bookTitleCache.has(code)) return bookTitleCache.get(code);
        let title = code;
        try {
          const bRow = this.dbTipitaka.prepare('SELECT title FROM books WHERE code = ? LIMIT 1').get(code);
          if (bRow?.title) title = bRow.title;
        } catch (_) {}
        bookTitleCache.set(code, title);
        return title;
      };
      for (const [bookCode, paraSet] of byBook.entries()) {
        const params = Array.from(paraSet);
        const ph = params.map(() => '?').join(',');
        try {
          const mRows = this.dbTipitaka
            .prepare(`SELECT chapter_index, para_index, mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para FROM canon_paragraphs WHERE book_code = ? AND para_index IN (${ph})`)
            .all(bookCode, ...params);
          for (const mr of mRows) {
            const mat = {};
            for (const layer of ['mula', 'attha', 'tika']) {
              const mb = mr[`${layer}_book`];
              if (mb) {
                mat[layer] = {
                  book: mb,
                  book_code: mb,
                  title: titleForBook(mb),
                  chapter: mr[`${layer}_chapter`] ?? 0,
                  para: mr[`${layer}_para`] ?? null,
                };
              }
            }
            if (Object.keys(mat).length > 0) {
              matByLoc.set(`${bookCode}:${mr.chapter_index}:${mr.para_index}`, mat);
            }
          }
        } catch (_) {}
      }
    }

    const loadedLangCodes = [];
    if (this.translationEngine && Array.isArray(enabledLangs)) {
      for (const rawLang of enabledLangs) {
        const code = this.translationEngine.ensureLanguage(rawLang);
        if (code && !loadedLangCodes.includes(code)) loadedLangCodes.push(code);
      }
    }

    const results = rows.map((r) => {
      const k = `${r.book_code}:${r.chapter_index}:${r.para_index}`;
      const lineId = r.line_id ?? 1;
      const translations = {};
      for (const code of loadedLangCodes) {
        const pKey = `${code}|${k}`;
        const st = sentTransByLine.get(`${pKey}:${lineId}`);
        const pt = st || paraFallbackByLoc.get(pKey);
        if (pt) translations[code] = pt;
      }
      const mat = matByLoc.get(k);
      return {
        book_code: r.book_code,
        book_title: r.book_title,
        category: r.category,
        chapter_index: r.chapter_index,
        para_index: r.para_index,
        line_id: lineId,
        para_num: r.para_num,
        word: r.word,
        plain: r.plain,
        ending: r.ending,
        sentence_html: r.sentence_html,
        before_html: r.before_html,
        after_html: r.after_html,
        translations,
        ...(mat ? { mat } : {}),
      };
    });

    return { word: cleaned, search_prefix: prefix, hasResults: results.length > 0, results };
  }

  getLinksForChapter(bookCode, chapterIndex) {
    const cacheKey = `${bookCode}#${chapterIndex}`;
    if (this.chapterLinksCache.has(cacheKey)) {
      return this.chapterLinksCache.get(cacheKey);
    }

    const empty = { book_code: bookCode, chapter_index: chapterIndex, paragraphs: {} };
    const bdb = this.ensureBoldDb();
    if (!this.dbTipitaka || !bdb) return empty;

    const paraRows = this.dbTipitaka
      .prepare(
        'SELECT para_index, para_num, pali_text, mula_book, mula_chapter, mula_para, ' +
          'attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para ' +
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? ORDER BY para_index ASC'
      )
      .all(bookCode, chapterIndex);
    if (paraRows.length === 0) return empty;

    const paliSentDb = this.getPaliSentDb ? this.getPaliSentDb() : null;
    const sentencesByPara = readChapterSentences(this.dbTipitaka, paliSentDb, bookCode, chapterIndex);
    let lazyChapTexts = null;

    const lowerCode = bookCode.toLowerCase();
    const isMula = lowerCode.endsWith('.mul');
    const isAtt = lowerCode.endsWith('.att');
    const isTik = lowerCode.endsWith('.tik');

    const forwardTargetsByBookChap = new Map();
    const addForwardTarget = (targetBook, targetChap, paraNum) => {
      const chapKey = targetChap !== null && targetChap !== undefined ? String(targetChap) : '';
      const mapKey = `${targetBook}|${chapKey}`;
      if (!forwardTargetsByBookChap.has(mapKey)) {
        forwardTargetsByBookChap.set(mapKey, {
          book: targetBook,
          chap: targetChap !== null && targetChap !== undefined ? targetChap : null,
          paraSet: new Set(),
        });
      }
      forwardTargetsByBookChap.get(mapKey).paraSet.add(paraNum);
    };

    for (const r of paraRows) {
      if (isMula || !isTik) {
        const ab = r.attha_book;
        const ap = String(r.attha_para || '').trim();
        if (ab && ab !== bookCode && ap) {
          addForwardTarget(ab, r.attha_chapter, ap);
        }
      }
      if (isMula || isAtt) {
        const tb = r.tika_book;
        const tp = String(r.tika_para || '').trim();
        if (tb && tb !== bookCode && tp) {
          addForwardTarget(tb, r.tika_chapter, tp);
        }
      }
    }

    const forwardBoldDefs = new Map();
    for (const { book: targetBook, chap: targetChap, paraSet } of forwardTargetsByBookChap.values()) {
      const list = Array.from(paraSet);
      const chapKey = targetChap !== null ? String(targetChap) : '';
      for (let i = 0; i < list.length; i += 400) {
        const chunk = list.slice(i, i + 400);
        const ph = chunk.map(() => '?').join(',');
        const bRows = targetChap !== null
          ? bdb
              .prepare(
                `SELECT book_code, book_title, category, chapter_index, para_index, line_id, para_num, word ` +
                  `FROM bold_definitions WHERE book_code = ? AND chapter_index = ? AND para_num IN (${ph}) ORDER BY chapter_index, para_index, line_id, id`
              )
              .all(targetBook, targetChap, ...chunk)
          : bdb
              .prepare(
                `SELECT book_code, book_title, category, chapter_index, para_index, line_id, para_num, word ` +
                  `FROM bold_definitions WHERE book_code = ? AND para_num IN (${ph}) ORDER BY chapter_index, para_index, line_id, id`
              )
              .all(targetBook, ...chunk);
        for (const br of bRows) {
          const pn = String(br.para_num || '').trim();
          if (!pn) continue;
          const k = `${targetBook}|${chapKey}|${pn}`;
          if (!forwardBoldDefs.has(k)) forwardBoldDefs.set(k, []);
          forwardBoldDefs.get(k).push({
            word: br.word,
            bookCode: br.book_code,
            bookTitle: br.book_title,
            category: br.category,
            chapterIndex: br.chapter_index,
            paraIndex: br.para_index,
            lineId: Number(br.line_id) || 1,
            paraNum: pn,
          });
        }
      }
    }

    const selfBoldDefsByPara = new Map();
    if (isAtt || isTik) {
      for (const sr of bdb
        .prepare('SELECT para_index, line_id, word FROM bold_definitions WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id, id')
        .all(bookCode, chapterIndex)) {
        if (!selfBoldDefsByPara.has(sr.para_index)) selfBoldDefsByPara.set(sr.para_index, []);
        selfBoldDefsByPara.get(sr.para_index).push({
          lineId: Number(sr.line_id) || 1,
          word: sr.word,
        });
      }
    }

    const bookTitleCache = new Map();
    const getBookTitle = (code) => {
      if (bookTitleCache.has(code)) return bookTitleCache.get(code);
      const row = this.dbTipitaka.prepare('SELECT title FROM books WHERE code = ? LIMIT 1').get(code);
      const t = row?.title || code;
      bookTitleCache.set(code, t);
      return t;
    };

    const revCache = new Map();
    const resolveTargetParas = (targetBook, targetChapter, targetParaNum) => {
      const k = `${targetBook}|${targetChapter ?? -1}|${targetParaNum}`;
      if (revCache.has(k)) return revCache.get(k);
      let rows =
        targetChapter !== null && targetChapter !== undefined
          ? this.dbTipitaka
              .prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_num = ? ORDER BY para_index ASC')
              .all(targetBook, targetChapter, targetParaNum)
          : this.dbTipitaka
              .prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? ORDER BY para_index ASC')
              .all(targetBook, targetParaNum);
      if (rows.length === 0 && targetChapter !== null && targetChapter !== undefined) {
        rows = this.dbTipitaka
          .prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? ORDER BY para_index ASC')
          .all(targetBook, targetParaNum);
      }
      const parsedNum = parseInt(String(targetParaNum).split('-')[0], 10);
      if (rows.length === 0 && !isNaN(parsedNum) && targetChapter !== null && targetChapter !== undefined) {
        rows = this.dbTipitaka
          .prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_first <= ? AND para_last >= ? ORDER BY para_index ASC')
          .all(targetBook, targetChapter, parsedNum, parsedNum);
      }
      if (rows.length === 0 && !isNaN(parsedNum)) {
        rows = this.dbTipitaka
          .prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND para_first <= ? AND para_last >= ? ORDER BY para_index ASC')
          .all(targetBook, parsedNum, parsedNum);
      }
      const res = rows.map((row) => ({ paraIndex: row.para_index, chapterIndex: row.chapter_index }));
      revCache.set(k, res);
      return res;
    };

    const targetChapSentCache = new Map();
    const targetParaTextCache = new Map();
    const getTargetParaLines = (targetBook, targetChapter, targetParaIdx) => {
      const ck = `${targetBook}|${targetChapter}`;
      if (!targetChapSentCache.has(ck)) {
        const sMap = readChapterSentences(this.dbTipitaka, paliSentDb, targetBook, targetChapter);
        const normMap = new Map();
        for (const [pIdx, arr] of sMap.entries()) {
          normMap.set(
            pIdx,
            arr.map((s) => buildLineNorm(s.text, s.lineId))
          );
        }
        targetChapSentCache.set(ck, normMap);
      }
      const cached = targetChapSentCache.get(ck).get(targetParaIdx);
      if (cached && cached.length > 0) return cached;

      const pk = `${targetBook}|${targetChapter}|${targetParaIdx}`;
      if (!targetParaTextCache.has(pk)) {
        let txt = '';
        try {
          const pRow = this.dbTipitaka
            .prepare('SELECT pali_text FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1')
            .get(targetBook, targetChapter, targetParaIdx);
          txt = pRow?.pali_text || '';
        } catch (_) {}
        if (!txt) {
          txt = readChapterPack(this.dbTipitaka, targetBook, targetChapter).paliMap.get(targetParaIdx) || '';
        }
        const ln = buildLineNorm(txt, 1);
        const fallback = ln.normLine ? [ln] : [];
        targetParaTextCache.set(pk, fallback);
      }
      return targetParaTextCache.get(pk);
    };

    const paragraphsJson = {};
    for (const r of paraRows) {
      const paraIndex = r.para_index;
      let rawText = r.pali_text || '';
      if (!rawText && !sentencesByPara.has(paraIndex)) {
        if (!lazyChapTexts) {
          lazyChapTexts = readChapterPack(this.dbTipitaka, bookCode, chapterIndex).paliMap;
        }
        rawText = lazyChapTexts.get(paraIndex) || '';
      }
      const lines = sentencesByPara.get(paraIndex) || (rawText.trim() ? [{ lineId: 1, text: rawText }] : []);
      if (lines.length === 0) continue;

      const lineNormCache = lines.map((line) => buildLineNorm(line.text, line.lineId));

      const byLine = {};
      const allItems = [];
      const seenAll = new Set();

      // Forward links
      const candidates = [];
      if ((isMula || !isTik) && r.attha_book && r.attha_book !== bookCode && r.attha_para) {
        const acKey = r.attha_chapter !== null && r.attha_chapter !== undefined ? String(r.attha_chapter) : '';
        const list = forwardBoldDefs.get(`${r.attha_book}|${acKey}|${String(r.attha_para).trim()}`);
        if (list) candidates.push(...list);
      }
      if ((isMula || isAtt) && r.tika_book && r.tika_book !== bookCode && r.tika_para) {
        const tcKey = r.tika_chapter !== null && r.tika_chapter !== undefined ? String(r.tika_chapter) : '';
        const list = forwardBoldDefs.get(`${r.tika_book}|${tcKey}|${String(r.tika_para).trim()}`);
        if (list) candidates.push(...list);
      }

      if (candidates.length > 0) {
        for (const line of lineNormCache) {
          if (!line.normLine) continue;
          const seenInLine = new Set();
          const lidKey = String(line.lineId);
          for (const c of candidates) {
            const lk = `${c.word}|${c.bookCode}`;
            if (seenInLine.has(lk)) continue;
            if (matchesInLine(line, c.word)) {
              seenInLine.add(lk);
              const item = {
                word: c.word,
                target_book: c.bookCode,
                target_book_title: c.bookTitle,
                target_category: c.category,
                target_chapter: c.chapterIndex,
                target_para_index: c.paraIndex,
                target_line_id: c.lineId,
                target_para_num: c.paraNum,
                is_source: false,
              };
              if (!byLine[lidKey]) byLine[lidKey] = [];
              byLine[lidKey].push(item);
              if (!seenAll.has(lk)) {
                seenAll.add(lk);
                allItems.push(item);
              }
            }
          }
        }
      }

      // Reverse links
      const selfBolds = selfBoldDefsByPara.get(paraIndex);
      if (selfBolds && selfBolds.length > 0) {
        const rawRevLayers = [];
        if (isTik && r.attha_book && r.attha_book !== bookCode && r.attha_para) {
          rawRevLayers.push({
            book: r.attha_book,
            chap: r.attha_chapter,
            para: String(r.attha_para).trim(),
          });
        }
        if (r.mula_book && r.mula_book !== bookCode && r.mula_para) {
          const mp = String(r.mula_para).trim();
          if (mp && !rawRevLayers.some((x) => x.book === r.mula_book)) {
            rawRevLayers.push({
              book: r.mula_book,
              chap: r.mula_chapter,
              para: mp,
            });
          }
        }

        const resolvedLayers = [];
        for (const layer of rawRevLayers) {
          if (!layer.para) continue;
          const targets = resolveTargetParas(layer.book, layer.chap, layer.para);
          if (targets.length === 0) continue;
          resolvedLayers.push({
            book: layer.book,
            title: getBookTitle(layer.book),
            category: categoryFromBookCode(layer.book),
            paraNum: layer.para,
            targets: targets.map((t) => ({
              chapterIndex: t.chapterIndex,
              paraIndex: t.paraIndex,
              targetLines: getTargetParaLines(layer.book, t.chapterIndex, t.paraIndex),
            })),
          });
        }

        if (resolvedLayers.length > 0) {
          const emitReverseItem = (lidKey, boldWord, layer, targetChapter, targetParaIndex, targetLineId) => {
            const revKey = `rev|${boldWord}|${layer.book}`;
            if (!byLine[lidKey]) byLine[lidKey] = [];
            if (!byLine[lidKey].some((e) => e.word === boldWord && e.target_book === layer.book)) {
              const item = {
                word: boldWord,
                target_book: layer.book,
                target_book_title: layer.title,
                target_category: layer.category,
                target_chapter: targetChapter,
                target_para_index: targetParaIndex,
                target_line_id: targetLineId ?? 1,
                target_para_num: layer.paraNum,
                is_source: true,
              };
              byLine[lidKey].push(item);
              if (!seenAll.has(revKey)) {
                seenAll.add(revKey);
                allItems.push(item);
              }
            }
          };

          for (const sb of selfBolds) {
            const boldWord = sb.word;
            let matchedLid = null;
            const byDefLine = lineNormCache.find((l) => l.lineId === sb.lineId);
            if (byDefLine && matchesInLine(byDefLine, boldWord)) {
              matchedLid = byDefLine.lineId;
            } else {
              for (const line of lineNormCache) {
                if (matchesInLine(line, boldWord)) {
                  matchedLid = line.lineId;
                  break;
                }
              }
            }
            const lidKey = String(matchedLid ?? byDefLine?.lineId ?? lineNormCache[0].lineId);

            for (const layer of resolvedLayers) {
              let foundHit = null;
              for (const t of layer.targets) {
                const tHit = t.targetLines.find((tl) => matchesInLine(tl, boldWord));
                if (tHit) {
                  foundHit = { chapterIndex: t.chapterIndex, paraIndex: t.paraIndex, lineId: tHit.lineId };
                  break;
                }
              }
              if (foundHit) {
                emitReverseItem(lidKey, boldWord, layer, foundHit.chapterIndex, foundHit.paraIndex, foundHit.lineId);
              }
            }
          }
        }
      }

      if (allItems.length > 0) {
        paragraphsJson[String(paraIndex)] = { by_line: byLine, all: allItems };
      }
    }

    const payload = { book_code: bookCode, chapter_index: chapterIndex, paragraphs: paragraphsJson };
    if (this.chapterLinksCache.size > 150) this.chapterLinksCache.clear();
    this.chapterLinksCache.set(cacheKey, payload);
    return payload;
  }

  getLinkedPreview({ book, chapter = null, paraIndex = null, paraNum = null, lineId = null, word = null, langs = [] }) {
    if (!this.dbTipitaka || !book) return null;
    const bRow = this.dbTipitaka.prepare('SELECT title FROM books WHERE code = ? LIMIT 1').get(book);
    if (!bRow) return null;
    const bookTitle = bRow.title || book;
    const category = categoryFromBookCode(book);

    let targetParaIdx = paraIndex;
    let targetChapIdx = chapter;
    let targetParaNum = paraNum;

    const normWord = word ? normPali(word) : null;
    const paliSentDb = this.getPaliSentDb ? this.getPaliSentDb() : null;

    if (targetParaIdx === null && targetParaNum) {
      let rows =
        targetChapIdx !== null
          ? this.dbTipitaka.prepare('SELECT chapter_index, para_index, para_num FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_num = ? ORDER BY para_index ASC').all(book, targetChapIdx, targetParaNum)
          : this.dbTipitaka.prepare('SELECT chapter_index, para_index, para_num FROM canon_paragraphs WHERE book_code = ? AND para_num = ? ORDER BY para_index ASC').all(book, targetParaNum);
      if (rows.length === 0 && targetChapIdx !== null) {
        rows = this.dbTipitaka.prepare('SELECT chapter_index, para_index, para_num FROM canon_paragraphs WHERE book_code = ? AND para_num = ? ORDER BY para_index ASC').all(book, targetParaNum);
      }
      const pFirst = parseInt(String(targetParaNum).split('-')[0], 10);
      if (rows.length === 0 && !isNaN(pFirst) && targetChapIdx !== null) {
        rows = this.dbTipitaka.prepare('SELECT chapter_index, para_index, para_num FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_first <= ? AND para_last >= ? ORDER BY para_index ASC').all(book, targetChapIdx, pFirst, pFirst);
      }
      if (rows.length === 0 && !isNaN(pFirst)) {
        rows = this.dbTipitaka.prepare('SELECT chapter_index, para_index, para_num FROM canon_paragraphs WHERE book_code = ? AND para_first <= ? AND para_last >= ? ORDER BY para_index ASC').all(book, pFirst, pFirst);
      }
      if (rows.length > 0) {
        let picked = rows[0];
        if (rows.length > 1 && normWord) {
          const candChapSentCache = new Map();
          for (const candRow of rows) {
            if (!candChapSentCache.has(candRow.chapter_index)) {
              candChapSentCache.set(candRow.chapter_index, readChapterSentences(this.dbTipitaka, paliSentDb, book, candRow.chapter_index));
            }
            const sents = candChapSentCache.get(candRow.chapter_index).get(candRow.para_index) || [];
            if (sents.some((s) => matchesInLine(buildLineNorm(s.text, s.lineId), normWord))) {
              picked = candRow;
              break;
            }
          }
        }
        targetChapIdx = picked.chapter_index;
        targetParaIdx = picked.para_index;
        targetParaNum = picked.para_num;
      }
    } else if (targetParaIdx !== null) {
      const row = this.dbTipitaka.prepare('SELECT chapter_index, para_num FROM canon_paragraphs WHERE book_code = ? AND para_index = ? LIMIT 1').get(book, targetParaIdx);
      if (row) {
        if (targetChapIdx === null) targetChapIdx = row.chapter_index;
        if (!targetParaNum) targetParaNum = row.para_num;
      }
    }

    if (targetParaIdx === null || targetParaIdx === undefined) return null;
    if (targetChapIdx === null || targetChapIdx === undefined) targetChapIdx = 0;

    let headingTitle = null;
    try {
      const tocRow = this.dbTipitaka.prepare('SELECT title FROM book_toc WHERE book_code = ? AND para_index <= ? ORDER BY para_index DESC LIMIT 1').get(book, targetParaIdx);
      headingTitle = tocRow?.title || null;
    } catch (_) {}

    const beforeParas = this.dbTipitaka.prepare('SELECT para_index, para_num, pali_text FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index <= ? ORDER BY para_index DESC LIMIT 7').all(book, targetChapIdx, targetParaIdx).reverse();
    const afterParas = this.dbTipitaka.prepare('SELECT para_index, para_num, pali_text FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index > ? ORDER BY para_index ASC LIMIT 10').all(book, targetChapIdx, targetParaIdx);
    const windowParas = [...beforeParas, ...afterParas];
    if (windowParas.length === 0) return null;

    const pack = readChapterPack(this.dbTipitaka, book, targetChapIdx);
    const minParaIdx = windowParas[0].para_index;
    const maxParaIdx = windowParas[windowParas.length - 1].para_index;

    const htmlByPara = new Map();
    try {
      const hasHtmlZ = getColumnSet(this.dbTipitaka, 'chapters').has('html_z');
      const chRow = this.dbTipitaka.prepare(
        hasHtmlZ
          ? 'SELECT html, html_z FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1'
          : 'SELECT html FROM chapters WHERE book_code = ? AND chapter_index = ? LIMIT 1'
      ).get(book, targetChapIdx);
      const chHtml = chRow ? decodeTextOrZlib(chRow.html, hasHtmlZ ? chRow.html_z : null) : null;
      if (chHtml) {
        const pTagRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
        const pindexRe = /\bdata-pindex="(\d+)"/i;
        let pm;
        while ((pm = pTagRe.exec(chHtml)) !== null) {
          const pStr = pindexRe.exec(pm[1] || '')?.[1];
          if (!pStr) continue;
          const pidx = parseInt(pStr, 10);
          if (pidx < minParaIdx || pidx > maxParaIdx) continue;
          const cleaned = cleanParagraphToHtmlWithB(pm[2] || '');
          if (cleaned) htmlByPara.set(pidx, cleaned);
        }
      }
    } catch (_) {}

    const sentByPara = readChapterSentences(this.dbTipitaka, paliSentDb, book, targetChapIdx);

    const loadedLangs = [];
    const paraTransByLang = new Map();
    const sentTransByLang = new Map();
    if (this.translationEngine && Array.isArray(langs) && langs.length > 0) {
      for (const rawLang of langs) {
        const code = this.translationEngine.ensureLanguage(rawLang);
        if (!code) continue;
        const entry = this.translationEngine.databases.get(code);
        if (!entry) continue;
        try {
          const pRows = entry.db.prepare('SELECT para_index, translation, sentences_json FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? ORDER BY para_index').all(book, targetChapIdx, minParaIdx, maxParaIdx);
          const pMap = new Map();
          const sMap = new Map();
          for (const pr of pRows) {
            if (pr.translation && String(pr.translation).trim()) pMap.set(pr.para_index, String(pr.translation).trim());
            if (pr.sentences_json) {
              try {
                const dec = JSON.parse(pr.sentences_json);
                if (Array.isArray(dec)) {
                  for (let idx = 0; idx < dec.length; idx++) {
                    const item = dec[idx];
                    if (typeof item === 'string') {
                      const txt = item.trim();
                      if (txt) {
                        if (!sMap.has(pr.para_index)) sMap.set(pr.para_index, new Map());
                        sMap.get(pr.para_index).set(idx + 1, txt);
                      }
                    } else if (item && item.line_id !== undefined && item.translation && String(item.translation).trim()) {
                      if (!sMap.has(pr.para_index)) sMap.set(pr.para_index, new Map());
                      sMap.get(pr.para_index).set(Number(item.line_id), String(item.translation).trim());
                    }
                  }
                }
              } catch (_) {}
            }
          }
          if (sMap.size === 0) {
            try {
              const stRows = entry.db.prepare('SELECT para_index, line_id, translation FROM sentence_translations WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? ORDER BY para_index, line_id').all(book, targetChapIdx, minParaIdx, maxParaIdx);
              for (const sr of stRows) {
                const txt = String(sr.translation || '').trim();
                if (!txt) continue;
                if (!sMap.has(sr.para_index)) sMap.set(sr.para_index, new Map());
                sMap.get(sr.para_index).set(Number(sr.line_id), txt);
              }
            } catch (_) {}
          }
          if (pMap.size > 0 || sMap.size > 0) {
            loadedLangs.push(code);
            paraTransByLang.set(code, pMap);
            sentTransByLang.set(code, sMap);
          }
        } catch (_) {}
      }
    }

    let resolvedTargetLineId = lineId;
    const lines = [];

    const highlightByNormWord = (sentence) => {
      if (!normWord || normWord.length < 2) return null;
      const cands = [...vowelVariants(normWord)];
      if (normWord.endsWith('ṃ') && normWord.length >= 3) cands.push(normWord.slice(0, -1));
      for (const c of cands) {
        const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?<!\\p{L})${esc}(?=n?t[iī]|[\\s.,;:!?…—–\\-'’"”)]|$)`, 'iu');
        if (re.test(sentence)) return sentence.replace(re, (m) => `<b>${m}</b>`);
      }
      const stem = inflectionStem(normWord);
      if (stem) {
        const escStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reStem = new RegExp(
          `(?<!\\p{L})${escStem}(?:a|ā|i|ī|u|ū|e|o|ṃ|aṃ|āya|assa|ānaṃ|asmā|amhā|asmiṃ|amhi|esu|ehi|ebhi|ena|āni|āyo|ayo|ino|inā|inaṃ|isu|īsu|uhi|ūhi|ussa|ūnaṃ|nti)?(?=[\\s.,;:!?…—–\\-'’"”)]|$)`,
          'iu'
        );
        if (reStem.test(sentence)) return sentence.replace(reStem, (m) => `<b>${m}</b>`);
      }
      return null;
    };

    const highlightSentence = (sentence, paraHtml, isTargetLine) => {
      if (!sentence) return sentence;
      if (sentence.includes('<b>')) {
        if (isTargetLine && normWord && normWord.length >= 2) {
          const boldInner = [...sentence.matchAll(/<b>([^<]+)<\/b>/gi)].map((m) => normPali(m[1])).join(' ');
          if (!matchesInLine(buildLineNorm(boldInner, 1), normWord)) {
            const plain = sentence.replace(/<\/?b>/gi, '');
            const highlighted = highlightByNormWord(plain);
            if (highlighted) return highlighted;
          }
        }
        return sentence;
      }
      if (isTargetLine) {
        const byWord = highlightByNormWord(sentence);
        if (byWord) return byWord;
      }
      if (paraHtml && paraHtml.includes('<b>')) {
        const bRe = /<b>([^<]+)<\/b>/g;
        let bm;
        while ((bm = bRe.exec(paraHtml)) !== null) {
          const term = bm[1].trim();
          if (term.length < 2) continue;
          const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, 'iu');
          if (re.test(sentence)) return sentence.replace(re, (m) => `<b>${m}</b>`);
        }
      }
      if (!isTargetLine) {
        const byWord = highlightByNormWord(sentence);
        if (byWord) return byWord;
      }
      return sentence;
    };

    const matchesTarget = (rawSent) => {
      if (!normWord) return false;
      return matchesInLine(buildLineNorm(rawSent, 1), normWord);
    };

    for (const wp of windowParas) {
      const sents = sentByPara.get(wp.para_index);
      if (sents && sents.length > 0) {
        for (const s of sents) {
          const trans = {};
          for (const lang of loadedLangs) {
            const st = sentTransByLang.get(lang)?.get(wp.para_index)?.get(s.lineId);
            if (st) trans[lang] = st;
            else if (sents.length === 1) {
              const pt = paraTransByLang.get(lang)?.get(wp.para_index);
              if (pt) trans[lang] = pt;
            }
          }
          let isTarget = false;
          if (wp.para_index === targetParaIdx) {
            if (lineId !== null && lineId !== undefined) {
              isTarget = s.lineId === lineId;
            } else if (matchesTarget(s.text)) {
              isTarget = true;
              if (resolvedTargetLineId === null || resolvedTargetLineId === undefined) {
                resolvedTargetLineId = s.lineId;
              }
            }
          }
          lines.push({
            para_index: wp.para_index,
            ...(wp.para_num ? { para_num: wp.para_num } : {}),
            line_id: s.lineId,
            pali_html: highlightSentence(s.text, htmlByPara.get(wp.para_index), isTarget),
            translations: trans,
            is_target: isTarget,
          });
        }
      } else {
        const trans = {};
        for (const lang of loadedLangs) {
          const pt = paraTransByLang.get(lang)?.get(wp.para_index);
          if (pt) trans[lang] = pt;
        }
        const paliFallback = wp.pali_text || pack.paliMap.get(wp.para_index) || '';
        lines.push({
          para_index: wp.para_index,
          ...(wp.para_num ? { para_num: wp.para_num } : {}),
          pali_html: htmlByPara.get(wp.para_index) || paliFallback,
          translations: trans,
          is_target: wp.para_index === targetParaIdx,
        });
      }
    }

    if (!lines.some((l) => l.is_target)) {
      const hit = lines.find((l) => l.para_index === targetParaIdx);
      if (hit) {
        hit.is_target = true;
        if (resolvedTargetLineId === null || resolvedTargetLineId === undefined) resolvedTargetLineId = hit.line_id;
      }
    }

    return {
      book_code: book,
      book_title: bookTitle,
      category,
      chapter_index: targetChapIdx,
      target_para_index: targetParaIdx,
      ...(targetParaNum ? { target_para_num: targetParaNum } : {}),
      ...(resolvedTargetLineId !== null && resolvedTargetLineId !== undefined ? { target_line_id: resolvedTargetLineId } : {}),
      ...(headingTitle ? { heading_title: headingTitle } : {}),
      translation_langs: loadedLangs,
      lines,
    };
  }
}

module.exports = { BoldLinkedEngine };
