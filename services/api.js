// Client-side Memory Cache & Request Deduplication for Ultra-Fast Navigation
const cache = new Map();
const pendingRequests = new Map();

async function cachedFetch(key, fetcher, ttlMs = 10 * 60 * 1000) {
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

export async function fetchTree() {
  return cachedFetch('tree_json', async () => {
    const res = await fetch('/api/tree');
    if (!res.ok) throw new Error('Failed to load navigation tree');
    return res.json();
  }, 60 * 60 * 1000); // 1 hour
}

export async function fetchBooks() {
  return cachedFetch('books_list', async () => {
    const res = await fetch('/api/books');
    if (!res.ok) throw new Error('Failed to load books list');
    return res.json();
  }, 60 * 60 * 1000);
}

export async function fetchBook(bookCode, options = {}) {
  let cleanCode = bookCode.replace('.xml', '');
  let resolvedChapter = options.chapter;

  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) {
    cleanCode = chapSuffixMatch[1];
    if (resolvedChapter === undefined) {
      resolvedChapter = parseInt(chapSuffixMatch[2], 10);
    }
  }

  const params = new URLSearchParams();
  if (resolvedChapter !== undefined) params.set('chapter', resolvedChapter);
  if (options.buffer !== undefined) params.set('buffer', options.buffer);
  if (options.full) params.set('full', 'true');

  const qs = params.toString() ? `?${params.toString()}` : '';
  const cacheKey = `book_${cleanCode}_${qs}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}${qs}`);
    if (!res.ok) throw new Error(`Failed to load book: ${cleanCode}`);
    return res.json();
  }, 30 * 60 * 1000);
}

export async function fetchChapter(bookCode, chapterIndex) {
  let cleanCode = bookCode.replace('.xml', '');
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cacheKey = `chapter_${cleanCode}_${chapterIndex}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/chapter/${chapterIndex}`);
    if (!res.ok) throw new Error(`Failed to load chapter ${chapterIndex} for book: ${cleanCode}`);
    return res.json();
  }, 30 * 60 * 1000);
}


export async function fetchToc(bookCode) {
  const cleanCode = bookCode.replace('.xml', '');
  const cacheKey = `toc_${cleanCode}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/toc`);
    if (!res.ok) throw new Error(`Failed to load TOC for book: ${cleanCode}`);
    return res.json();
  }, 60 * 60 * 1000);
}

export async function fetchMat(bookCode) {
  let cleanCode = bookCode.replace('.xml', '');
  const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) cleanCode = chapSuffixMatch[1];
  const cacheKey = `mat_${cleanCode}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/book/${encodeURIComponent(cleanCode)}/mat`);
    if (!res.ok) return null;
    return res.json();
  }, 60 * 60 * 1000);
}

export async function searchTipitaka(query, options = {}) {

  const params = new URLSearchParams();
  params.set('q', query);
  if (options.book) params.set('book', options.book);
  if (options.nikaya) params.set('nikaya', options.nikaya);
  if (options.limit) params.set('limit', options.limit);
  if (options.offset) params.set('offset', options.offset);

  const qs = params.toString();
  const cacheKey = `search_${qs}`;

  return cachedFetch(cacheKey, async () => {
    const res = await fetch(`/api/search?${qs}`);
    if (!res.ok) throw new Error('Search query failed');
    return res.json();
  }, 2 * 60 * 1000);
}

