import { capitalizePali, convertPaliScript } from './transliterate.js';

export const SITE_URL = 'https://tipitakapali.org';

export const DEFAULT_SEO_TITLE = 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Pāḷi Canon & 23 Translations';
export const DEFAULT_SEO_DESCRIPTION =
  'Read the 217-book Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon in 17 scripts with 23 modern translations, DPD dictionary, 387K+ bold definitions, and fast search.';

export const TRANSLATION_LANGS = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'my', name: 'Myanmar / Burmese', native: 'မြန်မာ' },
  { code: 'my_nissaya', name: 'Myanmar Nissaya', native: 'မြန်မာ နိဿယ' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'km', name: 'Khmer', native: 'ភាសាខ្មែរ' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'be', name: 'Bengali', native: 'বাংলা' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
];

export const PALI_SCRIPT_LIST = [
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'hi', name: 'Devanagari / Hindi', native: 'देवनागरी' },
  { code: 'thai', name: 'Thai', native: 'ไทย' },
  { code: 'laos', name: 'Lao', native: 'ລາວ' },
  { code: 'my', name: 'Myanmar / Burmese', native: 'မြန်မာ' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ' },
  { code: 'beng', name: 'Bengali', native: 'বাংলা' },
  { code: 'gurm', name: 'Gurmukhi', native: 'ਗੁਰਮੁਖੀ' },
  { code: 'tham', name: 'Tai Tham / Lanna', native: 'ᨲ᩠ᩅᩫᨾᩮᩥᩬᨦ' },
  { code: 'guja', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'telu', name: 'Telugu', native: 'తెలుగు' },
  { code: 'kann', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'mala', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'brah', name: 'Brahmi', native: '𑀩𑁆𑀭𑀸𑀳𑁆𑀫𑀻' },
  { code: 'tibt', name: 'Tibetan', native: 'བོད་སྐད།' },
  { code: 'cyrl', name: 'Cyrillic', native: 'кириллица' },
];

export const ALL_SCHEMA_LANGUAGES = [
  'pi',
  'en', 'vi', 'my', 'si', 'zh', 'th', 'km', 'lo', 'ta', 'hi',
  'id', 'es', 'fr', 'de', 'ja', 'pt', 'ru', 'ko', 'ne', 'bn', 'cs', 'mr',
];

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

function truncateDescription(text, maxLen = 160) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  const cut = normalized.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 90 ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[,;:\-–\s]+$/, '')}.`;
}

/**
 * Build guaranteed-unique, SEO-optimal title (>= 42 chars) and meta description
 * (120–160 chars) for any of the 217 canonical books in cst_books_catalog.json.
 */
export function buildBookSeoMetadata(bookCode, entry, chaptersForBook = [], scriptId = null) {
  const { ownTitle, parentLabel, pitakaLabel, layerLabel } = extractBookOwnTitleAndContext(bookCode, entry);

  const displayTitle = scriptId ? convertPaliScript(ownTitle, scriptId) : ownTitle;
  const displayParent = parentLabel
    ? (scriptId ? convertPaliScript(parentLabel, scriptId) : parentLabel)
    : '';
  const brandSuffix = scriptId
    ? convertPaliScript('Tipiṭaka Pāḷi', scriptId)
    : 'Tipiṭaka Pāḷi';

  const hasDistinctParent =
    Boolean(displayParent) &&
    displayParent.toLowerCase() !== displayTitle.toLowerCase();

  let title = hasDistinctParent
    ? `${displayTitle} (${displayParent}) | ${brandSuffix}`
    : `${displayTitle} (${layerLabel}) | ${brandSuffix}`;

  // Ensure Bing never flags short titles (< 35 chars); keep >= 42 chars
  if (title.length < 42) {
    const base = hasDistinctParent
      ? `${displayTitle} (${displayParent})`
      : `${displayTitle} (${layerLabel})`;
    title = `${base} — Pāḷi Canon & Translations | ${brandSuffix}`;
  }

  // Pick up to 2 distinctive sample chapter titles for a rich, unique description
  const chapterList = Array.isArray(chaptersForBook) ? chaptersForBook : [];
  const chapCount = chapterList.length;
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

  const chapWord = chapCount === 1 ? 'chapter' : 'chapters';
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

  const description =
    candidates.find((c) => c.length <= 160 && c.length >= 110) ||
    candidates.find((c) => c.length <= 160) ||
    truncateDescription(candidates[candidates.length - 1], 160);

  const keywords = Array.from(
    new Set(
      [
        ownTitle,
        displayTitle,
        bookCode,
        parentLabel,
        pitakaLabel,
        layerLabel,
        `${ownTitle} Pali`,
        `${ownTitle} translation`,
        `${ownTitle} English translation`,
        `${ownTitle} Vietnamese translation`,
        `${ownTitle} Burmese translation`,
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
    bookTitle: ownTitle,
    displayTitle,
    parentLabel,
    pitakaLabel,
    layerLabel,
    keywords,
    chapterCount: chapCount,
  };
}
