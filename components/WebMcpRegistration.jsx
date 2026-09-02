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
      // 1. Pali Dictionary Lookup Tool
      modelContext.registerTool(
        {
          name: 'lookup_pali_word',
          description: 'Look up a Pali word in the Digital Pāḷi Dictionary (DPD) for definitions, grammar, and roots.',
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

      // 2. Search Pali Canon Tool
      modelContext.registerTool(
        {
          name: 'search_tipitaka',
          description: 'Full-text search across the 520,000+ paragraphs of the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Pali search term or phrase (e.g. "anicca")',
              },
            },
            required: ['query'],
          },
          execute: async ({ query }) => {
            if (!query) return { error: 'Query parameter is required' };
            try {
              const res = await fetch(`https://api.tipitakapali.org/api/search?q=${encodeURIComponent(query)}&limit=10`);
              const data = await res.json();
              return { count: data.count, results: data.results || [] };
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
