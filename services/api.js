// Client-Side Memory Cache Toggle: Enabled for instant sub-millisecond tab switching & navigation
export const ENABLE_CLIENT_CACHE = true;

// When deployed on a dynamic VPS, set NEXT_PUBLIC_PREFER_VPS_API=true so the
// reader fetches lightweight per-chapter payloads instead of multi-MB whole-book
// static JSON bundles.
const PREFER_VPS_API = process.env.NEXT_PUBLIC_PREFER_VPS_API === 'true';

// Bounded LRU limits so long reading sessions / multi-tab browsing do not bloat
// browser tab memory.
const MAX_CACHE_ENTRIES = 120;
const MAX_PREVIEW_CACHE_ENTRIES = 120;
const MAX_STATIC_MAP_ENTRIES = 8;

// Client-side Memory Cache & Request Deduplication for Ultra-Fast Navigation
const cache = new Map();
const pendingRequests = new Map();
const linkedPreviewCache = new Map();
const pendingPreviewRequests = new Map();

function setBoundedCache(map, key, value, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  }
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
  map.set(key, value);
}

function touchBoundedCache(map, key, entry) {
  map.delete(key);
  map.set(key, entry);
  return entry;
}

function makeAbortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(makeAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function cachedFetch(key, fetcher, ttlMs = 10 * 60 * 1000, signal = null) {
  if (signal?.aborted) {
    throw makeAbortError();
  }

  if (!ENABLE_CLIENT_CACHE) {
    return raceWithSignal(fetcher(), signal);
  }

  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    touchBoundedCache(cache, key, cached);
    return cached.data;
  }

  if (pendingRequests.has(key)) {
    return raceWithSignal(pendingRequests.get(key), signal);
  }

  const promise = fetcher()
    .then((data) => {
      setBoundedCache(cache, key, { data, timestamp: Date.now() }, MAX_CACHE_ENTRIES);
      pendingRequests.delete(key);
      return data;
    })
    .catch((err) => {
      pendingRequests.delete(key);
      throw err;
    });

  pendingRequests.set(key, promise);
  return raceWithSignal(promise, signal);
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
      const stored = localStorage.getItem('tipitaka_tree_cache_v6');
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
        const stored = localStorage.getItem('tipitaka_tree_cache_v6');
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
      if (ENABLE_CLIENT_CACHE && typeof window !== 'undefined' && !isLocalDynamicHost() && Array.isArray(data) && data.length > 0) {
        try {
          localStorage.setItem('tipitaka_tree_cache_v6', JSON.stringify(data));
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
        const stored = localStorage.getItem('tipitaka_books_cache_v2');
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
    if (ENABLE_CLIENT_CACHE && typeof window !== 'undefined' && !isLocalDynamicHost() && data && Array.isArray(data.books)) {
      try {
        localStorage.setItem('tipitaka_books_cache_v2', JSON.stringify(data));
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
    if (resolvedChapter !== undefined && resolvedChapter !== null && resolvedChapter !== '') {
      params.set('chapter', resolvedChapter);
    }
    if (options.buffer !== undefined && options.buffer !== null) {
      params.set('buffer', options.buffer);
    }
    if (options.full) params.set('full', 'true');
  }

  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `book_${cleanCode}_${qs}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}${qs}`);
    if (!res.ok) {
      const err = new Error(`Failed to load book: ${cleanCode}`);
      err.status = res.status;
      throw err;
    }
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
    if (!res.ok) {
      const err = new Error(`Failed to load chapter ${chapterIndex} for book: ${cleanCode}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, 60 * 60 * 1000);
}


export async function fetchToc(bookCode) {
  const cleanCode = splitScriptCode(bookCode.replace('.xml', '')).bookCode;
  const cacheKey = `toc_${cleanCode}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/toc`);
    if (!res.ok) {
      const err = new Error(`Failed to load TOC for book: ${cleanCode}`);
      err.status = res.status;
      throw err;
    }
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

// Book-level cache for MAT static JSON files (mat_para_map / mat_chapter_map).
// One file serves every para+chapter of a book, so caching must be keyed by book —
// not by para (the outer cachedFetch key). Otherwise each new paragraph re-downloads
// the identical file, and one MAT open with N visible paras fires N identical downloads.
// The pending map dedupes concurrent opens of the modal for the same book.
const matStaticMapCache = new Map();
const matStaticMapPending = new Map();
const MAT_STATIC_MAP_TTL = 24 * 60 * 60 * 1000;

export function isLocalDynamicHost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === '127.0.0.1' || h === 'localhost';
}

async function fetchMatStaticMap(cleanCode, mapName) {
  if (PREFER_VPS_API || isLocalDynamicHost()) return null;
  const key = `${mapName}_${cleanCode}`;
  if (ENABLE_CLIENT_CACHE) {
    const cached = matStaticMapCache.get(key);
    if (cached && Date.now() - cached.timestamp < MAT_STATIC_MAP_TTL) {
      touchBoundedCache(matStaticMapCache, key, cached);
      return cached.data;
    }
    if (matStaticMapPending.has(key)) {
      return matStaticMapPending.get(key);
    }
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/${mapName}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      if (ENABLE_CLIENT_CACHE) {
        setBoundedCache(
          matStaticMapCache,
          key,
          { data, timestamp: Date.now() },
          MAX_STATIC_MAP_ENTRIES
        );
      }
      return data;
    } catch (_) {
      return null;
    } finally {
      matStaticMapPending.delete(key);
    }
  })();
  if (ENABLE_CLIENT_CACHE) {
    matStaticMapPending.set(key, promise);
  }
  return promise;
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
    // Static edge JSON first: co-located with the app on the same host, edge-cached
    // (see public/_headers: 1-day edge cache for /api/*), so no cross-host VPS hop.
    // Covers every book in the static export (export_static_cloudflare_pages.py).
    // Dynamic VPS is only a fallback for environments without static files (local dev)
    // or paragraphs missing from the static maps. Previously the order was reversed,
    // so every MAT open paid for a failed VPS round-trip (404) before the static hit.
    if (chapter !== null && chapter !== undefined) {
      const chapInt = parseInt(chapter, 10);
      if (para) {
        try {
          const pData = await fetchMatStaticMap(cleanCode, 'mat_para_map');
          if (pData) {
            const cleanPStr = String(para).replace(/^(?:para-?|p)/i, '').trim();
            let pMatch = (pData.paras || []).find(r => r.source_chapter === chapInt && String(r.source_para) === cleanPStr);
            let matchQuality = 'exact';
            if (!pMatch) {
              const targetP = parseInt(cleanPStr, 10);
              if (!isNaN(targetP) && targetP > 0) {
                const chapParas = (pData.paras || []).filter(r => r.source_chapter === chapInt);
                let closest = null;
                let minDiff = Infinity;
                for (const r of chapParas) {
                  const pNum = parseInt(r.source_para, 10);
                  if (!isNaN(pNum)) {
                    const diff = Math.abs(pNum - targetP);
                    if (diff < minDiff) {
                      minDiff = diff;
                      closest = r;
                    }
                  }
                }
                if (closest) {
                  pMatch = closest;
                  matchQuality = 'closest';
                }
              }
            }
            if (pMatch) {
              // Neighbor fill: an exact row can name the connected book/chapter for a
              // layer yet carry no para (e.g. s0201m.mul ch0 para 9 -> attha para null).
              // Borrow chapter+para from the closest same-chapter row that HAS one for
              // that layer (ties prefer the lower/previous para), so callers can offer
              // "Closest Attha para 8" instead of degrading to chapter-only.
              // match_quality stays as-is: per-layer display already distinguishes exact
              // (targetPara === requested) from closest (targetPara !== requested).
              const selfNum = parseInt(String(cleanPStr).split('-')[0], 10);
              if (!isNaN(selfNum)) {
                const chapRows = (pData.paras || []).filter((r) => r.source_chapter === chapInt);
                for (const layer of ['mula', 'attha', 'tika']) {
                  const bKey = `${layer}_book`;
                  const pKey = `${layer}_para`;
                  if (!pMatch[bKey] || (pMatch[pKey] !== null && pMatch[pKey] !== undefined)) continue;
                  let best = null;
                  let bestDiff = Infinity;
                  let bestNum = Infinity;
                  for (const r of chapRows) {
                    if (r[bKey] !== pMatch[bKey]) continue;
                    const rp = r[pKey];
                    if (rp === null || rp === undefined) continue;
                    const rn = parseInt(String(r.source_para).split('-')[0], 10);
                    if (isNaN(rn)) continue;
                    const diff = Math.abs(rn - selfNum);
                    if (diff < bestDiff || (diff === bestDiff && rn < bestNum)) {
                      best = r;
                      bestDiff = diff;
                      bestNum = rn;
                    }
                  }
                  if (best) {
                    pMatch = {
                      ...pMatch,
                      [`${layer}_chapter`]: best[`${layer}_chapter`],
                      [`${layer}_para`]: best[`${layer}_para`],
                      [`${layer}_title`]: pMatch[`${layer}_title`] || best[`${layer}_title`],
                    };
                  }
                }
              }
              return {
                source_book: cleanCode,
                source_chapter: chapInt,
                source_para: cleanPStr,
                match_quality: matchQuality,
                matched_source_para: pMatch.source_para,
                mula: pMatch.mula_book ? { book: pMatch.mula_book, chapter: pMatch.mula_chapter, para: pMatch.mula_para, title: pMatch.mula_title } : null,
                attha: pMatch.attha_book ? { book: pMatch.attha_book, chapter: pMatch.attha_chapter, para: pMatch.attha_para, title: pMatch.attha_title } : null,
                tika: pMatch.tika_book ? { book: pMatch.tika_book, chapter: pMatch.tika_chapter, para: pMatch.tika_para, title: pMatch.tika_title } : null,
              };
            }
          }
        } catch (_) {}
      }

      try {
        const data = await fetchMatStaticMap(cleanCode, 'mat_chapter_map');
        if (data) {
          const match = (data.chapters || []).find(r => r.source_chapter === chapInt);
          if (match) {
            return {
              source_book: cleanCode,
              source_chapter: chapInt,
              source_para: para,
              match_quality: 'chapter',
              mula: match.mula_book ? { book: match.mula_book, chapter: match.mula_chapter, para: null, title: match.mula_title } : null,
              attha: match.attha_book ? { book: match.attha_book, chapter: match.attha_chapter, para: null, title: match.attha_title } : null,
              tika: match.tika_book ? { book: match.tika_book, chapter: match.tika_chapter, para: null, title: match.tika_title } : null,
            };
          }
        }
      } catch (_) {}
    }

    // Dynamic VPS fallback (also covers calls without a chapter for the static path above).
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/mat_jump${qs ? '?' + qs : ''}`, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) {}

    return null;
  }, 24 * 60 * 60 * 1000);
}

export function invalidateSearchDatabasesCache() {
  cache.delete('search_databases');
  pendingRequests.delete('search_databases');
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith('search_')) {
      cache.delete(key);
    }
  }
  for (const key of Array.from(pendingRequests.keys())) {
    if (key.startsWith('search_')) {
      pendingRequests.delete(key);
    }
  }
}

export async function fetchSearchDatabases() {
  const base = getApiBase();
  return cachedFetch(
    'search_databases',
    async () => {
      const res = await fetch(`${base}/api/search/databases`);
      if (!res.ok) throw new Error('Failed to load search databases');
      return res.json();
    },
    60 * 60 * 1000
  );
}

export async function searchTipitaka(query, options = {}) {
  const params = new URLSearchParams();
  params.set('q', query);
  if (options.l && options.l !== 'pali') params.set('l', options.l);
  if (options.db && options.db !== 'fts_tipitaka.db' && options.db !== 'pali') params.set('db', options.db);
  if (options.lang && options.lang !== 'pali') params.set('lang', options.lang);
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

// Direct VPS base for dynamic ops (dict + search + AI chat) — bypasses Cloudflare Worker proxy hop
// In static export on https://tipitakapali.org, fetch goes straight to VPS.
// In dev (localhost / 127.0.0.1) keep relative for next.config.js rewrites.
export function getApiBase() {
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

// AI endpoints talk to https://api.tipitakapali.org online even when the UI is
// served from the Flutter loopback bundle on 127.0.0.1:<port>.
export function getAiApiBase() {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (
      host === 'tipitakapali.org' ||
      host.endsWith('.tipitakapali.org') ||
      (process.env.NODE_ENV !== 'development' && host === '127.0.0.1')
    ) {
      return 'https://api.tipitakapali.org';
    }
  }
  return '';
}

export async function fetchAiEndpoint(pathAndQuery, init = {}) {
  const base = getAiApiBase();
  const primaryUrl = `${base}${pathAndQuery}`;
  try {
    return await fetch(primaryUrl, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (
      base &&
      typeof window !== 'undefined' &&
      window.location.hostname === '127.0.0.1'
    ) {
      return fetch(pathAndQuery, init);
    }
    throw err;
  }
}

export async function fetchDictionaryLookup(word, dictType = 'all', options = {}) {
  const cleanWord = cleanDictionaryQuery(word || '').trim();
  if (!cleanWord) return { word: '', hasResults: false, error: 'Empty word' };

  const params = new URLSearchParams();
  params.set('w', cleanWord);
  if (dictType && dictType !== 'all') params.set('dict', dictType);
  if (options.useSplitter) params.set('d', 'yes');
  if (Array.isArray(options.langs) && options.langs.length > 0) {
    params.set('langs', options.langs.filter(Boolean).join(','));
  } else if (typeof options.langs === 'string' && options.langs.trim()) {
    params.set('langs', options.langs.trim());
  }

  const qs = params.toString();
  const cacheKey = `dict_${qs}`;
  const base = getDictApiBase();

  return cachedFetch(
    cacheKey,
    async () => {
      const res = await fetch(`${base}/api/dict/lookup?${qs}`, {
        signal: options.signal,
      });
      if (!res.ok) {
        const err = new Error(`Dictionary lookup failed for ${cleanWord}`);
        err.status = res.status;
        throw err;
      }
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

export async function fetchBoldDefinitionLookup(word, options = {}) {
  return fetchDictionaryLookup(word, 'bold_def', options);
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
      if (!res.ok) {
        const err = new Error(`Inflection lookup failed for ${cleanQuery}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    7 * 24 * 60 * 60 * 1000
  );
}

export async function fetchAvailableTranslations() {
  const base = getApiBase();
  return cachedFetch('available_translations', async () => {
    const res = await fetch(`${base}/api/translations`);
    if (!res.ok) throw new Error('Failed to load translations list');
    return res.json();
  }, 60 * 60 * 1000);
}

// Book-level cache for static per-book-per-lang translation JSON
// (export_static_translations.py). One file covers every chapter of a book,
// so it is cached keyed by book+lang — not by chapter. The pending map
// dedupes concurrent chapter reads of the same book (reader buffers adjacent
// chapters). Same pattern as fetchMatStaticMap above.
const transStaticCache = new Map();
const transStaticPending = new Map();
const TRANS_STATIC_TTL = 24 * 60 * 60 * 1000;

async function fetchBookTranslationStatic(cleanCode, lang) {
  if (PREFER_VPS_API || isLocalDynamicHost()) return null;
  const key = `trans_static_${cleanCode}_${lang}`;
  if (ENABLE_CLIENT_CACHE) {
    const cached = transStaticCache.get(key);
    if (cached && Date.now() - cached.timestamp < TRANS_STATIC_TTL) {
      touchBoundedCache(transStaticCache, key, cached);
      return cached.data;
    }
    if (transStaticPending.has(key)) {
      return transStaticPending.get(key);
    }
  }
  const promise = (async () => {
    try {
      // Same-host .json url: edge-cached static JSON on Cloudflare Pages.
      // Requires the dashboard URL Rewrite rule (README §4, Rule 4) that
      // strips the ".json" suffix first — otherwise the _redirects
      // :lang placeholder binds "en.json" and rewrites to "en.json.json"
      // (404). In local dev this 404s at the VPS rewrite and the caller
      // falls back to VPS.
      const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/translation/${encodeURIComponent(lang)}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      if (ENABLE_CLIENT_CACHE) {
        setBoundedCache(
          transStaticCache,
          key,
          { data, timestamp: Date.now() },
          MAX_STATIC_MAP_ENTRIES
        );
      }
      return data;
    } catch (_) {
      return null;
    } finally {
      transStaticPending.delete(key);
    }
  })();
  if (ENABLE_CLIENT_CACHE) {
    transStaticPending.set(key, promise);
  }
  return promise;
}

// Pāḷi sentence splits for sentence display mode (generated with the
// epitaka splitter). On local dynamic hosts (offline app / local dev) with a
// chapterIndex, fetches ONLY that single chapter to avoid full-book transfer.
// On static hosts falls back to per-book pali_sentences.json.
export async function fetchPaliSentences(bookCode, chapterIndex = null) {
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  const wholeBookKey = `pali_sent_${cleanCode}`;
  const existingWhole = cache.get(wholeBookKey);
  if (existingWhole && existingWhole.data) {
    touchBoundedCache(cache, wholeBookKey, existingWhole);
    return existingWhole.data;
  }

  if (
    chapterIndex !== null &&
    chapterIndex !== undefined &&
    (isLocalDynamicHost() || PREFER_VPS_API)
  ) {
    const chapCacheKey = `pali_sent_${cleanCode}_ch${chapterIndex}`;
    return cachedFetch(
      chapCacheKey,
      async () => {
        const base = getApiBase();
        const res = await fetch(
          `${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/pali_sentences`
        );
        if (res.ok) return await res.json();
        return null;
      },
      24 * 60 * 60 * 1000
    );
  }

  return cachedFetch(wholeBookKey, async () => {
    if (!isLocalDynamicHost()) {
      try {
        const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/pali_sentences.json`);
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/pali_sentences`);
      if (res.ok) return await res.json();
    } catch (_) {}
    return null;
  }, 24 * 60 * 60 * 1000);
}

export function getCachedPaliSentences(bookCode, chapterIndex = null) {
  if (!ENABLE_CLIENT_CACHE || !bookCode) return null;
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cachedWhole = cache.get(`pali_sent_${cleanCode}`);
  if (cachedWhole && cachedWhole.data) {
    if (chapterIndex !== null && chapterIndex !== undefined) {
      return cachedWhole.data?.chapters?.[String(chapterIndex)] || null;
    }
    return cachedWhole.data;
  }
  if (chapterIndex !== null && chapterIndex !== undefined) {
    const cachedChap = cache.get(`pali_sent_${cleanCode}_ch${chapterIndex}`);
    if (cachedChap && cachedChap.data) {
      return (
        cachedChap.data?.chapters?.[String(chapterIndex)] ||
        cachedChap.data?.paragraphs ||
        null
      );
    }
  }
  return null;
}

/**
 * Single-roundtrip chapter bundle for dynamic/offline hosts (`isLocalDynamicHost` /
 * `PREFER_VPS_API`). Fetches translations + sentence splits + per-chapter Pāḷi
 * sentences + linked definitions in one HTTP call and warms individual caches.
 * Returns `null` on static hosts so callers use static files seamlessly.
 */
export async function fetchChapterBundle(bookCode, chapterIndex, options = {}) {
  if (!bookCode || chapterIndex === undefined || chapterIndex === null) return null;
  if (!isLocalDynamicHost() && !PREFER_VPS_API) return null;

  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  const langArr = Array.isArray(options.langs)
    ? options.langs.filter(Boolean)
    : options.langs
    ? String(options.langs).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const withSentences = Boolean(options.sentences) && langArr.length > 0;
  const withPaliSentences = Boolean(options.paliSentences);
  const withLinks = Boolean(options.links);
  const includeHtml = options.includeHtml !== false;

  const inflightKey = `bundle_${cleanCode}_ch${chapterIndex}_${langArr.join(',')}_s${withSentences ? 1 : 0}_p${withPaliSentences ? 1 : 0}_l${withLinks ? 1 : 0}_h${includeHtml ? 1 : 0}`;
  if (pendingRequests.has(inflightKey)) {
    return raceWithSignal(pendingRequests.get(inflightKey), options.signal);
  }

  const params = new URLSearchParams();
  if (!includeHtml) params.set('includeHtml', '0');
  if (langArr.length > 0) params.set('lang', langArr.join(','));
  if (withSentences) params.set('sentences', '1');
  if (withPaliSentences) params.set('pali_sentences', '1');
  if (withLinks) params.set('links', '1');

  const base = getApiBase();
  const url = `${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/bundle?${params.toString()}`;

  const promise = (async () => {
    try {
      const res = await fetch(url, options.signal ? { signal: options.signal } : undefined);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== 'object') return null;
      const now = Date.now();

      if (ENABLE_CLIENT_CACHE) {
        if (typeof data.html === 'string') {
          setBoundedCache(
            cache,
            `chapter_${cleanCode}_${chapterIndex}`,
            { data: { book_code: cleanCode, chapter_index: chapterIndex, html: data.html }, timestamp: now },
            MAX_CACHE_ENTRIES
          );
        }
        if (langArr.length > 0 && data.translations) {
          const compKey = getChapterTransCompositeCacheKey(cleanCode, chapterIndex, langArr, withSentences);
          const transPayload = {
            book_code: cleanCode,
            chapter_index: chapterIndex,
            languages: data.languages || langArr,
            translations: data.translations || {},
          };
          if (withSentences) {
            transPayload.sentences = data.sentences || {};
          }
          setBoundedCache(cache, compKey, { data: transPayload, timestamp: now }, MAX_CACHE_ENTRIES);
        }
        if (withPaliSentences && data.pali_sentences) {
          setBoundedCache(
            cache,
            `pali_sent_${cleanCode}_ch${chapterIndex}`,
            {
              data: {
                book_code: cleanCode,
                chapter_index: chapterIndex,
                chapters: { [String(chapterIndex)]: data.pali_sentences },
                paragraphs: data.pali_sentences,
              },
              timestamp: now,
            },
            MAX_CACHE_ENTRIES
          );
        }
        if (withLinks && data.links && !data.links_warming_up) {
          setBoundedCache(
            cache,
            `chapter_links_${cleanCode}_ch${chapterIndex}`,
            {
              data: {
                book_code: cleanCode,
                chapter_index: chapterIndex,
                paragraphs: data.links,
              },
              timestamp: now,
            },
            MAX_CACHE_ENTRIES
          );
        }
      }
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return null;
    } finally {
      pendingRequests.delete(inflightKey);
    }
  })();

  pendingRequests.set(inflightKey, promise);
  return raceWithSignal(promise, options.signal);
}

// Sentence-split payload for sentence display mode. Static per-book file
// `<lang>.sentences.json` (written by export_static_cloudflare.py) first,
// VPS `?sentences=1` fallback (also covers local dev). Same book+lang cache
// pattern as fetchBookTranslationStatic; only fetched on demand.
async function fetchBookTranslationSentencesStatic(cleanCode, lang) {
  if (PREFER_VPS_API || isLocalDynamicHost()) return null;
  const key = `trans_sent_static_${cleanCode}_${lang}`;
  if (ENABLE_CLIENT_CACHE) {
    const cached = transStaticCache.get(key);
    if (cached && Date.now() - cached.timestamp < TRANS_STATIC_TTL) {
      touchBoundedCache(transStaticCache, key, cached);
      return cached.data;
    }
    if (transStaticPending.has(key)) {
      return transStaticPending.get(key);
    }
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/translation/${encodeURIComponent(lang)}.sentences.json`);
      if (!res.ok) return null;
      const data = await res.json();
      if (ENABLE_CLIENT_CACHE) {
        setBoundedCache(
          transStaticCache,
          key,
          { data, timestamp: Date.now() },
          MAX_STATIC_MAP_ENTRIES
        );
      }
      return data;
    } catch (_) {
      return null;
    } finally {
      transStaticPending.delete(key);
    }
  })();
  if (ENABLE_CLIENT_CACHE) {
    transStaticPending.set(key, promise);
  }
  return promise;
}

// Nissaya translations are word-by-word interlinear renderings: sentence
// display doesn't apply, and their split payloads are far too large for
// static hosting (export_static_cloudflare.py ships no sentence files for
// them). They always load and render as full paragraphs.
function isNissayaLang(lang) {
  return /_nissaya$/i.test(String(lang || '').trim());
}

function getChapterTransCompositeCacheKey(cleanCode, chapterIndex, langArr, sentencesMode) {
  return `chapter_trans_resolved_${cleanCode}_ch${chapterIndex}_${langArr.join(',')}_${sentencesMode ? 'sent' : 'para'}`;
}

export function getCachedChapterTranslations(bookCode, chapterIndex, requestedLangs = [], options = {}) {
  if (!ENABLE_CLIENT_CACHE || !bookCode) return null;
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const langArr = Array.isArray(requestedLangs)
    ? requestedLangs.filter(Boolean)
    : (requestedLangs ? String(requestedLangs).split(',').map((s) => s.trim()).filter(Boolean) : []);
  if (langArr.length === 0) return null;
  const compKey = getChapterTransCompositeCacheKey(cleanCode, chapterIndex, langArr, Boolean(options.sentences));
  const cached = cache.get(compKey);
  return cached?.data || null;
}

export async function fetchChapterTranslations(bookCode, chapterIndex, requestedLangs = [], options = {}) {
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  const langArr = Array.isArray(requestedLangs)
    ? requestedLangs.filter(Boolean)
    : (requestedLangs ? String(requestedLangs).split(',').map((s) => s.trim()).filter(Boolean) : []);
  if (langArr.length === 0) {
    return { book_code: cleanCode, chapter_index: chapterIndex, languages: [], translations: {} };
  }

  const compKey = getChapterTransCompositeCacheKey(cleanCode, chapterIndex, langArr, Boolean(options.sentences));
  if (ENABLE_CLIENT_CACHE) {
    const hit = cache.get(compKey);
    if (hit && Date.now() - hit.timestamp < 60 * 60 * 1000) {
      return hit.data;
    }
  }

  const translations = {};
  const sentences = {};

  // Sentence mode: use ONLY the sentence files (no full <lang>.json
  // download). Paragraph mode: use ONLY the full files. A lang falls back
  // to the other kind solely when its own kind is entirely unavailable.
  // Nissaya langs are excluded from the sentence path entirely — they are
  // paragraph-only (see isNissayaLang), so they flow into the fullLangs
  // fetch below and render as paragraphs even in sentence mode.
  if (options.sentences) {
    const noSentFile = [];
    const sentenceLangs = langArr.filter((l) => !isNissayaLang(l));
    await Promise.all(sentenceLangs.map(async (lang) => {
      try {
        const bookData = await fetchBookTranslationSentencesStatic(cleanCode, lang);
        const chapMap = bookData?.chapters?.[String(chapterIndex)];
        if (chapMap) {
          sentences[lang] = chapMap;
        } else {
          noSentFile.push(lang);
        }
      } catch (_) {
        noSentFile.push(lang);
      }
    }));
    if (noSentFile.length > 0) {
      const langs = noSentFile.join(',');
      const cacheKey = `trans_sent_${cleanCode}_ch${chapterIndex}_${langs}`;
      const base = getApiBase();
      try {
        const data = await cachedFetch(
          cacheKey,
          async () => {
            const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/translation?lang=${encodeURIComponent(langs)}&sentences=1`);
            if (!res.ok) throw new Error(`Failed to load translation sentences for ${cleanCode} ch ${chapterIndex}`);
            return res.json();
          },
          60 * 60 * 1000
        );
        Object.assign(sentences, data.sentences || {});
        // VPS also ships full text alongside sentences: keep it so paras
        // without splits still render (no extra download).
        Object.assign(translations, data.translations || {});
      } catch (_) {}
    }
  }

  const fullLangs = options.sentences ? langArr.filter((l) => !sentences[l]) : langArr;
  const missing = [];
  await Promise.all(fullLangs.map(async (lang) => {
    try {
      const bookData = await fetchBookTranslationStatic(cleanCode, lang);
      const chapMap = bookData?.chapters?.[String(chapterIndex)];
      if (chapMap) {
        translations[lang] = chapMap;
      } else {
        missing.push(lang);
      }
    } catch (_) {
      missing.push(lang);
    }
  }));

  // VPS fallback for langs/chapters missing from the static export
  // (also covers local dev, where the static file 404s at the API rewrite).
  if (missing.length > 0) {
    const langs = missing.join(',');
    const cacheKey = `trans_${cleanCode}_ch${chapterIndex}_${langs}`;
    const base = getApiBase();
    try {
      const data = await cachedFetch(
        cacheKey,
        async () => {
          const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/translation?lang=${encodeURIComponent(langs)}${options.sentences ? '&sentences=1' : ''}`);
          if (!res.ok) throw new Error(`Failed to load translations for ${cleanCode} ch ${chapterIndex}`);
          return res.json();
        },
        60 * 60 * 1000
      );
      Object.assign(translations, data.translations || {});
      if (options.sentences && data.sentences) Object.assign(sentences, data.sentences);
    } catch (e) {
      if (Object.keys(translations).length === 0 && Object.keys(sentences).length === 0) throw e;
    }
  }

  const result = { book_code: cleanCode, chapter_index: chapterIndex, languages: langArr, translations };
  if (options.sentences) result.sentences = sentences;
  if (ENABLE_CLIENT_CACHE) {
    setBoundedCache(cache, compKey, { data: result, timestamp: Date.now() }, MAX_CACHE_ENTRIES);
  }
  return result;
}

export function getCachedChapterLinks(bookCode, chapterIndex) {
  if (!ENABLE_CLIENT_CACHE || !bookCode || chapterIndex === undefined || chapterIndex === null) return null;
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cached = cache.get(`chapter_links_${cleanCode}_ch${chapterIndex}`);
  return cached?.data?.paragraphs || null;
}

export async function fetchChapterLinks(bookCode, chapterIndex, options = {}) {
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  if (!cleanCode || chapterIndex === undefined || chapterIndex === null) {
    return { book_code: cleanCode || '', chapter_index: chapterIndex ?? 0, paragraphs: {} };
  }

  const cacheKey = `chapter_links_${cleanCode}_ch${chapterIndex}`;
  const ttlMs = 30 * 60 * 1000;
  const signal = options.signal || null;

  if (signal?.aborted) {
    throw makeAbortError();
  }

  if (ENABLE_CLIENT_CACHE) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      touchBoundedCache(cache, cacheKey, cached);
      return cached.data;
    }
    if (pendingRequests.has(cacheKey)) {
      return raceWithSignal(pendingRequests.get(cacheKey), signal);
    }
  }

  const base = getApiBase();
  const promise = (async () => {
    const timeoutCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), 15000) : null;
    try {
      const res = await fetch(
        `${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/links`,
        timeoutCtrl ? { signal: timeoutCtrl.signal } : undefined
      );
      if (!res.ok) {
        return { book_code: cleanCode, chapter_index: chapterIndex, paragraphs: {} };
      }
      const data = await res.json();
      if (ENABLE_CLIENT_CACHE && data && !data.warming_up) {
        setBoundedCache(cache, cacheKey, { data, timestamp: Date.now() }, MAX_CACHE_ENTRIES);
      }
      return data;
    } catch (err) {
      return { book_code: cleanCode, chapter_index: chapterIndex, paragraphs: {} };
    } finally {
      if (timer) clearTimeout(timer);
      pendingRequests.delete(cacheKey);
    }
  })();

  if (ENABLE_CLIENT_CACHE) {
    pendingRequests.set(cacheKey, promise);
  }
  return raceWithSignal(promise, signal);
}

function buildLinkedPreviewSpec({ book, chapter, paraIndex, paraNum, lineId, word, langs } = {}) {
  let cleanCode = splitScriptCode((book || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  if (!cleanCode) return null;

  const params = new URLSearchParams();
  params.set('book', cleanCode);
  if (chapter !== undefined && chapter !== null) params.set('chapter', String(chapter));
  if (paraIndex !== undefined && paraIndex !== null) params.set('paraIndex', String(paraIndex));
  if (paraNum !== undefined && paraNum !== null && String(paraNum).trim() !== '') {
    params.set('paraNum', String(paraNum));
  }
  if (lineId !== undefined && lineId !== null) params.set('lineId', String(lineId));
  if (word) params.set('word', String(word));
  if (Array.isArray(langs) && langs.length > 0) {
    params.set('langs', langs.filter(Boolean).join(','));
  } else if (typeof langs === 'string' && langs.trim()) {
    params.set('langs', langs.trim());
  }

  const qs = params.toString();
  return { cleanCode, qs, cacheKey: `linked_preview_${qs}` };
}

async function cachedPreviewFetch(key, fetcher, ttlMs = 30 * 60 * 1000, signal = null) {
  if (signal?.aborted) {
    throw makeAbortError();
  }
  if (!ENABLE_CLIENT_CACHE) {
    return raceWithSignal(fetcher(), signal);
  }
  const cached = linkedPreviewCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    touchBoundedCache(linkedPreviewCache, key, cached);
    return cached.data;
  }
  if (pendingPreviewRequests.has(key)) {
    return raceWithSignal(pendingPreviewRequests.get(key), signal);
  }
  const promise = fetcher()
    .then((data) => {
      setBoundedCache(linkedPreviewCache, key, { data, timestamp: Date.now() }, MAX_PREVIEW_CACHE_ENTRIES);
      pendingPreviewRequests.delete(key);
      return data;
    })
    .catch((err) => {
      pendingPreviewRequests.delete(key);
      throw err;
    });
  pendingPreviewRequests.set(key, promise);
  return raceWithSignal(promise, signal);
}

export function getCachedLinkedPreview(args = {}) {
  if (!ENABLE_CLIENT_CACHE) return null;
  const spec = buildLinkedPreviewSpec(args);
  if (!spec) return null;
  const cached = linkedPreviewCache.get(spec.cacheKey);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return cached.data;
  }
  return null;
}

export async function fetchLinkedPreview(
  { book, chapter, paraIndex, paraNum, lineId, word, langs } = {},
  options = {}
) {
  const spec = buildLinkedPreviewSpec({ book, chapter, paraIndex, paraNum, lineId, word, langs });
  if (!spec) return null;

  const base = getApiBase();

  return cachedPreviewFetch(
    spec.cacheKey,
    async () => {
      const timeoutCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), 15000) : null;
      try {
        const res = await fetch(
          `${base}/api/links/preview?${spec.qs}`,
          timeoutCtrl ? { signal: timeoutCtrl.signal } : undefined
        );
        if (!res.ok) {
          let msg = `Linked preview not found for ${spec.cleanCode} (HTTP ${res.status})`;
          try {
            const errJson = await res.json();
            if (errJson?.error) msg = errJson.error;
          } catch (_) {}
          throw new Error(msg);
        }
        return await res.json();
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new Error('Timed out while loading linked passage.');
        }
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    30 * 60 * 1000,
    options.signal
  );
}

export function prefetchLinkedPreview(args = {}) {
  const spec = buildLinkedPreviewSpec(args);
  if (!spec) return;
  if (linkedPreviewCache.has(spec.cacheKey) || pendingPreviewRequests.has(spec.cacheKey)) return;
  fetchLinkedPreview(args).catch(() => {});
}

const _prefetchedPreviewBatches = new Set();

export async function prefetchLinkedPreviewsBatch(paragraphsMap, langs = []) {
  if (!ENABLE_CLIENT_CACHE || !paragraphsMap || typeof paragraphsMap !== 'object') return;
  // On local loopback SQLite (offline Flutter app / local dev), single clicks resolve
  // in ~2-4ms directly without saturating SQLite or starving adjacent chapters.
  if (isLocalDynamicHost()) return;
  const langList = Array.isArray(langs) ? langs.filter(Boolean) : [];
  const itemsToFetch = [];
  const seenKeys = new Set();

  for (const paraLinks of Object.values(paragraphsMap)) {
    if (!Array.isArray(paraLinks)) continue;
    for (const lnk of paraLinks) {
      if (!lnk?.target_book) continue;
      const spec = buildLinkedPreviewSpec({
        book: lnk.target_book,
        chapter: lnk.target_chapter,
        paraIndex: lnk.target_para_index,
        paraNum: lnk.target_para_num,
        lineId: lnk.target_line_id,
        word: lnk.word,
        langs: langList,
      });
      if (!spec || seenKeys.has(spec.cacheKey) || linkedPreviewCache.has(spec.cacheKey) || _prefetchedPreviewBatches.has(spec.cacheKey)) {
        continue;
      }
      seenKeys.add(spec.cacheKey);
      _prefetchedPreviewBatches.add(spec.cacheKey);
      itemsToFetch.push({
        key: spec.cacheKey,
        book: spec.cleanCode,
        chapter: lnk.target_chapter ?? null,
        paraIndex: lnk.target_para_index ?? null,
        paraNum: lnk.target_para_num ?? null,
        lineId: lnk.target_line_id ?? null,
        word: lnk.word || null,
      });
      if (itemsToFetch.length >= 20) break;
    }
    if (itemsToFetch.length >= 20) break;
  }

  if (itemsToFetch.length === 0) return;

  const scheduleIdle =
    typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? (fn) => new Promise((resolve) => window.requestIdleCallback(() => fn().then(resolve, resolve), { timeout: 2000 }))
      : (fn) => new Promise((resolve) => setTimeout(() => fn().then(resolve, resolve), 800));

  await scheduleIdle(async () => {
    const base = getApiBase();
    try {
      const res = await fetch(`${base}/api/links/previews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToFetch, langs: langList }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const results = data?.results || {};
      const now = Date.now();
      for (const [k, preview] of Object.entries(results)) {
        if (preview) {
          setBoundedCache(linkedPreviewCache, k, { data: preview, timestamp: now }, MAX_PREVIEW_CACHE_ENTRIES);
        }
      }
    } catch (_) {}
  });
}
