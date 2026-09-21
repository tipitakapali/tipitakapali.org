import React, { Suspense } from 'react';
import fs from 'fs';
import path from 'path';
import { MainAppContent } from '../../page';
import { capitalizePali, splitScriptCode, convertPaliScript } from '../../../services/transliterate';

export const TRANSLATION_LANGS = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'my', name: 'Myanmar / Burmese', native: 'မြန်မာ' },
  { code: 'my_nissaya', name: 'Myanmar Nissaya', native: 'မြန်မာ နိဿယ' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'km', name: 'Khmer', native: 'ភាសាខ្មែរ' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
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

export async function generateStaticParams() {
  try {
    const catalogPath = path.join(process.cwd(), 'server_api', 'cst_books_catalog.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      return Object.keys(catalog).map((code) => ({
        slug: [code],
      }));
    }
  } catch (e) {}
  return [{ slug: ['default'] }];
}

export async function generateMetadata({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;

  const slug0 = unwrappedParams?.slug?.[0] ? decodeURIComponent(unwrappedParams.slug[0]) : '';
  let bookCode = slug0;
  let chapterParam = unwrappedParams?.slug?.[1];

  // Optional script prefix (e.g. si.abh03m10.mul -> abh03m10.mul)
  const scriptSplit = splitScriptCode(bookCode);
  bookCode = scriptSplit.bookCode;
  const scriptId = scriptSplit.scriptId;
  const scriptPrefix = scriptSplit.prefix;

  const chapSuffixMatch = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) {
    bookCode = chapSuffixMatch[1];
    if (!chapterParam) chapterParam = parseInt(chapSuffixMatch[2], 10) + 1;
  }

  // Self-canonical: plain /book/<[prefix.]code>. Chapter suffixes/segments and
  // ?l= translation variants are excluded, so deep-links and translation views
  // consolidate to the pre-rendered book page (canonical SEO lives on /book/*).
  const canonicalPath = bookCode
    ? `/book/${scriptPrefix ? `${scriptPrefix}.` : ''}${bookCode}`
    : '/';

  if (!bookCode) {
    return {
      title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with 15 modern translations, rich typography, multi-script support, and full-text search.',
      alternates: { canonical: canonicalPath },
    };
  }

  try {
    const catalogPath = path.join(process.cwd(), 'server_api', 'cst_books_catalog.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      const entry = catalog[bookCode];
      if (entry) {
        const bookTitle = capitalizePali(entry.mat?.mula_title || entry.mat?.attha_title || entry.mat?.tika_title || bookCode);
        const nikaya = entry.pitaka ? capitalizePali(entry.pitaka) : '';
        const appName = scriptId
          ? convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi', scriptId)
          : 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi';
        const displayTitle = scriptId ? convertPaliScript(bookTitle, scriptId) : bookTitle;
        const title = `${displayTitle} | ${appName}`;
        const description = `Read ${displayTitle} (${entry.longNavPath || nikaya}) in original Pāḷi with side-by-side translations in English, Vietnamese, Burmese, Sinhala, Thai, Hindi, German, Japanese, Portuguese, Chinese, Khmer, and sentence analysis.`;

        const keywords = [
          bookTitle,
          displayTitle,
          entry.code,
          nikaya,
          entry.pitaka || '',
          `${bookTitle} translation`,
          `${bookTitle} English translation`,
          `${bookTitle} Vietnamese translation`,
          `${bookTitle} Burmese translation`,
          `${bookTitle} Sinhala translation`,
          `${bookTitle} Thai translation`,
          `${bookTitle} German translation`,
          'Tipitaka Pali',
          'Pali Canon',
          'Theravada',
          'Digital Pali Dictionary',
        ].filter(Boolean);

        // Hreflang alternates for all available translation languages
        const languages = {
          'x-default': `https://tipitakapali.org/book/${bookCode}`,
          'pi': `https://tipitakapali.org/book/${bookCode}`,
        };
        for (const t of TRANSLATION_LANGS) {
          languages[t.code] = `https://tipitakapali.org/book/${bookCode}?l=${t.code}`;
        }

        return {
          title,
          description,
          keywords,
          alternates: {
            canonical: canonicalPath,
            languages,
          },
          openGraph: {
            title,
            description,
            url: canonicalPath,
            locale: 'pi_IN',
            alternateLocales: ['en_US', 'vi_VN', 'my_MM', 'th_TH', 'si_LK', 'de_DE', 'ja_JP', 'hi_IN', 'zh_CN', 'pt_PT'],
            type: 'article',
          },
          twitter: {
            card: 'summary',
            title,
            description,
          },
        };
      }
    }
  } catch (err) {
    console.warn('generateMetadata error:', err);
  }

  return {
    title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with 15 modern translations, rich typography, multi-script support, and full-text search.',
    alternates: { canonical: canonicalPath },
  };
}

export default async function BookPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const slug0 = unwrappedParams?.slug?.[0] ? decodeURIComponent(unwrappedParams.slug[0]) : '';
  const scriptSplit = splitScriptCode(slug0);
  const bookCode = scriptSplit.bookCode;
  const scriptId = scriptSplit.scriptId;

  let entry = null;
  let chaptersForBook = [];

  try {
    const catalogPath = path.join(process.cwd(), 'server_api', 'cst_books_catalog.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      entry = catalog[bookCode] || null;
    }
    const chapsPath = path.join(process.cwd(), 'server_api', 'chapters_catalog.json');
    if (fs.existsSync(chapsPath)) {
      const allChaps = JSON.parse(fs.readFileSync(chapsPath, 'utf8'));
      chaptersForBook = allChaps.filter((c) => c.book_code === bookCode);
    }
  } catch (e) {}

  const bookTitle = entry ? capitalizePali(entry.mat?.mula_title || entry.mat?.attha_title || entry.mat?.tika_title || bookCode) : bookCode;
  const displayTitle = scriptId ? convertPaliScript(bookTitle, scriptId) : bookTitle;
  const nikaya = entry?.pitaka ? capitalizePali(entry.pitaka) : '';

  const bookJsonLd = entry ? {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': `https://tipitakapali.org/book/${bookCode}#book`,
    name: displayTitle,
    headline: `${displayTitle} - Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi`,
    description: `Complete ${displayTitle} (${entry.longNavPath || nikaya}) in original Pāḷi with side-by-side translations in 15 languages.`,
    inLanguage: ['pi', 'en', 'vi', 'my', 'si', 'th', 'hi', 'de', 'ja', 'pt', 'zh', 'km', 'lo', 'ru', 'ta'],
    url: `https://tipitakapali.org/book/${bookCode}`,
    genre: entry.pitaka || 'Buddhism',
    isPartOf: {
      '@type': 'BookSeries',
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      url: 'https://tipitakapali.org/',
    },
    about: [
      { '@type': 'Thing', name: 'Buddhism' },
      { '@type': 'Thing', name: 'Theravada' },
      { '@type': 'Thing', name: 'Pali Canon' },
      ...(nikaya ? [{ '@type': 'Thing', name: nikaya }] : []),
    ],
    workTranslation: TRANSLATION_LANGS.map((t) => ({
      '@type': 'Book',
      name: `${displayTitle} (${t.name} Translation)`,
      inLanguage: t.code,
      url: `https://tipitakapali.org/book/${bookCode}?l=${t.code}`,
    })),
  } : null;

  const breadcrumbJsonLd = entry ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://tipitakapali.org/',
      },
      ...(entry.pitaka ? [{
        '@type': 'ListItem',
        position: 2,
        name: `${capitalizePali(entry.pitaka)} Piṭaka`,
        item: 'https://tipitakapali.org/',
      }] : []),
      ...(nikaya ? [{
        '@type': 'ListItem',
        position: 3,
        name: nikaya,
        item: 'https://tipitakapali.org/',
      }] : []),
      {
        '@type': 'ListItem',
        position: entry.pitaka ? (nikaya ? 4 : 3) : 2,
        name: displayTitle,
        item: `https://tipitakapali.org/book/${bookCode}`,
      },
    ],
  } : null;

  return (
    <>
      {entry && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(bookJsonLd) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
          />
          <noscript>
            <div style={{ padding: '2rem', maxWidth: '850px', margin: '0 auto', fontFamily: 'serif', lineHeight: '1.6' }}>
              <h1>{displayTitle}</h1>
              <p><strong>Canonical Corpus:</strong> Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (Vipassana Research Institute / CSCD edition)</p>
              {entry.longNavPath && <p><strong>Canonical Path:</strong> {entry.longNavPath}</p>}
              <p>
                Read {displayTitle} in original Pāḷi with side-by-side translations in 15 modern languages,
                multi-script typography, Digital Pāḷi Dictionary (DPD), and high-speed full-text search.
              </p>

              {chaptersForBook.length > 0 && (
                <section style={{ marginTop: '1.5rem' }}>
                  <h2>Chapters in this Book</h2>
                  <ul>
                    {chaptersForBook.map((ch, idx) => (
                      <li key={idx}>
                        <a href={`/book/${bookCode}/${idx + 1}`}>
                          {capitalizePali(ch.title || `Chapter ${idx + 1}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section style={{ marginTop: '1.5rem' }}>
                <h2>Translations Available</h2>
                <ul>
                  {TRANSLATION_LANGS.map((t) => (
                    <li key={t.code}>
                      <a href={`/book/${bookCode}?l=${t.code}`}>
                        {t.name} ({t.native})
                      </a>
                    </li>
                  ))}
                </ul>
              </section>

              <section style={{ marginTop: '1.5rem' }}>
                <h2>Pāḷi Script Transliterations</h2>
                <ul>
                  {PALI_SCRIPT_LIST.map((s) => (
                    <li key={s.code}>
                      <a href={`/book/${s.code}.${bookCode}`}>
                        {s.name} ({s.native})
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </noscript>
        </>
      )}
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
            Loading Tipiṭaka...
          </div>
        }
      >
        <MainAppContent params={unwrappedParams} />
      </Suspense>
    </>
  );
}
