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

  // Canonical points at the pre-rendered /book/* page: /chapter/* serves only
  // the SPA shell (no static SEO file), and ?l= translation variants must
  // consolidate to the Pāḷi book URL. Without this, pages inherit '/'.
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

export default async function ChapterPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
          Loading Tipiṭaka Chapter...
        </div>
      }
    >
      <MainAppContent params={unwrappedParams} />
    </Suspense>
  );
}
