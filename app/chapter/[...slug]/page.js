import React, { Suspense } from 'react';
import fs from 'fs';
import path from 'path';
import { MainAppContent } from '../../page';
import { splitScriptCode } from '../../../services/transliterate';
import {
  SITE_URL,
  DEFAULT_SEO_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  TRANSLATION_LANGS,
  buildBookSeoMetadata,
} from '../../../services/seoMetadata';

export { TRANSLATION_LANGS };

let _catalogCache = null;
let _chaptersByBookCache = null;

function getBooksCatalog() {
  if (_catalogCache) return _catalogCache;
  try {
    const catalogPath = path.join(process.cwd(), 'server_api', 'cst_books_catalog.json');
    if (fs.existsSync(catalogPath)) {
      _catalogCache = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      return _catalogCache;
    }
  } catch (e) {}
  return {};
}

function getChaptersByBook() {
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
    }
  } catch (e) {}
  _chaptersByBookCache = map;
  return map;
}

export async function generateStaticParams() {
  const catalog = getBooksCatalog();
  const codes = Object.keys(catalog);
  if (codes.length > 0) {
    return codes.map((code) => ({ slug: [code] }));
  }
  return [{ slug: ['default'] }];
}

export async function generateMetadata({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;

  const slug0 = unwrappedParams?.slug?.[0] ? decodeURIComponent(unwrappedParams.slug[0]) : '';
  let bookCode = slug0;

  const scriptSplit = splitScriptCode(bookCode);
  bookCode = scriptSplit.bookCode;
  const scriptId = scriptSplit.scriptId;

  const chapSuffixMatch = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) {
    bookCode = chapSuffixMatch[1];
  }

  // Canonical points to the pre-rendered /book/<code> page; legacy /chapter/*
  // routes consolidate to /book/<code> and are marked noindex to prevent duplicates.
  const canonicalPath = bookCode ? `/book/${bookCode}` : '/';

  if (!bookCode) {
    return {
      title: { absolute: DEFAULT_SEO_TITLE },
      description: DEFAULT_SEO_DESCRIPTION,
      alternates: { canonical: '/' },
      robots: { index: false, follow: true },
    };
  }

  try {
    const catalog = getBooksCatalog();
    const entry = catalog[bookCode];
    if (entry) {
      const chaptersForBook = getChaptersByBook().get(bookCode) || [];
      const seo = buildBookSeoMetadata(bookCode, entry, chaptersForBook, scriptId);

      return {
        title: { absolute: seo.title },
        description: seo.description,
        keywords: seo.keywords,
        alternates: {
          canonical: canonicalPath,
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
  } catch (err) {
    console.warn('generateMetadata error:', err);
  }

  return {
    title: { absolute: DEFAULT_SEO_TITLE },
    description: DEFAULT_SEO_DESCRIPTION,
    alternates: { canonical: canonicalPath },
    robots: { index: false, follow: true },
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
