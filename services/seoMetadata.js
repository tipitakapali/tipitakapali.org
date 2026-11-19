import { capitalizePali, convertPaliScript, SCRIPT_URL_PREFIXES } from './transliterate.js';

export const SITE_URL = 'https://tipitakapali.org';

export const DEFAULT_SEO_TITLE = 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Pāḷi Canon & 23 Translations';
export const DEFAULT_SEO_DESCRIPTION =
  'Read the 217-book Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon in 17 scripts with 23 modern translations, DPD dictionary, 387K+ bold definitions, and fast search.';

export const TRANSLATION_LANGS = [
  { code: 'en', name: 'English', native: 'English', bcp47: 'en', hreflang: 'en', ogLocale: 'en_US' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', bcp47: 'vi', hreflang: 'vi', ogLocale: 'vi_VN' },
  { code: 'my', name: 'Myanmar / Burmese', native: 'မြန်မာ', bcp47: 'my', hreflang: 'my', ogLocale: 'my_MM' },
  { code: 'my_nissaya', name: 'Myanmar Nissaya', native: 'မြန်မာ နိဿယ', bcp47: 'my-MM', hreflang: 'my-MM', ogLocale: 'my_MM' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල', bcp47: 'si', hreflang: 'si', ogLocale: 'si_LK' },
  { code: 'zh', name: 'Chinese', native: '中文', bcp47: 'zh', hreflang: 'zh', ogLocale: 'zh_CN' },
  { code: 'th', name: 'Thai', native: 'ไทย', bcp47: 'th', hreflang: 'th', ogLocale: 'th_TH' },
  { code: 'km', name: 'Khmer', native: 'ភាសាខ្មែរ', bcp47: 'km', hreflang: 'km', ogLocale: 'km_KH' },
  { code: 'lo', name: 'Lao', native: 'ລາວ', bcp47: 'lo', hreflang: 'lo', ogLocale: 'lo_LA' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', bcp47: 'ta', hreflang: 'ta', ogLocale: 'ta_IN' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', bcp47: 'hi', hreflang: 'hi', ogLocale: 'hi_IN' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', bcp47: 'id', hreflang: 'id', ogLocale: 'id_ID' },
  { code: 'es', name: 'Spanish', native: 'Español', bcp47: 'es', hreflang: 'es', ogLocale: 'es_ES' },
  { code: 'fr', name: 'French', native: 'Français', bcp47: 'fr', hreflang: 'fr', ogLocale: 'fr_FR' },
  { code: 'de', name: 'German', native: 'Deutsch', bcp47: 'de', hreflang: 'de', ogLocale: 'de_DE' },
  { code: 'ja', name: 'Japanese', native: '日本語', bcp47: 'ja', hreflang: 'ja', ogLocale: 'ja_JP' },
  { code: 'pt', name: 'Portuguese', native: 'Português', bcp47: 'pt', hreflang: 'pt', ogLocale: 'pt_PT' },
  { code: 'ru', name: 'Russian', native: 'Русский', bcp47: 'ru', hreflang: 'ru', ogLocale: 'ru_RU' },
  { code: 'ko', name: 'Korean', native: '한국어', bcp47: 'ko', hreflang: 'ko', ogLocale: 'ko_KR' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', bcp47: 'ne', hreflang: 'ne', ogLocale: 'ne_NP' },
  { code: 'be', name: 'Bengali', native: 'বাংলা', bcp47: 'bn', hreflang: 'bn', ogLocale: 'bn_BD' },
  { code: 'cs', name: 'Czech', native: 'Čeština', bcp47: 'cs', hreflang: 'cs', ogLocale: 'cs_CZ' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', bcp47: 'mr', hreflang: 'mr', ogLocale: 'mr_IN' },
];

export const PALI_SCRIPT_LIST = [
  { code: 'si', scriptId: 'sinhala', name: 'Sinhala', shortName: 'Sinhala', native: 'සිංහල', bcp47: 'pi-Sinh' },
  { code: 'hi', scriptId: 'devanagari', name: 'Devanagari / Hindi', shortName: 'Devanagari', native: 'देवनागरी', bcp47: 'pi-Deva' },
  { code: 'thai', scriptId: 'thai', name: 'Thai', shortName: 'Thai', native: 'ไทย', bcp47: 'pi-Thai' },
  { code: 'laos', scriptId: 'laos', name: 'Lao', shortName: 'Lao', native: 'ລາວ', bcp47: 'pi-Laoo' },
  { code: 'my', scriptId: 'myanmar', name: 'Myanmar / Burmese', shortName: 'Myanmar', native: 'မြန်မာ', bcp47: 'pi-Mymr' },
  { code: 'km', scriptId: 'khmer', name: 'Khmer', shortName: 'Khmer', native: 'ខ្មែរ', bcp47: 'pi-Khmr' },
  { code: 'beng', scriptId: 'bengali', name: 'Bengali', shortName: 'Bengali', native: 'বাংলা', bcp47: 'pi-Beng' },
  { code: 'gurm', scriptId: 'gurmukhi', name: 'Gurmukhi', shortName: 'Gurmukhi', native: 'ਗੁਰਮੁਖੀ', bcp47: 'pi-Guru' },
  { code: 'tham', scriptId: 'taitham', name: 'Tai Tham / Lanna', shortName: 'Tai Tham', native: 'ᨲ᩠ᩅᩫᨾᩮᩥᩬᨦ', bcp47: 'pi-Lana' },
  { code: 'guja', scriptId: 'gujarati', name: 'Gujarati', shortName: 'Gujarati', native: 'ગુજરાતી', bcp47: 'pi-Gujr' },
  { code: 'telu', scriptId: 'telugu', name: 'Telugu', shortName: 'Telugu', native: 'తెలుగు', bcp47: 'pi-Telu' },
  { code: 'kann', scriptId: 'kannada', name: 'Kannada', shortName: 'Kannada', native: 'ಕನ್ನಡ', bcp47: 'pi-Knda' },
  { code: 'mala', scriptId: 'malayalam', name: 'Malayalam', shortName: 'Malayalam', native: 'മലയാളം', bcp47: 'pi-Mlym' },
  { code: 'brah', scriptId: 'brahmi', name: 'Brahmi', shortName: 'Brahmi', native: '𑀩𑁆𑀭𑀸𑀳𑁆𑀫𑀻', bcp47: 'pi-Brah' },
  { code: 'tibt', scriptId: 'tibetan', name: 'Tibetan', shortName: 'Tibetan', native: 'བོད་སྐད།', bcp47: 'pi-Tibt' },
  { code: 'cyrl', scriptId: 'cyrillic', name: 'Cyrillic', shortName: 'Cyrillic', native: 'кириллица', bcp47: 'pi-Cyrl' },
];

export const ALL_SCHEMA_LANGUAGES = [
  'pi',
  'en', 'vi', 'my', 'si', 'zh', 'th', 'km', 'lo', 'ta', 'hi',
  'id', 'es', 'fr', 'de', 'ja', 'pt', 'ru', 'ko', 'ne', 'bn', 'cs', 'mr',
];

const TRANSLATION_LANG_BY_CODE = new Map(TRANSLATION_LANGS.map((t) => [t.code, t]));
const PALI_SCRIPT_BY_CODE = new Map(PALI_SCRIPT_LIST.map((s) => [s.code, s]));
const PALI_SCRIPT_BY_ID = new Map(PALI_SCRIPT_LIST.map((s) => [s.scriptId, s]));

export function isValidTranslationLang(langCode) {
  return typeof langCode === 'string' && TRANSLATION_LANG_BY_CODE.has(langCode);
}

export function getTranslationLangMeta(langCode) {
  if (!langCode || typeof langCode !== 'string') return null;
  return TRANSLATION_LANG_BY_CODE.get(langCode) || null;
}

export function getPaliScriptMeta(scriptPrefixOrId) {
  if (!scriptPrefixOrId || typeof scriptPrefixOrId !== 'string') return null;
  const key = scriptPrefixOrId.trim().toLowerCase();
  if (key === 'roman' || key === 'ro' || key === 'latn') return null;
  return (
    PALI_SCRIPT_BY_CODE.get(key) ||
    PALI_SCRIPT_BY_ID.get(key) ||
    (SCRIPT_URL_PREFIXES[key] ? PALI_SCRIPT_BY_ID.get(SCRIPT_URL_PREFIXES[key]) : null) ||
    null
  );
}

export function buildCanonicalPath({
  bookCode,
  scriptPrefix = null,
  translationLang = null,
  chapterNum = null,
} = {}) {
  if (!bookCode) return '/';
  const chapSeg = chapterNum && Number.isInteger(chapterNum) && chapterNum > 0 ? `/${chapterNum}` : '';
  if (translationLang && isValidTranslationLang(translationLang)) {
    return `/translation/${translationLang}/${bookCode}${chapSeg}`;
  }
  const scMeta = scriptPrefix ? getPaliScriptMeta(scriptPrefix) : null;
  if (scMeta) {
    return `/book/${scMeta.code}.${bookCode}${chapSeg}`;
  }
  return `/book/${bookCode}${chapSeg}`;
}

/**
 * Build a strictly valid, deduplicated, bidirectional BCP-47 hreflang map
 * covering x-default, Roman Pāḷi (pi), all 16 non-Roman Pāḷi scripts (pi-Script),
 * and modern translations (with bn for Bengali `be` and my-MM for `my_nissaya`).
 * When `availableTranslationLangs` (Set/Array of lang codes) is provided, only
 * translation languages with actual content for that book/chapter are emitted so
 * hreflang stays strictly reciprocal and never points to untranslated noindex pages.
 */
export function buildAlternatesLanguages(bookCode, chapterNum = null, availableTranslationLangs = null) {
  if (!bookCode) return {};
  const chapSeg = chapterNum && Number.isInteger(chapterNum) && chapterNum > 0 ? `/${chapterNum}` : '';
  const romanUrl = `${SITE_URL}/book/${bookCode}${chapSeg}`;
  const allowedLangs =
    availableTranslationLangs instanceof Set
      ? availableTranslationLangs
      : Array.isArray(availableTranslationLangs)
        ? new Set(availableTranslationLangs)
        : null;

  const languages = {
    'x-default': romanUrl,
    pi: romanUrl,
  };

  for (const sc of PALI_SCRIPT_LIST) {
    languages[sc.bcp47] = `${SITE_URL}/book/${sc.code}.${bookCode}${chapSeg}`;
  }

  for (const t of TRANSLATION_LANGS) {
    if (allowedLangs && !allowedLangs.has(t.code)) continue;
    if (!Object.prototype.hasOwnProperty.call(languages, t.hreflang)) {
      languages[t.hreflang] = `${SITE_URL}/translation/${t.code}/${bookCode}${chapSeg}`;
    }
  }

  return languages;
}

function cleanNavSegment(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\s*\((?:Aṭṭhakathā|Ṭīkā|Mūla|Atthakatha|Tika|Mula)\)\s*/gi, ' ')
    .replace(/\bAṅguttaranikāya\b/gi, 'Aṅguttara Nikāya')
    .replace(/\bDīghanikāya\b/gi, 'Dīgha Nikāya')
    .replace(/\bMajjhimanikāya\b/gi, 'Majjhima Nikāya')
    .replace(/\bSaṃyuttanikāya\b/gi, 'Saṃyutta Nikāya')
    .replace(/\bKhuddakanikāya\b/gi, 'Khuddaka Nikāya')
    .replace(/\bVinayapiṭaka\b/gi, 'Vinaya Piṭaka')
    .replace(/\bSuttapiṭaka\b/gi, 'Sutta Piṭaka')
    .replace(/\bAbhidhammapiṭaka\b/gi, 'Abhidhamma Piṭaka')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getBookLayerLabel(bookCode, entry) {
  const matn = String(entry?.matn || '').toLowerCase();
  const code = String(bookCode || '').toLowerCase();
  if (matn === 'mula' || code.endsWith('.mul')) return 'Mūla';
  if (matn === 'atthakatha' || code.endsWith('.att')) return 'Aṭṭhakathā';
  if (matn === 'tika' || code.endsWith('.tik')) return 'Ṭīkā';
  return 'Añña';
}

export function extractBookOwnTitleAndContext(bookCode, entry) {
  const segments = String(entry?.longNavPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  const ownRaw = segments.length > 0
    ? segments[segments.length - 1]
    : (entry?.title || entry?.mat?.mula_title || entry?.mat?.attha_title || entry?.mat?.tika_title || bookCode);

  const parentRaw = segments.length >= 2
    ? cleanNavSegment(segments[segments.length - 2])
    : cleanNavSegment(entry?.pitaka || '');

  const pitakaRaw = segments.length >= 2
    ? cleanNavSegment(segments[1])
    : cleanNavSegment(entry?.pitaka ? `${entry.pitaka} Piṭaka` : '');

  return {
    ownTitle: capitalizePali(ownRaw),
    parentLabel: parentRaw ? capitalizePali(parentRaw) : '',
    pitakaLabel: pitakaRaw ? capitalizePali(pitakaRaw) : '',
    layerLabel: getBookLayerLabel(bookCode, entry),
    segments,
  };
}

/**
 * Slice a UTF-16 string to at most `maxUnits` code units without ever splitting
 * a surrogate pair (important for astral scripts like Brahmi U+11000..U+1107F).
 */
function sliceUtf16Safe(str, maxUnits) {
  if (!str || str.length <= maxUnits) return str || '';
  let end = maxUnits;
  if (end > 0) {
    const code = str.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return str.slice(0, end);
}

function trimPiece(str, maxUnits) {
  const norm = String(str || '').replace(/\s+/g, ' ').trim();
  if (norm.length <= maxUnits) return norm;
  const cut = sliceUtf16Safe(norm, Math.max(1, maxUnits - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > Math.floor(maxUnits * 0.55) ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[,;:\-–\s]+$/, '')}…`;
}

function truncateDescription(text, maxLen = 160) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  const cut = sliceUtf16Safe(normalized, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 90 ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[,;:\-–\s.]+$/, '')}.`;
}

function ensureDescriptionBounds(candidates, minLen = 110, maxLen = 160) {
  const normalized = candidates
    .filter(Boolean)
    .map((c) => String(c).replace(/\s+/g, ' ').trim());

  const exact = normalized.find((c) => c.length >= minLen && c.length <= maxLen);
  if (exact) return exact;

  // If any candidate is shorter than minLen, pad cleanly without exceeding maxLen
  const shortCand = normalized.find((c) => c.length < minLen);
  if (shortCand) {
    const paddings = [
      ' Includes DPD dictionary, 387K+ bold definitions & Tipiṭaka Pāḷi search.',
      ' Complete Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon on TipitakaPali.org.',
      ' Explore Tipiṭaka Pāḷi Canon with DPD dictionary & search.',
      ' On TipitakaPali.org.',
    ];
    let padded = shortCand.endsWith('.') ? shortCand : `${shortCand}.`;
    for (const pad of paddings) {
      if (padded.length >= minLen && padded.length <= maxLen) return padded;
      if (padded.length + pad.length <= maxLen) {
        padded += pad;
        if (padded.length >= minLen) return padded;
      }
    }
    if (padded.length < minLen) {
      padded = truncateDescription(`${padded} Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon with DPD dictionary & fast search.`, maxLen);
    }
    return padded;
  }

  return truncateDescription(normalized[normalized.length - 1] || DEFAULT_SEO_DESCRIPTION, maxLen);
}

function cleanChapterTitle(rawTitle, chapterNum) {
  const trimmed = String(rawTitle || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return `Chapter ${chapterNum}`;
  const stripped = trimmed.replace(/^\d+\.\s*/, '').trim();
  return capitalizePali(stripped || trimmed);
}

function formatLangLabel(langMeta) {
  if (!langMeta) return '';
  if (langMeta.code === 'en') return 'English Translation';
  if (langMeta.native.toLowerCase() === langMeta.name.toLowerCase()) {
    return `${langMeta.name} Translation`;
  }
  return `${langMeta.native} (${langMeta.name})`;
}

/**
 * Build guaranteed-unique, SEO-optimal title (>= 42 chars) and meta description
 * (110–160 chars) for any combination of:
 *   - bookCode (all 217 books in cst_books_catalog.json)
 *   - scriptId / scriptPrefix (Roman default or any of the 16 non-Roman Pāḷi scripts)
 *   - translationLang (any of the 23 modern translations)
 *   - chapterNum (optional 1-based chapter number, 1..chaptersForBook.length)
 */
export function buildBookSeoMetadata(bookCode, entry, chaptersForBook = [], scriptOrOptions = null) {
  let scriptId = null;
  let scriptPrefix = null;
  let translationLang = null;
  let chapterNum = null;
  let availableTranslationLangs = null;

  if (typeof scriptOrOptions === 'string' && scriptOrOptions.trim()) {
    const sm = getPaliScriptMeta(scriptOrOptions);
    if (sm) {
      scriptId = sm.scriptId;
      scriptPrefix = sm.code;
    } else {
      scriptId = scriptOrOptions;
    }
  } else if (scriptOrOptions && typeof scriptOrOptions === 'object') {
    const sm = getPaliScriptMeta(scriptOrOptions.scriptPrefix || scriptOrOptions.scriptId);
    if (sm) {
      scriptId = sm.scriptId;
      scriptPrefix = sm.code;
    }
    if (scriptOrOptions.translationLang && isValidTranslationLang(scriptOrOptions.translationLang)) {
      translationLang = scriptOrOptions.translationLang;
      // Translation routes always use Roman Pāḷi metadata alongside the target language
      scriptId = null;
      scriptPrefix = null;
    }
    if (scriptOrOptions.chapterNum !== null && scriptOrOptions.chapterNum !== undefined) {
      const parsed = Number(scriptOrOptions.chapterNum);
      if (Number.isInteger(parsed) && parsed > 0) {
        chapterNum = parsed;
      }
    }
    if (
      scriptOrOptions.availableTranslationLangs instanceof Set ||
      Array.isArray(scriptOrOptions.availableTranslationLangs)
    ) {
      availableTranslationLangs = scriptOrOptions.availableTranslationLangs;
    }
  }

  const scriptMeta = scriptPrefix ? getPaliScriptMeta(scriptPrefix) : (scriptId ? getPaliScriptMeta(scriptId) : null);
  const langMeta = translationLang ? getTranslationLangMeta(translationLang) : null;

  const { ownTitle, parentLabel, pitakaLabel, layerLabel } = extractBookOwnTitleAndContext(bookCode, entry);

  const chapterList = Array.isArray(chaptersForBook) ? chaptersForBook : [];
  const chapCount = chapterList.length;
  const activeChapter = chapterNum && chapterNum <= chapCount ? chapterList[chapterNum - 1] : null;
  const romanChapterTitle = chapterNum ? cleanChapterTitle(activeChapter?.title, chapterNum) : '';

  const displayTitle = scriptMeta ? convertPaliScript(ownTitle, scriptMeta.scriptId) : ownTitle;
  const displayParent = parentLabel
    ? (scriptMeta ? convertPaliScript(parentLabel, scriptMeta.scriptId) : parentLabel)
    : '';
  const displayChapterTitle = romanChapterTitle
    ? (scriptMeta ? convertPaliScript(romanChapterTitle, scriptMeta.scriptId) : romanChapterTitle)
    : '';
  const brandSuffix = scriptMeta
    ? convertPaliScript('Tipiṭaka Pāḷi', scriptMeta.scriptId)
    : 'Tipiṭaka Pāḷi';

  const hasDistinctParent =
    Boolean(displayParent) &&
    displayParent.toLowerCase() !== displayTitle.toLowerCase();

  const contextParen = hasDistinctParent ? displayParent : layerLabel;
  const romanContextParen = (parentLabel && parentLabel.toLowerCase() !== ownTitle.toLowerCase())
    ? parentLabel
    : layerLabel;

  let title = '';

  if (langMeta) {
    const langDisplay = formatLangLabel(langMeta);
    if (chapterNum) {
      title = `Ch. ${chapterNum}: ${romanChapterTitle} — ${ownTitle} (${romanContextParen}) — ${langDisplay} | Tipiṭaka Pāḷi`;
    } else {
      title = `${ownTitle} (${romanContextParen}) — ${langDisplay} | Tipiṭaka Pāḷi`;
      if (title.length < 42) {
        title = `${ownTitle} (${romanContextParen}) — ${langDisplay} & Pāḷi Canon | Tipiṭaka Pāḷi`;
      }
    }
  } else if (scriptMeta) {
    if (chapterNum) {
      title = `Ch. ${chapterNum}: ${displayChapterTitle} — ${displayTitle} (${contextParen}) — ${scriptMeta.shortName} Pāḷi | ${brandSuffix}`;
    } else {
      title = `${displayTitle} (${contextParen}) — ${scriptMeta.shortName} Pāḷi Script | ${brandSuffix}`;
      if (title.length < 42) {
        title = `${displayTitle} (${contextParen}) — Pāḷi in ${scriptMeta.shortName} (${scriptMeta.native}) | ${brandSuffix}`;
      }
    }
  } else {
    if (chapterNum) {
      title = `Ch. ${chapterNum}: ${romanChapterTitle} — ${ownTitle} (${romanContextParen}) | Tipiṭaka Pāḷi`;
    } else {
      title = hasDistinctParent
        ? `${displayTitle} (${displayParent}) | ${brandSuffix}`
        : `${displayTitle} (${layerLabel}) | ${brandSuffix}`;
      if (title.length < 42) {
        const base = hasDistinctParent
          ? `${displayTitle} (${displayParent})`
          : `${displayTitle} (${layerLabel})`;
        title = `${base} — Pāḷi Canon & Translations | ${brandSuffix}`;
      }
    }
  }

  // Final safety floor for Bing (>= 42 chars)
  if (title.length < 42) {
    title = `${title} — Chaṭṭha Saṅgāyana Canon`;
  }

  // Build guaranteed-unique description in [110, 160] chars
  let description = '';
  const chapWord = chapCount === 1 ? 'chapter' : 'chapters';

  if (chapterNum) {
    const chTag = chapCount > 0 ? `Ch. ${chapterNum}/${chapCount}` : `Ch. ${chapterNum}`;
    if (langMeta) {
      const langShort = langMeta.code === 'en' ? 'English' : `${langMeta.native} (${langMeta.name})`;
      const candidates = [
        `Read ${chTag} (${romanChapterTitle}) of ${ownTitle} (${romanContextParen}) in ${langShort} alongside original Pāḷi & DPD dictionary.`,
        `Read ${chTag} (${trimPiece(romanChapterTitle, 30)}) of ${trimPiece(ownTitle, 28)} (${romanContextParen}) in ${langShort} with Pāḷi & DPD.`,
        `${chTag}: ${trimPiece(romanChapterTitle, 24)} — ${trimPiece(ownTitle, 24)} (${bookCode}) in ${langMeta.name} (${langMeta.native}) with Pāḷi & DPD dictionary.`,
        `${chTag} (${bookCode}) ${trimPiece(romanChapterTitle, 22)} in ${langMeta.name} (${langMeta.native}) alongside Pāḷi Canon & DPD dictionary.`,
      ];
      description = ensureDescriptionBounds(candidates);
    } else if (scriptMeta) {
      const scLabel = `${scriptMeta.shortName} Pāḷi`;
      const candidates = [
        `Read ${chTag} (${displayChapterTitle}) of ${displayTitle} (${contextParen}) in ${scLabel} (${scriptMeta.native}) with translations & DPD.`,
        `Read ${chTag} (${trimPiece(displayChapterTitle, 28)}) of ${trimPiece(displayTitle, 26)} (${bookCode}) in ${scLabel} script with 23 translations & DPD.`,
        `${chTag} (${bookCode}) ${trimPiece(displayChapterTitle, 22)} — ${trimPiece(displayTitle, 22)} in ${scLabel} script with 23 translations & DPD dictionary.`,
        `${chTag} (${bookCode}) in ${scriptMeta.shortName} Pāḷi script: ${trimPiece(romanChapterTitle, 26)} — ${trimPiece(ownTitle, 24)} with translations & DPD.`,
      ];
      description = ensureDescriptionBounds(candidates);
    } else {
      const candidates = [
        `Read ${chTag} (${romanChapterTitle}) of ${ownTitle} (${romanContextParen}, ${layerLabel}) in original Pāḷi with 23 translations & DPD dictionary.`,
        `Read ${chTag} (${trimPiece(romanChapterTitle, 32)}) of ${trimPiece(ownTitle, 28)} (${romanContextParen}) in Pāḷi with 23 translations & DPD.`,
        `${chTag}: ${trimPiece(romanChapterTitle, 28)} — ${trimPiece(ownTitle, 26)} (${bookCode}) in original Pāḷi with 23 translations & DPD dictionary.`,
        `${chTag} (${bookCode}) ${trimPiece(romanChapterTitle, 26)} of ${trimPiece(ownTitle, 24)} in Pāḷi (17 scripts) with 23 translations & DPD.`,
      ];
      description = ensureDescriptionBounds(candidates);
    }
  } else {
    // Book-level description (Roman, Script, or Translation)
    const ownLower = ownTitle.toLowerCase();
    const sampleChapters = [];
    for (const ch of chapterList) {
      const cleanedCh = ch?.title
        ? capitalizePali(String(ch.title).trim().replace(/^\d+\.\s*/, '').replace(/\s+/g, ' '))
        : '';
      if (!cleanedCh) continue;
      const tLow = cleanedCh.toLowerCase();
      if (tLow === ownLower || tLow === 'ganthārambhakathā' || tLow === 'namo tassa') continue;
      if (!sampleChapters.includes(cleanedCh)) {
        sampleChapters.push(cleanedCh);
      }
      if (sampleChapters.length >= 2) break;
    }

    const contextPart = hasDistinctParent
      ? `${displayParent}, ${layerLabel}`
      : layerLabel;
    const romanContextPart = (parentLabel && parentLabel.toLowerCase() !== ownTitle.toLowerCase())
      ? `${parentLabel}, ${layerLabel}`
      : layerLabel;

    if (langMeta) {
      const langShort = langMeta.code === 'en' ? 'English' : `${langMeta.native} (${langMeta.name})`;
      const candidates = [];
      if (chapCount > 1 && sampleChapters.length >= 1) {
        candidates.push(
          `Read ${ownTitle} (${romanContextPart}; ${chapCount} ${chapWord} incl. ${sampleChapters[0]}) in ${langShort} with Pāḷi & DPD.`
        );
      }
      candidates.push(
        `Read ${ownTitle} (${romanContextPart}, ${chapCount} ${chapWord}) in ${langShort} alongside original Pāḷi, DPD dictionary & bold definitions.`
      );
      candidates.push(
        `Read ${trimPiece(ownTitle, 32)} (${romanContextPart}, ${bookCode}) in ${langShort} alongside original Pāḷi & DPD dictionary.`
      );
      candidates.push(
        `${trimPiece(ownTitle, 28)} (${bookCode}, ${chapCount} ${chapWord}) in ${langMeta.name} (${langMeta.native}) with original Pāḷi & DPD dictionary.`
      );
      description = ensureDescriptionBounds(candidates);
    } else if (scriptMeta) {
      const scLabel = `${scriptMeta.shortName} Pāḷi`;
      const candidates = [
        `Read ${displayTitle} (${contextPart}, ${chapCount} ${chapWord}) in ${scLabel} script (${scriptMeta.native}) with 23 translations & DPD.`,
        `Read ${trimPiece(displayTitle, 32)} (${bookCode}, ${chapCount} ${chapWord}) in ${scLabel} script with 23 modern translations & DPD dictionary.`,
        `${trimPiece(displayTitle, 28)} (${bookCode}) — ${trimPiece(ownTitle, 24)} in ${scLabel} script with 23 translations & DPD dictionary.`,
        `${ownTitle} (${romanContextPart}, ${bookCode}) in ${scriptMeta.shortName} Pāḷi script with 23 translations & DPD dictionary.`,
      ];
      description = ensureDescriptionBounds(candidates);
    } else {
      const candidates = [];
      if (chapCount > 1 && sampleChapters.length >= 2) {
        candidates.push(
          `Read ${displayTitle} (${contextPart}; ${chapCount} ${chapWord} incl. ${sampleChapters[0]}, ${sampleChapters[1]}) in Pāḷi with 23 translations & DPD.`
        );
      }
      if (chapCount > 1 && sampleChapters.length >= 1) {
        candidates.push(
          `Read ${displayTitle} (${contextPart}; ${chapCount} ${chapWord} incl. ${sampleChapters[0]}) in Pāḷi (17 scripts) with 23 translations & DPD dictionary.`
        );
        candidates.push(
          `Read ${displayTitle} (${contextPart}; ${chapCount} ${chapWord}, ${sampleChapters[0]}) in Pāḷi with 23 translations & DPD.`
        );
      }
      if (chapCount > 1) {
        candidates.push(
          `Read ${displayTitle} (${contextPart}, ${chapCount} ${chapWord}) in Pāḷi (17 scripts) with 23 modern translations, DPD dictionary & bold definitions.`
        );
        candidates.push(
          `Read ${displayTitle} (${contextPart}, ${chapCount} ${chapWord}) in Pāḷi with 23 modern translations & DPD dictionary.`
        );
      } else {
        candidates.push(
          `Read ${displayTitle} (${contextPart}, ${bookCode}) in Pāḷi (17 scripts) with 23 modern translations, DPD dictionary & bold definitions.`
        );
        candidates.push(
          `Read ${displayTitle} (${contextPart}, ${bookCode}) in Pāḷi with 23 modern translations & DPD dictionary.`
        );
      }
      description = ensureDescriptionBounds(candidates);
    }
  }

  const canonicalPath = buildCanonicalPath({
    bookCode,
    scriptPrefix: scriptMeta?.code || null,
    translationLang: langMeta?.code || null,
    chapterNum,
  });
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const alternatesLanguages = buildAlternatesLanguages(bookCode, chapterNum, availableTranslationLangs);

  const inLanguage = langMeta ? langMeta.bcp47 : (scriptMeta ? scriptMeta.bcp47 : 'pi');
  const ogLocale = langMeta ? langMeta.ogLocale : 'pi_IN';

  const keywords = Array.from(
    new Set(
      [
        ownTitle,
        displayTitle,
        romanChapterTitle,
        displayChapterTitle,
        bookCode,
        parentLabel,
        pitakaLabel,
        layerLabel,
        scriptMeta ? `${ownTitle} ${scriptMeta.shortName}` : null,
        scriptMeta ? scriptMeta.native : null,
        langMeta ? `${ownTitle} ${langMeta.name} translation` : null,
        langMeta ? `${ownTitle} ${langMeta.native}` : null,
        `${ownTitle} Pali`,
        `${ownTitle} translation`,
        'Chaṭṭha Saṅgāyana Tipiṭaka',
        'Tipitaka Pali',
        'Pali Canon',
        'Theravada',
        'Digital Pali Dictionary',
      ].filter(Boolean)
    )
  );

  return {
    title,
    description,
    canonicalPath,
    canonicalUrl,
    alternatesLanguages,
    inLanguage,
    ogLocale,
    bookTitle: ownTitle,
    displayTitle,
    chapterNum,
    chapterTitle: romanChapterTitle,
    displayChapterTitle,
    parentLabel,
    displayParent,
    pitakaLabel,
    layerLabel,
    scriptMeta,
    langMeta,
    keywords,
    chapterCount: chapCount,
  };
}

function toAnchorSlug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build accurate Book or Chapter JSON-LD plus unique-URL BreadcrumbList JSON-LD
 * matching the page's canonical URL, language/script, and chapter hierarchy.
 */
export function buildPageJsonLd(bookCode, entry, chaptersForBook = [], seo = null) {
  if (!entry || !seo) {
    return { primaryJsonLd: null, breadcrumbJsonLd: null };
  }

  const chapterList = Array.isArray(chaptersForBook) ? chaptersForBook : [];
  const bookCanonicalPath = buildCanonicalPath({
    bookCode,
    scriptPrefix: seo.scriptMeta?.code || null,
    translationLang: seo.langMeta?.code || null,
    chapterNum: null,
  });
  const bookCanonicalUrl = `${SITE_URL}${bookCanonicalPath}`;

  let primaryJsonLd;
  if (seo.chapterNum) {
    primaryJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Chapter',
      '@id': `${seo.canonicalUrl}#chapter`,
      name: seo.displayChapterTitle || `Chapter ${seo.chapterNum}`,
      headline: seo.title,
      description: seo.description,
      position: seo.chapterNum,
      identifier: `${bookCode}#c${seo.chapterNum}`,
      inLanguage: seo.inLanguage,
      isAccessibleForFree: true,
      license: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
      url: seo.canonicalUrl,
      isPartOf: {
        '@type': 'Book',
        '@id': `${bookCanonicalUrl}#book`,
        name: seo.displayTitle,
        url: bookCanonicalUrl,
        inLanguage: seo.inLanguage,
      },
      ...(seo.langMeta
        ? {
            translationOfWork: {
              '@type': 'Chapter',
              '@id': `${SITE_URL}/book/${bookCode}/${seo.chapterNum}#chapter`,
              name: seo.chapterTitle || `Chapter ${seo.chapterNum}`,
              url: `${SITE_URL}/book/${bookCode}/${seo.chapterNum}`,
              inLanguage: 'pi',
            },
          }
        : {}),
    };
  } else {
    primaryJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Book',
      '@id': `${seo.canonicalUrl}#book`,
      name: seo.displayTitle,
      headline: seo.title,
      description: seo.description,
      identifier: bookCode,
      inLanguage: seo.inLanguage,
      isAccessibleForFree: true,
      license: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
      url: seo.canonicalUrl,
      genre: seo.parentLabel || entry.pitaka || 'Buddhism',
      isPartOf: {
        '@type': 'BookSeries',
        name: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
        url: `${SITE_URL}/`,
      },
      ...(seo.langMeta
        ? {
            translationOfWork: {
              '@type': 'Book',
              '@id': `${SITE_URL}/book/${bookCode}#book`,
              name: seo.bookTitle,
              url: `${SITE_URL}/book/${bookCode}`,
              inLanguage: 'pi',
            },
          }
        : {}),
      about: [
        { '@type': 'Thing', name: 'Buddhism' },
        { '@type': 'Thing', name: 'Theravada' },
        { '@type': 'Thing', name: 'Pali Canon' },
        ...(seo.parentLabel ? [{ '@type': 'Thing', name: seo.parentLabel }] : []),
      ],
      ...(chapterList.length > 0
        ? {
            hasPart: chapterList.slice(0, 50).map((ch, idx) => {
              const chNum = idx + 1;
              const chName = cleanChapterTitle(ch.title, chNum);
              const chDisplay = seo.scriptMeta ? convertPaliScript(chName, seo.scriptMeta.scriptId) : chName;
              const chPath = buildCanonicalPath({
                bookCode,
                scriptPrefix: seo.scriptMeta?.code || null,
                translationLang: seo.langMeta?.code || null,
                chapterNum: chNum,
              });
              return {
                '@type': 'Chapter',
                position: chNum,
                name: chDisplay,
                url: `${SITE_URL}${chPath}`,
              };
            }),
          }
        : {}),
    };
  }

  const breadcrumbItems = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: `${SITE_URL}/`,
    },
  ];
  const seenBreadcrumbUrls = new Set([`${SITE_URL}/`]);

  const pushBreadcrumb = (name, itemUrl) => {
    if (!name || !itemUrl || seenBreadcrumbUrls.has(itemUrl)) return;
    seenBreadcrumbUrls.add(itemUrl);
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: breadcrumbItems.length + 1,
      name,
      item: itemUrl,
    });
  };

  if (seo.pitakaLabel) {
    pushBreadcrumb(seo.pitakaLabel, `${SITE_URL}/#pitaka-${toAnchorSlug(seo.pitakaLabel)}`);
  }
  if (seo.parentLabel && seo.parentLabel !== seo.pitakaLabel) {
    pushBreadcrumb(seo.parentLabel, `${SITE_URL}/#collection-${toAnchorSlug(seo.parentLabel)}`);
  }
  if (seo.langMeta) {
    pushBreadcrumb(seo.langMeta.name, `${SITE_URL}/#lang-${seo.langMeta.code}`);
  } else if (seo.scriptMeta) {
    pushBreadcrumb(`${seo.scriptMeta.shortName} Script`, `${SITE_URL}/#script-${seo.scriptMeta.code}`);
  }
  pushBreadcrumb(seo.displayTitle, bookCanonicalUrl);
  if (seo.chapterNum) {
    pushBreadcrumb(seo.displayChapterTitle || `Chapter ${seo.chapterNum}`, seo.canonicalUrl);
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  };

  return { primaryJsonLd, breadcrumbJsonLd };
}
