'use client';

import { useEffect } from 'react';

/**
 * WebMCP Registration Component
 * Registers browser-native tools for AI agents (Chrome / Chromium WebMCP EPP).
 * Spec: https://webmachinelearning.github.io/webmcp/
 */
export default function WebMcpRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if browser supports WebMCP API
    const modelContext = window.navigator?.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return;

    const controller = new AbortController();
    const { signal } = controller;

    try {
      // 1. Canonical Bold Definitions Lookup Tool (387K+ pre-indexed glosses)
      modelContext.registerTool(
        {
          name: 'lookup_bold_definitions',
          description: 'Query 387,000+ pre-indexed canonical & commentarial bold definitions (Aṭṭhakathā, Ṭīkā, Visuddhimagga, Mūla) for any Pāḷi term, returning ranked glosses, aligned translations, and verifiable [book:cX:pY-LZ] citations.',
          inputSchema: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                description: 'Pāḷi term to define (IAST, Velthuis, or Asian script, e.g. "mettā", "satipaṭṭhāna")',
              },
              langs: {
                type: 'string',
                description: 'Comma-separated translation language codes (e.g. "en,vi")',
                default: 'en',
              },
              limit: {
                type: 'integer',
                description: 'Maximum ranked definitions to return (1–20)',
                default: 8,
              },
            },
            required: ['word'],
          },
          execute: async ({ word, langs = 'en', limit = 8 }) => {
            if (!word) return { error: 'word parameter is required' };
            try {
              const params = new URLSearchParams({ w: word, langs, limit: String(limit) });
              const res = await fetch(`https://api.tipitakapali.org/api/ai/bold_definitions?${params.toString()}`);
              return await res.json();
            } catch (err) {
              return { error: err.message };
            }
          },
        },
        { signal }
      );

      // 2. Multi-Concept Boolean Search Tool
      modelContext.registerTool(
        {
          name: 'search_concepts',
          description: 'Search the Pāḷi Canon and translations by intersecting 2–4 concept groups (AND across groups, OR within each group\'s Pāḷi terms/stems and English synonyms).',
          inputSchema: {
            type: 'object',
            properties: {
              concept_groups: {
                type: 'array',
                description: 'Concept groups with concept label, pali_terms, pali_stems, and english_keywords',
                items: {
                  type: 'object',
                  properties: {
                    concept: { type: 'string' },
                    pali_terms: { type: 'array', items: { type: 'string' } },
                    pali_stems: { type: 'array', items: { type: 'string' } },
                    english_keywords: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              langs: {
                type: 'array',
                items: { type: 'string' },
                default: ['en'],
              },
              limit: {
                type: 'integer',
                default: 10,
              },
            },
            required: ['concept_groups'],
          },
          execute: async ({ concept_groups, langs = ['en'], limit = 10 }) => {
            if (!Array.isArray(concept_groups) || concept_groups.length === 0) {
              return { error: 'concept_groups array is required' };
            }
            try {
              const res = await fetch('https://api.tipitakapali.org/api/ai/search_concepts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ concept_groups, langs, limit }),
              });
              return await res.json();
            } catch (err) {
              return { error: err.message };
            }
          },
        },
        { signal }
      );

      // 3. Pāḷi Dictionary Lookup Tool (DPD)
      modelContext.registerTool(
        {
          name: 'lookup_pali_word',
          description: 'Look up a Pāḷi word in the Digital Pāḷi Dictionary (DPD) for definitions, grammar, roots, and compound splitting.',
          inputSchema: {
            type: 'object',
            properties: {
              word: {
                type: 'string',
                description: 'Pāḷi word to look up in Roman script (IAST or Velthuis, e.g. "mettā")',
              },
            },
            required: ['word'],
          },
          execute: async ({ word }) => {
            if (!word) return { error: 'Word parameter is required' };
            try {
              const res = await fetch(`https://api.tipitakapali.org/api/dict/lookup?w=${encodeURIComponent(word)}&dict=dpd`);
              const data = await res.json();
              return { results: data.dpd || [] };
            } catch (err) {
              return { error: err.message };
            }
          },
        },
        { signal }
      );

      // 4. Full-Text Search Tool
      modelContext.registerTool(
        {
          name: 'search_tipitaka',
          description: 'Full-text FTS5 search across 520,000+ Pāḷi paragraphs and 23 modern translation indexes of the Chaṭṭha Saṅgāyana Tipiṭaka.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term or phrase in Pāḷi or a translation language (e.g. "anicca")',
              },
              lang: {
                type: 'string',
                description: 'Corpus language: "pali" (default) or a translation code (e.g. "en", "vi")',
                default: 'pali',
              },
            },
            required: ['query'],
          },
          execute: async ({ query, lang = 'pali' }) => {
            if (!query) return { error: 'Query parameter is required' };
            try {
              const params = new URLSearchParams({ q: query, l: lang, limit: '10' });
              const res = await fetch(`https://api.tipitakapali.org/api/search?${params.toString()}`);
              const data = await res.json();
              return { count: data.count, results: data.results || [] };
            } catch (err) {
              return { error: err.message };
            }
          },
        },
        { signal }
      );

      // 5. Sentence-Level Pāḷi + Translation Alignment (shared line_id, 99.7% match)
      modelContext.registerTool(
        {
          name: 'get_sentences',
          description: 'Get sentence-level Pāḷi and aligned translations with shared line_id for a paragraph (or chapter). Use for precise sentence citations: [book:cX:pY-LZ].',
          inputSchema: {
            type: 'object',
            properties: {
              book_code: { type: 'string', description: 'Book code (e.g. s0101m.mul)' },
              chapter_index: { type: 'integer', description: 'Chapter index (0-based)' },
              para_index: { type: 'integer', description: 'Paragraph index' },
              langs: { type: 'string', description: 'Comma-separated translation langs (e.g. en,vi)', default: 'en' },
            },
            required: ['book_code'],
          },
          execute: async ({ book_code, chapter_index, para_index, langs }) => {
            if (!book_code) return { error: 'book_code is required' };
            try {
              const params = new URLSearchParams({ book: book_code });
              if (chapter_index !== undefined) params.set('chapter', String(chapter_index));
              if (para_index !== undefined) params.set('para_index', String(para_index));
              if (langs) params.set('langs', langs);
              const res = await fetch(`https://api.tipitakapali.org/api/ai/sentences?${params.toString()}`);
              return await res.json();
            } catch (err) {
              return { error: err.message };
            }
          },
        },
        { signal }
      );
    } catch (e) {
      console.warn('Failed to register WebMCP tools:', e);
    }

    return () => {
      controller.abort();
    };
  }, []);

  return null;
}
