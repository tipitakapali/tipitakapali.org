import fs from 'fs';
import path from 'path';
import { splitScriptCode } from './transliterate.js';
import {
  buildCanonicalPath,
  getPaliScriptMeta,
  isValidTranslationLang,
} from './seoMetadata.js';

let _catalogCache = null;
let _chaptersByBookCache = null;

export function getBooksCatalog() {
  if (_catalogCache) return _catalogCache;
  try {
    const catalogPath = path.join(process.cwd(), 'server_api', 'cst_books_catalog.json');
    if (fs.existsSync(catalogPath)) {
      _catalogCache = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      return _catalogCache;
    }
  } catch (_) {}
  return {};
}

export function getChaptersByBook() {
  if (_chaptersByBookCache) return _chaptersByBookCache;
  const map = new Map();
  try {
    const chapsPath = path.join(process.cwd(), 'server_api', 'chapters_catalog.json');
    if (fs.existsSync(chapsPath)) {
      const allChaps = JSON.parse(fs.readFileSync(chapsPath, 'utf8'));
      for (const ch of allChaps) {
        if (!ch?.book_code) continue;
        if (!map.has(ch.book_code)) map.set(ch.book_code, []);
        map.get(ch.book_code).push(ch);
      }
      for (const list of map.values()) {
        list.sort((a, b) => (a.chapter_index ?? 0) - (b.chapter_index ?? 0));
      }
    }
  } catch (_) {}
  _chaptersByBookCache = map;
  return map;
}

export function parseStrictPositiveInt(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^[1-9]\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

function safeDecodeSegment(seg) {
  if (typeof seg !== 'string') return null;
  try {
    return decodeURIComponent(seg);
  } catch (_) {
    return null;
  }
}

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

export function resolveQueryTranslationLang(searchParams) {
  if (!searchParams || typeof searchParams !== 'object') return null;
  const rawVal = searchParams.l ?? searchParams.lang ?? searchParams.db;
  const first = Array.isArray(rawVal) ? rawVal[0] : rawVal;
  if (!first || typeof first !== 'string') return null;
  const cleaned = first
    .trim()
    .toLowerCase()
    .replace(/^(?:fts_)?(?:translation_)?/i, '')
    .replace(/\.db$/i, '');
  if (!cleaned || cleaned === 'pali' || cleaned === 'tipitaka') return null;
  const mapped = QUERY_LANG_ALIASES[cleaned] || cleaned;
  return isValidTranslationLang(mapped) ? mapped : null;
}

export function parseBookRouteParams(slug) {
  if (!Array.isArray(slug) || slug.length < 1 || slug.length > 2) {
    return { valid: false };
  }

  const rawBookSeg = safeDecodeSegment(slug[0]);
  if (!rawBookSeg) return { valid: false };

  const scriptSplit = splitScriptCode(rawBookSeg);
  if (scriptSplit.prefix && !rawBookSeg.startsWith(`${scriptSplit.prefix}.`)) {
    return { valid: false };
  }

  const scriptMeta = scriptSplit.prefix ? getPaliScriptMeta(scriptSplit.prefix) : null;
  const catalog = getBooksCatalog();
  const chaptersByBook = getChaptersByBook();

  let bookCode = scriptSplit.bookCode;

  if (!catalog[bookCode]) {
    const suffixMatch = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (suffixMatch && slug.length === 1) {
      const baseCode = suffixMatch[1];
      const zeroIdx = parseInt(suffixMatch[2], 10);
      const baseEntry = catalog[baseCode];
      const baseChaps = chaptersByBook.get(baseCode) || [];
      if (baseEntry && Number.isInteger(zeroIdx) && zeroIdx >= 0 && zeroIdx < baseChaps.length) {
        return {
          valid: false,
          redirectTo: buildCanonicalPath({
            bookCode: baseCode,
            scriptPrefix: scriptMeta?.code || null,
            chapterNum: zeroIdx + 1,
          }),
        };
      }
    }
    return { valid: false };
  }

  const entry = catalog[bookCode];
  const chaptersForBook = chaptersByBook.get(bookCode) || [];

  let chapterNum = null;
  if (slug.length === 2) {
    const rawChapSeg = safeDecodeSegment(slug[1]);
    chapterNum = parseStrictPositiveInt(rawChapSeg);
    if (!chapterNum || chapterNum > chaptersForBook.length) {
      return { valid: false };
    }
  }

  return {
    valid: true,
    bookCode,
    scriptPrefix: scriptMeta?.code || null,
    scriptId: scriptMeta?.scriptId || null,
    scriptMeta,
    chapterNum,
    chapterIndex: chapterNum ? chapterNum - 1 : 0,
    entry,
    chaptersForBook,
  };
}

export function parseTranslationRouteParams(slug) {
  if (!Array.isArray(slug) || slug.length < 2 || slug.length > 3) {
    return { valid: false };
  }

  const langCode = safeDecodeSegment(slug[0]);
  const bookCode = safeDecodeSegment(slug[1]);
  if (!langCode || !bookCode) return { valid: false };

  if (!isValidTranslationLang(langCode)) {
    return { valid: false };
  }

  const catalog = getBooksCatalog();
  const entry = catalog[bookCode];
  if (!entry) {
    return { valid: false };
  }

  const chaptersForBook = getChaptersByBook().get(bookCode) || [];
  let chapterNum = null;
  if (slug.length === 3) {
    const rawChapSeg = safeDecodeSegment(slug[2]);
    chapterNum = parseStrictPositiveInt(rawChapSeg);
    if (!chapterNum || chapterNum > chaptersForBook.length) {
      return { valid: false };
    }
  }

  return {
    valid: true,
    translationLang: langCode,
    bookCode,
    chapterNum,
    chapterIndex: chapterNum ? chapterNum - 1 : 0,
    entry,
    chaptersForBook,
  };
}
