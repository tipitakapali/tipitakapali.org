'use strict';

const fs = require('fs');
const path = require('path');
const {
  capitalizePali,
  convertPaliScript,
  splitScriptCode,
  SCRIPT_URL_PREFIXES,
} = require('./transliterate');

const SITE_URL = 'https://tipitakapali.org';
const DEFAULT_SEO_TITLE = 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Pāḷi Canon & 23 Translations';
const DEFAULT_SEO_DESCRIPTION =
  'Read the 217-book Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon in 17 scripts with 23 modern translations, DPD dictionary, 387K+ bold definitions, and fast search.';

const TRANSLATION_LANGS = [
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

const PALI_SCRIPT_LIST = [
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

const TRANSLATION_LANG_BY_CODE = new Map(TRANSLATION_LANGS.map((t) => [t.code, t]));
const PALI_SCRIPT_BY_CODE = new Map(PALI_SCRIPT_LIST.map((s) => [s.code, s]));
const PALI_SCRIPT_BY_ID = new Map(PALI_SCRIPT_LIST.map((s) => [s.scriptId, s]));

function getTranslationLangMeta(langCode) {
  if (!langCode || typeof langCode !== 'string') return null;
  return TRANSLATION_LANG_BY_CODE.get(langCode.trim().toLowerCase()) || null;
}

function getPaliScriptMeta(scriptPrefixOrId) {
  if (!scriptPrefixOrId || typeof scriptPrefixOrId !== 'string') return null;
  const key = scriptPrefixOrId.trim().toLowerCase();
  if (key === 'roman' || key === 'ro' || key === 'latn') return null;
  return (
    PALI_SCRIPT_BY_CODE.get(key) ||
    PALI_SCRIPT_BY_ID.get(key) ||
    (SCRIPT_URL_PREFIXES && SCRIPT_URL_PREFIXES[key] ? PALI_SCRIPT_BY_ID.get(SCRIPT_URL_PREFIXES[key]) : null) ||
    null
  );
}

function buildCanonicalPath({ bookCode, scriptPrefix = null, translationLang = null, chapterNum = null } = {}) {
  if (!bookCode) return '/';
  const chapSeg = chapterNum && Number.isInteger(chapterNum) && chapterNum > 0 ? `/${chapterNum}` : '';
  if (translationLang && TRANSLATION_LANG_BY_CODE.has(translationLang)) {
    return `/translation/${translationLang}/${bookCode}${chapSeg}`;
  }
  const scMeta = scriptPrefix ? getPaliScriptMeta(scriptPrefix) : null;
  if (scMeta) {
    return `/book/${scMeta.code}.${bookCode}${chapSeg}`;
  }
  return `/book/${bookCode}${chapSeg}`;
}

function estimateMarkdownTokens(markdown) {
  if (!markdown || typeof markdown !== 'string') return 0;
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(trimmed, 'utf8') / 4));
}

function prefersMarkdownAccept(acceptHeader) {
  if (!acceptHeader || typeof acceptHeader !== 'string') return false;
  const lower = acceptHeader.toLowerCase();
  if (!lower.includes('text/markdown') && !lower.includes('text/x-markdown')) {
    return false;
  }

  let mdQ = -1;
  let htmlQ = -1;

  for (const part of lower.split(',')) {
    const segments = part.split(';').map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    const mediaType = segments[0];
    let q = 1.0;
    for (let i = 1; i < segments.length; i++) {
      const m = segments[i].match(/^q\s*=\s*([0-9.]+)$/);
      if (m) {
        const parsed = parseFloat(m[1]);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (mediaType === 'text/markdown' || mediaType === 'text/x-markdown') {
      mdQ = Math.max(mdQ, q);
    } else if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
      htmlQ = Math.max(htmlQ, q);
    }
  }

  if (mdQ <= 0) return false;
  if (htmlQ < 0) return true;
  return mdQ >= htmlQ;
}

function formatYamlFrontmatter(fields = {}) {
  const entries = Object.entries(fields).filter(
    ([, val]) => val !== undefined && val !== null && String(val).trim() !== ''
  );
  if (entries.length === 0) return '';
  const lines = ['---'];
  for (const [key, val] of entries) {
    const s = String(val ?? '').replace(/\r?\n/g, ' ').trim();
    lines.push(`${key}: ${JSON.stringify(s)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function formatJsonLdBlock(...jsonLdObjects) {
  const valid = jsonLdObjects.filter((obj) => obj && typeof obj === 'object');
  if (valid.length === 0) return '';
  const lines = ['', '```json'];
  for (const obj of valid) {
    lines.push(JSON.stringify(obj));
  }
  lines.push('```', '');
  return lines.join('\n');
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

function getBookLayerLabel(bookCode, entry) {
  const matn = String(entry?.matn || '').toLowerCase();
  const code = String(bookCode || '').toLowerCase();
  if (matn === 'mula' || code.endsWith('.mul')) return 'Mūla';
  if (matn === 'atthakatha' || code.endsWith('.att')) return 'Aṭṭhakathā';
  if (matn === 'tika' || code.endsWith('.tik')) return 'Ṭīkā';
  return 'Añña';
}

function extractBookOwnTitleAndContext(bookCode, entry) {
  const segments = String(entry?.longNavPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  const ownRaw =
    segments.length > 0
      ? segments[segments.length - 1]
      : entry?.title || entry?.mat?.mula_title || entry?.mat?.attha_title || entry?.mat?.tika_title || bookCode;

  const parentRaw =
    segments.length >= 2 ? cleanNavSegment(segments[segments.length - 2]) : cleanNavSegment(entry?.pitaka || '');

  const pitakaRaw =
    segments.length >= 2
      ? cleanNavSegment(segments[1])
      : cleanNavSegment(entry?.pitaka ? `${entry.pitaka} Piṭaka` : '');

  return {
    ownTitle: capitalizePali(ownRaw),
    parentLabel: parentRaw ? capitalizePali(parentRaw) : '',
    pitakaLabel: pitakaRaw ? capitalizePali(pitakaRaw) : '',
    layerLabel: getBookLayerLabel(bookCode, entry),
  };
}

function stripChapterHtmlToParagraphs(html) {
  if (!html || typeof html !== 'string') return [];
  const paragraphs = [];
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  let seq = 0;
  while ((m = pRe.exec(html)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const piMatch = attrs.match(/data-pindex="(\d+)"/i);
    const pnMatch = attrs.match(/data-para="([^"]+)"/i);
    const clsMatch = attrs.match(/class="([^"]+)"/i);
    const cleaned = inner
      .replace(/<span\b[^>]*class="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<span\b[^>]*class="[^"]*\bnote\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;
    paragraphs.push({
      paraIndex: piMatch ? parseInt(piMatch[1], 10) : seq++,
      paraNum: pnMatch ? pnMatch[1] : null,
      isHeading: Boolean(clsMatch && /\b(chapter|subhead|subsubhead|title|book|nikaya)\b/i.test(clsMatch[1])),
      pali: cleaned,
    });
  }
  return paragraphs;
}

function cleanTranslationPlainText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\r\n/g, '\n')
    .trim();
}

const _publicFileCache = new Map();
function readPublicFileCached(relPath) {
  if (_publicFileCache.has(relPath)) return _publicFileCache.get(relPath);
  const candidates = [
    path.resolve(__dirname, '..', 'public', relPath),
    path.resolve(process.cwd(), 'public', relPath),
    path.resolve(__dirname, '..', 'next_tipitakapali.org', relPath),
  ];
  for (const fullPath of candidates) {
    try {
      if (fs.existsSync(fullPath)) {
        const txt = fs.readFileSync(fullPath, 'utf8');
        _publicFileCache.set(relPath, txt);
        return txt;
      }
    } catch (_) {}
  }
  return null;
}

function createMarkdownEngine({
  cstCatalog,
  stmtGetChapters,
  stmtGetChapterHtml,
  hasChapterHtmlZ,
  decodeTextOrZlib,
  translationEngine,
}) {
  const chaptersByBookCache = new Map();

  function getChaptersForBook(bookCode) {
    if (chaptersByBookCache.has(bookCode)) return chaptersByBookCache.get(bookCode);
    try {
      const rows = stmtGetChapters.all(bookCode) || [];
      chaptersByBookCache.set(bookCode, rows);
      return rows;
    } catch (_) {
      return [];
    }
  }

  function getChapterHtml(bookCode, chapterIndex) {
    try {
      const row = stmtGetChapterHtml.get(bookCode, chapterIndex);
      if (!row) return null;
      return decodeTextOrZlib(row.html, hasChapterHtmlZ ? row.html_z : null);
    } catch (_) {
      return null;
    }
  }

  function renderBookOrTranslationMarkdown({
    bookCode,
    scriptMeta = null,
    langMeta = null,
    chapterNum = null,
  }) {
    const entry = cstCatalog[bookCode];
    if (!entry) return null;
    const chaptersForBook = getChaptersForBook(bookCode);
    if (chapterNum !== null && (chapterNum < 1 || chapterNum > chaptersForBook.length)) {
      return null;
    }

    let chapterIndex = chapterNum ? chapterNum - 1 : 0;
    let transMap = null;
    if (langMeta && translationEngine) {
      const code = translationEngine.ensureLanguage(langMeta.code);
      const dbEntry = code ? translationEngine.databases.get(code) : null;
      if (dbEntry) {
        if (!chapterNum) {
          try {
            const firstRow = dbEntry.db
              .prepare(
                'SELECT MIN(chapter_index) AS min_ch FROM paragraph_translations WHERE book_code = ?'
              )
              .get(bookCode);
            if (firstRow && firstRow.min_ch !== null && firstRow.min_ch !== undefined) {
              chapterIndex = Number(firstRow.min_ch);
            }
          } catch (_) {}
        }
        try {
          const rows = dbEntry.stmtChapter.all(bookCode, chapterIndex);
          transMap = new Map();
          for (const r of rows) {
            if (r.translation && String(r.translation).trim()) {
              transMap.set(Number(r.para_index), {
                paraNum: r.para_num !== null && r.para_num !== undefined ? String(r.para_num) : null,
                text: cleanTranslationPlainText(r.translation),
              });
            }
          }
        } catch (_) {}
      }
    }

    const html = getChapterHtml(bookCode, chapterIndex);
    const paliRows = html ? stripChapterHtmlToParagraphs(html) : [];

    // On Roman Pāḷi book/chapter requests (/book/s0101m.mul/1), if no explicit translation
    // language was requested, include aligned English (en) translation alongside the Pāḷi text
    // when available so AI agents reading /book/* get both the Pāḷi and its English translation.
    let defaultEnMap = null;
    if (!langMeta && !scriptMeta && translationEngine) {
      const enCode = translationEngine.ensureLanguage('en');
      const enEntry = enCode ? translationEngine.databases.get(enCode) : null;
      if (enEntry) {
        try {
          const rows = enEntry.stmtChapter.all(bookCode, chapterIndex);
          defaultEnMap = new Map();
          for (const r of rows) {
            if (r.translation && String(r.translation).trim()) {
              defaultEnMap.set(Number(r.para_index), {
                paraNum: r.para_num !== null && r.para_num !== undefined ? String(r.para_num) : null,
                text: cleanTranslationPlainText(r.translation),
              });
            }
          }
        } catch (_) {}
      }
    }

    const { ownTitle, parentLabel, pitakaLabel, layerLabel } = extractBookOwnTitleAndContext(bookCode, entry);
    const activeChapMeta = chaptersForBook[chapterIndex] || null;
    const rawChapTitle = activeChapMeta?.title
      ? capitalizePali(String(activeChapMeta.title).trim().replace(/^\d+\.\s*/, ''))
      : `Chapter ${chapterIndex + 1}`;

    const displayTitle = scriptMeta ? convertPaliScript(ownTitle, scriptMeta.scriptId) : ownTitle;
    const displayParent = parentLabel
      ? scriptMeta
        ? convertPaliScript(parentLabel, scriptMeta.scriptId)
        : parentLabel
      : '';
    const displayChapterTitle = scriptMeta
      ? convertPaliScript(rawChapTitle, scriptMeta.scriptId)
      : rawChapTitle;

    const contextParen =
      displayParent && displayParent.toLowerCase() !== displayTitle.toLowerCase()
        ? displayParent
        : layerLabel;
    const romanContextParen =
      parentLabel && parentLabel.toLowerCase() !== ownTitle.toLowerCase()
        ? parentLabel
        : layerLabel;

    let title = '';
    if (langMeta) {
      const langDisplay =
        langMeta.code === 'en'
          ? 'English Translation'
          : langMeta.native.toLowerCase() === langMeta.name.toLowerCase()
            ? `${langMeta.name} Translation`
            : `${langMeta.native} (${langMeta.name})`;
      title = chapterNum
        ? `Ch. ${chapterNum}: ${rawChapTitle} — ${ownTitle} (${romanContextParen}) — ${langDisplay} | Tipiṭaka Pāḷi`
        : `${ownTitle} (${romanContextParen}) — ${langDisplay} | Tipiṭaka Pāḷi`;
    } else if (scriptMeta) {
      title = chapterNum
        ? `Ch. ${chapterNum}: ${displayChapterTitle} — ${displayTitle} (${contextParen}) — ${scriptMeta.shortName} Pāḷi | Tipiṭaka Pāḷi`
        : `${displayTitle} (${contextParen}) — ${scriptMeta.shortName} Pāḷi Script | Tipiṭaka Pāḷi`;
    } else {
      title = chapterNum
        ? `Ch. ${chapterNum}: ${rawChapTitle} — ${ownTitle} (${romanContextParen}) | Tipiṭaka Pāḷi`
        : `${displayTitle} (${contextParen}) | Tipiṭaka Pāḷi`;
    }

    const chTag = chaptersForBook.length > 0 ? `Ch. ${chapterIndex + 1}/${chaptersForBook.length}` : `Ch. ${chapterIndex + 1}`;
    const description = langMeta
      ? `Read ${chapterNum ? `${chTag} (${rawChapTitle}) of ` : ''}${ownTitle} (${romanContextParen}, ${bookCode}) in ${langMeta.name} (${langMeta.native}) alongside original Pāḷi & DPD dictionary.`
      : scriptMeta
        ? `Read ${chapterNum ? `${chTag} (${displayChapterTitle}) of ` : ''}${displayTitle} (${contextParen}, ${bookCode}) in ${scriptMeta.shortName} Pāḷi script (${scriptMeta.native}) with 23 translations & DPD.`
        : `Read ${chapterNum ? `${chTag} (${rawChapTitle}) of ` : ''}${ownTitle} (${romanContextParen}, ${bookCode}) in original Pāḷi with 23 modern translations & DPD dictionary.`;

    const canonicalPath = buildCanonicalPath({
      bookCode,
      scriptPrefix: scriptMeta?.code || null,
      translationLang: langMeta?.code || null,
      chapterNum,
    });
    const canonicalUrl = `${SITE_URL}${canonicalPath}`;
    const inLanguage = langMeta ? langMeta.bcp47 : scriptMeta ? scriptMeta.bcp47 : 'pi';

    const frontmatter = formatYamlFrontmatter({
      title,
      description,
      url: canonicalUrl,
      inLanguage,
      bookCode,
      ...(chapterNum ? { chapter: String(chapterNum) } : {}),
      image: `${SITE_URL}/android-chrome-512x512.png`,
    });

    const bookBasePath = buildCanonicalPath({
      bookCode,
      scriptPrefix: scriptMeta?.code || null,
      translationLang: langMeta?.code || null,
      chapterNum: null,
    });

    const breadcrumbParts = [`[Tipiṭaka Pāḷi](${SITE_URL}/)`];
    if (pitakaLabel) breadcrumbParts.push(pitakaLabel);
    if (parentLabel && parentLabel !== pitakaLabel) breadcrumbParts.push(parentLabel);
    if (chapterNum) {
      breadcrumbParts.push(`[${displayTitle}](${SITE_URL}${bookBasePath})`);
      breadcrumbParts.push(displayChapterTitle);
    } else {
      breadcrumbParts.push(displayTitle);
    }

    const h1 = chapterNum ? `${displayChapterTitle} — ${displayTitle}` : displayTitle;
    const metaBits = ['Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI / CSCD)', layerLabel];
    if (langMeta) metaBits.push(`${langMeta.native} (${langMeta.name})`);
    if (scriptMeta) metaBits.push(`${scriptMeta.name} (${scriptMeta.native})`);

    const lines = [
      frontmatter.trimEnd(),
      '',
      `Breadcrumb: ${breadcrumbParts.join(' > ')}`,
      '',
      `# ${h1}`,
      '',
      `> ${metaBits.join(' · ')}`,
      '',
      description,
      '',
    ];

    const maxParagraphs = 120;
    const maxChars = 50000;
    let charBudget = 0;
    let count = 0;
    let truncated = false;

    if (paliRows.length > 0) {
      lines.push(
        `## ${chapterNum ? displayChapterTitle : `${displayChapterTitle} (Ch. ${chapterIndex + 1})`}`,
        ''
      );
      for (const row of paliRows) {
        if (count >= maxParagraphs || charBudget >= maxChars) {
          truncated = true;
          break;
        }
        const paliDisplay =
          scriptMeta && !langMeta ? convertPaliScript(row.pali, scriptMeta.scriptId) : row.pali;
        const trEntry = transMap ? transMap.get(row.paraIndex) : null;
        const trText = trEntry ? trEntry.text : null;
        const enFallbackEntry = !trText && defaultEnMap ? defaultEnMap.get(row.paraIndex) : null;
        const enFallbackText = enFallbackEntry ? enFallbackEntry.text : null;

        charBudget += (paliDisplay?.length || 0) + (trText?.length || enFallbackText?.length || 0);
        count++;

        const citeTag = `[${bookCode}:c${chapterIndex}:p${row.paraIndex}]`;
        const effParaNum = trEntry?.paraNum || enFallbackEntry?.paraNum || row.paraNum;
        const paraNumBadge = effParaNum ? ` (§${effParaNum})` : '';

        if (row.isHeading) {
          const headingText = trText
            ? `${trText}${paliDisplay ? ` — ${paliDisplay}` : ''}`
            : enFallbackText && enFallbackText.toLowerCase() !== (paliDisplay || '').toLowerCase()
              ? `${paliDisplay} — ${enFallbackText}`
              : paliDisplay;
          lines.push(`### ${headingText} ${citeTag}${paraNumBadge}`, '');
        } else {
          if (trText) {
            lines.push(`${trText} ${citeTag}${paraNumBadge}`, '');
          }
          if (paliDisplay) {
            lines.push(
              trText ? `*Pāḷi:* ${paliDisplay}` : `${paliDisplay} ${citeTag}${paraNumBadge}`,
              ''
            );
          }
          if (!trText && enFallbackText) {
            lines.push(`*English:* ${enFallbackText}`, '');
          }
        }
      }
      if (truncated) {
        lines.push(
          `*Showing opening ${count} of ${paliRows.length} paragraphs in this chapter. Fetch full chapter content via \`GET https://api.tipitakapali.org/api/ai/paragraph_content?book=${encodeURIComponent(bookCode)}&chapter=${chapterIndex}&start=0&end=500${langMeta ? `&langs=${langMeta.code}` : ''}\`.*`,
          ''
        );
      }
    }

    if (chaptersForBook.length > 0) {
      lines.push(`## Chapters in ${displayTitle} (${chaptersForBook.length})`, '');
      chaptersForBook.forEach((ch, idx) => {
        const chNum = idx + 1;
        const chLabelRaw = capitalizePali(ch.title || `Chapter ${chNum}`);
        const chLabel = scriptMeta ? convertPaliScript(chLabelRaw, scriptMeta.scriptId) : chLabelRaw;
        const href = buildCanonicalPath({
          bookCode,
          scriptPrefix: scriptMeta?.code || null,
          translationLang: langMeta?.code || null,
          chapterNum: chNum,
        });
        const currentMark = chapterNum === chNum ? ' *(current)*' : '';
        lines.push(`${chNum}. [${chLabel}](${SITE_URL}${href})${currentMark}`);
      });
      lines.push('');
    }

    lines.push(`## Modern Translations (${TRANSLATION_LANGS.length} Languages)`, '');
    for (const t of TRANSLATION_LANGS) {
      const href = buildCanonicalPath({
        bookCode,
        translationLang: t.code,
        chapterNum: chapterNum || null,
      });
      lines.push(`- [${t.native} (${t.name})](${SITE_URL}${href})`);
    }
    lines.push('');

    lines.push('## Pāḷi Scripts (17 Transliterations)', '');
    lines.push(
      `- [Roman Pāḷi (IAST)](${SITE_URL}${buildCanonicalPath({ bookCode, chapterNum: chapterNum || null })})`
    );
    for (const s of PALI_SCRIPT_LIST) {
      const href = buildCanonicalPath({
        bookCode,
        scriptPrefix: s.code,
        chapterNum: chapterNum || null,
      });
      lines.push(`- [${s.native} (${s.shortName})](${SITE_URL}${href})`);
    }
    lines.push('');

    const primaryJsonLd = chapterNum
      ? {
          '@context': 'https://schema.org',
          '@type': 'Chapter',
          '@id': `${canonicalUrl}#chapter`,
          name: displayChapterTitle,
          headline: title,
          description,
          position: chapterNum,
          identifier: `${bookCode}#c${chapterNum}`,
          inLanguage,
          isAccessibleForFree: true,
          url: canonicalUrl,
          isPartOf: {
            '@type': 'Book',
            '@id': `${SITE_URL}${bookBasePath}#book`,
            name: displayTitle,
            url: `${SITE_URL}${bookBasePath}`,
            inLanguage,
          },
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'Book',
          '@id': `${canonicalUrl}#book`,
          name: displayTitle,
          headline: title,
          description,
          identifier: bookCode,
          inLanguage,
          isAccessibleForFree: true,
          url: canonicalUrl,
        };

    const markdown = `${lines.join('\n').trim()}\n${formatJsonLdBlock(primaryJsonLd)}`;
    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl,
    };
  }

  function renderPath(rawPathname = '/', queryParams = {}) {
    const pathname = String(rawPathname || '/')
      .split('?')[0]
      .replace(/^\/api\/markdown(?=\/|$)/, '')
      .replace(/\/+$/, '') || '/';

    if (pathname === '/' || pathname === '/index' || pathname === '/index.html') {
      const frontmatter = formatYamlFrontmatter({
        title: DEFAULT_SEO_TITLE,
        description: DEFAULT_SEO_DESCRIPTION,
        url: `${SITE_URL}/`,
        image: `${SITE_URL}/android-chrome-512x512.png`,
      });
      const llms = readPublicFileCached('llms.txt') || `# ${DEFAULT_SEO_TITLE}\n\n${DEFAULT_SEO_DESCRIPTION}\n`;
      const markdown = `${frontmatter}${llms.trim()}\n`;
      return {
        status: 200,
        markdown,
        tokens: estimateMarkdownTokens(markdown),
        canonicalUrl: `${SITE_URL}/`,
      };
    }

    if (pathname === '/llms.txt' || pathname === '/llms-full.txt' || pathname === '/auth.md') {
      const rel = pathname.slice(1);
      const raw = readPublicFileCached(rel);
      if (raw) {
        return {
          status: 200,
          markdown: raw,
          tokens: estimateMarkdownTokens(raw),
          canonicalUrl: `${SITE_URL}${pathname}`,
        };
      }
    }

    if (pathname === '/info' || pathname === '/info.html') {
      const title = 'About & User Guide — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi | TipitakaPali.org';
      const description =
        'Guide to TipitakaPali.org: 217-book Pāḷi Canon, parallel columns, 23 modern translations, 387K+ bold definitions, DPD dictionary, 17 scripts, and Ani AI.';
      const frontmatter = formatYamlFrontmatter({
        title,
        description,
        url: `${SITE_URL}/info`,
        image: `${SITE_URL}/android-chrome-512x512.png`,
      });
      const llms = readPublicFileCached('llms.txt') || '';
      const markdown = `${frontmatter}# ${title}\n\n${description}\n\n${llms.trim()}\n`;
      return {
        status: 200,
        markdown,
        tokens: estimateMarkdownTokens(markdown),
        canonicalUrl: `${SITE_URL}/info`,
      };
    }

    if (pathname === '/pali-script-converter' || pathname === '/pali-script-converter.html') {
      const title = 'Pāḷi Script Converter (17 Scripts & Velthuis) | Tipiṭaka Pāḷi';
      const description =
        'Convert Pāḷi text instantly across 17 scripts (Roman, Devanagari, Sinhala, Myanmar, Thai, Khmer, Brahmi, Tibetan & more) with Velthuis & offline mode.';
      const frontmatter = formatYamlFrontmatter({
        title,
        description,
        url: `${SITE_URL}/pali-script-converter`,
        image: `${SITE_URL}/android-chrome-512x512.png`,
      });
      const scriptRows = PALI_SCRIPT_LIST.map(
        (s) => `- \`${s.code}\`: **${s.name}** (${s.native}, \`${s.bcp47}\`) → \`${SITE_URL}/book/${s.code}.s0101m.mul\``
      ).join('\n');
      const markdown = `${frontmatter}# ${title}\n\n${description}\n\n## Supported 17 Pāḷi Scripts\n- \`ro\` (default): **Roman (IAST)** → \`${SITE_URL}/book/s0101m.mul\`\n${scriptRows}\n`;
      return {
        status: 200,
        markdown,
        tokens: estimateMarkdownTokens(markdown),
        canonicalUrl: `${SITE_URL}/pali-script-converter`,
      };
    }

    if (pathname === '/privacy_policy' || pathname === '/privacy_policy.html' || pathname === '/privacy_policy.md') {
      const raw = readPublicFileCached('privacy_policy.md') || '# Privacy Policy\n';
      const frontmatter = formatYamlFrontmatter({
        title: 'Privacy Policy — Tipiṭaka Pāḷi Study App & Website | TipitakaPali.org',
        url: `${SITE_URL}/privacy_policy.html`,
      });
      const markdown = `${frontmatter}${raw.trim()}\n`;
      return {
        status: 200,
        markdown,
        tokens: estimateMarkdownTokens(markdown),
        canonicalUrl: `${SITE_URL}/privacy_policy.html`,
      };
    }

    if (pathname === '/terms_of_service' || pathname === '/terms_of_service.html' || pathname === '/terms_of_service.md') {
      const raw = readPublicFileCached('terms_of_service.md') || '# Terms of Service\n';
      const frontmatter = formatYamlFrontmatter({
        title: 'Terms of Service — Tipiṭaka Pāḷi & VRI Attribution | TipitakaPali.org',
        url: `${SITE_URL}/terms_of_service.html`,
      });
      const markdown = `${frontmatter}${raw.trim()}\n`;
      return {
        status: 200,
        markdown,
        tokens: estimateMarkdownTokens(markdown),
        canonicalUrl: `${SITE_URL}/terms_of_service.html`,
      };
    }

    if (pathname.startsWith('/book/')) {
      const slug = pathname
        .slice('/book/'.length)
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s).replace(/\.html$/i, ''));
      if (slug.length < 1 || slug.length > 2) return null;

      const split = splitScriptCode(slug[0]);
      let bookCode = split.bookCode;
      let chapterNum = null;

      // Support legacy 0-indexed suffix e.g. /book/s0102m.mul8 -> chapter 9
      if (!cstCatalog[bookCode] && slug.length === 1) {
        const m = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
        if (m && cstCatalog[m[1]]) {
          bookCode = m[1];
          chapterNum = parseInt(m[2], 10) + 1;
        }
      }
      if (!cstCatalog[bookCode]) return null;

      if (slug.length === 2) {
        if (!/^[1-9]\d*$/.test(slug[1])) return null;
        chapterNum = parseInt(slug[1], 10);
      }

      const rawLang = queryParams?.l || queryParams?.lang || queryParams?.db || null;
      const langMeta = rawLang ? getTranslationLangMeta(rawLang) : null;
      const scriptMeta = !langMeta && split.prefix ? getPaliScriptMeta(split.prefix) : null;

      return renderBookOrTranslationMarkdown({
        bookCode,
        scriptMeta,
        langMeta,
        chapterNum,
      });
    }

    if (pathname.startsWith('/translation/')) {
      const slug = pathname
        .slice('/translation/'.length)
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s).replace(/\.html$/i, ''));
      if (slug.length < 2 || slug.length > 3) return null;

      const langMeta = getTranslationLangMeta(slug[0]);
      const bookCode = slug[1];
      if (!langMeta || !cstCatalog[bookCode]) return null;

      let chapterNum = null;
      if (slug.length === 3) {
        if (!/^[1-9]\d*$/.test(slug[2])) return null;
        chapterNum = parseInt(slug[2], 10);
      }

      return renderBookOrTranslationMarkdown({
        bookCode,
        scriptMeta: null,
        langMeta,
        chapterNum,
      });
    }

    return null;
  }

  return {
    renderPath,
    prefersMarkdownAccept,
    estimateMarkdownTokens,
  };
}

module.exports = {
  createMarkdownEngine,
  prefersMarkdownAccept,
  estimateMarkdownTokens,
};
