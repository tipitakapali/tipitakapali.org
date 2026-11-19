'use client';

import { fetchAiEndpoint } from "./api";

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL TOOL DECLARATIONS FOR CLIENT-SIDE GEMINI & OPENAI
// ═══════════════════════════════════════════════════════════════════════════

export const kAiToolDeclarations = [
  {
    name: "search_concepts",
    description:
      "High-precision multi-concept boolean search across Pāḷi Canon and English/translation FTS5 indexes. " +
      "Break a research question into 1–4 main concept groups, each with Pāḷi terms/stems AND English keywords/synonyms. " +
      "Intersects groups with (Group1_syn1 OR syn2) AND (Group2_syn1 OR syn2), automatically relaxing if strict intersection is sparse, and ranks by concept coverage + Mūla priority.",
    parameters: {
      type: "OBJECT",
      properties: {
        concept_groups: {
          type: "ARRAY",
          description: "Array of 1 to 4 main concept groups to intersect.",
          items: {
            type: "OBJECT",
            properties: {
              concept: { type: "STRING", description: "Short label for this concept group (e.g. \"Overcoming Anger\")." },
              pali_terms: {
                type: "ARRAY",
                description: "Exact Pāḷi lemmas & canonical synonyms in Roman IAST (e.g. [\"kodha\", \"vyāpāda\", \"āghāta\"]).",
                items: { type: "STRING" },
              },
              pali_stems: {
                type: "ARRAY",
                description: "Pāḷi prefix stems with terminal vowels stripped + * (e.g. [\"kodh*\", \"vyāpād*\"]).",
                items: { type: "STRING" },
              },
              english_keywords: {
                type: "ARRAY",
                description: "English keywords & synonyms (e.g. [\"anger\", \"ill-will\", \"resentment\"]).",
                items: { type: "STRING" },
              },
              local_keywords: {
                type: "ARRAY",
                description: "Optional keywords in the user's non-English language (e.g. Vietnamese [\"sân hận\", \"tâm từ\"]).",
                items: { type: "STRING" },
              },
            },
            required: ["concept"],
          },
        },
        categories: {
          type: "ARRAY",
          description: "Optional Piṭaka / layer filter: [\"vinaya\", \"sutta\", \"abhidhamma\", \"mula\", \"atthakatha\", \"tika\"].",
          items: { type: "STRING" },
        },
        nikayas: {
          type: "ARRAY",
          description: "Optional Nikāya filter: [\"dn\", \"mn\", \"sn\", \"an\", \"kn\", \"dhp\", \"ja\"].",
          items: { type: "STRING" },
        },
        langs: {
          type: "ARRAY",
          description: "Optional translation FTS languages to search alongside Pāḷi (defaults to [\"en\"]).",
          items: { type: "STRING" },
        },
        limit: {
          type: "INTEGER",
          description: "Maximum passages to return (default 15, max 30).",
        },
      },
      required: ["concept_groups"],
    },
  },
  {
    name: "get_bold_definitions",
    description:
      "Query 387,000+ pre-indexed canonical & commentarial BOLD DEFINITIONS (<b>lemma</b> glosses from Aṭṭhakathā, Ṭīkā, Visuddhimagga, Abhidhammatthasaṅgaha, and Mūla). " +
      "Essential for \"What is X?\" or doctrinal term definitions — returns exact Pāḷi defining sentences, aligned translations, and sentence-level citations [book:cX:pY-LZ].",
    parameters: {
      type: "OBJECT",
      properties: {
        word: {
          type: "STRING",
          description: "Pāḷi headword or stem to look up (e.g. \"mettā\", \"saṅkhāra\", \"nibbāna\", \"papañca\", \"sati\").",
        },
        langs: {
          type: "ARRAY",
          description: "Translation languages to attach (defaults to [\"en\"]).",
          items: { type: "STRING" },
        },
        limit: {
          type: "INTEGER",
          description: "Maximum definitions to return (default 8, max 20).",
        },
      },
      required: ["word"],
    },
  },
  {
    name: "get_bold_definitions_batch",
    description:
      "Look up canonical & commentarial bold definitions for multiple Pāḷi terms in ONE parallel call.",
    parameters: {
      type: "OBJECT",
      properties: {
        words: {
          type: "ARRAY",
          description: "Array of 2 to 5 Pāḷi terms to look up in bold_definitions.db.",
          items: { type: "STRING" },
        },
        langs: {
          type: "ARRAY",
          description: "Translation languages to attach (defaults to [\"en\"]).",
          items: { type: "STRING" },
        },
        limit: {
          type: "INTEGER",
          description: "Maximum definitions per word (default 4).",
        },
      },
      required: ["words"],
    },
  },
  {
    name: "search_sections",
    description:
      "Search section, sutta, and vagga TITLES (with study summaries) across the whole 217-book canon. " +
      "Also resolves direct citations like MN 18, DN 22, SN 56.11, AN 3.65, Dhp 183.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Term, sutta name, citation, or phrase to match against section/sutta titles or summaries (Pāli or English).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_tipitaka",
    description:
      "Search the Tipitaka database for passages using full-text search across Pāḷi Canon and translations. " +
      "Returns matching passages with book codes, chapter titles, paragraph numbers, and text snippets.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search query — a phrase, compound, or keywords to search for in the Pāli text or translation.",
        },
        langs: {
          type: "ARRAY",
          description: "Optional translation languages to search alongside Pāḷi.",
          items: { type: "STRING" },
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_tipitaka_batch",
    description:
      "Search the Tipitaka using MULTIPLE different search terms simultaneously. " +
      "Use this to search for a concept using several synonyms, compounds, or related terms in parallel.",
    parameters: {
      type: "OBJECT",
      properties: {
        queries: {
          type: "ARRAY",
          description: "Array of 2 to 5 search queries to run in parallel (different phrasings, synonyms, compounds).",
          items: { type: "STRING" },
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "search_by_category",
    description:
      "Search the Tipitaka within specific book categories (\"vinaya\", \"sutta\", \"abhidhamma\") " +
      "or nikayas (\"dn\", \"mn\", \"sn\", \"an\", \"kn\", \"dhp\", \"ja\"). Results are filtered strictly to those books.",
    parameters: {
      type: "OBJECT",
      properties: {
        queries: {
          type: "ARRAY",
          description: "Array of 2 to 4 search queries to execute within target books.",
          items: { type: "STRING" },
        },
        categories: {
          type: "ARRAY",
          description: "Book categories: [\"vinaya\"], [\"sutta\"], and/or [\"abhidhamma\"].",
          items: { type: "STRING" },
        },
        nikayas: {
          type: "ARRAY",
          description: "Nikaya abbreviations: [\"dn\"], [\"mn\"], [\"sn\"], [\"an\"], [\"dhp\"], [\"ja\"], etc.",
          items: { type: "STRING" },
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "get_headings",
    description:
      "Get table of contents and heading hierarchy for a canonical book (e.g. \"s0101m.mul\", \"dn1\", \"mn1\", \"dhp\"). " +
      "Use this to browse sutta structures, vaggas, and find exact chapter and paragraph index boundaries.",
    parameters: {
      type: "OBJECT",
      properties: {
        book_code: {
          type: "STRING",
          description: "Canonical book code or short alias (e.g. \"s0101m.mul\", \"dn1\", \"mn1\", \"dhp\").",
        },
        chapter_index: {
          type: "INTEGER",
          description: "Optional chapter index to filter headings within a specific chapter.",
        },
      },
      required: ["book_code"],
    },
  },
  {
    name: "get_section",
    description:
      "Get details of a specific chapter or section: title, summary, outline, and paragraph boundaries.",
    parameters: {
      type: "OBJECT",
      properties: {
        book_code: {
          type: "STRING",
          description: "Book code (e.g. \"s0101m.mul\", \"s0201m.mul\", \"D-i\", \"M-i\").",
        },
        chapter_index: {
          type: "INTEGER",
          description: "Chapter index (0-based).",
        },
        para_start: {
          type: "INTEGER",
          description: "Starting paragraph index for sub-sections.",
        },
      },
      required: ["book_code"],
    },
  },
  {
    name: "get_paragraph_content",
    description:
      "Read exact Pali text and verified translations for a paragraph range. " +
      "Always call this after discovering a relevant section or passage to read the authentic discourse words.",
    parameters: {
      type: "OBJECT",
      properties: {
        book_code: {
          type: "STRING",
          description: "Canonical book code (e.g. \"s0101m.mul\", \"s0202m.mul\", \"s0502m.mul\").",
        },
        chapter_index: {
          type: "INTEGER",
          description: "Chapter index (0-based).",
        },
        para_start: {
          type: "INTEGER",
          description: "Starting paragraph index (0-based) or paragraph number.",
        },
        para_end: {
          type: "INTEGER",
          description: "Ending paragraph index (up to start + 12).",
        },
        para_num: {
          type: "STRING",
          description: "Alternative: canonical paragraph number printed in VRI edition (e.g. \"373\").",
        },
        langs: {
          type: "ARRAY",
          description: "Translation languages to retrieve: [\"en\"], [\"vi\"], [\"my\"], etc.",
          items: { type: "STRING" },
        },
      },
      required: ["book_code"],
    },
  },
  {
    name: "get_paragraph_content_batch",
    description:
      "Read multiple distinct paragraph ranges across different suttas or books in parallel.",
    parameters: {
      type: "OBJECT",
      properties: {
        ranges: {
          type: "ARRAY",
          description: "Array of paragraph range requests.",
          items: {
            type: "OBJECT",
            properties: {
              book_code: { type: "STRING" },
              chapter_index: { type: "INTEGER" },
              para_start: { type: "INTEGER" },
              para_end: { type: "INTEGER" },
              para_num: { type: "STRING" },
              langs: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["book_code"],
          },
        },
      },
      required: ["ranges"],
    },
  },
  {
    name: "get_sentences",
    description:
      "Get sentence-level Pāḷi text and aligned translations with shared line numbers (99.7% alignment). " +
      "Line numbers (line_id) are shared 1-to-1 between Pāḷi and translations. " +
      "Use this for sentence-level textual analysis, quoting specific verses/sentences, and generating fine-grained citations [book:cX:pY-LZ].",
    parameters: {
      type: "OBJECT",
      properties: {
        book_code: {
          type: "STRING",
          description: "Canonical book code (e.g. \"s0101m.mul\", \"s0201m.mul\", \"s0502m.mul\").",
        },
        chapter_index: {
          type: "INTEGER",
          description: "Chapter index (0-based).",
        },
        para_index: {
          type: "INTEGER",
          description: "Paragraph index (0-based global para_position).",
        },
        line_id: {
          type: "INTEGER",
          description: "Optional single sentence number (1-based line_id) to retrieve a specific sentence.",
        },
        langs: {
          type: "ARRAY",
          description: "Translation languages to retrieve: [\"en\"], [\"vi\"], [\"my\"], etc.",
          items: { type: "STRING" },
        },
      },
      required: ["book_code"],
    },
  },
  {
    name: "get_commentaries",
    description:
      "Retrieve corresponding Aṭṭhakathā (ancient commentary) and Ṭīkā (sub-commentary) explanations " +
      "for a given Mūla (root) paragraph. Essential for doctrinal explanations, authentic Theravāda views, and term clarification.",
    parameters: {
      type: "OBJECT",
      properties: {
        book_code: {
          type: "STRING",
          description: "Mūla book code (e.g. \"s0101m.mul\", \"s0201m.mul\").",
        },
        chapter_index: {
          type: "INTEGER",
          description: "Chapter index (0-based).",
        },
        para_num: {
          type: "STRING",
          description: "Canonical paragraph number (e.g. \"1\", \"103\").",
        },
        para_index: {
          type: "INTEGER",
          description: "Paragraph index (0-based).",
        },
      },
      required: ["book_code"],
    },
  },
  {
    name: "get_dictionary",
    description:
      "Look up a Pāli term in the Digital Pāli Dictionary (DPD). Returns grammatical info, roots, etymology, compound splits, and comprehensive definitions.",
    parameters: {
      type: "OBJECT",
      properties: {
        word: {
          type: "STRING",
          description: "Pāli word (in Roman script with diacritics, Velthuis, or plain approx, e.g. \"nibbāna\", \"anicca\", \"khandha\").",
        },
      },
      required: ["word"],
    },
  },
  {
    name: "get_dictionary_batch",
    description:
      "Look up multiple Pāli terms simultaneously in the Digital Pāli Dictionary (DPD).",
    parameters: {
      type: "OBJECT",
      properties: {
        words: {
          type: "ARRAY",
          description: "List of Pāli terms to look up in parallel.",
          items: { type: "STRING" },
        },
      },
      required: ["words"],
    },
  },
  {
    name: "get_books",
    description: "Get the full list of 217 canonical books, their nikāyas, categories, and codes.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "final_answer",
    description:
      "Call this tool once you have gathered sufficient canonical evidence and are ready to formulate the final answer for the user.",
    parameters: {
      type: "OBJECT",
      properties: {
        summary: {
          type: "STRING",
          description: "Brief summary of findings and passages collected.",
        },
      },
      required: ["summary"],
    },
  },
];

function convertSchemaToOpenAi(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const converted = { ...schema };
  if (converted.type && typeof converted.type === "string") {
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

export function getOpenAiToolDeclarations() {
  return kAiToolDeclarations.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: convertSchemaToOpenAi(t.parameters),
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  PURE HELPERS: QUERY UNDERSTANDING, LANGUAGE DIRECTIVE, EVIDENCE MERGE
// ═══════════════════════════════════════════════════════════════════════════

const SUPPORTED_TRANS_LANGS = new Set([
  "en", "vi", "my", "si", "zh", "km", "th", "lo", "ta", "hi", "mr",
  "id", "cs", "de", "es", "fr", "ja", "pt", "ru", "ko", "ne", "be",
]);

const LANG_DIRECTIVES = {
  en: "Write your complete scholarly response in clear, idiomatic English.",
  vi: "Hãy viết toàn bộ câu trả lời bằng tiếng Việt trang trọng, chuẩn mực Phật học Theravāda, giải thích rõ các thuật ngữ Pāḷi.",
  my: "Write your complete answer in Burmese (မြန်မာဘာသာ), maintaining authentic Theravāda scholarship and Pāḷi citations.",
  th: "Write your complete answer in Thai (ภาษาไทย), using accurate Theravāda Buddhist terminology and Pāḷi citations.",
  zh: "Write your complete answer in Chinese (中文), using accurate Theravāda Pāḷi Canon terminology and citations.",
  si: "Write your complete answer in Sinhala (සිංහල), using accurate Theravāda scholarship and Pāḷi citations.",
  de: "Write your complete answer in German (Deutsch), preserving exact Pāḷi terms and citations.",
  fr: "Write your complete answer in French (Français), preserving exact Pāḷi terms and citations.",
  es: "Write your complete answer in Spanish (Español), preserving exact Pāḷi terms and citations.",
  ja: "Write your complete answer in Japanese (日本語), preserving exact Pāḷi terms and citations.",
  ko: "Write your complete answer in Korean (한국어), preserving exact Pāḷi terms and citations.",
  hi: "Write your complete answer in Hindi (हिन्दी), preserving exact Pāḷi terms and citations.",
  km: "Write your complete answer in Khmer (ភាសាខ្មែរ), preserving exact Pāḷi terms and citations.",
  lo: "Write your complete answer in Lao (ພາສາລາວ), preserving exact Pāḷi terms and citations.",
  ru: "Write your complete answer in Russian (Русский), preserving exact Pāḷi terms and citations.",
  id: "Write your complete answer in Indonesian (Bahasa Indonesia), preserving exact Pāḷi terms and citations.",
  pt: "Write your complete answer in Portuguese (Português), preserving exact Pāḷi terms and citations.",
};

export function buildLanguageDirective(langCode) {
  const clean = String(langCode || "en").trim().toLowerCase();
  return LANG_DIRECTIVES[clean] || LANG_DIRECTIVES.en;
}

export function detectClientQueryLanguage(text) {
  if (!text) return "en";
  if (/[\u1000-\u109F]/.test(text)) return "my";
  if (/[\u0D80-\u0DFF]/.test(text)) return "si";
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[\u0E80-\u0EFF]/.test(text)) return "lo";
  if (/[\u1780-\u17FF]/.test(text)) return "km";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0980-\u09FF]/.test(text)) return "be";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  // Vietnamese-exclusive diacritics or phrases (excludes bare â/ê/ô shared with French/Portuguese)
  if (
    /[ăằắẳẵặầấẩẫậềếểễệồốổỗộơờớởỡợưừứửữựđảạẻẹẽỉịỏọủụỳỷỹỵ]/i.test(text) ||
    /\b(không|của|những|người|như thế nào|là gì|đức phật|bài kinh|tam tạng|sân hận|tâm từ|vô thường|vô ngã)\b/i.test(text)
  ) {
    return "vi";
  }
  if (/[¿¡ñ]/i.test(text) || /\b(qué|cómo|enseña|sobre|sufrimiento|compasión|buda|cuál|cuáles)\b/i.test(text)) return "es";
  if (/\b(qu['’]est-ce|comment|enseigne|bouddha|souffrance|pleine conscience|équanimité|bienveillance|quel|quelle)\b/i.test(text)) return "fr";
  if (/[äöüß]/i.test(text) || /\b(was|wie|lehrt|über|achtsamkeit|weisheit|leiden|geduld|mitgefühl)\b/i.test(text)) return "de";
  if (/[ãõç]/i.test(text) || /\b(o que é|como|ensina|sofrimento|compaixão|atenção plena|cânone)\b/i.test(text)) return "pt";
  if (/[ěščřžů]/i.test(text)) return "cs";
  if (/\b(apakah|bagaimana|ajaran|penderitaan|kebijaksanaan|perhatian penuh)\b/i.test(text)) return "id";
  return "en";
}

export function sanitizeConversationHistory(conversationHistory = [], currentUserQuery = "") {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return [];
  const cleanQuery = String(currentUserQuery || "").trim();
  const cleaned = [];
  for (const m of conversationHistory) {
    if (!m || !m.role || typeof m.content !== "string") continue;
    const content = m.content.trim();
    if (!content) continue;
    const role = m.role === "assistant" || m.role === "model" ? "assistant" : "user";
    cleaned.push({ role, content });
  }
  // Drop trailing user message if it duplicates the active userQuery (avoids consecutive user turns)
  if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === "user" && cleanQuery && cleaned[cleaned.length - 1].content === cleanQuery) {
    cleaned.pop();
  }
  // Keep up to 4 prior turns, collapsing consecutive identical roles and ensuring history doesn't end on 'user'
  const recent = cleaned.slice(-4);
  const alternating = [];
  for (const msg of recent) {
    if (alternating.length > 0 && alternating[alternating.length - 1].role === msg.role) {
      alternating[alternating.length - 1] = {
        role: msg.role,
        content: `${alternating[alternating.length - 1].content}\n\n${msg.content}`,
      };
    } else {
      alternating.push(msg);
    }
  }
  if (alternating.length > 0 && alternating[alternating.length - 1].role === "user") {
    alternating.pop();
  }
  return alternating;
}

export function extractGeminiTextFromParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return "";
  return parts
    .filter((p) => p && typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

export function getGeminiFallbackModels(primaryModel = "gemini-flash-lite-latest") {
  const clean = String(primaryModel || "").trim();
  const candidates = [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
  ];
  return candidates.filter((m) => m !== clean);
}

function createAttemptSignal(parentSignal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: parentSignal, clearTimer: () => {}, cleanup: () => {} };
  }
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
      return { signal: controller.signal, clearTimer: () => {}, cleanup: () => {}, didTimeout: () => false };
    }
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Gemini request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clearTimer: () => clearTimeout(timer),
    cleanup: () => {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

function sleepWithAbort(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isGemini3ThinkingModel(model = "") {
  return /^gemini-(?:3|flash-lite-latest|flash-latest)/i.test(String(model || "").trim());
}

function buildModelPayload(payload, activeModel, thinkingLevel, stripThinking = false) {
  if (!payload || typeof payload !== "object") return payload;
  const genCfg = payload.generationConfig ? { ...payload.generationConfig } : {};
  if (stripThinking) {
    delete genCfg.thinkingConfig;
  } else if (thinkingLevel && isGemini3ThinkingModel(activeModel) && !genCfg.thinkingConfig) {
    genCfg.thinkingConfig = { thinkingLevel };
  }
  return Object.keys(genCfg).length > 0 ? { ...payload, generationConfig: genCfg } : payload;
}

export async function fetchGeminiWithRetry({
  model = "gemini-flash-lite-latest",
  action = "generateContent",
  queryExtra = "",
  apiKey,
  payload,
  thinkingLevel = null,
  signal,
  timeoutMs = 40000,
  maxRetries = 2,
  allowFallback = true,
  onStatus = null,
}) {
  const encodedKey = encodeURIComponent(String(apiKey || "").trim());
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const fallbacks = allowFallback ? getGeminiFallbackModels(model).slice(0, 3) : [];
  const modelsToTry = [model, ...fallbacks];

  let lastResponse = null;
  let lastError = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const activeModel = modelsToTry[mIdx];
    const attemptsForModel = mIdx === 0 ? maxRetries + 1 : 1;
    let effectiveThinkingLevel = thinkingLevel;
    let downgradedToLow = false;
    let stripThinking = false;

    for (let attempt = 0; attempt < attemptsForModel; attempt++) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Inquiry cancelled by user"), { name: "AbortError" });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:${action}?${queryExtra ? `${queryExtra}&` : ""}key=${encodedKey}`;
      const attemptPayload = buildModelPayload(payload, activeModel, effectiveThinkingLevel, stripThinking);
      const attemptCtl = createAttemptSignal(signal, timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attemptPayload),
          signal: attemptCtl.signal,
        });

        if (res.ok) {
          // Clear connection timeout while preserving parent abort forwarding for SSE streaming bodies
          attemptCtl.clearTimer();
          return { res, modelUsed: activeModel, cleanupAbort: attemptCtl.cleanup };
        }
        attemptCtl.cleanup();

        lastResponse = res;

        // If a model rejects thinkingConfig with 400, first downgrade minimal -> low, then strip thinkingConfig
        if (res.status === 400 && !stripThinking && attemptPayload?.generationConfig?.thinkingConfig) {
          if (effectiveThinkingLevel === "minimal" && !downgradedToLow) {
            effectiveThinkingLevel = "low";
            downgradedToLow = true;
            attempt--;
            continue;
          }
          stripThinking = true;
          attempt--;
          continue;
        }

        // 404 (e.g. deprecated gemini-2.5-flash for new keys): skip straight to next fallback model
        if (res.status === 404 && mIdx < modelsToTry.length - 1) {
          onStatus?.(`Model ${activeModel} unavailable (404), switching to ${modelsToTry[mIdx + 1]}…`);
          break;
        }

        if (retryableStatuses.has(res.status)) {
          const isLastAttemptForModel = attempt >= attemptsForModel - 1;
          if (!isLastAttemptForModel) {
            const delayMs = 900 * (attempt + 1);
            onStatus?.(`Gemini busy (HTTP ${res.status}), retrying…`);
            await sleepWithAbort(delayMs, signal);
            continue;
          }
          if (mIdx < modelsToTry.length - 1) {
            onStatus?.(`Model ${activeModel} overloaded (HTTP ${res.status}), falling back to ${modelsToTry[mIdx + 1]}…`);
            await sleepWithAbort(400, signal);
            break;
          }
        }

        // Non-retryable error (e.g. 400, 401, 403) or all fallbacks exhausted
        return { res, modelUsed: activeModel };
      } catch (err) {
        attemptCtl.cleanup();
        if (signal?.aborted) {
          throw err;
        }
        lastError = err;
        const isLastAttemptForModel = attempt >= attemptsForModel - 1;
        if (!isLastAttemptForModel) {
          onStatus?.(`Gemini request timed out, retrying…`);
          await sleepWithAbort(700, signal);
          continue;
        }
        if (mIdx < modelsToTry.length - 1) {
          onStatus?.(`Switching from ${activeModel} to ${modelsToTry[mIdx + 1]}…`);
          break;
        }
      }
    }
  }

  if (lastResponse) {
    return { res: lastResponse, modelUsed: modelsToTry[modelsToTry.length - 1] };
  }
  throw lastError || new Error("Gemini request failed");
}

export function parseJsonResponse(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch (_) {}
  }
  return null;
}

export function buildUnderstandingPrompt(userQuery, conversationHistory = []) {
  const safeHist = sanitizeConversationHistory(conversationHistory, userQuery);
  const recentCtx = safeHist
    .map((m) => `${m.role}: ${String(m.content).slice(0, 260)}`)
    .join("\n");

  return `You are Ani (AI Nissaya)'s Scholarly Query Decomposition Engine for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Analyze the user's research question and return STRICTLY valid JSON:

1. Break the inquiry into 1 to 4 MAIN CONCEPT GROUPS ("concept_groups").
   For EACH concept group provide:
   - "concept": short descriptive name (e.g. "Overcoming Anger", "Loving-kindness")
   - "pali_terms": 2–5 precise Pāḷi lemmas & canonical synonyms in Roman IAST diacritics (e.g. ["kodha", "vyāpāda", "āghāta", "dosa"])
   - "pali_stems": prefix stems stripping final vowel (-a, -ā, -e, -o) + "*" (e.g. ["kodh*", "vyāpād*", "āghāt*", "sati*"] — never shorten "sati" to "sat*")
   - "english_keywords": 2–5 English keywords & synonyms for searching English translations (e.g. ["anger", "ill-will", "resentment", "hatred"])
   - "local_keywords": (if user did NOT ask in English) 2–4 keywords/synonyms in the user's language for searching that language's translation index
2. "intent": "doctrinal_explanation" | "term_analysis" | "sutta_lookup" | "monastic_rule" | "comparison" | "grammar_analysis" | "general_dhamma"
3. "detected_language": ISO code of the user's language ("en", "vi", "my", "th", "zh", "si", "de", "fr", "es", "pt", "ja", "ko", "pi", etc.)
4. "needs_bold_definitions": boolean — true whenever canonical/commentarial term definitions (bold definitions) or doctrinal term clarification will strengthen the answer
5. "key_terms_for_bold_def": up to 3 single-word Pāḷi headwords to look up in our 387k pre-indexed canonical bold definitions (e.g. ["saṅkhāra", "mettā"])
6. "canonical_pali_terms": flat list of primary Pāḷi terms in Roman IAST
7. "pali_stems": flat list of Pāḷi prefix stems ending in "*"
8. "target_sutta_names": specific suttas likely relevant (e.g. ["Āghātapaṭivinaya Sutta (AN 5.161)", "Kakacūpama Sutta (MN 21)"])
9. "recommended_locations": { "categories": [], "nikayas": [], "books": [] } — leave empty arrays unless the inquiry explicitly targets a specific Piṭaka (vinaya/sutta/abhidhamma) or Nikāya (dn/mn/sn/an/kn/dhp/ja)
10. "translation_languages": ["en"] plus the user's detected_language if supported (e.g. ["en", "vi"] or ["en", "my"])
11. "initial_search_strategy": 2–4 concise research steps
12. "user_facing_summary": 1–2 concise sentences explaining how Ani broke down the question and what canonical texts will be investigated.

${recentCtx ? `Recent conversation context:\n${recentCtx}\n\n` : ""}User Inquiry: "${userQuery}"`;
}

export function mergeUnderstandingWithLocal(aiUnd, localUnd, userQuery) {
  const base = aiUnd && typeof aiUnd === "object" ? aiUnd : {};
  const local = localUnd && typeof localUnd === "object" ? localUnd : {};

  const detectedLang = base.detected_language || local.detected_language || detectClientQueryLanguage(userQuery);
  const transLangs = Array.from(new Set([
    "en",
    ...(Array.isArray(base.translation_languages) ? base.translation_languages : []),
    ...(Array.isArray(local.translation_languages) ? local.translation_languages : []),
    ...(SUPPORTED_TRANS_LANGS.has(detectedLang) ? [detectedLang] : []),
  ])).filter((l) => SUPPORTED_TRANS_LANGS.has(l));

  const normalizeGroup = (g, idx) => {
    const localKws = Array.from(new Set((Array.isArray(g.local_keywords) ? g.local_keywords : []).map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 6);
    return {
      concept: String(g.concept || g.name || `Concept ${idx + 1}`).trim(),
      pali_terms: Array.from(new Set((Array.isArray(g.pali_terms) ? g.pali_terms : []).map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 8),
      pali_stems: Array.from(new Set((Array.isArray(g.pali_stems) ? g.pali_stems : []).map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 8),
      english_keywords: Array.from(new Set((Array.isArray(g.english_keywords) ? g.english_keywords : []).map((x) => String(x || "").trim()).filter(Boolean))).slice(0, 8),
      ...(localKws.length > 0 ? { local_keywords: localKws } : {}),
    };
  };

  const aiGroups = (Array.isArray(base.concept_groups) ? base.concept_groups : [])
    .filter(Boolean)
    .map(normalizeGroup)
    .filter((g) => g.pali_terms.length > 0 || g.pali_stems.length > 0 || g.english_keywords.length > 0 || (g.local_keywords?.length || 0) > 0);

  const localGroups = (Array.isArray(local.concept_groups) ? local.concept_groups : [])
    .filter(Boolean)
    .map(normalizeGroup)
    .filter((g) => g.pali_terms.length > 0 || g.pali_stems.length > 0 || g.english_keywords.length > 0 || (g.local_keywords?.length || 0) > 0);

  // Merge AI concept groups with any non-overlapping local concept groups (up to 4)
  const conceptGroups = [...aiGroups];
  const groupTokens = (g) => new Set([
    g.concept.toLowerCase(),
    ...g.pali_terms.map((t) => t.toLowerCase()),
    ...g.pali_stems.map((s) => s.toLowerCase()),
    ...g.english_keywords.map((e) => e.toLowerCase()),
  ]);
  for (const lg of localGroups) {
    if (conceptGroups.length >= 4) break;
    const lToks = groupTokens(lg);
    const overlaps = conceptGroups.some((existing) => {
      const eToks = groupTokens(existing);
      for (const tok of lToks) {
        if (tok.length >= 3 && eToks.has(tok)) return true;
      }
      return false;
    });
    if (!overlaps) {
      conceptGroups.push(lg);
    }
  }
  conceptGroups.splice(4);

  const canonicalTerms = Array.from(new Set([
    ...(Array.isArray(base.canonical_pali_terms) ? base.canonical_pali_terms : []),
    ...conceptGroups.flatMap((g) => g.pali_terms),
    ...(Array.isArray(local.canonical_pali_terms) ? local.canonical_pali_terms : []),
  ])).filter(Boolean).slice(0, 12);

  const paliStems = Array.from(new Set([
    ...(Array.isArray(base.pali_stems) ? base.pali_stems : []),
    ...conceptGroups.flatMap((g) => g.pali_stems),
    ...(Array.isArray(local.pali_stems) ? local.pali_stems : []),
  ])).filter(Boolean).slice(0, 12);

  const targetSuttas = Array.from(new Set([
    ...(Array.isArray(local.target_sutta_names) ? local.target_sutta_names : []),
    ...(Array.isArray(base.target_sutta_names) ? base.target_sutta_names : []),
  ])).filter(Boolean).slice(0, 6);

  // Pick one primary single-word Pāḷi term per concept group first so multi-concept questions
  // fetch bold definitions across ALL concepts (e.g. both "kodha" and "mettā").
  const groupPrimaryBoldTerms = conceptGroups
    .map((g) => (g.pali_terms || []).find((t) => !/\s/.test(t) && t.length >= 3))
    .filter(Boolean);

  const keyTermsForBoldDef = Array.from(new Set([
    ...(Array.isArray(base.key_terms_for_bold_def) ? base.key_terms_for_bold_def : []),
    ...groupPrimaryBoldTerms,
    ...(Array.isArray(local.key_terms_for_bold_def) ? local.key_terms_for_bold_def : []),
    ...canonicalTerms.filter((t) => !/\s/.test(t) && t.length >= 3),
  ])).slice(0, 3);

  // Preserve explicit Piṭaka / Nikāya scope without letting generic heuristic defaults
  // pollute AI-selected Vinaya/Abhidhamma/Khuddaka scope.
  const aiCats = Array.from(new Set(base.recommended_locations?.categories || base.recommended_locations?.pitakas || [])).filter(Boolean);
  const aiNiks = Array.from(new Set(base.recommended_locations?.nikayas || [])).filter(Boolean);
  const localCats = Array.from(new Set(local.recommended_locations?.categories || local.recommended_locations?.pitakas || [])).filter(Boolean);
  const localNiks = Array.from(new Set(local.recommended_locations?.nikayas || [])).filter(Boolean);
  const hasExplicitLocalScope = local.source && local.source !== "heuristic_general";
  const hasAiScope = aiCats.length > 0 || aiNiks.length > 0;

  const recLoc = {
    categories: hasAiScope
      ? Array.from(new Set([...aiCats, ...(hasExplicitLocalScope ? localCats : [])]))
      : localCats,
    nikayas: hasAiScope
      ? Array.from(new Set([...aiNiks, ...(hasExplicitLocalScope ? localNiks : [])]))
      : localNiks,
    books: Array.from(new Set([
      ...(local.recommended_locations?.books || []),
      ...(base.recommended_locations?.books || []),
    ])).filter(Boolean),
  };

  return {
    intent: base.intent || local.intent || "doctrinal_explanation",
    detected_language: detectedLang,
    core_question: base.core_question || local.core_question || userQuery,
    concept_groups: conceptGroups,
    canonical_pali_terms: canonicalTerms,
    pali_stems: paliStems,
    english_keywords: Array.from(new Set(conceptGroups.flatMap((g) => g.english_keywords))),
    needs_bold_definitions: base.needs_bold_definitions !== undefined
      ? Boolean(base.needs_bold_definitions)
      : (local.needs_bold_definitions !== undefined ? Boolean(local.needs_bold_definitions) : keyTermsForBoldDef.length > 0),
    key_terms_for_bold_def: keyTermsForBoldDef,
    target_sutta_names: targetSuttas,
    recommended_locations: recLoc,
    default_sutta_para: local.default_sutta_para ?? base.default_sutta_para ?? null,
    translation_languages: transLangs,
    initial_search_strategy: (Array.isArray(base.initial_search_strategy) && base.initial_search_strategy.length > 0)
      ? base.initial_search_strategy
      : (Array.isArray(local.initial_search_strategy) ? local.initial_search_strategy : []),
    user_facing_summary: base.user_facing_summary || local.user_facing_summary || `Investigating canonical sources for: "${userQuery}"`,
    source: aiUnd ? "ai_concept_decomposer" : (local.source || "heuristic_fallback"),
  };
}

function scorePassageLayer(bookCode) {
  const c = String(bookCode || "").toLowerCase();
  if (c.includes(".mul")) return 4;
  if (c.includes(".att")) return 3;
  if (c.includes(".tik")) return 2;
  return 1;
}

export function mergeAndRankPassages(passages = []) {
  const byKey = new Map();
  for (const p of passages) {
    if (!p || !p.book_code) continue;
    const key = `${p.book_code}:${p.chapter_index ?? 0}:${p.para_index ?? p.para_num ?? 0}`;
    const existing = byKey.get(key);
    const hasFullPali = Boolean(p.pali && p.pali.length > 20);
    const hasTranslations = Boolean(p.translations && Object.keys(p.translations).length > 0);
    if (!existing) {
      byKey.set(key, { ...p, _isFull: hasFullPali || hasTranslations });
    } else {
      // Upgrade snippet entry with full paragraph content & merge matched concepts
      const mergedConcepts = Array.from(new Set([
        ...(existing.matched_concepts || []),
        ...(p.matched_concepts || []),
      ]));
      const mergedTranslations = {
        ...(existing.translations || {}),
        ...(p.translations || {}),
      };
      byKey.set(key, {
        ...existing,
        ...p,
        pali: p.pali || existing.pali,
        text: p.text || existing.text,
        snippet: p.snippet || existing.snippet,
        sutta_title: p.sutta_title || existing.sutta_title,
        chapter_title: p.chapter_title || existing.chapter_title,
        book_title: p.book_title || existing.book_title,
        translations: Object.keys(mergedTranslations).length > 0 ? mergedTranslations : undefined,
        matched_concepts: mergedConcepts,
        concept_coverage: Math.max(existing.concept_coverage || 0, p.concept_coverage || 0),
        _isFull: Boolean(existing._isFull || hasFullPali || hasTranslations),
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (Boolean(b._isFull) !== Boolean(a._isFull)) return b._isFull ? 1 : -1;
    const covDiff = (b.matched_concepts?.length || 0) - (a.matched_concepts?.length || 0);
    if (covDiff !== 0) return covDiff;
    return scorePassageLayer(b.book_code) - scorePassageLayer(a.book_code);
  });
}

export function buildEvidenceContextBlock(allCollectedEvidence) {
  let evidenceContext = "## RETRIEVED CANONICAL EVIDENCE FOR SYNTHESIS:\n\n";

  // Deduplicate sections
  const uniqueSections = [];
  const seenSec = new Set();
  for (const s of allCollectedEvidence.sections || []) {
    const k = `${s.book_code}:${s.chapter_index}:${s.para_index}`;
    if (!seenSec.has(k)) {
      seenSec.add(k);
      uniqueSections.push(s);
    }
  }

  if (uniqueSections.length > 0) {
    evidenceContext += "### Canonical Suttas & Sections Discovered:\n";
    for (const s of uniqueSections.slice(0, 6)) {
      evidenceContext += `- ${s.title} (${s.book_title || s.book_code}) ${s.citation_ref || `[${s.book_code}:c${s.chapter_index}:p${s.para_index}]`}: ${(s.snippet || "").slice(0, 220)}\n`;
    }
    evidenceContext += "\n";
  }

  const rankedPassages = mergeAndRankPassages(allCollectedEvidence.passages || []);
  if (rankedPassages.length > 0) {
    evidenceContext += "### Authentic Discourse Passages (Pāḷi & Translations):\n";
    for (const p of rankedPassages.slice(0, 12)) {
      const cite = p.citation_ref || `[${p.book_code}:c${p.chapter_index ?? 0}:p${p.para_index ?? 0}]`;
      const heading = p.sutta_title || p.chapter_title || p.book_title || p.book_code;
      const conceptTag = p.matched_concepts?.length ? ` • Concepts: ${p.matched_concepts.join(", ")}` : "";
      evidenceContext += `#### ${heading} §${p.para_num || p.para_index} ${cite}${conceptTag}:\n`;
      const paliBody = p.pali || p.text || p.snippet || "";
      if (paliBody) evidenceContext += `> Pāḷi: "${String(paliBody).slice(0, 650)}"\n`;
      if (p.translations && typeof p.translations === "object") {
        for (const [lang, txt] of Object.entries(p.translations)) {
          if (txt) evidenceContext += `> Translation [${lang}]: "${String(txt).slice(0, 600)}"\n`;
        }
      } else {
        if (p.translation_en) evidenceContext += `> Translation [en]: "${String(p.translation_en).slice(0, 600)}"\n`;
        if (p.translation_vi) evidenceContext += `> Translation [vi]: "${String(p.translation_vi).slice(0, 600)}"\n`;
      }
      evidenceContext += "\n";
    }
  }

  // Canonical & Commentarial Bold Definitions
  const uniqueBoldDefs = [];
  const seenBold = new Set();
  for (const d of allCollectedEvidence.boldDefinitions || []) {
    const k = `${d.book_code}:${d.chapter_index}:${d.para_index}:${d.line_id}:${d.word}`;
    if (!seenBold.has(k)) {
      seenBold.add(k);
      uniqueBoldDefs.push(d);
    }
  }
  if (uniqueBoldDefs.length > 0) {
    evidenceContext += "### Canonical & Commentarial Bold Definitions (Aṭṭhakathā / Ṭīkā / Mūla):\n";
    for (const d of uniqueBoldDefs.slice(0, 8)) {
      evidenceContext += `- **${d.word}** — ${d.book_title} (${d.category}) ${d.citation_ref}:\n`;
      evidenceContext += `  > Pāḷi: "${String(d.pali_definition || "").slice(0, 420)}"\n`;
      if (d.translations && typeof d.translations === "object") {
        for (const [lang, txt] of Object.entries(d.translations)) {
          if (txt) evidenceContext += `  > Translation [${lang}]: "${String(txt).slice(0, 380)}"\n`;
        }
      }
    }
    evidenceContext += "\n";
  }

  if (allCollectedEvidence.sentences && allCollectedEvidence.sentences.length > 0) {
    evidenceContext += "### Sentence-Level Aligned Evidence (Pāḷi ↔ Translations, Shared line_id):\n";
    for (const s of allCollectedEvidence.sentences.slice(0, 6)) {
      evidenceContext += `#### Sentence Source [${s.book_code}:c${s.chapter_index}:p${s.para_index}]:\n`;
      for (const ps of (s.pali_sentences || []).slice(0, 20)) {
        evidenceContext += `- L${ps.line_id}: "${ps.sentence || ps.text}"\n`;
        for (const [lang, trs] of Object.entries(s.translations || {})) {
          const tr = (trs || []).find((t) => t.line_id === ps.line_id);
          if (tr) evidenceContext += `  → [${lang}] L${tr.line_id}: "${tr.translation}"\n`;
        }
      }
      evidenceContext += `Citations: ${(s.pali_sentences || []).map((ps) => `[${s.book_code}:c${s.chapter_index}:p${s.para_index}-L${ps.line_id}]`).join(" ")}\n\n`;
    }
  }

  if (allCollectedEvidence.commentaries && allCollectedEvidence.commentaries.length > 0) {
    evidenceContext += "### Aṭṭhakathā & Ṭīkā Clarifications:\n";
    for (const c of allCollectedEvidence.commentaries.slice(0, 4)) {
      if (c.atthakatha?.[0]) {
        const a = c.atthakatha[0];
        evidenceContext += `- **${a.book_title}** ${a.citation_ref}: "${(a.pali_text || "").slice(0, 420)}"\n`;
        if (a.translation_en) evidenceContext += `  → [en]: "${String(a.translation_en).slice(0, 380)}"\n`;
      }
      if (c.tika?.[0]) {
        const t = c.tika[0];
        evidenceContext += `- **${t.book_title}** ${t.citation_ref}: "${(t.pali_text || "").slice(0, 360)}"\n`;
      }
    }
    evidenceContext += "\n";
  }

  const uniqueDict = [];
  const seenDict = new Set();
  for (const d of allCollectedEvidence.dictionaries || []) {
    const k = `${d.word}:${String(d.definition || "").slice(0, 40)}`;
    if (!seenDict.has(k)) {
      seenDict.add(k);
      uniqueDict.push(d);
    }
  }
  if (uniqueDict.length > 0) {
    evidenceContext += "### Digital Pāḷi Dictionary (DPD) Grammar & Etymology:\n";
    for (const d of uniqueDict.slice(0, 6)) {
      evidenceContext += `- **${d.word}**: ${(d.definition || "").slice(0, 360)}\n`;
    }
    evidenceContext += "\n";
  }

  return evidenceContext;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const kAiDefaultToolSystemPrompt = `You are Ani (AI Nissaya), the dedicated scholarly AI assistant for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is to systematically investigate the Dhamma through precise canonical research using the available database tools.

## Research & Verification Strategy (Concept-Group & Deep Canonical Reasoning)
1. **Review Step 1 Concept Groups & Bootstrap Hits**: Initial concept-group hits, sutta sections, and bold definitions may already be supplied below. Do NOT redundantly re-run identical queries.
2. **Targeted Multi-Concept Discovery**: If additional perspectives or specific Nikāyas/Piṭakas are needed, call \`search_concepts\` with refined concept groups (Pāḷi stems + English synonyms) or \`search_by_category\`.
3. **Verify Full Passages & Sentences**:
   - Call \`get_paragraph_content_batch\` (or \`get_paragraph_content\`) on the best candidate Mūla passages so your answer quotes authentic full Pāḷi text + translations rather than truncated snippets.
   - For verse/sentence-level precision or line-by-line analysis, call \`get_sentences\` (shared line_id, 99.7% Pāḷi↔translation match).
4. **Canonical Bold Definitions, Commentaries & Lexicon**:
   - For doctrinal term definitions, use \`get_bold_definitions\` / \`get_bold_definitions_batch\` (387k pre-indexed Aṭṭhakathā/Ṭīkā/Mūla definitions with \`[book:cX:pY-LZ]\` citations).
   - Consult \`get_commentaries\` for key Mūla paragraphs and \`get_dictionary_batch\` for DPD etymology/grammar/compounds.
5. **Parallel Batching & Prompt Completion**:
   - Issue MULTIPLE independent tool calls together in the SAME turn (e.g., \`get_paragraph_content_batch\`, \`get_commentaries\`, and \`get_dictionary_batch\` in one round instead of separate one-tool turns).
   - Aim to complete verification in 1–2 tool rounds and call \`final_answer(summary)\` promptly once authentic canonical evidence is verified.`;

function buildAnswerSystemPrompt({ groundRAGMode = true, languageDirective = "" }) {
  const grounding = groundRAGMode
    ? `## RAG Mode Rules (Strict Grounding)
1. Every factual claim MUST be supported by an inline citation:
   - Paragraph citation: [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{start}-{end}]
   - Sentence / Bold Definition citation: [book_code:c{chap}:p{para}-L{line}] (e.g. [s0101m.mul:c0:p6-L2])
2. Answer the user's question using ONLY the canonical passages, bold definitions, commentaries, sentence translations, and dictionary entries gathered during research.
3. Quote Pāḷi verses or phrases EXACTLY as written in the sources (use Markdown blockquotes); provide clear translations following each quote.
4. Clearly distinguish Mūla (root canon), Aṭṭhakathā (commentary), Ṭīkā (sub-commentary), and DPD (dictionary) sources.
5. If the retrieved sources do not fully answer the question, state this honestly without fabricating citations.
6. Explain technical Pāḷi terms on first mention with clear etymology and canonical definition.`
    : `## Knowledge Mode Rules (Canonical + Contextual Knowledge)
1. Base your answer primarily on the canonical passages, bold definitions, and sentence translations retrieved by the tools, with inline citations [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{para}-L{line}].
2. You may supplement with broader canonical knowledge where helpful, clearly distinguishing cited canonical evidence from broader exposition.
3. Quote Pāḷi accurately, with translation following.`;

  return `You are Ani (AI Nissaya), the scholarly Pāḷi Canon companion on tipitakapali.org.
You have been supplied with verified passages, canonical bold definitions, sentence translations, commentaries, and dictionary entries from the Chaṭṭha Saṅgāyana Tipiṭaka database.

## Language Directive
${languageDirective || LANG_DIRECTIVES.en}

## Task
Write a comprehensive, insightful, and clearly structured answer to the user's question using rich Markdown (headers, bullet points, comparison tables where useful, and blockquotes for Pāḷi quotes).

## Citation Format
All canonical citations MUST appear as clickable chips in square brackets:
  - Paragraph level: [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_start}-{para_end}]
  - Sentence / Bold Definition level: [book_code:c{chapter_index}:p{para_index}-L{line_id}] (e.g. [s0101m.mul:c0:p6-L2])
Example:
  > "Atha kho bhagavā ambalaṭṭhikāyaṃ rājāgārake ekarattivāsaṃ upagacchi..." [s0101m.mul:c0:p6-L1]

${grounding}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPACT TOOL RESPONSE FORMATTER
// ═══════════════════════════════════════════════════════════════════════════

function formatCompactToolResponse(toolName, result) {
  if (!result || !result.success) {
    return { error: result?.error || "Tool execution produced no result" };
  }

  switch (toolName) {
    case "search_concepts":
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
          snippet: (p.snippet || p.text || "").slice(0, 260),
        })),
      };
    case "get_bold_definitions":
    case "get_bold_definitions_batch":
      return {
        count: result.definitions?.length || 0,
        definitions: (result.definitions || []).slice(0, 6).map((d) => ({
          word: d.word,
          book_title: d.book_title,
          category: d.category,
          citation: d.citation_ref,
          pali_definition: (d.pali_definition || "").slice(0, 360),
          translations: Object.fromEntries(
            Object.entries(d.translations || {}).slice(0, 2).map(([k, v]) => [k, String(v || "").slice(0, 300)])
          ),
        })),
      };
    case "search_sections":
      return {
        count: result.results?.length || 0,
        matches: (result.results || []).slice(0, 8).map((r) => ({
          title: r.title,
          book_code: r.book_code,
          chapter_index: r.chapter_index,
          para_index: r.para_index,
          citation: r.citation_ref,
          snippet: (r.snippet || "").slice(0, 200),
        })),
      };
    case "search_tipitaka":
    case "search_tipitaka_batch":
    case "search_by_category":
      return {
        count: result.results?.length || 0,
        passages: (result.results || []).slice(0, 8).map((p) => ({
          book_code: p.book_code,
          chapter_title: p.chapter_title,
          sutta_title: p.sutta_title,
          para_index: p.para_index,
          citation: p.citation_ref,
          snippet: (p.snippet || p.text || "").slice(0, 250),
        })),
      };
    case "get_paragraph_content":
    case "get_paragraph_content_batch":
      return {
        count: result.passages?.length || 0,
        passages: (result.passages || []).slice(0, 6).map((p) => ({
          book_code: p.book_code,
          chapter_index: p.chapter_index,
          para_index: p.para_index,
          para_num: p.para_num,
          citation: p.citation_ref,
          pali: (p.pali || "").slice(0, 500),
          translations: Object.fromEntries(
            Object.entries(p.translations || {}).slice(0, 2).map(([k, v]) => [k, String(v || "").slice(0, 450)])
          ),
        })),
      };
    case "get_sentences":
      return {
        count: result.count || 0,
        book_code: result.book_code,
        chapter_index: result.chapter_index,
        para_index: result.para_index,
        pali_sentences: (result.pali_sentences || []).slice(0, 25).map((s) => ({
          line_id: s.line_id,
          text: (s.sentence || s.text || "").slice(0, 300),
        })),
        translations: Object.fromEntries(
          Object.entries(result.translations || {}).map(([k, v]) => [
            k,
            (v || []).slice(0, 25).map((t) => ({
              line_id: t.line_id,
              text: (t.translation || "").slice(0, 300),
            })),
          ])
        ),
      };
    case "get_commentaries":
      return {
        source: result.source,
        atthakatha: (result.atthakatha || []).slice(0, 2).map((a) => ({
          book_code: a.book_code,
          title: a.book_title,
          citation: a.citation_ref,
          pali: (a.pali_text || "").slice(0, 450),
          ...(a.translation_en ? { translation_en: String(a.translation_en).slice(0, 380) } : {}),
        })),
        tika: (result.tika || []).slice(0, 2).map((t) => ({
          book_code: t.book_code,
          title: t.book_title,
          citation: t.citation_ref,
          pali: (t.pali_text || "").slice(0, 450),
        })),
      };
    case "get_dictionary":
    case "get_dictionary_batch":
      return {
        count: result.entries?.length || 0,
        entries: (result.entries || []).slice(0, 5).map((e) => ({
          word: e.word,
          definition: (e.definition || "").slice(0, 400),
        })),
      };
    case "get_headings":
      return {
        count: result.headings?.length || 0,
        headings: (result.headings || []).slice(0, 10).map((h) => ({
          title: h.title,
          type: h.type,
          para_index: h.para_index,
        })),
      };
    case "get_section":
      return {
        book_code: result.book_code,
        title: result.title || result.chapter_title,
        summary: (typeof result.summary === "string" ? result.summary : (result.summary?.content || "")).slice(0, 400),
      };
    default:
      return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SAFE LOCAL DATABASE TOOL CALL (ZERO API KEY SENT OVER THE WIRE)
// ═══════════════════════════════════════════════════════════════════════════

async function executeRemoteAiTool(name, args, signal) {
  // CRITICAL: We only pass { name, args }. ZERO API KEY is sent to our backend!
  const res = await fetchAiEndpoint("/api/ai/tool-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args: args || {} }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Tool ${name} failed with status ${res.status}`);
  }
  return res.json();
}

async function fetchLocalHeuristicUnderstanding(userQuery, conversationHistory, signal) {
  try {
    const res = await fetchAiEndpoint("/api/ai/understand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: userQuery,
        conversationHistory: (conversationHistory || []).slice(-4),
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.success && data.understanding) return data.understanding;
    }
  } catch (_) {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CLIENT-SIDE CITATION EXTRACTOR & CANONICAL ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════

function buildEvidenceMetadataIndex(evidence) {
  const map = new Map();
  if (!evidence) return map;
  const register = (bookCode, meta) => {
    if (!bookCode) return;
    const prev = map.get(bookCode) || {};
    map.set(bookCode, {
      bookTitle: meta.bookTitle || prev.bookTitle || bookCode,
      category: meta.category || prev.category || "",
      nikaya: meta.nikaya || prev.nikaya || "",
      chapterTitle: meta.chapterTitle || prev.chapterTitle || "",
    });
  };
  for (const p of evidence.passages || []) {
    register(p.book_code, { bookTitle: p.book_title, nikaya: p.nikaya, chapterTitle: p.sutta_title || p.chapter_title });
  }
  for (const s of evidence.sections || []) {
    register(s.book_code, { bookTitle: s.book_title, chapterTitle: s.title });
  }
  for (const d of evidence.boldDefinitions || []) {
    register(d.book_code, { bookTitle: d.book_title, category: d.category });
  }
  for (const c of evidence.commentaries || []) {
    for (const a of c.atthakatha || []) register(a.book_code, { bookTitle: a.book_title, category: "aṭṭhakathā" });
    for (const t of c.tika || []) register(t.book_code, { bookTitle: t.book_title, category: "ṭīkā" });
  }
  return map;
}

export function isLikelyCanonicalBookCode(rawBook, hasExplicitChap = false) {
  if (!rawBook) return false;
  const raw = String(rawBook).trim();
  const low = raw.toLowerCase();
  if (/^\d+$/.test(low)) return false;
  if (/\.(?:mul|att|tik|nrf)$/i.test(raw)) return true;
  if (/^(?:dn|mn|sn|an|vin|abh|khp|dhp|ud|it|iti|snp|vv|pv|thag|thig|ja|jat|vism|mil)\d*(?:\.\d+)?$/i.test(low)) return true;
  if (/^[dmsa]-(?:i|ii|iii|iv|v)$/i.test(low)) return true;
  if (hasExplicitChap && /^(?:s0|vin|abh|e0)[a-z0-9_.-]+$/i.test(raw)) return true;
  return false;
}

export function parseCitationsFromText(text, evidence = null) {
  if (!text) return [];
  // Supports [book:c{chap}:p{para}], [book:c{chap}:p{start}-{end}], [book:c{chap}:p{start}-p{end}], [book:{para}], [book:c{chap}:p{para}-L{line}] and [book:c{chap}:p{para}:L{line}]
  const regex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–](?:([Ll])|[Pp])?(\d+))?(?::[Ll]?(\d+))?\]/g;
  const metaIndex = buildEvidenceMetadataIndex(evidence);
  const seen = new Set();
  const citations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[0];
    const rawBook = match[1];
    const hasExplicitChap = match[2] !== undefined;
    if (!isLikelyCanonicalBookCode(rawBook, hasExplicitChap) && !metaIndex.has(rawBook)) continue;
    const chapIdx = hasExplicitChap ? parseInt(match[2], 10) : 0;
    const paraIdx = parseInt(match[3], 10);
    const isDashLine = Boolean(match[4]);
    const paraEnd = !isDashLine && match[5] ? parseInt(match[5], 10) : null;
    const lineId = isDashLine && match[5] ? parseInt(match[5], 10) : (match[6] ? parseInt(match[6], 10) : null);

    const key = `${rawBook}:${chapIdx}:${paraIdx}:${lineId || ""}:${paraEnd || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      const meta = metaIndex.get(rawBook) || {};
      const citationRef = lineId
        ? `[${rawBook} §${paraIdx}:L${lineId}]`
        : paraEnd
        ? `[${rawBook} §${paraIdx}–${paraEnd}]`
        : `[${rawBook} §${paraIdx}]`;

      citations.push({
        rawTag,
        rawBook,
        bookCode: rawBook,
        bookTitle: meta.bookTitle || rawBook,
        category: meta.category || "",
        nikaya: meta.nikaya || "",
        chapterTitle: meta.chapterTitle || "",
        chapterIndex: chapIdx,
        paraIndex: paraIdx,
        paraEnd,
        lineId,
        citationRef,
        ref: rawTag,
      });
    }
  }
  return citations;
}

function accumulateToolEvidence(allCollectedEvidence, toolName, resObj) {
  if (!resObj) return;
  if (toolName === "search_sections" && resObj.results) {
    allCollectedEvidence.sections.push(...resObj.results);
  } else if ((toolName === "search_concepts" || toolName === "search_tipitaka" || toolName === "search_tipitaka_batch" || toolName === "search_by_category") && resObj.results) {
    allCollectedEvidence.passages.push(...resObj.results);
  } else if ((toolName === "get_paragraph_content" || toolName === "get_paragraph_content_batch") && resObj.passages) {
    allCollectedEvidence.passages.push(...resObj.passages);
  } else if ((toolName === "get_bold_definitions" || toolName === "get_bold_definitions_batch") && resObj.definitions) {
    allCollectedEvidence.boldDefinitions.push(...resObj.definitions);
  } else if (toolName === "get_sentences" && resObj.pali_sentences) {
    allCollectedEvidence.sentences.push(resObj);
  } else if (toolName === "get_commentaries" && (resObj.atthakatha || resObj.tika)) {
    allCollectedEvidence.commentaries.push(resObj);
  } else if ((toolName === "get_dictionary" || toolName === "get_dictionary_batch") && resObj.entries) {
    allCollectedEvidence.dictionaries.push(...resObj.entries);
  }
}

function formatToolSummaryArg(spec) {
  if (!spec?.args) return "";
  if (Array.isArray(spec.args.concept_groups) && spec.args.concept_groups.length > 0) {
    return spec.args.concept_groups.map((g) => g.concept || g).filter(Boolean).join(" + ");
  }
  return (
    spec.args.query ||
    spec.args.queries?.[0] ||
    spec.args.word ||
    spec.args.words?.join(", ") ||
    (spec.args.book_code
      ? `${spec.args.book_code}${spec.args.para_index !== undefined ? ` p${spec.args.para_index}` : ""}${spec.args.line_id ? ` L${spec.args.line_id}` : ""}`
      : "")
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN CLIENT-SIDE AI AGENT RUNNER (ZERO KEY ESCAPES TO BACKEND)
// ═══════════════════════════════════════════════════════════════════════════

export async function runClientAiAgent({
  userQuery,
  conversationHistory = [],
  aiSettings,
  onStatus = () => {},
  onUnderstanding = () => {},
  onToolCall = () => {},
  onToken = () => {},
  onCitations = () => {},
  onDone = () => {},
  onError = () => {},
  signal,
}) {
  const apiKey = (aiSettings?.apiKey || "").trim();
  const provider = aiSettings?.provider || "gemini";
  const toolModel = aiSettings?.toolModel || "gemini-flash-lite-latest";
  const answerModel = aiSettings?.answerModel || "gemini-flash-lite-latest";
  let activeToolModel = toolModel;
  let activeAnswerModel = answerModel;
  const groundRAGMode = aiSettings?.groundRAGMode !== false;
  const customSystemPrompt = aiSettings?.customSystemPrompt || "";
  const baseUrl = aiSettings?.baseUrl || "";

  if (!apiKey && provider !== "custom") {
    const err = new Error("No API key configured. Please configure your key in Settings.");
    err.requiresKey = true;
    onError(err);
    return;
  }

  const openAiEndpoint = (baseUrl && baseUrl.trim())
    ? `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`
    : provider === "openrouter"
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  const buildOpenAiHeaders = () => {
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://tipitakapali.org";
      headers["X-Title"] = "tipitakapali.org";
    }
    return headers;
  };

  const safeHistory = sanitizeConversationHistory(conversationHistory, userQuery);

  try {
    // ── STEP 1: CONCEPT-GROUP DECOMPOSITION & LOCAL GROUNDING (ALL PROVIDERS) ──
    onStatus("🧠 Step 1: Breaking question into concept groups, Pāḷi terms & English synonyms…");

    const understandingPrompt = buildUnderstandingPrompt(userQuery, safeHistory);
    const localPromise = fetchLocalHeuristicUnderstanding(userQuery, safeHistory, signal);

    const llmUnderstandPromise = (async () => {
      try {
        if (provider === "gemini") {
          const { res: uRes, modelUsed, cleanupAbort } = await fetchGeminiWithRetry({
            model: activeToolModel,
            action: "generateContent",
            apiKey,
            payload: {
              contents: [{ role: "user", parts: [{ text: understandingPrompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 4096 },
            },
            thinkingLevel: "minimal",
            signal,
            timeoutMs: 35000,
            maxRetries: 1,
            allowFallback: true,
            onStatus,
          });
          try {
            if (uRes.ok) {
              if (modelUsed && modelUsed !== activeToolModel) {
                if (activeAnswerModel === activeToolModel) activeAnswerModel = modelUsed;
                activeToolModel = modelUsed;
              }
              const uJson = await uRes.json();
              const text = extractGeminiTextFromParts(uJson.candidates?.[0]?.content?.parts);
              return parseJsonResponse(text);
            }
          } finally {
            cleanupAbort?.();
          }
        } else {
          // OpenAI / OpenRouter / Custom / Ollama
          const basePayload = {
            model: toolModel || "gpt-4o-mini",
            messages: [{ role: "user", content: understandingPrompt }],
            temperature: 0.1,
          };
          const useJsonFormat = provider === "openai" || provider === "openrouter";
          let uRes = await fetch(openAiEndpoint, {
            method: "POST",
            headers: buildOpenAiHeaders(),
            body: JSON.stringify(useJsonFormat ? { ...basePayload, response_format: { type: "json_object" } } : basePayload),
            signal,
          });
          // Retry once without response_format if the model/provider rejects json_object
          if (!uRes.ok && useJsonFormat && (uRes.status === 400 || uRes.status === 422)) {
            uRes = await fetch(openAiEndpoint, {
              method: "POST",
              headers: buildOpenAiHeaders(),
              body: JSON.stringify(basePayload),
              signal,
            });
          }
          if (uRes.ok) {
            const uJson = await uRes.json();
            const text = uJson.choices?.[0]?.message?.content;
            return parseJsonResponse(text);
          }
        }
      } catch (e) {
        console.warn("Query understanding fallback:", e);
      }
      return null;
    })();

    const [localUnd, aiUnd] = await Promise.all([localPromise, llmUnderstandPromise]);
    const understanding = mergeUnderstandingWithLocal(aiUnd, localUnd, userQuery);
    const targetLangs = understanding.translation_languages?.length ? understanding.translation_languages : ["en"];

    onUnderstanding(understanding);
    if (understanding.user_facing_summary) {
      onStatus(`🧠 ${understanding.user_facing_summary}`);
    }

    const allCollectedEvidence = {
      sections: [],
      passages: [],
      sentences: [],
      boldDefinitions: [],
      commentaries: [],
      dictionaries: [],
    };
    const toolLogs = [];

    // ── STEP 1.5: ZERO-TOKEN PARALLEL LOCAL BOOTSTRAP SEARCH ─────────────
    const bootstrapSpecs = [];
    if (understanding.concept_groups?.length > 0) {
      bootstrapSpecs.push({
        name: "search_concepts",
        args: {
          concept_groups: understanding.concept_groups,
          categories: understanding.recommended_locations?.categories || [],
          nikayas: understanding.recommended_locations?.nikayas || [],
          langs: targetLangs,
          limit: 12,
        },
      });
    }
    if (understanding.target_sutta_names?.length > 0) {
      bootstrapSpecs.push({
        name: "search_sections",
        args: { query: understanding.target_sutta_names[0].replace(/\s*\(.*?\)/, "").trim() },
      });
    }
    if (understanding.needs_bold_definitions && understanding.key_terms_for_bold_def?.length > 0) {
      bootstrapSpecs.push({
        name: "get_bold_definitions_batch",
        args: {
          words: understanding.key_terms_for_bold_def.slice(0, 3),
          langs: targetLangs,
          limit: 4,
        },
      });
    }
    if (understanding.default_sutta_para !== null && understanding.recommended_locations?.books?.[0]) {
      bootstrapSpecs.push({
        name: "get_paragraph_content",
        args: {
          book_code: understanding.recommended_locations.books[0],
          para_start: understanding.default_sutta_para,
          para_end: understanding.default_sutta_para + 4,
          langs: targetLangs,
        },
      });
    }

    let bootstrapDigest = "";
    if (bootstrapSpecs.length > 0) {
      onStatus(`🔍 Gathering initial concept-group passages & canonical bold definitions (${bootstrapSpecs.length} local queries)…`);
      const bootResults = await Promise.allSettled(
        bootstrapSpecs.map((spec) => executeRemoteAiTool(spec.name, spec.args, signal))
      );
      const compactBoot = [];
      for (let i = 0; i < bootstrapSpecs.length; i++) {
        const spec = bootstrapSpecs[i];
        const resObj = bootResults[i].status === "fulfilled"
          ? bootResults[i].value
          : { success: false, error: bootResults[i].reason?.message };
        accumulateToolEvidence(allCollectedEvidence, spec.name, resObj);
        const summaryArg = formatToolSummaryArg(spec);
        const summary = `${spec.name}${summaryArg ? ` (${summaryArg})` : ""}`;
        const logEntry = { tool: spec.name, summary, args: spec.args };
        toolLogs.push(logEntry);
        onToolCall(logEntry);
        if (resObj?.success) {
          compactBoot.push({ tool: spec.name, result: formatCompactToolResponse(spec.name, resObj) });
        }
      }
      if (compactBoot.length > 0) {
        let digestJson = JSON.stringify(compactBoot);
        if (digestJson.length > 5500) {
          const trimmedBoot = compactBoot.map((item) => {
            const res = item.result || {};
            return {
              tool: item.tool,
              result: {
                ...res,
                ...(Array.isArray(res.passages) ? { passages: res.passages.slice(0, 5) } : {}),
                ...(Array.isArray(res.definitions) ? { definitions: res.definitions.slice(0, 4) } : {}),
                ...(Array.isArray(res.matches) ? { matches: res.matches.slice(0, 5) } : {}),
              },
            };
          });
          digestJson = JSON.stringify(trimmedBoot);
        }
        bootstrapDigest = `\n\n## INITIAL CONCEPT-GROUP & BOLD-DEFINITION RESULTS (Already Retrieved — Verify Top Candidates with get_paragraph_content_batch / get_sentences / get_commentaries / get_dictionary_batch):\n${digestJson}`;
      }
    }

    // ── STEP 2: MULTI-STEP CANONICAL VERIFICATION LOOP ───────────────────
    onStatus("Verifying canonical passages, commentaries & etymology with scholarly agent…");

    let toolSystemPrompt = customSystemPrompt?.trim() || kAiDefaultToolSystemPrompt;
    const conceptLines = (understanding.concept_groups || [])
      .map((g, i) => `  ${i + 1}. ${g.concept} — Pāḷi: [${(g.pali_terms || []).join(", ")}] | Stems: [${(g.pali_stems || []).join(", ")}] | English: [${(g.english_keywords || []).join(", ")}]`)
      .join("\n");

    toolSystemPrompt += `\n\n## STEP 1 CONCEPT-GROUP DECOMPOSITION:
- Intent: ${understanding.intent}
- User Language: ${understanding.detected_language} (Translation langs: ${targetLangs.join(", ")})
- Main Concept Groups:\n${conceptLines || "  None"}
- Target Suttas: ${(understanding.target_sutta_names || []).join(", ") || "None"}
- Key Terms for Bold Definitions: ${(understanding.key_terms_for_bold_def || []).join(", ") || "None"}
Read full Pāḷi paragraphs & translations for the strongest candidate citations using get_paragraph_content_batch (or get_sentences for verse/sentence precision), consult get_commentaries / get_dictionary_batch if needed, and call final_answer promptly once verified.`;

    const maxIterations = 5;
    let iterations = 0;
    let toolsDone = false;

    const initialToolUserPrompt = `Inquiry: "${userQuery}"${bootstrapDigest}\n\nInspect the initial hits above (if any), fetch full text for the strongest canonical passages, run any needed follow-up search_concepts / get_bold_definitions / get_commentaries / get_dictionary_batch calls, and call final_answer when evidence is complete.`;

    const enrichToolArgs = (name, args) => {
      const next = { ...(args || {}) };
      if (
        (name === "get_paragraph_content" ||
          name === "get_sentences" ||
          name === "get_bold_definitions" ||
          name === "get_bold_definitions_batch" ||
          name === "search_concepts" ||
          name === "search_tipitaka") &&
        !next.langs
      ) {
        next.langs = targetLangs;
      }
      if (name === "get_paragraph_content_batch" && Array.isArray(next.ranges)) {
        next.ranges = next.ranges.map((r) => (r && !r.langs ? { ...r, langs: targetLangs } : r));
      }
      return next;
    };

    if (provider === "gemini") {
      const conversation = [];
      for (const msg of safeHistory) {
        conversation.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content.substring(0, 400) }],
        });
      }
      conversation.push({ role: "user", parts: [{ text: initialToolUserPrompt }] });

      while (!toolsDone && iterations < maxIterations) {
        if (signal?.aborted) throw new Error("Inquiry cancelled by user");
        iterations++;

        const payload = {
          system_instruction: { parts: [{ text: toolSystemPrompt }] },
          contents: conversation,
          tools: [{ functionDeclarations: kAiToolDeclarations }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        };

        let toolRes;
        let cleanupToolAbort;
        try {
          const out = await fetchGeminiWithRetry({
            model: activeToolModel,
            action: "generateContent",
            apiKey,
            payload,
            thinkingLevel: "low",
            signal,
            timeoutMs: 45000,
            maxRetries: 1,
            allowFallback: true,
            onStatus,
          });
          toolRes = out.res;
          cleanupToolAbort = out.cleanupAbort;
          if (out.res?.ok && out.modelUsed && out.modelUsed !== activeToolModel) {
            if (activeAnswerModel === activeToolModel) activeAnswerModel = out.modelUsed;
            activeToolModel = out.modelUsed;
          }
        } catch (err) {
          if (signal?.aborted || err?.name === "AbortError") throw err;
          console.warn("[Gemini Tool Call Error]:", err.message);
          break;
        }

        let resJson;
        try {
          if (!toolRes.ok) {
            const errText = await toolRes.text();
            console.warn(`[Gemini Tool Call HTTP ${toolRes.status}]:`, errText);
            break;
          }
          resJson = await toolRes.json();
        } finally {
          cleanupToolAbort?.();
        }
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
            if (fc.name === "final_answer") hasFinalAnswer = true;
            callSpecs.push({ name: fc.name, args: enrichToolArgs(fc.name, fc.args) });
          } else if (part.text && !part.thought && parts.length === 1) {
            onStatus(`Ani: ${part.text.slice(0, 100)}…`);
          }
        }

        if (callSpecs.length === 0) {
          toolsDone = true;
          break;
        }

        onStatus(`Research step ${iterations}/${maxIterations}: Querying ${callSpecs.length} canonical database tool(s)…`);

        const toolResults = await Promise.allSettled(
          callSpecs.map((spec) => executeRemoteAiTool(spec.name, spec.args, signal))
        );

        const functionResponses = [];
        for (let i = 0; i < callSpecs.length; i++) {
          const spec = callSpecs[i];
          const resObj = toolResults[i].status === "fulfilled"
            ? toolResults[i].value
            : { success: false, error: toolResults[i].reason?.message };
          const compact = formatCompactToolResponse(spec.name, resObj);

          accumulateToolEvidence(allCollectedEvidence, spec.name, resObj);

          const summaryArg = formatToolSummaryArg(spec);
          const summary = `${spec.name}${summaryArg ? ` (${summaryArg})` : ""}`;
          const logEntry = { tool: spec.name, summary, args: spec.args };
          toolLogs.push(logEntry);
          onToolCall(logEntry);

          functionResponses.push({
            functionResponse: {
              name: spec.name,
              response: { content: compact },
            },
          });
        }

        conversation.push({ role: "user", parts: functionResponses });

        if (hasFinalAnswer) {
          toolsDone = true;
          break;
        }
      }
    } else {
      // OpenAI / OpenRouter / Custom direct client
      const openAiTools = getOpenAiToolDeclarations();
      const openAiMessages = [{ role: "system", content: toolSystemPrompt }];
      for (const msg of safeHistory) {
        openAiMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content.substring(0, 400),
        });
      }
      openAiMessages.push({ role: "user", content: initialToolUserPrompt });

      while (!toolsDone && iterations < maxIterations) {
        if (signal?.aborted) throw new Error("Inquiry cancelled by user");
        iterations++;

        const payload = {
          model: toolModel || "gpt-4o-mini",
          messages: openAiMessages,
          tools: openAiTools,
          tool_choice: "auto",
          temperature: 0.2,
        };

        const toolRes = await fetch(openAiEndpoint, {
          method: "POST",
          headers: buildOpenAiHeaders(),
          body: JSON.stringify(payload),
          signal,
        });

        if (!toolRes.ok) {
          const errText = await toolRes.text().catch(() => "");
          console.warn(`[OpenAI/OpenRouter Tool Call HTTP ${toolRes.status}]:`, errText.slice(0, 240));
          break;
        }
        const resJson = await toolRes.json();
        const choice = resJson.choices?.[0];
        const msg = choice?.message;

        if (!msg) {
          toolsDone = true;
          break;
        }

        openAiMessages.push(msg);

        const toolCalls = msg.tool_calls || [];
        if (toolCalls.length === 0) {
          toolsDone = true;
          break;
        }

        let hasFinalAnswer = false;
        const callSpecs = [];
        for (const tc of toolCalls) {
          const fn = tc.function || {};
          let args = {};
          try { args = JSON.parse(fn.arguments || "{}"); } catch (e) {}
          if (fn.name === "final_answer") hasFinalAnswer = true;
          callSpecs.push({ id: tc.id, name: fn.name, args: enrichToolArgs(fn.name, args) });
        }

        onStatus(`Research step ${iterations}/${maxIterations}: Querying ${callSpecs.length} canonical database tool(s)…`);

        const toolResults = await Promise.allSettled(
          callSpecs.map((spec) => executeRemoteAiTool(spec.name, spec.args, signal))
        );

        for (let i = 0; i < callSpecs.length; i++) {
          const spec = callSpecs[i];
          const resObj = toolResults[i].status === "fulfilled"
            ? toolResults[i].value
            : { success: false, error: toolResults[i].reason?.message };
          const compact = formatCompactToolResponse(spec.name, resObj);

          accumulateToolEvidence(allCollectedEvidence, spec.name, resObj);

          const summaryArg = formatToolSummaryArg(spec);
          const summary = `${spec.name}${summaryArg ? ` (${summaryArg})` : ""}`;
          toolLogs.push({ tool: spec.name, summary, args: spec.args });
          onToolCall({ tool: spec.name, summary, args: spec.args });

          openAiMessages.push({
            role: "tool",
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

    // ── AUTOMATIC GROUNDING FALLBACK IF EVIDENCE IS STILL EMPTY ──────────
    if (
      allCollectedEvidence.passages.length === 0 &&
      allCollectedEvidence.boldDefinitions.length === 0 &&
      allCollectedEvidence.sections.length === 0
    ) {
      onStatus("🔍 Conducting fallback full-text search across Pāḷi & translations…");
      try {
        const fbRes = await executeRemoteAiTool("search_tipitaka", { query: userQuery, langs: targetLangs }, signal);
        accumulateToolEvidence(allCollectedEvidence, "search_tipitaka", fbRes);
        if (fbRes?.results?.length > 0) {
          const logEntry = { tool: "search_tipitaka", summary: `search_tipitaka (${userQuery.slice(0, 40)})`, args: { query: userQuery } };
          toolLogs.push(logEntry);
          onToolCall(logEntry);
        }
      } catch (_) {}
    }

    // ── STEP 3: STREAMING CANONICAL SYNTHESIS ─────────────────────────────
    onStatus("Step 3: Synthesizing verified answer with authentic canonical citations…");

    const languageDirective = buildLanguageDirective(understanding.detected_language);
    const answerSysPrompt = buildAnswerSystemPrompt({ groundRAGMode, languageDirective });
    const evidenceContext = buildEvidenceContextBlock(allCollectedEvidence);

    let fullAnswerText = "";
    const synthesisUserPrompt = `${evidenceContext}\nUser Inquiry: "${userQuery}"\n\nWrite a complete, well-structured scholarly explanation strictly following the language directive and citing every passage or bold definition as [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_index}-L{line_id}].`;

    if (provider === "gemini") {
      const baseAnswerContents = [
        ...safeHistory.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        {
          role: "user",
          parts: [{ text: synthesisUserPrompt }],
        },
      ];

      const streamGeminiTurn = async (contents, modelToUse) => {
        const answerPayload = {
          system_instruction: { parts: [{ text: answerSysPrompt }] },
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
        };

        const { res: streamRes, modelUsed, cleanupAbort } = await fetchGeminiWithRetry({
          model: modelToUse,
          action: "streamGenerateContent",
          queryExtra: "alt=sse",
          apiKey,
          payload: answerPayload,
          thinkingLevel: "low",
          signal,
          timeoutMs: 60000,
          maxRetries: 2,
          allowFallback: true,
          onStatus,
        });

        if (!streamRes.ok) {
          cleanupAbort?.();
          throw new Error(`Gemini Stream Error HTTP ${streamRes.status}: ${await streamRes.text()}`);
        }
        if (modelUsed) activeAnswerModel = modelUsed;

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let turnText = "";
        let finishReason = null;
        let sawUsageMetadata = false;

        const processGeminiLine = (line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.usageMetadata) sawUsageMetadata = true;
                const cand = parsed.candidates?.[0];
                if (cand?.finishReason) finishReason = cand.finishReason;
                const textPart = extractGeminiTextFromParts(cand?.content?.parts);
                if (textPart) {
                  turnText += textPart;
                  fullAnswerText += textPart;
                  onToken(textPart);
                }
              } catch (e) {}
            }
          }
        };

        try {
          while (true) {
            if (signal?.aborted) {
              try { await reader.cancel(); } catch (_) {}
              throw Object.assign(new Error("Inquiry cancelled by user"), { name: "AbortError" });
            }
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";

            for (const line of lines) {
              processGeminiLine(line);
            }
          }
          if (buffer.trim()) processGeminiLine(buffer);
        } finally {
          cleanupAbort?.();
        }

        return { turnText, finishReason, sawUsageMetadata, answerPayload };
      };

      const firstStream = await streamGeminiTurn(baseAnswerContents, activeAnswerModel);
      let lastFinishReason = firstStream.finishReason;
      let lastSawUsage = firstStream.sawUsageMetadata;

      // Auto-recover if Gemini's SSE stream silently terminated early (finishReason === null with usageMetadata,
      // or abrupt mid-sentence cut, or MAX_TOKENS).
      const needsContinuation = (reason, sawUsage, text) => {
        if (!text || !text.trim()) return false;
        if (reason === "STOP" || reason === "SAFETY" || reason === "RECITATION") return false;
        if (reason === "MAX_TOKENS") return true;
        if (reason === null) {
          if (sawUsage) return true;
          return !/[.!?。！？။\]\)"'”*]\s*$/.test(text.trim());
        }
        return false;
      };

      const MAX_CONTINUATIONS = 2;
      for (
        let cont = 0;
        cont < MAX_CONTINUATIONS &&
        !signal?.aborted &&
        needsContinuation(lastFinishReason, lastSawUsage, fullAnswerText);
        cont++
      ) {
        onStatus("Completing interrupted response…");
        const contContents = [
          ...baseAnswerContents,
          { role: "model", parts: [{ text: fullAnswerText }] },
          {
            role: "user",
            parts: [
              {
                text: "Your previous response was cut off mid-stream. Continue immediately from the exact character/word where you stopped without repeating anything already written, and finish the answer completely.",
              },
            ],
          },
        ];
        try {
          const nextStream = await streamGeminiTurn(contContents, activeAnswerModel);
          lastFinishReason = nextStream.finishReason;
          lastSawUsage = nextStream.sawUsageMetadata;
          if (!nextStream.turnText) break;
        } catch (contErr) {
          if (signal?.aborted || contErr?.name === "AbortError") throw contErr;
          console.warn("[Gemini Stream Continuation Error]:", contErr.message);
          try {
            onStatus("Completing interrupted response (non-stream fallback)…");
            const { res: contFbRes, modelUsed: contFbModel, cleanupAbort: contFbCleanup } = await fetchGeminiWithRetry({
              model: activeAnswerModel,
              action: "generateContent",
              apiKey,
              payload: {
                system_instruction: { parts: [{ text: answerSysPrompt }] },
                contents: contContents,
                generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
              },
              thinkingLevel: "low",
              signal,
              timeoutMs: 60000,
              maxRetries: 1,
              allowFallback: true,
              onStatus,
            });
            if (contFbModel) activeAnswerModel = contFbModel;
            try {
              if (contFbRes.ok) {
                const contFbJson = await contFbRes.json();
                const contCand = contFbJson.candidates?.[0];
                const contFbText = extractGeminiTextFromParts(contCand?.content?.parts);
                if (contFbText) {
                  fullAnswerText += contFbText;
                  onToken(contFbText);
                  lastFinishReason = contCand?.finishReason || "STOP";
                  lastSawUsage = Boolean(contFbJson.usageMetadata);
                }
              }
            } finally {
              contFbCleanup?.();
            }
          } catch (fbErr) {
            if (signal?.aborted || fbErr?.name === "AbortError") throw fbErr;
            console.warn("[Gemini Non-Stream Continuation Error]:", fbErr.message);
          }
          break;
        }
      }

      if (!fullAnswerText.trim() && !signal?.aborted) {
        onStatus("Retrying synthesis response…");
        const { res: fbRes, cleanupAbort: fbCleanup } = await fetchGeminiWithRetry({
          model: activeAnswerModel,
          action: "generateContent",
          apiKey,
          payload: firstStream.answerPayload,
          thinkingLevel: "low",
          signal,
          timeoutMs: 60000,
          maxRetries: 1,
          allowFallback: true,
          onStatus,
        });
        try {
          if (fbRes.ok) {
            const fbJson = await fbRes.json();
            const fbText = extractGeminiTextFromParts(fbJson.candidates?.[0]?.content?.parts);
            if (fbText) {
              fullAnswerText += fbText;
              onToken(fbText);
            }
          }
        } finally {
          fbCleanup?.();
        }
      }
    } else {
      // OpenAI / OpenRouter / Custom streaming
      const streamRes = await fetch(openAiEndpoint, {
        method: "POST",
        headers: buildOpenAiHeaders(),
        body: JSON.stringify({
          model: answerModel || "gpt-4o",
          messages: [
            { role: "system", content: answerSysPrompt },
            ...safeHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: synthesisUserPrompt },
          ],
          stream: true,
          temperature: 0.3,
        }),
        signal,
      });

      if (!streamRes.ok) {
        throw new Error(`OpenAI Stream Error HTTP ${streamRes.status}: ${await streamRes.text()}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processOpenAiLine = (line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") return true;
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullAnswerText += delta;
              onToken(delta);
            }
          } catch (e) {}
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (processOpenAiLine(line)) break;
        }
      }
      if (buffer.trim()) processOpenAiLine(buffer);
    }

    // Extract & enrich citations
    const citations = parseCitationsFromText(fullAnswerText, allCollectedEvidence);
    onCitations(citations);

    onDone({
      mode: "agentic_client_rag",
      understanding,
      toolCalls: toolLogs,
      evidence: allCollectedEvidence,
    });
  } catch (err) {
    if (err.name === "AbortError" || signal?.aborted) {
      onStatus("Inquiry stopped.");
      onDone({ aborted: true });
      return;
    }
    console.error("[runClientAiAgent Error]:", err);
    onError(err);
  }
}
