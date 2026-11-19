import React, { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { MainAppContent } from '../../page';
import { splitScriptCode } from '../../../services/transliterate';
import {
  SITE_URL,
  TRANSLATION_LANGS,
  buildBookSeoMetadata,
  buildCanonicalPath,
} from '../../../services/seoMetadata';
import {
  getBooksCatalog,
  getChaptersByBook,
  parseStrictPositiveInt,
} from '../../../services/ssrCatalog';

export { TRANSLATION_LANGS };

const IS_STATIC_EXPORT =
  process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

export async function generateStaticParams() {
  if (!IS_STATIC_EXPORT) {
    return [];
  }
  const catalog = getBooksCatalog();
  const codes = Object.keys(catalog);
  if (codes.length > 0) {
    return codes.map((code) => ({ slug: [code] }));
  }
  return [{ slug: ['default'] }];
}

function parseLegacyChapterSlug(slug) {
  if (!Array.isArray(slug) || slug.length < 1 || slug.length > 2) {
    return { valid: false };
  }
  let raw0;
  try {
    raw0 = decodeURIComponent(slug[0]);
  } catch (_) {
    return { valid: false };
  }
  const scriptSplit = splitScriptCode(raw0);
  let bookCode = scriptSplit.bookCode;
  let chapterNum = null;

  const suffixMatch = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (suffixMatch) {
    bookCode = suffixMatch[1];
    chapterNum = parseInt(suffixMatch[2], 10) + 1;
  }
  if (slug[1] !== undefined) {
    try {
      chapterNum = parseStrictPositiveInt(decodeURIComponent(slug[1]));
    } catch (_) {
      return { valid: false };
    }
    if (!chapterNum) return { valid: false };
  }

  const catalog = getBooksCatalog();
  const entry = catalog[bookCode];
  if (!entry) return { valid: false };

  const chaptersForBook = getChaptersByBook().get(bookCode) || [];
  if (chapterNum !== null && (chapterNum < 1 || chapterNum > chaptersForBook.length)) {
    return { valid: false };
  }

  return {
    valid: true,
    bookCode,
    scriptPrefix: scriptSplit.prefix,
    chapterNum,
    entry,
    chaptersForBook,
  };
}

export async function generateMetadata({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseLegacyChapterSlug(unwrappedParams?.slug);

  if (!parsed.valid) {
    notFound();
  }

  const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
    scriptPrefix: parsed.scriptPrefix,
    chapterNum: parsed.chapterNum,
  });

  const canonicalPath = buildCanonicalPath({
    bookCode: parsed.bookCode,
    scriptPrefix: parsed.scriptPrefix,
    chapterNum: parsed.chapterNum,
  });

  return {
    title: { absolute: seo.title },
    description: seo.description,
    keywords: seo.keywords,
    alternates: {
      canonical: `${SITE_URL}${canonicalPath}`,
    },
    robots: { index: false, follow: true },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: `${SITE_URL}${canonicalPath}`,
      siteName: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      locale: 'pi_IN',
      type: 'article',
      images: [
        {
          url: '/android-chrome-512x512.png',
          width: 512,
          height: 512,
          alt: seo.displayTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title,
      description: seo.description,
      images: ['/android-chrome-512x512.png'],
    },
  };
}

export default async function ChapterPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseLegacyChapterSlug(unwrappedParams?.slug);

  if (!parsed.valid) {
    notFound();
  }

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
