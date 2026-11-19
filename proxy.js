import { NextResponse } from 'next/server';
import { getBooksCatalog, getChaptersByBook } from './services/ssrCatalog';

const VALID_TRANSLATION_LANGS = new Set([
  'en', 'vi', 'my', 'my_nissaya', 'si', 'zh', 'th', 'km', 'lo', 'ta', 'hi',
  'id', 'es', 'fr', 'de', 'ja', 'pt', 'ru', 'ko', 'ne', 'be', 'cs', 'mr',
]);

const QUERY_LANG_ALIASES = {
  english: 'en',
  vietnamese: 'vi',
  viet: 'vi',
  myanmar: 'my',
  burmese: 'my',
  sinhala: 'si',
  sinhalese: 'si',
  chinese: 'zh',
  khmer: 'km',
  cambodian: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  indonesian: 'id',
  nepali: 'ne',
  bengali: 'be',
  bn: 'be',
  spanish: 'es',
  french: 'fr',
  portuguese: 'pt',
  russian: 'ru',
  czech: 'cs',
  marathi: 'mr',
  my_nissaya: 'my_nissaya',
  nissaya: 'my_nissaya',
  burmese_nissaya: 'my_nissaya',
};

const SCRIPT_PREFIX_RE = /^(?:si|hi|thai|laos|my|km|beng|gurm|tham|guja|telu|kann|mala|brah|tibt|cyrl)\./i;
const BOOK_CODE_RE = /^[a-z0-9_.-]+\.(?:mul|att|tik|nrf)$/i;
const LEGACY_CHAP_SUFFIX_RE = /^((?:(?:si|hi|thai|laos|my|km|beng|gurm|tham|guja|telu|kann|mala|brah|tibt|cyrl)\.)?[a-z0-9_.-]+\.(?:mul|att|tik|nrf))(\d+)$/i;

function normalizeRequestedLang(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:fts_)?(?:translation_)?/i, '')
    .replace(/\.db$/i, '');
  if (!cleaned || cleaned === 'pali' || cleaned === 'tipitaka') return null;
  const mapped = QUERY_LANG_ALIASES[cleaned] || cleaned;
  return VALID_TRANSLATION_LANGS.has(mapped) ? mapped : null;
}

/**
 * Next.js Proxy for:
 * 1. Canonicalizing legacy /book/{code}?l={lang} (and /book/{code}/{chapter}?l={lang})
 *    requests to clean SSR /translation/{lang}/{code} (or /translation/{lang}/{code}/{chapter}) URLs.
 * 2. AI Agent Content Negotiation (Accept: text/markdown per RFC / llmstxt.org).
 */
export function proxy(request) {
  const accept = request.headers.get('accept') || '';
  const pathname = request.nextUrl.pathname;

  const isStaticDoc = /\.(md|txt|json|xml|html|css|js|ico|png|svg|jpg|woff2?|ttf)$/i.test(pathname);

  // 1. Canonicalize legacy /book/{code}{N} -> 301 /book/{code}/{N+1} and /book/{code}(/{ch})?l={lang} -> 301 /translation/{lang}/{code}(/{ch})
  if (pathname.startsWith('/book/') && !isStaticDoc) {
    const sp = request.nextUrl.searchParams;
    const rawLang = sp.get('l') || sp.get('lang') || sp.get('db');
    const langCode = normalizeRequestedLang(rawLang);
    const segs = pathname.replace(/^\/book\//, '').split('/').filter(Boolean);
    const safeDecode = (s) => {
      try {
        return decodeURIComponent(s);
      } catch (_) {
        return '';
      }
    };
    const bookSeg = segs[0] ? safeDecode(segs[0]) : '';
    const chapSeg = segs[1] ? safeDecode(segs[1]) : '';

    // 1a. Legacy 0-based chapter suffix (/book/s0102m.mul8 -> 301 /book/s0102m.mul/9 or /translation/{lang}/s0102m.mul/9)
    // Only redirect valid catalog books and in-range chapter indices so bogus URLs 404 directly (no 301->404 chains).
    if (segs.length === 1 && bookSeg) {
      const legacyMatch = bookSeg.match(LEGACY_CHAP_SUFFIX_RE);
      if (legacyMatch) {
        const baseBook = legacyMatch[1];
        const zeroIdx = parseInt(legacyMatch[2], 10);
        const chapNum = zeroIdx + 1;
        const catalog = getBooksCatalog();
        const chaptersByBook = getChaptersByBook();
        const hasScriptPrefix = SCRIPT_PREFIX_RE.test(baseBook);
        const cleanBookCode = hasScriptPrefix ? baseBook.replace(SCRIPT_PREFIX_RE, '') : baseBook;
        const baseChaps = chaptersByBook.get(cleanBookCode) || [];
        const isValidLegacy =
          Boolean(catalog[cleanBookCode]) &&
          (!hasScriptPrefix || baseBook.startsWith(baseBook.match(SCRIPT_PREFIX_RE)[0].toLowerCase())) &&
          Number.isInteger(zeroIdx) &&
          zeroIdx >= 0 &&
          zeroIdx < baseChaps.length;

        if (isValidLegacy) {
          const target = request.nextUrl.clone();
          if (langCode && !hasScriptPrefix) {
            target.pathname = `/translation/${langCode}/${cleanBookCode}/${chapNum}`;
            target.searchParams.delete('l');
            target.searchParams.delete('lang');
            target.searchParams.delete('db');
          } else {
            target.pathname = `/book/${baseBook}/${chapNum}`;
          }
          const redirectResp = NextResponse.redirect(target, 301);
          redirectResp.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
          return redirectResp;
        }
      }
    }

    // 1b. Legacy ?l={lang} on valid Roman book URLs -> 301 /translation/{lang}/{book_code}(/{chapter})
    // Validate against catalog & chapter bounds so invalid books/chapters return direct HTTP 404.
    if (langCode) {
      // Only redirect clean Roman book URLs (preserve script-prefixed /book/{script}.{code}?l= if explicitly combined)
      if (
        segs.length <= 2 &&
        bookSeg &&
        !SCRIPT_PREFIX_RE.test(bookSeg) &&
        BOOK_CODE_RE.test(bookSeg) &&
        (!chapSeg || /^[1-9]\d*$/.test(chapSeg))
      ) {
        const catalog = getBooksCatalog();
        const chapsForBook = getChaptersByBook().get(bookSeg) || [];
        const chapNum = chapSeg ? parseInt(chapSeg, 10) : null;
        const isValidTarget =
          Boolean(catalog[bookSeg]) &&
          (!chapNum || (chapNum >= 1 && chapNum <= chapsForBook.length));

        if (isValidTarget) {
          const target = request.nextUrl.clone();
          target.pathname = chapSeg ? `/translation/${langCode}/${bookSeg}/${chapSeg}` : `/translation/${langCode}/${bookSeg}`;
          target.searchParams.delete('l');
          target.searchParams.delete('lang');
          target.searchParams.delete('db');
          const redirectResp = NextResponse.redirect(target, 301);
          redirectResp.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
          return redirectResp;
        }
      }
    }
  }

  // 2. Check if client explicitly requests machine-readable markdown for HTML pages
  if (accept.includes('text/markdown') && !pathname.startsWith('/api/') && !isStaticDoc) {
    const targetPath = pathname === '/' ? '/llms.txt' : '/llms-full.txt';
    const response = NextResponse.rewrite(new URL(targetPath, request.url));
    response.headers.set('Content-Type', 'text/markdown; charset=utf-8');
    response.headers.set('Vary', 'Accept');
    response.headers.set('x-markdown-tokens', pathname === '/' ? '3750' : '12900');
    return response;
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - fonts, icons, static assets
     */
    '/((?!_next/static|_next/image|fonts/|icons/|favicon.ico).*)',
  ],
};
