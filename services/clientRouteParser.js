import { normalizeLangCode } from '../context/TabContext';

/**
 * Parse browser location + route params for /translation/{lang}/{book}/{ch}, /book/{script}.{book}/{ch},
 * /chapter/{book}{N}, query params (?l=, ?book=, ?q=), and hash anchors (#para57, #pindex-134).
 */
export function parseClientRouteLocation({
  pathname = '/',
  search = '',
  hash = '',
  params = null,
  initialRoute = null,
  normalizeLang = normalizeLangCode,
} = {}) {
  const urlParams = new URLSearchParams(search || '');
  const query = urlParams.get('q') || urlParams.get('search');
  const rawQueryLang = urlParams.get('l') || urlParams.get('lang') || urlParams.get('db');
  const normQueryLang = rawQueryLang ? normalizeLang(rawQueryLang) : null;
  const cleanQueryL = normQueryLang && normQueryLang !== 'pali' ? normQueryLang : null;

  let pathBook = null;
  let pathChapter = null;
  let pathTransLang = null;
  let fromTranslationRoute = false;

  const safeDecode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      return s;
    }
  };

  if (pathname.startsWith('/translation/')) {
    const rawPath = pathname.replace(/^\/translation\//, '');
    const parts = rawPath.split('/').filter(Boolean);
    if (parts[0]) {
      const norm = normalizeLang(safeDecode(parts[0]));
      if (norm && norm !== 'pali') {
        pathTransLang = norm;
        fromTranslationRoute = true;
      }
    }
    if (parts[1]) pathBook = safeDecode(parts[1]);
    if (parts[2]) pathChapter = safeDecode(parts[2]);
  } else if (pathname.startsWith('/book/') || pathname.startsWith('/chapter/')) {
    const rawPath = pathname.replace(/^\/(?:book|chapter)\//, '');
    const parts = rawPath.split('/').filter(Boolean);
    if (parts[0]) pathBook = safeDecode(parts[0]);
    if (parts[1]) pathChapter = safeDecode(parts[1]);

    if (pathBook) {
      const chapSuffixMatch = pathBook.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
      if (chapSuffixMatch) {
        pathBook = chapSuffixMatch[1];
        if (pathChapter === null || pathChapter === undefined) {
          // Suffix 0 -> index 0 (ch 1), Suffix 1 -> index 1 (ch 2), etc.
          pathChapter = parseInt(chapSuffixMatch[2], 10) + 1;
        }
      }
    }
  }

  // Fallback to explicit SSR initialRoute metadata if pathname didn't match
  if (!pathBook && initialRoute?.bookCode) {
    pathBook = initialRoute.scriptPrefix
      ? `${initialRoute.scriptPrefix}.${initialRoute.bookCode}`
      : initialRoute.bookCode;
    if (initialRoute.chapterNum && (pathChapter === null || pathChapter === undefined)) {
      pathChapter = initialRoute.chapterNum;
    }
    if (initialRoute.fromTranslationRoute && initialRoute.translationLang && !pathTransLang) {
      pathTransLang = initialRoute.translationLang;
      fromTranslationRoute = true;
    }
  }

  // Fallback for legacy catch-all params.slug on /book or /chapter
  if (!pathBook && !fromTranslationRoute && params?.slug?.[0]) {
    const slug0 = safeDecode(params.slug[0]);
    const chapSuffixMatch = slug0.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      pathBook = chapSuffixMatch[1];
      if (pathChapter === null || pathChapter === undefined) {
        pathChapter = parseInt(chapSuffixMatch[2], 10) + 1;
      }
    }
  }

  // Extract hash e.g. #para57, #para-57, #57, #pindex-134
  const cleanHash = (hash || '').replace(/^#/, '');
  let hashParaNum = null;
  let hashParaIndex = null;
  if (cleanHash) {
    const numMatch = cleanHash.match(/^(?:para-?|p)?(\d+)$/i);
    if (numMatch) {
      hashParaNum = numMatch[1];
    } else if (cleanHash.startsWith('pindex-')) {
      const parsedIdx = parseInt(cleanHash.replace('pindex-', ''), 10);
      if (!Number.isNaN(parsedIdx)) hashParaIndex = parsedIdx;
    }
  }

  const bookParam =
    pathBook ||
    params?.code ||
    (!fromTranslationRoute ? params?.slug?.[0] : null) ||
    urlParams.get('book') ||
    urlParams.get('book_code') ||
    null;

  const chapterParam =
    pathChapter ??
    (!fromTranslationRoute ? params?.slug?.[1] : null) ??
    urlParams.get('chapter') ??
    urlParams.get('c') ??
    null;

  const explicitParaNum =
    hashParaNum ||
    urlParams.get('para') ||
    urlParams.get('p') ||
    urlParams.get('paranum') ||
    null;

  const explicitParaIndex =
    hashParaIndex ??
    (urlParams.get('pindex') ? parseInt(urlParams.get('pindex'), 10) : undefined);

  const effectiveLang = pathTransLang || cleanQueryL || null;

  return {
    query,
    cleanQueryL,
    effectiveLang,
    fromTranslationRoute,
    bookParam,
    chapterParam,
    explicitParaNum,
    explicitParaIndex,
    tabParam: urlParams.get('tab') || null,
    needsLegacyParamCleanup:
      urlParams.has('db') ||
      urlParams.has('lang') ||
      (urlParams.has('l') && urlParams.get('l') !== cleanQueryL),
  };
}
