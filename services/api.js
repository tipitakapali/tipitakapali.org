// Client-Side Memory Cache Toggle: Enabled for instant sub-millisecond tab switching & navigation
export const ENABLE_CLIENT_CACHE = true;

// Client-side Memory Cache & Request Deduplication for Ultra-Fast Navigation
const cache = new Map();
const pendingRequests = new Map();

async function cachedFetch(key, fetcher, ttlMs = 10 * 60 * 1000, signal = null) {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  if (!ENABLE_CLIENT_CACHE) {
    return fetcher();
  }

  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }

  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, timestamp: Date.now() });
      pendingRequests.delete(key);
      return data;
    })
    .catch((err) => {
      pendingRequests.delete(key);
      throw err;
    });

  pendingRequests.set(key, promise);
  return promise;
}

// Book Code to Info Index Map (Title, Nikaya, Category)
const bookCodeToInfoMap = new Map();

export function indexTreeData(treeNodes) {
  if (!Array.isArray(treeNodes)) return;

  function traverse(nodes, parentNikaya = '', parentCategory = '') {
    for (const node of nodes) {
      if (!node) continue;
      const text = node.text || '';
      const href = node.a_attr?.href || node.href || '';
      const nikaya = node.nikaya || parentNikaya;
      const category = node.category || parentCategory;

      if (href && href.startsWith('cscd/')) {
        const m = href.match(/^cscd\/([a-z0-9_]+\.[a-z0-9_]+?)(\d+)?\.xml$/i);
        if (m) {
          const code = m[1].toLowerCase();
          const cleanTitle = text.replace(/\s*\([^\)]+\)$/, '').trim();
          if (!bookCodeToInfoMap.has(code) || !m[2]) {
            bookCodeToInfoMap.set(code, {
              title: cleanTitle || text,
              rawTitle: text,
              nikaya,
              category,
            });
          }
        }
      }

      if (node.children && Array.isArray(node.children) && node.children.length > 0) {
        traverse(node.children, parentNikaya || text, parentCategory || text);
      }
    }
  }

  traverse(treeNodes);
}

export function lookupBookInfo(bookCode) {
  if (!bookCode || typeof bookCode !== 'string') return null;
  const clean = splitScriptCode(bookCode.replace('.xml', '')).bookCode.toLowerCase();

  // 1. Check in-memory map
  if (bookCodeToInfoMap.has(clean)) {
    return bookCodeToInfoMap.get(clean);
  }

  // 2. Try loading from tree cache if not yet indexed
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('tipitaka_tree_cache_v5');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          indexTreeData(parsed);
          if (bookCodeToInfoMap.has(clean)) {
            return bookCodeToInfoMap.get(clean);
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

export function lookupBookTitle(bookCode) {
  const info = lookupBookInfo(bookCode);
  return info?.title || null;
}

export async function fetchTree() {
  if (ENABLE_CLIENT_CACHE) {
    // 1. In-memory cache
    const cached = cache.get('tree_json');
    if (cached) {
      indexTreeData(cached.data);
      return cached.data;
    }

    // 2. Persistent browser cache (0ms instant render on refresh/revisit)
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('tipitaka_tree_cache_v5');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cache.set('tree_json', { data: parsed, timestamp: Date.now() });
            indexTreeData(parsed);
            return parsed;
          }
        }
      } catch (e) {}
    }
  }

  // Fallback to API
  return cachedFetch(
    'tree_json',
    async () => {
      const res = await fetch('/api/tree');
      if (!res.ok) throw new Error('Failed to load navigation tree');
      const data = await res.json();
      if (ENABLE_CLIENT_CACHE && typeof window !== 'undefined' && Array.isArray(data) && data.length > 0) {
        try {
          localStorage.setItem('tipitaka_tree_cache_v5', JSON.stringify(data));
        } catch (e) {}
      }
      indexTreeData(data);
      return data;
    },
    24 * 60 * 60 * 1000 // 24 hours in-memory TTL
  );
}

export async function fetchBooks() {
  if (ENABLE_CLIENT_CACHE) {
    const cached = cache.get('books_list');
    if (cached) return cached.data;

    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('tipitaka_books_cache_v1');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && Array.isArray(parsed.books) && parsed.books.length > 0) {
            cache.set('books_list', { data: parsed, timestamp: Date.now() });
            return parsed;
          }
        }
      } catch (e) {}
    }
  }

  return cachedFetch('books_list', async () => {
    const res = await fetch('/api/books');
    if (!res.ok) throw new Error('Failed to load books list');
    const data = await res.json();
    if (ENABLE_CLIENT_CACHE && typeof window !== 'undefined' && data && Array.isArray(data.books)) {
      try {
        localStorage.setItem('tipitaka_books_cache_v1', JSON.stringify(data));
      } catch (e) {}
    }
    return data;
  }, 24 * 60 * 60 * 1000);
}

export async function fetchBook(bookCode, options = {}) {
  let cleanCode = splitScriptCode(bookCode.replace('.xml', '')).bookCode;
  let resolvedChapter = options.chapter;

  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) {
    cleanCode = chapSuffixMatch[1];
    if (resolvedChapter === undefined) {
      resolvedChapter = parseInt(chapSuffixMatch[2], 10);
    }
  }

  const params = new URLSearchParams();
  if (options.tocOnly) {
    params.set('tocOnly', 'true');
  } else {
    if (resolvedChapter !== undefined) params.set('chapter', resolvedChapter);
    if (options.buffer !== undefined) params.set('buffer', options.buffer);
    if (options.full) params.set('full', 'true');
  }

  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `book_${cleanCode}_${qs}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}${qs}`);
    if (!res.ok) throw new Error(`Failed to load book: ${cleanCode}`);
    return res.json();
  }, 60 * 60 * 1000);
}

export async function fetchBookTocOnly(bookCode) {
  return fetchBook(bookCode, { tocOnly: true });
}

export async function fetchChapter(bookCode, chapterIndex) {
  let cleanCode = splitScriptCode(bookCode.replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cacheKey = `chapter_${cleanCode}_${chapterIndex}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}`);
    if (!res.ok) throw new Error(`Failed to load chapter ${chapterIndex} for book: ${cleanCode}`);
    return res.json();
  }, 60 * 60 * 1000);
}


export async function fetchToc(bookCode) {
  const cleanCode = splitScriptCode(bookCode.replace('.xml', '')).bookCode;
  const cacheKey = `toc_${cleanCode}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/toc`);
    if (!res.ok) throw new Error(`Failed to load TOC for book: ${cleanCode}`);
    return res.json();
  }, 24 * 60 * 60 * 1000);
}

export async function fetchMat(bookCode) {
  let cleanCode = splitScriptCode(bookCode.replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cacheKey = `mat_${cleanCode}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/mat`);
    if (!res.ok) return null;
    return res.json();
  }, 24 * 60 * 60 * 1000);
}

export async function fetchMatJump(bookCode, para = null, chapter = null) {
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  const p = para ? `para=${encodeURIComponent(String(para).replace(/^(?:para-?|p)/i, '').trim())}` : '';
  const c = (chapter !== undefined && chapter !== null) ? `chapter=${encodeURIComponent(chapter)}` : '';
  const qs = [p, c].filter(Boolean).join('&');
  const cacheKey = `mat_jump_${cleanCode}_${para || '0'}_${chapter !== undefined && chapter !== null ? chapter : '0'}`;

  return cachedFetch(cacheKey, async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/mat_jump${qs ? '?' + qs : ''}`, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {}

    // Fallback for static/offline distribution: inspect static mat_chapter_map
    if (chapter !== null && chapter !== undefined) {
      try {
        const cRes = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/mat_chapter_map.json`);
        if (cRes.ok) {
          const data = await cRes.json();
          const match = (data.chapters || []).find(r => r.source_chapter === parseInt(chapter, 10));
          if (match) {
            return {
              source_book: cleanCode,
              source_chapter: parseInt(chapter, 10),
              source_para: para,
              mula: match.mula_book ? { book: match.mula_book, chapter: match.mula_chapter, para: null, title: match.mula_title } : null,
              attha: match.attha_book ? { book: match.attha_book, chapter: match.attha_chapter, para: null, title: match.attha_title } : null,
              tika: match.tika_book ? { book: match.tika_book, chapter: match.tika_chapter, para: null, title: match.tika_title } : null,
            };
          }
        }
      } catch (_) {}
    }

    return null;
  }, 1000);
}

export async function searchTipitaka(query, options = {}) {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options.book && options.book !== 'all') params.set('book', options.book);
  if (options.mat && options.mat !== 'all') params.set('mat', options.mat);
  if (options.pitaka && options.pitaka !== 'all') params.set('pitaka', options.pitaka);
  if (options.distance && options.distance !== 'any') params.set('distance', options.distance);
  if (options.sort && options.sort !== 'pitaka') params.set('sort', options.sort);
  if (options.limit) params.set('limit', options.limit);
  if (options.offset) params.set('offset', options.offset);

  const qs = params.toString();
  const cacheKey = `search_${qs}`;
  const base = getApiBase();

  return cachedFetch(
    cacheKey,
    async () => {
      const res = await fetch(`${base}/api/search?${qs}`, {
        signal: options.signal,
      });
      if (!res.ok) throw new Error('Search query failed');
      return res.json();
    },
    10 * 60 * 1000,
    options.signal
  );
}

import { cleanDictionaryQuery, splitScriptCode } from './transliterate';
import { setDpdFeedbackTemplate, dpd_feedback_s } from './dpdFeedback';

// Direct VPS base for dynamic ops (dict + search) — bypasses Cloudflare Worker proxy hop
// In static export on https://tipitakapali.org, fetch goes straight to VPS.
// In dev (localhost / 127.0.0.1) keep relative for next.config.js rewrites.
function getApiBase() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // Allow override via env (e.g. NEXT_PUBLIC_API_URL)
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
    }
    if (host === 'tipitakapali.org' || host.endsWith('.tipitakapali.org')) {
      return 'https://api.tipitakapali.org';
    }
  }
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  return '';
}
// Backward compat alias
const getDictApiBase = getApiBase;

export async function fetchDictionaryLookup(word, dictType = 'all', options = {}) {
  const cleanWord = cleanDictionaryQuery(word || '').trim();
  if (!cleanWord) return { word: '', hasResults: false, error: 'Empty word' };

  const params = new URLSearchParams();
  params.set('w', cleanWord);
  if (dictType && dictType !== 'all') params.set('dict', dictType);
  if (options.useSplitter) params.set('d', 'yes');

  const qs = params.toString();
  const cacheKey = `dict_${qs}`;
  const base = getDictApiBase();

  return cachedFetch(
    cacheKey,
    async () => {
      const res = await fetch(`${base}/api/dict/lookup?${qs}`, {
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`Dictionary lookup failed for ${cleanWord}`);
      return res.json();
    },
    24 * 60 * 60 * 1000,
    options.signal
  );
}

export async function fetchDPDLookup(word, options = {}) {
  return fetchDictionaryLookup(word, 'dpd', options);
}

export async function fetchOthersLookup(word, options = {}) {
  return fetchDictionaryLookup(word, 'others', options);
}

/**
 * Fetches the dynamic DPD feedback template from database (payload ##tipitakapalidpdfeedback)
 * Adapted from ref/tipitakapali.org/web/handleClick_dev.js (getFeedbackTemplateFromDb)
 * Uses direct VPS path via fetchDictionaryLookup (already bypasses Worker).
 */
export async function getFeedbackTemplateFromDb(urlVisiting = 'unknown') {
  try {
    const res = await fetchDictionaryLookup('##tipitakapalidpdfeedback', 'dpd');
    if (res && res.dpd && res.dpd.length > 0) {
      const fbEntry = res.dpd[0];
      const fbHtml = fbEntry.html || fbEntry.defi || '';
      if (fbHtml && fbHtml.trim().length > 10) {
        setDpdFeedbackTemplate(fbHtml.trim());
        return fbHtml.trim();
      }
    }
  } catch (err) {
    console.warn('Error fetching feedback string from db:', err);
  }
  return dpd_feedback_s;
}

export async function fetchDictionaryInflection(query) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return null;

  const cacheKey = `dict_inf_${cleanQuery}`;
  const base = getDictApiBase();
  return cachedFetch(
    cacheKey,
    async () => {
      const res = await fetch(`${base}/api/dict/inf?w=${encodeURIComponent(cleanQuery)}`);
      if (!res.ok) throw new Error(`Inflection lookup failed for ${cleanQuery}`);
      return res.json();
    },
    7 * 24 * 60 * 60 * 1000
  );
}


