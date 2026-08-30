import React, { Suspense } from 'react';
import fs from 'fs';
import path from 'path';
import { MainAppContent } from '../../page';
import { capitalizePali, splitScriptCode, convertPaliScript } from '../../../services/transliterate';

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

  const chapSuffixMatch = bookCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
  if (chapSuffixMatch) {
    bookCode = chapSuffixMatch[1];
    if (!chapterParam) chapterParam = parseInt(chapSuffixMatch[2], 10) + 1;
  }

  if (!bookCode) {
    return {
      title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
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
        const description = `Complete ${displayTitle} (${entry.longNavPath || nikaya}) with rich typography, multi-script support, and full-text search.`;
        return {
          title,
          description,
          openGraph: { title, description },
          twitter: { title, description },
        };
      }
    }
  } catch (err) {
    console.warn('generateMetadata error:', err);
  }

  return {
    title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
  };
}


export default async function BookPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
          Loading Tipiṭaka...
        </div>
      }
    >
      <MainAppContent params={unwrappedParams} />
    </Suspense>
  );
}

