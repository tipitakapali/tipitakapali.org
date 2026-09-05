'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dictEngine = require('./dictEngine');

// ═══════════════════════════════════════════════════════════════════════════
//  DATABASE CONNECTIONS & BOOK CODE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

let dbTipitaka = null;
let dbFts = null;
let dbSummaries = null;
const translationDbs = new Map();
const translationFtsDbs = new Map();
const bookCodeMap = new Map();

function initAiController({ db, dbFts: fts, resolveDbPath }) {
  dbTipitaka = db;
  dbFts = fts;

  // Load book mapping from epitaka.db or tipitaka.db
  try {
    const epiDbPath = path.resolve(__dirname, '../ref/epitaka_app/assets/db/epitaka.db');
    if (fs.existsSync(epiDbPath)) {
      const epiDb = new Database(epiDbPath, { readonly: true });
      const rows = epiDb.prepare("SELECT book_id, vri_id, book_name FROM books WHERE vri_id IS NOT NULL AND vri_id != ''").all();
      for (const r of rows) {
        bookCodeMap.set(r.book_id.toLowerCase(), r.vri_id);
        bookCodeMap.set(r.book_id, r.vri_id);
        bookCodeMap.set(r.vri_id, r.vri_id);
        bookCodeMap.set(r.vri_id.toLowerCase(), r.vri_id);
      }
      epiDb.close();
    }
  } catch (e) {
    console.warn('[AI Controller] Notice loading epitaka.db book mapping:', e.message);
  }

  // Load books from tipitaka.db
  if (dbTipitaka) {
    try {
      const bRows = dbTipitaka.prepare('SELECT code FROM books').all();
      for (const r of bRows) {
        bookCodeMap.set(r.code, r.code);
        bookCodeMap.set(r.code.toLowerCase(), r.code);
      }
    } catch (e) {}
  }

  // Common Nikaya & Book Short Form Aliases
  const commonAliases = {
    'dn1': 's0101m.mul', 'dn2': 's0102m.mul', 'dn3': 's0103m.mul',
    'd-i': 's0101m.mul', 'd-ii': 's0102m.mul', 'd-iii': 's0103m.mul',
    'mn1': 's0201m.mul', 'mn2': 's0202m.mul', 'mn3': 's0203m.mul',
    'm-i': 's0201m.mul', 'm-ii': 's0202m.mul', 'm-iii': 's0203m.mul',
    'sn1': 's0301m.mul', 'sn2': 's0302m.mul', 'sn3': 's0303m.mul', 'sn4': 's0304m.mul', 'sn5': 's0305m.mul',
    's-i': 's0301m.mul', 's-ii': 's0302m.mul', 's-iii': 's0303m.mul', 's-iv': 's0304m.mul', 's-v': 's0305m.mul',
    'an1': 's0401m1.mul', 'an2': 's0402m1.mul', 'an3': 's0402m2.mul', 'an4': 's0403m1.mul', 'an5': 's0403m2.mul',
    'a-i': 's0401m1.mul', 'a-ii': 's0402m1.mul', 'a-iii': 's0402m2.mul', 'a-iv': 's0403m1.mul', 'a-v': 's0404m3.mul',
    'dhp': 's0502m.mul', 'ud': 's0503m.mul', 'it': 's0504m.mul', 'snp': 's0505m.mul',
    'ja': 's0513m.mul', 'jat': 's0513m.mul', 'jataka': 's0513m.mul',
    'vv': 's0506m.mul', 'pv': 's0507m.mul', 'thag': 's0508m.mul', 'thig': 's0509m.mul',
    'vibhanga': 'abh02m.mul', 'dhammasangani': 'abh01m.mul', 'patthana': 'abh07m.mul',
  };
  for (const [k, v] of Object.entries(commonAliases)) {
    bookCodeMap.set(k.toLowerCase(), v);
  }

  // Load summaries.db if available
  const sumPath = resolveDbPath('summaries.db');
  if (sumPath && fs.existsSync(sumPath)) {
    try {
      dbSummaries = new Database(sumPath, { readonly: true });
      dbSummaries.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
      console.log(`[AI Controller] Connected to summaries database: ${sumPath}`);
    } catch (err) {
      console.warn('[AI Controller] Error connecting to summaries.db:', err.message);
    }
  }

  function getTranslationDb(lang) {
    if (translationDbs.has(lang)) return translationDbs.get(lang);
    const p = resolveDbPath(`translation_${lang}.db`);
    if (p && fs.existsSync(p)) {
      try {
        const tdb = new Database(p, { readonly: true });
        tdb.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
        translationDbs.set(lang, tdb);
        return tdb;
      } catch (e) {}
    }
    return null;
  }

  function getTranslationFtsDb(lang) {
    if (translationFtsDbs.has(lang)) return translationFtsDbs.get(lang);
    const p = resolveDbPath(`fts_translation_${lang}.db`);
    if (p && fs.existsSync(p)) {
      try {
        const fdb = new Database(p, { readonly: true });
        fdb.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
        translationFtsDbs.set(lang, fdb);
        return fdb;
      } catch (e) {}
    }
    return null;
  }

  return {
    getTranslationDb,
    getTranslationFtsDb,
  };
}

function resolveCanonicalBookCode(raw) {
  if (!raw) return '';
  const clean = String(raw).trim();
  const lower = clean.toLowerCase();
  if (bookCodeMap.has(clean)) return bookCodeMap.get(clean);
  if (bookCodeMap.has(lower)) return bookCodeMap.get(lower);

  // Check prefix match e.g. dn1 -> s0101m.mul
  const m = lower.match(/^([a-z]+)(\d+)(?:\.\d+)?$/);
  if (m) {
    const key = `${m[1]}${m[2]}`;
    if (bookCodeMap.has(key)) return bookCodeMap.get(key);
  }

  return clean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOOL DECLARATIONS FOR LLM FUNCTION CALLING
// ═══════════════════════════════════════════════════════════════════════════

const kAiToolDeclarations = [
  {
    name: 'search_sections',
    description:
      'Search section, sutta, and vagga TITLES (and rich study summaries) across the whole 217-book canon. ' +
      'Use this FIRST for concept questions to discover WHICH suttas discuss a topic before reading full passages.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Term, sutta name, or phrase to match against section/sutta titles or summaries (Pāli or English).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_tipitaka',
    description:
      'Search the Tipitaka database for passages using full-text search across Pāḷi Canon and translations. ' +
      'Returns matching passages with book codes, chapter titles, paragraph numbers, and text snippets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Search query — a phrase, compound, or keywords to search for in the Pāli text or translation.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_tipitaka_batch',
    description:
      'Search the Tipitaka using MULTIPLE different search terms simultaneously. ' +
      'Use this to search for a concept using several synonyms, compounds, or related terms in parallel.',
    parameters: {
      type: 'OBJECT',
      properties: {
        queries: {
          type: 'ARRAY',
          description: 'Array of 2 to 5 search queries to run in parallel (different phrasings, synonyms, compounds).',
          items: { type: 'STRING' },
        },
      },
      required: ['queries'],
    },
  },
  {
    name: 'search_by_category',
    description:
      'Search the Tipitaka within specific book categories ("vinaya", "sutta", "abhidhamma") ' +
      'or nikayas ("dn", "mn", "sn", "an", "kn", "dhp", "ja"). Results are filtered strictly to those books.',
    parameters: {
      type: 'OBJECT',
      properties: {
        queries: {
          type: 'ARRAY',
          description: 'Array of search queries to execute within target books.',
          items: { type: 'STRING' },
        },
        categories: {
          type: 'ARRAY',
          description: 'Book categories: ["vinaya"], ["sutta"], and/or ["abhidhamma"].',
          items: { type: 'STRING' },
        },
        nikayas: {
          type: 'ARRAY',
          description: 'Nikaya abbreviations: ["dn"], ["mn"], ["sn"], ["an"], ["dhp"], ["ja"], etc.',
          items: { type: 'STRING' },
        },
      },
      required: ['queries'],
    },
  },
  {
    name: 'get_section',
    description:
      'Get details of a specific chapter or section: title, summary, outline, and paragraph boundaries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Book code (e.g. "s0101m.mul", "s0201m.mul", "D-i", "M-i").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Chapter index (0-based integer).',
        },
      },
      required: ['book_code'],
    },
  },
  {
    name: 'get_paragraph_content',
    description:
      'Get the full text of a range of paragraphs from a book, including original Pāli and available English and Vietnamese translations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Book code (e.g. "s0101m.mul", "s0201m.mul", "M-i", "D-i").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Chapter index (0-based). Optional if para_start is provided.',
        },
        para_start: {
          type: 'INTEGER',
          description: 'Starting paragraph index or paragraph number (inclusive).',
        },
        para_end: {
          type: 'INTEGER',
          description: 'Ending paragraph index or paragraph number (inclusive).',
        },
      },
      required: ['book_code', 'para_start'],
    },
  },
  {
    name: 'get_paragraph_content_batch',
    description:
      'Read multiple paragraph ranges in parallel across different books or chapters.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ranges: {
          type: 'ARRAY',
          description: 'Array of paragraph ranges to read: [{ book_code, chapter_index, para_start, para_end }].',
          items: {
            type: 'OBJECT',
            properties: {
              book_code: { type: 'STRING' },
              chapter_index: { type: 'INTEGER' },
              para_start: { type: 'INTEGER' },
              para_end: { type: 'INTEGER' },
            },
            required: ['book_code', 'para_start'],
          },
        },
      },
      required: ['ranges'],
    },
  },
  {
    name: 'get_commentaries',
    description:
      'Find related Aṭṭhakathā (commentary) and Ṭīkā (sub-commentary) passages for a given Mūla (root) paragraph.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Book code of the Mūla text (e.g. "s0101m.mul", "s0201m.mul").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Chapter index in the Mūla text.',
        },
        para_num: {
          type: 'STRING',
          description: 'Paragraph number (e.g. "1", "10", "165").',
        },
      },
      required: ['book_code', 'chapter_index', 'para_num'],
    },
  },
  {
    name: 'get_dictionary',
    description:
      'Get definitions, grammatical analysis, and meanings for a Pāli term from the Digital Pāli Dictionary (DPD).',
    parameters: {
      type: 'OBJECT',
      properties: {
        word: {
          type: 'STRING',
          description: 'Pāli word to look up (e.g. "saṅkhāra", "anicca", "nibbāna", "mettā").',
        },
      },
      required: ['word'],
    },
  },
  {
    name: 'get_dictionary_batch',
    description:
      'Look up definitions for multiple Pāli terms in ONE call in parallel.',
    parameters: {
      type: 'OBJECT',
      properties: {
        words: {
          type: 'ARRAY',
          description: 'Array of 2 to 5 Pāli words to look up.',
          items: { type: 'STRING' },
        },
      },
      required: ['words'],
    },
  },
  {
    name: 'get_books',
    description: 'Get list of available books in the Chaṭṭha Saṅgāyana Tipiṭaka with their codes, titles, and nikayas.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'final_answer',
    description:
      'Call this when you have collected all the sources needed to answer the user question. ' +
      'Summarize the gathered sources in the arguments.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description: 'Brief summary of the findings and passages collected.',
        },
      },
      required: ['summary'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const kAiDefaultToolSystemPrompt = `You are Ani (AI Nissaya), the dedicated scholarly AI assistant for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāli Canon).
Your duty is to systematically investigate the Dhamma through precise canonical research.

## Available Research Tools
1. search_sections(query) — Search sutta and vagga titles across the entire canon. Use this FIRST to identify relevant suttas.
2. get_section(book_code, chapter_index) — Read section overview, outline, and study guides.
3. search_by_category(queries, categories, nikayas) — Search within specific Piṭakas ("vinaya", "sutta", "abhidhamma") or Nikāyas ("dn", "mn", "sn", "an", "kn", "dhp").
4. search_tipitaka_batch(queries) — Run multiple search terms in parallel (synonyms, technical compounds).
5. search_tipitaka(query) — Full-text search across Pāḷi and translations.
6. get_paragraph_content(book_code, chapter_index, para_start, para_end) — Read exact Pāḷi text and translations.
7. get_paragraph_content_batch(ranges) — Read multiple passages across suttas in parallel.
8. get_commentaries(book_code, chapter_index, para_num) — Retrieve corresponding Aṭṭhakathā and Ṭīkā explanations.
9. get_dictionary(word) / get_dictionary_batch(words) — DPD dictionary definitions and grammatical roots.
10. get_books() — List of books and their codes.
11. final_answer(summary) — Finalize research once you have gathered sufficient canonical evidence.

## Strategic Research Workflow
- Phase 1: Disambiguate technical terms. E.g., for "saṅkhāra", identify distinct senses: (1) conditioned things in general (anicca), (2) 4th aggregate (saṅkhārakkhandho), (3) link in paṭiccasamuppāda, (4) volitional formations (cetanā).
- Phase 2: Sutta discovery with search_sections or search_by_category.
- Phase 3: Read exact paragraphs using get_paragraph_content.
- Phase 4: Retrieve commentaries (Aṭṭhakathā) when deeper clarification or orthodox interpretation is needed.
- Strip final vowel (-a, -ā) when searching Pāḷi word stems to match all case endings (e.g. "buddh", "dhamm", "sacc").
- Call final_answer when you have solid passages directly addressing the inquiry.`;

function buildAnswerSystemPrompt({ orthodoxMode = true }) {
  const grounding = orthodoxMode
    ? `## RAG Mode Rules (Strict Grounding)
1. Every factual claim MUST be supported by an inline citation in the exact format: [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{start}-{end}].
2. Answer the user's question using ONLY the canonical passages and commentaries returned by the research tools.
3. Quote Pāḷi verses or phrases EXACTLY as written in the sources; provide clear English translations following each quote.
4. If the retrieved sources do not fully answer the question, state this with complete honesty rather than speculating.
5. Explain technical Pāḷi terms on first mention.
6. Format citations as [book_code:c{chapter_index}:p{para_index}] (e.g. [s0101m.mul:c0:p5]) so users can click them directly to read the original text.`
    : `## Knowledge Mode Rules (Canonical + Contextual Knowledge)
1. Base your answer primarily on the canonical passages retrieved by the tools, with inline citations [book_code:c{chap}:p{para}].
2. You may supplement with your broader knowledge of the Pāḷi Canon, Theravāda Abhidhamma, and historical commentary where sources are partial, but clearly distinguish canonical citations from broader exposition.
3. Quote Pāḷi accurately, with translation following.
4. Format citations as [book_code:c{chapter_index}:p{para_index}] (e.g. [s0101m.mul:c0:p5]) so users can click them to navigate in the reader.`;

  return `You are Ani (AI Nissaya), the scholarly Pāḷi Canon companion on tipitakapali.org.
You have been supplied with verified passages and dictionary entries from the Chaṭṭha Saṅgāyana Tipiṭaka and its commentaries.

## Task
Write a comprehensive, insightful, and clearly structured answer to the user's question using rich Markdown (headers, bullet points, blockquotes for Pāḷi verses).

## Citation Format
All canonical citations MUST appear as clickable chips in square brackets:
  [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_start}-{para_end}]
Example:
  > "Namo tassa bhagavato arahato sammāsambuddhassa..." [s0101m.mul:c0:p0]

${grounding}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SEARCH & QUERY STEMMING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const AI_STOP_WORDS = new Set([
  'explain', 'what', 'which', 'where', 'when', 'who', 'how', 'why',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'their', 'there', 'these', 'those',
  'this', 'that', 'they', 'them', 'canonical', 'definitions', 'definition',
  'sutta', 'suttas', 'relevant', 'quote', 'passages', 'passage', 'text', 'please',
  'tell', 'me', 'give', 'list', 'show', 'explore', 'between', 'exact', 'sn', 'mn', 'dn', 'an'
]);

// Strip terminal vowels (-a, -ā, -e, -o) for Pāḷi stem matching
function paliStem(word) {
  if (!word || word.length < 3) return word;
  return word.replace(/[aāeo]$/i, '');
}

function formatFtsQuery(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const clean = raw.trim().toLowerCase();
  const tokens = clean
    .split(/[\s,.;:!?()\[\]{}*+^~\\/<>'"-]+/)
    .filter((w) => w.length >= 2 && !AI_STOP_WORDS.has(w));

  if (tokens.length === 0) {
    const fallback = clean
      .split(/[\s,.;:!?()\[\]{}*+^~\\/<>'"-]+/)
      .filter((w) => w.length >= 2);
    if (fallback.length === 0) return '';
    return fallback.map((t) => (t.length >= 3 ? `"${t.replace(/"/g, '""')}"*` : `"${t.replace(/"/g, '""')}"`)).join(' OR ');
  }

  // Include stems for Pāḷi terms
  const terms = [];
  for (const t of tokens) {
    const safe = t.replace(/"/g, '""');
    terms.push(`"${safe}"*`);
    const stem = paliStem(safe);
    if (stem && stem !== safe && stem.length >= 3) {
      terms.push(`"${stem}"*`);
    }
  }

  return terms.join(' OR ');
}

// Expand common sutta variant terms
function expandSuttaNameVariants(q) {
  if (!q) return [];
  const lower = q.toLowerCase();
  const variants = [lower];

  if (lower.includes('kaccayanagotta') || lower.includes('kaccāyanagotta')) {
    variants.push('kaccānagotta*', 'kaccāna*', 'kaccāyana*');
  }
  if (lower.includes('sigalovada') || lower.includes('singalovada')) {
    variants.push('siṅgāla*', 'sigāla*');
  }
  if (lower.includes('kalama') || lower.includes('kālāma')) {
    variants.push('kesamutti*', 'kālāma*', 'kalama*');
  }
  if (lower.includes('satipatthana') || lower.includes('satipaṭṭhāna')) {
    variants.push('satipaṭṭhāna*', 'satipatthana*');
  }
  if (lower.includes('anattalakkhana') || lower.includes('anattalakkhaṇa')) {
    variants.push('anattalakkhaṇa*', 'anattalakkhana*');
  }
  if (lower.includes('mahaparinibbana') || lower.includes('mahāparinibbāna')) {
    variants.push('mahāparinibbāna*', 'mahaparinibbana*');
  }
  if (lower.includes('dhammacakka')) {
    variants.push('dhammacakka*');
  }
  return variants;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

function aiSearchSections({ query, limit = 20 }) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { success: true, count: 0, results: [] };

  const results = [];
  const seen = new Set();
  const activeLimit = Math.min(Math.max(1, limit), 50);

  // 1. Search in summaries.db
  if (dbSummaries) {
    try {
      const ftsQ = formatFtsQuery(trimmed);
      const variants = expandSuttaNameVariants(trimmed);
      const searchQueries = [ftsQ, ...variants.map((v) => `"${v.replace(/[*"]/g, '')}"*`)].filter(Boolean);

      for (const qStr of searchQueries) {
        if (results.length >= activeLimit) break;
        try {
          // A. Check all_sections_fts (covers all 37,226 canonical TOC entries + 17k suttas)
          const tocHits = dbSummaries.prepare(`
            SELECT book_code, book_title, title, chapter_index, para_index, para_num, level,
                   snippet(all_sections_fts, 2, '<mark>', '</mark>', '...', 25) AS snippet
            FROM all_sections_fts
            WHERE all_sections_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(qStr, activeLimit);

          for (const t of tocHits) {
            const key = `sec:${t.book_code}:${t.chapter_index}:${t.para_index}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              type: 'section',
              book_code: t.book_code,
              book_title: t.book_title || t.book_code,
              title: t.title,
              chapter_index: t.chapter_index || 0,
              para_index: t.para_index || 0,
              para_num: t.para_num || '',
              level: t.level,
              snippet: t.snippet || '',
              citation_ref: `[${t.book_code}:c${t.chapter_index || 0}:p${t.para_index || 0}]`,
            });
            if (results.length >= activeLimit) break;
          }

          // B. Check summaries_fts (121,555 study guides and overviews)
          const sumHits = dbSummaries.prepare(`
            SELECT rowid, book_code, book_title, title, sutta_title, vagga_title, heading_title,
                   snippet(summaries_fts, 7, '<mark>', '</mark>', '...', 25) AS snippet
            FROM summaries_fts
            WHERE summaries_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `).all(qStr, activeLimit);

          for (const s of sumHits) {
            const key = `sum:${s.book_code}:${s.title}`;
            if (seen.has(key)) continue;
            seen.add(key);

            let sFull = null;
            try {
              sFull = dbSummaries.prepare('SELECT section_id, chapter_index, para_start, para_end, para_index_start, para_index_end, content FROM summaries WHERE id = ?').get(s.rowid);
            } catch (e) {}

            results.push({
              type: 'summary',
              book_code: s.book_code,
              book_title: s.book_title,
              title: s.title || s.sutta_title || s.heading_title,
              sutta_title: s.sutta_title,
              vagga_title: s.vagga_title,
              chapter_index: sFull ? sFull.chapter_index : 0,
              para_start: sFull ? sFull.para_start : null,
              para_end: sFull ? sFull.para_end : null,
              para_index: sFull ? sFull.para_index_start : 0,
              snippet: s.snippet || '',
              citation_ref: `[${s.book_code}:c${sFull?.chapter_index || 0}:p${sFull?.para_index_start || 0}]`,
            });
            if (results.length >= activeLimit) break;
          }
        } catch (e) {}
      }
    } catch (err) {
      console.warn('[AI Sections] summaries search error:', err.message);
    }
  }

  // 2. Fallback: Search book_toc in tipitaka.db
  if (results.length < activeLimit && dbTipitaka) {
    try {
      const pattern = `%${trimmed}%`;
      const tocRows = dbTipitaka.prepare(`
        SELECT t.book_code, b.title AS book_title, t.chapter_index, t.title, t.para_index, t.para_num, t.level
        FROM book_toc t
        LEFT JOIN books b ON b.code = t.book_code
        WHERE t.title LIKE ?
        ORDER BY t.level ASC
        LIMIT ?
      `).all(pattern, activeLimit);

      for (const r of tocRows) {
        const key = `sec:${r.book_code}:${r.chapter_index}:${r.para_index}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          type: 'section',
          book_code: r.book_code,
          book_title: r.book_title || r.book_code,
          title: r.title,
          chapter_index: r.chapter_index || 0,
          para_index: r.para_index || 0,
          para_num: r.para_num || '',
          level: r.level,
          citation_ref: `[${r.book_code}:c${r.chapter_index || 0}:p${r.para_index || 0}]`,
        });
        if (results.length >= activeLimit) break;
      }
    } catch (e) {}
  }

  return { success: true, count: results.length, results };
}

function aiSearchTipitaka({ query, limit = 20, categories = [], nikayas = [] }) {
  if (!dbFts && !dbTipitaka) return { success: false, results: [], error: 'Database unavailable' };
  const ftsQ = formatFtsQuery(query);
  if (!ftsQ) return { success: true, count: 0, results: [] };

  const activeLimit = Math.min(Math.max(1, limit), 50);
  const results = [];
  const seenKeys = new Set();

  let allowedBooks = null;
  if ((categories && categories.length > 0) || (nikayas && nikayas.length > 0)) {
    const conds = [];
    const params = [];
    if (categories && categories.length > 0) {
      conds.push(`category IN (${categories.map(() => '?').join(',')})`);
      params.push(...categories.map((c) => c.toLowerCase()));
    }
    if (nikayas && nikayas.length > 0) {
      conds.push(`(${nikayas.map(() => 'LOWER(nikaya) LIKE ? OR LOWER(code) LIKE ?').join(' OR ')})`);
      for (const n of nikayas) {
        params.push(`%${n.toLowerCase()}%`, `%${n.toLowerCase()}%`);
      }
    }
    try {
      const q = `SELECT code FROM books WHERE ${conds.join(' AND ')}`;
      const rows = dbTipitaka.prepare(q).all(...params);
      allowedBooks = new Set(rows.map((r) => r.code));
    } catch (e) {}
  }

  // 1. Search Pāli Canon FTS
  try {
    const ftsDb = dbFts || dbTipitaka;
    const stmt = ftsDb.prepare(`
      SELECT book_code, book_title, nikaya, para_num, para_index,
             snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet,
             content
      FROM paragraphs_fts
      WHERE paragraphs_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const hits = stmt.all(ftsQ, activeLimit * 3);

    // Prioritize Mūla root suttas (.mul) before commentaries (.att, .tik)
    hits.sort((a, b) => {
      const aIsMul = (a.book_code || '').includes('.mul') ? 1 : 0;
      const bIsMul = (b.book_code || '').includes('.mul') ? 1 : 0;
      if (aIsMul !== bIsMul) return bIsMul - aIsMul;
      return 0;
    });

    for (const h of hits) {
      if (allowedBooks && !allowedBooks.has(h.book_code)) continue;
      const key = `${h.book_code}:${h.para_index}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      let chapIdx = 0;
      let chapTitle = '';
      try {
        const cRow = dbTipitaka.prepare('SELECT chapter_index, chapter_title FROM canon_paragraphs WHERE book_code = ? AND para_index = ?').get(h.book_code, h.para_index);
        if (cRow) {
          chapIdx = cRow.chapter_index;
          chapTitle = cRow.chapter_title || '';
        }
      } catch (e) {}

      results.push({
        book_code: h.book_code,
        book_title: h.book_title,
        nikaya: h.nikaya,
        chapter_index: chapIdx,
        chapter_title: chapTitle,
        para_index: h.para_index,
        para_num: h.para_num,
        snippet: h.snippet,
        text: h.content ? h.content.substring(0, 320) : '',
        citation_ref: `[${h.book_code}:c${chapIdx}:p${h.para_index}]`,
        source_type: 'pali',
      });
      if (results.length >= activeLimit) break;
    }
  } catch (err) {
    console.warn('[AI Search] Pāli FTS query error:', err.message);
  }

  // 2. Search English translation FTS if needed
  if (results.length < activeLimit) {
    try {
      const enFtsPath = path.join(__dirname, 'db/fts_translation_en.db');
      if (fs.existsSync(enFtsPath)) {
        const enDb = new Database(enFtsPath, { readonly: true });
        const enHits = enDb.prepare(`
          SELECT book_code, book_title, nikaya, para_num, para_index,
                 snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet,
                 content
          FROM paragraphs_fts
          WHERE paragraphs_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsQ, activeLimit);
        enDb.close();

        for (const h of enHits) {
          if (allowedBooks && !allowedBooks.has(h.book_code)) continue;
          const key = `${h.book_code}:${h.para_index}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          let chapIdx = 0;
          let chapTitle = '';
          try {
            const cRow = dbTipitaka.prepare('SELECT chapter_index, chapter_title FROM canon_paragraphs WHERE book_code = ? AND para_index = ?').get(h.book_code, h.para_index);
            if (cRow) {
              chapIdx = cRow.chapter_index;
              chapTitle = cRow.chapter_title || '';
            }
          } catch (e) {}

          results.push({
            book_code: h.book_code,
            book_title: h.book_title,
            nikaya: h.nikaya,
            chapter_index: chapIdx,
            chapter_title: chapTitle,
            para_index: h.para_index,
            para_num: h.para_num,
            snippet: h.snippet,
            text: h.content ? h.content.substring(0, 320) : '',
            citation_ref: `[${h.book_code}:c${chapIdx}:p${h.para_index}]`,
            source_type: 'translation_en',
          });
          if (results.length >= activeLimit) break;
        }
      }
    } catch (e) {}
  }

  return { success: true, count: results.length, results };
}

function aiGetSection({ book_code, chapter_index = 0 }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);

  try {
    const chap = dbTipitaka.prepare('SELECT title, anchor_id, para_index FROM chapters WHERE book_code = ? AND chapter_index = ?').get(targetCode, chapter_index);
    const book = dbTipitaka.prepare('SELECT title, nikaya, category FROM books WHERE code = ?').get(targetCode);
    const tocItems = dbTipitaka.prepare('SELECT title, level, type, para_index, para_num FROM book_toc WHERE book_code = ? AND chapter_index = ? ORDER BY item_index ASC LIMIT 30').all(targetCode, chapter_index);

    let summaryContent = null;
    if (dbSummaries) {
      try {
        const sumRow = dbSummaries.prepare('SELECT title, content, sources FROM summaries WHERE book_code = ? AND chapter_index = ?').get(targetCode, chapter_index);
        if (sumRow) summaryContent = sumRow;
      } catch (e) {}
    }

    return {
      success: true,
      book_code: targetCode,
      book_title: book ? book.title : targetCode,
      chapter_index,
      chapter_title: chap ? chap.title : '',
      para_start_index: chap ? chap.para_index : 0,
      headings: tocItems,
      summary: summaryContent,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetParagraphContent({ book_code, chapter_index, para_start, para_end, langs = ['en', 'vi'] }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);
  const start = parseInt(para_start !== undefined ? para_start : '0', 10);
  const end = parseInt(para_end !== undefined ? para_end : start, 10);

  try {
    let pRows = [];

    // 1. Try with chapter_index first
    if (chapter_index !== undefined && chapter_index !== null) {
      pRows = dbTipitaka.prepare(`
        SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
               para_index, para_num, pali_text
        FROM canon_paragraphs
        WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ?
        ORDER BY para_index
      `).all(targetCode, chapter_index, start, end);
    }

    // 2. If not found, query by book_code and para_index directly (para_index is book-wide)
    if (pRows.length === 0) {
      pRows = dbTipitaka.prepare(`
        SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
               para_index, para_num, pali_text
        FROM canon_paragraphs
        WHERE book_code = ? AND para_index BETWEEN ? AND ?
        ORDER BY para_index
      `).all(targetCode, start, end);
    }

    // 3. If still empty, check if start/end was actually a para_num
    if (pRows.length === 0) {
      pRows = dbTipitaka.prepare(`
        SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
               para_index, para_num, pali_text
        FROM canon_paragraphs
        WHERE book_code = ? AND para_num = ?
        LIMIT 1
      `).all(targetCode, String(start));
    }

    const passages = [];
    for (const p of pRows) {
      const translations = {};
      for (const lang of langs) {
        const transDbPath = path.join(__dirname, `db/translation_${lang}.db`);
        if (fs.existsSync(transDbPath)) {
          try {
            const tdb = new Database(transDbPath, { readonly: true });
            const tRow = tdb.prepare('SELECT translation FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(p.book_code, p.chapter_index, p.para_index);
            tdb.close();
            if (tRow && tRow.translation) {
              translations[lang] = tRow.translation;
            }
          } catch (e) {}
        }
      }

      passages.push({
        guid: p.guid,
        book_code: p.book_code,
        chapter_index: p.chapter_index,
        chapter_title: p.chapter_title || '',
        sutta_title: p.sutta_title || '',
        para_index: p.para_index,
        para_num: p.para_num,
        pali: p.pali_text,
        translations,
        citation_ref: `[${p.book_code}:c${p.chapter_index}:p${p.para_index}]`,
      });
    }

    return { success: true, count: passages.length, passages };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetCommentaries({ book_code, chapter_index, para_num }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);

  try {
    const cleanNum = String(para_num || '').replace(/^(?:para-?|p)/i, '').trim();
    const mapRow = dbTipitaka.prepare(`
      SELECT source_book, source_chapter, source_para,
             mula_book, mula_chapter, mula_para, mula_title,
             attha_book, attha_chapter, attha_para, attha_title,
             tika_book, tika_chapter, tika_para, tika_title
      FROM mat_para_map
      WHERE (source_book = ? OR mula_book = ?) AND (source_para = ? OR mula_para = ?)
      LIMIT 1
    `).get(targetCode, targetCode, cleanNum, cleanNum);

    if (!mapRow) {
      const canonRow = dbTipitaka.prepare(`
        SELECT mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para
        FROM canon_paragraphs
        WHERE book_code = ? AND para_num = ?
        LIMIT 1
      `).get(targetCode, cleanNum);

      return {
        success: true,
        source: { book_code: targetCode, chapter_index, para_num: cleanNum },
        commentaries: canonRow || null,
      };
    }

    let atthaText = null;
    if (mapRow.attha_book && mapRow.attha_para) {
      try {
        const row = dbTipitaka.prepare('SELECT pali_text, chapter_title, para_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? LIMIT 1').get(mapRow.attha_book, mapRow.attha_para);
        if (row) atthaText = row;
      } catch (e) {}
    }

    let tikaText = null;
    if (mapRow.tika_book && mapRow.tika_para) {
      try {
        const row = dbTipitaka.prepare('SELECT pali_text, chapter_title, para_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? LIMIT 1').get(mapRow.tika_book, mapRow.tika_para);
        if (row) tikaText = row;
      } catch (e) {}
    }

    return {
      success: true,
      source: { book_code: targetCode, chapter_index, para_num: cleanNum },
      mula: { book: mapRow.mula_book, chapter: mapRow.mula_chapter, para: mapRow.mula_para, title: mapRow.mula_title },
      atthakatha: { book: mapRow.attha_book, chapter: mapRow.attha_chapter, para: mapRow.attha_para, title: mapRow.attha_title, text: atthaText?.pali_text || '' },
      tika: { book: mapRow.tika_book, chapter: mapRow.tika_chapter, para: mapRow.tika_para, title: mapRow.tika_title, text: tikaText?.pali_text || '' },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetDictionary({ word }) {
  if (!word || typeof word !== 'string') return { success: false, error: 'Empty word' };
  try {
    const dpdResult = dictEngine.lookupDPDFast(word.trim(), false);
    const cleanEntries = [];
    if (dpdResult && Array.isArray(dpdResult.dpd)) {
      for (const item of dpdResult.dpd.slice(0, 4)) {
        const plainHtml = (item.html || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        cleanEntries.push({
          word: item.word,
          isExact: item.isExact,
          definition: plainHtml.substring(0, 350),
        });
      }
    }
    return { success: true, word: word.trim(), entries: cleanEntries };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetBooks() {
  if (!dbTipitaka) return { success: false, books: [] };
  try {
    const books = dbTipitaka.prepare('SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id').all();
    return { success: true, count: books.length, books };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CENTRAL TOOL DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════

async function executeAiTool(name, args = {}) {
  switch (name) {
    case 'search_sections':
      return aiSearchSections({ query: args.query, limit: 15 });
    case 'search_tipitaka':
      return aiSearchTipitaka({ query: args.query, limit: 15 });
    case 'search_tipitaka_batch': {
      const queries = Array.isArray(args.queries) ? args.queries : [];
      const combined = [];
      const seen = new Set();
      for (const q of queries.slice(0, 4)) {
        const res = aiSearchTipitaka({ query: q, limit: 10 });
        if (res.success && Array.isArray(res.results)) {
          for (const item of res.results) {
            const k = `${item.book_code}:${item.para_index}`;
            if (!seen.has(k)) {
              seen.add(k);
              combined.push(item);
            }
          }
        }
      }
      return { success: true, count: combined.length, results: combined.slice(0, 25) };
    }
    case 'search_by_category': {
      const queries = Array.isArray(args.queries) ? args.queries : [args.query || ''];
      const categories = Array.isArray(args.categories) ? args.categories : [];
      const nikayas = Array.isArray(args.nikayas) ? args.nikayas : [];
      const combined = [];
      const seen = new Set();
      for (const q of queries.slice(0, 4)) {
        const res = aiSearchTipitaka({ query: q, limit: 15, categories, nikayas });
        if (res.success && Array.isArray(res.results)) {
          for (const item of res.results) {
            const k = `${item.book_code}:${item.para_index}`;
            if (!seen.has(k)) {
              seen.add(k);
              combined.push(item);
            }
          }
        }
      }
      return { success: true, count: combined.length, results: combined.slice(0, 25) };
    }
    case 'get_section':
      return aiGetSection({ book_code: args.book_code, chapter_index: args.chapter_index });
    case 'get_paragraph_content':
      return aiGetParagraphContent({
        book_code: args.book_code,
        chapter_index: args.chapter_index,
        para_start: args.para_start,
        para_end: args.para_end,
      });
    case 'get_paragraph_content_batch': {
      const ranges = Array.isArray(args.ranges) ? args.ranges : [];
      const allPassages = [];
      for (const r of ranges.slice(0, 6)) {
        const res = aiGetParagraphContent({
          book_code: r.book_code,
          chapter_index: r.chapter_index,
          para_start: r.para_start,
          para_end: r.para_end,
        });
        if (res.success && Array.isArray(res.passages)) {
          allPassages.push(...res.passages);
        }
      }
      return { success: true, count: allPassages.length, passages: allPassages };
    }
    case 'get_commentaries':
      return aiGetCommentaries({
        book_code: args.book_code,
        chapter_index: args.chapter_index,
        para_num: args.para_num,
      });
    case 'get_dictionary':
      return aiGetDictionary({ word: args.word });
    case 'get_dictionary_batch': {
      const words = Array.isArray(args.words) ? args.words : [];
      const dictEntries = [];
      for (const w of words.slice(0, 5)) {
        const res = aiGetDictionary({ word: w });
        if (res.success) dictEntries.push(res);
      }
      return { success: true, count: dictEntries.length, entries: dictEntries };
    }
    case 'get_books':
      return aiGetBooks();
    case 'final_answer':
      return { success: true, summary: args.summary || 'Research complete' };
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CITATION PARSING
// ═══════════════════════════════════════════════════════════════════════════

function parseCitations(text) {
  if (!text) return [];
  // Supports [book:c{chap}:p{para}], [book:c{chap}:p{start}-{end}], [book:{para}], and [book:c{chap}:p{para}:l{line}]
  const regex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–](\d+))?(?::(\d+))?\]/g;
  const seen = new Set();
  const citations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[0];
    const rawBook = match[1];
    const bookCode = resolveCanonicalBookCode(rawBook);
    const chapIdx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
    const paraIdx = parseInt(match[3], 10);
    const paraEnd = match[4] ? parseInt(match[4], 10) : null;
    const lineId = match[5] ? parseInt(match[5], 10) : null;

    const key = `${bookCode}:${chapIdx}:${paraIdx}${paraEnd ? `-${paraEnd}` : ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        bookCode,
        rawBook,
        chapterIndex: chapIdx,
        paraIndex: paraIdx,
        paraEnd,
        lineId,
        ref: rawTag,
      });
    }
  }
  return citations;
}

// ═══════════════════════════════════════════════════════════════════════════
//  OFFLINE CANONICAL REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateOfflineCanonicalAnswer(userQuery, collectedToolData) {
  const passages = [];
  const sections = [];
  const dictEntries = [];

  for (const item of collectedToolData) {
    if (item.result?.results) {
      if (item.tool === 'search_sections') sections.push(...item.result.results);
      else passages.push(...item.result.results);
    }
    if (item.result?.passages) passages.push(...item.result.passages);
    if (item.result?.entries) dictEntries.push(...item.result.entries);
  }

  let text = `## Ani (AI Nissaya) Canonical Research Report\n\n`;
  text += `Regarding your inquiry: *"${userQuery}"*\n\n`;

  if (sections.length > 0) {
    text += `### Relevant Suttas & Sections in the Tipiṭaka:\n`;
    for (const sec of sections.slice(0, 4)) {
      const cite = sec.citation_ref || `[${sec.book_code}:c${sec.chapter_index}:p${sec.para_index}]`;
      text += `- **${sec.title || sec.sutta_title}** (${sec.book_title}) ${cite}\n`;
      if (sec.snippet) {
        text += `  > ${sec.snippet.replace(/<mark>/g, '**').replace(/<\/mark>/g, '**')}\n`;
      }
    }
    text += `\n`;
  }

  if (passages.length > 0) {
    text += `### Key Canonical Passages:\n\n`;
    for (let i = 0; i < Math.min(passages.length, 5); i++) {
      const p = passages[i];
      const paliSnippet = p.text || p.snippet || p.pali || '';
      const cleanSnippet = paliSnippet.replace(/<mark>/g, '**').replace(/<\/mark>/g, '**');
      const cite = p.citation_ref || `[${p.book_code}:c${p.chapter_index}:p${p.para_index}]`;
      text += `> "${cleanSnippet}" ${cite}\n\n`;
      if (p.translations?.en) {
        text += `*English Translation:* ${p.translations.en}\n\n`;
      }
    }
  }

  if (dictEntries.length > 0) {
    text += `### Pāḷi Term Analysis (DPD):\n\n`;
    for (const d of dictEntries.slice(0, 3)) {
      text += `- **${d.word}**: ${d.definition}\n`;
    }
    text += `\n`;
  }

  if (passages.length === 0 && sections.length === 0) {
    text += `The database was searched across the Chaṭṭha Saṅgāyana Tipiṭaka. `;
    text += `To unlock full multi-turn conversational AI reasoning, please configure your free **Google Gemini API Key** in AI Settings (⚙️) — available at [Google AI Studio](https://aistudio.google.com/app/apikey).\n\n`;
  }

  text += `---\n*Canonical references link directly to Chaṭṭha Saṅgāyana paragraphs. Add an API key in Settings (⚙️) to enable full natural-language synthesis.*`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASTIFY ROUTES & SSE STREAMING ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

function registerAiRoutes(fastify) {
  fastify.get('/api/ai/tools', async () => {
    return { tools: kAiToolDeclarations };
  });

  fastify.get('/api/ai/search', async (req) => {
    const q = req.query.q || req.query.query || '';
    const limit = parseInt(req.query.limit || '20', 10);
    const cat = req.query.category ? [req.query.category] : [];
    const nik = req.query.nikaya ? [req.query.nikaya] : [];
    return aiSearchTipitaka({ query: q, limit, categories: cat, nikayas: nik });
  });

  fastify.post('/api/ai/search_batch', async (req) => {
    const body = req.body || {};
    return executeAiTool('search_tipitaka_batch', body);
  });

  fastify.get('/api/ai/sections', async (req) => {
    const q = req.query.q || req.query.query || '';
    const limit = parseInt(req.query.limit || '20', 10);
    return aiSearchSections({ query: q, limit });
  });

  fastify.get('/api/ai/section', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = parseInt(req.query.chapter || req.query.chapter_index || '0', 10);
    return aiGetSection({ book_code: book, chapter_index: chap });
  });

  fastify.get('/api/ai/paragraph_content', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = req.query.chapter !== undefined ? parseInt(req.query.chapter, 10) : undefined;
    const start = parseInt(req.query.start || req.query.para_start || '0', 10);
    const end = parseInt(req.query.end || req.query.para_end || String(start), 10);
    const langs = req.query.langs ? req.query.langs.split(',') : ['en', 'vi'];
    return aiGetParagraphContent({ book_code: book, chapter_index: chap, para_start: start, para_end: end, langs });
  });

  fastify.post('/api/ai/paragraph_content_batch', async (req) => {
    const body = req.body || {};
    return executeAiTool('get_paragraph_content_batch', body);
  });

  fastify.get('/api/ai/commentaries', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = parseInt(req.query.chapter || req.query.chapter_index || '0', 10);
    const pnum = req.query.para || req.query.para_num || '';
    return aiGetCommentaries({ book_code: book, chapter_index: chap, para_num: pnum });
  });

  fastify.get('/api/ai/commentary_link', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = parseInt(req.query.chapter || req.query.chapter_index || '0', 10);
    const pnum = req.query.para || req.query.para_num || '';
    return aiGetCommentaries({ book_code: book, chapter_index: chap, para_num: pnum });
  });

  fastify.get('/api/ai/dictionary', async (req) => {
    const w = req.query.w || req.query.word || '';
    return aiGetDictionary({ word: w });
  });

  fastify.post('/api/ai/dictionary_batch', async (req) => {
    const body = req.body || {};
    return executeAiTool('get_dictionary_batch', body);
  });

  fastify.get('/api/ai/books', async () => {
    return aiGetBooks();
  });

  fastify.post('/api/ai/tool-call', async (req) => {
    const { name, args } = req.body || {};
    if (!name) return { success: false, error: 'Missing tool name' };
    return executeAiTool(name, args || {});
  });

  // ── Streaming Chat Endpoint (SSE) ──────────────────────────────────────
  fastify.post('/api/ai/chat', async (req, reply) => {
    const body = req.body || {};
    const {
      messages = [],
      apiKey = process.env.GEMINI_API_KEY || '',
      provider = 'gemini',
      toolModel = 'gemini-2.0-flash',
      answerModel = 'gemini-2.0-flash',
      orthodoxMode = true,
      customSystemPrompt = '',
      baseUrl = '',
    } = body;

    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage?.content || '';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendEvent = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // 1. OFFLINE CANONICAL RAG (when no external API key is provided)
      if (!apiKey || apiKey.trim().length < 5) {
        sendEvent('status', { message: 'Conducting local database search across Tipitaka…' });

        const sectionRes = aiSearchSections({ query: userQuery, limit: 5 });
        sendEvent('tool_call', {
          tool: 'search_sections',
          summary: `Searched section headings for "${userQuery}" (${sectionRes.results.length} matches)`,
        });

        const tipitakaRes = aiSearchTipitaka({ query: userQuery, limit: 8 });
        sendEvent('tool_call', {
          tool: 'search_tipitaka',
          summary: `Searched canonical text for "${userQuery}" (${tipitakaRes.results.length} passages found)`,
        });

        const offlineText = generateOfflineCanonicalAnswer(userQuery, [
          { tool: 'search_sections', result: sectionRes },
          { tool: 'search_tipitaka', result: tipitakaRes },
        ]);

        const chunks = offlineText.split(/(?<=\s)/);
        for (const chunk of chunks) {
          sendEvent('token', { text: chunk });
          await new Promise((r) => setTimeout(r, 12));
        }

        const citations = parseCitations(offlineText);
        sendEvent('citations', { citations });
        sendEvent('done', {
          mode: 'offline_rag',
          note: 'Add Gemini API Key in Settings for generative reasoning',
        });
        reply.raw.end();
        return;
      }

      // 2. AGENTIC TOOL LOOP (with Gemini or OpenAI)
      const toolSystemPrompt = customSystemPrompt.trim() || kAiDefaultToolSystemPrompt;
      const toolLogs = [];
      const collectedData = [];

      sendEvent('status', { message: 'Initiating canonical research…' });

      // PHASE 1: Function Calling Loop
      let toolIterations = 0;
      const maxIterations = 5;
      let toolsDone = false;

      if (provider === 'gemini') {
        const conversationParts = [{ role: 'user', parts: [{ text: userQuery }] }];

        while (!toolsDone && toolIterations < maxIterations) {
          toolIterations++;
          const geminiToolUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey}`;
          const toolPayload = {
            system_instruction: { parts: [{ text: toolSystemPrompt }] },
            contents: conversationParts,
            tools: [{ functionDeclarations: kAiToolDeclarations }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          };

          try {
            const toolRes = await fetch(geminiToolUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toolPayload),
            });

            if (!toolRes.ok) break;
            const resJson = await toolRes.json();
            const candidate = resJson.candidates?.[0];
            const parts = candidate?.content?.parts || [];

            conversationParts.push(candidate.content);

            const callSpecs = [];
            let hasFinalAnswer = false;

            for (const part of parts) {
              if (part.functionCall) {
                const fc = part.functionCall;
                if (fc.name === 'final_answer') {
                  hasFinalAnswer = true;
                } else {
                  callSpecs.push(fc);
                }
              }
            }

            if (callSpecs.length === 0) {
              toolsDone = true;
              break;
            }

            const functionResponses = [];
            for (const spec of callSpecs) {
              sendEvent('status', { message: `Researching: ${spec.name}…` });
              const execRes = await executeAiTool(spec.name, spec.args || {});
              collectedData.push({ tool: spec.name, args: spec.args, result: execRes });

              const summary = spec.args?.query || spec.args?.queries?.[0] || spec.args?.word || spec.args?.book_code || spec.name;
              toolLogs.push({ tool: spec.name, summary: `${spec.name}: ${summary}` });
              sendEvent('tool_call', { tool: spec.name, summary: `Executed ${spec.name} (${summary})` });

              const resultStr = JSON.stringify(execRes).slice(0, 3000);
              functionResponses.push({
                functionResponse: {
                  name: spec.name,
                  response: { content: resultStr },
                },
              });
            }

            conversationParts.push({ role: 'user', parts: functionResponses });
            if (hasFinalAnswer) {
              toolsDone = true;
              break;
            }
          } catch (err) {
            console.warn('[Gemini Tool Loop Error]', err.message);
            break;
          }
        }
      }

      // If tool loop returned no results, run default fallback searches
      if (collectedData.length === 0) {
        const sRes = aiSearchSections({ query: userQuery, limit: 4 });
        if (sRes.results.length > 0) {
          collectedData.push({ tool: 'search_sections', result: sRes });
          toolLogs.push({ tool: 'search_sections', summary: `Found ${sRes.results.length} related suttas/sections` });
          sendEvent('tool_call', { tool: 'search_sections', summary: `Found ${sRes.results.length} related suttas/sections` });
        }
        const tRes = aiSearchTipitaka({ query: userQuery, limit: 8 });
        if (tRes.results.length > 0) {
          collectedData.push({ tool: 'search_tipitaka', result: tRes });
          toolLogs.push({ tool: 'search_tipitaka', summary: `Retrieved ${tRes.results.length} canonical passages` });
          sendEvent('tool_call', { tool: 'search_tipitaka', summary: `Retrieved ${tRes.results.length} canonical passages with citations` });
        }
      }

      // PHASE 2: Synthesis with Answer Model
      sendEvent('status', { message: 'Synthesizing response with canonical citations…' });

      let contextBlock = '';
      for (const item of collectedData) {
        if (item.result?.passages) {
          contextBlock += item.result.passages.map((p, idx) => `[Source ${idx + 1}] ${p.book_title} (${p.book_code}) §${p.para_num || p.para_index}\nCitation: ${p.citation_ref}\nPāḷi: ${p.pali}\n${p.translations?.en ? `English: ${p.translations.en}\n` : ''}`).join('\n\n') + '\n\n';
        } else if (item.result?.results) {
          contextBlock += item.result.results.map((r, idx) => `[Source ${idx + 1}] ${r.book_title} (${r.book_code}) §${r.para_num || r.para_index}\nCitation: ${r.citation_ref}\nText: ${r.text || r.snippet}\n${r.translations?.en ? `English: ${r.translations.en}\n` : ''}`).join('\n\n') + '\n\n';
        }
      }

      const answerSystemPrompt = buildAnswerSystemPrompt({ orthodoxMode });
      const synthesisPrompt = `USER QUESTION:
${userQuery}

CANONICAL EVIDENCE GATHERED FROM TIPITAKA DATABASE:
${contextBlock || 'No direct text matches found; please synthesize strictly according to canonical Theravāda principles.'}

Write a comprehensive, clear, structured answer. Quote Pāḷi verses or phrases accurately and format EVERY citation as [book_code:c{chap}:p{para}].`;

      if (provider === 'gemini') {
        const geminiStreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${answerModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const payload = {
          system_instruction: { parts: [{ text: answerSystemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        };

        const res = await fetch(geminiStreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text();
          sendEvent('error', { message: `Gemini API Error (${res.status}): ${errText.substring(0, 200)}` });
          reply.raw.end();
          return;
        }

        let fullAnswer = '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.substring(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const json = JSON.parse(dataStr);
              const textChunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
              if (textChunk) {
                fullAnswer += textChunk;
                sendEvent('token', { text: textChunk });
              }
            } catch (e) {}
          }
        }

        const citations = parseCitations(fullAnswer);
        sendEvent('citations', { citations });
        sendEvent('done', { toolCalls: toolLogs });
      } else {
        // OpenAI / OpenRouter / Custom
        const endpoint = (baseUrl && baseUrl.trim()) ? `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
        const payload = {
          model: answerModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: answerSystemPrompt },
            { role: 'user', content: synthesisPrompt },
          ],
          temperature: 0.3,
          stream: true,
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text();
          sendEvent('error', { message: `API Error (${res.status}): ${errText.substring(0, 200)}` });
          reply.raw.end();
          return;
        }

        let fullAnswer = '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.substring(6).trim();
            if (dataStr === '[DONE]') break;
            try {
              const json = JSON.parse(dataStr);
              const textChunk = json.choices?.[0]?.delta?.content;
              if (textChunk) {
                fullAnswer += textChunk;
                sendEvent('token', { text: textChunk });
              }
            } catch (e) {}
          }
        }

        const citations = parseCitations(fullAnswer);
        sendEvent('citations', { citations });
        sendEvent('done', { toolCalls: toolLogs });
      }
    } catch (err) {
      console.error('[AI Chat Stream Error]', err);
      sendEvent('error', { message: err.message || 'Stream generation failed' });
    } finally {
      reply.raw.end();
    }
  });
}

module.exports = {
  initAiController,
  registerAiRoutes,
  executeAiTool,
  aiSearchTipitaka,
  aiSearchSections,
  aiGetSection,
  aiGetParagraphContent,
  aiGetCommentaries,
  aiGetDictionary,
  aiGetBooks,
  parseCitations,
  resolveCanonicalBookCode,
};
