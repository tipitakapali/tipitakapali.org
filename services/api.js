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

// Book-level cache for MAT static JSON files (mat_para_map / mat_chapter_map).
// One file serves every para+chapter of a book, so caching must be keyed by book —
// not by para (the outer cachedFetch key). Otherwise each new paragraph re-downloads
// the identical file, and one MAT open with N visible paras fires N identical downloads.
// The pending map dedupes concurrent opens of the modal for the same book.
const matStaticMapCache = new Map();
const matStaticMapPending = new Map();
const MAT_STATIC_MAP_TTL = 24 * 60 * 60 * 1000;

async function fetchMatStaticMap(cleanCode, mapName) {
  const key = `${mapName}_${cleanCode}`;
  if (ENABLE_CLIENT_CACHE) {
    const cached = matStaticMapCache.get(key);
    if (cached && Date.now() - cached.timestamp < MAT_STATIC_MAP_TTL) {
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
        matStaticMapCache.set(key, { data, timestamp: Date.now() });
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
  const key = `trans_static_${cleanCode}_${lang}`;
  if (ENABLE_CLIENT_CACHE) {
    const cached = transStaticCache.get(key);
    if (cached && Date.now() - cached.timestamp < TRANS_STATIC_TTL) {
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
        transStaticCache.set(key, { data, timestamp: Date.now() });
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

export async function fetchChapterTranslations(bookCode, chapterIndex, requestedLangs = []) {
  let cleanCode = splitScriptCode((bookCode || '').replace('.xml', '')).bookCode;
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];

  const langArr = Array.isArray(requestedLangs)
    ? requestedLangs.filter(Boolean)
    : (requestedLangs ? String(requestedLangs).split(',').map((s) => s.trim()).filter(Boolean) : []);
  if (langArr.length === 0) {
    return { book_code: cleanCode, chapter_index: chapterIndex, languages: [], translations: {} };
  }

  const translations = {};
  const missing = [];
  await Promise.all(langArr.map(async (lang) => {
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
          const res = await fetch(`${base}/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}/translation?lang=${encodeURIComponent(langs)}`);
          if (!res.ok) throw new Error(`Failed to load translations for ${cleanCode} ch ${chapterIndex}`);
          return res.json();
        },
        60 * 60 * 1000
      );
      Object.assign(translations, data.translations || {});
    } catch (e) {
      if (Object.keys(translations).length === 0) throw e;
    }
  }

  return { book_code: cleanCode, chapter_index: chapterIndex, languages: langArr, translations };
}
