import React, { Suspense } from 'react';
import { MainAppContent } from '../../page';
import { capitalizePali } from '../../../services/transliterate';

export async function generateMetadata({ params, searchParams }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const unwrappedSearch = searchParams && typeof searchParams.then === 'function' ? await searchParams : searchParams;

  const slug0 = unwrappedParams?.slug?.[0] ? decodeURIComponent(unwrappedParams.slug[0]) : '';
  let bookCode = slug0;
  let chapterParam = unwrappedSearch?.chapter || unwrappedSearch?.c || unwrappedParams?.slug?.[1];

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
    const res = await fetch(`http://127.0.0.1:5000/api/book/${encodeURIComponent(bookCode)}?chapter=0&buffer=0`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) {
      const data = await res.json();
      const bookTitle = capitalizePali(data.title || bookCode);
      const nikaya = data.nikaya ? capitalizePali(data.nikaya) : '';

      let targetChapIdx = 0;
      if (chapterParam !== undefined && chapterParam !== null) {
        const parsed = parseInt(chapterParam, 10);
        targetChapIdx = Math.max(0, parsed > 0 ? parsed - 1 : 0);
      }

      const currentChap = data.chapters?.[targetChapIdx];
      const chapTitle = currentChap?.title ? capitalizePali(currentChap.title) : '';

      let title = '';
      let subject = '';

      if (chapTitle && chapTitle !== bookTitle) {
        subject = `${bookTitle} › ${chapTitle}`;
        title = `${subject} | Tipiṭaka Pāḷi`;
      } else if (nikaya && nikaya !== bookTitle) {
        subject = `${bookTitle} (${nikaya})`;
        title = `${subject} | Tipiṭaka Pāḷi`;
      } else {
        subject = bookTitle;
        title = `${bookTitle} | Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi`;
      }

      const description = `Complete ${subject} with rich typography, multi-script support, and full-text search.`;

      return {
        title,
        description,
        openGraph: {
          title,
          description,
        },
        twitter: {
          title,
          description,
        },
      };
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

