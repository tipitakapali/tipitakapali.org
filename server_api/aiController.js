'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dictEngine = require('./dictEngine');
const {
  understandUserQuery,
  heuristicQueryUnderstanding,
  parseCanonicalCitation,
  resolveCanonicalCitation,
} = require('./aiQueryUnderstanding');

// ═══════════════════════════════════════════════════════════════════════════
//  DATABASE CONNECTIONS & BOOK CODE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

let dbTipitaka = null;
let dbFts = null;
let dbSummaries = null;
const translationDbs = new Map();
const translationFtsDbs = new Map();
const bookCodeMap = new Map();

let resolveDbPathFn = null;

function getTranslationDb(lang) {
  if (!lang) return null;
  const cleanLang = String(lang).toLowerCase();
  if (translationDbs.has(cleanLang)) return translationDbs.get(cleanLang);

  const candidates = [
    resolveDbPathFn ? resolveDbPathFn(`translation_${cleanLang}.db`) : null,
    path.resolve(__dirname, `db/translation_${cleanLang}.db`),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      try {
        const tdb = new Database(p, { readonly: true });
        tdb.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
        translationDbs.set(cleanLang, tdb);
        return tdb;
      } catch (e) {}
    }
  }
  return null;
}

function getTranslationFtsDb(lang) {
  if (!lang) return null;
  const cleanLang = String(lang).toLowerCase();
  if (translationFtsDbs.has(cleanLang)) return translationFtsDbs.get(cleanLang);

  const candidates = [
    resolveDbPathFn ? resolveDbPathFn(`fts_translation_${cleanLang}.db`) : null,
    path.resolve(__dirname, `db/fts_translation_${cleanLang}.db`),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      try {
        const fdb = new Database(p, { readonly: true });
        fdb.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
        translationFtsDbs.set(cleanLang, fdb);
        return fdb;
      } catch (e) {}
    }
  }
  return null;
}

function initAiController({ db, dbFts: fts, resolveDbPath }) {
  dbTipitaka = db;
  dbFts = fts;
  resolveDbPathFn = resolveDbPath || ((f) => path.join(__dirname, 'db', f));

  // Load book mapping from epitaka.db or tipitaka.db
  try {
    const epiDbCandidates = [
      resolveDbPathFn('epitaka.db'),
      path.resolve(__dirname, '../ref/epitaka_app/assets/db/epitaka.db'),
    ];
    for (const epiDbPath of epiDbCandidates) {
      if (epiDbPath && fs.existsSync(epiDbPath)) {
        const epiDb = new Database(epiDbPath, { readonly: true });
        const rows = epiDb.prepare("SELECT book_id, vri_id, book_name FROM books WHERE vri_id IS NOT NULL AND vri_id != ''").all();
        for (const r of rows) {
          const vri = String(r.vri_id).trim();
          const bid = String(r.book_id).trim();
          bookCodeMap.set(bid, vri);
          bookCodeMap.set(bid.toLowerCase(), vri);
          bookCodeMap.set(vri, vri);
          bookCodeMap.set(vri.toLowerCase(), vri);
        }
        epiDb.close();
        console.log(`[AI Controller] Loaded ${rows.length} book mappings from ${epiDbPath}`);
        break;
      }
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
    'an1': 's0401m1.mul', 'an2': 's0402m1.mul', 'an3': 's0402m2.mul', 'an4': 's0402m3.mul', 'an5': 's0403m1.mul',
    'an6': 's0403m2.mul', 'an7': 's0403m3.mul', 'an8': 's0404m1.mul', 'an9': 's0404m2.mul', 'an10': 's0404m3.mul', 'an11': 's0404m4.mul',
    'a-i': 's0401m1.mul', 'a-ii': 's0402m1.mul', 'a-iii': 's0402m2.mul', 'a-iv': 's0402m3.mul', 'a-v': 's0403m1.mul',
    'khp': 's0501m.mul', 'dhp': 's0502m.mul', 'ud': 's0503m.mul', 'it': 's0504m.mul', 'snp': 's0505m.mul',
    'vv': 's0506m.mul', 'pv': 's0507m.mul', 'thag': 's0508m.mul', 'thig': 's0509m.mul',
    'ja': 's0513m.mul', 'jat': 's0513m.mul', 'jataka': 's0513m.mul',
    'vin1': 'vin01m.mul', 'vin2': 'vin02m.mul', 'patimokkha': 'vin01m.mul',
    'vibhanga': 'abh02m.mul', 'dhammasangani': 'abh01m.mul', 'dhatukatha': 'abh03m.mul',
    'puggalapannatti': 'abh04m.mul', 'kathavatthu': 'abh05m.mul', 'yamaka': 'abh06m.mul', 'patthana': 'abh07m.mul',
  };
  for (const [k, v] of Object.entries(commonAliases)) {
    bookCodeMap.set(k.toLowerCase(), v);
  }

  // Load summaries.db if available
  const sumCandidates = [
    resolveDbPathFn('summaries.db'),
    path.resolve(__dirname, 'db/summaries.db'),
  ];
  for (const sumPath of sumCandidates) {
    if (sumPath && fs.existsSync(sumPath)) {
      try {
        dbSummaries = new Database(sumPath, { readonly: true });
        dbSummaries.exec('PRAGMA synchronous = NORMAL; PRAGMA query_only = 1;');
        console.log(`[AI Controller] Connected to summaries database: ${sumPath}`);
        break;
      } catch (err) {
        console.warn('[AI Controller] Error connecting to summaries.db:', err.message);
      }
    }
  }

  return {
    getTranslationDb,
    getTranslationFtsDb,
  };
}

function resolveCanonicalBookCode(raw) {
  if (!raw) return '';
  const clean = String(raw).trim();
  const lower = clean.toLowerCase().replace(/[\s_-]+/g, '');
  if (bookCodeMap.has(clean)) return bookCodeMap.get(clean);
  if (bookCodeMap.has(lower)) return bookCodeMap.get(lower);

  // Dīgha Nikāya: dn1-34 or d1-34 (or d-i, d-ii, d-iii)
  const dnMatch = lower.match(/^d(?:n)?(\d+)$/);
  if (dnMatch) {
    const num = parseInt(dnMatch[1], 10);
    if (num <= 13) return 's0101m.mul';
    if (num <= 23) return 's0102m.mul';
    return 's0103m.mul';
  }

  // Majjhima Nikāya: mn1-152 or m1-152 (or m-i, m-ii, m-iii)
  const mnMatch = lower.match(/^m(?:n)?(\d+)$/);
  if (mnMatch) {
    const num = parseInt(mnMatch[1], 10);
    if (num <= 50) return 's0201m.mul';
    if (num <= 100) return 's0202m.mul';
    return 's0203m.mul';
  }

  // Saṃyutta Nikāya: sn1-56 or s1-56 (or sn12.2, s12.2)
  const snMatch = lower.match(/^s(?:n)?(\d+)(?:\.\d+)?$/);
  if (snMatch) {
    const num = parseInt(snMatch[1], 10);
    if (num <= 11) return 's0301m.mul';
    if (num <= 21) return 's0302m.mul';
    if (num <= 34) return 's0303m.mul';
    if (num <= 44) return 's0304m.mul';
    return 's0305m.mul';
  }

  // Aṅguttara Nikāya: an1-11 or a1-11 (or an4.1, a4.1)
  const anMatch = lower.match(/^a(?:n)?(\d+)(?:\.\d+)?$/);
  if (anMatch) {
    const num = parseInt(anMatch[1], 10);
    if (num === 1) return 's0401m1.mul';
    if (num === 2) return 's0402m1.mul';
    if (num === 3) return 's0402m2.mul';
    if (num === 4) return 's0402m3.mul';
    if (num === 5) return 's0403m1.mul';
    if (num === 6) return 's0403m2.mul';
    if (num === 7) return 's0403m3.mul';
    if (num === 8) return 's0404m1.mul';
    if (num === 9) return 's0404m2.mul';
    if (num === 10) return 's0404m3.mul';
    if (num === 11) return 's0404m4.mul';
  }

  // Vinaya: vin1-5
  const vinMatch = lower.match(/^vin(?:aya)?(\d+)?$/);
  if (vinMatch) {
    const num = vinMatch[1] ? parseInt(vinMatch[1], 10) : 1;
    if (num === 1) return 'vin01m.mul';
    if (num === 2) return 'vin02m.mul';
    if (num === 3) return 'vin03m.mul';
    if (num === 4) return 'vin04m.mul';
    if (num === 5) return 'vin05m.mul';
  }

  // Abhidhamma: abh1-7
  const abhMatch = lower.match(/^abh(?:idhamma)?(\d+)?$/);
  if (abhMatch) {
    const num = abhMatch[1] ? parseInt(abhMatch[1], 10) : 1;
    if (num >= 1 && num <= 7) return `abh0${num}m.mul`;
  }

  // Prefix match fallback
  const m = lower.match(/^([a-z]+)(\d+)(?:\.\d+)?$/);
  if (m) {
    const key = `${m[1]}${m[2]}`;
    if (bookCodeMap.has(key)) return bookCodeMap.get(key);
  }

  return clean;
}

function extractSuttaNumberFromCode(raw) {
  if (!raw) return null;
  const m = String(raw).trim().toLowerCase().match(/^[a-z]+(\d+)(?:\.\d+)?$/);
  return m ? parseInt(m[1], 10) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOOL DECLARATIONS FOR LLM FUNCTION CALLING
// ═══════════════════════════════════════════════════════════════════════════

const kAiToolDeclarations = [
  {
    name: 'search_sections',
    description:
      'Search section, sutta, and vagga TITLES (with study summaries) across the whole 217-book canon. ' +
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
      'Search the Tipitaka database for passages using full-text search across Pāḷi Canon and English translations. ' +
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
          description: 'Array of 2 to 4 search queries to execute within target books.',
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
    name: 'get_headings',
    description:
      'Get table of contents and heading hierarchy for a canonical book (e.g. "s0101m.mul", "dn1", "mn1", "dhp"). ' +
      'Use this to browse sutta structures, vaggas, and find exact chapter and paragraph index boundaries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Canonical book code or short alias (e.g. "s0101m.mul", "dn1", "mn1", "dhp").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Optional chapter index to filter headings within a specific chapter.',
        },
      },
      required: ['book_code'],
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
        para_start: {
          type: 'INTEGER',
          description: 'Optional starting paragraph index to locate the specific sub-section.',
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
          description: 'Chapter index (0-based). Optional if para_start or para_num is provided.',
        },
        para_start: {
          type: 'INTEGER',
          description: 'Starting paragraph index (0-based sequential paragraph position).',
        },
        para_end: {
          type: 'INTEGER',
          description: 'Ending paragraph index (inclusive).',
        },
        para_num: {
          type: 'STRING',
          description: 'Canonical paragraph number (e.g. "1", "10", "139"). Use this when referring to canonical paragraph numbers.',
        },
      },
      required: ['book_code'],
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
      'Find related Aṭṭhakathā (commentary) and Ṭīkā (sub-commentary) passages for a given Mūla (root) paragraph, returning their actual Pāḷi text.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Book code of the Mūla text (e.g. "s0101m.mul", "s0201m.mul").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Chapter index in the Mūla text (optional).',
        },
        para_num: {
          type: 'STRING',
          description: 'Paragraph number (e.g. "1", "15", "165").',
        },
        para_index: {
          type: 'INTEGER',
          description: 'Paragraph index (0-based integer, optional).',
        },
      },
      required: ['book_code'],
    },
  },
  {
    name: 'get_dictionary',
    description:
      'Get definitions, grammatical analysis, root family, and meanings for a Pāli term from the Digital Pāli Dictionary (DPD).',
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
    name: 'get_sentences',
    description:
      'Get sentence-level Pāḷi (and aligned translations) with shared line numbers for a paragraph or chapter. ' +
      'Line numbers are shared between Pāḷi and each translation by construction (99.7% per-para count match). ' +
      'Use for fine-grained citation at sentence granularity — every returned sentence has a line_id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        book_code: {
          type: 'STRING',
          description: 'Book code (e.g. "s0101m.mul", "D-i", "s0502m.mul").',
        },
        chapter_index: {
          type: 'INTEGER',
          description: 'Chapter index (0-based).',
        },
        para_index: {
          type: 'INTEGER',
          description: 'Paragraph index (0-based global para_position). Optional: when omitted returns up to 40 sentences in the chapter.',
        },
        line_id: {
          type: 'INTEGER',
          description: 'Optional single sentence number (1-based line_id) to fetch one sentence. Requires para_index.',
        },
      },
      required: ['book_code'],
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

function convertSchemaToOpenAi(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const converted = { ...schema };
  if (converted.type && typeof converted.type === 'string') {
    converted.type = converted.type.toLowerCase();
  }
  if (converted.properties) {
    const props = {};
    for (const [k, v] of Object.entries(converted.properties)) {
      props[k] = convertSchemaToOpenAi(v);
    }
    converted.properties = props;
  }
  if (converted.items) {
    converted.items = convertSchemaToOpenAi(converted.items);
  }
  return converted;
}

function getOpenAiToolDeclarations() {
  return kAiToolDeclarations.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: convertSchemaToOpenAi(t.parameters),
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPTS (DEEPCODER & VIMAMSA MULTI-STEP STRATEGY)
// ═══════════════════════════════════════════════════════════════════════════

const kAiDefaultToolSystemPrompt = `You are Ani (AI Nissaya), the dedicated scholarly AI assistant for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is to systematically investigate the Dhamma through precise canonical research using the local database tools.

## Available Research Tools
1. search_sections(query) — Search sutta and vagga titles across the entire canon. Use this FIRST to identify relevant suttas.
2. get_headings(book_code, chapter_index) — Get table of contents, vagga outlines, and chapter structure for a book.
3. get_section(book_code, chapter_index, para_start) — Read section overview, outline, and study guides.
4. search_by_category(queries, categories, nikayas) — Search within specific Piṭakas ("vinaya", "sutta", "abhidhamma") or Nikāyas ("dn", "mn", "sn", "an", "kn", "dhp", "ja").
5. search_tipitaka_batch(queries) — Run multiple search terms in parallel (synonyms, technical compounds).
6. search_tipitaka(query) — Full-text search across Pāḷi and English translations.
7. get_paragraph_content(book_code, chapter_index, para_start, para_end, para_num) — Read exact Pāḷi text and verified translations.
8. get_paragraph_content_batch(ranges) — Read multiple passages across suttas in parallel.
9. get_commentaries(book_code, chapter_index, para_num, para_index) — Retrieve corresponding Aṭṭhakathā and Ṭīkā explanations and text.
10. get_dictionary(word) / get_dictionary_batch(words) — DPD dictionary definitions, etymology, and grammatical roots.
 11. get_sentences(book_code, chapter_index, para_index, line_id) — Sentence-level Pāḷi and aligned translations with shared line numbers (99.7% match). Use for precise sentence citation: [book:cX:pY-LZ] (e.g. [s0201m.mul:c0:p7-L2]).
 12. get_books() — List of books, nikāyas, and their codes.
 13. final_answer(summary) — Finalize research once you have gathered sufficient canonical evidence.

## Strategic Research Workflow (DeepCoder & Vīmaṃsā Multi-Step Loop)
You have up to 6 iterations. Use them with deep scholarly discipline:

### Phase 0: Disambiguate Concepts & Technical Terms
- If the question involves complex or polysemous terms (e.g. "saṅkhāra", "nāmarūpa", "viññāṇa", "khandha", "kamma"), identify distinct canonical senses:
  * E.g. saṅkhāra: (1) 4th aggregate (saṅkhārakkhandho, SN 22), (2) link in dependent origination (saṅkhārapaccayā viññāṇaṃ, SN 12.2), (3) conditioned things in general (sabbe saṅkhārā aniccā, Dhp 277).
- Identify which Piṭaka or Nikāya contains the primary discourses.

### Phase 1: Canonical Discovery
- Call search_sections first to find specific sutta titles (e.g. "kaccānagotta", "anattalakkhaṇa", "satipaṭṭhāna").
- Use search_by_category or search_tipitaka_batch with Pāḷi stems:
  * Strip final vowels (-a, -ā, -e, -o) from Pāḷi nouns to match all case inflections (e.g. "buddh*", "dhamm*", "mett*", "saṅkhār*", "paṭiccasamuppād*").

### Phase 2: Exact Textual Verification
- Once relevant discourses are located, call get_paragraph_content or get_paragraph_content_batch to read the exact Pāḷi paragraphs and their translations.
- Never rely solely on summaries — always confirm with the actual canonical text.

### Phase 3: Commentarial Depth (Aṭṭhakathā & Ṭīkā)
- When groundRAG Theravāda doctrinal clarification is needed, call get_commentaries on the key Mūla paragraph.
- Examine Buddhaghosa's commentaries and Dhammapāla's sub-commentaries.

### Phase 4: Linguistic Etymology (DPD)
- If key technical terms need precise grammatical breakdown or root analysis, call get_dictionary or get_dictionary_batch.

### Phase 5: Synthesis Trigger
- Once you have sufficient canonical and commentarial evidence directly answering the inquiry, call final_answer(summary).`;

function buildAnswerSystemPrompt({ groundRAGMode = true }) {
  const grounding = groundRAGMode
    ? `## RAG Mode Rules (Strict Grounding)
1. Every factual claim MUST be supported by an inline citation in the exact format: [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{para}-L{line}] for sentence precision (e.g. [s0201m.mul:c0:p7-L2]).
2. Answer the user's question using ONLY the canonical passages, commentaries, and dictionary definitions returned by the research tools.
3. Quote Pāḷi verses or phrases EXACTLY as written in the sources (use Markdown blockquotes); provide clear English translations following each quote. When quoting a single sentence, use get_sentences for exact Pāḷi + translation alignment (shared line_id, 99.7% match).
4. If the retrieved sources do not fully answer the question, state this with complete honesty rather than speculating.
5. Explain technical Pāḷi terms on first mention with etymological clarity.
6. Format paragraph citations as [book_code:c{chapter_index}:p{para_index}] (e.g. [s0101m.mul:c0:p5]); sentence citations as [book_code:c{chapter_index}:p{para_index}-L{line_id}] (e.g. [s0201m.mul:c0:p7-L2]) so users can click them directly to read the original text.`
    : `## Knowledge Mode Rules (Canonical + Contextual Knowledge)
1. Base your answer primarily on the canonical passages retrieved by the tools, with inline citations [book_code:c{chap}:p{para}] or sentence citations [book_code:c{chap}:p{para}-L{line}].
2. You may supplement with your broader knowledge of the Pāḷi Canon, Theravāda Abhidhamma, and historical commentary where sources are partial, but clearly distinguish canonical citations from broader exposition.
3. Quote Pāḷi accurately, with translation following. For sentence-precise quotes use get_sentences (shared line_id).
4. Format citations as [book_code:c{chapter_index}:p{para_index}] (e.g. [s0101m.mul:c0:p5]) and sentence citations as [book:cX:pY-LZ] so users can click them to navigate in the reader.`;

  return `You are Ani (AI Nissaya), the scholarly Pāḷi Canon companion on tipitakapali.org.
You have been supplied with verified passages, commentaries, and dictionary entries from the Chaṭṭha Saṅgāyana Tipiṭaka database.

## Task
Write a comprehensive, insightful, and clearly structured answer to the user's question using rich Markdown (headers, bullet points, blockquotes for Pāḷi verses).

## Citation Format
All canonical citations MUST appear as clickable chips in square brackets:
  [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_start}-{para_end}]
Example:
  > "Dvayanissito khvāyaṃ, kaccāna, loko yebhuyyena..." [s0302m.mul:c0:p103]

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
  'tell', 'me', 'give', 'list', 'show', 'explore', 'between', 'exact'
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

  // 0. High-Priority Direct Canonical Citation Resolution
  const citeMatch = parseCanonicalCitation(trimmed);
  if (citeMatch && dbTipitaka) {
    const resolved = resolveCanonicalCitation(citeMatch.book, citeMatch.num, citeMatch.subNum, dbTipitaka);
    if (resolved && resolved.start_para !== null) {
      const key = `sec:${resolved.book_code}:${resolved.chapter_index}:${resolved.start_para}`;
      seen.add(key);
      results.push({
        type: 'section',
        book_code: resolved.book_code,
        book_title: resolved.book_code,
        title: resolved.sutta_name,
        chapter_index: resolved.chapter_index,
        para_index: resolved.start_para,
        para_num: '',
        level: 1,
        snippet: `Canonical discourse: ${resolved.sutta_name}`,
        citation_ref: `[${resolved.book_code}:c${resolved.chapter_index}:p${resolved.start_para}]`,
      });
    }
  }

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
          `).all(qStr, activeLimit * 2);

          // Prioritize Mūla (.mul) canonical root suttas over commentaries (.att) and grammar texts (e0*)
          tocHits.sort((a, b) => {
            const score = (code) => {
              if (!code) return 0;
              if (code.includes('.mul')) {
                if (code.startsWith('s01') || code.startsWith('s02') || code.startsWith('s03') || code.startsWith('s04') || code.startsWith('s05')) return 4;
                return 3;
              }
              if (code.includes('.att')) return 2;
              if (code.includes('.tik')) return 1;
              return 0;
            };
            return score(b.book_code) - score(a.book_code);
          });

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
                   snippet(summaries_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet
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

function resolveAllowedBooksForCategory({ categories = [], nikayas = [] }) {
  if (!dbTipitaka) return null;
  const cats = (Array.isArray(categories) ? categories : (categories ? [categories] : [])).filter(Boolean).map((c) => String(c).toLowerCase().trim());
  const niks = (Array.isArray(nikayas) ? nikayas : (nikayas ? [nikayas] : [])).filter(Boolean).map((n) => String(n).toLowerCase().trim());

  if (cats.length === 0 && niks.length === 0) return null;

  const catConds = [];
  const catParams = [];
  for (const c of cats) {
    if (c === 'vinaya') {
      catConds.push("(code LIKE 'vin%' OR LOWER(nikaya) LIKE '%vinaya%')");
    } else if (c === 'sutta') {
      catConds.push("(code LIKE 's0%' OR LOWER(nikaya) LIKE '%sutta%' OR LOWER(nikaya) LIKE '%nikāy%')");
    } else if (c === 'abhidhamma') {
      catConds.push("(code LIKE 'abh%' OR LOWER(nikaya) LIKE '%abhidhamma%')");
    } else if (c === 'mula' || c === 'mūla') {
      catConds.push("(category = 'mūla' OR code LIKE '%.mul')");
    } else if (c === 'atthakatha' || c === 'aṭṭhakathā' || c === 'commentary') {
      catConds.push("(category = 'aṭṭhakathā' OR code LIKE '%.att')");
    } else if (c === 'tika' || c === 'ṭīkā' || c === 'subcommentary') {
      catConds.push("(category = 'ṭīkā' OR code LIKE '%.tik')");
    } else {
      catConds.push("(LOWER(category) = ? OR LOWER(nikaya) LIKE ? OR code LIKE ?)");
      catParams.push(c, `%${c}%`, `%${c}%`);
    }
  }

  const nikConds = [];
  const nikParams = [];
  for (const n of niks) {
    if (n === 'dn') {
      nikConds.push("(code LIKE 's01%' OR LOWER(nikaya) LIKE '%dīgha%')");
    } else if (n === 'mn') {
      nikConds.push("(code LIKE 's02%' OR LOWER(nikaya) LIKE '%majjhima%')");
    } else if (n === 'sn') {
      nikConds.push("(code LIKE 's03%' OR LOWER(nikaya) LIKE '%saṃyutta%')");
    } else if (n === 'an') {
      nikConds.push("(code LIKE 's04%' OR LOWER(nikaya) LIKE '%aṅguttara%')");
    } else if (n === 'kn') {
      nikConds.push("(code LIKE 's05%' OR LOWER(nikaya) LIKE '%khuddaka%')");
    } else if (n === 'dhp') {
      nikConds.push("code LIKE 's0502%'");
    } else if (n === 'ja' || n === 'jataka') {
      nikConds.push("(code LIKE 's0513%' OR code LIKE 's0514%')");
    } else if (n === 'ud') {
      nikConds.push("code LIKE 's0503%'");
    } else if (n === 'it') {
      nikConds.push("code LIKE 's0504%'");
    } else if (n === 'snp') {
      nikConds.push("code LIKE 's0505%'");
    } else if (n === 'thag') {
      nikConds.push("code LIKE 's0508%'");
    } else if (n === 'thig') {
      nikConds.push("code LIKE 's0509%'");
    } else {
      nikConds.push("(LOWER(nikaya) LIKE ? OR LOWER(code) LIKE ? OR LOWER(title) LIKE ?)");
      nikParams.push(`%${n}%`, `%${n}%`, `%${n}%`);
    }
  }

  const overallConds = [];
  const overallParams = [];
  if (catConds.length > 0) {
    overallConds.push(`(${catConds.join(' OR ')})`);
    overallParams.push(...catParams);
  }
  if (nikConds.length > 0) {
    overallConds.push(`(${nikConds.join(' OR ')})`);
    overallParams.push(...nikParams);
  }

  if (overallConds.length === 0) return null;

  try {
    const q = `SELECT code FROM books WHERE ${overallConds.join(' AND ')}`;
    const rows = dbTipitaka.prepare(q).all(...overallParams);
    return new Set(rows.map((r) => r.code));
  } catch (e) {
    console.warn('[AI Category Resolver] Error:', e.message);
    return null;
  }
}

function aiSearchTipitaka({ query, limit = 20, categories = [], nikayas = [] }) {
  if (!dbFts && !dbTipitaka) return { success: false, results: [], error: 'Database unavailable' };
  const ftsQ = formatFtsQuery(query);
  if (!ftsQ) return { success: true, count: 0, results: [] };

  const activeLimit = Math.min(Math.max(1, limit), 50);
  const results = [];
  const seenKeys = new Set();

  const allowedBooks = resolveAllowedBooksForCategory({ categories, nikayas });

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

  // 2. Search English translation FTS if available
  if (results.length < activeLimit) {
    try {
      const enDb = getTranslationFtsDb('en');
      if (enDb) {
        const enHits = enDb.prepare(`
          SELECT book_code, book_title, nikaya, para_num, para_index,
                 snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet,
                 content
          FROM paragraphs_fts
          WHERE paragraphs_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsQ, activeLimit);

        for (const h of enHits) {
          if (allowedBooks && !allowedBooks.has(h.book_code)) continue;
          const key = `${h.book_code}:${h.para_index}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          let chapIdx = 0;
          let chapTitle = '';
          let suttaTitle = '';
          try {
            const cRow = dbTipitaka.prepare('SELECT chapter_index, chapter_title, sutta_title FROM canon_paragraphs WHERE book_code = ? AND para_index = ?').get(h.book_code, h.para_index);
            if (cRow) {
              chapIdx = cRow.chapter_index;
              chapTitle = cRow.chapter_title || '';
              suttaTitle = cRow.sutta_title || '';
            }
          } catch (e) {}

          results.push({
            book_code: h.book_code,
            book_title: h.book_title,
            nikaya: h.nikaya,
            chapter_index: chapIdx,
            chapter_title: chapTitle,
            sutta_title: suttaTitle,
            para_index: h.para_index,
            para_num: h.para_num,
            snippet: h.snippet,
            text: h.content ? h.content.substring(0, 350) : '',
            citation_ref: `[${h.book_code}:c${chapIdx}:p${h.para_index}]`,
            source_type: 'translation_en',
          });
          if (results.length >= activeLimit) break;
        }
      }
    } catch (e) {}
  }

  // 3. Search Vietnamese translation FTS if available
  if (results.length < activeLimit) {
    try {
      const viDb = getTranslationFtsDb('vi');
      if (viDb) {
        const viHits = viDb.prepare(`
          SELECT book_code, book_title, nikaya, para_num, para_index,
                 snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet,
                 content
          FROM paragraphs_fts
          WHERE paragraphs_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsQ, activeLimit);

        for (const h of viHits) {
          if (allowedBooks && !allowedBooks.has(h.book_code)) continue;
          const key = `${h.book_code}:${h.para_index}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          let chapIdx = 0;
          let chapTitle = '';
          let suttaTitle = '';
          try {
            const cRow = dbTipitaka.prepare('SELECT chapter_index, chapter_title, sutta_title FROM canon_paragraphs WHERE book_code = ? AND para_index = ?').get(h.book_code, h.para_index);
            if (cRow) {
              chapIdx = cRow.chapter_index;
              chapTitle = cRow.chapter_title || '';
              suttaTitle = cRow.sutta_title || '';
            }
          } catch (e) {}

          results.push({
            book_code: h.book_code,
            book_title: h.book_title,
            nikaya: h.nikaya,
            chapter_index: chapIdx,
            chapter_title: chapTitle,
            sutta_title: suttaTitle,
            para_index: h.para_index,
            para_num: h.para_num,
            snippet: h.snippet,
            text: h.content ? h.content.substring(0, 350) : '',
            citation_ref: `[${h.book_code}:c${chapIdx}:p${h.para_index}]`,
            source_type: 'translation_vi',
          });
          if (results.length >= activeLimit) break;
        }
      }
    } catch (e) {}
  }

  return { success: true, count: results.length, results };
}

function aiGetHeadings({ book_code, chapter_index }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);
  if (!targetCode) return { success: false, error: 'Missing book_code' };

  try {
    const bookInfo = dbTipitaka.prepare('SELECT code, title, nikaya, category FROM books WHERE code = ?').get(targetCode);
    let rows;
    if (chapter_index !== undefined && chapter_index !== null) {
      rows = dbTipitaka.prepare(`
        SELECT chapter_index, item_index, title, level, type, para_index, para_num
        FROM book_toc
        WHERE book_code = ? AND chapter_index = ?
        ORDER BY item_index ASC
        LIMIT 60
      `).all(targetCode, chapter_index);
    } else {
      rows = dbTipitaka.prepare(`
        SELECT chapter_index, item_index, title, level, type, para_index, para_num
        FROM book_toc
        WHERE book_code = ?
        ORDER BY item_index ASC
        LIMIT 60
      `).all(targetCode);
    }

    return {
      success: true,
      book_code: targetCode,
      book_title: bookInfo?.title || targetCode,
      headings: rows.map((r) => ({
        chapter_index: r.chapter_index,
        title: r.title,
        level: r.level,
        type: r.type,
        para_index: r.para_index,
        para_num: r.para_num || '',
        citation_ref: `[${targetCode}:c${r.chapter_index}:p${r.para_index}]`,
      })),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetSection({ book_code, chapter_index, para_start }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);

  try {
    let resolvedChap = chapter_index !== undefined && chapter_index !== null ? parseInt(chapter_index, 10) : null;
    if (resolvedChap === null && para_start !== undefined && para_start !== null) {
      const pRow = dbTipitaka.prepare('SELECT chapter_index FROM canon_paragraphs WHERE book_code = ? AND (para_index = ? OR para_num = ?) LIMIT 1').get(targetCode, para_start, String(para_start));
      if (pRow) resolvedChap = pRow.chapter_index;
    }
    if (resolvedChap === null) resolvedChap = 0;

    const chap = dbTipitaka.prepare('SELECT title, anchor_id, para_index FROM chapters WHERE book_code = ? AND chapter_index = ?').get(targetCode, resolvedChap);
    const book = dbTipitaka.prepare('SELECT title, nikaya, category FROM books WHERE code = ?').get(targetCode);
    const tocItems = dbTipitaka.prepare('SELECT title, level, type, para_index, para_num FROM book_toc WHERE book_code = ? AND chapter_index = ? ORDER BY item_index ASC LIMIT 30').all(targetCode, resolvedChap);

    let summaryContent = null;
    if (dbSummaries) {
      try {
        let sumRow = null;
        if (para_start !== undefined && para_start !== null) {
          sumRow = dbSummaries.prepare('SELECT title, content, sources FROM summaries WHERE book_code = ? AND chapter_index = ? AND ? BETWEEN para_start AND para_end LIMIT 1').get(targetCode, resolvedChap, para_start);
        }
        if (!sumRow) {
          sumRow = dbSummaries.prepare('SELECT title, content, sources FROM summaries WHERE book_code = ? AND chapter_index = ? LIMIT 1').get(targetCode, resolvedChap);
        }
        if (sumRow) summaryContent = sumRow;
      } catch (e) {}
    }

    return {
      success: true,
      book_code: targetCode,
      book_title: book ? book.title : targetCode,
      chapter_index: resolvedChap,
      chapter_title: chap ? chap.title : '',
      para_start_index: chap ? chap.para_index : 0,
      headings: tocItems,
      summary: summaryContent,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetSentences({ book_code, chapter_index, para_index, line_id, langs = ['en'] }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);
  const cIdx = chapter_index !== undefined && chapter_index !== null ? parseInt(chapter_index, 10) : 0;
  const pIdx = para_index !== undefined && para_index !== null ? parseInt(para_index, 10) : null;
  const lid = line_id !== undefined && line_id !== null ? parseInt(line_id, 10) : null;
  const tLangs = Array.isArray(langs) ? langs : String(langs).split(',').map((s) => s.trim()).filter(Boolean);
  const paliDbPath = (resolveDbPathFn || ((f) => path.join(__dirname, 'db', f)))('pali_sentences.db');
  let paliSents = [];
  if (paliDbPath) {
    try {
      const pdb = new (require('better-sqlite3'))(paliDbPath, { readonly: true });
      if (pIdx !== null && lid !== null) {
        paliSents = pdb.prepare('SELECT line_id, sentence FROM pali_sentences WHERE book_code = ? AND chapter_index = ? AND para_index = ? AND line_id = ? ORDER BY line_id').all(targetCode, cIdx, pIdx, lid);
      } else if (pIdx !== null) {
        paliSents = pdb.prepare('SELECT line_id, sentence FROM pali_sentences WHERE book_code = ? AND chapter_index = ? AND para_index = ? ORDER BY line_id').all(targetCode, cIdx, pIdx);
      } else {
        paliSents = pdb.prepare('SELECT line_id, sentence, para_index FROM pali_sentences WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id LIMIT 40').all(targetCode, cIdx);
      }
      pdb.close();
    } catch {}
  }
  // Fallback: derive sentences from paragraph_translations when pali DB missing for a para.
  if (paliSents.length === 0 && pIdx !== null) {
    try {
      const row = dbTipitaka.prepare('SELECT pali_text FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(targetCode, cIdx, pIdx);
      if (row && row.pali_text) paliSents = [{ line_id: 1, sentence: row.pali_text, para_index: pIdx }];
    } catch {}
  }
  const translations = {};
  for (const lang of tLangs) {
    const tdb = getTranslationDb(lang);
    if (!tdb) continue;
    try {
      if (pIdx !== null && lid !== null) {
        const r = tdb.prepare('SELECT translation FROM sentence_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ? AND line_id = ?').get(targetCode, cIdx, pIdx, lid);
        translations[lang] = r ? [{ line_id: lid, translation: r.translation }] : [];
      } else if (pIdx !== null) {
        const rows = tdb.prepare('SELECT line_id, translation FROM sentence_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ? ORDER BY line_id').all(targetCode, cIdx, pIdx);
        translations[lang] = rows;
      } else {
        const rows = tdb.prepare('SELECT para_index, line_id, translation FROM sentence_translations WHERE book_code = ? AND chapter_index = ? ORDER BY para_index, line_id LIMIT 80').all(targetCode, cIdx);
        translations[lang] = rows;
      }
    } catch {}
  }
  return {
    success: true,
    book_code: targetCode,
    chapter_index: cIdx,
    para_index: pIdx,
    count: paliSents.length,
    pali_sentences: paliSents,
    translations,
  };
}

function aiGetParagraphContent({
  book_code,
  chapter_index,
  para_start,
  para_end,
  para_num,
  para_index,
  sutta_name,
  langs = ['en', 'vi'],
}) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  let targetCode = resolveCanonicalBookCode(book_code);
  const pNum = para_num !== undefined && para_num !== null ? String(para_num).replace(/^(?:para-?|p)/i, '').trim() : null;
  let pIdx = para_index !== undefined && para_index !== null
    ? parseInt(para_index, 10)
    : (para_start !== undefined && !pNum ? parseInt(para_start, 10) : null);

  // Check citation resolution from sutta_name or book_code (e.g. MN 118, DN 16, SN 56.11)
  const citeCheck = parseCanonicalCitation(sutta_name || book_code);
  if (citeCheck && dbTipitaka) {
    const resolved = resolveCanonicalCitation(citeCheck.book, citeCheck.num, citeCheck.subNum, dbTipitaka);
    if (resolved && resolved.start_para !== null) {
      if (!targetCode || targetCode === book_code) targetCode = resolved.book_code;
      if (chapter_index === undefined || chapter_index === null) chapter_index = resolved.chapter_index;
      if (pIdx === null || pIdx <= 1) pIdx = resolved.start_para;
      if (para_end === undefined || para_end === null) para_end = resolved.end_para || (pIdx + 4);
    }
  }

  // If para_start is missing or is 1, but a sutta name or sutta code was specified (like mn18):
  const rawLower = String(book_code || '').toLowerCase();
  if ((pIdx === null || pIdx <= 1) && !pNum) {
    if (sutta_name) {
      try {
        const sRow = dbTipitaka.prepare('SELECT para_index, chapter_index FROM canon_paragraphs WHERE book_code = ? AND sutta_title LIKE ? LIMIT 1').get(targetCode, `%${sutta_name}%`);
        if (sRow) {
          pIdx = sRow.para_index;
          if (chapter_index === undefined || chapter_index === null) chapter_index = sRow.chapter_index;
        }
      } catch (e) {}
    } else if (rawLower.includes('mn18') || rawLower.includes('madhupindika') || rawLower.includes('madhupiṇḍika')) {
      pIdx = 669;
      if (chapter_index === undefined || chapter_index === null) chapter_index = 1;
    }
  }

  // Default activeEnd: if para_end is not provided, fetch 5 paragraphs (pIdx to pIdx + 4) for rich context
  const endIdx = para_end !== undefined && para_end !== null
    ? parseInt(para_end, 10)
    : (pIdx !== null ? pIdx + 4 : null);

  try {
    let pRows = [];

    // Priority 1: Query by canonical para_num if provided
    if (pNum) {
      if (chapter_index !== undefined && chapter_index !== null) {
        pRows = dbTipitaka.prepare(`
          SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
                 para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_num = ?
          ORDER BY para_index
        `).all(targetCode, chapter_index, pNum);
      }
      if (pRows.length === 0) {
        pRows = dbTipitaka.prepare(`
          SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
                 para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND para_num = ?
          ORDER BY para_index
        `).all(targetCode, pNum);
      }
    }

    // Priority 2: Query by sequential para_index range
    if (pRows.length === 0 && pIdx !== null && !isNaN(pIdx)) {
      const activeEnd = endIdx !== null && !isNaN(endIdx) ? endIdx : pIdx;
      if (chapter_index !== undefined && chapter_index !== null) {
        pRows = dbTipitaka.prepare(`
          SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
                 para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ?
          ORDER BY para_index
        `).all(targetCode, chapter_index, pIdx, activeEnd);
      }
      if (pRows.length === 0) {
        pRows = dbTipitaka.prepare(`
          SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
                 para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND para_index BETWEEN ? AND ?
          ORDER BY para_index
        `).all(targetCode, pIdx, activeEnd);
      }
    }

    // Priority 3: Fallback check if pIdx might have been intended as para_num
    if (pRows.length === 0 && pIdx !== null && !isNaN(pIdx)) {
      pRows = dbTipitaka.prepare(`
        SELECT global_id, guid, book_code, chapter_index, chapter_title, sutta_title,
               para_index, para_num, pali_text
        FROM canon_paragraphs
        WHERE book_code = ? AND para_num = ?
        ORDER BY para_index
      `).all(targetCode, String(pIdx));
    }

    const passages = [];
    const bookInfo = dbTipitaka.prepare('SELECT title FROM books WHERE code = ?').get(targetCode);

    for (const p of pRows) {
      const translations = {};
      for (const lang of langs) {
        const tdb = getTranslationDb(lang);
        if (tdb) {
          try {
            const tRow = tdb.prepare('SELECT translation FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(p.book_code, p.chapter_index, p.para_index);
            if (tRow && tRow.translation) {
              translations[lang] = tRow.translation;
            }
          } catch (e) {}
        }
      }

      passages.push({
        guid: p.guid,
        book_code: p.book_code,
        book_title: bookInfo?.title || p.book_code,
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

function aiGetCommentaries({ book_code, chapter_index, para_num, para_index }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);
  const pNumStr = para_num !== undefined && para_num !== null ? String(para_num).replace(/^(?:para-?|p)/i, '').trim() : '';
  const pIdx = para_index !== undefined && para_index !== null ? parseInt(para_index, 10) : -1;

  try {
    // 1. Locate canonical root row
    let canonRow = null;

    // Priority 1A: Query by para_num if provided
    if (pNumStr) {
      if (chapter_index !== undefined && chapter_index !== null) {
        canonRow = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num,
                 attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_num = ?
          LIMIT 1
        `).get(targetCode, chapter_index, pNumStr);
      }
      if (!canonRow) {
        canonRow = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num,
                 attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND para_num = ?
          LIMIT 1
        `).get(targetCode, pNumStr);
      }
    }

    // Priority 1B: Query by para_index if provided
    if (!canonRow && pIdx >= 0) {
      if (chapter_index !== undefined && chapter_index !== null) {
        canonRow = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num,
                 attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_index = ?
          LIMIT 1
        `).get(targetCode, chapter_index, pIdx);
      }
      if (!canonRow) {
        canonRow = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num,
                 attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND para_index = ?
          LIMIT 1
        `).get(targetCode, pIdx);
      }
    }

    // Priority 1C: Query by chapter_index
    if (!canonRow && chapter_index !== undefined && chapter_index !== null) {
      canonRow = dbTipitaka.prepare(`
        SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num,
               attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para, pali_text
        FROM canon_paragraphs
        WHERE book_code = ? AND chapter_index = ? AND para_num IS NOT NULL
        LIMIT 1
      `).get(targetCode, chapter_index);
    }

    // 2. Check mat_para_map as secondary source
    let matRow = null;
    if (pNumStr) {
      matRow = dbTipitaka.prepare(`
        SELECT source_book, source_chapter, source_para,
               mula_book, mula_chapter, mula_para, mula_title,
               attha_book, attha_chapter, attha_para, attha_title,
               tika_book, tika_chapter, tika_para, tika_title
        FROM mat_para_map
        WHERE (source_book = ? OR mula_book = ?) AND (source_para = ? OR mula_para = ?)
        LIMIT 1
      `).get(targetCode, targetCode, pNumStr, pNumStr);
    }

    const atthaBook = canonRow?.attha_book || matRow?.attha_book;
    const atthaChap = canonRow?.attha_chapter ?? matRow?.attha_chapter ?? null;
    const atthaPara = canonRow?.attha_para || matRow?.attha_para || pNumStr;

    const tikaBook = canonRow?.tika_book || matRow?.tika_book;
    const tikaChap = canonRow?.tika_chapter ?? matRow?.tika_chapter ?? null;
    const tikaPara = canonRow?.tika_para || matRow?.tika_para || pNumStr;

    // Fetch Atthakatha commentary text
    let atthaEntries = [];
    if (atthaBook) {
      const atthaBookInfo = dbTipitaka.prepare('SELECT title FROM books WHERE code = ?').get(atthaBook);
      let rows = [];

      // Try 1: Match by paragraph number in commentary
      if (atthaPara) {
        if (atthaChap !== null && atthaChap !== undefined) {
          rows = dbTipitaka.prepare(`
            SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
            FROM canon_paragraphs
            WHERE book_code = ? AND chapter_index = ? AND para_num = ?
            ORDER BY para_index
            LIMIT 3
          `).all(atthaBook, atthaChap, String(atthaPara));
        }
        if (rows.length === 0) {
          rows = dbTipitaka.prepare(`
            SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
            FROM canon_paragraphs
            WHERE book_code = ? AND para_num = ?
            ORDER BY para_index
            LIMIT 3
          `).all(atthaBook, String(atthaPara));
        }
      }

      // Try 2: Relative chapter / paragraph index range
      if (rows.length === 0 && atthaChap !== null && atthaChap !== undefined) {
        const targetParaIdx = canonRow?.para_index ?? pIdx;
        rows = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_num IS NOT NULL AND para_index >= ?
          ORDER BY para_index
          LIMIT 3
        `).all(atthaBook, atthaChap, Math.max(0, targetParaIdx));
      }

      // Filter out non-commentary book title lines if any
      rows = rows.filter((r) => r.pali_text && !r.pali_text.startsWith('Namo tassa') && !r.pali_text.endsWith('nikāye') && !r.pali_text.endsWith('nikāyo'));

      if (rows.length > 0) {
        atthaEntries = rows.map((r) => ({
          book_code: r.book_code,
          book_title: atthaBookInfo?.title || r.book_code,
          chapter_index: r.chapter_index,
          chapter_title: r.chapter_title,
          para_index: r.para_index,
          para_num: r.para_num,
          pali_text: r.pali_text ? r.pali_text.substring(0, 600) : '',
          citation_ref: `[${r.book_code}:c${r.chapter_index}:p${r.para_index}]`,
        }));
      }
    }

    // Fetch Tika sub-commentary text
    let tikaEntries = [];
    if (tikaBook) {
      const tikaBookInfo = dbTipitaka.prepare('SELECT title FROM books WHERE code = ?').get(tikaBook);
      let rows = [];

      if (tikaPara) {
        if (tikaChap !== null && tikaChap !== undefined) {
          rows = dbTipitaka.prepare(`
            SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
            FROM canon_paragraphs
            WHERE book_code = ? AND chapter_index = ? AND para_num = ?
            ORDER BY para_index
            LIMIT 3
          `).all(tikaBook, tikaChap, String(tikaPara));
        }
        if (rows.length === 0) {
          rows = dbTipitaka.prepare(`
            SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
            FROM canon_paragraphs
            WHERE book_code = ? AND para_num = ?
            ORDER BY para_index
            LIMIT 3
          `).all(tikaBook, String(tikaPara));
        }
      }

      if (rows.length === 0 && tikaChap !== null && tikaChap !== undefined) {
        const targetParaIdx = canonRow?.para_index ?? pIdx;
        rows = dbTipitaka.prepare(`
          SELECT book_code, chapter_index, chapter_title, sutta_title, para_index, para_num, pali_text
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND para_num IS NOT NULL AND para_index >= ?
          ORDER BY para_index
          LIMIT 3
        `).all(tikaBook, tikaChap, Math.max(0, targetParaIdx));
      }

      rows = rows.filter((r) => r.pali_text && !r.pali_text.startsWith('Namo tassa') && !r.pali_text.endsWith('nikāye') && !r.pali_text.endsWith('nikāyo'));

      if (rows.length > 0) {
        tikaEntries = rows.map((r) => ({
          book_code: r.book_code,
          book_title: tikaBookInfo?.title || r.book_code,
          chapter_index: r.chapter_index,
          chapter_title: r.chapter_title,
          para_index: r.para_index,
          para_num: r.para_num,
          pali_text: r.pali_text ? r.pali_text.substring(0, 600) : '',
          citation_ref: `[${r.book_code}:c${r.chapter_index}:p${r.para_index}]`,
        }));
      }
    }

    return {
      success: true,
      source: {
        book_code: targetCode,
        chapter_index: canonRow?.chapter_index ?? chapter_index ?? 0,
        para_index: canonRow?.para_index ?? pIdx,
        para_num: canonRow?.para_num ?? pNumStr,
        sutta_title: canonRow?.sutta_title,
      },
      atthakatha: atthaEntries.length > 0 ? atthaEntries : null,
      tika: tikaEntries.length > 0 ? tikaEntries : null,
      attha_book: atthaBook || null,
      tika_book: tikaBook || null,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function cleanDpdDefinition(item) {
  if (!item || !item.html) return '';
  let h = item.html;
  // Remove interactive UI button boxes, audio players, svg icons, and feedback forms
  h = h.replace(/<div class="?button-box"?[\s\S]*?<\/div>/gi, ' ');
  h = h.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  h = h.replace(/<div class="?content"?[\s\S]*?<\/div>/gi, ' ');
  let text = h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip GoldenDict submission links
  text = text.replace(/Did you spot a mistake\?.*$/i, '').replace(/Can you think of a better example\?.*$/i, '').trim();
  if (text.length > 450) {
    const cut = text.substring(0, 450);
    const lastSpace = cut.lastIndexOf(' ');
    text = (lastSpace > 350 ? cut.substring(0, lastSpace) : cut) + '…';
  }
  return text;
}

function aiGetDictionary({ word }) {
  if (!word || typeof word !== 'string') return { success: false, error: 'Empty word' };
  try {
    const dpdResult = dictEngine.lookupDPDFast(word.trim(), false);
    const cleanEntries = [];
    if (dpdResult && Array.isArray(dpdResult.dpd)) {
      for (const item of dpdResult.dpd.slice(0, 4)) {
        const cleanDef = cleanDpdDefinition(item);
        if (cleanDef) {
          cleanEntries.push({
            word: item.word,
            isExact: Boolean(item.isExact),
            definition: cleanDef,
          });
        }
      }
    }
    return { success: true, word: word.trim(), count: cleanEntries.length, entries: cleanEntries };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function aiGetDictionaryBatch({ words = [] }) {
  const list = (Array.isArray(words) ? words : [words]).filter(Boolean);
  const flattened = [];
  for (const w of list.slice(0, 6)) {
    const res = aiGetDictionary({ word: w });
    if (res.success && Array.isArray(res.entries)) {
      for (const e of res.entries) {
        flattened.push(e);
      }
    }
  }
  return { success: true, count: flattened.length, entries: flattened };
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
      const queries = Array.isArray(args.queries) ? args.queries : (args.query ? [args.query] : []);
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
      const categories = Array.isArray(args.categories) ? args.categories : (args.category ? [args.category] : []);
      const nikayas = Array.isArray(args.nikayas) ? args.nikayas : (args.nikaya ? [args.nikaya] : []);
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
    case 'get_headings':
      return aiGetHeadings({ book_code: args.book_code || args.book_id, chapter_index: args.chapter_index });
    case 'get_section':
      return aiGetSection({ book_code: args.book_code, chapter_index: args.chapter_index, para_start: args.para_start });
    case 'get_paragraph_content': {
      const pNum = args.para_num ?? args.para_number;
      const pStart = args.para_start ?? args.para_index;
      return aiGetParagraphContent({
        book_code: args.book_code,
        chapter_index: args.chapter_index,
        para_start: pStart,
        para_end: args.para_end,
        para_num: pNum,
        para_index: args.para_index,
      });
    }
    case 'get_paragraph_content_batch': {
      const ranges = Array.isArray(args.ranges) ? args.ranges : [];
      const allPassages = [];
      for (const r of ranges.slice(0, 6)) {
        const pNum = r.para_num ?? r.para_number;
        const pStart = r.para_start ?? r.para_index;
        const res = aiGetParagraphContent({
          book_code: r.book_code,
          chapter_index: r.chapter_index,
          para_start: pStart,
          para_end: r.para_end,
          para_num: pNum,
          para_index: r.para_index,
        });
        if (res.success && Array.isArray(res.passages)) {
          allPassages.push(...res.passages);
        }
      }
      return { success: true, count: allPassages.length, passages: allPassages };
    }
    case 'get_sentences':
      return aiGetSentences({
        book_code: args.book_code,
        chapter_index: args.chapter_index,
        para_index: args.para_index,
        line_id: args.line_id,
        langs: args.langs,
      });
    case 'get_commentaries': {
      const pNum = args.para_num ?? args.para_number ?? (args.para_index !== undefined ? String(args.para_index) : undefined);
      return aiGetCommentaries({
        book_code: args.book_code,
        chapter_index: args.chapter_index,
        para_num: pNum,
        para_index: args.para_index,
      });
    }
    case 'get_dictionary':
      return aiGetDictionary({ word: args.word });
    case 'get_dictionary_batch': {
      const words = Array.isArray(args.words)
        ? args.words
        : Array.isArray(args.terms)
        ? args.terms
        : [];
      return aiGetDictionaryBatch({ words });
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
//  CANONICAL CITATION PRIORITY & SORTING
//  Priority: Mūla > Aṭṭhakathā > Ṭīkā > Añña
//  In each group: Sutta > Vinaya > Abhidhamma > Others
// ═══════════════════════════════════════════════════════════════════════════

function getCitationGroupPriority(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const category = (citation.category || '').toLowerCase();

  // 0: Mūla (mūla, .mul)
  if (category.includes('mūla') || category.includes('mula') || code.endsWith('.mul') || code.includes('m.mul')) {
    return 0;
  }
  // 1: Aṭṭhakathā (aṭṭhakathā, .att)
  if (category.includes('aṭṭha') || category.includes('attha') || code.endsWith('.att') || code.includes('a.att')) {
    return 1;
  }
  // 2: Ṭīkā (ṭīkā, .tik)
  if (category.includes('ṭīkā') || category.includes('tika') || code.endsWith('.tik') || code.includes('t.tik')) {
    return 2;
  }
  // 3: Añña (.nrf, others)
  return 3;
}

function getCitationPitakaPriority(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const nikaya = (citation.nikaya || '').toLowerCase();

  // 0: Suttantapiṭaka (Dīgha, Majjhima, Saṃyutta, Aṅguttara, Khuddaka)
  if (code.startsWith('s') || nikaya.includes('nikāy') || nikaya.includes('nikay') || nikaya.includes('sutt')) {
    return 0;
  }
  // 1: Vinayapiṭaka
  if (code.startsWith('vin') || nikaya.includes('vinay')) {
    return 1;
  }
  // 2: Abhidhammapiṭaka
  if (code.startsWith('abh') || nikaya.includes('abhidhamm')) {
    return 2;
  }
  // 3: Others (Visuddhimagga, grammatical treatises, non-piṭaka)
  return 3;
}

function getSuttaNikayaOrder(citation) {
  const code = (citation.bookCode || citation.rawBook || '').toLowerCase();
  const nikaya = (citation.nikaya || '').toLowerCase();

  if (code.startsWith('s01') || nikaya.includes('dīgha') || nikaya.includes('digha')) return 0;
  if (code.startsWith('s02') || nikaya.includes('majjhima')) return 1;
  if (code.startsWith('s03') || nikaya.includes('saṃyutta') || nikaya.includes('samyutta')) return 2;
  if (code.startsWith('s04') || nikaya.includes('aṅguttara') || nikaya.includes('anguttara')) return 3;
  if (code.startsWith('s05') || nikaya.includes('khuddaka')) return 4;
  return 5;
}

function compareCitations(a, b) {
  // 1. Group Priority: Mūla (0) > Aṭṭhakathā (1) > Ṭīkā (2) > Añña (3)
  const gA = getCitationGroupPriority(a);
  const gB = getCitationGroupPriority(b);
  if (gA !== gB) return gA - gB;

  // 2. Piṭaka Priority: Sutta (0) > Vinaya (1) > Abhidhamma (2) > Others (3)
  const pA = getCitationPitakaPriority(a);
  const pB = getCitationPitakaPriority(b);
  if (pA !== pB) return pA - pB;

  // 3. Within Sutta, canonical Nikāya order: DN (0) > MN (1) > SN (2) > AN (3) > KN (4)
  if (pA === 0 && pB === 0) {
    const sA = getSuttaNikayaOrder(a);
    const sB = getSuttaNikayaOrder(b);
    if (sA !== sB) return sA - sB;
  }

  // 4. Sequential Book code order
  const codeA = (a.bookCode || '').toLowerCase();
  const codeB = (b.bookCode || '').toLowerCase();
  if (codeA !== codeB) {
    const codeCmp = codeA.localeCompare(codeB, undefined, { numeric: true });
    if (codeCmp !== 0) return codeCmp;
  }

  // 5. Chapter Index ascending
  const chapA = a.chapterIndex ?? 0;
  const chapB = b.chapterIndex ?? 0;
  if (chapA !== chapB) return chapA - chapB;

  // 6. Paragraph Index / Number ascending
  const paraA = a.paraIndex ?? 0;
  const paraB = b.paraIndex ?? 0;
  return paraA - paraB;
}

function parseCitations(text) {
  if (!text) return [];
  // Supports [book:c{chap}:p{para}], [book:c{chap}:p{start}-{end}], [book:{para}], [book:c{chap}:p{para}:L{line}] and [book:c{chap}:p{para}-L{line}]
  const regex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–]L?(\d+))?(?::L?(\d+))?\]/g;
  const seen = new Set();
  const citations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[0];
    const rawBook = match[1];
    const bookCode = resolveCanonicalBookCode(rawBook);
    const hasExplicitChap = match[2] !== undefined;
    let chapIdx = hasExplicitChap ? parseInt(match[2], 10) : 0;
    let paraIdx = parseInt(match[3], 10);
    let paraEnd = match[4] ? parseInt(match[4], 10) : null;
    let lineId = match[5] ? parseInt(match[5], 10) : null;
    // Sentence-level citation [book:cX:pY-LZ] uses dash-L; promote to lineId
    if (/-L\d+/i.test(rawTag) && !lineId && paraEnd !== null) {
      lineId = paraEnd;
      paraEnd = null;
    }

    let bookTitle = rawBook;
    let chapterTitle = '';
    let resolvedParaNum = '';
    let category = '';
    let nikaya = '';

    if (dbTipitaka) {
      try {
        let row = null;
        if (hasExplicitChap) {
          row = dbTipitaka.prepare(`
            SELECT p.chapter_index, b.title AS book_title, b.category, b.nikaya, p.chapter_title, p.sutta_title, p.para_index, p.para_num
            FROM canon_paragraphs p
            LEFT JOIN books b ON b.code = p.book_code
            WHERE p.book_code = ? AND p.chapter_index = ? AND (p.para_index = ? OR p.para_num = ?)
            ORDER BY (p.para_index = ?) DESC
            LIMIT 1
          `).get(bookCode, chapIdx, paraIdx, String(paraIdx), paraIdx);
        } else {
          row = dbTipitaka.prepare(`
            SELECT p.chapter_index, b.title AS book_title, b.category, b.nikaya, p.chapter_title, p.sutta_title, p.para_index, p.para_num
            FROM canon_paragraphs p
            LEFT JOIN books b ON b.code = p.book_code
            WHERE p.book_code = ? AND (p.para_index = ? OR p.para_num = ?)
            ORDER BY (p.para_index = ?) DESC
            LIMIT 1
          `).get(bookCode, paraIdx, String(paraIdx), paraIdx);
        }

        if (row) {
          bookTitle = row.book_title || bookTitle;
          chapterTitle = row.sutta_title || row.chapter_title || '';
          chapIdx = row.chapter_index;
          resolvedParaNum = row.para_num || '';
          category = row.category || '';
          nikaya = row.nikaya || '';
          if (row.para_index !== undefined && row.para_index !== null) {
            paraIdx = row.para_index;
          }
        }
      } catch (e) {}
    }

    // Default category from bookCode if not found in db
    if (!category) {
      if (bookCode.endsWith('.mul') || bookCode.includes('m.mul')) category = 'mūla';
      else if (bookCode.endsWith('.att') || bookCode.includes('a.att')) category = 'aṭṭhakathā';
      else if (bookCode.endsWith('.tik') || bookCode.includes('t.tik')) category = 'ṭīkā';
      else category = 'añña';
    }

    const key = `${bookCode}:${chapIdx}:${paraIdx}${paraEnd ? `-${paraEnd}` : ''}`;
    if (!seen.has(key)) {
      seen.add(key);

      citations.push({
        bookCode,
        rawBook,
        bookTitle,
        category,
        nikaya,
        chapterTitle,
        chapterIndex: chapIdx,
        paraIndex: paraIdx,
        paraNum: resolvedParaNum,
        paraEnd,
        lineId,
        ref: rawTag,
      });
    }
  }

  // Sort citations: Mūla > Aṭṭhakathā > Ṭīkā > Añña, and Sutta > Vinaya > Abhidhamma > Others
  citations.sort(compareCitations);
  return citations;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SAFE COMPACT TOOL RESULT FORMATTER (PREVENTS INVALID JSON TRUNCATION)
// ═══════════════════════════════════════════════════════════════════════════

function formatCompactToolResponse(toolName, result) {
  if (!result || !result.success) {
    return { error: result?.error || 'Tool execution produced no result' };
  }

  switch (toolName) {
    case 'search_sections':
      return {
        count: result.results?.length || 0,
        matches: (result.results || []).slice(0, 8).map((r) => ({
          title: r.title,
          book_code: r.book_code,
          chapter_index: r.chapter_index,
          para_index: r.para_index,
          citation: r.citation_ref,
          snippet: (r.snippet || '').slice(0, 200),
        })),
      };
    case 'search_tipitaka':
    case 'search_tipitaka_batch':
    case 'search_by_category':
      return {
        count: result.results?.length || 0,
        passages: (result.results || []).slice(0, 8).map((p) => ({
          book_code: p.book_code,
          chapter_title: p.chapter_title,
          sutta_title: p.sutta_title,
          para_index: p.para_index,
          citation: p.citation_ref,
          snippet: (p.snippet || p.text || '').slice(0, 250),
        })),
      };
    case 'get_paragraph_content':
    case 'get_paragraph_content_batch':
      return {
        count: result.passages?.length || 0,
        passages: (result.passages || []).slice(0, 6).map((p) => ({
          book_code: p.book_code,
          chapter_index: p.chapter_index,
          para_index: p.para_index,
          para_num: p.para_num,
          citation: p.citation_ref,
          pali: (p.pali || '').slice(0, 500),
          translation_en: (p.translations?.en || '').slice(0, 500),
          translation_vi: (p.translations?.vi || '').slice(0, 500),
        })),
      };
    case 'get_commentaries':
      return {
        source: result.source,
        atthakatha: (result.atthakatha || []).slice(0, 2).map((a) => ({
          book_code: a.book_code,
          title: a.book_title,
          citation: a.citation_ref,
          pali: (a.pali_text || '').slice(0, 450),
        })),
        tika: (result.tika || []).slice(0, 2).map((t) => ({
          book_code: t.book_code,
          title: t.book_title,
          citation: t.citation_ref,
          pali: (t.pali_text || '').slice(0, 450),
        })),
      };
    case 'get_dictionary':
    case 'get_dictionary_batch':
      return {
        count: result.entries?.length || 0,
        entries: (result.entries || []).slice(0, 4).map((e) => ({
          word: e.word,
          definition: (e.definition || '').slice(0, 300),
        })),
      };
    case 'get_sentences':
      return {
        count: result.count || 0,
        book_code: result.book_code,
        chapter_index: result.chapter_index,
        para_index: result.para_index,
        pali_sentences: (result.pali_sentences || []).slice(0, 8).map((s) => ({
          line_id: s.line_id,
          text: (s.sentence || s.text || '').slice(0, 300),
        })),
        translations: Object.fromEntries(
          Object.entries(result.translations || {}).map(([k, v]) => [k, v.slice(0, 4).map((t) => ({ line_id: t.line_id, text: (t.translation || '').slice(0, 300) }))])
        ),
      };
    case 'get_section':
      return {
        book_code: result.book_code,
        chapter_title: result.chapter_title,
        headings: (result.headings || []).slice(0, 10),
        summary: result.summary ? (result.summary.content || '').slice(0, 400) : null,
      };
    case 'final_answer':
      return { status: 'complete', summary: result.summary || 'Research finalized.' };
    default:
      return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SMART OFFLINE CANONICAL RAG (WHEN NO API KEY IS CONFIGURED)
// ═══════════════════════════════════════════════════════════════════════════

async function executeSmartOfflineCanonicalSearch(userQuery, understanding, onEvent) {
  const collectedEvidence = {
    sections: [],
    passages: [],
    commentaries: [],
    dictionaries: [],
  };
  const toolLogs = [];
  const targetLangs = understanding?.translation_languages || ['en', 'vi'];

  // 1. DPD Dictionary lookup for core Pāḷi terms
  const termsToLookup = (understanding?.canonical_pali_terms || []).slice(0, 4);
  if (termsToLookup.length > 0) {
    onEvent('status', { message: `📚 Analyzing ${termsToLookup.length} Pāḷi technical term(s) in DPD…` });
    for (const term of termsToLookup) {
      const dictRes = aiGetDictionary({ word: term });
      if (dictRes.success && dictRes.entries?.length > 0) {
        collectedEvidence.dictionaries.push(...dictRes.entries);
        const log = { tool: 'get_dictionary', summary: `Looked up DPD definition for "${term}"`, args: { word: term } };
        toolLogs.push(log);
        onEvent('tool_call', log);
      }
    }
  }

  // 2. Search sections & sutta titles using target suttas and stems
  onEvent('status', { message: '📑 Locating canonical discourses in 217 Tipiṭaka books…' });
  const sectionQueries = [
    ...(understanding?.target_sutta_names || []).map((s) => s.replace(/\s*\(.*?\)/, '').trim()),
    ...(understanding?.pali_stems || []).slice(0, 3),
    userQuery,
  ].filter(Boolean);

  const seenSecKeys = new Set();
  for (const q of sectionQueries.slice(0, 4)) {
    const secRes = aiSearchSections({ query: q, limit: 6 });
    if (secRes.results?.length > 0) {
      for (const s of secRes.results) {
        const k = `${s.book_code}:${s.chapter_index}:${s.para_index}`;
        if (!seenSecKeys.has(k)) {
          seenSecKeys.add(k);
          collectedEvidence.sections.push(s);
        }
      }
    }
  }
  if (collectedEvidence.sections.length > 0) {
    const log = {
      tool: 'search_sections',
      summary: `Located ${collectedEvidence.sections.length} canonical discourse sections`,
      args: { queries: sectionQueries.slice(0, 2) },
    };
    toolLogs.push(log);
    onEvent('tool_call', log);
  }

  // 3. Priority Direct Paragraph Fetch if default_sutta_para exists (e.g. Madhupiṇḍika MN 18 para 669)
  if (understanding?.default_sutta_para && understanding?.recommended_locations?.books?.[0]) {
    const targetBook = understanding.recommended_locations.books[0];
    const sPara = understanding.default_sutta_para;
    onEvent('status', { message: `📖 Reading canonical discourse from ${targetBook} §${sPara}…` });
    const paraRes = aiGetParagraphContent({
      book_code: targetBook,
      para_start: sPara,
      para_end: sPara + 4,
      langs: targetLangs,
    });
    if (paraRes.success && paraRes.passages?.length > 0) {
      collectedEvidence.passages.push(...paraRes.passages);
      const log = {
        tool: 'get_paragraph_content',
        summary: `Retrieved ${paraRes.passages.length} passages from ${targetBook} §${sPara}`,
        args: { book_code: targetBook, para_start: sPara, para_end: sPara + 4 },
      };
      toolLogs.push(log);
      onEvent('tool_call', log);
    }
  }

  // 4. Retrieve canonical root passages via FTS if more passages needed
  if (collectedEvidence.passages.length < 3) {
    onEvent('status', { message: '🔍 Retrieving canonical root passages (Pāḷi + translations)…' });
    const tipQueries = [
      ...(understanding?.pali_stems || []).slice(0, 2),
      userQuery,
    ];
    for (const q of tipQueries) {
      const tipRes = aiSearchTipitaka({
        query: q,
        limit: 6,
        categories: understanding?.recommended_locations?.categories || [],
        nikayas: understanding?.recommended_locations?.nikayas || [],
      });
      if (tipRes.results?.length > 0) {
        for (const p of tipRes.results) {
          const k = `${p.book_code}:${p.para_index}`;
          if (!collectedEvidence.passages.some((ep) => `${ep.book_code}:${ep.para_index}` === k)) {
            // Fetch translations for this passage
            const fullP = aiGetParagraphContent({
              book_code: p.book_code,
              chapter_index: p.chapter_index,
              para_start: p.para_index,
              para_end: p.para_index,
              langs: targetLangs,
            });
            if (fullP.passages?.[0]) {
              collectedEvidence.passages.push(fullP.passages[0]);
            } else {
              collectedEvidence.passages.push(p);
            }
          }
        }
      }
      if (collectedEvidence.passages.length >= 6) break;
    }
    if (collectedEvidence.passages.length > 0) {
      const log = {
        tool: 'search_tipitaka',
        summary: `Retrieved ${collectedEvidence.passages.length} canonical passages with citations`,
        args: { query: tipQueries[0] },
      };
      toolLogs.push(log);
      onEvent('tool_call', log);
    }
  }

  // 5. Cross-reference Aṭṭhakathā & Ṭīkā commentaries for top passages
  for (const p of collectedEvidence.passages.slice(0, 2)) {
    const commRes = aiGetCommentaries({
      book_code: p.book_code,
      chapter_index: p.chapter_index,
      para_index: p.para_index,
      para_num: p.para_num,
    });
    if (commRes.atthakatha || commRes.tika) {
      collectedEvidence.commentaries.push(commRes);
      const log = {
        tool: 'get_commentaries',
        summary: `Cross-referenced Aṭṭhakathā commentary for ${p.citation_ref}`,
        args: { book_code: p.book_code, para_index: p.para_index },
      };
      toolLogs.push(log);
      onEvent('tool_call', log);
    }
  }

  return { collectedEvidence, toolLogs };
}

function generateSmartOfflineCanonicalReport(userQuery, understanding, evidence) {
  const lang = understanding?.detected_language || 'en';
  const isVi = lang === 'vi';
  const isMy = lang === 'my';

  let text = isVi
    ? `## Báo Cáo Nghiên Cứu Tam Tạng Pāḷi (Ani AI Nissaya)\n\n`
    : isMy
    ? `## တိပိဋက ပါဠိတော် သုတေသန အစီရင်ခံစာ (Ani AI Nissaya)\n\n`
    : `## Ani (AI Nissaya) Canonical Research Report\n\n`;

  text += isVi
    ? `Tìm hiểu về câu hỏi: *"${userQuery}"*\n\n`
    : isMy
    ? `မေးမြန်းချက်- *"${userQuery}"*\n\n`
    : `Regarding your inquiry: *"${userQuery}"*\n\n`;

  if (understanding && understanding.user_facing_summary) {
    text += `> **${isVi ? 'Phân tích' : isMy ? 'ဆန်းစစ်ချက်' : 'Analysis'}:** ${understanding.user_facing_summary}\n\n`;
  }

  // 1. Relevant Suttas & Sections
  if (evidence.sections?.length > 0) {
    text += isVi
      ? `### 📜 Các bài kinh & phân đoạn liên quan trong Tipiṭaka:\n`
      : isMy
      ? `### 📜 သက်ဆိုင်ရာ သုတ်တော်များနှင့် အခန်းကဏ္ဍများ:\n`
      : `### 📜 Relevant Suttas & Discourses in the Tipiṭaka:\n`;
    for (const sec of evidence.sections.slice(0, 4)) {
      const cite = sec.citation_ref || `[${sec.book_code}:c${sec.chapter_index}:p${sec.para_index}]`;
      text += `- **${sec.title || sec.sutta_title}** (${sec.book_title || sec.book_code}) ${cite}\n`;
      if (sec.snippet) {
        text += `  > ${sec.snippet.replace(/<mark>/g, '**').replace(/<\/mark>/g, '**')}\n`;
      }
    }
    text += `\n`;
  }

  // 2. Canonical Passages
  if (evidence.passages?.length > 0) {
    text += isVi
      ? `### 📖 Trích đoạn gốc Pāḷi (Mūla) & Bản dịch:\n\n`
      : isMy
      ? `### 📖 ပါဠိတော် မူရင်းနှင့် ဘာသာပြန်ချက်များ:\n\n`
      : `### 📖 Canonical Root Passages (Mūla):\n\n`;
    for (let i = 0; i < Math.min(evidence.passages.length, 5); i++) {
      const p = evidence.passages[i];
      const paliSnippet = p.text || p.snippet || p.pali || '';
      const cleanSnippet = paliSnippet.replace(/<mark>/g, '**').replace(/<\/mark>/g, '**');
      const cite = p.citation_ref || `[${p.book_code}:c${p.chapter_index}:p${p.para_index}]`;
      const title = p.sutta_title || p.chapter_title || p.book_title || p.book_code;

      text += `#### ${title} §${p.para_num || p.para_index} ${cite}\n\n`;
      text += `> "${cleanSnippet}"\n\n`;

      if (p.translations?.vi) {
        text += `*Bản dịch tiếng Việt:* ${p.translations.vi}\n\n`;
      }
      if (p.translations?.en || p.translation_en) {
        text += `*English Translation:* ${p.translations?.en || p.translation_en}\n\n`;
      }
    }
  }

  // 3. Commentaries
  if (evidence.commentaries?.length > 0) {
    text += isVi
      ? `### 🏛️ Chú giải Aṭṭhakathā & Phụ chú giải Ṭīkā:\n\n`
      : isMy
      ? `### 🏛️ အဋ္ဌကထာနှင့် ဋီကာ ရှင်းလင်းချက်များ:\n\n`
      : `### 🏛️ Commentarial Clarifications (Aṭṭhakathā & Ṭīkā):\n\n`;
    for (const comm of evidence.commentaries.slice(0, 2)) {
      if (comm.atthakatha && comm.atthakatha.length > 0) {
        const a = comm.atthakatha[0];
        text += `- **${a.book_title || 'Aṭṭhakathā'}** ${a.citation_ref}:\n`;
        text += `  > "${(a.pali_text || '').slice(0, 280)}..."\n\n`;
      }
      if (comm.tika && comm.tika.length > 0) {
        const t = comm.tika[0];
        text += `- **${t.book_title || 'Ṭīkā'}** ${t.citation_ref}:\n`;
        text += `  > "${(t.pali_text || '').slice(0, 250)}..."\n\n`;
      }
    }
  }

  // 4. Dictionary Term Analysis
  if (evidence.dictionaries?.length > 0) {
    text += isVi
      ? `### 📚 Phân tích thuật ngữ Pāḷi (Từ điển DPD):\n\n`
      : isMy
      ? `### 📚 ပါဠိဝေါဟာရ အဓိပ္ပာယ် ဖွင့်ဆိုချက်များ (DPD):\n\n`
      : `### 📚 Pāḷi Term Breakdown (Digital Pāḷi Dictionary):\n\n`;
    for (const d of evidence.dictionaries.slice(0, 4)) {
      text += `- **${d.word}**: ${d.definition}\n`;
    }
    text += `\n`;
  }

  if (evidence.passages?.length === 0 && evidence.sections?.length === 0) {
    text += isVi
      ? `Đã tra cứu dữ liệu trên toàn bộ 217 tập Tam Tạng Pāḷi Chaṭṭha Saṅgāyana. `
      : `The database was searched across all 217 books of the Chaṭṭha Saṅgāyana Tipiṭaka. `;
    text += isVi
      ? `Để kích hoạt khả năng suy luận và tổng hợp văn bản chuyên sâu của AI, vui lòng nhập **Google Gemini API Key** (miễn phí) hoặc OpenAI/OpenRouter key trong Cài Đặt (⚙️).\n\n`
      : `To unlock full multi-turn conversational AI reasoning, please configure your **Google Gemini API Key** (free) or OpenAI/OpenRouter key in AI Settings (⚙️).\n\n`;
  }

  text += isVi
    ? `---\n*Các mã trích dẫn liên kết trực tiếp đến từng đoạn kinh Tam Tạng. Thêm API key trong Cài Đặt (⚙️) để mở tính năng tổng hợp văn phong tự nhiên.*`
    : `---\n*Canonical citations link directly to Chaṭṭha Saṅgāyana paragraphs. Add an API key in Settings (⚙️) to enable full natural-language synthesis.*`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AGENTIC MULTI-STEP TOOL LOOP (GEMINI & OPENAI/OPENROUTER)
// ═══════════════════════════════════════════════════════════════════════════

async function runAgenticToolLoop({
  provider,
  apiKey,
  baseUrl,
  toolModel,
  userQuery,
  conversationHistory = [],
  understanding = null,
  customSystemPrompt,
  onEvent,
}) {
  let toolSystemPrompt = customSystemPrompt?.trim() || kAiDefaultToolSystemPrompt;
  if (understanding) {
    toolSystemPrompt += `\n\n## DECOMPOSED QUERY UNDERSTANDING & SCHOLARLY PLAN (Step 1 Complete):
- User Intent: ${understanding.intent || 'doctrinal_explanation'}
- Target Suttas: ${(understanding.target_sutta_names || []).join(', ') || 'None identified'}
- Primary Pāḷi Terms: ${(understanding.canonical_pali_terms || []).join(', ') || 'N/A'}
- Pāḷi Stems for Search: ${(understanding.pali_stems || []).join(', ') || 'N/A'}
- Recommended Canonical Locations: ${((understanding.recommended_locations?.nikayas) || []).join(', ')} (${((understanding.recommended_locations?.books) || []).join(', ')})
- Translation Languages: ${(understanding.translation_languages || ['en']).join(', ')}
- Targeted Execution Strategy:
${(understanding.initial_search_strategy || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

Execute this strategy systematically. Start by discovering sections or matching passages, read exact paragraphs with get_paragraph_content, cross-reference commentaries where helpful, and call final_answer when sufficient evidence is gathered.`;
  }

  const toolLogs = [];
  const allCollectedEvidence = {
    sections: [],
    passages: [],
    sentences: [],
    commentaries: [],
    dictionaries: [],
  };

  const maxIterations = 8;
  let iterations = 0;
  let toolsDone = false;
  const targetLangs = understanding?.translation_languages || ['en', 'vi'];

  if (provider === 'gemini') {
    const conversation = [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const msg of conversationHistory.slice(-4)) {
        if (msg.role && msg.content) {
          conversation.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content.substring(0, 400) }],
          });
        }
      }
    }
    conversation.push({
      role: 'user',
      parts: [{
        text: `Inquiry: "${userQuery}"\nPlease execute the research strategy using the available database tools to gather verified canonical passages, commentaries, and linguistic definitions.`
      }],
    });

    while (!toolsDone && iterations < maxIterations) {
      iterations++;
      const geminiToolUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: { parts: [{ text: toolSystemPrompt }] },
        contents: conversation,
        tools: [{ functionDeclarations: kAiToolDeclarations }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      };

      let toolRes;
      try {
        toolRes = await fetch(geminiToolUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(35000),
        });
      } catch (err) {
        console.warn(`[Gemini Tool Loop Round ${iterations} Error]:`, err.message);
        break;
      }

      if (!toolRes.ok) {
        console.warn(`[Gemini Tool Loop Round ${iterations} HTTP ${toolRes.status}]`);
        break;
      }

      const resJson = await toolRes.json();
      const candidate = resJson.candidates?.[0];
      const content = candidate?.content;
      const parts = content?.parts || [];

      if (!content || parts.length === 0) {
        toolsDone = true;
        break;
      }

      conversation.push(content);

      const callSpecs = [];
      let hasFinalAnswer = false;

      for (const part of parts) {
        if (part.functionCall) {
          const fc = part.functionCall;
          if (fc.name === 'final_answer') {
            hasFinalAnswer = true;
          }
          if ((fc.name === 'get_paragraph_content' || fc.name === 'get_paragraph_content_batch') && !fc.args?.langs) {
            fc.args = { ...fc.args, langs: targetLangs };
          }
          callSpecs.push(fc);
        } else if (part.text && parts.length === 1) {
          onEvent('status', { message: `Ani is evaluating: ${part.text.slice(0, 120)}…` });
        }
      }

      if (callSpecs.length === 0) {
        toolsDone = true;
        break;
      }

      // Execute all tool calls in parallel
      onEvent('status', { message: `Research step ${iterations}/${maxIterations}: Executing ${callSpecs.length} canonical database tool(s)…` });
      const toolResults = await Promise.allSettled(
        callSpecs.map((spec) => executeAiTool(spec.name, spec.args || {}))
      );

      const functionResponses = [];
      for (let i = 0; i < callSpecs.length; i++) {
        const spec = callSpecs[i];
        const resObj = toolResults[i].status === 'fulfilled' ? toolResults[i].value : { success: false, error: toolResults[i].reason?.message };
        const compact = formatCompactToolResponse(spec.name, resObj);

        // Accumulate evidence
        if (spec.name === 'search_sections' && resObj.results) {
          allCollectedEvidence.sections.push(...resObj.results);
        } else if ((spec.name === 'search_tipitaka' || spec.name === 'search_tipitaka_batch' || spec.name === 'search_by_category') && resObj.results) {
          allCollectedEvidence.passages.push(...resObj.results);
        } else if ((spec.name === 'get_paragraph_content' || spec.name === 'get_paragraph_content_batch') && resObj.passages) {
          allCollectedEvidence.passages.push(...resObj.passages);
        } else if (spec.name === 'get_sentences' && resObj.pali_sentences) {
          allCollectedEvidence.sentences.push(resObj);
        } else if (spec.name === 'get_commentaries' && (resObj.atthakatha || resObj.tika)) {
          allCollectedEvidence.commentaries.push(resObj);
        } else if ((spec.name === 'get_dictionary' || spec.name === 'get_dictionary_batch') && resObj.entries) {
          allCollectedEvidence.dictionaries.push(...resObj.entries);
        }

        const summaryArg = spec.args?.query || spec.args?.queries?.[0] || spec.args?.word || spec.args?.words?.[0] || spec.args?.book_code || '';
        const summary = `${spec.name}${summaryArg ? ` (${summaryArg})` : ''}`;
        toolLogs.push({ tool: spec.name, summary, args: spec.args });
        onEvent('tool_call', { tool: spec.name, summary, args: spec.args });

        functionResponses.push({
          functionResponse: {
            name: spec.name,
            response: { content: compact },
          },
        });
      }

      conversation.push({ role: 'user', parts: functionResponses });

      if (hasFinalAnswer) {
        toolsDone = true;
        break;
      }
    }
  } else {
    // OpenAI / OpenRouter / Custom endpoints
    const endpoint = (baseUrl && baseUrl.trim())
      ? `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
      : provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const openAiTools = getOpenAiToolDeclarations();
    const openAiMessages = [
      { role: 'system', content: toolSystemPrompt },
    ];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const msg of conversationHistory.slice(-4)) {
        if (msg.role && msg.content) {
          openAiMessages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content.substring(0, 400),
          });
        }
      }
    }
    openAiMessages.push({
      role: 'user',
      content: `Inquiry: "${userQuery}"\nPlease execute the research strategy using the available database tools to gather verified canonical passages, commentaries, and linguistic definitions.`,
    });

    while (!toolsDone && iterations < maxIterations) {
      iterations++;
      const payload = {
        model: toolModel || 'gpt-4o-mini',
        messages: openAiMessages,
        tools: openAiTools,
        tool_choice: 'auto',
        temperature: 0.2,
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://tipitakapali.org';
        headers['X-Title'] = 'tipitakapali.org';
      }

      let toolRes;
      try {
        toolRes = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(35000),
        });
      } catch (err) {
        console.warn(`[OpenAI Tool Loop Round ${iterations} Error]:`, err.message);
        break;
      }

      if (!toolRes.ok) {
        console.warn(`[OpenAI Tool Loop Round ${iterations} HTTP ${toolRes.status}]`);
        break;
      }

      const resJson = await toolRes.json();
      const choice = resJson.choices?.[0];
      const message = choice?.message;

      if (!message) {
        toolsDone = true;
        break;
      }

      openAiMessages.push(message);

      const toolCalls = message.tool_calls || [];
      if (toolCalls.length === 0) {
        toolsDone = true;
        break;
      }

      onEvent('status', { message: `Research step ${iterations}/${maxIterations}: Executing ${toolCalls.length} canonical database tool(s)…` });

      let hasFinalAnswer = false;
      const callSpecs = [];

      for (const tc of toolCalls) {
        const fnName = tc.function?.name || '';
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch (e) {}

        if (fnName === 'final_answer') {
          hasFinalAnswer = true;
        }
        if ((fnName === 'get_paragraph_content' || fnName === 'get_paragraph_content_batch') && !parsedArgs.langs) {
          parsedArgs.langs = targetLangs;
        }
        callSpecs.push({ id: tc.id, name: fnName, args: parsedArgs });
      }

      const toolResults = await Promise.allSettled(
        callSpecs.map((spec) => executeAiTool(spec.name, spec.args))
      );

      for (let i = 0; i < callSpecs.length; i++) {
        const spec = callSpecs[i];
        const resObj = toolResults[i].status === 'fulfilled' ? toolResults[i].value : { success: false, error: toolResults[i].reason?.message };
        const compact = formatCompactToolResponse(spec.name, resObj);

        // Accumulate evidence
        if (spec.name === 'search_sections' && resObj.results) {
          allCollectedEvidence.sections.push(...resObj.results);
        } else if ((spec.name === 'search_tipitaka' || spec.name === 'search_tipitaka_batch' || spec.name === 'search_by_category') && resObj.results) {
          allCollectedEvidence.passages.push(...resObj.results);
        } else if ((spec.name === 'get_paragraph_content' || spec.name === 'get_paragraph_content_batch') && resObj.passages) {
          allCollectedEvidence.passages.push(...resObj.passages);
        } else if (spec.name === 'get_sentences' && resObj.pali_sentences) {
          allCollectedEvidence.sentences.push(resObj);
        } else if (spec.name === 'get_commentaries' && (resObj.atthakatha || resObj.tika)) {
          allCollectedEvidence.commentaries.push(resObj);
        } else if ((spec.name === 'get_dictionary' || spec.name === 'get_dictionary_batch') && resObj.entries) {
          allCollectedEvidence.dictionaries.push(...resObj.entries);
        }

        const summaryArg = spec.args?.query || spec.args?.queries?.[0] || spec.args?.word || spec.args?.words?.[0] || spec.args?.book_code || '';
        const summary = `${spec.name}${summaryArg ? ` (${summaryArg})` : ''}`;
        toolLogs.push({ tool: spec.name, summary, args: spec.args });
        onEvent('tool_call', { tool: spec.name, summary, args: spec.args });

        openAiMessages.push({
          role: 'tool',
          tool_call_id: spec.id,
          content: JSON.stringify(compact),
        });
      }

      if (hasFinalAnswer) {
        toolsDone = true;
        break;
      }
    }
  }

  // Automatic Fallback Search if no passages or sections collected
  if (allCollectedEvidence.passages.length === 0 && allCollectedEvidence.sections.length === 0) {
    onEvent('status', { message: 'Conducting canonical grounding fallback search…' });
    const secQueries = [
      ...(understanding?.target_sutta_names || []).map((s) => s.replace(/\s*\(.*?\)/, '').trim()),
      ...(understanding?.pali_stems || []).slice(0, 2),
      userQuery,
    ].filter(Boolean);

    for (const q of secQueries.slice(0, 3)) {
      const sRes = aiSearchSections({ query: q, limit: 4 });
      if (sRes.results?.length > 0) {
        allCollectedEvidence.sections.push(...sRes.results);
        const log = { tool: 'search_sections', summary: `Found ${sRes.results.length} related suttas/sections`, args: { query: q } };
        toolLogs.push(log);
        onEvent('tool_call', log);
        break;
      }
    }

    if (understanding?.default_sutta_para && understanding?.recommended_locations?.books?.[0]) {
      const pRes = aiGetParagraphContent({
        book_code: understanding.recommended_locations.books[0],
        para_start: understanding.default_sutta_para,
        para_end: understanding.default_sutta_para + 4,
        langs: targetLangs,
      });
      if (pRes.passages?.length > 0) {
        allCollectedEvidence.passages.push(...pRes.passages);
        const log = { tool: 'get_paragraph_content', summary: `Retrieved ${pRes.passages.length} passages`, args: { book_code: understanding.recommended_locations.books[0] } };
        toolLogs.push(log);
        onEvent('tool_call', log);
      }
    }

    if (allCollectedEvidence.passages.length === 0) {
      const tRes = aiSearchTipitaka({ query: userQuery, limit: 8 });
      if (tRes.results?.length > 0) {
        allCollectedEvidence.passages.push(...tRes.results);
        const log = { tool: 'search_tipitaka', summary: `Retrieved ${tRes.results.length} canonical passages with citations`, args: { query: userQuery } };
        toolLogs.push(log);
        onEvent('tool_call', log);
      }
    }
  }

  return { collectedEvidence: allCollectedEvidence, toolLogs };
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONTEXT COMPILER FOR ANSWER SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════

function buildSynthesisContextBlock(evidence) {
  let block = '';

  // 1. Root Passages (Mūla)
  if (evidence.passages && evidence.passages.length > 0) {
    block += `### CANONICAL ROOT TEXTS (MŪLA SUTTAS & VINAYA):\n\n`;
    for (let i = 0; i < Math.min(evidence.passages.length, 10); i++) {
      const p = evidence.passages[i];
      const title = p.sutta_title || p.chapter_title || p.book_title || p.book_code;
      block += `[Source ${i + 1}] ${title} (${p.book_code}) §${p.para_num || p.para_index}\n`;
      block += `Citation: ${p.citation_ref || `[${p.book_code}:c${p.chapter_index || 0}:p${p.para_index}]`}\n`;
      block += `Pāḷi Text:\n${p.pali || p.text || p.snippet}\n`;
      if (p.translations?.en || p.translation_en) {
        block += `English Translation:\n${p.translations?.en || p.translation_en}\n`;
      }
      block += `\n`;
    }
  }

  // 1b. Sentence-Level Evidence (99.7% Pāḷi↔translation line alignment)
  if (evidence.sentences && evidence.sentences.length > 0) {
    block += `### SENTENCE-LEVEL ALIGNED EVIDENCE (Pāḷi ↔ translations, shared line_id):\n\n`;
    for (let i = 0; i < Math.min(evidence.sentences.length, 6); i++) {
      const s = evidence.sentences[i];
      block += `[Sentence Source ${i + 1}] ${s.book_code} c${s.chapter_index} p${s.para_index}\n`;
      for (const ps of (s.pali_sentences || []).slice(0, 6)) {
        block += `  L${ps.line_id}: ${ps.sentence || ps.text}\n`;
        for (const [lang, trs] of Object.entries(s.translations || {})) {
          const tr = trs.find((t) => t.line_id === ps.line_id);
          if (tr) block += `    → [${lang}] L${tr.line_id}: ${tr.translation}\n`;
        }
      }
      block += `Citations: ${(s.pali_sentences || []).map((ps) => `[${s.book_code}:c${s.chapter_index}:p${s.para_index}-L${ps.line_id}]`).join(' ')}\n\n`;
    }
  }

  // 2. Commentaries (Aṭṭhakathā & Ṭīkā)
  if (evidence.commentaries && evidence.commentaries.length > 0) {
    block += `### COMMENTARIAL EXPOSITIONS (AṬṬHAKATHĀ & ṬĪKĀ):\n\n`;
    for (const comm of evidence.commentaries.slice(0, 4)) {
      if (comm.atthakatha) {
        for (const a of comm.atthakatha.slice(0, 2)) {
          block += `[Commentary] ${a.book_title} (${a.book_code})\n`;
          block += `Citation: ${a.citation_ref}\n`;
          block += `Pāḷi Text: ${a.pali_text}\n\n`;
        }
      }
      if (comm.tika) {
        for (const t of comm.tika.slice(0, 2)) {
          block += `[Sub-Commentary] ${t.book_title} (${t.book_code})\n`;
          block += `Citation: ${t.citation_ref}\n`;
          block += `Pāḷi Text: ${t.pali_text}\n\n`;
        }
      }
    }
  }

  // 3. Dictionary Definitions (DPD)
  if (evidence.dictionaries && evidence.dictionaries.length > 0) {
    block += `### PĀḶI LINGUISTIC & DICTIONARY ANALYSIS (DPD):\n\n`;
    for (const d of evidence.dictionaries.slice(0, 5)) {
      block += `- Word: "${d.word}"\n  Definition: ${d.definition}\n`;
    }
    block += `\n`;
  }

  // 4. Section Outlines & Summaries
  if (evidence.sections && evidence.sections.length > 0) {
    block += `### SUTTA OUTLINES & SECTION OVERVIEWS:\n\n`;
    for (const s of evidence.sections.slice(0, 4)) {
      block += `- Section: ${s.title || s.sutta_title} (${s.book_title}) ${s.citation_ref}\n`;
      if (s.snippet) {
        block += `  Overview: ${s.snippet.replace(/<[^>]*>/g, '')}\n`;
      }
    }
    block += `\n`;
  }

  return block.trim();
}

function evidenceWithFallback(ev) {
  return ev || { sections: [], passages: [], sentences: [], commentaries: [], dictionaries: [] };
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
    const pStart = req.query.start || req.query.para_start;
    return aiGetSection({
      book_code: book,
      chapter_index: chap,
      para_start: pStart !== undefined ? parseInt(pStart, 10) : undefined,
    });
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
    const pidx = req.query.idx || req.query.para_index;
    return aiGetCommentaries({
      book_code: book,
      chapter_index: chap,
      para_num: pnum,
      para_index: pidx !== undefined ? parseInt(pidx, 10) : undefined,
    });
  });

  fastify.get('/api/ai/commentary_link', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = parseInt(req.query.chapter || req.query.chapter_index || '0', 10);
    const pnum = req.query.para || req.query.para_num || '';
    const pidx = req.query.idx || req.query.para_index;
    return aiGetCommentaries({
      book_code: book,
      chapter_index: chap,
      para_num: pnum,
      para_index: pidx !== undefined ? parseInt(pidx, 10) : undefined,
    });
  });

  fastify.get('/api/ai/dictionary', async (req) => {
    const w = req.query.w || req.query.word || '';
    return aiGetDictionary({ word: w });
  });

  fastify.post('/api/ai/dictionary_batch', async (req) => {
    const body = req.body || {};
    return executeAiTool('get_dictionary_batch', body);
  });

  fastify.get('/api/ai/sentences', async (req) => {
    const book = req.query.book || req.query.book_code || '';
    const chap = req.query.chapter !== undefined ? parseInt(req.query.chapter, 10) : undefined;
    const pidx = req.query.para_index !== undefined ? parseInt(req.query.para_index, 10) : undefined;
    const lid = req.query.line !== undefined ? parseInt(req.query.line, 10) : undefined;
    const langs = req.query.langs ? req.query.langs.split(',') : ['en'];
    return aiGetSentences({ book_code: book, chapter_index: chap, para_index: pidx, line_id: lid, langs });
  });

  fastify.get('/api/ai/books', async () => {
    return aiGetBooks();
  });

  fastify.post('/api/ai/tool-call', async (req) => {
    // ZERO KEY ESCAPE: Tool execution is strictly local SQLite queries and never accepts or requires an API key.
    if (req.body && typeof req.body === 'object') {
      if ('apiKey' in req.body) delete req.body.apiKey;
      if (req.body.args && typeof req.body.args === 'object' && 'apiKey' in req.body.args) {
        delete req.body.args.apiKey;
      }
    }
    const { name, args } = req.body || {};
    if (!name) return { success: false, error: 'Missing tool name' };
    return executeAiTool(name, args || {});
  });

  // ── Streaming Chat Endpoint (SSE) ──────────────────────────────────────
  fastify.post('/api/ai/chat', async (req, reply) => {
    const body = req.body || {};

    // ZERO KEY ESCAPE POLICY:
    // Reject any client attempts to send their user API key to the backend server.
    // The browser client executes the LLM reasoning loop directly against Google/OpenAI.
    if (body.apiKey && body.apiKey !== process.env.GEMINI_API_KEY) {
      return reply.code(400).send({
        error: 'Zero-Key-Escape policy active: Client API keys must never escape to the backend server. Ani executes AI requests directly from your browser.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return reply.code(400).send({
        error: 'Backend LLM chat is disabled. Please configure your API key in Ani Settings in your browser.',
      });
    }

    const {
      messages = [],
      apiKey = process.env.GEMINI_API_KEY || '',
      provider = 'gemini',
      toolModel = 'gemini-flash-lite-latest',
      answerModel = 'gemini-flash-lite-latest',
      groundRAGMode = true,
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
      const conversationHistory = Array.isArray(messages) ? messages.slice(0, -1) : [];

      // ── STEP 1: AI QUERY UNDERSTANDING & DECOMPOSITION ──────────────────
      sendEvent('status', { message: '🧠 Step 1: Dissecting inquiry and extracting canonical Pāḷi terms…' });
      const understanding = await understandUserQuery({
        userQuery,
        conversationHistory,
        provider,
        apiKey: apiKey ? apiKey.trim() : '',
        baseUrl,
        toolModel,
        dbTipitaka,
        dbSummaries,
        onStatus: (msg) => sendEvent('status', { message: msg }),
      });

      // Emit understanding event for the client to render the Query Understanding card
      sendEvent('understanding', understanding);
      sendEvent('status', { message: `🧠 ${understanding.user_facing_summary}` });

      // ── STEP 2: MULTI-STEP CANONICAL RESEARCH LOOP ─────────────────────
      if (!apiKey || apiKey.trim().length < 5) {
        // SMART OFFLINE CANONICAL RAG (when no external API key is provided)
        sendEvent('status', { message: 'Conducting local database research across Tipitaka…' });

        const { collectedEvidence, toolLogs } = await executeSmartOfflineCanonicalSearch(userQuery, understanding, sendEvent);
        const offlineText = generateSmartOfflineCanonicalReport(userQuery, understanding, evidenceWithFallback(collectedEvidence));

        const chunks = offlineText.split(/(?<=\s)/);
        for (const chunk of chunks) {
          sendEvent('token', { text: chunk });
          await new Promise((r) => setTimeout(r, 2));
        }

        const citations = parseCitations(offlineText);
        sendEvent('citations', { citations });
        sendEvent('done', {
          mode: 'smart_offline_rag',
          understanding,
          toolCalls: toolLogs,
          note: 'Add Gemini or OpenAI API Key in Settings to enable generative synthesis',
        });
        reply.raw.end();
        return;
      }

      // AGENTIC MULTI-STEP TOOL CALLING LOOP
      sendEvent('status', { message: 'Initiating canonical research with scholarly agent loop…' });

      const { collectedEvidence, toolLogs } = await runAgenticToolLoop({
        provider,
        apiKey: apiKey.trim(),
        baseUrl,
        toolModel,
        userQuery,
        conversationHistory,
        understanding,
        customSystemPrompt,
        onEvent: sendEvent,
      });

      // 3. SYNTHESIS PHASE WITH ANSWER MODEL
      sendEvent('status', { message: 'Synthesizing authoritative response with canonical citations…' });

      const contextBlock = buildSynthesisContextBlock(collectedEvidence);
      const answerSystemPrompt = buildAnswerSystemPrompt({ groundRAGMode });
      const targetLang = understanding?.detected_language || 'en';
      let langDirective = 'Please write your response in English.';
      if (targetLang === 'vi') {
        langDirective = 'Hãy viết toàn bộ câu trả lời bằng tiếng Việt trang trọng, chuẩn mực Phật học, giải thích rõ các thuật ngữ Pāḷi.';
      } else if (targetLang === 'my') {
        langDirective = 'Please write your complete answer in Burmese (မြန်မာဘာသာ), maintaining groundRAG Theravāda scholarship and Pāḷi citations.';
      }

      const synthesisPrompt = `USER QUESTION:
${userQuery}

LANGUAGE DIRECTIVE:
${langDirective}

VERIFIED CANONICAL EVIDENCE GATHERED FROM TIPITAKA DATABASE:
${contextBlock || 'No direct text matches found in search; please synthesize strictly according to canonical Theravāda principles.'}

Please write a comprehensive, clearly structured answer. Quote Pāḷi verses or phrases accurately and format EVERY citation as [book_code:c{chapter_index}:p{para_index}].`;

      if (provider === 'gemini') {
        const geminiStreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${answerModel}:streamGenerateContent?alt=sse&key=${apiKey.trim()}`;
        const payload = {
          system_instruction: { parts: [{ text: answerSystemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        };

        const res = await fetch(geminiStreamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000),
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
          buffer = lines.pop() || '';

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
        sendEvent('done', { toolCalls: toolLogs, understanding, mode: 'gemini_agent_loop' });
      } else {
        // OpenAI / OpenRouter / Custom endpoints
        const endpoint = (baseUrl && baseUrl.trim())
          ? `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
          : provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';

        const payload = {
          model: answerModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: answerSystemPrompt },
            { role: 'user', content: synthesisPrompt },
          ],
          temperature: 0.3,
          stream: true,
        };

        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        };
        if (provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://tipitakapali.org';
          headers['X-Title'] = 'tipitakapali.org';
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000),
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
          buffer = lines.pop() || '';

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
        sendEvent('done', { toolCalls: toolLogs, understanding, mode: 'openai_agent_loop' });
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
  compareCitations,
  getCitationGroupPriority,
  getCitationPitakaPriority,
  resolveCanonicalBookCode,
  kAiToolDeclarations,
  getOpenAiToolDeclarations,
  buildSynthesisContextBlock,
};
