'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dictEngine = require('./dictEngine');
const { BoldLinkedEngine } = require('./boldLinkedEngine');
const { convertAnyToRoman } = require('./transliterate');
const {
  readChapterSentences,
  readChapterPack,
  hydrateCanonRows,
} = require('./tipitakaCoreHelper');
const {
  understandUserQuery,
  heuristicQueryUnderstanding,
  parseCanonicalCitation,
  resolveCanonicalCitation,
  normalizeConceptGroups,
  detectLanguage,
} = require('./aiQueryUnderstanding');

// ═══════════════════════════════════════════════════════════════════════════
//  DATABASE CONNECTIONS & BOOK CODE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

let dbTipitaka = null;
let dbFts = null;
let dbSummaries = null;
let boldLinkedEngineRef = null;
let translationEngineRef = null;
const translationDbs = new Map();
const translationFtsDbs = new Map();
const bookCodeMap = new Map();

let resolveDbPathFn = null;

function getBoldLinkedEngine() {
  if (boldLinkedEngineRef) return boldLinkedEngineRef;
  try {
    const boldPath = resolveDbPathFn
      ? resolveDbPathFn('bold_definitions.db')
      : path.resolve(__dirname, 'db/bold_definitions.db');
    const tipiPath = resolveDbPathFn
      ? resolveDbPathFn('tipitaka.db')
      : path.resolve(__dirname, 'db/tipitaka.db');
    const dbDir = boldPath ? path.dirname(boldPath) : (tipiPath ? path.dirname(tipiPath) : path.resolve(__dirname, 'db'));
    if (boldPath && fs.existsSync(boldPath)) {
      let transEngine = translationEngineRef;
      if (!transEngine) {
        try {
          const { getTranslationEngine } = require('./translationEngine');
          transEngine = getTranslationEngine();
        } catch (_) {}
      }
      boldLinkedEngineRef = new BoldLinkedEngine({
        dbTipitaka,
        tipiDbPath: tipiPath,
        dbDir,
        getPaliSentDb: () => null,
        translationEngine: transEngine,
      });
      // Open pre-built bold_definitions.db directly if it exists, without forcing rebuild
      if (fs.existsSync(boldPath) && !boldLinkedEngineRef.boldDb) {
        try {
          boldLinkedEngineRef.boldDb = new Database(boldPath, { readonly: true });
          boldLinkedEngineRef.boldDb.exec('PRAGMA temp_store = MEMORY; PRAGMA query_only = 1;');
        } catch (_) {}
      }
      return boldLinkedEngineRef;
    }
  } catch (e) {
    console.warn('[AI Controller] BoldLinkedEngine lazy init notice:', e.message);
  }
  return null;
}

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

function initAiController({ db, dbFts: fts, resolveDbPath, boldLinkedEngine = null, translationEngine = null }) {
  dbTipitaka = db;
  dbFts = fts;
  resolveDbPathFn = resolveDbPath || ((f) => path.join(__dirname, 'db', f));
  if (boldLinkedEngine) boldLinkedEngineRef = boldLinkedEngine;
  if (translationEngine) translationEngineRef = translationEngine;

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
    'an1': 's0401m.mul', 'an2': 's0402m1.mul', 'an3': 's0402m2.mul', 'an4': 's0402m3.mul', 'an5': 's0403m1.mul',
    'an6': 's0403m2.mul', 'an7': 's0403m3.mul', 'an8': 's0404m1.mul', 'an9': 's0404m2.mul', 'an10': 's0404m3.mul', 'an11': 's0404m4.mul',
    'a-i': 's0401m.mul', 'a-ii': 's0402m1.mul', 'a-iii': 's0402m2.mul', 'a-iv': 's0402m3.mul', 'a-v': 's0403m1.mul',
    'khp': 's0501m.mul', 'dhp': 's0502m.mul', 'ud': 's0503m.mul', 'it': 's0504m.mul', 'snp': 's0505m.mul',
    'vv': 's0506m.mul', 'pv': 's0507m.mul', 'thag': 's0508m.mul', 'thig': 's0509m.mul',
    'ja': 's0513m.mul', 'jat': 's0513m.mul', 'jataka': 's0513m.mul',
    'vin1': 'vin01m.mul', 'vin2': 'vin02m1.mul', 'vin3': 'vin02m2.mul', 'vin4': 'vin02m3.mul', 'vin5': 'vin02m4.mul',
    'parajika': 'vin01m.mul', 'pacittiya': 'vin02m1.mul', 'patimokkha': 'vin01m.mul',
    'dhammasangani': 'abh01m.mul', 'vibhanga': 'abh02m.mul', 'dhatukatha': 'abh03m1.mul',
    'puggalapannatti': 'abh03m2.mul', 'kathavatthu': 'abh03m3.mul', 'yamaka': 'abh03m4.mul', 'patthana': 'abh03m7.mul',
    'visuddhimagga': 'e0101n.mul', 'vism': 'e0101n.mul', 'abhidhammatthasangaha': 'abh07t.nrf', 'milinda': 's0518m.nrf',
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
    if (num === 1) return 's0401m.mul';
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
    if (num === 2) return 'vin02m1.mul';
    if (num === 3) return 'vin02m2.mul';
    if (num === 4) return 'vin02m3.mul';
    if (num === 5) return 'vin02m4.mul';
  }

  // Abhidhamma: abh1-7
  const abhMatch = lower.match(/^abh(?:idhamma)?(\d+)?$/);
  if (abhMatch) {
    const num = abhMatch[1] ? parseInt(abhMatch[1], 10) : 1;
    const abhMap = {
      1: 'abh01m.mul', 2: 'abh02m.mul', 3: 'abh03m1.mul',
      4: 'abh03m2.mul', 5: 'abh03m3.mul', 6: 'abh03m4.mul', 7: 'abh03m7.mul',
    };
    if (abhMap[num]) return abhMap[num];
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
    name: 'search_concepts',
    description:
      'High-precision multi-concept boolean search across Pāḷi Canon and English/translation FTS5 indexes. ' +
      'Break a research question into 1–4 main concept groups, each with Pāḷi terms/stems AND English keywords/synonyms. ' +
      'Intersects groups with (Group1_syn1 OR syn2) AND (Group2_syn1 OR syn2), automatically relaxing if strict intersection is sparse, and ranks passages by concept coverage + Mūla priority. ' +
      'Use this FIRST for doctrinal, comparative, or thematic research questions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        concept_groups: {
          type: 'ARRAY',
          description: 'Array of 1 to 4 main concept groups to intersect.',
          items: {
            type: 'OBJECT',
            properties: {
              concept: { type: 'STRING', description: 'Short label for this concept group (e.g. "Overcoming Anger").' },
              pali_terms: {
                type: 'ARRAY',
                description: 'Pāḷi lemmas & canonical synonyms in Roman IAST (e.g. ["kodha", "vyāpāda", "āghāta"]).',
                items: { type: 'STRING' },
              },
              pali_stems: {
                type: 'ARRAY',
                description: 'Pāḷi stems with terminal vowels stripped + * (e.g. ["kodh*", "vyāpād*"]).',
                items: { type: 'STRING' },
              },
              english_keywords: {
                type: 'ARRAY',
                description: 'English keywords & synonyms (e.g. ["anger", "ill-will", "resentment"]).',
                items: { type: 'STRING' },
              },
              local_keywords: {
                type: 'ARRAY',
                description: 'Optional keywords in user language when non-English (e.g. Vietnamese ["sân hận", "tâm từ"]).',
                items: { type: 'STRING' },
              },
            },
            required: ['concept'],
          },
        },
        categories: {
          type: 'ARRAY',
          description: 'Optional Piṭaka / layer filter: ["vinaya", "sutta", "abhidhamma", "mula", "atthakatha", "tika"].',
          items: { type: 'STRING' },
        },
        nikayas: {
          type: 'ARRAY',
          description: 'Optional Nikāya filter: ["dn", "mn", "sn", "an", "kn", "dhp", "ja"].',
          items: { type: 'STRING' },
        },
        langs: {
          type: 'ARRAY',
          description: 'Optional translation FTS languages to search alongside Pāḷi (defaults to ["en"]).',
          items: { type: 'STRING' },
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum passages to return (default 15, max 30).',
        },
      },
      required: ['concept_groups'],
    },
  },
  {
    name: 'get_bold_definitions',
    description:
      'Query 387,000+ pre-indexed canonical & commentarial BOLD DEFINITIONS (<b>lemma</b> glosses from Aṭṭhakathā, Ṭīkā, Visuddhimagga, Abhidhammatthasaṅgaha, and Mūla). ' +
      'Essential for "What is X?" or doctrinal term definitions — returns exact Pāḷi defining sentences, aligned translations, and sentence-level citations [book:cX:pY-LZ].',
    parameters: {
      type: 'OBJECT',
      properties: {
        word: {
          type: 'STRING',
          description: 'Pāḷi headword or stem to look up (e.g. "mettā", "saṅkhāra", "nibbāna", "papañca", "sati").',
        },
        langs: {
          type: 'ARRAY',
          description: 'Translation languages to attach (defaults to ["en"]).',
          items: { type: 'STRING' },
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum definitions to return (default 8, max 20).',
        },
      },
      required: ['word'],
    },
  },
  {
    name: 'get_bold_definitions_batch',
    description:
      'Look up canonical & commentarial bold definitions for multiple Pāḷi terms in ONE parallel call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        words: {
          type: 'ARRAY',
          description: 'Array of 2 to 5 Pāḷi terms to look up in bold_definitions.db.',
          items: { type: 'STRING' },
        },
        langs: {
          type: 'ARRAY',
          description: 'Translation languages to attach (defaults to ["en"]).',
          items: { type: 'STRING' },
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum definitions per word (default 4).',
        },
      },
      required: ['words'],
    },
  },
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
//  SYSTEM PROMPTS (CONCEPT-GROUP & VĪMAṂSĀ MULTI-STEP STRATEGY)
// ═══════════════════════════════════════════════════════════════════════════

const kAiDefaultToolSystemPrompt = `You are Ani (AI Nissaya), the dedicated scholarly AI assistant for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is to systematically investigate the Dhamma through precise canonical research using the local database tools.

## Available Research Tools
1. search_concepts(concept_groups, categories, nikayas, langs, limit) — **PRIMARY TOOL for research questions**: Intersects 1–4 main concept groups with Pāḷi terms/stems AND English synonyms across Pāḷi Canon + translation FTS5 indexes, ranked by concept coverage & Mūla priority.
2. get_bold_definitions(word, langs, limit) / get_bold_definitions_batch(words, langs) — **PRIMARY TOOL for term definitions**: Queries 387,000+ pre-indexed canonical & commentarial bold definitions (Aṭṭhakathā, Ṭīkā, Visuddhimagga, Abhidhammatthasaṅgaha, Mūla) with exact sentence citations [book:cX:pY-LZ].
3. search_sections(query) — Search sutta and vagga titles + 121k summaries across all 217 books (also resolves direct citations like MN 18, DN 22, SN 56.11, AN 3.65, Dhp 183).
4. get_headings(book_code, chapter_index) — Get table of contents, vagga outlines, and chapter structure for a book.
5. get_section(book_code, chapter_index, para_start) — Read section overview, outline, and study guides.
6. search_by_category(queries, categories, nikayas) — Search within specific Piṭakas ("vinaya", "sutta", "abhidhamma") or Nikāyas ("dn", "mn", "sn", "an", "kn", "dhp", "ja").
7. search_tipitaka_batch(queries) / search_tipitaka(query) — Full-text search across Pāḷi and translation databases.
8. get_paragraph_content(book_code, chapter_index, para_start, para_end, para_num) / get_paragraph_content_batch(ranges) — Read exact Pāḷi text and aligned translations.
9. get_sentences(book_code, chapter_index, para_index, line_id) — Sentence-level Pāḷi and aligned translations with shared line numbers (99.7% match) for [book:cX:pY-LZ] precision.
10. get_commentaries(book_code, chapter_index, para_num, para_index) — Retrieve corresponding Aṭṭhakathā and Ṭīkā explanations.
11. get_dictionary(word) / get_dictionary_batch(words) — DPD definitions, roots, compound splitting, and grammatical analysis.
12. get_books() — List of 217 canonical books, nikāyas, and their codes.
13. final_answer(summary) — Finalize research once you have gathered sufficient canonical evidence.

## Strategic Research Workflow (Concept-Group & Vīmaṃsā Loop)
You have up to 6 iterations. Be decisive and efficient — batch tool calls in parallel!

### Phase 1: Concept-Group Discovery & Term Definitions
- Use **search_concepts** with the decomposed main concept groups (Pāḷi lemmas/stems + English synonyms) to locate passages where the core concepts intersect.
- Use **search_sections** when looking up a named sutta or specific discourse (e.g. "kaccānagotta", "satipaṭṭhāna", "MN 18").
- When the question asks for the meaning/definition of a Pāḷi term or doctrinal concept, ALWAYS call **get_bold_definitions** (or **get_bold_definitions_batch**) AND **get_dictionary** in parallel!

### Phase 2: Exact Textual Verification
- Once relevant discourses are located, call **get_paragraph_content_batch** (or **get_paragraph_content** / **get_sentences**) to verify the exact Pāḷi wording and aligned translations.
- Never rely solely on short snippets or summaries — confirm key quotes directly from full passages.

### Phase 3: Commentarial Depth (Aṭṭhakathā & Ṭīkā)
- When authentic Theravāda doctrinal clarification is needed, call **get_commentaries** on the key Mūla paragraph or inspect the Aṭṭhakathā/Ṭīkā entries returned by **get_bold_definitions**.

### Phase 4: Synthesis Trigger
- As soon as you have verified primary Mūla passages plus supporting bold definitions / commentaries / DPD entries that directly answer the inquiry, call **final_answer(summary)** without wasting extra rounds.`;

function buildAnswerSystemPrompt({ groundRAGMode = true }) {
  const grounding = groundRAGMode
    ? `## RAG Mode Rules (Strict Grounding)
1. Every factual claim MUST be supported by an inline citation in the exact format: [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{para}-L{line}] for sentence precision (e.g. [s0201m.mul:c0:p7-L2]).
2. Answer the user's question using ONLY the canonical passages, bold definitions, commentaries, and dictionary definitions returned by the research tools.
3. Quote Pāḷi verses or phrases EXACTLY as written in the sources (use Markdown blockquotes); provide clear translations in the user's language following each quote. When citing bold definitions or sentences, include the exact sentence citation [book_code:c{chap}:p{para}-L{line}].
4. Distinguish clearly between Mūla (root canon), Aṭṭhakathā (commentary), Ṭīkā (sub-commentary), and DPD (lexicon) sources.
5. If the retrieved sources do not fully answer the question, state this with complete honesty rather than speculating.
6. Explain technical Pāḷi terms on first mention with clear etymology and canonical definition.`
    : `## Knowledge Mode Rules (Canonical + Contextual Knowledge)
1. Base your answer primarily on the canonical passages, bold definitions, commentaries, and dictionary entries retrieved by the tools, with inline citations [book_code:c{chap}:p{para}] or sentence citations [book_code:c{chap}:p{para}-L{line}].
2. You may supplement with your broader knowledge of the Pāḷi Canon, Theravāda Abhidhamma, and historical commentary where sources are partial, clearly distinguishing cited canonical evidence from broader exposition.
3. Quote Pāḷi accurately, with translation following. Format every citation as [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{para}-L{line}] so users can click them directly in the reader.`;

  return `You are Ani (AI Nissaya), the scholarly Pāḷi Canon companion on tipitakapali.org.
You have been supplied with verified passages, canonical bold definitions, sentence translations, commentaries, and dictionary entries from the Chaṭṭha Saṅgāyana Tipiṭaka database.

## Task
Write a comprehensive, insightful, and clearly structured answer to the user's question using rich Markdown (headers, bullet points, comparison tables where helpful, and blockquotes for Pāḷi quotes).

## Citation Format
All canonical citations MUST appear as clickable chips in square brackets:
  - Paragraph: [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_start}-{para_end}]
  - Sentence / Bold Definition: [book_code:c{chapter_index}:p{para_index}-L{line_id}]
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
  'tell', 'me', 'give', 'list', 'show', 'explore', 'between', 'exact',
  'buddha', 'teach', 'teaching', 'teachings', 'does', 'say', 'says', 'mean', 'meaning'
]);

const FTS_RESERVED_WORDS = new Set(['and', 'or', 'not', 'near']);

// Strip terminal vowels (-a, -ā, -e, -o) for Pāḷi stem matching
function paliStem(word) {
  if (!word || word.length < 3) return word;
  return word.replace(/[aāeo]$/i, '');
}

function sanitizeFtsTerm(rawTerm, { isPali = false, allowPrefix = true } = {}) {
  if (!rawTerm || typeof rawTerm !== 'string') return '';
  let text = rawTerm.trim().normalize('NFC');
  const hadStar = text.endsWith('*');
  text = text.replace(/\*+/g, '').trim();
  if (!text) return '';

  if (isPali) {
    text = convertAnyToRoman(text).replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'Ṃ');
  }
  text = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\u200C\u200D\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 2) return '';

  const words = text.split(' ').filter((w) => w.length >= 2 && !FTS_RESERVED_WORDS.has(w));
  if (words.length === 0) return '';

  if (words.length > 1) {
    // Phrase query — quote entire phrase cleanly
    return `"${words.join(' ').replace(/"/g, '""')}"`;
  }
  const single = words[0].replace(/"/g, '""');
  if (allowPrefix && (hadStar || single.length >= 3)) {
    return `"${single}"*`;
  }
  return `"${single}"`;
}

function buildConceptGroupFtsClause(group, { mode = 'pali' } = {}) {
  if (!group) return '';
  const rawList = [];
  if (mode === 'pali') {
    if (Array.isArray(group.pali_stems)) rawList.push(...group.pali_stems);
    if (Array.isArray(group.pali_terms)) {
      for (const t of group.pali_terms) {
        rawList.push(t);
        const words = String(t || '').trim().split(/\s+/);
        if (words.length === 1) {
          const st = paliStem(words[0].toLowerCase().replace(/ṁ/g, 'ṃ'));
          if (st && st.length >= 3 && st !== words[0].toLowerCase()) {
            rawList.push(`${st}*`);
          }
        }
      }
    }
  } else if (mode === 'en') {
    if (Array.isArray(group.english_keywords)) rawList.push(...group.english_keywords);
    // Single-word Pāḷi loanwords that frequently appear in English translations (e.g. dhamma, nibbāna, jhāna, kamma)
    if (Array.isArray(group.pali_terms)) {
      for (const t of group.pali_terms.slice(0, 3)) {
        const clean = String(t || '').trim();
        if (clean && !/\s/.test(clean)) rawList.push(clean);
      }
    }
  } else {
    // Non-English translation FTS DB: only search using actual local-language keywords
    // (never wastefully send English keywords against a Vietnamese/Burmese/Thai FTS index)
    if (Array.isArray(group.local_keywords)) rawList.push(...group.local_keywords);
  }

  const clauses = [];
  const seen = new Set();
  for (const item of rawList) {
    const ftsExpr = sanitizeFtsTerm(item, { isPali: mode === 'pali', allowPrefix: true });
    if (ftsExpr && !seen.has(ftsExpr)) {
      seen.add(ftsExpr);
      clauses.push(ftsExpr);
      if (clauses.length >= 8) break;
    }
  }
  if (clauses.length === 0) return '';
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

function buildConceptIntersectionFtsQuery(conceptGroups, { mode = 'pali' } = {}) {
  const clauses = [];
  for (const g of conceptGroups || []) {
    const c = buildConceptGroupFtsClause(g, { mode });
    if (c) clauses.push(c);
  }
  if (clauses.length === 0) return '';
  return clauses.join(' AND ');
}

function formatFtsQuery(raw, { mode = 'or', isPali = false } = {}) {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw.trim().normalize('NFC');
  if (isPali) {
    clean = convertAnyToRoman(clean).replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'Ṃ');
  }
  clean = clean.toLowerCase();
  const tokens = clean
    .split(/[^\p{L}\p{N}\p{M}\u200C\u200D]+/u)
    .filter((w) => w.length >= 2 && !AI_STOP_WORDS.has(w) && !FTS_RESERVED_WORDS.has(w));

  if (tokens.length === 0) {
    const fallback = clean
      .split(/[^\p{L}\p{N}\p{M}\u200C\u200D]+/u)
      .filter((w) => w.length >= 2 && !FTS_RESERVED_WORDS.has(w));
    if (fallback.length === 0) return '';
    return fallback
      .slice(0, 6)
      .map((t) => (t.length >= 3 ? `"${t.replace(/"/g, '""')}"*` : `"${t.replace(/"/g, '""')}"`))
      .join(' OR ');
  }

  const uniqueTokens = Array.from(new Set(tokens)).slice(0, 6);
  const groups = uniqueTokens.map((t) => {
    const safe = t.replace(/"/g, '""');
    const variants = [safe.length >= 3 ? `"${safe}"*` : `"${safe}"`];
    const stem = paliStem(safe);
    if (stem && stem !== safe && stem.length >= 3) {
      variants.push(`"${stem}"*`);
    }
    return variants.length > 1 ? `(${variants.join(' OR ')})` : variants[0];
  });

  if (mode === 'and' && groups.length > 1) {
    return groups.join(' AND ');
  }
  return groups.join(' OR ');
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
        citation_url: buildCanonicalUrl(resolved.book_code, resolved.chapter_index, '', resolved.start_para),
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
              citation_url: buildCanonicalUrl(t.book_code, t.chapter_index || 0, t.para_num || '', t.para_index || 0),
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
              citation_url: buildCanonicalUrl(s.book_code, sFull?.chapter_index || 0, '', sFull?.para_index_start || 0),
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
          citation_url: buildCanonicalUrl(r.book_code, r.chapter_index || 0, r.para_num || '', r.para_index || 0),
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

  // Separate layer filters (mula/atthakatha/tika/anna) from pitaka/collection filters
  // so that specifying nikayas narrows Sutta without accidentally excluding Vinaya or Abhidhamma.
  const layerConds = [];
  const nonSuttaPitakaConds = [];
  const otherCatConds = [];
  const otherCatParams = [];
  let wantsSutta = false;

  for (const c of cats) {
    if (c === 'vinaya') {
      nonSuttaPitakaConds.push("(code LIKE 'vin%' OR LOWER(nikaya) LIKE '%vinaya%')");
    } else if (c === 'sutta') {
      wantsSutta = true;
    } else if (c === 'abhidhamma') {
      nonSuttaPitakaConds.push("(code LIKE 'abh%' OR LOWER(nikaya) LIKE '%abhidhamma%')");
    } else if (c === 'mula' || c === 'mūla') {
      layerConds.push("(category = 'mūla' OR code LIKE '%.mul')");
    } else if (c === 'atthakatha' || c === 'aṭṭhakathā' || c === 'commentary') {
      layerConds.push("(category = 'aṭṭhakathā' OR code LIKE '%.att')");
    } else if (c === 'tika' || c === 'ṭīkā' || c === 'subcommentary') {
      layerConds.push("(category = 'ṭīkā' OR code LIKE '%.tik')");
    } else if (c === 'anna' || c === 'añña') {
      layerConds.push("(category = 'añña' OR code LIKE '%.nrf')");
    } else {
      otherCatConds.push("(LOWER(category) = ? OR LOWER(nikaya) LIKE ? OR code LIKE ?)");
      otherCatParams.push(c, `%${c}%`, `%${c}%`);
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

  // Combine collection conditions with OR:
  // e.g. categories=['vinaya','sutta'] + nikayas=['mn'] => (vinaya OR (sutta AND mn))
  const collectionBranches = [];
  const collectionParams = [];
  if (nonSuttaPitakaConds.length > 0) {
    collectionBranches.push(...nonSuttaPitakaConds);
  }
  if (nikConds.length > 0) {
    collectionBranches.push(`(${nikConds.join(' OR ')})`);
    collectionParams.push(...nikParams);
  } else if (wantsSutta) {
    collectionBranches.push("(code LIKE 's0%' OR LOWER(nikaya) LIKE '%sutta%' OR LOWER(nikaya) LIKE '%nikāy%')");
  }
  if (otherCatConds.length > 0) {
    collectionBranches.push(...otherCatConds);
    collectionParams.push(...otherCatParams);
  }

  const overallConds = [];
  const overallParams = [];
  if (collectionBranches.length > 0) {
    overallConds.push(`(${collectionBranches.join(' OR ')})`);
    overallParams.push(...collectionParams);
  }
  if (layerConds.length > 0) {
    overallConds.push(`(${layerConds.join(' OR ')})`);
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

function buildCanonicalUrl(bookCode, chapterIndex = 0, paraNum = '', paraIndex = 0) {
  const chapNum = (Number.isFinite(Number(chapterIndex)) ? Number(chapterIndex) : 0) + 1;
  const anchor = paraNum ? `#para-${paraNum}` : `#pindex-${paraIndex || 0}`;
  return `https://tipitakapali.org/book/${bookCode}/${chapNum}${anchor}`;
}

function queryFtsDbRows(ftsDb, ftsExpr, fetchLimit, allowedBooks = null) {
  if (!ftsDb || !ftsExpr) return [];
  try {
    const stmt = ftsDb.prepare(`
      SELECT book_code, book_title, nikaya, para_num, para_index,
             snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 25) AS snippet,
             content,
             rank
      FROM paragraphs_fts
      WHERE paragraphs_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const rows = stmt.all(ftsExpr, fetchLimit);
    return allowedBooks ? rows.filter((r) => allowedBooks.has(r.book_code)) : rows;
  } catch (err) {
    return [];
  }
}

function hydrateFtsHit(h, sourceType) {
  let chapIdx = 0;
  let chapTitle = '';
  let suttaTitle = '';
  if (dbTipitaka) {
    try {
      const cRow = dbTipitaka.prepare(
        'SELECT chapter_index, chapter_title, sutta_title FROM canon_paragraphs WHERE book_code = ? AND para_index = ?'
      ).get(h.book_code, h.para_index);
      if (cRow) {
        chapIdx = cRow.chapter_index;
        chapTitle = cRow.chapter_title || '';
        suttaTitle = cRow.sutta_title || '';
      }
    } catch (e) {}
  }
  return {
    book_code: h.book_code,
    book_title: h.book_title,
    nikaya: h.nikaya,
    chapter_index: chapIdx,
    chapter_title: chapTitle,
    sutta_title: suttaTitle,
    para_index: h.para_index,
    para_num: h.para_num,
    snippet: h.snippet,
    text: h.content ? h.content.substring(0, 360) : '',
    citation_ref: `[${h.book_code}:c${chapIdx}:p${h.para_index}]`,
    citation_url: buildCanonicalUrl(h.book_code, chapIdx, h.para_num, h.para_index),
    source_type: sourceType,
    _rank: typeof h.rank === 'number' ? h.rank : 0,
  };
}

function scoreCanonicalLayer(bookCode) {
  const code = String(bookCode || '').toLowerCase();
  if (code.includes('.mul')) {
    if (code.startsWith('s0')) return 5;
    if (code.startsWith('vin')) return 4;
    if (code.startsWith('abh')) return 4;
    return 3;
  }
  if (code.includes('.att')) return 2;
  if (code.includes('.tik')) return 1;
  return 0;
}

function computeConceptCoverage(text, conceptGroups, mode = 'pali') {
  const hay = String(text || '').toLowerCase().replace(/ṁ/g, 'ṃ');
  if (!hay || !Array.isArray(conceptGroups) || conceptGroups.length === 0) {
    return { matched_concepts: [], coverage: 0 };
  }
  const matched = [];
  for (const g of conceptGroups) {
    const probes = [];
    if (mode === 'pali') {
      for (const s of g.pali_stems || []) probes.push(String(s).replace(/\*+$/g, '').toLowerCase().replace(/ṁ/g, 'ṃ'));
      for (const t of g.pali_terms || []) probes.push(String(t).toLowerCase().replace(/ṁ/g, 'ṃ'));
    } else {
      for (const e of g.english_keywords || []) probes.push(String(e).toLowerCase());
      for (const t of g.pali_terms || []) probes.push(String(t).toLowerCase());
      for (const l of g.local_keywords || []) probes.push(String(l).toLowerCase());
    }
    const cleanProbes = probes.filter((p) => p.length >= 3);
    if (cleanProbes.some((p) => hay.includes(p))) {
      matched.push(g.concept);
    }
  }
  return {
    matched_concepts: matched,
    coverage: conceptGroups.length > 0 ? matched.length / conceptGroups.length : 0,
  };
}

function aiSearchConcepts({ concept_groups = [], categories = [], nikayas = [], langs = ['en'], limit = 15 }) {
  if (!dbFts && !dbTipitaka) return { success: false, results: [], error: 'Database unavailable' };
  const groups = normalizeConceptGroups(concept_groups);
  if (groups.length === 0) return { success: true, count: 0, concept_groups: [], results: [] };

  const activeLimit = Math.min(Math.max(1, Number(limit) || 15), 35);
  const allowedBooks = resolveAllowedBooksForCategory({ categories, nikayas });
  const targetLangs = Array.from(new Set(
    (Array.isArray(langs) ? langs : String(langs || 'en').split(','))
      .map((l) => String(l || '').trim().toLowerCase())
      .filter((l) => l && l !== 'pali' && l !== 'pi')
  ));
  if (!targetLangs.includes('en')) targetLangs.unshift('en');

  const hitMap = new Map();
  const executedQueries = [];

  const absorbHits = (rows, sourceType, mode, tierBonus) => {
    for (const h of rows) {
      const key = `${h.book_code}:${h.para_index}`;
      const cov = computeConceptCoverage(`${h.content || ''} ${h.snippet || ''}`, groups, mode);
      const existing = hitMap.get(key);
      if (existing) {
        // Merge matched concepts across Pāḷi and translation hits
        const mergedConcepts = Array.from(new Set([...(existing.matched_concepts || []), ...cov.matched_concepts]));
        existing.matched_concepts = mergedConcepts;
        existing.concept_coverage = groups.length > 0 ? mergedConcepts.length / groups.length : existing.concept_coverage;
        existing._tierBonus = Math.max(existing._tierBonus, tierBonus);
        if (sourceType === 'pali' && existing.source_type !== 'pali') {
          existing.pali_snippet = h.snippet;
        }
        continue;
      }
      const hydrated = hydrateFtsHit(h, sourceType);
      hydrated.matched_concepts = cov.matched_concepts;
      hydrated.concept_coverage = cov.coverage;
      hydrated._tierBonus = tierBonus;
      hitMap.set(key, hydrated);
    }
  };

  // Build candidate query plans: Tier 1 = ALL groups AND, Tier 2 = pairs AND, Tier 3 = single group
  const runTierForDb = (ftsDb, sourceType, mode, bookFilter) => {
    if (!ftsDb) return;
    const validGroups = groups
      .map((g) => ({ group: g, clause: buildConceptGroupFtsClause(g, { mode }) }))
      .filter((x) => Boolean(x.clause));
    if (validGroups.length === 0) return;

    let dbHits = 0;

    // Tier 1: Strict intersection across ALL valid concept groups
    const fullQuery = validGroups.map((x) => x.clause).join(' AND ');
    executedQueries.push({ source: sourceType, tier: 'all_concepts', fts: fullQuery });
    const t1Rows = queryFtsDbRows(ftsDb, fullQuery, activeLimit * 4, bookFilter);
    dbHits += t1Rows.length;
    absorbHits(t1Rows, sourceType, mode, 3);

    // Tier 2: Pairwise intersections if >= 3 groups and Tier 1 returned sparse results in this DB
    if (validGroups.length >= 3 && dbHits < activeLimit) {
      for (let i = 0; i < validGroups.length && i < 3; i++) {
        for (let j = i + 1; j < validGroups.length && j < 4; j++) {
          const pairQuery = `${validGroups[i].clause} AND ${validGroups[j].clause}`;
          executedQueries.push({ source: sourceType, tier: 'pair_concepts', fts: pairQuery });
          const pairRows = queryFtsDbRows(ftsDb, pairQuery, activeLimit * 2, bookFilter);
          dbHits += pairRows.length;
          absorbHits(pairRows, sourceType, mode, 2);
        }
      }
    }

    // Tier 3: Per-group single-concept fallback if intersection still sparse in this DB
    if (dbHits < Math.min(activeLimit, 4)) {
      const perGroupFetch = Math.max(6, Math.ceil((activeLimit * 2) / validGroups.length));
      for (const vg of validGroups) {
        executedQueries.push({ source: sourceType, tier: 'single_concept', fts: vg.clause });
        const sRows = queryFtsDbRows(ftsDb, vg.clause, perGroupFetch, bookFilter);
        dbHits += sRows.length;
        absorbHits(sRows, sourceType, mode, 1);
      }
    }
  };

  const executeAcrossDbs = (bookFilter) => {
    // 1. Search Pāḷi Canon FTS5
    runTierForDb(dbFts || dbTipitaka, 'pali', 'pali', bookFilter);

    // 2. Search English & User Translation FTS5 databases
    for (const lang of targetLangs.slice(0, 2)) {
      const tFts = getTranslationFtsDb(lang);
      if (tFts) {
        runTierForDb(tFts, `translation_${lang}`, lang === 'en' ? 'en' : 'local', bookFilter);
      }
    }
  };

  executeAcrossDbs(allowedBooks);

  // If an explicit scope filter produced 0 hits, auto-relax to whole canon so research never dead-ends
  if (allowedBooks && hitMap.size === 0) {
    executeAcrossDbs(null);
  }

  // Rank by: (1) tierBonus & matched concepts count, (2) Mūla canonical priority, (3) FTS5 rank
  const ranked = Array.from(hitMap.values()).sort((a, b) => {
    const covDiff = (b.matched_concepts?.length || 0) - (a.matched_concepts?.length || 0);
    if (covDiff !== 0) return covDiff;
    const tierDiff = (b._tierBonus || 0) - (a._tierBonus || 0);
    if (tierDiff !== 0) return tierDiff;
    const layerDiff = scoreCanonicalLayer(b.book_code) - scoreCanonicalLayer(a.book_code);
    if (layerDiff !== 0) return layerDiff;
    return (a._rank || 0) - (b._rank || 0);
  });

  const cleanResults = ranked.slice(0, activeLimit).map(({ _rank, _tierBonus, ...rest }) => rest);

  return {
    success: true,
    count: cleanResults.length,
    concept_groups: groups,
    queries_executed: executedQueries.slice(0, 8),
    results: cleanResults,
  };
}

function aiSearchTipitaka({ query, limit = 20, categories = [], nikayas = [], langs = ['en', 'vi'] }) {
  if (!dbFts && !dbTipitaka) return { success: false, results: [], error: 'Database unavailable' };
  const ftsPaliAnd = formatFtsQuery(query, { mode: 'and', isPali: true });
  const ftsPaliOr = formatFtsQuery(query, { mode: 'or', isPali: true });
  const ftsTransAnd = formatFtsQuery(query, { mode: 'and', isPali: false });
  const ftsTransOr = formatFtsQuery(query, { mode: 'or', isPali: false });
  if (!ftsPaliOr && !ftsTransOr) return { success: true, count: 0, results: [] };

  const activeLimit = Math.min(Math.max(1, limit), 50);
  const results = [];
  const seenKeys = new Set();

  const allowedBooks = resolveAllowedBooksForCategory({ categories, nikayas });

  const pushHits = (hits, sourceType) => {
    hits.sort((a, b) => scoreCanonicalLayer(b.book_code) - scoreCanonicalLayer(a.book_code));
    for (const h of hits) {
      const key = `${h.book_code}:${h.para_index}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const { _rank, ...hydrated } = hydrateFtsHit(h, sourceType);
      results.push(hydrated);
      if (results.length >= activeLimit) break;
    }
  };

  // 1. Search Pāḷi Canon FTS (try strict AND first, relax to OR if sparse)
  try {
    const ftsDb = dbFts || dbTipitaka;
    let paliHits = [];
    if (ftsPaliAnd) {
      paliHits = queryFtsDbRows(ftsDb, ftsPaliAnd, activeLimit * 3, allowedBooks);
    }
    if (paliHits.length < 3 && ftsPaliOr && ftsPaliOr !== ftsPaliAnd) {
      const orHits = queryFtsDbRows(ftsDb, ftsPaliOr, activeLimit * 3, allowedBooks);
      const seenP = new Set(paliHits.map((h) => `${h.book_code}:${h.para_index}`));
      for (const oh of orHits) {
        const k = `${oh.book_code}:${oh.para_index}`;
        if (!seenP.has(k)) {
          seenP.add(k);
          paliHits.push(oh);
        }
      }
    }
    pushHits(paliHits, 'pali');
  } catch (err) {
    console.warn('[AI Search] Pāli FTS query error:', err.message);
  }

  // 2. Search requested translation FTS databases (English + user language)
  const detectedLang = detectLanguage(query);
  const targetLangs = Array.from(new Set([
    ...(Array.isArray(langs) ? langs : ['en']),
    ...(detectedLang && detectedLang !== 'pi' ? [detectedLang] : []),
  ])).filter((l) => l && l !== 'pali' && l !== 'pi');

  for (const lang of targetLangs) {
    if (results.length >= activeLimit) break;
    const tDb = getTranslationFtsDb(lang);
    if (!tDb) continue;
    let tHits = [];
    if (ftsTransAnd) {
      tHits = queryFtsDbRows(tDb, ftsTransAnd, activeLimit * 2, allowedBooks);
    }
    if (tHits.length < 3 && ftsTransOr && ftsTransOr !== ftsTransAnd) {
      const orHits = queryFtsDbRows(tDb, ftsTransOr, activeLimit * 2, allowedBooks);
      const seenT = new Set(tHits.map((h) => `${h.book_code}:${h.para_index}`));
      for (const oh of orHits) {
        const k = `${oh.book_code}:${oh.para_index}`;
        if (!seenT.has(k)) {
          seenT.add(k);
          tHits.push(oh);
        }
      }
    }
    pushHits(tHits, `translation_${lang}`);
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

function aiGetSentences({ book_code, chapter_index, para_index, para_num, line_id, langs = ['en'] }) {
  if (!dbTipitaka) return { success: false, error: 'Database unavailable' };
  const targetCode = resolveCanonicalBookCode(book_code);
  let cIdx = chapter_index !== undefined && chapter_index !== null ? parseInt(chapter_index, 10) : null;
  let pIdx = para_index !== undefined && para_index !== null ? parseInt(para_index, 10) : null;
  const pNum = para_num !== undefined && para_num !== null ? String(para_num).replace(/^(?:para-?|p)/i, '').trim() : null;

  // Resolve para_index from printed VRI para_num if needed
  if (pIdx === null && pNum && dbTipitaka) {
    try {
      const row = dbTipitaka.prepare('SELECT chapter_index, para_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? LIMIT 1').get(targetCode, pNum);
      if (row) {
        pIdx = row.para_index;
        cIdx = row.chapter_index;
      }
    } catch {}
  } else if (pIdx !== null && dbTipitaka) {
    // Para index is unique per book; always verify and correct chapter index against canon_paragraphs
    try {
      const row = dbTipitaka.prepare('SELECT chapter_index FROM canon_paragraphs WHERE book_code = ? AND para_index = ? LIMIT 1').get(targetCode, pIdx);
      if (row && row.chapter_index !== undefined) {
        cIdx = row.chapter_index;
      }
    } catch {}
  }
  if (cIdx === null) cIdx = 0;
  const lid = line_id !== undefined && line_id !== null ? parseInt(line_id, 10) : null;
  const tLangs = Array.isArray(langs) ? langs : String(langs).split(',').map((s) => s.trim()).filter(Boolean);
  const paliDbPath = (resolveDbPathFn || ((f) => path.join(__dirname, 'db', f)))('pali_sentences.db');
  let paliSents = [];
  let pdb = null;
  if (paliDbPath) {
    try {
      pdb = new (require('better-sqlite3'))(paliDbPath, { readonly: true });
    } catch (_) {}
  }
  try {
    const chapSentMap = readChapterSentences(dbTipitaka, pdb, targetCode, cIdx);
    if (chapSentMap && chapSentMap.size > 0) {
      if (pIdx !== null && lid !== null) {
        paliSents = (chapSentMap.get(pIdx) || []).filter((s) => s.lineId === lid).map((s) => ({ line_id: s.lineId, sentence: s.text }));
      } else if (pIdx !== null) {
        paliSents = (chapSentMap.get(pIdx) || []).map((s) => ({ line_id: s.lineId, sentence: s.text }));
      } else {
        const pKeys = Array.from(chapSentMap.keys()).sort((a, b) => a - b);
        for (const pk of pKeys) {
          for (const s of chapSentMap.get(pk)) {
            paliSents.push({ line_id: s.lineId, sentence: s.text, para_index: pk });
            if (paliSents.length >= 40) break;
          }
          if (paliSents.length >= 40) break;
        }
      }
    }
  } finally {
    try { pdb?.close(); } catch (_) {}
  }
  // Fallback: derive sentences from canon_paragraphs / chapter_text_pack when sentences absent.
  if (paliSents.length === 0 && pIdx !== null) {
    try {
      const row = dbTipitaka.prepare('SELECT pali_text FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(targetCode, cIdx, pIdx);
      const pt = row?.pali_text || readChapterPack(dbTipitaka, targetCode, cIdx).paliMap.get(pIdx);
      if (pt) paliSents = [{ line_id: lid || 1, sentence: pt, para_index: pIdx }];
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

    // Fallback: if sentence translations are sparse/missing, pull from paragraph_translations
    if ((!translations[lang] || translations[lang].length === 0) && pIdx !== null) {
      try {
        const ptr = tdb.prepare('SELECT translation FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(targetCode, cIdx, pIdx);
        if (ptr && ptr.translation) {
          translations[lang] = [{ line_id: lid || 1, translation: ptr.translation }];
        }
      } catch {}
    }
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

    hydrateCanonRows(dbTipitaka, pRows, targetCode);

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
        citation_url: buildCanonicalUrl(p.book_code, p.chapter_index, p.para_num, p.para_index),
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

      // Hydrate pali_text when using optimized tipitaka.db and filter out headings
      hydrateCanonRows(dbTipitaka, rows, atthaBook);
      rows = rows.filter((r) => r.pali_text && !r.pali_text.startsWith('Namo tassa') && !r.pali_text.endsWith('nikāye') && !r.pali_text.endsWith('nikāyo'));

      if (rows.length > 0) {
        const enDb = getTranslationDb('en');
        atthaEntries = rows.map((r) => {
          let enTrans = null;
          if (enDb) {
            try {
              const tRow = enDb.prepare('SELECT translation FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(r.book_code, r.chapter_index, r.para_index);
              if (tRow?.translation) enTrans = tRow.translation.substring(0, 500);
            } catch (_) {}
          }
          return {
            book_code: r.book_code,
            book_title: atthaBookInfo?.title || r.book_code,
            chapter_index: r.chapter_index,
            chapter_title: r.chapter_title,
            para_index: r.para_index,
            para_num: r.para_num,
            pali_text: r.pali_text ? r.pali_text.substring(0, 600) : '',
            ...(enTrans ? { translation_en: enTrans } : {}),
            citation_ref: `[${r.book_code}:c${r.chapter_index}:p${r.para_index}]`,
            citation_url: buildCanonicalUrl(r.book_code, r.chapter_index, r.para_num, r.para_index),
          };
        });
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

      hydrateCanonRows(dbTipitaka, rows, tikaBook);
      rows = rows.filter((r) => r.pali_text && !r.pali_text.startsWith('Namo tassa') && !r.pali_text.endsWith('nikāye') && !r.pali_text.endsWith('nikāyo'));

      if (rows.length > 0) {
        const enDb = getTranslationDb('en');
        tikaEntries = rows.map((r) => {
          let enTrans = null;
          if (enDb) {
            try {
              const tRow = enDb.prepare('SELECT translation FROM paragraph_translations WHERE book_code = ? AND chapter_index = ? AND para_index = ?').get(r.book_code, r.chapter_index, r.para_index);
              if (tRow?.translation) enTrans = tRow.translation.substring(0, 500);
            } catch (_) {}
          }
          return {
            book_code: r.book_code,
            book_title: tikaBookInfo?.title || r.book_code,
            chapter_index: r.chapter_index,
            chapter_title: r.chapter_title,
            para_index: r.para_index,
            para_num: r.para_num,
            pali_text: r.pali_text ? r.pali_text.substring(0, 600) : '',
            ...(enTrans ? { translation_en: enTrans } : {}),
            citation_ref: `[${r.book_code}:c${r.chapter_index}:p${r.para_index}]`,
            citation_url: buildCanonicalUrl(r.book_code, r.chapter_index, r.para_num, r.para_index),
          };
        });
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

function stripBoldHtmlToMarkdown(html) {
  if (!html) return '';
  return String(html)
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreBoldDefinitionEntry(item, cleanedQuery) {
  let score = 0;
  const wordLower = String(item.word || '').toLowerCase();
  if (wordLower === cleanedQuery) score += 30;
  else if (wordLower.startsWith(cleanedQuery)) score += 12;

  const sentPlain = String(item.sentence_html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  // Classic Theravāda commentarial definition markers
  if (/(?:ti\s+attho|nāma|vuccati|atthato|lakkhaṇaṃ|rasā|paccupaṭṭhān|padaṭṭhān)/i.test(sentPlain)) {
    score += 18;
  }
  if (item.category === 'aṭṭhakathā') score += 10;
  else if (item.category === 'ṭīkā') score += 7;
  else if (item.category === 'mūla') score += 6;
  else if (String(item.book_code || '').startsWith('e01') || String(item.book_code || '').startsWith('abh07')) score += 9; // Visuddhimagga / Abhidhammatthasaṅgaha

  if (item.translations && Object.keys(item.translations).length > 0) score += 4;
  return score;
}

function aiGetBoldDefinitions({ word, term, w, langs = ['en'], limit = 8 } = {}) {
  const cleanWord = String(word || term || w || '').trim();
  if (!cleanWord) return { success: false, error: 'Empty word' };

  const engine = getBoldLinkedEngine();
  if (!engine) {
    return { success: false, word: cleanWord, count: 0, definitions: [], error: 'Bold definitions database unavailable' };
  }

  const targetLangs = Array.from(new Set(
    (Array.isArray(langs) ? langs : String(langs || 'en').split(','))
      .map((l) => String(l || '').trim().toLowerCase())
      .filter((l) => l && l !== 'pali' && l !== 'pi')
  ));
  if (targetLangs.length === 0) targetLangs.push('en');

  const activeLimit = Math.min(Math.max(1, Number(limit) || 8), 20);

  try {
    const raw = engine.lookupBoldDef(cleanWord, targetLangs);
    const cleanedLower = String(raw.word || cleanWord).toLowerCase();
    const ranked = (raw.results || [])
      .map((r) => ({ r, _score: scoreBoldDefinitionEntry(r, cleanedLower) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, activeLimit);

    const definitions = ranked.map(({ r }) => {
      const sentenceMd = stripBoldHtmlToMarkdown(r.sentence_html);
      const beforeMd = r.before_html ? stripBoldHtmlToMarkdown(r.before_html) : '';
      const afterMd = r.after_html ? stripBoldHtmlToMarkdown(r.after_html) : '';
      const lineId = r.line_id || 1;
      return {
        word: r.word,
        book_code: r.book_code,
        book_title: r.book_title,
        category: r.category,
        chapter_index: r.chapter_index,
        para_index: r.para_index,
        para_num: r.para_num || '',
        line_id: lineId,
        citation_ref: `[${r.book_code}:c${r.chapter_index}:p${r.para_index}-L${lineId}]`,
        citation_url: buildCanonicalUrl(r.book_code, r.chapter_index, r.para_num, r.para_index),
        pali_definition: sentenceMd,
        ...(beforeMd ? { context_before: beforeMd } : {}),
        ...(afterMd ? { context_after: afterMd } : {}),
        translations: r.translations || {},
        ...(r.mat ? { mat: r.mat } : {}),
      };
    });

    return {
      success: true,
      word: raw.word || cleanWord,
      search_prefix: raw.search_prefix || '',
      count: definitions.length,
      definitions,
    };
  } catch (err) {
    return { success: false, word: cleanWord, count: 0, definitions: [], error: err.message };
  }
}

function aiGetBoldDefinitionsBatch({ words, terms, langs = ['en'], limit = 4, limit_per_term } = {}) {
  const rawList = words !== undefined ? words : (terms !== undefined ? terms : []);
  const list = (Array.isArray(rawList) ? rawList : [rawList]).map((w) => String(w || '').trim()).filter(Boolean);
  const perWordLimit = Math.min(Math.max(1, Number(limit_per_term || limit) || 4), 8);
  const definitions = [];
  const seen = new Set();

  for (const w of list.slice(0, 5)) {
    const res = aiGetBoldDefinitions({ word: w, langs, limit: perWordLimit });
    if (res.success && Array.isArray(res.definitions)) {
      for (const d of res.definitions) {
        const key = `${d.book_code}:${d.chapter_index}:${d.para_index}:${d.line_id}:${d.word}`;
        if (!seen.has(key)) {
          seen.add(key);
          definitions.push(d);
        }
      }
    }
  }
  return { success: true, count: definitions.length, definitions };
}

function aiGetDictionary({ word }) {
  if (!word || typeof word !== 'string') return { success: false, error: 'Empty word' };
  const trimmed = word.trim();
  try {
    let dpdResult = dictEngine.lookupDPDFast(trimmed, false);
    if (!dpdResult || !Array.isArray(dpdResult.dpd) || dpdResult.dpd.length === 0) {
      // Retry with DPD compound/sandhi splitter for long compounds
      dpdResult = dictEngine.lookupDPDFast(trimmed, true);
    }
    const cleanEntries = [];
    if (dpdResult && Array.isArray(dpdResult.dpd)) {
      for (const item of dpdResult.dpd.slice(0, 5)) {
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
    return { success: true, word: trimmed, count: cleanEntries.length, entries: cleanEntries };
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
    case 'search_concepts':
      return aiSearchConcepts({
        concept_groups: args.concept_groups || args.groups || [],
        categories: args.categories || (args.category ? [args.category] : []),
        nikayas: args.nikayas || (args.nikaya ? [args.nikaya] : []),
        langs: args.langs || ['en'],
        limit: args.limit || 15,
      });
    case 'get_bold_definitions':
      return aiGetBoldDefinitions({
        word: args.word || args.w || args.query,
        langs: args.langs || ['en'],
        limit: args.limit || 8,
      });
    case 'get_bold_definitions_batch': {
      const words = Array.isArray(args.words)
        ? args.words
        : Array.isArray(args.terms)
        ? args.terms
        : (args.word ? [args.word] : []);
      return aiGetBoldDefinitionsBatch({
        words,
        langs: args.langs || ['en'],
        limit: args.limit || 4,
      });
    }
    case 'search_sections':
      return aiSearchSections({ query: args.query, limit: 15 });
    case 'search_tipitaka':
      return aiSearchTipitaka({ query: args.query, limit: 15, langs: args.langs || ['en', 'vi'] });
    case 'search_tipitaka_batch': {
      const queries = Array.isArray(args.queries) ? args.queries : (args.query ? [args.query] : []);
      const combined = [];
      const seen = new Set();
      for (const q of queries.slice(0, 5)) {
        const res = aiSearchTipitaka({ query: q, limit: 10, langs: args.langs || ['en', 'vi'] });
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
        const res = aiSearchTipitaka({ query: q, limit: 15, categories, nikayas, langs: args.langs || ['en', 'vi'] });
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
        langs: args.langs || ['en', 'vi'],
      });
    }
    case 'get_paragraph_content_batch': {
      const ranges = Array.isArray(args.ranges)
        ? args.ranges
        : Array.isArray(args.requests)
        ? args.requests
        : [];
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
          langs: r.langs || args.langs || ['en', 'vi'],
        });
        if (res.success && Array.isArray(res.passages)) {
          allPassages.push(...res.passages);
        }
      }
      return { success: true, count: allPassages.length, passages: allPassages };
    }
    case 'get_sentences':
      return aiGetSentences({
        book_code: args.book_code || args.book,
        chapter_index: args.chapter_index ?? args.chapter,
        para_index: args.para_index ?? args.para_start ?? args.para ?? args.paragraph,
        para_num: args.para_num ?? args.para_number,
        line_id: args.line_id ?? args.line ?? args.sentence_id,
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

function isLikelyCanonicalBookCode(rawBook, resolvedCode, hasExplicitChap) {
  if (!rawBook) return false;
  const raw = String(rawBook).trim();
  const low = raw.toLowerCase();
  if (/^\d+$/.test(low)) return false;
  if (/\.(?:mul|att|tik|nrf)$/i.test(resolvedCode || '') || /\.(?:mul|att|tik|nrf)$/i.test(raw)) return true;
  if (bookCodeMap.has(raw) || bookCodeMap.has(low.replace(/[\s_-]+/g, ''))) return true;
  if (/^(?:dn|mn|sn|an|vin|abh|khp|dhp|ud|it|iti|snp|vv|pv|thag|thig|ja|jat|vism|mil)\d*(?:\.\d+)?$/i.test(low)) return true;
  if (/^[dmsa]-(?:i|ii|iii|iv|v)$/i.test(low)) return true;
  if (hasExplicitChap && /^(?:s0|vin|abh|e0)[a-z0-9_.-]+$/i.test(raw)) return true;
  return false;
}

function parseCitations(text) {
  if (!text) return [];
  // Supports [book:c{chap}:p{para}], [book:c{chap}:p{start}-{end}], [book:c{chap}:p{start}-p{end}], [book:{para}], [book:c{chap}:p{para}:L{line}] and [book:c{chap}:p{para}-L{line}]
  const regex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–](?:([Ll])|[Pp])?(\d+))?(?::[Ll]?(\d+))?\]/g;
  const seen = new Set();
  const citations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[0];
    const rawBook = match[1];
    const bookCode = resolveCanonicalBookCode(rawBook);
    const hasExplicitChap = match[2] !== undefined;
    if (!isLikelyCanonicalBookCode(rawBook, bookCode, hasExplicitChap)) continue;
    let chapIdx = hasExplicitChap ? parseInt(match[2], 10) : 0;
    let paraIdx = parseInt(match[3], 10);
    const isDashLine = Boolean(match[4]);
    let paraEnd = !isDashLine && match[5] ? parseInt(match[5], 10) : null;
    let lineId = isDashLine && match[5] ? parseInt(match[5], 10) : (match[6] ? parseInt(match[6], 10) : null);

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

    const key = `${bookCode}:${chapIdx}:${paraIdx}${paraEnd ? `-${paraEnd}` : ''}${lineId ? `:L${lineId}` : ''}`;
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
    case 'search_concepts':
      return {
        count: result.results?.length || 0,
        concept_groups: (result.concept_groups || []).map((g) => g.concept),
        passages: (result.results || []).slice(0, 10).map((p) => ({
          book_code: p.book_code,
          book_title: p.book_title,
          chapter_index: p.chapter_index,
          chapter_title: p.chapter_title,
          sutta_title: p.sutta_title,
          para_index: p.para_index,
          para_num: p.para_num,
          matched_concepts: p.matched_concepts || [],
          citation: p.citation_ref,
          snippet: (p.snippet || p.text || '').slice(0, 260),
        })),
      };
    case 'get_bold_definitions':
    case 'get_bold_definitions_batch':
      return {
        count: result.definitions?.length || 0,
        definitions: (result.definitions || []).slice(0, 6).map((d) => ({
          word: d.word,
          book_title: d.book_title,
          category: d.category,
          citation: d.citation_ref,
          pali_definition: (d.pali_definition || '').slice(0, 380),
          translations: Object.fromEntries(
            Object.entries(d.translations || {}).slice(0, 2).map(([k, v]) => [k, String(v || '').slice(0, 320)])
          ),
        })),
      };
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

  // 3. Priority Direct Paragraph Fetch if default_sutta_para exists (including 0 for DN 1)
  if (understanding?.default_sutta_para !== null && understanding?.default_sutta_para !== undefined && understanding?.recommended_locations?.books?.[0]) {
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

  // 3b. Canonical Bold Definitions for key terms
  if (understanding?.key_terms_for_bold_def?.length > 0) {
    const bRes = aiGetBoldDefinitionsBatch({
      words: understanding.key_terms_for_bold_def.slice(0, 3),
      langs: targetLangs,
      limit: 3,
    });
    if (bRes.success && bRes.definitions?.length > 0) {
      collectedEvidence.boldDefinitions = collectedEvidence.boldDefinitions || [];
      collectedEvidence.boldDefinitions.push(...bRes.definitions);
      const log = {
        tool: 'get_bold_definitions_batch',
        summary: `Retrieved ${bRes.definitions.length} canonical bold definitions`,
        args: { words: understanding.key_terms_for_bold_def.slice(0, 3) },
      };
      toolLogs.push(log);
      onEvent('tool_call', log);
    }
  }

  // 4. Retrieve canonical root passages via Concept-Group Search + FTS fallback if more passages needed
  if (collectedEvidence.passages.length < 3) {
    onEvent('status', { message: '🔍 Retrieving canonical root passages (Pāḷi + translations)…' });
    if (understanding?.concept_groups?.length > 0) {
      const cRes = aiSearchConcepts({
        concept_groups: understanding.concept_groups,
        categories: understanding?.recommended_locations?.categories || understanding?.recommended_locations?.pitakas || [],
        nikayas: understanding?.recommended_locations?.nikayas || [],
        langs: targetLangs,
        limit: 6,
      });
      if (cRes.results?.length > 0) {
        for (const p of cRes.results) {
          const k = `${p.book_code}:${p.para_index}`;
          if (!collectedEvidence.passages.some((ep) => `${ep.book_code}:${ep.para_index}` === k)) {
            const fullP = aiGetParagraphContent({
              book_code: p.book_code,
              chapter_index: p.chapter_index,
              para_start: p.para_index,
              para_end: p.para_index,
              langs: targetLangs,
            });
            collectedEvidence.passages.push(fullP.passages?.[0] || p);
          }
        }
        const log = {
          tool: 'search_concepts',
          summary: `Retrieved ${cRes.results.length} concept-group passages with citations`,
          args: { concept_groups: understanding.concept_groups },
        };
        toolLogs.push(log);
        onEvent('tool_call', log);
      }
    }
  }

  if (collectedEvidence.passages.length < 3) {
    const tipQueries = [
      ...(understanding?.pali_stems || []).slice(0, 2),
      userQuery,
    ];
    for (const q of tipQueries) {
      const tipRes = aiSearchTipitaka({
        query: q,
        limit: 6,
        categories: understanding?.recommended_locations?.categories || understanding?.recommended_locations?.pitakas || [],
        nikayas: understanding?.recommended_locations?.nikayas || [],
        langs: targetLangs,
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
    const conceptSummary = Array.isArray(understanding.concept_groups) && understanding.concept_groups.length > 0
      ? understanding.concept_groups
          .map((g, i) => `  ${i + 1}. ${g.concept} — Pāḷi: [${(g.pali_terms || []).join(', ')}] | Stems: [${(g.pali_stems || []).join(', ')}] | English: [${(g.english_keywords || []).join(', ')}]`)
          .join('\n')
      : '  None';
    toolSystemPrompt += `\n\n## DECOMPOSED QUERY UNDERSTANDING & CONCEPT GROUPS (Step 1 Complete):
- User Intent: ${understanding.intent || 'doctrinal_explanation'}
- Main Concept Groups:\n${conceptSummary}
- Key Terms for Canonical Bold Definitions: ${(understanding.key_terms_for_bold_def || []).join(', ') || 'N/A'}
- Target Suttas: ${(understanding.target_sutta_names || []).join(', ') || 'None identified'}
- Primary Pāḷi Terms: ${(understanding.canonical_pali_terms || []).join(', ') || 'N/A'}
- Pāḷi Stems for Search: ${(understanding.pali_stems || []).join(', ') || 'N/A'}
- Recommended Canonical Locations: ${((understanding.recommended_locations?.nikayas) || []).join(', ')} (${((understanding.recommended_locations?.books) || []).join(', ')})
- Translation Languages: ${(understanding.translation_languages || ['en']).join(', ')}
- Targeted Execution Strategy:
${(understanding.initial_search_strategy || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

Execute this strategy systematically. Use search_concepts with the concept groups and get_bold_definitions for key terms, read exact paragraphs with get_paragraph_content_batch, cross-reference commentaries where helpful, and call final_answer when sufficient evidence is gathered.`;
  }

  const toolLogs = [];
  const allCollectedEvidence = {
    sections: [],
    passages: [],
    sentences: [],
    boldDefinitions: [],
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
      const payload = {
        system_instruction: { parts: [{ text: toolSystemPrompt }] },
        contents: conversation,
        tools: [{ functionDeclarations: kAiToolDeclarations }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      };

      let toolRes = null;
      const modelsToTry = [
        toolModel,
        ...['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].filter((m) => m !== toolModel),
      ];
      for (const mName of modelsToTry) {
        const geminiToolUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mName)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        try {
          const r = await fetch(geminiToolUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(45000),
          });
          toolRes = r;
          if (r.ok || (r.status !== 404 && r.status !== 429 && r.status !== 503 && r.status !== 500 && r.status !== 502 && r.status !== 504)) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (err) {
          console.warn(`[Gemini Tool Loop Round ${iterations} (${mName}) Error]:`, err.message);
        }
      }

      if (!toolRes || !toolRes.ok) {
        console.warn(`[Gemini Tool Loop Round ${iterations} HTTP ${toolRes?.status || 'ERR'}]`);
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
          if (
            (fc.name === 'get_paragraph_content' ||
              fc.name === 'get_paragraph_content_batch' ||
              fc.name === 'get_sentences' ||
              fc.name === 'get_bold_definitions' ||
              fc.name === 'get_bold_definitions_batch' ||
              fc.name === 'search_concepts' ||
              fc.name === 'search_tipitaka') &&
            !fc.args?.langs
          ) {
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
        } else if ((spec.name === 'search_concepts' || spec.name === 'search_tipitaka' || spec.name === 'search_tipitaka_batch' || spec.name === 'search_by_category') && resObj.results) {
          allCollectedEvidence.passages.push(...resObj.results);
        } else if ((spec.name === 'get_paragraph_content' || spec.name === 'get_paragraph_content_batch') && resObj.passages) {
          allCollectedEvidence.passages.push(...resObj.passages);
        } else if ((spec.name === 'get_bold_definitions' || spec.name === 'get_bold_definitions_batch') && resObj.definitions) {
          allCollectedEvidence.boldDefinitions.push(...resObj.definitions);
        } else if (spec.name === 'get_sentences' && resObj.pali_sentences) {
          allCollectedEvidence.sentences.push(resObj);
        } else if (spec.name === 'get_commentaries' && (resObj.atthakatha || resObj.tika)) {
          allCollectedEvidence.commentaries.push(resObj);
        } else if ((spec.name === 'get_dictionary' || spec.name === 'get_dictionary_batch') && resObj.entries) {
          allCollectedEvidence.dictionaries.push(...resObj.entries);
        }

        const summaryArg = spec.args?.query || spec.args?.queries?.[0] || (Array.isArray(spec.args?.concept_groups) ? spec.args.concept_groups.map((g) => g.concept || g).join(' + ') : '') || spec.args?.word || spec.args?.words?.[0] || spec.args?.book_code || '';
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
        if (
          (fnName === 'get_paragraph_content' ||
            fnName === 'get_paragraph_content_batch' ||
            fnName === 'get_sentences' ||
            fnName === 'get_bold_definitions' ||
            fnName === 'get_bold_definitions_batch' ||
            fnName === 'search_concepts' ||
            fnName === 'search_tipitaka') &&
          !parsedArgs.langs
        ) {
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
        } else if ((spec.name === 'search_concepts' || spec.name === 'search_tipitaka' || spec.name === 'search_tipitaka_batch' || spec.name === 'search_by_category') && resObj.results) {
          allCollectedEvidence.passages.push(...resObj.results);
        } else if ((spec.name === 'get_paragraph_content' || spec.name === 'get_paragraph_content_batch') && resObj.passages) {
          allCollectedEvidence.passages.push(...resObj.passages);
        } else if ((spec.name === 'get_bold_definitions' || spec.name === 'get_bold_definitions_batch') && resObj.definitions) {
          allCollectedEvidence.boldDefinitions.push(...resObj.definitions);
        } else if (spec.name === 'get_sentences' && resObj.pali_sentences) {
          allCollectedEvidence.sentences.push(resObj);
        } else if (spec.name === 'get_commentaries' && (resObj.atthakatha || resObj.tika)) {
          allCollectedEvidence.commentaries.push(resObj);
        } else if ((spec.name === 'get_dictionary' || spec.name === 'get_dictionary_batch') && resObj.entries) {
          allCollectedEvidence.dictionaries.push(...resObj.entries);
        }

        const summaryArg = spec.args?.query || spec.args?.queries?.[0] || (Array.isArray(spec.args?.concept_groups) ? spec.args.concept_groups.map((g) => g.concept || g).join(' + ') : '') || spec.args?.word || spec.args?.words?.[0] || spec.args?.book_code || '';
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

    if (understanding?.default_sutta_para !== null && understanding?.default_sutta_para !== undefined && understanding?.recommended_locations?.books?.[0]) {
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

  // 1c. Canonical & Commentarial Bold Definitions
  if (evidence.boldDefinitions && evidence.boldDefinitions.length > 0) {
    block += `### CANONICAL & COMMENTARIAL BOLD DEFINITIONS (AṬṬHAKATHĀ / ṬĪKĀ / MŪLA):\n\n`;
    for (const d of evidence.boldDefinitions.slice(0, 8)) {
      block += `[Bold Def] "${d.word}" — ${d.book_title} (${d.category}) ${d.citation_ref}\n`;
      block += `Pāḷi: ${d.pali_definition}\n`;
      if (d.translations) {
        for (const [lang, tr] of Object.entries(d.translations)) {
          if (tr) block += `Translation [${lang}]: ${tr}\n`;
        }
      }
      block += `\n`;
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
  return ev || { sections: [], passages: [], sentences: [], boldDefinitions: [], commentaries: [], dictionaries: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FASTIFY ROUTES & SSE STREAMING ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

function registerAiRoutes(fastify) {
  fastify.get('/api/ai/tools', async () => {
    return { tools: kAiToolDeclarations };
  });

  fastify.post('/api/ai/understand', async (req) => {
    const body = req.body || {};
    const query = String(body.query || body.userQuery || '').trim();
    const history = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
    if (!query) return { success: false, error: 'Missing query' };
    const understanding = heuristicQueryUnderstanding(query, history, dbTipitaka, dbSummaries);
    return { success: true, understanding };
  });

  fastify.post('/api/ai/search_concepts', async (req) => {
    const body = req.body || {};
    return executeAiTool('search_concepts', body);
  });

  fastify.get('/api/ai/bold_definitions', async (req) => {
    const w = req.query.w || req.query.word || req.query.term || req.query.q || '';
    const langs = req.query.langs ? String(req.query.langs).split(',').map((s) => s.trim()).filter(Boolean) : ['en'];
    const limit = parseInt(req.query.limit || '8', 10);
    return aiGetBoldDefinitions({ word: w, langs, limit });
  });

  fastify.post('/api/ai/bold_definitions_batch', async (req) => {
    const body = req.body || {};
    return executeAiTool('get_bold_definitions_batch', body);
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
    const rawChap = req.query.chapter ?? req.query.chapter_index;
    const chap = rawChap !== undefined && rawChap !== '' ? parseInt(rawChap, 10) : undefined;
    const rawStart = req.query.start ?? req.query.para_start ?? req.query.para_index;
    const pnum = req.query.para_num ?? req.query.para ?? undefined;
    const start = rawStart !== undefined && rawStart !== '' ? parseInt(rawStart, 10) : (pnum ? undefined : 0);
    const rawEnd = req.query.end ?? req.query.para_end;
    const end = rawEnd !== undefined && rawEnd !== '' ? parseInt(rawEnd, 10) : (start !== undefined ? start : undefined);
    const langs = req.query.langs ? String(req.query.langs).split(',').map((s) => s.trim()).filter(Boolean) : ['en', 'vi'];
    return aiGetParagraphContent({ book_code: book, chapter_index: chap, para_start: start, para_end: end, para_num: pnum, langs });
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
    const pidx = req.query.para_index !== undefined ? parseInt(req.query.para_index, 10) : (req.query.para !== undefined ? parseInt(req.query.para, 10) : undefined);
    const pnum = req.query.para_num || req.query.pnum || undefined;
    const lid = req.query.line_id !== undefined ? parseInt(req.query.line_id, 10) : (req.query.line !== undefined ? parseInt(req.query.line, 10) : undefined);
    const langs = req.query.langs ? req.query.langs.split(',').map((s) => s.trim()).filter(Boolean) : ['en'];
    return aiGetSentences({ book_code: book, chapter_index: chap, para_index: pidx, para_num: pnum, line_id: lid, langs });
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
    const name = req.body?.name || req.body?.tool;
    const args = req.body?.args || {};
    if (!name) return { success: false, error: 'Missing tool name' };
    return executeAiTool(name, args);
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
        langDirective = 'Please write your complete answer in Burmese (မြန်မာဘာသာ), maintaining authentic Theravāda scholarship and Pāḷi citations.';
      }

      const synthesisPrompt = `USER QUESTION:
${userQuery}

LANGUAGE DIRECTIVE:
${langDirective}

VERIFIED CANONICAL EVIDENCE GATHERED FROM TIPITAKA DATABASE:
${contextBlock || 'No direct text matches found in search; please synthesize strictly according to canonical Theravāda principles.'}

Please write a comprehensive, clearly structured answer. Quote Pāḷi verses or phrases accurately and format EVERY citation as [book_code:c{chapter_index}:p{para_index}].`;

      if (provider === 'gemini') {
        const isGemini3Model = (m) => /^gemini-(?:3|flash-lite-latest|flash-latest)/i.test(String(m || '').trim());
        const baseContents = [{ role: 'user', parts: [{ text: synthesisPrompt }] }];
        const streamModels = [
          answerModel,
          ...['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'].filter((m) => m !== answerModel),
        ];
        let activeServerModel = answerModel;
        let fullAnswer = '';

        const runServerGeminiStream = async (contents) => {
          const modelsToTry = [activeServerModel, ...streamModels.filter((m) => m !== activeServerModel)];
          let res = null;
          let usedModel = activeServerModel;
          for (const mName of modelsToTry) {
            const genCfg = {
              temperature: 0.3,
              maxOutputTokens: 16384,
              ...(isGemini3Model(mName) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
            };
            const payload = {
              system_instruction: { parts: [{ text: answerSystemPrompt }] },
              contents,
              generationConfig: genCfg,
            };
            const geminiStreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey.trim())}`;
            let r = await fetch(geminiStreamUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(60000),
            });
            if (r.status === 400 && genCfg.thinkingConfig) {
              const fallbackPayload = { ...payload, generationConfig: { temperature: 0.3, maxOutputTokens: 16384 } };
              r = await fetch(geminiStreamUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fallbackPayload),
                signal: AbortSignal.timeout(60000),
              });
            }
            res = r;
            usedModel = mName;
            if (r.ok || (r.status !== 404 && r.status !== 429 && r.status !== 503 && r.status !== 500 && r.status !== 502 && r.status !== 504)) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 900));
          }

          if (!res || !res.ok) {
            const errText = res ? await res.text() : 'Network error';
            return { ok: false, status: res?.status || 'ERR', errText };
          }

          activeServerModel = usedModel;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let turnText = '';
          let finishReason = null;
          let sawUsageMetadata = false;

          const processServerGeminiLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const dataStr = trimmed.substring(5).trim();
            if (!dataStr || dataStr === '[DONE]') return;
            try {
              const json = JSON.parse(dataStr);
              if (json.usageMetadata) sawUsageMetadata = true;
              const cand = json.candidates?.[0];
              if (cand?.finishReason) finishReason = cand.finishReason;
              const parts = cand?.content?.parts || [];
              const textChunk = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
              if (textChunk) {
                turnText += textChunk;
                fullAnswer += textChunk;
                sendEvent('token', { text: textChunk });
              }
            } catch (e) {}
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
              processServerGeminiLine(line);
            }
          }
          if (buffer.trim()) processServerGeminiLine(buffer);

          return { ok: true, turnText, finishReason, sawUsageMetadata };
        };

        const first = await runServerGeminiStream(baseContents);
        if (!first.ok) {
          sendEvent('error', { message: `Gemini API Error (${first.status}): ${String(first.errText || '').substring(0, 200)}` });
          reply.raw.end();
          return;
        }

        let lastFinishReason = first.finishReason;
        let lastSawUsage = first.sawUsageMetadata;
        for (
          let cont = 0;
          cont < 2 &&
          fullAnswer.trim().length > 0 &&
          lastFinishReason !== 'STOP' &&
          lastFinishReason !== 'SAFETY' &&
          lastFinishReason !== 'RECITATION' &&
          (lastFinishReason === 'MAX_TOKENS' || lastSawUsage);
          cont++
        ) {
          sendEvent('status', { message: 'Completing interrupted response…' });
          const next = await runServerGeminiStream([
            ...baseContents,
            { role: 'model', parts: [{ text: fullAnswer }] },
            { role: 'user', parts: [{ text: 'Continue immediately from the exact character/word where you stopped without repeating anything already written, and finish the answer completely.' }] },
          ]);
          if (!next.ok || !next.turnText) break;
          lastFinishReason = next.finishReason;
          lastSawUsage = next.sawUsageMetadata;
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
  aiSearchConcepts,
  aiSearchTipitaka,
  aiSearchSections,
  aiGetSection,
  aiGetParagraphContent,
  aiGetCommentaries,
  aiGetBoldDefinitions,
  aiGetBoldDefinitionsBatch,
  aiGetDictionary,
  aiGetBooks,
  buildConceptGroupFtsClause,
  buildConceptIntersectionFtsQuery,
  formatFtsQuery,
  sanitizeFtsTerm,
  parseCitations,
  compareCitations,
  getCitationGroupPriority,
  getCitationPitakaPriority,
  resolveCanonicalBookCode,
  kAiToolDeclarations,
  getOpenAiToolDeclarations,
  buildSynthesisContextBlock,
};
