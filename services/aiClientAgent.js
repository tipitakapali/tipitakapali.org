'use client';

import { getApiBase } from "./api";

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL TOOL DECLARATIONS FOR CLIENT-SIDE GEMINI & OPENAI
// ═══════════════════════════════════════════════════════════════════════════

export const kAiToolDeclarations = [
  {
    name: "search_sections",
    description:
      "Search section, sutta, and vagga TITLES (with study summaries) across the whole 217-book canon. " +
      "Use this FIRST for concept questions to discover WHICH suttas discuss a topic before reading full passages.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Term, sutta name, or phrase to match against section/sutta titles or summaries (Pāli or English).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_tipitaka",
    description:
      "Search the Tipitaka database for passages using full-text search across Pāḷi Canon and English translations. " +
      "Returns matching passages with book codes, chapter titles, paragraph numbers, and text snippets.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Search query — a phrase, compound, or keywords to search for in the Pāli text or translation.",
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
          description: "Translation languages to retrieve: [\"en\"], [\"vi\"], [\"my\"], etc. Defaults to [\"en\", \"vi\"].",
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
      "for a given Mūla (root) paragraph. Essential for doctrinal explanations, groundRAG Theravada views, and term clarification.",
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
      "Look up a Pāli term in the Digital Pāli Dictionary (DPD). Returns grammatical info, roots, etymology, and comprehensive definitions.",
    parameters: {
      type: "OBJECT",
      properties: {
        word: {
          type: "STRING",
          description: "Pāli word (in Roman script with diacritics, Velthuis, or plain English approx, e.g. \"nibbāna\", \"anicca\", \"khandha\").",
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
//  SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const kAiDefaultToolSystemPrompt = `You are Ani (AI Nissaya), the dedicated scholarly AI assistant for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is to systematically investigate the Dhamma through precise canonical research using the available database tools.

## Research & Verification Strategy (Deep Canonical Reasoning)
1. Deconstruct & Plan: Analyze the user's inquiry, identify the core doctrinal concepts and candidate suttas/books.
2. Section & Sutta Discovery: Search sutta titles or vagga outlines using search_sections to identify relevant discourses.
3. Term Search: Search terms using search_by_category or search_tipitaka_batch with Pāḷi stems.
4. Passage & Sentence Retrieval:
   - Read exact verses and passages using get_paragraph_content or get_paragraph_content_batch.
   - For granular textual analysis, line-by-line translation comparisons, or quoting specific verses, call get_sentences. Sentence line_id numbers align 1-to-1 between Pāḷi and translation (99.7% match).
5. Exegesis & Lexicon: Consult Buddhaghosa's commentaries and Dhammapāla's sub-commentaries using get_commentaries, and clarify key roots/etymology with get_dictionary.
6. Synthesize & Conclude: Once sufficient authentic evidence is gathered, call final_answer(summary).`;

function buildAnswerSystemPrompt({ groundRAGMode = true }) {
  const grounding = groundRAGMode
    ? `## RAG Mode Rules (Strict Grounding)
1. Every factual claim MUST be supported by an inline citation:
   - Paragraph citation: [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{start}-{end}]
   - Sentence-level citation: [book_code:c{chap}:p{para}-L{line}] (e.g. [s0101m.mul:c0:p6-L2])
2. Answer the user's question using the canonical passages, commentaries, sentence translations, and dictionary definitions gathered during research.
3. Quote Pāḷi verses or phrases EXACTLY as written in the sources (use Markdown blockquotes); provide clear translations following each quote. For sentence-level precision, present the exact Pāḷi sentence and aligned translation.
4. If the retrieved sources do not fully answer the question, state this honestly.
5. Explain technical Pāḷi terms on first mention with etymological clarity.`
    : `## Knowledge Mode Rules (Canonical + Contextual Knowledge)
1. Base your answer primarily on the canonical passages and sentence translations retrieved by the tools, with inline citations [book_code:c{chap}:p{para}] or [book_code:c{chap}:p{para}-L{line}].
2. You may supplement with broader canonical knowledge where helpful, but clearly distinguish citations from broader commentary.
3. Quote Pāḷi accurately, with translation following.`;

  return `You are Ani (AI Nissaya), the scholarly Pāḷi Canon companion on tipitakapali.org.
You have been supplied with verified passages, sentence translations, commentaries, and dictionary entries from the Chaṭṭha Saṅgāyana Tipiṭaka database.

## Task
Write a comprehensive, insightful, and clearly structured answer to the user's question using rich Markdown (headers, bullet points, blockquotes for Pāḷi verses).

## Citation Format
All canonical citations MUST appear as clickable chips in square brackets:
  - Paragraph level: [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_start}-{para_end}]
  - Sentence level: [book_code:c{chapter_index}:p{para_index}-L{line_id}] (e.g. [s0101m.mul:c0:p6-L2])
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
          translation_en: (p.translations?.en || "").slice(0, 500),
          translation_vi: (p.translations?.vi || "").slice(0, 500),
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
        entries: (result.entries || []).slice(0, 4).map((e) => ({
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
        title: result.title,
        summary: (result.summary || "").slice(0, 400),
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
  const res = await fetch(`${getApiBase()}/api/ai/tool-call`, {
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

// ═══════════════════════════════════════════════════════════════════════════
//  CLIENT-SIDE CITATION EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════

export function parseCitationsFromText(text) {
  if (!text) return [];
  // Supports [book:c{chap}:p{para}], [book:c{chap}:p{start}-{end}], [book:{para}], [book:c{chap}:p{para}-L{line}] and [book:c{chap}:p{para}:L{line}]
  const regex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–]L?(\d+))?(?::L?(\d+))?\]/gi;
  const seen = new Set();
  const citations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawTag = match[0];
    const rawBook = match[1];
    const hasExplicitChap = match[2] !== undefined;
    const chapIdx = hasExplicitChap ? parseInt(match[2], 10) : 0;
    const paraIdx = parseInt(match[3], 10);
    let paraEnd = match[4] ? parseInt(match[4], 10) : null;
    let lineId = match[5] ? parseInt(match[5], 10) : null;

    // Sentence-level citation [book:cX:pY-LZ] uses dash-L; promote to lineId
    if (/-L\d+/i.test(rawTag) && !lineId && paraEnd !== null) {
      lineId = paraEnd;
      paraEnd = null;
    }

    const key = `${rawBook}:${chapIdx}:${paraIdx}:${lineId || ''}:${paraEnd || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      const citationRef = lineId
        ? `[${rawBook} §${paraIdx}:L${lineId}]`
        : paraEnd
        ? `[${rawBook} §${paraIdx}–${paraEnd}]`
        : `[${rawBook} §${paraIdx}]`;

      citations.push({
        rawTag,
        rawBook,
        bookCode: rawBook,
        bookTitle: rawBook,
        chapterIndex: chapIdx,
        paraIndex: paraIdx,
        paraEnd,
        lineId,
        citationRef,
      });
    }
  }
  return citations;
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
  const groundRAGMode = aiSettings?.groundRAGMode !== false;
  const customSystemPrompt = aiSettings?.customSystemPrompt || "";
  const baseUrl = aiSettings?.baseUrl || "";

  if (!apiKey && provider !== "custom") {
    const err = new Error("No API key configured. Please configure your key in Settings.");
    err.requiresKey = true;
    onError(err);
    return;
  }

  try {
    // ── STEP 1: AI QUERY UNDERSTANDING & DECOMPOSITION ────────────────────
    onStatus("🧠 Step 1: Dissecting inquiry and extracting canonical Pāḷi terms…");

    const understandingPrompt = `You are a scholarly Theravāda Buddhist researcher. Analyze this inquiry and return JSON with:
1. "intent": "doctrinal_explanation" | "verse_lookup" | "historical" | "linguistic"
2. "canonical_pali_terms": array of precise Pāḷi terms in Roman diacritics
3. "pali_stems": array of search stems without terminal vowels (-a, -ā, -e, -o)
4. "target_sutta_names": array of specific suttas likely relevant
5. "recommended_locations": { "categories": ["sutta"], "nikayas": ["dn", "mn", "sn", "an", "kn"] }
6. "user_facing_summary": one concise sentence summarizing what canonical texts we will investigate.

Inquiry: "${userQuery}"`;

    let understanding = null;
    try {
      if (provider === "gemini") {
        const understandUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey}`;
        const uRes = await fetch(understandUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: understandingPrompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
          }),
          signal,
        });
        if (uRes.ok) {
          const uJson = await uRes.json();
          const text = uJson.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            understanding = JSON.parse(text);
          }
        }
      }
    } catch (e) {
      console.warn("Query understanding fallback:", e);
    }

    if (understanding) {
      onUnderstanding(understanding);
      if (understanding.user_facing_summary) {
        onStatus(`🧠 ${understanding.user_facing_summary}`);
      }
    }

    // ── STEP 2: MULTI-STEP CANONICAL DATABASE RESEARCH LOOP ───────────────
    onStatus("Initiating canonical research with scholarly agent loop…");

    let toolSystemPrompt = customSystemPrompt?.trim() || kAiDefaultToolSystemPrompt;
    if (understanding) {
      toolSystemPrompt += `\n\n## UNDERSTANDING & TARGETS:
- Terms: ${(understanding.canonical_pali_terms || []).join(", ")}
- Suttas: ${(understanding.target_sutta_names || []).join(", ")}
- Search Stems: ${(understanding.pali_stems || []).join(", ")}
Execute research systematically. Search sections, read exact paragraphs with get_paragraph_content, and call final_answer when evidence is ready.`;
    }

    const allCollectedEvidence = {
      sections: [],
      passages: [],
      sentences: [],
      commentaries: [],
      dictionaries: [],
    };
    const toolLogs = [];
    const maxIterations = 6;
    let iterations = 0;
    let toolsDone = false;

    if (provider === "gemini") {
      const conversation = [];
      for (const msg of conversationHistory.slice(-4)) {
        if (msg.role && msg.content) {
          conversation.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content.substring(0, 400) }],
          });
        }
      }
      conversation.push({
        role: "user",
        parts: [{
          text: `Inquiry: "${userQuery}"\nPlease execute the research strategy using the available database tools to gather verified canonical passages, commentaries, and linguistic definitions.`
        }],
      });

      while (!toolsDone && iterations < maxIterations) {
        if (signal?.aborted) throw new Error("Inquiry cancelled by user");
        iterations++;

        const geminiToolUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey}`;
        const payload = {
          system_instruction: { parts: [{ text: toolSystemPrompt }] },
          contents: conversation,
          tools: [{ functionDeclarations: kAiToolDeclarations }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        };

        const toolRes = await fetch(geminiToolUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });

        if (!toolRes.ok) {
          const errText = await toolRes.text();
          console.warn(`[Gemini Tool Call HTTP ${toolRes.status}]:`, errText);
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
            if (fc.name === "final_answer") {
              hasFinalAnswer = true;
            }
            callSpecs.push(fc);
          } else if (part.text && parts.length === 1) {
            onStatus(`Ani: ${part.text.slice(0, 100)}…`);
          }
        }

        if (callSpecs.length === 0) {
          toolsDone = true;
          break;
        }

        onStatus(`Research step ${iterations}/${maxIterations}: Querying ${callSpecs.length} canonical database tool(s)…`);

        // Execute tools against local SQLite database via /api/ai/tool-call (ZERO KEY SENT!)
        const toolResults = await Promise.allSettled(
          callSpecs.map((spec) => executeRemoteAiTool(spec.name, spec.args || {}, signal))
        );

        const functionResponses = [];
        for (let i = 0; i < callSpecs.length; i++) {
          const spec = callSpecs[i];
          const resObj = toolResults[i].status === "fulfilled" ? toolResults[i].value : { success: false, error: toolResults[i].reason?.message };
          const compact = formatCompactToolResponse(spec.name, resObj);

          if (spec.name === "search_sections" && resObj.results) {
            allCollectedEvidence.sections.push(...resObj.results);
          } else if ((spec.name === "search_tipitaka" || spec.name === "search_tipitaka_batch" || spec.name === "search_by_category") && resObj.results) {
            allCollectedEvidence.passages.push(...resObj.results);
          } else if ((spec.name === "get_paragraph_content" || spec.name === "get_paragraph_content_batch") && resObj.passages) {
            allCollectedEvidence.passages.push(...resObj.passages);
          } else if (spec.name === "get_sentences" && resObj.pali_sentences) {
            allCollectedEvidence.sentences.push(resObj);
          } else if (spec.name === "get_commentaries" && (resObj.atthakatha || resObj.tika)) {
            allCollectedEvidence.commentaries.push(resObj);
          } else if ((spec.name === "get_dictionary" || spec.name === "get_dictionary_batch") && resObj.entries) {
            allCollectedEvidence.dictionaries.push(...resObj.entries);
          }

          const summaryArg = spec.args?.query || spec.args?.queries?.[0] || spec.args?.word || spec.args?.words?.[0] || (spec.args?.book_code ? `${spec.args.book_code}${spec.args.para_index !== undefined ? ` p${spec.args.para_index}` : ''}${spec.args.line_id ? ` L${spec.args.line_id}` : ''}` : "");
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
      // OpenAI / OpenRouter direct client
      const endpoint = (baseUrl && baseUrl.trim())
        ? `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`
        : provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

      const openAiTools = getOpenAiToolDeclarations();
      const openAiMessages = [
        { role: "system", content: toolSystemPrompt },
      ];
      for (const msg of conversationHistory.slice(-4)) {
        if (msg.role && msg.content) {
          openAiMessages.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: msg.content.substring(0, 400),
          });
        }
      }
      openAiMessages.push({
        role: "user",
        content: `Inquiry: "${userQuery}"\nPlease execute the research strategy using the available database tools to gather verified canonical passages, commentaries, and linguistic definitions.`,
      });

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

        const headers = {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        };
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://tipitakapali.org";
          headers["X-Title"] = "tipitakapali.org";
        }

        const toolRes = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal,
        });

        if (!toolRes.ok) break;
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
          callSpecs.push({ id: tc.id, name: fn.name, args });
        }

        onStatus(`Research step ${iterations}/${maxIterations}: Querying ${callSpecs.length} canonical database tool(s)…`);

        const toolResults = await Promise.allSettled(
          callSpecs.map((spec) => executeRemoteAiTool(spec.name, spec.args, signal))
        );

        for (let i = 0; i < callSpecs.length; i++) {
          const spec = callSpecs[i];
          const resObj = toolResults[i].status === "fulfilled" ? toolResults[i].value : { success: false, error: toolResults[i].reason?.message };
          const compact = formatCompactToolResponse(spec.name, resObj);

          if (spec.name === "search_sections" && resObj.results) {
            allCollectedEvidence.sections.push(...resObj.results);
          } else if ((spec.name === "search_tipitaka" || spec.name === "search_tipitaka_batch" || spec.name === "search_by_category") && resObj.results) {
            allCollectedEvidence.passages.push(...resObj.results);
          } else if ((spec.name === "get_paragraph_content" || spec.name === "get_paragraph_content_batch") && resObj.passages) {
            allCollectedEvidence.passages.push(...resObj.passages);
          } else if (spec.name === "get_sentences" && resObj.pali_sentences) {
            allCollectedEvidence.sentences.push(resObj);
          } else if (spec.name === "get_commentaries" && (resObj.atthakatha || resObj.tika)) {
            allCollectedEvidence.commentaries.push(resObj);
          } else if ((spec.name === "get_dictionary" || spec.name === "get_dictionary_batch") && resObj.entries) {
            allCollectedEvidence.dictionaries.push(...resObj.entries);
          }

          const summaryArg = spec.args?.query || spec.args?.queries?.[0] || spec.args?.word || spec.args?.words?.[0] || (spec.args?.book_code ? `${spec.args.book_code}${spec.args.para_index !== undefined ? ` p${spec.args.para_index}` : ''}${spec.args.line_id ? ` L${spec.args.line_id}` : ''}` : "");
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

    // ── STEP 3: STREAMING CANONICAL SYNTHESIS ─────────────────────────────
    onStatus("Step 3: Synthesizing verified answer with authentic canonical citations…");

    const answerSysPrompt = buildAnswerSystemPrompt({ groundRAGMode });
    let evidenceContext = "## RETRIEVED CANONICAL EVIDENCE FOR SYNTHESIS:\n\n";

    if (allCollectedEvidence.sections.length > 0) {
      evidenceContext += "### Canonical Suttas Discovered:\n";
      for (const s of allCollectedEvidence.sections.slice(0, 6)) {
        evidenceContext += `- ${s.title} [${s.book_code}:c${s.chapter_index}:p${s.para_index}] (${s.citation_ref}): ${s.snippet || ""}\n`;
      }
      evidenceContext += "\n";
    }

    if (allCollectedEvidence.passages.length > 0) {
      evidenceContext += "### Authentic Discourse Passages (Pāli & Translations):\n";
      for (const p of allCollectedEvidence.passages.slice(0, 8)) {
        evidenceContext += `#### Passage ${p.citation_ref || `[${p.book_code}:c${p.chapter_index}:p${p.para_index}]`}:\n`;
        if (p.pali) evidenceContext += `> Pāli: "${p.pali.slice(0, 600)}"\n`;
        if (p.translations?.en || p.translation_en) evidenceContext += `> English: "${(p.translations?.en || p.translation_en).slice(0, 600)}"\n`;
        if (p.translations?.vi || p.translation_vi) evidenceContext += `> Tiếng Việt: "${(p.translations?.vi || p.translation_vi).slice(0, 600)}"\n`;
        evidenceContext += "\n";
      }
    }

    if (allCollectedEvidence.sentences && allCollectedEvidence.sentences.length > 0) {
      evidenceContext += "### Sentence-Level Aligned Evidence (Pāḷi ↔ Translations, Shared line_id):\n";
      for (const s of allCollectedEvidence.sentences.slice(0, 6)) {
        evidenceContext += `#### Sentence Source [${s.book_code}:c${s.chapter_index}:p${s.para_index}]:\n`;
        for (const ps of (s.pali_sentences || []).slice(0, 25)) {
          evidenceContext += `- L${ps.line_id}: "${ps.sentence || ps.text}"\n`;
          for (const [lang, trs] of Object.entries(s.translations || {})) {
            const tr = (trs || []).find((t) => t.line_id === ps.line_id);
            if (tr) evidenceContext += `  → [${lang}] L${tr.line_id}: "${tr.translation}"\n`;
          }
        }
        evidenceContext += `Citations: ${(s.pali_sentences || []).map((ps) => `[${s.book_code}:c${s.chapter_index}:p${s.para_index}-L${ps.line_id}]`).join(" ")}\n\n`;
      }
    }

    if (allCollectedEvidence.commentaries.length > 0) {
      evidenceContext += "### Aṭṭhakathā & Ṭīkā Clarifications:\n";
      for (const c of allCollectedEvidence.commentaries.slice(0, 3)) {
        if (c.atthakatha?.[0]) {
          const a = c.atthakatha[0];
          evidenceContext += `- **${a.book_title}** (${a.citation_ref}): "${(a.pali_text || "").slice(0, 350)}"\n`;
        }
        if (c.tika?.[0]) {
          const t = c.tika[0];
          evidenceContext += `- **${t.book_title}** (${t.citation_ref}): "${(t.pali_text || "").slice(0, 300)}"\n`;
        }
      }
      evidenceContext += "\n";
    }

    if (allCollectedEvidence.dictionaries.length > 0) {
      evidenceContext += "### Digital Pāli Dictionary Etymology:\n";
      for (const d of allCollectedEvidence.dictionaries.slice(0, 5)) {
        evidenceContext += `- **${d.word}**: ${(d.definition || "").slice(0, 300)}\n`;
      }
      evidenceContext += "\n";
    }

    let fullAnswerText = "";

    if (provider === "gemini") {
      const geminiStreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${answerModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const answerPayload = {
        system_instruction: { parts: [{ text: answerSysPrompt }] },
        contents: [
          ...conversationHistory.slice(-4).map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          {
            role: "user",
            parts: [
              { text: `${evidenceContext}\n\nUser Inquiry: "${userQuery}"\n\nWrite a complete, structured scholarly explanation citing every passage as [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_index}-L{line_id}].` },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      };

      const streamRes = await fetch(geminiStreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answerPayload),
        signal,
      });

      if (!streamRes.ok) {
        throw new Error(`Gemini Stream Error HTTP ${streamRes.status}: ${await streamRes.text()}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const parsed = JSON.parse(dataStr);
                const textPart = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textPart) {
                  fullAnswerText += textPart;
                  onToken(textPart);
                }
              } catch (e) {}
            }
          }
        }
      }
    } else {
      // OpenAI / OpenRouter streaming
      const endpoint = (baseUrl && baseUrl.trim())
        ? `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`
        : provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://tipitakapali.org";
        headers["X-Title"] = "tipitakapali.org";
      }

      const streamRes = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: answerModel || "gpt-4o",
          messages: [
            { role: "system", content: answerSysPrompt },
            ...conversationHistory.slice(-4),
            { role: "user", content: `${evidenceContext}\n\nUser Inquiry: "${userQuery}"\n\nWrite a structured scholarly explanation citing every passage as [book_code:c{chapter_index}:p{para_index}] or [book_code:c{chapter_index}:p{para_index}-L{line_id}].` },
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullAnswerText += delta;
                onToken(delta);
              }
            } catch (e) {}
          }
        }
      }
    }

    // Extract citations
    const citations = parseCitationsFromText(fullAnswerText);
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
