import fs from 'fs';
import path from 'path';
import { capitalizePali, convertPaliScript } from './transliterate.js';
import {
  SITE_URL,
  DEFAULT_SEO_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  TRANSLATION_LANGS,
  PALI_SCRIPT_LIST,
  buildBookSeoMetadata,
  buildCanonicalPath,
  buildPageJsonLd,
} from './seoMetadata.js';
import {
  getBooksCatalog,
  getChaptersByBook,
  parseBookRouteParams,
  parseTranslationRouteParams,
} from './ssrCatalog.js';
import {
  getAvailableTranslationLangs,
  getTranslatedChapterIndices,
  getSsrChapterContent,
} from './ssrContent.js';

let _staticTextCache = new Map();

function readPublicFileCached(relPath) {
  if (_staticTextCache.has(relPath)) {
    return _staticTextCache.get(relPath);
  }
  try {
    const fullPath = path.join(process.cwd(), 'public', relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      _staticTextCache.set(relPath, content);
      return content;
    }
  } catch (_) {}
  return null;
}

/**
 * Estimate token count for an x-markdown-tokens response header (~4 UTF-8 chars per token).
 */
export function estimateMarkdownTokens(markdown) {
  if (!markdown || typeof markdown !== 'string') return 0;
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  const byteLen = Buffer.byteLength(trimmed, 'utf8');
  return Math.max(1, Math.ceil(byteLen / 4));
}

/**
 * Determine whether an HTTP Accept header prefers text/markdown over text/html.
 * Follows RFC 9110 content negotiation:
 * - Returns true when text/markdown is explicitly present with q > 0 and its
 *   quality weight is >= text/html (or text/html is absent).
 * - Standard browser headers like `text/html,application/xhtml+xml` with wildcard fallback
 *   do NOT contain `text/markdown`, so HTML remains the default for browsers.
 */
export function prefersMarkdownAccept(acceptHeader) {
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

function escapeYamlScalar(value) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return JSON.stringify(s);
}

export function formatYamlFrontmatter(fields = {}) {
  const entries = Object.entries(fields).filter(
    ([, val]) => val !== undefined && val !== null && String(val).trim() !== ''
  );
  if (entries.length === 0) return '';
  const lines = ['---'];
  for (const [key, val] of entries) {
    lines.push(`${key}: ${escapeYamlScalar(val)}`);
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

function buildHomeMarkdown() {
  const frontmatter = formatYamlFrontmatter({
    title: DEFAULT_SEO_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
    url: `${SITE_URL}/`,
    image: `${SITE_URL}/android-chrome-512x512.png`,
  });
  const llms = readPublicFileCached('llms.txt') || `# ${DEFAULT_SEO_TITLE}\n\n${DEFAULT_SEO_DESCRIPTION}\n`;
  return `${frontmatter}${llms.trim()}\n`;
}

function buildInfoMarkdown() {
  const title = 'About & User Guide — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi | TipitakaPali.org';
  const description =
    'Guide to TipitakaPali.org: 217-book Pāḷi Canon, parallel columns, 23 modern translations, 387K+ bold definitions, DPD dictionary, 17 scripts, and Ani AI.';
  const url = `${SITE_URL}/info`;
  const frontmatter = formatYamlFrontmatter({
    title,
    description,
    url,
    image: `${SITE_URL}/android-chrome-512x512.png`,
  });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'About & User Guide — TipitakaPali.org',
    url,
    description,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      url: `${SITE_URL}/`,
    },
  };
  const body = `# About & User Guide — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (TipitakaPali.org)

${description}

## Library Statistics
- **217** Canonical Books (Mūla, Aṭṭhakathā, Ṭīkā, Añña)
- **2,695+** Chapters
- **520,000+** Paragraphs & **1.2M+** Aligned Pāḷi Sentences
- **387,006** Pre-Indexed Canonical Bold Definitions
- **23** Modern Translations (24 Reading Layers including Pāḷi)
- **17** Pāḷi Writing Scripts (Roman IAST + 16 Asian Brahmic/Cyrillic Scripts)

## Overview
**TipitakaPali.org** presents the **Chaṭṭha Saṅgāyana Tipiṭaka (CST)** — the Pāḷi Canon as recited at the Sixth Buddhist Council — together with its **Aṭṭhakathā** (commentaries), **Ṭīkā** (sub-commentaries), and extra-canonical treatises, synchronized with the official **Vipassana Research Institute (VRI)** TEI XML corpus.

## Key Features
- **Reading, Parallel Columns & Floating Panels**: Non-shifting floating overlays with opt-in Pin for the Navigation Tree and Dictionary panel; multi-column parallel reading (\`Columns | Tabs | Single\`) with \`Sync\` scrolling across Mūla, Aṭṭhakathā, and Ṭīkā; live per-column section titles; and Read Aloud (TTS).
- **Two-Zone Language Menu & 23 Modern Translations**: Study original Pāḷi alongside English, Vietnamese, Myanmar, Myanmar Nissaya, Sinhala, Chinese, Khmer, Thai, Lao, Tamil, Hindi, Marathi, Indonesian, Czech, German, Spanish, French, Japanese, Portuguese, Russian, Korean, Nepali, and Bengali.
- **Full-Text Search (FTS5)**: Instant prefix and proximity (\`NEAR\`) search across all 217 books in Pāḷi or any of the 23 translation databases.
- **Dictionaries & 387K+ Pre-Indexed Bold Definitions**: Click any Pāḷi or translation word for Digital Pāḷi Dictionary (DPD 90,000+ entries), 387,006 canonical bold headword definitions, compound splitter, PTS PED, Pāḷi–Myanmar Abhidhān, Pāḷi–Sinhala, and Sanskrit lexicons.
- **MAT Cross-Navigation & Linked Definition Previews**: Jump or open connected Mūla, Aṭṭhakathā, and Ṭīkā passages side by side and inspect inline Linked Definition Popup Previews.
- **Ani (AI Nissaya) Assistant**: Concept-Group decomposition, 387K+ bold definitions grounding, verifiable \`[book:cX:pY-LZ]\` citations, and Zero-Key-Escape privacy.

## Machine-Readable Endpoints for Developers & AI Agents
- AI Research Playbook: [${SITE_URL}/llms.txt](${SITE_URL}/llms.txt)
- Full 217-Book Catalog & API Reference: [${SITE_URL}/llms-full.txt](${SITE_URL}/llms-full.txt)
- OpenAPI 3.1 Specification: [${SITE_URL}/openapi.json](${SITE_URL}/openapi.json)
- MCP Server Card: [${SITE_URL}/.well-known/mcp.json](${SITE_URL}/.well-known/mcp.json)
- Canonical XML Sitemap Index: [${SITE_URL}/sitemap.xml](${SITE_URL}/sitemap.xml)
`;
  return `${frontmatter}${body.trim()}\n${formatJsonLdBlock(jsonLd)}`;
}

function buildConverterMarkdown() {
  const title = 'Pāḷi Script Converter (17 Scripts & Velthuis) | Tipiṭaka Pāḷi';
  const description =
    'Convert Pāḷi text instantly across 17 scripts (Roman, Devanagari, Sinhala, Myanmar, Thai, Khmer, Brahmi, Tibetan & more) with Velthuis & offline mode.';
  const url = `${SITE_URL}/pali-script-converter`;
  const frontmatter = formatYamlFrontmatter({
    title,
    description,
    url,
    image: `${SITE_URL}/android-chrome-512x512.png`,
  });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Pāḷi Script Converter — TipitakaPali.org',
    url,
    applicationCategory: 'ReferenceApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    description,
  };
  const scriptRows = [
    '- `ro` (default): **Roman (IAST)** → `https://tipitakapali.org/book/s0101m.mul`',
    ...PALI_SCRIPT_LIST.map(
      (s) => `- \`${s.code}\`: **${s.name}** (${s.native}, \`${s.bcp47}\`) → \`${SITE_URL}/book/${s.code}.s0101m.mul\``
    ),
  ].join('\n');

  const body = `# ${title}

${description}

## Supported 17 Pāḷi Scripts
${scriptRows}

## Modified Latin Velthuis Input Scheme
| Velthuis Input | Pāḷi Output |
| :--- | :--- |
| \`aa\`, \`ii\`, \`uu\` | \`ā\`, \`ī\`, \`ū\` |
| \`.m\` / \`m..\` | \`ṃ\` / \`ṁ\` |
| \`.t\`, \`.d\`, \`.n\`, \`.l\` | \`ṭ\`, \`ḍ\`, \`ṇ\`, \`ḷ\` |
| \`~n\` or \`,,n\` | \`ñ\` |
| \`"n\` or \`n..\` | \`ṅ\` |

## Offline Converter Download
- Standalone Offline ZIP (~25 KB): [${SITE_URL}/pali-script-converter.zip](${SITE_URL}/pali-script-converter.zip)
`;
  return `${frontmatter}${body.trim()}\n${formatJsonLdBlock(jsonLd)}`;
}

function buildStaticDocMarkdown(relMdFile, title, description, canonicalPath) {
  const frontmatter = formatYamlFrontmatter({
    title,
    description,
    url: `${SITE_URL}${canonicalPath}`,
    image: `${SITE_URL}/android-chrome-512x512.png`,
  });
  const raw = readPublicFileCached(relMdFile) || `# ${title}\n\n${description}\n`;
  return `${frontmatter}${raw.trim()}\n`;
}

/**
 * Render a Book or Chapter SSR route (/book/... or /translation/...) as structured Markdown
 * with YAML frontmatter, breadcrumbs, Pāḷi + translation paragraphs, chapter TOC, and JSON-LD.
 */
export function renderBookArticleMarkdown({
  bookCode,
  entry,
  chaptersForBook = [],
  seo,
  chapterContent = null,
  availableTranslationLangs = null,
  availableChapterIndices = null,
  primaryJsonLd = null,
  breadcrumbJsonLd = null,
}) {
  const isChapterPage = Boolean(seo.chapterNum);
  const scriptMeta = seo.scriptMeta || null;
  const langMeta = seo.langMeta || null;

  const frontmatter = formatYamlFrontmatter({
    title: seo.title,
    description: seo.description,
    url: seo.canonicalUrl,
    inLanguage: seo.inLanguage,
    bookCode,
    ...(seo.chapterNum ? { chapter: String(seo.chapterNum) } : {}),
    image: `${SITE_URL}/android-chrome-512x512.png`,
  });

  const bookBasePath = buildCanonicalPath({
    bookCode,
    scriptPrefix: scriptMeta?.code || null,
    translationLang: langMeta?.code || null,
    chapterNum: null,
  });

  const breadcrumbParts = [`[Tipiṭaka Pāḷi](${SITE_URL}/)`];
  if (seo.pitakaLabel) breadcrumbParts.push(seo.pitakaLabel);
  if (seo.parentLabel && seo.parentLabel !== seo.pitakaLabel) breadcrumbParts.push(seo.parentLabel);
  if (isChapterPage) {
    breadcrumbParts.push(`[${seo.displayTitle}](${SITE_URL}${bookBasePath})`);
    breadcrumbParts.push(seo.displayChapterTitle || `Chapter ${seo.chapterNum}`);
  } else {
    breadcrumbParts.push(seo.displayTitle);
  }

  const h1 = isChapterPage
    ? `${seo.displayChapterTitle || `Chapter ${seo.chapterNum}`} — ${seo.displayTitle}`
    : seo.displayTitle;

  const metaBits = ['Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI / CSCD)'];
  if (seo.layerLabel) metaBits.push(seo.layerLabel);
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
    seo.description,
    '',
  ];

  const activeChapIdx = isChapterPage
    ? seo.chapterNum - 1
    : Number.isInteger(chapterContent?.chapterIndex) && chapterContent.chapterIndex >= 0
      ? chapterContent.chapterIndex
      : 0;
  const activeChapMeta = chaptersForBook[activeChapIdx] || null;
  const rawChapTitle = activeChapMeta?.title
    ? capitalizePali(String(activeChapMeta.title).trim())
    : `Chapter ${activeChapIdx + 1}`;
  const displayActiveChapTitle = scriptMeta
    ? convertPaliScript(rawChapTitle, scriptMeta.scriptId)
    : rawChapTitle;

  const paragraphs = Array.isArray(chapterContent?.paragraphs) ? chapterContent.paragraphs : [];
  if (paragraphs.length > 0) {
    lines.push(
      `## ${isChapterPage ? displayActiveChapTitle : `${displayActiveChapTitle} (Ch. ${activeChapIdx + 1})`}`,
      ''
    );
    for (const para of paragraphs) {
      const citeTag = `[${bookCode}:c${activeChapIdx}:p${para.paraIndex}]`;
      const paraNumBadge = para.paraNum ? ` (§${para.paraNum})` : '';
      if (para.isHeading) {
        const headingText = para.translation
          ? `${para.translation}${para.pali ? ` — ${para.pali}` : ''}`
          : para.pali || '';
        if (headingText) {
          lines.push(`### ${headingText} ${citeTag}${paraNumBadge}`, '');
        }
      } else {
        if (para.translation) {
          lines.push(`${para.translation} ${citeTag}${paraNumBadge}`, '');
        }
        if (para.pali) {
          lines.push(
            para.translation ? `*Pāḷi:* ${para.pali}` : `${para.pali} ${citeTag}${paraNumBadge}`,
            ''
          );
        }
      }
    }
    if (chapterContent?.truncated) {
      lines.push(
        `*Showing opening ${paragraphs.length} of ${chapterContent.totalParagraphs} paragraphs in this chapter. Fetch full chapter content via \`GET https://api.tipitakapali.org/api/ai/paragraph_content?book=${encodeURIComponent(bookCode)}&chapter=${activeChapIdx}&start=0&end=500${langMeta ? `&langs=${langMeta.code}` : ''}\`.*`,
        ''
      );
    }
  }

  const presentChapSet =
    langMeta && availableChapterIndices instanceof Set
      ? availableChapterIndices
      : langMeta && Array.isArray(availableChapterIndices)
        ? new Set(availableChapterIndices)
        : null;

  if (chaptersForBook.length > 0) {
    lines.push(`## Chapters in ${seo.displayTitle} (${chaptersForBook.length})`, '');
    chaptersForBook.forEach((ch, idx) => {
      const chNum = idx + 1;
      const chLabelRaw = capitalizePali(ch.title || `Chapter ${chNum}`);
      const chLabel = scriptMeta ? convertPaliScript(chLabelRaw, scriptMeta.scriptId) : chLabelRaw;
      const href = buildCanonicalPath({
        bookCode,
        scriptPrefix: scriptMeta?.code || null,
        translationLang:
          langMeta && (!presentChapSet || presentChapSet.has(idx)) ? langMeta.code : null,
        chapterNum: chNum,
      });
      const currentMark = isChapterPage && seo.chapterNum === chNum ? ' *(current)*' : '';
      lines.push(`${chNum}. [${chLabel}](${SITE_URL}${href})${currentMark}`);
    });
    lines.push('');
  }

  const allowedLangSet =
    availableTranslationLangs instanceof Set
      ? availableTranslationLangs
      : Array.isArray(availableTranslationLangs)
        ? new Set(availableTranslationLangs)
        : null;
  const visibleTranslationLangs = allowedLangSet
    ? TRANSLATION_LANGS.filter((t) => allowedLangSet.has(t.code))
    : TRANSLATION_LANGS;

  if (visibleTranslationLangs.length > 0) {
    lines.push(`## Modern Translations (${visibleTranslationLangs.length} Languages)`, '');
    for (const t of visibleTranslationLangs) {
      const href = buildCanonicalPath({
        bookCode,
        translationLang: t.code,
        chapterNum: seo.chapterNum || null,
      });
      lines.push(`- [${t.native} (${t.name})](${SITE_URL}${href})`);
    }
    lines.push('');
  }

  lines.push('## Pāḷi Scripts (17 Transliterations)', '');
  lines.push(
    `- [Roman Pāḷi (IAST)](${SITE_URL}${buildCanonicalPath({ bookCode, chapterNum: seo.chapterNum || null })})`
  );
  for (const s of PALI_SCRIPT_LIST) {
    const href = buildCanonicalPath({
      bookCode,
      scriptPrefix: s.code,
      chapterNum: seo.chapterNum || null,
    });
    lines.push(`- [${s.native} (${s.shortName})](${SITE_URL}${href})`);
  }
  lines.push('');

  const jsonLdSuffix = formatJsonLdBlock(primaryJsonLd, breadcrumbJsonLd);
  return `${lines.join('\n').trim()}\n${jsonLdSuffix}`;
}

/**
 * Resolve any canonical site path into a Markdown representation `{ status, markdown, tokens, canonicalUrl }`.
 */
export async function renderMarkdownForPath(rawPathname = '/') {
  const pathname = String(rawPathname || '/').replace(/\/+$/, '') || '/';

  if (pathname === '/' || pathname === '/index' || pathname === '/index.html') {
    const markdown = buildHomeMarkdown();
    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: `${SITE_URL}/`,
    };
  }

  if (pathname === '/info' || pathname === '/info.html') {
    const markdown = buildInfoMarkdown();
    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: `${SITE_URL}/info`,
    };
  }

  if (pathname === '/pali-script-converter' || pathname === '/pali-script-converter.html') {
    const markdown = buildConverterMarkdown();
    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: `${SITE_URL}/pali-script-converter`,
    };
  }

  if (pathname === '/privacy_policy' || pathname === '/privacy_policy.html' || pathname === '/privacy_policy.md') {
    const markdown = buildStaticDocMarkdown(
      'privacy_policy.md',
      'Privacy Policy — Tipiṭaka Pāḷi Study App & Website | TipitakaPali.org',
      'Privacy Policy for TipitakaPali.org — Zero-Key-Escape AI privacy, local-only bookmarks & history, and zero ad tracking across web, mobile, and desktop apps.',
      '/privacy_policy.html'
    );
    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: `${SITE_URL}/privacy_policy.html`,
    };
  }

  if (pathname === '/terms_of_service' || pathname === '/terms_of_service.html' || pathname === '/terms_of_service.md') {
    const markdown = buildStaticDocMarkdown(
      'terms_of_service.md',
      'Terms of Service — Tipiṭaka Pāḷi & VRI Attribution | TipitakaPali.org',
      'Terms of Service and CC BY-NC-SA 3.0 Dhamma dāna license for TipitakaPali.org web, mobile (Tipitaka CST), and desktop apps with VRI and DPD attributions.',
      '/terms_of_service.html'
    );
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
      .map((s) => s.replace(/\.html$/i, ''));
    const parsed = parseBookRouteParams(slug);
    if (!parsed.valid) {
      return null;
    }

    const [availableTranslationLangs, chapterContent] = await Promise.all([
      getAvailableTranslationLangs(parsed.bookCode, parsed.chapterNum ? parsed.chapterIndex : null),
      getSsrChapterContent({
        bookCode: parsed.bookCode,
        chapterIndex: parsed.chapterIndex,
        scriptId: parsed.scriptId,
        translationLang: parsed.scriptId ? null : 'en',
      }),
    ]);

    const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
      scriptPrefix: parsed.scriptPrefix,
      chapterNum: parsed.chapterNum,
      availableTranslationLangs,
    });
    const { primaryJsonLd, breadcrumbJsonLd } = buildPageJsonLd(
      parsed.bookCode,
      parsed.entry,
      parsed.chaptersForBook,
      seo
    );

    const markdown = renderBookArticleMarkdown({
      bookCode: parsed.bookCode,
      entry: parsed.entry,
      chaptersForBook: parsed.chaptersForBook,
      seo,
      chapterContent,
      availableTranslationLangs,
      primaryJsonLd,
      breadcrumbJsonLd,
    });

    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: seo.canonicalUrl,
    };
  }

  if (pathname.startsWith('/translation/')) {
    const slug = pathname
      .slice('/translation/'.length)
      .split('/')
      .filter(Boolean)
      .map((s) => s.replace(/\.html$/i, ''));
    const parsed = parseTranslationRouteParams(slug);
    if (!parsed.valid) {
      return null;
    }

    const [availableTranslationLangs, availableChapterIndices, chapterContent] = await Promise.all([
      getAvailableTranslationLangs(parsed.bookCode, parsed.chapterNum ? parsed.chapterIndex : null),
      getTranslatedChapterIndices(parsed.bookCode, parsed.translationLang),
      getSsrChapterContent({
        bookCode: parsed.bookCode,
        chapterIndex: parsed.chapterIndex,
        translationLang: parsed.translationLang,
        isBookRoot: !parsed.chapterNum,
      }),
    ]);

    const hasTranslation =
      availableTranslationLangs === null || availableTranslationLangs.has(parsed.translationLang);

    const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
      translationLang: parsed.translationLang,
      chapterNum: parsed.chapterNum,
      availableTranslationLangs,
    });

    const { primaryJsonLd, breadcrumbJsonLd } = hasTranslation
      ? buildPageJsonLd(parsed.bookCode, parsed.entry, parsed.chaptersForBook, seo)
      : { primaryJsonLd: null, breadcrumbJsonLd: null };

    const markdown = renderBookArticleMarkdown({
      bookCode: parsed.bookCode,
      entry: parsed.entry,
      chaptersForBook: parsed.chaptersForBook,
      seo,
      chapterContent,
      availableTranslationLangs,
      availableChapterIndices,
      primaryJsonLd,
      breadcrumbJsonLd,
    });

    return {
      status: 200,
      markdown,
      tokens: estimateMarkdownTokens(markdown),
      canonicalUrl: seo.canonicalUrl,
    };
  }

  return null;
}

export { getBooksCatalog, getChaptersByBook };
